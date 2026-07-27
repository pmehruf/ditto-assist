/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from "vitest";
import { getPlanConfig } from "../types";
import {
  classifyDeterministic,
  sanitizeOutput,
  applyPostGuards,
  finalizeOutput,
} from "../engine";

/**
 * Named, explicit regression tests for the 2026-07-22 "Tier 1" fix batch
 * (docs/Production_Validation_Final.md -> user-authorized mechanical fixes).
 *
 * Unlike engine.baseline.test.ts (which snapshots opaque smoke-test output
 * for every plan), these tests assert the actual expected behavior for each
 * fix by name, so a future reader can see *what* was fixed and *why* without
 * having to diff a 2MB snapshot file.
 *
 * IMPORTANT: several plans apply legitimate, pre-existing, plan-specific
 * business rules on top of the shared categoryKey resolution (e.g. Care
 * Supreme's "diabetes question requires Type 1 / insulin wording" override,
 * or a plan simply having no dedicated question for a category and mapping
 * it straight to its own anyOther text). Those differences are correct,
 * documented plan configuration -- NOT something a dictionary/shield fix is
 * supposed to override. So instead of asserting one hardcoded expected
 * question across all 6 plans, most tests here compare the fixed PED phrase
 * against an existing "sibling" PED that already carried the same
 * categoryKey and was already resolving correctly before this fix -- if the
 * two now produce identical output on every plan, the fix demonstrably
 * closed the gap without inventing new, plan-specific behavior.
 */

const planConfigs = getPlanConfig();
const planNames = Object.keys(planConfigs);

/** Runs the full production pipeline (same as server.ts's POST /api/match). */
function classify(ped: string, planName: string) {
  const config = planConfigs[planName];
  let output = classifyDeterministic(ped, planName, config);
  if (!output) return null;
  output = sanitizeOutput(output, ped, config);
  output = applyPostGuards(output, ped, planName, config);
  return finalizeOutput(output, ped, config, config.questions);
}

/**
 * Asserts `ped` resolves to exactly the same (match_type, matched_question)
 * as `siblingPed` on every plan. `siblingPed` should be a PED that already
 * carried the same TOP_PED_DICTIONARY categoryKey and was already resolving
 * correctly prior to this fix batch -- this way the assertion is immune to
 * plan-specific category-mapping/override differences, since both PEDs flow
 * through the exact same downstream plan configuration.
 */
function expectSameResolutionAsSibling(ped: string, siblingPed: string) {
  for (const planName of planNames) {
    const result = classify(ped, planName);
    const sibling = classify(siblingPed, planName);
    expect(result, `"${ped}" on "${planName}" should resolve deterministically`).not.toBeNull();
    expect(sibling, `sibling "${siblingPed}" on "${planName}" should resolve deterministically`).not.toBeNull();
    expect(
      { match_type: result!.match_type, matched_question: result!.matched_question },
      `"${ped}" on "${planName}" should resolve identically to sibling "${siblingPed}"`
    ).toEqual({ match_type: sibling!.match_type, matched_question: sibling!.matched_question });
  }
}

describe("Tier 1 fix: previously-dead dictionary entries now resolve", () => {
  it("covid.19 and covid19 resolve deterministically and identically to each other on every plan", () => {
    for (const planName of planNames) {
      const a = classify("covid.19", planName);
      const b = classify("covid19", planName);
      expect(a, `"covid.19" on "${planName}"`).not.toBeNull();
      expect(b, `"covid19" on "${planName}"`).not.toBeNull();
      expect({ match_type: a!.match_type, matched_question: a!.matched_question }).toEqual({
        match_type: b!.match_type,
        matched_question: b!.matched_question,
      });
    }
  });

  it("h. pylori / h pylori / helicobacter pylori resolve the same as the existing sibling dictionary term 'gastritis' (digestive)", () => {
    expectSameResolutionAsSibling("h. pylori", "gastritis");
    expectSameResolutionAsSibling("h pylori", "gastritis");
    expectSameResolutionAsSibling("helicobacter pylori", "gastritis");
  });

  it("e-cigarette / ecigarette resolve the same as the existing sibling dictionary term 'vaping' (lifestyle)", () => {
    expectSameResolutionAsSibling("e-cigarette", "vaping");
    expectSameResolutionAsSibling("ecigarette", "vaping");
  });

  it("no pre-existing disease / no preexisting disease resolve to NON_AILMENT (natural life stage), same as sibling 'none'", () => {
    expectSameResolutionAsSibling("no pre-existing disease", "none");
    expectSameResolutionAsSibling("no preexisting disease", "none");
  });

  it("c-section delivery / csection delivery / c-section / c section resolve to NON_AILMENT (natural life stage), same as sibling 'postpartum recovery'", () => {
    expectSameResolutionAsSibling("c-section delivery", "postpartum recovery");
    expectSameResolutionAsSibling("csection delivery", "postpartum recovery");
    expectSameResolutionAsSibling("c - section", "postpartum recovery");
    expectSameResolutionAsSibling("c section", "postpartum recovery");
  });
});

describe("Tier 1 fix: sciatica non-exact phrasing no longer mis-routes to neuro", () => {
  const phrasings = ["sciatica", "sciatica pain", "chronic sciatica", "lumbar sciatica"];

  for (const phrase of phrasings) {
    it(`"${phrase}" resolves the same as the exact dictionary term "sciatica" (musculoskeletal)`, () => {
      expectSameResolutionAsSibling(phrase, "sciatica");
    });
  }
});

