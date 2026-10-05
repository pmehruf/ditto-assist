/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import { snapshotFromDump } from "../mapping/seedBuilder";
import { planConfigsFromDump } from "../mapping/equalityHarness";
import { applyPostGuardsFromSnapshot } from "../mapping/routingEngine";
import { applyPostGuards } from "../engine";
import { fixtureDump } from "./helpers/mappingTestDb";
import type { MatchOutput } from "../types";

/**
 * Phase 6 batch C. After Gemini (and AI Memory) answer, the server used to run the hard-coded `applyPostGuards` from
 * engine.ts; the same rules live in the database as `post_guard` rows. The server now runs the database rules, so this
 * proves they give the identical result for answer-shaped inputs: every question of every plan x a wide set of
 * conditions x every match type. Any difference here would be a routing change and must stop the batch.
 */
const MATCH_TYPES: MatchOutput["match_type"][] = ["P0", "P1", "P2", "FALLBACK", "NON_AILMENT", "ESCALATE", "INVALID"];

const GUARD_TERMS = [
  "diabetes", "gestational diabetes", "type 2 diabetes", "type 1 diabetes", "type 2 diabetes on insulin", "diabetes on insulin",
  "pre diabetes", "diabetic retinopathy", "diabetic foot", "diabetes mellitus", "high blood sugar", "gdm",
  "hypertension", "high blood pressure", "benign prostatic hyperplasia", "fibroadenoma", "lipoma", "polyp", "thyroid nodule",
  "asthma", "obstructive sleep apnea", "fracture", "xqzprobe",
];

describe("AI-answer post-guards: database rules equal the hard-coded guards", () => {
  const snap = snapshotFromDump(fixtureDump);
  const plans = planConfigsFromDump(fixtureDump);
  const aliasTerms = fixtureDump.pedAliases.map((a) => a.aliasText).filter((_, i) => i % 7 === 0);
  const terms = [...new Set([...GUARD_TERMS, ...aliasTerms])];

  it("covers all plans and a meaningful number of conditions", () => {
    expect(plans.length).toBeGreaterThanOrEqual(5);
    expect(terms.length).toBeGreaterThan(150);
  });

  it("gives identical output for every (plan, question, match type, condition)", () => {
    let compared = 0;
    let guardsFired = 0;
    const diffs: string[] = [];
    for (const { planName, config } of plans) {
      const questions = [...new Set([...config.questions, config.anyOther].filter(Boolean))];
      for (const q of questions) {
        for (const mt of MATCH_TYPES) {
          for (const ped of terms) {
            const make = (): MatchOutput => ({ ped_input: ped, match_type: mt, matched_question: q, explanation: "x", confused_questions: [] });
            const legacy = applyPostGuards(make(), ped, planName, config);
            const data = applyPostGuardsFromSnapshot(make(), ped, planName, config, snap).output;
            compared++;
            if (JSON.stringify(legacy) !== JSON.stringify(make())) guardsFired++;
            if (JSON.stringify(legacy) !== JSON.stringify(data)) {
              if (diffs.length < 5) diffs.push(`${planName} | ${ped} | ${mt} | ${q.slice(0, 40)}`);
            }
          }
        }
      }
    }
    expect(diffs, `differences (of ${compared})`).toEqual([]);
    expect(guardsFired).toBeGreaterThan(0); // the comparison actually exercises a rewriting guard
  });
});
