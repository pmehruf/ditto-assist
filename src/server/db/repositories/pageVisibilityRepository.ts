/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { eq } from "drizzle-orm";
import type { AnyDb } from "../client.js";
import { pageVisibility, type PageVisibilityRow } from "../schema.js";

/**
 * Data Access Layer for `page_visibility` — the Developer-only show/hide switch.
 *
 * Read by EVERY signed-in user (the client needs the hidden set to render
 * its nav), writes gated to Developer in the API route layer. Absence of a row
 * means visible, so a new page needs no seeding.
 */
export class PageVisibilityRepository {
  constructor(private readonly db: AnyDb) {}

  async list(): Promise<PageVisibilityRow[]> {
    return this.db.select().from(pageVisibility);
  }

  /** Upsert by feature id — one row per page, so set() replaces in place. */
  async setHidden(featureId: string, hidden: boolean, updatedBy: string): Promise<PageVisibilityRow> {
    const [row] = await this.db
      .insert(pageVisibility)
      .values({ featureId, hidden, updatedBy, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: pageVisibility.featureId,
        set: { hidden, updatedBy, updatedAt: new Date() },
      })
      .returning();
    return row;
  }

  async get(featureId: string): Promise<PageVisibilityRow | undefined> {
    const [row] = await this.db.select().from(pageVisibility).where(eq(pageVisibility.featureId, featureId));
    return row;
  }
}
