/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { eq } from "drizzle-orm";
import type { AnyDb } from "../client.js";
import { kbPlaybookConnection, type KbPlaybookConnectionRow } from "../schema.js";

const CONNECTION_ID = "default";

/**
 * Data Access Layer for `kb_playbook_connection` — the Product Playbook
 * Sheet's single stored Google OAuth grant (see
 * src/server/knowledgeBase/playbookSheetsClient.ts). Always exactly zero or
 * one row. Mirrors QaDashboardConnectionRepository exactly; kept as its own
 * table/repository since the Playbook Sheet has a different owner/account
 * than the QA workbook.
 */
export class KbPlaybookConnectionRepository {
  constructor(private readonly db: AnyDb) {}

  async get(): Promise<KbPlaybookConnectionRow | undefined> {
    const [row] = await this.db
      .select()
      .from(kbPlaybookConnection)
      .where(eq(kbPlaybookConnection.id, CONNECTION_ID));
    return row;
  }

  async upsert(data: {
    connectedEmail: string;
    encryptedRefreshToken: string;
    connectedBy: string;
  }): Promise<KbPlaybookConnectionRow> {
    const [row] = await this.db
      .insert(kbPlaybookConnection)
      .values({ id: CONNECTION_ID, ...data, connectedAt: new Date() })
      .onConflictDoUpdate({
        target: kbPlaybookConnection.id,
        set: { ...data, connectedAt: new Date() },
      })
      .returning();
    return row;
  }

  async clear(): Promise<void> {
    await this.db.delete(kbPlaybookConnection).where(eq(kbPlaybookConnection.id, CONNECTION_ID));
  }
}
