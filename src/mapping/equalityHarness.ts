/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { TOP_PED_DICTIONARY, type MatchOutput, type PlanConfig } from "../types.js";
import { PED_SYNONYM_GROUPS } from "../constants/pedSynonymGroups.js";
import { COMMON_SMOKE_TEST_PEDS } from "../constants/commonSmokeTestPeds.js";
import {
  applyPostGuards,
  classifyDeterministic,
  finalizeOutput,
  getSmokeTestCases,
  normalizeDictionaryKey,
  sanitizeOutput,
} from "../engine.js";
import { dbRowToPlanConfig, toPlanPedOverrides, toPlanRestrictions } from "../server/planConfigUtils.js";
import { runDeterministicPipeline } from "./routingEngine.js";
import type { MappingSnapshot } from "./ruleTypes.js";
import type { MappingDump } from "./seedBuilder.js";

/**
 * Equality harness for the mapping-control migration (Phase 2).
 *
 * Reproduces what an advisor gets from production TODAY (PED_SOURCE unset →
 * legacy), via the legacy engine (src/engine.ts, untouched): the browser's
 * classification first (compiled dictionary, plan data + fresh plan
 * overrides), and only when that finds nothing the server's (dictionary +
 * ped_mapping_overrides). Then compares it with the data-driven engine.
 */

export interface PairOutcome {
  resolved: boolean;
  match_type: string;
  matched_question: string;
  question_number: number | null;
  /** Everything else finalizeOutput produced (explanation, umbrella recommendations, flags). */
  strict: string;
}

export const UNRESOLVED: PairOutcome = { resolved: false, match_type: "", matched_question: "", question_number: null, strict: "" };

export function outcomeOf(result: MatchOutput | null): PairOutcome {
  if (!result) return UNRESOLVED;
  return {
    resolved: true,
    match_type: result.match_type,
    matched_question: result.matched_question,
    question_number: result.question_number ?? null,
    strict: JSON.stringify({
      explanation: result.explanation,
      secondary_recommendation: result.secondary_recommendation ?? null,
      supporting_flags: result.supporting_flags ?? null,
      confused_questions: result.confused_questions ?? null,
      plan_override: result.plan_override ?? null,
    }),
  };
}

export const primaryKey = (o: PairOutcome) => `${o.resolved ? 1 : 0}|${o.match_type}|${o.matched_question}|${o.question_number ?? ""}`;
export const strictHash = (o: PairOutcome) => createHash("sha1").update(o.strict).digest("hex").slice(0, 12);

// ── plan configs from a dump (same shape server.ts builds per request) ────

export function planConfigsFromDump(dump: MappingDump): Array<{ planName: string; config: PlanConfig }> {
  const pedById = new Map(dump.pedRepository.map((p) => [p.id, p] as const));
  const aliasesByPed = new Map<number, string[]>();
  for (const a of dump.pedAliases) {
    const list = aliasesByPed.get(a.pedId) ?? [];
    list.push(a.normalizedAlias);
    aliasesByPed.set(a.pedId, list);
  }
  return dump.planConfigs
    .filter((row) => !row.removed)
    .map((row) => {
      const config = dbRowToPlanConfig(row as any) as PlanConfig;
      config.restrictions = toPlanRestrictions(dump.planRestrictions.filter((r) => r.planName === row.planName) as any);
      config.pedOverrides = toPlanPedOverrides(
        dump.planOverrides
          .filter((o) => o.planName === row.planName)
          .map((o) => ({ ...o, pedName: pedById.get(o.pedId)?.canonicalName ?? "", aliases: aliasesByPed.get(o.pedId) ?? [] })) as any
      );
      return { planName: row.planName as string, config };
    });
}

// ── legacy oracle ─────────────────────────────────────────────────────────

function runLegacy(ped: string, planName: string, config: PlanConfig): MatchOutput | null {
  let o = classifyDeterministic(ped, planName, config, null);
  if (!o) return null;
  o = sanitizeOutput(o, ped, config);
  o = applyPostGuards(o, ped, planName, config);
  return finalizeOutput(o, ped, config, config.questions);
}

