/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { eq } from "drizzle-orm";
import type { AnyDb } from "../client.js";
import { termPlaybookConnection, type TermPlaybookConnectionRow } from "../schema.js";

const CONNECTION_ID = "default";

/**
 * Data Access Layer for `term_playbook_connection` — the Term Playbook
 * Sheet's single stored Google OAuth grant (see
 * src/server/knowledgeBase/termPlaybookSheetsClient.ts). Always exactly zero
 * or one row. Mirrors KbPlaybookConnectionRepository exactly; kept as its own
 * table/repository since the Term Playbook Sheet has a different
 * owner/account than the Health Playbook.
 */
export class TermPlaybookConnectionRepository {
  constructor(private readonly db: AnyDb) {}

  async get(): Promise<TermPlaybookConnectionRow | undefined> {
    const [row] = await this.db.select().from(termPlaybookConnection).where(eq(termPlaybookConnection.id, CONNECTION_ID));
    return row;
  }

  async upsert(data: { connectedEmail: string; encryptedRefreshToken: string; connectedBy: string }): Promise<TermPlaybookConnectionRow> {
    const [row] = await this.db
      .insert(termPlaybookConnection)
      .values({ id: CONNECTION_ID, ...data, connectedAt: new Date() })
      .onConflictDoUpdate({
        target: termPlaybookConnection.id,
        set: { ...data, connectedAt: new Date() },
      })
      .returning();
    return row;
  }

  async clear(): Promise<void> {
    await this.db.delete(termPlaybookConnection).where(eq(termPlaybookConnection.id, CONNECTION_ID));
  }
}
