/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { createMappingSnapshotProvider } from "../server/mappingSnapshot";
import { newEngineOutcome, planConfigsFromDump, primaryKey, strictHash } from "../mapping/equalityHarness";
import type { MappingDump } from "../mapping/seedBuilder";
import type { MappingSnapshot } from "../mapping/ruleTypes";
import { createMappingTestEnv, fixtureDump, type MappingTestEnv } from "./helpers/mappingTestDb";

/**
 * Phase 6 / batch E. The frozen POST-R10 regression baseline.
 *
 * The data-driven engine must reproduce, for every (condition, plan) pair, the outcome frozen from the untouched legacy
 * engine over the production day-one data PLUS exactly the six owner-approved R10 plan mapping corrections. The six
 * corrections are recorded as deliberate differences from the day-one baseline and nothing else may differ.
 */

const FIXTURES = new URL("./fixtures/mapping/", import.meta.url);
const readGz = (name: string) => JSON.parse(gunzipSync(readFileSync(new URL(name, FIXTURES))).toString());

interface Baseline {
  meta: Record<string, any>;
  terms: string[];
  questionTable: string[];
  results: Record<string, string[]>;
}
const postSnapshot = readGz("post-r10.snapshot.json.gz") as { meta: { r10Corrections: Array<{ id: string; plan: string; category: string; before: string; after: string }>; sha256: string }; data: MappingDump };
const postBaseline = readGz("post-r10.baseline.json.gz") as Baseline;
const dayOneBaseline = readGz("production-day-one.baseline.json.gz") as Baseline;
const recorded = readGz("r10-deliberate-differences.json.gz") as {
  summary: { differentPairs: number; unexplained: number; changedByACorrectionButNotInTheBaselines: number; byCorrection: Record<string, number>; plansAffected: string[] };
  differences: Array<{ corrections: string; plan: string; term: string; before: string; after: string }>;
};

let env: MappingTestEnv;
let snap: MappingSnapshot;

beforeAll(async () => {
  env = await createMappingTestEnv(postSnapshot.data);
  snap = await createMappingSnapshotProvider(env.repos).get();
}, 120_000);

/** The outcome a baseline row stands for, as comparable text (rows index their own question table). */
const decode = (b: Baseline, row: string) => {
  if (row === "0") return "0";
  const [, mt, qi, qn, h] = row.split("|");
  return `1|${mt}|${b.questionTable[Number(qi)]}|${qn}|${h}`;
};

describe("post-R10 fixture provenance", () => {
  it("is the committed production day-one data plus the six R10 plan mapping corrections, and nothing else", () => {
    const corr = postSnapshot.meta.r10Corrections;
    expect(corr.map((c) => c.id).sort()).toEqual(["A1", "A2", "A3", "A7", "A8", "C-AOM"]);
    const text = (q: unknown) => (typeof q === "string" ? q : (q as { text: string }).text);
    // Undo the six corrections on a copy of the post-R10 data: it must equal the day-one data exactly.
    const undone = JSON.parse(JSON.stringify(postSnapshot.data)) as any;
    const dayOne = JSON.parse(JSON.stringify(fixtureDump)) as any;
    for (const c of corr) {
      const plan = undone.planConfigs.find((p: any) => p.planName === c.plan && !p.removed);
      const dayPlan = dayOne.planConfigs.find((p: any) => p.planName === c.plan && !p.removed);
      const qs: string[] = plan.questions.map(text);
      expect(qs.indexOf(plan.categoryMap[c.category]) + 1, `${c.id} after`).toBe(Number(c.after.slice(1)));
      if (c.before === "unmapped") {
        expect(dayPlan.categoryMap[c.category], `${c.id} before`).toBeUndefined();
        delete plan.categoryMap[c.category];
      } else {
        expect(qs.indexOf(dayPlan.categoryMap[c.category]) + 1, `${c.id} before`).toBe(Number(c.before.slice(1)));
        plan.categoryMap[c.category] = dayPlan.categoryMap[c.category];
      }
    }
    expect(undone).toEqual(dayOne);
  });

  it("both baselines cover the same 113,130 pairs", () => {
    expect(postBaseline.terms).toEqual(dayOneBaseline.terms);
    expect(postBaseline.meta.pairs).toBe(113_130);
    expect(Object.keys(postBaseline.results).sort()).toEqual(Object.keys(dayOneBaseline.results).sort());
  });
});

describe("the six deliberate R10 differences", () => {
  it("post-R10 differs from day-one in exactly the recorded pairs, all on Activ Fit Preferred and Activ One Max", () => {
    const actual = new Set<string>();
    for (const plan of Object.keys(postBaseline.results)) {
      const a = dayOneBaseline.results[plan];
      const b = postBaseline.results[plan];
      for (let i = 0; i < b.length; i++) if (decode(dayOneBaseline, a[i]) !== decode(postBaseline, b[i])) actual.add(`${plan}||${postBaseline.terms[i]}`);
    }
    const expected = new Set(recorded.differences.map((d) => `${d.plan}||${d.term}`));
    expect(actual.size).toBe(recorded.summary.differentPairs);
    expect([...actual].filter((k) => !expected.has(k))).toEqual([]);
    expect([...expected].filter((k) => !actual.has(k))).toEqual([]);
    expect(new Set(recorded.differences.map((d) => d.plan))).toEqual(new Set(["Activ Fit Preferred", "Activ One Max"]));
  });

  it("every difference is explained by a correction run on its own, and none is unexplained", () => {
    expect(recorded.summary.unexplained).toBe(0);
    expect(recorded.summary.changedByACorrectionButNotInTheBaselines).toBe(0);
    expect(recorded.differences.every((d) => d.corrections && d.corrections !== "UNEXPLAINED")).toBe(true);
    expect(Object.keys(recorded.summary.byCorrection).sort()).toEqual(["A1", "A2", "A3", "A7", "A7+A8", "A8", "C-AOM"]);
  });
});

describe("the data-driven engine reproduces the frozen post-R10 baseline", () => {
  it("every (condition, plan) outcome — primary fields AND explanation/umbrella/flags — has zero differences", () => {
    const plans = planConfigsFromDump(postSnapshot.data);
    expect(plans.map((p) => p.planName).sort()).toEqual([...postBaseline.meta.plans].sort());
    const diffs: string[] = [];
    let compared = 0;
    for (const { planName, config } of plans) {
      const rows = postBaseline.results[planName];
      expect(rows.length).toBe(postBaseline.terms.length);
      for (let i = 0; i < postBaseline.terms.length; i++) {
        const o = newEngineOutcome(postBaseline.terms[i], planName, config, snap);
        const expected = decode(postBaseline, rows[i]);
        const actual = o.resolved ? `1|${o.match_type}|${o.matched_question}|${o.question_number ?? ""}|${strictHash(o)}` : "0";
        compared++;
        if (actual !== expected && diffs.length < 20) diffs.push(`${planName} :: ${postBaseline.terms[i]} :: ${primaryKey(o).slice(0, 90)}`);
      }
    }
    expect(compared).toBe(113_130);
    expect(diffs).toEqual([]);
  }, 300_000);
});
