/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { asc, eq } from "drizzle-orm";
import type { AnyDb } from "../client.js";
import { pedAliases, type PedAliasRow, type NewPedAliasRow } from "../schema.js";
import { normalizeDictionaryKey } from "../../../mapping/helpers.js";

export type CreatePedAliasEntry = Omit<NewPedAliasRow, "id" | "normalizedAlias" | "createdAt">;

/**
 * Data Access Layer for `ped_aliases` — every searchable text variant for a
 * `ped_repository` row (PED_REPOSITORY_DB_MIGRATION_DESIGN.md §1.3).
 * `normalizedAlias` is always derived here via `normalizeDictionaryKey` —
 * the exact same normalization the routing engine's dictionary stage
 * uses at lookup time — never passed in by the caller, so it can't drift
 * out of sync the way the pre-migration override tables once did (see the
 * punctuation-normalization bug fixed earlier this project).
 */
export class PedAliasesRepository {
  constructor(private readonly db: AnyDb) {}

  async listByPed(pedId: number): Promise<PedAliasRow[]> {
    return this.db.select().from(pedAliases).where(eq(pedAliases.pedId, pedId)).orderBy(asc(pedAliases.aliasText));
  }

  async getByNormalizedAlias(normalizedAlias: string): Promise<PedAliasRow | undefined> {
    const [row] = await this.db.select().from(pedAliases).where(eq(pedAliases.normalizedAlias, normalizedAlias));
    return row;
  }

  async get(id: number): Promise<PedAliasRow | undefined> {
    const [row] = await this.db.select().from(pedAliases).where(eq(pedAliases.id, id));
    return row;
  }

  /** Every alias row, joined to nothing — used to build the full in-memory
   * runtime lookup Map (normalizedAlias -> { pedId }) at boot. */
  async listAll(): Promise<PedAliasRow[]> {
    return this.db.select().from(pedAliases);
  }

  /**
   * Throws (via the DB's unique constraint on normalized_alias) if this
   * exact normalized text already belongs to a different PED — that
   * collision must be surfaced to the caller as an Alias Collision, never
   * silently overwritten or merged.
   */
  async create(entry: CreatePedAliasEntry): Promise<PedAliasRow> {
    const [row] = await this.db
      .insert(pedAliases)
      .values({ ...entry, normalizedAlias: normalizeDictionaryKey(entry.aliasText) })
      .returning();
    return row;
  }

  async delete(id: number): Promise<void> {
    await this.db.delete(pedAliases).where(eq(pedAliases.id, id));
  }

  async deleteByPed(pedId: number): Promise<void> {
    await this.db.delete(pedAliases).where(eq(pedAliases.pedId, pedId));
  }

  /**
   * Governance rules (2026-07-28): flips an alias between a genuine,
   * user-facing entry and a hidden normalization-only entry (misspellings,
   * verb-form variants like "Cystoscopy done"). Never touches
   * `normalizedAlias`, so matching is unaffected either way — only what an
   * admin UI should list.
   */
  async setVisibility(id: number, isVisible: boolean): Promise<PedAliasRow | undefined> {
    const [row] = await this.db.update(pedAliases).set({ isVisible }).where(eq(pedAliases.id, id)).returning();
    return row;
  }

  /**
   * Sets an alias's mapping-control compatibility controls (see schema.ts's
   * ped_aliases doc comment for their precedence). Only the fields present in
   * `controls` are changed; `null` clears an override.
   */
  async setRoutingControls(
    id: number,
    controls: { routingEnabled?: boolean; categoryKeyOverride?: string | null; fallbackCategoryKey?: string | null }
  ): Promise<PedAliasRow | undefined> {
    const set: Partial<NewPedAliasRow> = {};
    if (controls.routingEnabled !== undefined) set.routingEnabled = controls.routingEnabled;
    if (controls.categoryKeyOverride !== undefined) set.categoryKeyOverride = controls.categoryKeyOverride;
    if (controls.fallbackCategoryKey !== undefined) set.fallbackCategoryKey = controls.fallbackCategoryKey;
    if (Object.keys(set).length === 0) return this.get(id);
    const [row] = await this.db.update(pedAliases).set(set).where(eq(pedAliases.id, id)).returning();
    return row;
  }

  /** Flips which alias row is flagged primary for its PED (informational —
   * mirrors `canonicalName` by convention at seed time; not read by
   * the routing engine, which only ever keys off `normalizedAlias`). */
  async setPrimary(id: number, isPrimary: boolean): Promise<PedAliasRow | undefined> {
    const [row] = await this.db.update(pedAliases).set({ isPrimary }).where(eq(pedAliases.id, id)).returning();
    return row;
  }

  /** Sets exactly one alias as primary for a PED — clears every other alias
   * of that PED first, in the same transaction, so two rows can never both
   * be flagged primary at once. */
  async setPrimaryExclusive(pedId: number, aliasId: number): Promise<PedAliasRow | undefined> {
    return this.db.transaction(async (tx) => {
      await tx.update(pedAliases).set({ isPrimary: false }).where(eq(pedAliases.pedId, pedId));
      const [row] = await tx.update(pedAliases).set({ isPrimary: true }).where(eq(pedAliases.id, aliasId)).returning();
      return row;
    });
  }

  /** Every alias marked visible for a given PED — the UI-facing subset of
   * `listByPed`, for dropdowns/search suggestions/lookup results. */
  async listVisibleByPed(pedId: number): Promise<PedAliasRow[]> {
    const all = await this.listByPed(pedId);
    return all.filter((a) => a.isVisible);
  }

  /**
   * Updates an alias row's display text (e.g. fixing "Weils disease" to the
   * correctly-apostrophized "Weil's disease"). Recomputes `normalizedAlias`
   * from the new text — a no-op when, as is usually the case here, the new
   * text normalizes identically to the old one (normalizeDictionaryKey
   * strips punctuation, so an apostrophe fix never actually changes the
   * lookup key).
   */
  async updateAliasText(id: number, aliasText: string): Promise<PedAliasRow | undefined> {
    const [row] = await this.db
      .update(pedAliases)
      .set({ aliasText, normalizedAlias: normalizeDictionaryKey(aliasText) })
      .where(eq(pedAliases.id, id))
      .returning();
    return row;
  }

  /**
   * Re-points an existing alias row at a different PED — used by entity
   * merges (two ped_repository rows later found to describe the same
   * condition, e.g. "Nephrectomy" and "Nephrectomy history"). Never touches
   * `normalizedAlias`, so this can still throw the same unique-constraint
   * error a `create` would if the target PED already has an alias with this
   * exact normalized text — callers should catch and skip, not assume this
   * always succeeds.
   */
  async reassignPed(id: number, newPedId: number): Promise<PedAliasRow | undefined> {
    const [row] = await this.db.update(pedAliases).set({ pedId: newPedId }).where(eq(pedAliases.id, id)).returning();
    return row;
  }
}
