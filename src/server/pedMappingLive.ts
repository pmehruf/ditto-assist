/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { TOP_PED_DICTIONARY, type PlanConfig } from "../types.js";
import { questionForCategory } from "../engine.js";

/**
 * Live PED -> classification mapping helpers, shared by:
 *   - /api/add-ped-mapping (the Lookup page's "teach it" flow — the original
 *     write path this module's pattern is lifted from),
 *   - /api/ped-suggestions POST/PUT/DELETE (the PED Library tab), and
 *   - /api/ai-memory/:id/status (AI Mapping Review's approve action).
 *
 * Pulled into its own module (rather than living inline in server.ts) so it
 * has no Express/DB-client import side effects and can be unit tested
 * directly with fake repository objects — see
 * src/__tests__/pedMappingLive.test.ts.
 */

type PedMappingOverridesRepo = {
  asDictionary: () => Promise<Record<string, string>>;
  upsert: (pedText: string, category: string, addedBy: string) => Promise<unknown>;
  deleteByPedText: (pedText: string) => Promise<void>;
};

// Admin corrections (from any of the three write paths above) are stored in
// ped_mapping_overrides (DB) and layered on top of the hardcoded
// TOP_PED_DICTIONARY (types.ts) so they take effect for every future
// /api/match call without a code change/redeploy. TOP_PED_DICTIONARY is a
// plain, unfrozen object that classifyDeterministic (engine.ts) reads live
// from module scope, so merging overrides into it in place is enough — no
// changes needed inside engine.ts itself. Loaded lazily once per server
// process (not on every request) and refreshed immediately the moment a new
// override is saved.
let pedOverridesLoaded = false;
export async function ensurePedOverridesLoaded(pedMappingOverridesRepo: Pick<PedMappingOverridesRepo, "asDictionary">) {
  if (pedOverridesLoaded) return;
  try {
    const overrides = await pedMappingOverridesRepo.asDictionary();
    Object.assign(TOP_PED_DICTIONARY, overrides);
  } catch (err) {
    console.error("Failed to load PED mapping overrides from DB (continuing with static dictionary only):", err);
  } finally {
    pedOverridesLoaded = true;
  }
}

/** Test-only: resets the module-level "have we loaded overrides yet" latch
 * so each test can start from a clean slate instead of leaking state across
 * cases (production never needs to reset this — it's once-per-process by
 * design). */
export function __resetPedOverridesLoadedForTests() {
  pedOverridesLoaded = false;
}

// Snapshot of the compile-time TOP_PED_DICTIONARY keys, captured at module
// load — BEFORE ensurePedOverridesLoaded ever runs (that only happens lazily
// on the first request that needs it). TOP_PED_DICTIONARY is mutated in
// place once overrides load, so this is the only way to later tell "this key
// came from the hardcoded dictionary in types.ts" apart from "this key only
// ever existed as a DB override" — needed by unmapPedMappingOverride below to
// decide whether deleting a term needs an explicit suppressing override (the
// static entry can't be removed from code at runtime) or can just delete its
// override row outright (nothing left to suppress).
const STATIC_PED_DICTIONARY_KEYS = new Set(Object.keys(TOP_PED_DICTIONARY));

// Sentinel category value: not a real categoryKey (no CATEGORY_LABELS entry,
// never appears in any plan's categoryMap), so engine.ts's 0.7 dictionary
// routing stage finds a truthy `categoryKey` but every specific-case check
// and `questionForCategory` lookup misses, and control falls through to the
// next stage (regex sections, generic shields, eventual AI fallback) exactly
// as if the dictionary had no entry for this PED at all. Used to "delete" a
// PED that's baked into the static TOP_PED_DICTIONARY object in types.ts,
// which can't itself be edited at runtime.
export const UNMAPPED_OVERRIDE_SENTINEL = "__unmapped__";

/**
 * Writes (or overwrites) a live PED -> categoryKey mapping: persists it to
 * ped_mapping_overrides and merges it into the in-memory TOP_PED_DICTIONARY
 * immediately, mirroring what POST /api/add-ped-mapping (the Lookup page's
 * "teach it" flow) has always done. Shared by the PED Library management UI
 * and AI Mapping Review's approve-and-promote flow so both go through one
 * tested write path.
 */
export async function promotePedMappingOverride(
  pedMappingOverridesRepo: Pick<PedMappingOverridesRepo, "asDictionary" | "upsert">,
  pedText: string,
  category: string,
  addedBy: string
): Promise<void> {
  await pedMappingOverridesRepo.upsert(pedText, category, addedBy);
  await ensurePedOverridesLoaded(pedMappingOverridesRepo);
  TOP_PED_DICTIONARY[pedText.trim().toLowerCase()] = category;
}

/**
 * Removes a PED's live mapping. If the term is one of the hardcoded
 * TOP_PED_DICTIONARY entries from types.ts, that entry can't be deleted from
 * code at runtime, so this pins an explicit "unmapped" override on top of it
 * instead (persists across restarts via ensurePedOverridesLoaded). If the
 * term only ever existed as a DB override (never in the static dictionary),
 * the override row is removed outright and the in-memory key deleted.
 */
export async function unmapPedMappingOverride(
  pedMappingOverridesRepo: PedMappingOverridesRepo,
  pedText: string,
  addedBy: string
): Promise<void> {
  const key = pedText.trim().toLowerCase();
  await ensurePedOverridesLoaded(pedMappingOverridesRepo);
  if (STATIC_PED_DICTIONARY_KEYS.has(key)) {
    await pedMappingOverridesRepo.upsert(pedText, UNMAPPED_OVERRIDE_SENTINEL, addedBy);
    TOP_PED_DICTIONARY[key] = UNMAPPED_OVERRIDE_SENTINEL;
  } else {
    await pedMappingOverridesRepo.deleteByPedText(pedText);
    delete TOP_PED_DICTIONARY[key];
  }
}

/**
 * Given a plan's config and a question STRING (as stored on a cached AI
 * answer), finds the single categoryKey that resolves to it, if any. Used to
 * infer a plan-agnostic categoryKey from an AI Mapping Review entry's
 * plan-specific matched_question before promoting it into
 * TOP_PED_DICTIONARY/ped_mapping_overrides — those are read by every plan, so
 * promotion only proceeds when exactly one categoryKey explains the AI's
 * answer (ambiguous or fallback answers are left for manual assignment via
 * the PED Library or the Lookup page's "teach it" flow instead).
 */
export function inferCategoryKeyForQuestion(config: PlanConfig, questionText: string): string | null {
  if (!config?.categoryMap || !questionText) return null;
  const matches = Object.keys(config.categoryMap).filter((key) => questionForCategory(config, key) === questionText);
  return matches.length === 1 ? matches[0] : null;
}
