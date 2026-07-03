/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { and, desc, eq, gte, lte } from "drizzle-orm";
import type { AnyDb } from "../client.js";
import { changeLogs, type ChangeLogRow, type NewChangeLogRow } from "../schema.js";

export interface ChangeLogFilter {
  actionType?: string;
  planName?: string;
  userName?: string;
  from?: string;
  to?: string;
  limit?: number;
}

export type CreateChangeLogEntry = Omit<NewChangeLogRow, "id" | "timestamp"> & {
  timestamp?: string | Date;
};

/**
 * Data Access Layer for the administrative/workflow action trail
 * (change_logs table) — powers the "Modification History" sub-tab under
 * Audit and the workflow-approval trail (actionType values like
 * "Draft Approved" / "Draft Created" / "Insurer Edited" /
 * "Announcement Added" / "Announcement Edited").
 */
export class ChangeLogRepository {
  constructor(private readonly db: AnyDb) {}

  async create(entry: CreateChangeLogEntry): Promise<ChangeLogRow> {
    const [row] = await this.db
      .insert(changeLogs)
      .values({
        ...entry,
        timestamp: entry.timestamp ? new Date(entry.timestamp) : undefined,
      })
      .returning();
    return row;
  }

  async list(filter: ChangeLogFilter = {}): Promise<ChangeLogRow[]> {
    const conditions = [];
    if (filter.actionType) conditions.push(eq(changeLogs.actionType, filter.actionType));
    if (filter.planName) conditions.push(eq(changeLogs.planName, filter.planName));
    if (filter.userName) conditions.push(eq(changeLogs.userName, filter.userName));
    if (filter.from) conditions.push(gte(changeLogs.timestamp, new Date(filter.from)));
    if (filter.to) conditions.push(lte(changeLogs.timestamp, new Date(filter.to)));

    const query = this.db
      .select()
      .from(changeLogs)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(changeLogs.timestamp));

    return filter.limit ? query.limit(filter.limit) : query;
  }

  async clearAll(): Promise<void> {
    await this.db.delete(changeLogs);
  }
}
