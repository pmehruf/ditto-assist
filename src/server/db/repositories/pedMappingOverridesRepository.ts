/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { asc, eq } from "drizzle-orm";
import type { AnyDb } from "../client.js";
import { pedMappingOverrides, type PedMappingOverrideRow } from "../schema.js";

/**
 * Data Access Layer for admin-curated PED -> category corrections that sit
 * on top of the hardcoded TOP_PED_DICTIONARY (types.ts). Checked *before*
 * the static dictionary in /api/match so an admin's correction takes effect
 * for every future search of that exact PED text, without a code change.
 */
export class PedMappingOverridesRepository {
  constructor(private readonly db: AnyDb) {}

  async list(): Promise<PedMappingOverrideRow[]> {
    return this.db.select().from(pedMappingOverrides).orderBy(asc(pedMappingOverrides.pedText));
  }

  /** Returns the full list as a plain { [normalizedPedText]: category } map,
   * ready to be spread on top of TOP_PED_DICTIONARY. */
  async asDictionary(): Promise<Record<string, string>> {
    const rows = await this.list();
    const dict: Record<string, string> = {};
    for (const row of rows) dict[row.pedText] = row.category;
    return dict;
  }

  async upsert(pedText: string, category: string, addedBy: string): Promise<PedMappingOverrideRow> {
    const normalized = pedText.trim().toLowerCase();
    const [row] = await this.db
      .insert(pedMappingOverrides)
      .values({ pedText: normalized, category, addedBy })
      .onConflictDoUpdate({
        target: pedMappingOverrides.pedText,
        set: { category, addedBy },
      })
      .returning();
    return row;
  }

  async delete(id: number): Promise<void> {
    await this.db.delete(pedMappingOverrides).where(eq(pedMappingOverrides.id, id));
  }

  /** Same normalization as upsert() — lets callers unmap/remove an override
   * by the PED text itself (e.g. "Diabetes") without needing its row id
   * looked up first. No-op if no override exists for that text. */
  async deleteByPedText(pedText: string): Promise<void> {
    const normalized = pedText.trim().toLowerCase();
    await this.db.delete(pedMappingOverrides).where(eq(pedMappingOverrides.pedText, normalized));
  }
}
