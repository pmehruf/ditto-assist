/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { and, desc, eq, gte, lte } from "drizzle-orm";
import type { AnyDb } from "../client.js";
import { searchHistory, type NewSearchHistoryRow, type SearchHistoryRow } from "../schema.js";

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

export type CreateSearchHistoryEntry = Omit<NewSearchHistoryRow, "id" | "timestamp"> & {
  timestamp?: string | Date;
};

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

  /**
   * Deletes every row. Mirrors the old "Clear Activity" owner-gated action.
   * Authorization (owner-only) must be enforced by the caller — this
   * function performs no permission checks of its own.
   */
  async clearAll(): Promise<void> {
    await this.db.delete(searchHistory);
  }
}
