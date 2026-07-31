/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { and, asc, count, desc, eq, gte, ilike, lte, or, sql } from "drizzle-orm";
import type { AnyDb } from "../client.js";
import { searchHistory, type NewSearchHistoryRow, type SearchHistoryRow } from "../schema.js";
import { containsPattern, type PaginatedResult, buildPaginatedResult, clampPage } from "../../pagination.js";

export interface SearchHistoryFilter {
  /** Restrict to a single user's own lookups (powers the "My Activity" tab). */
  userEmail?: string;
  planName?: string;
  /** ISO 8601 date/datetime lower bound (inclusive), matches against `timestamp`. */
  from?: string;
  /** ISO 8601 date/datetime upper bound (inclusive), matches against `timestamp`. */
  to?: string;
  limit?: number;
}

export interface SearchHistoryListOptions {
  page?: number;
  pageSize?: number;
  userEmail?: string;
  planName?: string;
  from?: string;
  to?: string;
  /** Matches against userEmail, pedInput, or matchedQuestion (case-insensitive substring) — mirrors AuditPage.tsx's old client-side search. */
  search?: string;
  /** One of the levelLabel values from src/utils/matchTier.ts's getMatchTierInfo — "Level 1: Direct Match", "Level 2: Category Match", "Level 3: Fallback", "Needs Clarification", "Not a Medical Ailment", or "All"/undefined for no filter. */
  statusTier?: string;
  /** "System Rule" | "AI Generated" | "All" — mirrors src/utils/labelTranslation.ts's getSourceInfo. */
  sourceType?: string;
  /** Whitelisted to "timestamp" | "planName" | "pedInput" | "matchedQuestion" | "matchType" | "source" | "userEmail"; defaults to "timestamp". */
  sortBy?: string;
  sortDir?: "asc" | "desc";
}

/**
 * Every raw `match_type` value this app has ever written to search_history,
 * bucketed by confidence tier. MUST stay in sync with
 * src/utils/matchTier.ts's `getMatchTierInfo` switch — that file is the
 * presentation source of truth (label text/icon/color); this is its SQL
 * mirror so the Activity Log's status filter and tier-distribution chart
 * agree with what's actually shown in the MAPPING STATUS column for the
 * same row, without loading rows into Node to compute it.
 */
const TIER_MATCH_TYPES = {
  "Level 1: Direct Match": ["P0", "EXACT"],
  "Level 2: Category Match": ["P1", "P2", "LIVE_MATCH", "LIVE MATCH"],
  "Needs Clarification": ["ESCALATE", "INVALID"],
  "Not a Medical Ailment": ["NON_AILMENT"],
} as const;
const ALL_KNOWN_MATCH_TYPES = Object.values(TIER_MATCH_TYPES).flat();

/** Builds the boolean condition for one status tier — including "Level 3:
 * Fallback", whose real rule (per getMatchTierInfo) is "FALLBACK" OR any
 * value not recognized by any other tier (its conservative default). */
function matchTierCondition(levelLabel: string) {
  const upperMatchType = sql`upper(trim(${searchHistory.matchType}))`;
  if (levelLabel === "Level 3: Fallback") {
    return sql`(${upperMatchType} = 'FALLBACK' OR ${upperMatchType} NOT IN (${sql.join(
      [...ALL_KNOWN_MATCH_TYPES, "FALLBACK"].map((v) => sql`${v}`),
      sql`, `
    )}))`;
  }
  const values = TIER_MATCH_TYPES[levelLabel as keyof typeof TIER_MATCH_TYPES];
  if (!values) return undefined;
  return sql`${upperMatchType} IN (${sql.join(values.map((v) => sql`${v}`), sql`, `)})`;
}

/** Mirrors src/utils/labelTranslation.ts's `getSourceInfo`: AI-generated iff
 * the source string mentions Gemini or the standalone word "AI"; every
 * other source is a system/rule decision. `\y` is Postgres's word-boundary
 * regex escape (the ARE equivalent of `\b`). */
function sourceTypeCondition(sourceType: string) {
  const isAi = sql`(${searchHistory.source} ~* 'gemini' OR ${searchHistory.source} ~* '\\yai\\y')`;
  if (sourceType === "AI Generated") return isAi;
  if (sourceType === "System Rule") return sql`NOT ${isAi}`;
  return undefined;
}

export type CreateSearchHistoryEntry = Omit<NewSearchHistoryRow, "id" | "timestamp"> & {
  timestamp?: string | Date;
};

const SORTABLE_COLUMNS = {
  timestamp: searchHistory.timestamp,
  planName: searchHistory.planName,
  pedInput: searchHistory.pedInput,
  matchedQuestion: searchHistory.matchedQuestion,
  matchType: searchHistory.matchType,
  source: searchHistory.source,
  userEmail: searchHistory.userEmail,
} as const;

/**
 * Data Access Layer for the append-only PED-lookup audit trail
 * (search_history table). This is the only module allowed to run queries
 * against that table — API routes and any future callers must go through
 * these functions, never `db.select()`/`db.insert()` directly.
 */
export class SearchHistoryRepository {
  constructor(private readonly db: AnyDb) {}

  /** Records one PED lookup. Called from the /api/match route after every match. */
  async create(entry: CreateSearchHistoryEntry): Promise<SearchHistoryRow> {
    const [row] = await this.db
      .insert(searchHistory)
      .values({
        ...entry,
        timestamp: entry.timestamp ? new Date(entry.timestamp) : undefined,
      })
      .returning();
    return row;
  }

