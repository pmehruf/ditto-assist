/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { eq } from "drizzle-orm";
import type { AnyDb } from "../client.js";
import { queryAssistLogExportConnection, type QueryAssistLogExportConnectionRow } from "../schema.js";

const CONNECTION_ID = "default";

/**
 * Data Access Layer for `query_assist_log_export_connection` — the Product
 * Assist log export's single stored, WRITE-scope Google OAuth grant (see
 * src/server/knowledgeBase/queryAssistLogSheetsClient.ts). Always exactly
 * zero or one row. Same shape as QaDashboardConnectionRepository /
 * KbPlaybookConnectionRepository, kept as its own class/table since this is
 * an independent credential.
 */
export class QueryAssistLogExportConnectionRepository {
  constructor(private readonly db: AnyDb) {}

  async get(): Promise<QueryAssistLogExportConnectionRow | undefined> {
    const [row] = await this.db
      .select()
      .from(queryAssistLogExportConnection)
      .where(eq(queryAssistLogExportConnection.id, CONNECTION_ID));
    return row;
  }

  async upsert(data: {
    connectedEmail: string;
    encryptedRefreshToken: string;
    connectedBy: string;
  }): Promise<QueryAssistLogExportConnectionRow> {
    const [row] = await this.db
      .insert(queryAssistLogExportConnection)
      .values({ id: CONNECTION_ID, ...data, connectedAt: new Date() })
      .onConflictDoUpdate({
        target: queryAssistLogExportConnection.id,
        set: { ...data, connectedAt: new Date() },
      })
      .returning();
    return row;
  }

  async clear(): Promise<void> {
    await this.db.delete(queryAssistLogExportConnection).where(eq(queryAssistLogExportConnection.id, CONNECTION_ID));
  }
}
