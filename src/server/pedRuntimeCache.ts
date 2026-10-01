/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Repositories } from "./db/repositories/index.js";

/**
 * DB-backed runtime cache for the PED Repository migration, Phase 3
 * (PED_REPOSITORY_DB_MIGRATION_DESIGN.md §4). Mirrors the exact pattern
 * `pedMappingLive.ts` already uses for `ped_mapping_overrides` +
 * `TOP_PED_DICTIONARY` — lazy, once-per-process load into module-level
 * state, updated in place on every write, read synchronously by
 * `classifyDeterministic` (engine.ts) so the matching engine stays a pure,
 * synchronous function with zero per-lookup DB round-trips.
 *
 * INERT BY DEFAULT: nothing in this module runs unless something calls
 * `ensurePedRuntimeCacheLoaded`, and nothing calls that unless the
 * `PED_SOURCE=db` feature flag is set (see server.ts). The legacy path
 * (TOP_PED_DICTIONARY + the 4 hardcoded plan-specific blocks in engine.ts)
 * is completely untouched by this module and remains the default/fallback
 * implementation until Phase 4 validation + Checkpoint B are complete and
 * the flag is deliberately flipped.
 *
 * Update (2026-07-29): the gap described below is closed for the PED
 * Repository admin UI. `src/server/pedRepositoryLive.ts` now calls every
 * mutator below (`updateDbAliasCache`, `removeDbAliasCache`,
 * `updateDbPedCategoryCache`, `updateDbPlanOverrideCache`,
 * `removeDbPlanOverrideCache`) on every PED/alias write from the "PED
 * Repository" admin page (`src/components/PedRepositoryManagement.tsx`),
 * so this cache stays in sync with the DB without a restart. Each of those
 * writes also mirrors into the legacy `ped_mapping_overrides` table (see
 * pedMappingLive.ts) as `PED_SOURCE=legacy` rollback insurance. AI Mapping
 * Review's approve/reject flow still writes ONLY to the legacy table
 * (unchanged) — extending it to also write here remains open, see below.
 *
 * Original gap note, left for history: "there is currently no UI write path
 * that touches ped_repository / ped_aliases / plan_overrides at all — those
 * tables are populated once by scripts/seedPedRepository.ts --apply and
 * otherwise static. PED Library / AI Mapping Review edits today only write
 * to the legacy ped_mapping_overrides table (see pedMappingLive.ts), which
 * this DB-backed cache does NOT consult. [...] wiring PED Library / AI
 * Mapping Review to also write into the new tables is a separate decision,
 * out of scope for 'wire the runtime engine so it can read' (this phase)."
 *
 * SUPERSEDED (2026-07-29): the PED Repository admin page now writes
 * ped_repository/ped_aliases directly — the gap above is closed and
 * scripts/seedPedRepository.ts (the one-time seed script referenced in the
 * historical note) has been removed as no longer needed.
 * — "PED Library" (the term the original note used) is what's now wired;
 * AI Mapping Review is not, and `updateDbPlanOverrideCache`/
 * `removeDbPlanOverrideCache` are still unused (no `plan_overrides` admin UI
 * exists yet — see PED_REPOSITORY_MIGRATION_COMPLETION_REPORT.md §7/§8).
 */

export interface DbAliasEntry {
  pedId: number;
  categoryKey: string | null;
}

export interface DbPlanOverrideEntry {
  categoryKey: string | null;
  reason: string | null;
}

type CacheRepos = Pick<Repositories, "pedAliases" | "pedRepository" | "categories" | "planOverrides">;

let aliasMap = new Map<string, DbAliasEntry>();
let categoryLabelMap = new Map<string, string>();
let planOverrideMap = new Map<string, DbPlanOverrideEntry>();
let loaded = false;
let loadPromise: Promise<void> | null = null;

function planOverrideKey(planName: string, pedId: number): string {
  return `${planName}::${pedId}`;
}

async function loadInternal(repos: CacheRepos): Promise<void> {
  const [aliasRows, pedRows, categoryRows, overrideRows] = await Promise.all([
    repos.pedAliases.listAll(),
    repos.pedRepository.list(),
    repos.categories.list(),
    repos.planOverrides.listAll(),
  ]);

  const categoryByPedId = new Map(pedRows.map((p) => [p.id, p.categoryKey] as const));

  const newAliasMap = new Map<string, DbAliasEntry>();
  for (const a of aliasRows) {
    newAliasMap.set(a.normalizedAlias, { pedId: a.pedId, categoryKey: categoryByPedId.get(a.pedId) ?? null });
  }

  const newCategoryLabelMap = new Map<string, string>();
  for (const c of categoryRows) newCategoryLabelMap.set(c.categoryKey, c.label);

  const newPlanOverrideMap = new Map<string, DbPlanOverrideEntry>();
  for (const o of overrideRows) {
    newPlanOverrideMap.set(planOverrideKey(o.planName, o.pedId), { categoryKey: o.categoryKey, reason: o.reason });
  }

  aliasMap = newAliasMap;
  categoryLabelMap = newCategoryLabelMap;
  planOverrideMap = newPlanOverrideMap;
}

