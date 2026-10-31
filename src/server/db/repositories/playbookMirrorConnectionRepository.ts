/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { eq } from "drizzle-orm";
import type { AnyDb } from "../client.js";
import { playbookMirrorConnection } from "../schema.js";

type Domain = "Health" | "Term";
export type PlaybookMirrorConnectionRow = typeof playbookMirrorConnection.$inferSelect;

/**
 * Data Access Layer for `playbook_mirror_connection` — the Product Playbook
 * mirror's dedicated READ-ONLY Google grant (one row per domain at most).
 * Separate from kb_playbook_connection, which this never reads or writes.
 * The table's CHECK constraint refuses any grant whose recorded scopes go
 * beyond read-only, so an upsert with broader scopes fails at the database.
 */
export class PlaybookMirrorConnectionRepository {
  constructor(private readonly db: AnyDb) {}

  async get(domain: Domain = "Health"): Promise<PlaybookMirrorConnectionRow | undefined> {
    const [row] = await this.db.select().from(playbookMirrorConnection).where(eq(playbookMirrorConnection.domain, domain));
    return row;
  }

  async upsert(data: {
    domain?: Domain;
    connectedEmail: string;
    encryptedRefreshToken: string;
    grantedScopes: string[];
    connectedBy: string;
  }): Promise<PlaybookMirrorConnectionRow> {
    const domain = data.domain ?? "Health";
    const values = {
      connectedEmail: data.connectedEmail,
      encryptedRefreshToken: data.encryptedRefreshToken,
      grantedScopes: data.grantedScopes,
      connectedBy: data.connectedBy,
      connectedAt: new Date(),
    };
    const [row] = await this.db
      .insert(playbookMirrorConnection)
      .values({ domain, ...values })
      .onConflictDoUpdate({ target: playbookMirrorConnection.domain, set: values })
      .returning();
    return row;
  }

  async clear(domain: Domain = "Health"): Promise<void> {
    await this.db.delete(playbookMirrorConnection).where(eq(playbookMirrorConnection.domain, domain));
  }
}
