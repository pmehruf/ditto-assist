/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { asc, eq } from "drizzle-orm";
import type { AnyDb } from "../client.js";
import { kbCategories, type KbCategoryRow, type NewKbCategoryRow } from "../schema.js";

export type CreateKbCategoryEntry = Omit<NewKbCategoryRow, "id" | "createdAt">;
export type UpdateKbCategoryEntry = Partial<Pick<NewKbCategoryRow, "name" | "type" | "sortOrder" | "planNames" | "disabledPlanNames">>;

/** Data Access Layer for `kb_categories` — the Knowledge Base's extensible
 * per-insurer + "general" category list (Ask the Playbook). */
export class KbCategoriesRepository {
  constructor(private readonly db: AnyDb) {}

  async list(): Promise<KbCategoryRow[]> {
    return this.db.select().from(kbCategories).orderBy(asc(kbCategories.sortOrder), asc(kbCategories.name));
  }

  async get(id: number): Promise<KbCategoryRow | undefined> {
    const [row] = await this.db.select().from(kbCategories).where(eq(kbCategories.id, id));
    return row;
  }

  async create(entry: CreateKbCategoryEntry): Promise<KbCategoryRow> {
    const [row] = await this.db.insert(kbCategories).values(entry).returning();
    return row;
  }

  async update(id: number, entry: UpdateKbCategoryEntry): Promise<KbCategoryRow | undefined> {
    const [row] = await this.db.update(kbCategories).set(entry).where(eq(kbCategories.id, id)).returning();
    return row;
  }

  /** Cascades to kb_resources/kb_chunks and nulls out any kb_announcements
   * pointed at this category (see schema.ts's onDelete rules) — callers
   * should warn the admin before calling this if the category has resources. */
  async delete(id: number): Promise<void> {
    await this.db.delete(kbCategories).where(eq(kbCategories.id, id));
  }
}
