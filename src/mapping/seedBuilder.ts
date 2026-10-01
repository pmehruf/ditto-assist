/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { TOP_PED_DICTIONARY } from "../types.js";
import { normalizeDictionaryKey } from "../engine.js";
import { LEGACY_RULE_SEED } from "./legacyRuleSeed.js";
import type { AliasEntry, MappingSnapshot, RoutingRuleRow } from "./ruleTypes.js";

/**
 * Pure seed derivation for the mapping-control equality migration. Given a
 * snapshot of an environment's mapping tables, works out — per alias — what
 * the LEGACY production behaviour is, and the minimum compatibility controls
 * (routing_enabled / category_key_override / a handful of new PEDs) needed for
 * the DB-backed engine to reproduce it exactly, without deleting or altering
 * any existing ped_repository / ped_aliases data.
 *
 * Legacy production behaviour for the dictionary stage (PED_SOURCE unset →
 * legacy): the advisor's browser classifies first using the compiled
 * TOP_PED_DICTIONARY; only when that yields nothing does the server run, with
 * ped_mapping_overrides merged on top. So, per key: the static value wins;
 * the override value is used only where the static dictionary has no entry.
 */

export const UNMAPPED_SENTINEL = "__unmapped__";

export interface DumpPed {
  id: number;
  pedCode?: string;
  canonicalName: string;
  categoryKey: string | null;
  status: string;
}
export interface DumpAlias {
  id: number;
  pedId: number;
  aliasText: string;
  normalizedAlias: string;
  isPrimary: boolean;
  isVisible: boolean;
}
export interface MappingDump {
  planConfigs: Array<Record<string, any>>;
  categories: Array<{ categoryKey: string; label: string }>;
  pedRepository: DumpPed[];
  pedAliases: DumpAlias[];
  planOverrides: Array<Record<string, any>>;
  planRestrictions: Array<Record<string, any>>;
  pedMappingOverrides: Array<{ pedText: string; category: string }>;
}

/** The legacy dictionary lookup, exactly as classifyDeterministic performs it. */
export function legacyDictionaryLookup(dict: Record<string, string>, cleanInputLower: string): string | undefined {
  let v = dict[cleanInputLower];
  if (!v) {
    const matchedKey = Object.keys(dict).find((k) => k.toLowerCase() === cleanInputLower);
    if (matchedKey) v = dict[matchedKey];
  }
  return v || undefined;
}

/** Every key the legacy dictionary stage can actually be reached with (lowercased, punctuation-free, single-spaced). */
export function reachableLegacyKeys(dict: Record<string, string>): string[] {
  const out = new Set<string>();
  for (const raw of Object.keys(dict)) {
    const lower = raw.toLowerCase();
    if (normalizeDictionaryKey(lower) === lower) out.add(lower);
  }
  return [...out];
}

export interface AliasException {
  normalizedAlias: string;
  aliasId: number | null;
  pedId: number | null;
  /** Alias exists but legacy has no primary category for it while the PED has one → routing_enabled = false. */
  routingEnabled: boolean;
  /** Primary category legacy uses where it differs from the PED's category. */
  categoryOverride: string | null;
  /** Last-resort category (legacy server-leg override that applies only when the browser leg resolved nothing). */
  fallbackCategory: string | null;
  /** Key had no alias row: a new PED + alias is created. */
  newPed: boolean;
  legacyCategory: string | null;
  pedCategory: string | null;
}

export interface SeedPlan {
  /** Browser-leg category per reachable key (the static dictionary). */
  legacyPrimary: Map<string, string>;
  exceptions: AliasException[];
  /** Keys the legacy dictionary resolves that have no alias row yet → new PED + alias rows. */
  newPeds: Array<{ canonicalName: string; aliasText: string; normalizedAlias: string; categoryKey: string | null }>;
  counts: { aliases: number; notRouted: number; categoryOverride: number; fallback: number; newPeds: number; unchanged: number };
}

export function titleCaseKey(key: string): string {
  return key.charAt(0).toUpperCase() + key.slice(1);
}

