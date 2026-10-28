/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Phase 6 / batch E, step 1. Derives the post-R10 regression fixture from the committed production day-one snapshot by
 * applying EXACTLY the six owner-approved R10 plan mapping corrections, and nothing else:
 *   Activ Fit Preferred: kidney -> Q6, diabetes -> Q2, hypertension -> Q2
 *   Activ One Max:       blood  -> Q11, eyeEnt -> Q12, sarcoidosis -> Q11
 * Each correction has a precondition (the current value) that is checked before it is applied.
 *   tsx scripts/makePostR10Fixture.ts --in <day-one snapshot.json.gz> --out <post-r10 snapshot.json.gz>
 */

import { gunzipSync, gzipSync } from "node:zlib";
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";

const arg = (n: string) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const inFile = arg("in");
const outFile = arg("out");
if (!inFile || !outFile) {
  console.error("Usage: --in <snapshot.json.gz> --out <snapshot.json.gz>");
  process.exit(1);
}

const R10: Array<{ id: string; plan: string; category: string; from: number | null; to: number }> = [
  { id: "A1", plan: "Activ Fit Preferred", category: "kidney", from: 19, to: 6 },
  { id: "A2", plan: "Activ Fit Preferred", category: "diabetes", from: 16, to: 2 },
  { id: "A3", plan: "Activ Fit Preferred", category: "hypertension", from: 18, to: 2 },
  { id: "A7", plan: "Activ One Max", category: "blood", from: null, to: 11 },
  { id: "A8", plan: "Activ One Max", category: "eyeEnt", from: null, to: 12 },
  { id: "C-AOM", plan: "Activ One Max", category: "sarcoidosis", from: null, to: 11 },
];

const snap = JSON.parse(gunzipSync(readFileSync(inFile)).toString()) as { meta: Record<string, unknown>; data: { planConfigs: any[] } };
const text = (q: unknown) => (typeof q === "string" ? q : (q as { text: string }).text);
const applied: unknown[] = [];
for (const c of R10) {
  const plan = snap.data.planConfigs.find((p) => p.planName === c.plan && !p.removed);
  if (!plan) throw new Error(`plan ${c.plan} not found`);
  const qs: string[] = plan.questions.map(text);
  const map: Record<string, string> = plan.categoryMap ?? (plan.categoryMap = {});
  const cur = map[c.category];
  const curIdx = cur == null ? null : qs.indexOf(cur) + 1;
  if (curIdx !== c.from) throw new Error(`${c.id}: precondition failed (now Q${curIdx}, expected ${c.from === null ? "unmapped" : "Q" + c.from})`);
  const target = qs[c.to - 1];
  if (!target) throw new Error(`${c.id}: question Q${c.to} missing`);
  map[c.category] = target;
  applied.push({ id: c.id, plan: c.plan, category: c.category, before: c.from === null ? "unmapped" : `Q${c.from}`, after: `Q${c.to}` });
}
const sha256 = createHash("sha256").update(JSON.stringify(snap.data)).digest("hex");
const out = { meta: { ...snap.meta, derivedFrom: { sha256: snap.meta.sha256, note: "committed production day-one snapshot" }, derivedBy: "scripts/makePostR10Fixture.ts", purpose: "post-R10 regression fixture: day-one data + the six owner-approved R10 plan mapping corrections", r10Corrections: applied, sha256 }, data: snap.data };
writeFileSync(outFile, gzipSync(JSON.stringify(out)));
console.log(JSON.stringify({ applied, sha256 }, null, 2));
