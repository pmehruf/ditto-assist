/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { LEGACY_RULE_SEED } from "../mapping/legacyRuleSeed";
import { planSeed, snapshotFromDump, type MappingDump } from "../mapping/seedBuilder";
import { runDeterministicPipeline } from "../mapping/routingEngine";
import { newEngineOutcome, planConfigsFromDump, primaryKey, strictHash } from "../mapping/equalityHarness";
import { restrictionSets, diabetesAndGrowthPattern } from "./helpers/auditSets";
import { normalizeDictionaryKey } from "../mapping/helpers";
import type { PlanConfig, PlanRestriction } from "../types";

/**
 * Zero Regression Audit (MASTER_CONSTITUTION Part XII / Appendix F) — the
 * explicit, named checks for the mapping-control equality migration, on top
 * of the full-corpus equality proof in mappingControl.equality.test.ts.
 * Each describe block is one audit line item.
 */

const FIXTURES = new URL("./fixtures/mapping/", import.meta.url);
const dump = (JSON.parse(gunzipSync(readFileSync(new URL("production-day-one.snapshot.json.gz", FIXTURES))).toString()) as { data: MappingDump }).data;
const baseline = JSON.parse(gunzipSync(readFileSync(new URL("production-day-one.baseline.json.gz", FIXTURES))).toString()) as { terms: string[] };

const snap = snapshotFromDump(dump);
const plans = planConfigsFromDump(dump);
/**
 * The outcomes the original hard-coded engine gave for these comparisons, frozen at the Phase 2 migration
 * (audit-legacy-frozen.json.gz). The engine itself was removed in Phase 6; this is the oracle now.
 */
const frozen = JSON.parse(gunzipSync(readFileSync(new URL("audit-legacy-frozen.json.gz", FIXTURES))).toString()) as {
  overrideAliases: Record<string, string>;
  restrictions: Record<string, string>;
  pairs: Record<string, string>;
};
const frozenPair = (planName: string, ped: string) => {
  const [resolved, questionNumber, strict] = frozen.pairs[`${planName}||${ped}`].split("|");
  return { resolved: resolved === "1", questionNumber: questionNumber === "" ? null : Number(questionNumber), strict };
};
const sampleTerms = baseline.terms.filter((_, i) => i % 9 === 0);

describe("Audit: plan isolation", () => {
  it("a plan-scoped rule never fires on any other plan", () => {
    const scoped = LEGACY_RULE_SEED.filter((r) => r.planScope);
    expect(scoped.length).toBeGreaterThan(0);
    for (const rule of scoped) {
      for (const { planName, config } of plans) {
        if (planName === rule.planScope) continue;
        for (const ped of baseline.terms.filter((_, i) => i % 5 === 0)) {
          const { trace } = runDeterministicPipeline(ped, planName, config, snap);
          expect(trace.decidedBy).not.toBe(rule.ruleKey);
        }
      }
    }
  });

  it("the same input routes by each plan's own wording (different plans, different questions)", () => {
    const answers = new Set(plans.map(({ planName, config }) => newEngineOutcome("hypertension", planName, config, snap).matched_question));
    expect(answers.size).toBeGreaterThan(3);
  });
});

