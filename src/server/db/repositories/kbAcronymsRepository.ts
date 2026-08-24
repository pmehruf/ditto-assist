/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { and, asc, desc, eq, ilike, or } from "drizzle-orm";
import type { AnyDb } from "../client.js";
import { kbAcronyms, type KbAcronymRow, type NewKbAcronymRow } from "../schema.js";

export type CreateKbAcronymEntry = Omit<NewKbAcronymRow, "id" | "createdAt" | "updatedAt">;
export type UpdateKbAcronymEntry = Partial<Pick<NewKbAcronymRow, "acronym" | "expansion" | "notes" | "isActive" | "updatedBy">>;

export interface KbAcronymFilter {
  search?: string;
  isActive?: boolean;
}

/** Data Access Layer for `kb_acronyms` — the Acronym Dictionary. See
 * schema.ts's doc comment on the table for the full design. */
export class KbAcronymsRepository {
  constructor(private readonly db: AnyDb) {}

  /** UI listing — supports the Knowledge Hub table's search/filter. `search`
   * matches either the acronym or its expansion (small dataset, one query
   * covers both fields advisors would search by). */
  async list(filter: KbAcronymFilter = {}): Promise<KbAcronymRow[]> {
    const conditions = [];
    if (filter.search?.trim()) {
      const needle = `%${filter.search.trim()}%`;
      conditions.push(or(ilike(kbAcronyms.acronym, needle), ilike(kbAcronyms.expansion, needle)));
    }
    if (filter.isActive !== undefined) conditions.push(eq(kbAcronyms.isActive, filter.isActive));
    return this.db
      .select()
      .from(kbAcronyms)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(kbAcronyms.updatedAt), asc(kbAcronyms.acronym));
  }

  /** Every active acronym, for query-time matching — see
   * src/server/knowledgeBase/acronyms.ts. Fetches ALL active rows rather
   * than pre-filtering in SQL: this table is admin-curated and expected to
   * stay small, and matching against the question text has to happen in JS
   * either way (word-boundary regex, not something SQL does for us). */
  async listActive(): Promise<KbAcronymRow[]> {
    return this.db.select().from(kbAcronyms).where(eq(kbAcronyms.isActive, true));
  }

  async get(id: number): Promise<KbAcronymRow | undefined> {
    const [row] = await this.db.select().from(kbAcronyms).where(eq(kbAcronyms.id, id));
    return row;
  }

  async create(entry: CreateKbAcronymEntry): Promise<KbAcronymRow> {
    const [row] = await this.db.insert(kbAcronyms).values(entry).returning();
    return row;
  }

  async update(id: number, entry: UpdateKbAcronymEntry): Promise<KbAcronymRow | undefined> {
    const [row] = await this.db
      .update(kbAcronyms)
      .set({ ...entry, updatedAt: new Date() })
      .where(eq(kbAcronyms.id, id))
      .returning();
    return row;
  }

  async delete(id: number): Promise<void> {
    await this.db.delete(kbAcronyms).where(eq(kbAcronyms.id, id));
  }
}
