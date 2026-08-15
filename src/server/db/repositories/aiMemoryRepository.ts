/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { and, asc, count, desc, eq, ilike, or, sql, type SQL } from "drizzle-orm";
import type { AnyDb } from "../client.js";
import { aiMemory, type AiMemoryRow, type NewAiMemoryRow } from "../schema.js";
import { containsPattern, type PaginatedResult, buildPaginatedResult, clampPage } from "../../pagination.js";

export type AiMemoryStatus = "pending" | "approved" | "rejected" | "archived";

/** ai_memory.ai_response is JSONB shaped `{ result: { matched_question, ... } }`
 * — this pulls that nested field out as a plain SQL text expression so it
 * can be searched/sorted the same way as a real column. */
const MATCHED_QUESTION_EXPR = sql`(${aiMemory.aiResponse}->'result'->>'matched_question')`;

export interface AiMemoryListOptions {
  page?: number;
  pageSize?: number;
  status?: AiMemoryStatus;
  planName?: string;
  /** Matches against condition, planName, or the nested matched_question (case-insensitive substring) — mirrors AiMappingReview.tsx's old client-side search. */
  search?: string;
  /** Whitelisted to "condition" | "planName" | "matched_question" | "status" | "createdAt" | "lastAccessedAt" | "accessCount"; defaults to "createdAt". */
  sortBy?: string;
  sortDir?: "asc" | "desc";
}

export type CreateAiMemoryEntry = Omit<
  NewAiMemoryRow,
  "id" | "createdAt" | "approvedAt" | "approvedBy" | "lastAccessedAt" | "accessCount"
>;

/**
 * Normalizes a condition string into the AI Memory cache key: trimmed,
 * lowercased, internal whitespace collapsed. Exported so the API layer uses
 * the exact same normalization when reading and writing — a mismatch here
 * would silently defeat the cache and re-bill Gemini.
 */
