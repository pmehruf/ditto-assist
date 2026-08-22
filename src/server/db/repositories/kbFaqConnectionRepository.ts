/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { eq } from "drizzle-orm";
import type { AnyDb } from "../client.js";
import { kbFaqConnection, type KbFaqConnectionRow } from "../schema.js";

const CONNECTION_ID = "default";

/**
 * Data Access Layer for `kb_faq_connection` — the Ditto FAQ Sheet's single
 * stored Google OAuth grant (see src/server/knowledgeBase/faqSheetsClient.ts).
 * Always exactly zero or one row. Mirrors KbPlaybookConnectionRepository
 * exactly; kept as its own table/repository since the FAQ Sheet has a
 * different owner/account than the Playbook Sheet.
 */
export class KbFaqConnectionRepository {
  constructor(private readonly db: AnyDb) {}

  async get(): Promise<KbFaqConnectionRow | undefined> {
    const [row] = await this.db.select().from(kbFaqConnection).where(eq(kbFaqConnection.id, CONNECTION_ID));
    return row;
  }

  async upsert(data: { connectedEmail: string; encryptedRefreshToken: string; connectedBy: string }): Promise<KbFaqConnectionRow> {
    const [row] = await this.db
      .insert(kbFaqConnection)
      .values({ id: CONNECTION_ID, ...data, connectedAt: new Date() })
      .onConflictDoUpdate({
        target: kbFaqConnection.id,
        set: { ...data, connectedAt: new Date() },
      })
      .returning();
    return row;
  }

  async clear(): Promise<void> {
    await this.db.delete(kbFaqConnection).where(eq(kbFaqConnection.id, CONNECTION_ID));
  }
}
