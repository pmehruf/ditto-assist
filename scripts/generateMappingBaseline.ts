/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Generates the frozen LEGACY baseline from a mapping snapshot: runs the
 * untouched legacy engine (the migration oracle) over the full corpus for
 * every live plan and records, per (term, plan), the production-effective
 * outcome (browser leg first, then server leg). `npm run mapping:baseline --
 * --snapshot <snapshot.json.gz> --out <baseline.json.gz>`.
 */

import { gunzipSync, gzipSync } from "node:zlib";
import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { baseTerms, compoundTerms, legacyEffectiveFactory, planConfigsFromDump, primaryKey, strictHash, variantTerms } from "../src/mapping/equalityHarness.js";
import type { MappingDump } from "../src/mapping/seedBuilder.js";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const snapshotPath = arg("snapshot");
const out = arg("out");
if (!snapshotPath || !out) {
  console.error("Usage: --snapshot <snapshot.json.gz> --out <baseline.json.gz> [--compound 6000]");
  process.exit(1);
}
const { meta, data } = JSON.parse(gunzipSync(readFileSync(snapshotPath)).toString()) as { meta: Record<string, unknown>; data: MappingDump };
const dump: MappingDump = { ...data };

const base = baseTerms(dump, "src/engine.ts");
const terms = [...new Set([...base, ...variantTerms(base), ...compoundTerms(base, Number(arg("compound") ?? 6000))])].sort();
const plans = planConfigsFromDump(dump);
const legacy = legacyEffectiveFactory(dump);

const questionTable: string[] = [];
const qIndex = new Map<string, number>();
const qi = (q: string) => {
  let i = qIndex.get(q);
  if (i === undefined) {
    i = questionTable.length;
    qIndex.set(q, i);
    questionTable.push(q);
  }
  return i;
};

const results: Record<string, string[]> = {};
for (const { planName, config } of plans) {
  const rows: string[] = [];
  for (const ped of terms) {
    const o = legacy(ped, planName, config);
    rows.push(o.resolved ? `1|${o.match_type}|${qi(o.matched_question)}|${o.question_number ?? ""}|${strictHash(o)}` : "0");
  }
  results[planName] = rows;
}

const baseline = {
  meta: {
    purpose: "Frozen LEGACY production behaviour — the day-one baseline the data-driven engine must reproduce exactly",
    sourceSnapshot: { environment: meta.environment, capturedAt: meta.capturedAt, sha256: meta.sha256, migrationVersion: meta.migrationVersion },
    generatedAt: new Date().toISOString(),
    legacyEngineCommit: execSync("git rev-parse HEAD").toString().trim(),
    terms: terms.length,
    plans: plans.map((p) => p.planName),
    pairs: terms.length * plans.length,
    comparedFields: ["resolved", "match_type", "matched_question", "question_number", "strict(explanation, secondary_recommendation, supporting_flags, confused_questions, plan_override)"],
  },
  terms,
  questionTable,
  results,
};
writeFileSync(out, gzipSync(JSON.stringify(baseline)));
console.log(JSON.stringify(baseline.meta, null, 2));
void primaryKey;
