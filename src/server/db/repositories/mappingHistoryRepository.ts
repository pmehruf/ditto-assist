/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { desc, eq } from "drizzle-orm";
import type { AnyDb } from "../client.js";
import { mappingHistory, type MappingHistoryRow, type NewMappingHistoryRow } from "../schema.js";

export type CreateMappingHistoryEntry = Omit<NewMappingHistoryRow, "id" | "performedAt">;

/**
 * Data Access Layer for `mapping_history` — structured, queryable audit
 * trail for PED/category/mapping changes specifically
 * (PED_REPOSITORY_DB_MIGRATION_DESIGN.md §1.7), distinct from `change_logs`
 * (ChangeLogRepository), which stays for plan/announcement/user admin
 * actions. Append-only: there is no update/delete — a correction is a new
 * row, not an edit of history.
 */
export class MappingHistoryRepository {
  constructor(private readonly db: AnyDb) {}

  async listByPed(pedId: number): Promise<MappingHistoryRow[]> {
    return this.db
      .select()
      .from(mappingHistory)
      .where(eq(mappingHistory.pedId, pedId))
      .orderBy(desc(mappingHistory.performedAt));
  }

  async list(limit = 200): Promise<MappingHistoryRow[]> {
    return this.db.select().from(mappingHistory).orderBy(desc(mappingHistory.performedAt)).limit(limit);
  }

  async record(entry: CreateMappingHistoryEntry): Promise<MappingHistoryRow> {
    const [row] = await this.db.insert(mappingHistory).values(entry).returning();
    return row;
  }
}
