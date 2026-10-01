/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { PlanConfig } from "../types.js";
import { normalizeDictionaryKey } from "../engine.js";
import { runDeterministicPipeline } from "./routingEngine.js";
import type { MappingSnapshot } from "./ruleTypes.js";

/**
 * Impact analysis for admin mapping changes (Phase 3B-i).
 *
 * A "world" is everything the deterministic engine reads: the mapping snapshot
 * (aliases, categories, rules) and each plan's config. Impact = run the SAME
 * engine over a corpus of terms × plans on the world before a change and on the
 * world after it, and compare. Nothing is modelled or approximated: the "after"
 * world is built from the real post-change data, so what the preview shows is
 * exactly what saving will do.
 *
 * Tiers follow the product's priority ladder (src/utils/matchTier.ts, Constitution
 * Part IV): P0 direct (exact wording, plan-specific PED overrides) → P1 category
 * (deterministic) → P2 category (AI-found; never produced by this engine) →
 * P3 fallback (umbrella / Others). A question that names the condition (specific)
 * outranks the broader catch-all, so losing specificity is treated as the most
 * serious kind of change.
 */

export interface World {
  snapshot: MappingSnapshot;
  plans: Map<string, PlanConfig>;
}

export type Tier = "P0" | "P1" | "P3" | "NON_AILMENT" | "UNRESOLVED";

export interface PairOutcome {
  resolved: boolean;
  matchType: string | null;
  question: string | null;
  decidedBy: string;
  /** True when the question is the plan's specific question for this condition (not the catch-all). */
  specific: boolean;
  tier: Tier;
}

export interface ChangedPair {
  plan: string;
  term: string;
  before: PairOutcome;
  after: PairOutcome;
}

const SEP = "\u0000";

function toOutcome(term: string, plan: string, config: PlanConfig, snapshot: MappingSnapshot): PairOutcome {
  const { result, trace } = runDeterministicPipeline(term, plan, config, snapshot);
  if (!result) return { resolved: false, matchType: null, question: null, decidedBy: "unresolved", specific: false, tier: "UNRESOLVED" };
  const isOverride = trace.decidedBy === "primitive.plan_override";
  const tier: Tier = isOverride || result.match_type === "P0" ? "P0" : result.match_type === "P1" || result.match_type === "P2" ? "P1" : result.match_type === "NON_AILMENT" ? "NON_AILMENT" : "P3";
  const specific = !!result.matched_question && result.matched_question !== config.anyOther && (result.match_type === "P0" || result.match_type === "P1" || result.match_type === "P2");
  return { resolved: true, matchType: result.match_type, question: result.matched_question, decidedBy: trace.decidedBy, specific, tier };
}

/** Runs the engine for every (plan, term) in the corpus. Key = `${plan}\0${term}`. */
export function evaluateWorld(world: World, terms: string[], planNames: string[]): Map<string, PairOutcome> {
  const out = new Map<string, PairOutcome>();
  for (const plan of planNames) {
    const config = world.plans.get(plan);
    if (!config) continue;
    for (const term of terms) out.set(plan + SEP + term, toOutcome(term, plan, config, world.snapshot));
  }
  return out;
}

const sameResult = (a: PairOutcome, b: PairOutcome) => a.resolved === b.resolved && a.matchType === b.matchType && a.question === b.question;

export function diffOutcomes(before: Map<string, PairOutcome>, after: Map<string, PairOutcome>): ChangedPair[] {
  const changed: ChangedPair[] = [];
  for (const [key, b] of before) {
    const a = after.get(key);
    if (!a || sameResult(a, b)) continue;
    const [plan, term] = key.split(SEP);
    changed.push({ plan, term, before: b, after: a });
  }
  return changed;
}

// ── metrics ───────────────────────────────────────────────────────────────
//
// DEFINITIONS (identical for preview, tier classification, confirmation and the audit record):
//  - The CORPUS is every alias in the mapping (before or after the change) plus every distinct
//    spelling advisors searched in the last 90 days (top 5,000 by volume). Each spelling is run
//    through the engine, because rules can treat spellings differently.
//  - A "changed lookup" is a distinct (plan, normalized term) whose answer — resolved or not, match
//    type, question — differs after the change. Spellings that normalize to the same dictionary key
//    count ONCE (the most serious variant represents them). So 2 spellings x 6 plans = 6 lookups, not 12.
//  - "Advisor lookups affected" is the number of actual search_history rows (last 90 days, repeats
//    included) for those distinct changed (plan, normalized term) pairs. A distinct pair is never counted twice.
//  - pairsCompared = plans compared x distinct normalized corpus terms.
//  - The confirmation hash covers the exact set of changed (plan, spelling) answers (before/after
//    question and match type), so it is stricter than the counts, never looser.