/**
 * Legacy production behaviour for one pair: browser leg first (static
 * dictionary), then — only if that resolves nothing — the server leg (static
 * dictionary + ped_mapping_overrides). The dictionary object is mutated for
 * the server leg and restored.
 */
export function legacyEffectiveFactory(dump: MappingDump) {
  const staticDict = { ...TOP_PED_DICTIONARY };
  const overrides = dump.pedMappingOverrides.map((o) => [normalizeDictionaryKey(o.pedText), o.category] as const);
  return (ped: string, planName: string, config: PlanConfig): PairOutcome => {
    const client = runLegacy(ped, planName, config);
    if (client) return outcomeOf(client);
    for (const [k, v] of overrides) TOP_PED_DICTIONARY[k] = v;
    try {
      return outcomeOf(runLegacy(ped, planName, config));
    } finally {
      for (const [k] of overrides) {
        if (k in staticDict) TOP_PED_DICTIONARY[k] = staticDict[k];
        else delete TOP_PED_DICTIONARY[k];
      }
    }
  };
}

export function newEngineOutcome(ped: string, planName: string, config: PlanConfig, snap: MappingSnapshot): PairOutcome {
  return outcomeOf(runDeterministicPipeline(ped, planName, config, snap).result);
}

// ── corpus ────────────────────────────────────────────────────────────────

/** Regex-alternation probes taken from the legacy engine source, so every hard-coded family is exercised. */
export function regexProbeTerms(engineSourcePath: string): string[] {
  const src = readFileSync(engineSourcePath, "utf8");
  const BS = String.fromCharCode(92);
  const reAlt = new RegExp(BS + "/" + BS + BS + "b" + BS + "(([^)]*?)" + BS + ")" + BS + BS + "b" + BS + "/i", "g");
  const out = new Set<string>();
  for (const m of src.matchAll(reAlt)) {
    for (let alt of m[1].split("|")) {
      alt = alt
        .split(BS + "b").join("")
        .split(BS + "w*").join("")
        .split("[" + BS + "s-]?").join(" ")
        .split(BS + "s*").join(" ")
        .split(BS + "s+").join(" ")
        .split("[- ]?").join(" ")
        .split("?").join("")
        .split(BS).join("")
        .replace(/[()]/g, "")
        .trim();
      if (alt && alt.length > 1 && !/[[\]{}*+^$]/.test(alt)) out.add(alt);
    }
  }
  return [...out];
}

export function baseTerms(dump: MappingDump, engineSourcePath: string): string[] {
  const terms = new Set<string>();
  for (const a of dump.pedAliases) terms.add(a.aliasText);
  for (const k of Object.keys(TOP_PED_DICTIONARY)) terms.add(k);
  for (const g of PED_SYNONYM_GROUPS) for (const t of g) terms.add(t);
  for (const t of COMMON_SMOKE_TEST_PEDS) terms.add(t);
  for (const c of getSmokeTestCases()) terms.add(c.ped);
  for (const t of regexProbeTerms(engineSourcePath)) terms.add(t);
  return [...terms].sort();
}

/** Generated variants exercising normalisation, free-text and substring paths. */
export function variantTerms(base: string[]): string[] {
  const out = new Set<string>();
  for (const t of base) {
    out.add(t.toUpperCase());
    out.add(`history of ${t}`);
    out.add(`${t} since 2019`);
    out.add(`${t}.`);
  }
  for (const t of base) out.delete(t);
  return [...out].sort();
}

/** Deterministic (seeded) compound terms — two conditions in one entry — to exercise stage precedence on free text. */
export function compoundTerms(base: string[], count: number, seed = 12345): string[] {
  let x = seed >>> 0;
  const next = () => {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
    return x / 0x100000000;
  };
  const joiners = [" and ", ", ", " with ", " / ", " after "];
  const out = new Set<string>();
  while (out.size < count) {
    const a = base[Math.floor(next() * base.length)];
    const b = base[Math.floor(next() * base.length)];
    if (a !== b) out.add(a + joiners[Math.floor(next() * joiners.length)] + b);
  }
  return [...out].sort();
}

export function sha1(text: string): string {
  return createHash("sha1").update(text).digest("hex");
}
