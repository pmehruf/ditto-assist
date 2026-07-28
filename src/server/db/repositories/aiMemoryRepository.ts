/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { and, desc, eq, sql } from "drizzle-orm";
import type { AnyDb } from "../client.js";
import { aiMemory, type AiMemoryRow, type NewAiMemoryRow } from "../schema.js";

export type AiMemoryStatus = "pending" | "approved" | "rejected" | "archived";

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
 * change status (approve/reject/archive/edit) are gated to Admin/Owner in
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
    return query.orderBy(desc(aiMemory.createdAt));
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