export function planSeed(dump: MappingDump, staticDict: Record<string, string> = TOP_PED_DICTIONARY): SeedPlan {
  // Server leg dictionary: static + ped_mapping_overrides.
  const merged: Record<string, string> = { ...staticDict };
  for (const o of dump.pedMappingOverrides) merged[normalizeDictionaryKey(o.pedText)] = o.category;

  const pedById = new Map(dump.pedRepository.map((p) => [p.id, p] as const));
  const aliasByKey = new Map(dump.pedAliases.map((a) => [a.normalizedAlias, a] as const));
  const allKeys = new Set<string>([
    ...aliasByKey.keys(),
    ...reachableLegacyKeys(staticDict),
    ...Object.keys(merged).filter((k) => normalizeDictionaryKey(k) === k),
  ]);

  const legacyPrimary = new Map<string, string>();
  const exceptions: AliasException[] = [];
  const newPeds: SeedPlan["newPeds"] = [];
  let unchanged = 0;

  for (const k of [...allKeys].sort()) {
    // Browser leg: static dictionary only.
    const primary = legacyDictionaryLookup(staticDict, k) ?? null;
    if (primary) legacyPrimary.set(k, primary);
    // Server leg (only runs when the browser leg resolved nothing): static + overrides.
    const serverRaw = legacyDictionaryLookup(merged, k) ?? null;
    const server = serverRaw && serverRaw !== UNMAPPED_SENTINEL ? serverRaw : null;
    const fallback = server && server !== primary ? server : null;

    const alias = aliasByKey.get(k);
    if (!alias) {
      if (!primary && !fallback) continue;
      newPeds.push({ canonicalName: titleCaseKey(k), aliasText: titleCaseKey(k), normalizedAlias: k, categoryKey: primary });
      exceptions.push({ normalizedAlias: k, aliasId: null, pedId: null, routingEnabled: true, categoryOverride: null, fallbackCategory: fallback, newPed: true, legacyCategory: primary, pedCategory: null });
      continue;
    }
    const pedCategory = pedById.get(alias.pedId)?.categoryKey ?? null;
    const routingEnabled = !(primary === null && pedCategory !== null);
    const categoryOverride = primary !== null && primary !== pedCategory ? primary : null;
    if (routingEnabled && categoryOverride === null && fallback === null) {
      unchanged++;
      continue;
    }
    exceptions.push({ normalizedAlias: k, aliasId: alias.id, pedId: alias.pedId, routingEnabled, categoryOverride, fallbackCategory: fallback, newPed: false, legacyCategory: primary, pedCategory });
  }

  return {
    legacyPrimary,
    exceptions,
    newPeds,
    counts: {
      aliases: dump.pedAliases.length,
      notRouted: exceptions.filter((e) => !e.newPed && !e.routingEnabled).length,
      categoryOverride: exceptions.filter((e) => !e.newPed && e.categoryOverride !== null).length,
      fallback: exceptions.filter((e) => e.fallbackCategory !== null).length,
      newPeds: newPeds.length,
      unchanged,
    },
  };
}

/** Builds the in-memory runtime snapshot a seeded database would load (used by tests and the equality script). */
export function snapshotFromDump(dump: MappingDump, plan: SeedPlan = planSeed(dump), rules: RoutingRuleRow[] = LEGACY_RULE_SEED): MappingSnapshot {
  const pedById = new Map(dump.pedRepository.map((p) => [p.id, p] as const));
  const exByAlias = new Map(plan.exceptions.filter((e) => !e.newPed).map((e) => [e.normalizedAlias, e] as const));
  const aliases = new Map<string, AliasEntry>();
  for (const a of dump.pedAliases) {
    const ex = exByAlias.get(a.normalizedAlias);
    aliases.set(a.normalizedAlias, {
      pedId: a.pedId,
      pedCategory: pedById.get(a.pedId)?.categoryKey ?? null,
      routingEnabled: ex ? ex.routingEnabled : true,
      categoryOverride: ex?.categoryOverride ?? null,
      fallbackCategory: ex?.fallbackCategory ?? null,
    });
  }
  let syntheticPedId = -1;
  for (const n of plan.newPeds) {
    const ex = plan.exceptions.find((e) => e.newPed && e.normalizedAlias === n.normalizedAlias);
    aliases.set(n.normalizedAlias, { pedId: syntheticPedId--, pedCategory: n.categoryKey, routingEnabled: true, categoryOverride: null, fallbackCategory: ex?.fallbackCategory ?? null });
  }
  return {
    version: 1,
    categoryLabels: new Map(dump.categories.map((c) => [c.categoryKey, c.label] as const)),
    aliases,
    steps: rules.filter((r) => r.enabled).sort((a, b) => a.position - b.position),
  };
}