export function normalizeCondition(text: string): string {
  return String(text || "").trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Data Access Layer for `ai_memory` — Level 2 of the three-level lookup
 * memory (L1 deterministic engine → L2 this table → L3 Gemini).
 *
 * Scope is strictly caching + human governance:
 *  - It is only ever consulted AFTER the deterministic engine returns null.
 *  - It never writes to ped_directory, TOP_PED_DICTIONARY, plan configs,
 *    category maps, or any other mapping source. Approving an entry here
 *    changes only this table's own status column; promotion into the
 *    deterministic engine remains a separate manual activity.
 *  - Nothing here can override or bypass an L1 result.
 *
 * Reads are needed by the match route for every signed-in user; writes that
 * change status (approve/reject/archive/edit) are gated to Admin/Developer in
 * the API route layer, same pattern as the other repositories.
 */
export class AiMemoryRepository {
  constructor(private readonly db: AnyDb) {}

  /**
   * L2 cache lookup. Returns the entry for this exact
   * (normalizedCondition, planName, engineVersion) triple regardless of
   * status — the caller decides how each status behaves (approved/pending
   * serve the cached answer; rejected returns a manual-review notice;
   * archived is treated as a miss). Does NOT mutate access counters; call
   * `touch()` once the caller has decided to actually serve the entry.
   */
  async findCached(
    normalizedCondition: string,
    planName: string,
    engineVersion: string
  ): Promise<AiMemoryRow | undefined> {
    const [row] = await this.db
      .select()
      .from(aiMemory)
      .where(
        and(
          eq(aiMemory.normalizedCondition, normalizedCondition),
          eq(aiMemory.planName, planName),
          eq(aiMemory.engineVersion, engineVersion)
        )
      );
    return row;
  }

  /**
   * Records a fresh Gemini answer as `pending`, entering it into the Unknown
   * Condition Queue for manual review. Uses the unique
   * (normalized_condition, plan_name, engine_version) index to stay
   * idempotent under concurrent identical lookups: a race that produces two
   * simultaneous Gemini calls still results in exactly one row, and the
   * existing row is left untouched (its status/approval must never be reset
   * by a later cache write).
   */
  async recordPending(entry: CreateAiMemoryEntry): Promise<AiMemoryRow> {
    const [row] = await this.db
      .insert(aiMemory)
      .values({ ...entry, status: entry.status ?? "pending" })
      .onConflictDoNothing({
        target: [aiMemory.normalizedCondition, aiMemory.planName, aiMemory.engineVersion],
      })
      .returning();
    if (row) return row;
    // Conflict — another request inserted first; return the winning row.
    const existing = await this.findCached(
      entry.normalizedCondition,
      entry.planName,
      entry.engineVersion
    );
    return existing as AiMemoryRow;
  }

  /**
   * Bumps usage telemetry on a cache hit. `accessCount` is what surfaces
   * frequently-searched unknown conditions that are worth promoting into the
   * deterministic engine by hand.
   */
  async touch(id: number): Promise<void> {
    await this.db
      .update(aiMemory)
      .set({ lastAccessedAt: new Date(), accessCount: sql`${aiMemory.accessCount} + 1` })
      .where(eq(aiMemory.id, id));
  }

  /** AI Mapping Review listing, newest first. */
  async list(options?: { status?: AiMemoryStatus; planName?: string }): Promise<AiMemoryRow[]> {
    const filters = [];
    if (options?.status) filters.push(eq(aiMemory.status, options.status));
    if (options?.planName) filters.push(eq(aiMemory.planName, options.planName));

    const base = this.db.select().from(aiMemory);
    const query = filters.length ? base.where(and(...filters)) : base;
    // Secondary `id DESC` tiebreak — two rows inserted within the same
    // millisecond (routine under fast/batched inserts, e.g. seeded test
    // data or a burst of cache-misses) otherwise sort in an unspecified
    // order once createdAt ties, since Postgres doesn't guarantee stable
    // ordering for equal sort keys. `id` is a serial PK, so it reflects
    // true insertion order and makes "newest first" deterministic.
    return query.orderBy(desc(aiMemory.createdAt), desc(aiMemory.id));
  }

  private buildListConditions(options: AiMemoryListOptions) {
    const conditions = [];
    if (options.status) conditions.push(eq(aiMemory.status, options.status));
    if (options.planName) conditions.push(eq(aiMemory.planName, options.planName));
    if (options.search) {
      const pattern = containsPattern(options.search);
      conditions.push(or(ilike(aiMemory.condition, pattern), ilike(aiMemory.planName, pattern), sql`${MATCHED_QUESTION_EXPR} ILIKE ${pattern}`));
    }
    return conditions;
  }

  private sortExpression(sortBy: string | undefined): SQL | any {
    switch (sortBy) {
      case "condition":
        return aiMemory.condition;
      case "planName":
        return aiMemory.planName;
      case "matched_question":
        return MATCHED_QUESTION_EXPR;
      case "status":
        return aiMemory.status;
      case "lastAccessedAt":
        return aiMemory.lastAccessedAt;
      case "accessCount":
        return aiMemory.accessCount;
      case "createdAt":
      default:
        return aiMemory.createdAt;
    }
  }

  /**
   * Server-side paginated/searched/filtered/sorted list for the AI Mapping
   * Review admin UI. `total` comes from a COUNT(*) scoped by the same WHERE
   * clause as the page query.
   */
  async listPaginated(options: AiMemoryListOptions = {}): Promise<PaginatedResult<AiMemoryRow>> {
    const page = Math.max(1, options.page ?? 1);
    const pageSize = Math.max(1, options.pageSize ?? 50);
    const conditions = this.buildListConditions(options);
    const where = conditions.length ? and(...conditions) : undefined;

    const sortColumn = this.sortExpression(options.sortBy);
    const orderFn = options.sortDir === "asc" ? asc : desc;

    const [{ value: total }] = await this.db.select({ value: count() }).from(aiMemory).where(where);
    const { page: clampedPage } = clampPage(page, total, pageSize);
    const data = await this.db
      .select()
      .from(aiMemory)
      .where(where)
      // Secondary `id` tiebreak (same direction as the primary sort) — see
      // the comment on list() above; matters most for the default
      // createdAt sort, where same-millisecond inserts are routine.
      .orderBy(orderFn(sortColumn as any), orderFn(aiMemory.id))
      .limit(pageSize)
      .offset((clampedPage - 1) * pageSize);

    return buildPaginatedResult(data, total, clampedPage, pageSize);
  }

  /** Same filter/search/sort as `listPaginated` but WITHOUT limit/offset —
   * used only by the "Export CSV" button, which downloads the whole
   * matching set rather than just the visible page. */
  async listMatching(options: Pick<AiMemoryListOptions, "status" | "planName" | "search" | "sortBy" | "sortDir"> = {}): Promise<AiMemoryRow[]> {
    const conditions = this.buildListConditions(options);
    const where = conditions.length ? and(...conditions) : undefined;
    const sortColumn = this.sortExpression(options.sortBy);
    const orderFn = options.sortDir === "asc" ? asc : desc;
    // Secondary `id` tiebreak — see the comment on list() above.
    return this.db.select().from(aiMemory).where(where).orderBy(orderFn(sortColumn as any), orderFn(aiMemory.id));
  }

  async get(id: number): Promise<AiMemoryRow | undefined> {
    const [row] = await this.db.select().from(aiMemory).where(eq(aiMemory.id, id));
    return row;
  }

  /**
   * Approve / reject / archive. Approval stamps who and when; it does NOT
   * touch any mapping source — an approved entry simply becomes a trusted
   * cache hit that future lookups reuse without calling Gemini.
   */
  async setStatus(
    id: number,
    status: AiMemoryStatus,
    approvedBy?: string
  ): Promise<AiMemoryRow | undefined> {
    const patch: Partial<NewAiMemoryRow> = { status };
    if (status === "approved") {
      patch.approvedAt = new Date();
      patch.approvedBy = approvedBy ?? null;
    }
    const [row] = await this.db.update(aiMemory).set(patch).where(eq(aiMemory.id, id)).returning();
    return row;
  }

  /**
   * Admin edit of the stored answer (e.g. correcting the matched question or
   * explanation before approving). Only the cached AI response payload is
   * editable — the cache key fields are immutable so an edit can never
   * silently repoint one condition's cache at another.
   */
  async updateResponse(id: number, aiResponse: unknown): Promise<AiMemoryRow | undefined> {
    const [row] = await this.db
      .update(aiMemory)
      .set({ aiResponse: aiResponse as NewAiMemoryRow["aiResponse"] })
      .where(eq(aiMemory.id, id))
      .returning();
    return row;
  }

  async delete(id: number): Promise<void> {
    await this.db.delete(aiMemory).where(eq(aiMemory.id, id));
  }

  /**
   * Links this cached suggestion to the ped_repository row it was promoted
   * into (PED_REPOSITORY_DB_MIGRATION_DESIGN.md §1.6) — set once, at
   * approval time, alongside whatever promotes the suggestion into the live
   * mapping. Left null for suggestions that are still pending or were
   * rejected.
   */
  async linkPed(id: number, pedId: number): Promise<AiMemoryRow | undefined> {
    const [row] = await this.db.update(aiMemory).set({ pedId }).where(eq(aiMemory.id, id)).returning();
    return row;
  }
}
