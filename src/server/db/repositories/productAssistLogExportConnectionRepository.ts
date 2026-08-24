/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { eq } from "drizzle-orm";
import type { AnyDb } from "../client.js";
import { productAssistLogExportConnection, type ProductAssistLogExportConnectionRow } from "../schema.js";

const CONNECTION_ID = "default";

/**
 * Data Access Layer for `product_assist_log_export_connection` — the Product
 * Assist log export's single stored, WRITE-scope Google OAuth grant (see
 * src/server/knowledgeBase/productAssistLogSheetsClient.ts). Always exactly
 * zero or one row. Same shape as QaDashboardConnectionRepository /
 * KbPlaybookConnectionRepository, kept as its own class/table since this is
 * an independent credential.
 */
export class ProductAssistLogExportConnectionRepository {
  constructor(private readonly db: AnyDb) {}

  async get(): Promise<ProductAssistLogExportConnectionRow | undefined> {
    const [row] = await this.db
      .select()
      .from(productAssistLogExportConnection)
      .where(eq(productAssistLogExportConnection.id, CONNECTION_ID));
    return row;
  }

  async upsert(data: {
    connectedEmail: string;
    encryptedRefreshToken: string;
    connectedBy: string;
  }): Promise<ProductAssistLogExportConnectionRow> {
    const [row] = await this.db
      .insert(productAssistLogExportConnection)
      .values({ id: CONNECTION_ID, ...data, connectedAt: new Date() })
      .onConflictDoUpdate({
        target: productAssistLogExportConnection.id,
        set: { ...data, connectedAt: new Date() },
      })
      .returning();
    return row;
  }

  async clear(): Promise<void> {
    await this.db.delete(productAssistLogExportConnection).where(eq(productAssistLogExportConnection.id, CONNECTION_ID));
  }
}
