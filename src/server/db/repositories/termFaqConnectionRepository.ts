/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { eq } from "drizzle-orm";
import type { AnyDb } from "../client.js";
import { termFaqConnection, type TermFaqConnectionRow } from "../schema.js";

const CONNECTION_ID = "default";

/**
 * Data Access Layer for `term_faq_connection` — the Term FAQ Sheet's single
 * stored Google OAuth grant (see src/server/knowledgeBase/termFaqSheetsClient.ts).
 * Always exactly zero or one row. Mirrors KbFaqConnectionRepository exactly;
 * kept as its own table/repository since the Term FAQ Sheet has a different
 * owner/account than the Health FAQ Sheet.
 */
export class TermFaqConnectionRepository {
  constructor(private readonly db: AnyDb) {}

  async get(): Promise<TermFaqConnectionRow | undefined> {
    const [row] = await this.db.select().from(termFaqConnection).where(eq(termFaqConnection.id, CONNECTION_ID));
    return row;
  }

  async upsert(data: { connectedEmail: string; encryptedRefreshToken: string; connectedBy: string }): Promise<TermFaqConnectionRow> {
    const [row] = await this.db
      .insert(termFaqConnection)
      .values({ id: CONNECTION_ID, ...data, connectedAt: new Date() })
      .onConflictDoUpdate({
        target: termFaqConnection.id,
        set: { ...data, connectedAt: new Date() },
      })
      .returning();
    return row;
  }

  async clear(): Promise<void> {
    await this.db.delete(termFaqConnection).where(eq(termFaqConnection.id, CONNECTION_ID));
  }
}
