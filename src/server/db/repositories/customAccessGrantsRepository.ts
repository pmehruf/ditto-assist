/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { and, eq } from "drizzle-orm";
import type { AnyDb } from "../client.js";
import { customAccessGrants, type CustomAccessGrantRow } from "../schema.js";

export type CustomAccessGrantLevel = "None" | "Viewer" | "Editor";

export interface CreateCustomAccessGrantEntry {
  userEmail: string;
  grantType: string;
  targetId: string;
  level: CustomAccessGrantLevel | null;
  note: string | null;
  grantedBy: string;
}

/**
 * Data Access Layer for `custom_access_grants` — per-individual, add-only
 * access overrides (see schema.ts's doc comment on the table). Read by
 * Admin+Platform Admin+Developer for the management tab; a person's OWN
 * active grants are also readable by themselves via `listActiveForEmail`
 * (used to resolve their own effective access, same posture as
 * feature_access_overrides). Writes gated to Developer+Platform Admin in
 * the API route layer.
 */
export class CustomAccessGrantsRepository {
  constructor(private readonly db: AnyDb) {}

  async list(): Promise<CustomAccessGrantRow[]> {
    return this.db.select().from(customAccessGrants);
  }

  async listActiveForEmail(email: string): Promise<CustomAccessGrantRow[]> {
    return this.db
      .select()
      .from(customAccessGrants)
      .where(and(eq(customAccessGrants.userEmail, email.toLowerCase()), eq(customAccessGrants.active, true)));
  }

  /** Upsert by (userEmail, grantType, targetId) — re-granting the same
   * thing updates level/note/grantedBy/grantedAt and reactivates it if it
   * had been revoked, rather than creating a duplicate row. */
  async set(entry: CreateCustomAccessGrantEntry): Promise<CustomAccessGrantRow> {
    const [row] = await this.db
      .insert(customAccessGrants)
      .values({
        userEmail: entry.userEmail.toLowerCase(),
        grantType: entry.grantType,
        targetId: entry.targetId,
        level: entry.level,
        note: entry.note,
        active: true,
        grantedBy: entry.grantedBy,
        grantedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [customAccessGrants.userEmail, customAccessGrants.grantType, customAccessGrants.targetId],
        set: {
          level: entry.level,
          note: entry.note,
          active: true,
          grantedBy: entry.grantedBy,
          grantedAt: new Date(),
        },
      })
      .returning();
    return row;
  }

  /** Revoke (deactivate, not delete) — preserves the audit record of what
   * was granted and to whom. */
  async revoke(id: number): Promise<CustomAccessGrantRow | undefined> {
    const [row] = await this.db
      .update(customAccessGrants)
      .set({ active: false })
      .where(eq(customAccessGrants.id, id))
      .returning();
    return row;
  }
}
