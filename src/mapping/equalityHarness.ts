/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { createHash } from "node:crypto";
import type { MatchOutput, PlanConfig } from "../types.js";
import { dbRowToPlanConfig, toPlanPedOverrides, toPlanRestrictions } from "../server/planConfigUtils.js";
import { runDeterministicPipeline } from "./routingEngine.js";
import type { MappingSnapshot } from "./ruleTypes.js";
import type { MappingDump } from "./seedBuilder.js";

/**
 * Regression harness for the data-driven mapping engine.
 *
 * Computes the outcome of one (condition, plan) pair with the data-driven engine in a comparable form, and builds the
 * (condition, plan) corpus the frozen baselines cover. The frozen baselines (src/__tests__/fixtures/mapping/) were
 * produced by the original hard-coded engine during the Phase 2 migration; that engine has been removed (Phase 6) and
 * the baselines are now the regression oracle.
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
      // The frozen baselines were captured before the closing advice said "Declaration Guide" instead of "Declaration Framework"
      // (an intentional wording change, 2026-10-08). Comparing with the old name keeps every other character of the text checked.
      explanation: result.explanation?.split("Declaration Guide").join("Declaration Framework"),
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

export function newEngineOutcome(ped: string, planName: string, config: PlanConfig, snap: MappingSnapshot): PairOutcome {
  return outcomeOf(runDeterministicPipeline(ped, planName, config, snap).result);
}

// ── corpus ────────────────────────────────────────────────────────────────

/**
 * The (condition) corpus for a dump: every term of the frozen baseline plus every alias text of the dump, so conditions
 * added after the baseline was frozen are covered too. The frozen terms are the union of the original corpus (aliases,
 * the compiled dictionary, synonym groups, smoke-test conditions, regex-alternation probes, generated variants and
 * compound conditions) fixed at the Phase 2 migration.
 */
export function corpusTerms(dump: MappingDump, frozenTerms: string[]): string[] {
  const terms = new Set<string>(frozenTerms);
  for (const a of dump.pedAliases) terms.add(a.aliasText);
  return [...terms].sort();
}

export function sha1(text: string): string {
  return createHash("sha1").update(text).digest("hex");
}