export interface ImpactMetrics {
  /** Corpus size actually compared. */
  pairsCompared: number;
  pairsChanged: number;
  termsChanged: number;
  plansAffected: number;
  /** A direct (P0 / plan-override) outcome was involved before or after. */
  p0Changed: number;
  /** Was answered deterministically, would now go to AI Memory / the model. */
  resolvedToUnresolved: number;
  unresolvedToResolved: number;
  /** Had a specific question, would now land on Others / the catch-all (still answered by the rules; unresolved is counted separately below). */
  specificityLoss: number;
  /** Was Others / unresolved, would now get a specific question. */
  specificityGain: number;
  /** Specific question → a different specific question. */
  questionSwap: number;
  /** Advisor lookups (last 90 days) of the changed (plan, term) pairs. */
  advisorLookupsAffected: number;
  /** Changed pairs advisors actually searched in the last 90 days. */
  advisorPairsAffected: number;
  /** by "fromTier→toTier" */
  transitions: Record<string, number>;
  byPlan: Record<string, number>;
}

export interface Usage {
  /** normalizeDictionaryKey(term) → lookups in the last 90 days (all plans). */
  byTerm: Record<string, number>;
  /** `${plan}||${normalizedTerm}` → lookups in the last 90 days. */
  byPair: Record<string, number>;
}

const severity = (c: ChangedPair): number =>
  (c.before.tier === "P0" || c.after.tier === "P0" ? 1000 : 0) + (c.before.specific && !c.after.specific ? 500 : 0) + (c.before.resolved && !c.after.resolved ? 400 : 0) + (c.after.specific ? 10 : 0);

/** One representative (the most serious) per distinct (plan, normalized term). */
export function dedupeByNormalizedTerm(changed: ChangedPair[]): ChangedPair[] {
  const best = new Map<string, ChangedPair>();
  for (const c of changed) {
    const key = `${c.plan}||${normalizeDictionaryKey(c.term)}`;
    const cur = best.get(key);
    if (!cur || severity(c) > severity(cur)) best.set(key, c);
  }
  return [...best.values()];
}

/** `changed` must already be deduplicated (see dedupeByNormalizedTerm). */
export function computeMetrics(changed: ChangedPair[], pairsCompared: number, usage?: Usage): ImpactMetrics {
  const m: ImpactMetrics = {
    pairsCompared,
    pairsChanged: changed.length,
    termsChanged: new Set(changed.map((c) => normalizeDictionaryKey(c.term))).size,
    plansAffected: new Set(changed.map((c) => c.plan)).size,
    p0Changed: 0,
    resolvedToUnresolved: 0,
    unresolvedToResolved: 0,
    specificityLoss: 0,
    specificityGain: 0,
    questionSwap: 0,
    advisorLookupsAffected: 0,
    advisorPairsAffected: 0,
    transitions: {},
    byPlan: {},
  };
  for (const c of changed) {
    if (c.before.tier === "P0" || c.after.tier === "P0") m.p0Changed++;
    if (c.before.resolved && !c.after.resolved) m.resolvedToUnresolved++;
    if (!c.before.resolved && c.after.resolved) m.unresolvedToResolved++;
    if (c.before.specific && !c.after.specific && c.after.resolved) m.specificityLoss++;
    else if (!c.before.specific && c.after.specific) m.specificityGain++;
    else if (c.before.specific && c.after.specific) m.questionSwap++;
    const t = `${c.before.tier}→${c.after.tier}`;
    m.transitions[t] = (m.transitions[t] ?? 0) + 1;
    m.byPlan[c.plan] = (m.byPlan[c.plan] ?? 0) + 1;
    const used = usage?.byPair[`${c.plan}||${normalizeDictionaryKey(c.term)}`] ?? 0;
    if (used > 0) {
      m.advisorPairsAffected++;
      m.advisorLookupsAffected += used;
    }
  }
  return m;
}

// ── classification ───────────────────────────────────────────────────────

export type ImpactTier = "none" | "low" | "elevated" | "high";

/**
 * Thresholds derived from production behaviour (see docs/MAPPING_CONTROL_PHASE3B.md,
 * "How the thresholds were chosen"): they are set against the distribution of what
 * an ordinary single-PED edit changes on production data, and against real advisor
 * usage — not an arbitrary round number.
 */
export interface ImpactThresholds {
  /** Largest number of changed pairs still treated as an ordinary, low-impact edit. */
  lowMaxPairs: number;
  /** Above this many changed pairs the change is "high" regardless of other signals. */
  highMinPairs: number;
  /** Advisor lookups (90 days) affected at or above which the change is at least elevated. */
  elevatedAdvisorLookups: number;
  /** …and at or above which it is high. */
  highAdvisorLookups: number;
  /** Changed in more plans than this → at least elevated. */
  lowMaxPlans: number;
}

