/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { asc, eq } from "drizzle-orm";
import type { AnyDb } from "../client.js";
import { pedMappingOverrides, type PedMappingOverrideRow } from "../schema.js";
import { normalizeDictionaryKey } from "../../../mapping/helpers.js";

/**
 * Data Access Layer for admin-curated PED -> category corrections that sit
 * on top of the hardcoded TOP_PED_DICTIONARY (types.ts). Checked *before*
 * the static dictionary in /api/match so an admin's correction takes effect
 * for every future search of that exact PED text, without a code change.
 *
 * Normalization here MUST exactly match the routing engine (src/mapping)'s dictionary-routing
 * lookup key (normalizeDictionaryKey: lowercased, punctuation deleted,
 * whitespace collapsed) — not just trim+lowercase. A row stored under the
 * wrong normalization (e.g. "c-section" with the hyphen kept) is silently
 * unreachable: the routing engine looks up "csection" and never finds it,
 * so the override appears to do nothing even though it saved successfully.
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
    const normalized = normalizeDictionaryKey(pedText);
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
    const normalized = normalizeDictionaryKey(pedText);
    await this.db.delete(pedMappingOverrides).where(eq(pedMappingOverrides.pedText, normalized));
  }
}
