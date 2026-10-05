/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Phase 6 / batch E, step 1. Proves that the post-R10 baseline differs from the day-one baseline ONLY because of the six
 * owner-approved R10 corrections.
 *
 *   1. Every (condition, plan) pair whose frozen outcome differs between the two baselines (decoded to the actual question,
 *      never the raw row: each baseline numbers its own question table).
 *   2. Each correction applied ON ITS OWN to the day-one data, run through the data-driven engine: the pairs it changes.
 *   3. The union of (2) must equal (1): no pair changes without a correction explaining it, and no correction changes a
 *      pair that the frozen baselines do not show.
 *
 *   tsx scripts/r10Differences.ts --out <differences.json>
 */

import { gunzipSync } from "node:zlib";
import { readFileSync, writeFileSync } from "node:fs";
import { snapshotFromDump, type MappingDump } from "../src/mapping/seedBuilder.js";
import { newEngineOutcome, planConfigsFromDump, primaryKey, strictHash } from "../src/mapping/equalityHarness.js";

const F = (n: string) => new URL(`../src/__tests__/fixtures/mapping/${n}`, import.meta.url);
const gz = (n: string) => JSON.parse(gunzipSync(readFileSync(F(n))).toString());
const pre = gz("production-day-one.baseline.json.gz");
const post = gz("post-r10.baseline.json.gz");
const dayOne = gz("production-day-one.snapshot.json.gz") as { data: MappingDump };
const postSnap = gz("post-r10.snapshot.json.gz") as { meta: { r10Corrections: Array<{ id: string; plan: string; category: string; before: string; after: string }> }; data: MappingDump };

const corrections = postSnap.meta.r10Corrections;
const text = (q: unknown) => (typeof q === "string" ? q : (q as { text: string }).text);

/** The day-one data with only the given corrections applied. */
function withCorrections(ids: string[]): MappingDump {
  const d = JSON.parse(JSON.stringify(dayOne.data)) as MappingDump;
  for (const c of corrections.filter((x) => ids.includes(x.id))) {
    const plan = (d as any).planConfigs.find((p: any) => p.planName === c.plan && !p.removed);
    const qs: string[] = plan.questions.map(text);
    plan.categoryMap[c.category] = qs[Number(c.after.slice(1)) - 1];
  }
  return d;
}

// The rules are the same in every variant: build the snapshot once from the day-one data.
const snap = snapshotFromDump(dayOne.data);
const termsOf = pre.terms as string[];
if (JSON.stringify(pre.terms) !== JSON.stringify(post.terms)) throw new Error("the two baselines use different corpora");

const outcomes = (dump: MappingDump, plan: string): string[] => {
  const cfg = planConfigsFromDump(dump).find((p) => p.planName === plan)!.config;
  return termsOf.map((t) => {
    const o = newEngineOutcome(t, plan, cfg, snap);
    return `${primaryKey(o)}#${strictHash(o)}`;
  });
};

const decode = (b: any, row: string) => {
  if (row === "0") return { key: "0", label: "unresolved (AI step)" };
  const [, mt, qi, qn, hash] = row.split("|");
  const q = String(b.questionTable[Number(qi)]);
  return { key: `${mt}|${q}|${qn}|${hash}`, label: `${mt} ${q.slice(0, 56)}` };
};

// (1) differences between the frozen baselines
const frozen = new Map<string, { plan: string; term: string; before: string; after: string }>();
for (const plan of Object.keys(post.results)) {
  const a: string[] = pre.results[plan];
  const b: string[] = post.results[plan];
  for (let i = 0; i < b.length; i++) {
    const da = decode(pre, a[i]);
    const db = decode(post, b[i]);
    if (da.key !== db.key) frozen.set(`${plan}||${termsOf[i]}`, { plan, term: termsOf[i], before: da.label, after: db.label });
  }
}

// (2) each correction on its own
const explained = new Map<string, string[]>();
for (const plan of [...new Set(corrections.map((c) => c.plan))]) {
  const base = outcomes(dayOne.data, plan);
  for (const c of corrections.filter((x) => x.plan === plan)) {
    const one = outcomes(withCorrections([c.id]), plan);
    for (let i = 0; i < termsOf.length; i++) {
      if (one[i] === base[i]) continue;
      const k = `${plan}||${termsOf[i]}`;
      explained.set(k, [...(explained.get(k) ?? []), c.id]);
    }
  }
}

// (3) the two sets must be equal
const unexplained = [...frozen.keys()].filter((k) => !explained.has(k));
const notInBaselines = [...explained.keys()].filter((k) => !frozen.has(k));
const differences = [...frozen.entries()].map(([k, v]) => ({ corrections: (explained.get(k) ?? []).join("+") || "UNEXPLAINED", ...v }));
const byCorrection: Record<string, number> = {};
for (const d of differences) byCorrection[d.corrections] = (byCorrection[d.corrections] ?? 0) + 1;
const summary = {
  totalPairs: termsOf.length * Object.keys(post.results).length,
  differentPairs: frozen.size,
  explainedByASingleCorrectionRun: explained.size,
  unexplained: unexplained.length,
  changedByACorrectionButNotInTheBaselines: notInBaselines.length,
  byCorrection,
  plansAffected: [...new Set(differences.map((d) => d.plan))],
  corrections,
};
console.log(JSON.stringify({ summary, unexplainedSample: unexplained.slice(0, 5), notInBaselinesSample: notInBaselines.slice(0, 5) }, null, 2));
const outIdx = process.argv.indexOf("--out");
if (outIdx >= 0) writeFileSync(process.argv[outIdx + 1], JSON.stringify({ summary, differences }, null, 1));
process.exit(unexplained.length === 0 && notInBaselines.length === 0 ? 0 : 1);