describe("Tier 1 fix: lipoma/papilloma non-exact phrasing routes to benign-growth, not plain skin", () => {
  it('"lipoma on back" resolves the same as the exact dictionary term "lipoma"', () => {
    expectSameResolutionAsSibling("lipoma on back", "lipoma");
  });

  it('"papilloma removal" resolves the same as the exact dictionary term "papilloma"', () => {
    expectSameResolutionAsSibling("papilloma removal", "papilloma");
  });
});

describe("Tier 1 fix: pregnancy-induced/gestational hypertension bypasses the life-stage firewall", () => {
  // Compared against "secondary hypertension htn" -- an existing sibling PED
  // that already carried the "hypertension" categoryKey and already resolved
  // correctly (including on plans like Care Supreme, whose diabetes-only
  // insulin restriction does not apply to the hypertension categoryKey at
  // all -- that override is diabetes-specific, so both this PED and its
  // sibling should land on the exact same plan-specific hypertension
  // question, or the exact same anyOther fallback where a plan has none).
  it('"pregnancy induced hypertension" resolves the same as sibling "secondary hypertension htn", not NON_AILMENT', () => {
    for (const planName of planNames) {
      const result = classify("pregnancy induced hypertension", planName);
      expect(result!.match_type, `plan "${planName}"`).not.toEqual("NON_AILMENT");
    }
    expectSameResolutionAsSibling("pregnancy induced hypertension", "secondary hypertension htn");
  });

  it('"gestational hypertension" resolves the same as sibling "secondary hypertension htn", not NON_AILMENT', () => {
    for (const planName of planNames) {
      const result = classify("gestational hypertension", planName);
      expect(result!.match_type, `plan "${planName}"`).not.toEqual("NON_AILMENT");
    }
    expectSameResolutionAsSibling("gestational hypertension", "secondary hypertension htn");
  });
});

describe("Tier 1 fix: dictionary-curated hypoglycemia phrases bypass the hypoglycaemia shield", () => {
  // Compared against "hyperglycemia episode" -- the existing sibling PED
  // with the same "diabetes" categoryKey (including on Care Supreme, whose
  // insulin-only restriction applies equally to both, by design).
  it('"hypoglycemia episode" resolves the same as sibling "hyperglycemia episode"', () => {
    // Note: on plans with the "requiresInsulinForDiabetes" override (Care
    // Supreme), both this PED and its sibling correctly land on that plan's
    // own diabetes-lineage-restriction FALLBACK message -- that's a
    // legitimate, pre-existing business rule applied equally to both, not a
    // sign the hypoglycaemia-shield gap reopened.
    expectSameResolutionAsSibling("hypoglycemia episode", "hyperglycemia episode");
  });

  it('"reactive hypoglycemia" resolves the same as sibling "hyperglycemia episode"', () => {
    expectSameResolutionAsSibling("reactive hypoglycemia", "hyperglycemia episode");
  });
});

describe("Tier 1 fix: dictionary-curated test/profile phrases bypass the generic test firewall", () => {
  // Compared against "aids"/"high triglycerides" -- existing sibling PEDs
  // with the same "hiv"/"lipid" categoryKeys respectively.
  // Compared on matched_question only, not match_type: "aids" can win a
  // higher-priority P0 "exact plan-wording chunk match" if the word "aids"
  // literally appears in a plan's own proposal-form wording, while "positive
  // hiv test"/"std profile" reach the same destination question via the
  // ordinary P1 dictionary/regex route. Different path, same correct
  // destination -- match_type is expected to differ; matched_question is not.
  it('"positive hiv test" lands on the same question as sibling "aids" (hiv), not a generic test-result message', () => {
    for (const planName of planNames) {
      const result = classify("positive hiv test", planName);
      const sibling = classify("aids", planName);
      expect(result, `"positive hiv test" on "${planName}"`).not.toBeNull();
      expect(result!.matched_question, `plan "${planName}"`).toEqual(sibling!.matched_question);
    }
  });

  it('"std profile" lands on the same question as sibling "aids" (hiv)', () => {
    for (const planName of planNames) {
      const result = classify("std profile", planName);
      const sibling = classify("aids", planName);
      expect(result, `"std profile" on "${planName}"`).not.toBeNull();
      expect(result!.matched_question, `plan "${planName}"`).toEqual(sibling!.matched_question);
    }
  });

  it('"lipid profile high" resolves the same as sibling "high triglycerides" (lipid)', () => {
    expectSameResolutionAsSibling("lipid profile high", "high triglycerides");
  });
});

describe("Tier 1 fix: orphan categoryMap keys removed", () => {
  it("no plan config defines an 'ent' or 'neuroPsych' categoryMap key anymore", () => {
    for (const planName of planNames) {
      const config = planConfigs[planName] as unknown as Record<string, unknown>;
      const categoryMap = config.categoryMap as Record<string, unknown> | undefined;
      expect(categoryMap?.["ent"], `plan "${planName}" categoryMap.ent`).toBeUndefined();
      expect(categoryMap?.["neuroPsych"], `plan "${planName}" categoryMap.neuroPsych`).toBeUndefined();
    }
  });
});