describe("Audit: existing plan overrides still take precedence", () => {
  it("every plan override alias is decided by the override stage and equals the frozen original", () => {
    const aliasesByPed = new Map<number, string[]>();
    for (const a of dump.pedAliases) aliasesByPed.set(a.pedId, [...(aliasesByPed.get(a.pedId) ?? []), a.aliasText]);
    let checked = 0;
    for (const o of dump.planOverrides) {
      const plan = plans.find((p) => p.planName === o.planName);
      if (!plan) continue; // override belongs to a removed/unknown plan
      for (const aliasText of aliasesByPed.get(o.pedId) ?? []) {
        const { trace, result } = runDeterministicPipeline(aliasText, plan.planName, plan.config, snap);
        expect(trace.decidedBy, `${plan.planName} :: ${aliasText}`).toBe("primitive.plan_override");
        expect(result?.plan_override).toBe(true);
        expect(primaryKey(newEngineOutcome(aliasText, plan.planName, plan.config, snap))).toBe(frozen.overrideAliases[`${plan.planName}||${aliasText}`]);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(30);
  });

  it("an override really pre-empts other stages (shields, plan rules, dictionary), and post-guards are skipped for it", () => {
    const aliasesByPed = new Map<number, string[]>();
    for (const a of dump.pedAliases) aliasesByPed.set(a.pedId, [...(aliasesByPed.get(a.pedId) ?? []), a.aliasText]);
    let preempted = 0;
    for (const o of dump.planOverrides) {
      const plan = plans.find((p) => p.planName === o.planName);
      if (!plan) continue;
      for (const aliasText of aliasesByPed.get(o.pedId) ?? []) {
        const withOverride = runDeterministicPipeline(aliasText, plan.planName, plan.config, snap);
        const without = runDeterministicPipeline(aliasText, plan.planName, { ...plan.config, pedOverrides: [] }, snap);
        expect(withOverride.trace.decidedBy).toBe("primitive.plan_override");
        expect(withOverride.trace.postGuard).toBeUndefined();
        if (without.trace.decidedBy !== "primitive.plan_override") preempted++;
      }
    }
    expect(preempted).toBeGreaterThan(10);
  });
});

describe("Audit: restriction integrity (data-driven restrictions behave exactly as the original engine did)", () => {
  const diabetesAndGrowthTerms = baseline.terms.filter((t) => diabetesAndGrowthPattern.test(t)).slice(0, 400);
  for (const set of restrictionSets) {
    it(`${set.name}: identical to the original engine on every plan`, () => {
      for (const { planName, config } of plans) {
        const cfg: PlanConfig = { ...config, restrictions: set.restrictions, overrides: set.flags ?? config.overrides };
        for (const ped of diabetesAndGrowthTerms) {
          expect(primaryKey(newEngineOutcome(ped, planName, cfg, snap)), `${planName} :: ${ped}`).toBe(frozen.restrictions[`${set.name}||${planName}||${ped}`]);
        }
      }
    });
  }
});

describe("Audit: question and question-number integrity", () => {
  it("every deterministic answer is a real question of that plan (or the catch-all / 'No questions applicable')", () => {
    for (const { planName, config } of plans) {
      const valid = new Set<string>([...config.questions, config.anyOther, "No questions applicable"]);
      const trimmed = new Set([...valid].map((q) => q.trim()));
      for (const ped of sampleTerms) {
        const o = newEngineOutcome(ped, planName, config, snap);
        if (!o.resolved) continue;
        expect(trimmed.has(o.matched_question.trim()), `${planName} :: ${ped} -> ${o.matched_question}`).toBe(true);
      }
    }
  });

  it("question numbers are carried through unchanged (none are invented)", () => {
    for (const { planName, config } of plans) {
      for (const ped of sampleTerms) {
        const o = newEngineOutcome(ped, planName, config, snap);
        expect(o.question_number).toBe(frozenPair(planName, ped).questionNumber);
      }
    }
  });
});

describe("Audit: secondary / supporting output integrity", () => {
  it("umbrella recommendations and supporting flags are identical to the original engine", () => {
    for (const { planName, config } of plans) {
      for (const ped of sampleTerms) {
        const o = newEngineOutcome(ped, planName, config, snap);
        const f = frozenPair(planName, ped);
        expect(o.resolved ? strictHash(o) : "", `${planName} :: ${ped}`).toBe(f.resolved ? f.strict : "");
      }
    }
  });
});

describe("Audit: alias and collision integrity", () => {
  it("every alias keeps exactly one dictionary entry (normalised keys are unique) and none was lost", () => {
    const keys = dump.pedAliases.map((a) => a.normalizedAlias);
    expect(new Set(keys).size).toBe(keys.length);
    for (const a of dump.pedAliases) expect(snap.aliases.has(a.normalizedAlias)).toBe(true);
  });

  it("known pre-existing data findings in production are pinned (reported, not changed by this migration)", () => {
    const pedIds = new Set(dump.pedRepository.map((p) => p.id));
    // Aliases whose PED row no longer exists (they carry the 'lost' lifestyle terms).
    expect(dump.pedAliases.filter((a) => !pedIds.has(a.pedId)).length).toBe(41);
    // Aliases whose stored normalised key differs from today's normaliser (hyphenated names stored with a space).
    expect(dump.pedAliases.filter((a) => normalizeDictionaryKey(a.aliasText) !== a.normalizedAlias).map((a) => a.aliasText).sort()).toEqual([
      "22q11.2 Deletion Syndrome",
      "Arnold-Chiari Malformation",
      "Dandy-Walker Malformation",
      "Dandy-Walker Syndrome",
      "Eagle-Barrett Syndrome",
    ]);
  });

  it("seed-created PEDs never collide with an existing alias", () => {
    const existing = new Set(dump.pedAliases.map((a) => a.normalizedAlias));
    for (const n of planSeed(dump).newPeds) expect(existing.has(n.normalizedAlias)).toBe(false);
  });

  it("the alias controls are the only difference between an alias and its PED (no PED category changed)", () => {
    for (const a of dump.pedAliases) {
      const ped = dump.pedRepository.find((p) => p.id === a.pedId); // undefined for the pinned orphan aliases
      expect(snap.aliases.get(a.normalizedAlias)!.pedCategory).toBe(ped?.categoryKey ?? null);
    }
  });
});

describe("Audit: fallback / unresolved behaviour is preserved", () => {
  it("unknown input stays unresolved (it goes on to AI Memory / AI exactly as before)", () => {
    for (const { planName, config } of plans) {
      expect(newEngineOutcome("xyzzy made up condition 12345", planName, config, snap).resolved).toBe(false);
    }
  });

  it("everything the original engine left unresolved is unresolved, and everything it resolved is resolved", () => {
    for (const { planName, config } of plans) {
      for (const ped of sampleTerms) {
        expect(newEngineOutcome(ped, planName, config, snap).resolved).toBe(frozenPair(planName, ped).resolved);
      }
    }
  });
});
