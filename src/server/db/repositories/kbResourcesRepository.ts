/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { and, asc, eq } from "drizzle-orm";
import type { AnyDb } from "../client.js";
import { kbResources, type KbResourceRow, type NewKbResourceRow } from "../schema.js";

export type CreateKbResourceEntry = Omit<NewKbResourceRow, "id" | "createdAt" | "updatedAt">;
export type UpdateKbResourceEntry = Partial<
  Pick<NewKbResourceRow, "title" | "sourceUrl" | "status" | "contentHash" | "lastFetchedAt" | "chunkCount" | "errorMessage" | "categoryId" | "planTags">
>;

export interface KbResourceFilter {
  categoryId?: number;
  status?: KbResourceRow["status"];
}

/** Data Access Layer for `kb_resources` — one row per PDF/web page/sheet
 * ingested into the Knowledge Base. */
export class KbResourcesRepository {
  constructor(private readonly db: AnyDb) {}

  async list(filter: KbResourceFilter = {}): Promise<KbResourceRow[]> {
    const conditions = [];
    if (filter.categoryId !== undefined) conditions.push(eq(kbResources.categoryId, filter.categoryId));
    if (filter.status) conditions.push(eq(kbResources.status, filter.status));
    return this.db
      .select()
      .from(kbResources)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(asc(kbResources.title));
  }

  async get(id: number): Promise<KbResourceRow | undefined> {
    const [row] = await this.db.select().from(kbResources).where(eq(kbResources.id, id));
    return row;
  }

  async create(entry: CreateKbResourceEntry): Promise<KbResourceRow> {
    const [row] = await this.db.insert(kbResources).values(entry).returning();
    return row;
  }

  async update(id: number, entry: UpdateKbResourceEntry): Promise<KbResourceRow | undefined> {
    const [row] = await this.db
      .update(kbResources)
      .set({ ...entry, updatedAt: new Date() })
      .where(eq(kbResources.id, id))
      .returning();
    return row;
  }

  /** Cascades to kb_chunks (see schema.ts's onDelete: "cascade"). */
  async delete(id: number): Promise<void> {
    await this.db.delete(kbResources).where(eq(kbResources.id, id));
  }
}
