/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { asc, eq, inArray, sql } from "drizzle-orm";
import type { AnyDb } from "../client.js";
import { externalResources, type ExternalResourceRow, type NewExternalResourceRow } from "../schema.js";

export type CreateExternalResourceEntry = Omit<NewExternalResourceRow, "id" | "createdAt" | "sortOrder">;
export type UpdateExternalResourceEntry = Partial<Omit<NewExternalResourceRow, "id" | "createdAt" | "addedBy" | "sortOrder">>;

/**
 * Data Access Layer for the external resource links (Payment SOP, QA
 * Dashboard, etc.) surfaced in the Workspace Controls drawer. Read by
 * everyone; writes are gated to Admin/Owner in the API route layer.
 */
export class ExternalResourcesRepository {
  constructor(private readonly db: AnyDb) {}

  async list(): Promise<ExternalResourceRow[]> {
    // Manual display order first (ties broken by id/creation order), not
    // newest-first — Admin/Owner control the order via reorder() below.
    return this.db
      .select()
      .from(externalResources)
      .orderBy(asc(externalResources.sortOrder), asc(externalResources.id));
  }

  async create(entry: CreateExternalResourceEntry): Promise<ExternalResourceRow> {
    // New links append to the end of the current order rather than
    // defaulting to 0 (which would jump them to the front on next sort).
    const existing = await this.db.select({ sortOrder: externalResources.sortOrder }).from(externalResources);
    const nextOrder = existing.length ? Math.max(...existing.map((r) => r.sortOrder)) + 1 : 0;
    const [row] = await this.db.insert(externalResources).values({ ...entry, sortOrder: nextOrder }).returning();
    return row;
  }

  async update(id: number, entry: UpdateExternalResourceEntry): Promise<ExternalResourceRow | undefined> {
    const [row] = await this.db
      .update(externalResources)
      .set(entry)
      .where(eq(externalResources.id, id))
      .returning();
    return row;
  }

  async delete(id: number): Promise<void> {
    await this.db.delete(externalResources).where(eq(externalResources.id, id));
  }

  /** Persists a full new ordering — `orderedIds` must contain every existing
   * row's id, in the desired display order (index becomes sort_order).
   * Done as a single bulk UPDATE (CASE/WHEN over all ids) rather than one
   * UPDATE per id in a transaction loop — fewer round trips, fully atomic,
   * and avoids repeatedly re-preparing the identical statement shape N
   * times in one session, which some pooled Postgres setups (Neon's
   * connection pooler included) don't handle well. */
  async reorder(orderedIds: number[]): Promise<void> {
    if (orderedIds.length === 0) return;
    const sortOrderCase = sql.join(
      orderedIds.map((id, idx) => sql`WHEN ${id} THEN ${idx}`),
      sql` `
    );
    await this.db
      .update(externalResources)
      .set({ sortOrder: sql`CASE ${externalResources.id} ${sortOrderCase} END` })
      .where(inArray(externalResources.id, orderedIds));
  }
}