/**
 * Loads the full DB-backed cache once per process. Safe to call from every
 * request (same convention as `ensurePedOverridesLoaded`) — a no-op after
 * the first successful load. Concurrent callers during the very first load
 * share one in-flight promise rather than issuing duplicate queries.
 */
export async function ensurePedRuntimeCacheLoaded(repos: CacheRepos): Promise<void> {
  if (loaded) return;
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    try {
      await loadInternal(repos);
    } catch (err) {
      console.error("Failed to load DB-backed PED runtime cache (PED_SOURCE=db will see an empty cache):", err);
    } finally {
      loaded = true;
      loadPromise = null;
    }
  })();
  return loadPromise;
}

/** Test-only: resets the module-level "have we loaded yet" latch, mirroring
 * `__resetPedOverridesLoadedForTests` in pedMappingLive.ts. */
export function __resetPedRuntimeCacheForTests(): void {
  loaded = false;
  loadPromise = null;
  aliasMap = new Map();
  categoryLabelMap = new Map();
  planOverrideMap = new Map();
}

/** The alias lookup Map handed to `classifyDeterministic` when
 * `PED_SOURCE=db`. `undefined`/empty until `ensurePedRuntimeCacheLoaded`
 * has run at least once. */
export function getDbAliasLookup(): Map<string, DbAliasEntry> {
  return aliasMap;
}

export function getDbCategoryLabel(categoryKey: string): string | undefined {
  return categoryLabelMap.get(categoryKey);
}

/** The plan-override lookup function handed to `classifyDeterministic` when
 * `PED_SOURCE=db` — deliberately a function (not the raw Map) so engine.ts
 * never needs to know this module's internal key format. */
export function planOverrideLookup(planName: string, pedId: number): DbPlanOverrideEntry | null {
  return planOverrideMap.get(planOverrideKey(planName, pedId)) ?? null;
}

// ─────────────────────────────────────────────────────────────────────────
// Update-on-write mutators. Not called by anything yet (see the "Known gap"
// note above) — built so wiring a future write path is a one-line call,
// not a new cache-invalidation design.
// ─────────────────────────────────────────────────────────────────────────

/** Call after a `ped_aliases` row is created (or a PED's category changes,
 * for its primary alias) to keep the cache in sync without a full reload. */
export function updateDbAliasCache(normalizedAlias: string, pedId: number, categoryKey: string | null): void {
  aliasMap.set(normalizedAlias, { pedId, categoryKey });
}

/** Call after a `ped_aliases` row is deleted. */
export function removeDbAliasCache(normalizedAlias: string): void {
  aliasMap.delete(normalizedAlias);
}

/** Call after a `ped_repository` row's `categoryKey` changes — every alias
 * currently cached for this PED needs its `categoryKey` refreshed, since
 * the alias cache denormalizes the PED's category onto each alias entry
 * for O(1) lookup. A linear scan over the (currently ~1,200-row) alias
 * cache is cheap for an infrequent admin edit; not worth a secondary
 * pedId->normalizedAlias[] index for this volume. */
export function updateDbPedCategoryCache(pedId: number, categoryKey: string | null): void {
  for (const [key, entry] of aliasMap) {
    if (entry.pedId === pedId) aliasMap.set(key, { ...entry, categoryKey });
  }
}

/** Call after a `categories` row is upserted. */
export function updateDbCategoryLabelCache(categoryKey: string, label: string): void {
  categoryLabelMap.set(categoryKey, label);
}

/** Call after a `plan_overrides` row is upserted. */
export function updateDbPlanOverrideCache(planName: string, pedId: number, categoryKey: string | null, reason: string | null): void {
  planOverrideMap.set(planOverrideKey(planName, pedId), { categoryKey, reason });
}

/** Call after a `plan_overrides` row is deleted. */
export function removeDbPlanOverrideCache(planName: string, pedId: number): void {
  planOverrideMap.delete(planOverrideKey(planName, pedId));
}
