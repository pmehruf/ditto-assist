/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { asc, count, inArray } from "drizzle-orm";
import type { AnyDb } from "../client.js";
import { queryAssistLogs, type QueryAssistLogRow, type NewQueryAssistLogRow } from "../schema.js";

export type CreateQueryAssistLogEntry = Omit<NewQueryAssistLogRow, "id" | "createdAt">;

/**
 * Data Access Layer for `query_assist_logs` — see that table's schema
 * comment for why this exists and why it's meant to be temporary. Every
 * write here happens fire-and-forget from server.ts's POST
 * /api/query-assist/ask (never awaited by the response, and gated behind
 * QUERY_ASSIST_LOG_ENABLED) — a logging failure must never affect an
 * advisor's actual answer.
 */
export class QueryAssistLogsRepository {
  constructor(private readonly db: AnyDb) {}

  async create(entry: CreateQueryAssistLogEntry): Promise<void> {
    await this.db.insert(queryAssistLogs).values(entry);
  }

  /** Oldest first, so an export naturally processes rows in the order they
   * were asked. */
  async listAll(): Promise<QueryAssistLogRow[]> {
    return this.db.select().from(queryAssistLogs).orderBy(asc(queryAssistLogs.createdAt));
  }

  async count(): Promise<number> {
    const [row] = await this.db.select({ value: count() }).from(queryAssistLogs);
    return row?.value ?? 0;
  }

  /** Deletes only the specific rows named — used by the export job to clear
   * exactly (and only) the rows it just confirmed were appended to the
   * Sheet, never a blanket "delete everything" that could race a
   * still-in-flight write from a live advisor question. */
  async deleteByIds(ids: number[]): Promise<void> {
    if (ids.length === 0) return;
    await this.db.delete(queryAssistLogs).where(inArray(queryAssistLogs.id, ids));
  }
}