export const IMPACT_THRESHOLDS: ImpactThresholds = {
  lowMaxPairs: 12,
  highMinPairs: 60,
  elevatedAdvisorLookups: 15,
  highAdvisorLookups: 120,
  lowMaxPlans: 6,
};

export interface ImpactClassification {
  tier: ImpactTier;
  /** Plain-language reasons the tier is what it is (shown to the admin). */
  reasons: string[];
}

export function classifyImpact(m: ImpactMetrics, t: ImpactThresholds = IMPACT_THRESHOLDS): ImpactClassification {
  if (m.pairsChanged === 0) return { tier: "none", reasons: [] };
  const high: string[] = [];
  const elevated: string[] = [];
  // Wording/specificity safety: a direct match changing, a specific question lost, or a lookup that
  // would now need the AI are never ordinary edits.
  if (m.p0Changed > 0) high.push(`${m.p0Changed} direct-match (exact wording or plan-specific) result${m.p0Changed === 1 ? "" : "s"} would change`);
  if (m.specificityLoss > 0) high.push(`${m.specificityLoss} lookup${m.specificityLoss === 1 ? "" : "s"} would lose a specific question and fall back to Others`);
  if (m.resolvedToUnresolved > 0) high.push(`${m.resolvedToUnresolved} lookup${m.resolvedToUnresolved === 1 ? "" : "s"} would no longer be answered by the rules and would go to the AI step`);
  if (m.pairsChanged >= t.highMinPairs) high.push(`${m.pairsChanged} lookups would change`);
  if (m.advisorLookupsAffected >= t.highAdvisorLookups) high.push(`advisors made ${m.advisorLookupsAffected} lookups of these in the last 90 days`);
  if (high.length) return { tier: "high", reasons: high };

  if (m.pairsChanged > t.lowMaxPairs) elevated.push(`${m.pairsChanged} lookups would change`);
  if (m.plansAffected > t.lowMaxPlans) elevated.push(`${m.plansAffected} plans affected`);
  if (m.advisorLookupsAffected >= t.elevatedAdvisorLookups) elevated.push(`advisors made ${m.advisorLookupsAffected} lookups of these in the last 90 days`);
  if (m.questionSwap > 0 && m.pairsChanged > Math.ceil(t.lowMaxPairs / 2)) elevated.push(`${m.questionSwap} lookups would move to a different specific question`);
  if (elevated.length) return { tier: "elevated", reasons: elevated };
  return { tier: "low", reasons: [] };
}

export interface ImpactReport {
  tier: ImpactTier;
  reasons: string[];
  metrics: ImpactMetrics;
  /** Up to `sampleLimit` changed pairs, most serious first. */
  sample: ChangedPair[];
  plansAdded: string[];
  plansRemoved: string[];
  /** Stable text over every changed (plan, spelling) answer; its hash is what an admin confirms. */
  fingerprint: string;
}


/** Full comparison of two worlds over a corpus. */
export function compareWorlds(before: World, after: World, terms: string[], usage?: Usage, sampleLimit = 25, thresholds: ImpactThresholds = IMPACT_THRESHOLDS): ImpactReport {
  const bPlans = [...before.plans.keys()];
  const aPlans = [...after.plans.keys()];
  const shared = bPlans.filter((p) => after.plans.has(p));
  const b = evaluateWorld(before, terms, shared);
  const a = evaluateWorld(after, terms, shared);
  const changedAll = diffOutcomes(b, a);
  const changed = dedupeByNormalizedTerm(changedAll);
  const distinctTerms = new Set(terms.map((t) => normalizeDictionaryKey(t))).size;
  const metrics = computeMetrics(changed, shared.length * distinctTerms, usage);
  const cls = classifyImpact(metrics, thresholds);
  const sample = [...changed].sort((x, y) => severity(y) - severity(x)).slice(0, sampleLimit);
  return { tier: cls.tier, reasons: cls.reasons, metrics, sample, plansAdded: aPlans.filter((p) => !before.plans.has(p)), plansRemoved: bPlans.filter((p) => !after.plans.has(p)), fingerprint: changeFingerprint(changedAll) };
}

/** Stable fingerprint of a set of changed pairs (used to bind a confirmation to exactly what was previewed). */
export function changeFingerprint(changed: ChangedPair[]): string {
  return changed
    .map((c) => `${c.plan}${SEP}${c.term}${SEP}${c.before.question}${SEP}${c.after.question}${SEP}${c.after.matchType}`)
    .sort()
    .join("\n");
}
