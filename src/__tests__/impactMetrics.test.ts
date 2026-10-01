/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import { classifyImpact, computeMetrics, dedupeByNormalizedTerm, compareWorlds, type ChangedPair, type PairOutcome } from "../mapping/impact";
import { snapshotFromDump } from "../mapping/seedBuilder";
import { planConfigsFromDump } from "../mapping/equalityHarness";
import { fixtureDump } from "./helpers/mappingTestDb";

/** Pins the written definitions of the impact metrics (src/mapping/impact.ts, "DEFINITIONS"). */

const out = (over: Partial<PairOutcome>): PairOutcome => ({ resolved: true, matchType: "P1", question: "Q", decidedBy: "x", specific: true, tier: "P1", ...over });
const pair = (plan: string, term: string, before: Partial<PairOutcome>, after: Partial<PairOutcome>): ChangedPair => ({ plan, term, before: out(before), after: out(after) });

describe("impact metric definitions", () => {
  it("spellings that normalize to the same dictionary key count once per plan", () => {
    const changed = [pair("A", "Type 2 Diabetes", {}, { question: "Q2" }), pair("A", "type  2 diabetes", {}, { question: "Q2" }), pair("B", "type 2 diabetes", {}, { question: "Q2" })];
    const unique = dedupeByNormalizedTerm(changed);
    expect(unique).toHaveLength(2); // (A, term) and (B, term)
    expect(computeMetrics(unique, 100).pairsChanged).toBe(2);
    expect(computeMetrics(unique, 100).termsChanged).toBe(1);
  });

  it("the most serious spelling represents its group", () => {
    const mild = pair("A", "gout", {}, { question: "Q2" });
    const serious = pair("A", "Gout", {}, { resolved: false, matchType: null, question: null, specific: false, tier: "UNRESOLVED" });
    expect(dedupeByNormalizedTerm([mild, serious])[0]).toBe(serious);
  });

  it("advisor lookups are real search rows for the distinct changed pairs, never double counted", () => {
    const changed = dedupeByNormalizedTerm([pair("A", "Gout", {}, { question: "Q2" }), pair("A", "gout", {}, { question: "Q2" })]);
    const m = computeMetrics(changed, 10, { byTerm: { gout: 7 }, byPair: { "A||gout": 7, "B||gout": 99 } });
    expect(m.advisorLookupsAffected).toBe(7); // plan B unaffected, so its 99 searches are not counted
    expect(m.advisorPairsAffected).toBe(1);
  });

  it("classification is deliberate: safety signals make a single lookup high, volume alone does not", () => {
    const p0 = computeMetrics([pair("A", "x", { tier: "P0", matchType: "P0" }, { question: "Q2", tier: "P0", matchType: "P0" })], 10);
    expect(classifyImpact(p0).tier).toBe("high");
    const loss = computeMetrics([pair("A", "x", {}, { question: "Others", specific: false, tier: "P3", matchType: "FALLBACK" })], 10);
    expect(classifyImpact(loss).tier).toBe("high");
    const gain = computeMetrics([pair("A", "x", { question: "Others", specific: false, tier: "P3", matchType: "FALLBACK" }, {})], 10);
    expect(classifyImpact(gain).tier).toBe("low");
    const swaps = computeMetrics(Array.from({ length: 5 }, (_, i) => pair("A", `t${i}`, {}, { question: "Q2" })), 10);
    expect(classifyImpact(swaps).tier).toBe("low");
  });

  it("pairsCompared uses distinct normalized terms x plans", () => {
    const snapshot = snapshotFromDump(fixtureDump);
    const plans = new Map(planConfigsFromDump(fixtureDump).map((p) => [p.planName, p.config] as const));
    const r = compareWorlds({ snapshot, plans }, { snapshot, plans }, ["Gout", "gout", "  GOUT "], undefined);
    expect(r.metrics.pairsCompared).toBe(plans.size);
    expect(r.tier).toBe("none");
  });
});