  /**
   * Lists entries, most recent first, optionally filtered. Used by both the
   * Audit tab (no userEmail filter) and My Activity tab (userEmail set to
   * the current user) — the two are the same table, filtered differently.
   */
  async list(filter: SearchHistoryFilter = {}): Promise<SearchHistoryRow[]> {
    const conditions = [];
    if (filter.userEmail) conditions.push(eq(searchHistory.userEmail, filter.userEmail));
    if (filter.planName) conditions.push(eq(searchHistory.planName, filter.planName));
    if (filter.from) conditions.push(gte(searchHistory.timestamp, new Date(filter.from)));
    if (filter.to) conditions.push(lte(searchHistory.timestamp, new Date(filter.to)));

    const query = this.db
      .select()
      .from(searchHistory)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(searchHistory.timestamp));

    return filter.limit ? query.limit(filter.limit) : query;
  }

  private buildConditions(options: SearchHistoryListOptions) {
    const conditions = [];
    if (options.userEmail) conditions.push(eq(searchHistory.userEmail, options.userEmail));
    if (options.planName) conditions.push(eq(searchHistory.planName, options.planName));
    if (options.from) conditions.push(gte(searchHistory.timestamp, new Date(options.from)));
    if (options.to) conditions.push(lte(searchHistory.timestamp, new Date(options.to)));
    if (options.search) {
      const pattern = containsPattern(options.search);
      conditions.push(or(ilike(searchHistory.userEmail, pattern), ilike(searchHistory.pedInput, pattern), ilike(searchHistory.matchedQuestion, pattern)));
    }
    if (options.statusTier && options.statusTier !== "All") {
      const cond = matchTierCondition(options.statusTier);
      if (cond) conditions.push(cond);
    }
    if (options.sourceType && options.sourceType !== "All") {
      const cond = sourceTypeCondition(options.sourceType);
      if (cond) conditions.push(cond);
    }
    return conditions;
  }

  /**
   * Server-side paginated/searched/filtered/sorted list for the Activity
   * Log's "User Activity" sub-tab and the "My Activity" page (the latter
   * always passes `userEmail`). `total` comes from a COUNT(*) scoped by the
   * same WHERE clause as the page query.
   */
  async listPaginated(options: SearchHistoryListOptions = {}): Promise<PaginatedResult<SearchHistoryRow>> {
    const page = Math.max(1, options.page ?? 1);
    const pageSize = Math.max(1, options.pageSize ?? 50);
    const conditions = this.buildConditions(options);
    const where = conditions.length ? and(...conditions) : undefined;

    const sortColumn = SORTABLE_COLUMNS[options.sortBy as keyof typeof SORTABLE_COLUMNS] ?? searchHistory.timestamp;
    const orderFn = options.sortDir === "asc" ? asc : desc;

    const [{ value: total }] = await this.db.select({ value: count() }).from(searchHistory).where(where);
    const { page: clampedPage } = clampPage(page, total, pageSize);
    const data = await this.db
      .select()
      .from(searchHistory)
      .where(where)
      .orderBy(orderFn(sortColumn))
      .limit(pageSize)
      .offset((clampedPage - 1) * pageSize);

    return buildPaginatedResult(data, total, clampedPage, pageSize);
  }

  /** Same filter/search/sort as `listPaginated` but WITHOUT limit/offset —
   * used only by the Activity Log's "Export CSV" button, which downloads
   * the whole matching set rather than just the visible page. */
  async listMatching(options: Omit<SearchHistoryListOptions, "page" | "pageSize"> = {}): Promise<SearchHistoryRow[]> {
    const conditions = this.buildConditions(options);
    const where = conditions.length ? and(...conditions) : undefined;
    const sortColumn = SORTABLE_COLUMNS[options.sortBy as keyof typeof SORTABLE_COLUMNS] ?? searchHistory.timestamp;
    const orderFn = options.sortDir === "asc" ? asc : desc;
    return this.db.select().from(searchHistory).where(where).orderBy(orderFn(sortColumn));
  }

  /**
   * One GROUP BY-style aggregate query (five conditional COUNT(*)s) scoped
   * by the SAME filters as `listPaginated` (minus paging) — powers the
   * Activity Log's "Match Category Distribution" chart without loading the
   * full filtered result set into Node just to tally it client-side.
   */
  async getTierCounts(options: Omit<SearchHistoryListOptions, "page" | "pageSize" | "sortBy" | "sortDir"> = {}): Promise<{
    level1: number;
    level2: number;
    level3: number;
    needsClarification: number;
    notMedicalAilment: number;
  }> {
    const conditions = this.buildConditions(options);
    const where = conditions.length ? and(...conditions) : undefined;

    const [row] = await this.db
      .select({
        level1: count(sql`CASE WHEN ${matchTierCondition("Level 1: Direct Match")} THEN 1 END`),
        level2: count(sql`CASE WHEN ${matchTierCondition("Level 2: Category Match")} THEN 1 END`),
        level3: count(sql`CASE WHEN ${matchTierCondition("Level 3: Fallback")} THEN 1 END`),
        needsClarification: count(sql`CASE WHEN ${matchTierCondition("Needs Clarification")} THEN 1 END`),
        notMedicalAilment: count(sql`CASE WHEN ${matchTierCondition("Not a Medical Ailment")} THEN 1 END`),
      })
      .from(searchHistory)
      .where(where);

    return row ?? { level1: 0, level2: 0, level3: 0, needsClarification: 0, notMedicalAilment: 0 };
  }

  /**
   * Deletes every row. Mirrors the old "Clear Activity" owner-gated action.
   * Authorization (owner-only) must be enforced by the caller — this
   * function performs no permission checks of its own.
   */
  async clearAll(): Promise<void> {
    await this.db.delete(searchHistory);
  }
}
