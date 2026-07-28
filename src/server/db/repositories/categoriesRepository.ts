/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { asc, eq } from "drizzle-orm";
import type { AnyDb } from "../client.js";
import { categories, type CategoryRow, type NewCategoryRow } from "../schema.js";

export type CreateCategoryEntry = Omit<NewCategoryRow, "createdAt" | "updatedAt">;
export type UpdateCategoryEntry = Partial<Omit<NewCategoryRow, "categoryKey" | "createdAt" | "updatedAt">>;

/**
 * Data Access Layer for `categories` — category (declaration-question-family)
 * definitions. Source of truth for what used to be the hardcoded
 * CATEGORY_LABELS object in types.ts (PED_REPOSITORY_DB_MIGRATION_DESIGN.md
 * §1.1). categoryKey is the primary key, so `upsert` is the normal write
 * path — there is no separate numeric id to look up first.
 */
export class CategoriesRepository {
  constructor(private readonly db: AnyDb) {}

  async list(): Promise<CategoryRow[]> {
    return this.db.select().from(categories).orderBy(asc(categories.sortOrder), asc(categories.categoryKey));
  }

  async get(categoryKey: string): Promise<CategoryRow | undefined> {
    const [row] = await this.db.select().from(categories).where(eq(categories.categoryKey, categoryKey));
    return row;
  }

  /** Returns the full list as a plain { [categoryKey]: label } map, mirroring
   * the shape of the hardcoded CATEGORY_LABELS it replaces — a drop-in for
   * every call site that currently does `CATEGORY_LABELS[key]`. */
  async asLabelMap(): Promise<Record<string, string>> {
    const rows = await this.list();
    const map: Record<string, string> = {};
    for (const row of rows) map[row.categoryKey] = row.label;
    return map;
  }

  async upsert(entry: CreateCategoryEntry): Promise<CategoryRow> {
    const [row] = await this.db
      .insert(categories)
      .values(entry)
      .onConflictDoUpdate({
        target: categories.categoryKey,
        set: { label: entry.label, description: entry.description, sortOrder: entry.sortOrder, updatedAt: new Date() },
      })
      .returning();
    return row;
  }

  async update(categoryKey: string, entry: UpdateCategoryEntry): Promise<CategoryRow | undefined> {
    const [row] = await this.db
      .update(categories)
      .set({ ...entry, updatedAt: new Date() })
      .where(eq(categories.categoryKey, categoryKey))
      .returning();
    return row;
  }

  async delete(categoryKey: string): Promise<void> {
    await this.db.delete(categories).where(eq(categories.categoryKey, categoryKey));
  }
}
