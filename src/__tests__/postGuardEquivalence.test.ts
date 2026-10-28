/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { gunzipSync } from "node:zlib";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { snapshotFromDump } from "../mapping/seedBuilder";
import { planConfigsFromDump } from "../mapping/equalityHarness";
import { applyPostGuardsFromSnapshot } from "../mapping/routingEngine";
import { fixtureDump } from "./helpers/mappingTestDb";
import type { MatchOutput } from "../types";

/**
 * Phase 6. After Gemini (and AI Memory) answer, the server applies the database `post_guard` rules. They must give the
 * result the original hard-coded guards gave, frozen in `ai-postguard.expected.json.gz` (131,124 answer-shaped inputs:
 * every question of every plan x every match type x 150+ conditions; 173 of them are rewritten by a guard). Any
 * difference is a routing change and must stop the batch.
 */
const MATCH_TYPES: MatchOutput["match_type"][] = ["P0", "P1", "P2", "FALLBACK", "NON_AILMENT", "ESCALATE", "INVALID"];
const GUARD_TERMS = [
  "diabetes", "gestational diabetes", "type 2 diabetes", "type 1 diabetes", "type 2 diabetes on insulin", "diabetes on insulin",
  "pre diabetes", "diabetic retinopathy", "diabetic foot", "diabetes mellitus", "high blood sugar", "gdm",
  "hypertension", "high blood pressure", "benign prostatic hyperplasia", "fibroadenoma", "lipoma", "polyp", "thyroid nodule",
  "asthma", "obstructive sleep apnea", "fracture", "xqzprobe",
];

const expected = JSON.parse(gunzipSync(readFileSync(new URL("./fixtures/mapping/ai-postguard.expected.json.gz", import.meta.url))).toString()) as {
  meta: { combinations: number; rewrittenCount: number; sha256: string };
  rewritten: Array<[string, string, string, string, MatchOutput]>;
};

describe("AI-answer post-guards: the database rules reproduce the frozen hard-coded guards", () => {
  it("gives identical output for every (plan, question, match type, condition)", () => {
    const snap = snapshotFromDump(fixtureDump);
    const plans = planConfigsFromDump(fixtureDump);
    const aliasTerms = fixtureDump.pedAliases.map((a) => a.aliasText).filter((_, i) => i % 7 === 0);
    const terms = [...new Set([...GUARD_TERMS, ...aliasTerms])];
    const all = createHash("sha256");
    const rewritten: Array<[string, string, string, string, MatchOutput]> = [];
    let n = 0;
    for (const { planName, config } of plans) {
      const questions = [...new Set([...config.questions, config.anyOther].filter(Boolean))];
      for (const q of questions) {
        for (const mt of MATCH_TYPES) {
          for (const ped of terms) {
            const make = (): MatchOutput => ({ ped_input: ped, match_type: mt, matched_question: q, explanation: "x", confused_questions: [] });
            const out = applyPostGuardsFromSnapshot(make(), ped, planName, config, snap).output;
            all.update(JSON.stringify(out) + "\n");
            n++;
            if (JSON.stringify(out) !== JSON.stringify(make())) rewritten.push([planName, q, mt, ped, out]);
          }
        }
      }
    }
    expect(n).toBe(expected.meta.combinations);
    expect(rewritten.length).toBe(expected.meta.rewrittenCount);
    expect(rewritten).toEqual(expected.rewritten);
    expect(all.digest("hex")).toBe(expected.meta.sha256);
  });
});
