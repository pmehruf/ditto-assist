/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from "vitest";
import { getPlanConfig } from "../types";
import { snapshotFromDump } from "../mapping/seedBuilder";
import { planConfigsFromDump } from "../mapping/equalityHarness";
import { runDeterministicPipeline } from "../mapping/routingEngine";
import { fixtureDump } from "./helpers/mappingTestDb";

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

// The db-driven engine over the committed production data (the legacy engine these tests were written against was
// removed in Phase 6; the frozen baselines prove the db engine reproduces it exactly).
const snap = snapshotFromDump(fixtureDump);
const planConfigs = Object.fromEntries(planConfigsFromDump(fixtureDump).map((p) => [p.planName, p.config]));
const planNames = Object.keys(planConfigs);

/** Runs the full production pipeline (same as server.ts's POST /api/match). */
function classify(ped: string, planName: string) {
  return runDeterministicPipeline(ped, planName, planConfigs[planName], snap).result;
}

/** The comparable part of a lookup: null when no deterministic rule answers it (it would go on to AI Memory / the AI step). */
const pick = (r: ReturnType<typeof classify>) => (r ? { match_type: r.match_type, matched_question: r.matched_question } : null);

/**
 * Asserts `ped` resolves exactly like `siblingPed` on every plan: both answer the same question, or both are left to
 * the AI step (a plan with no question for that category — production plan data, not the compiled configs these tests
 * were first written against). `siblingPed` should be a PED that already carried the same category and was already
 * resolving correctly prior to the fix, so the assertion is immune to plan-specific category-mapping differences. At
 * least one plan must actually answer, so the comparison is never vacuous.
 */
function expectSameResolutionAsSibling(ped: string, siblingPed: string) {
  let answered = 0;
  for (const planName of planNames) {
    const result = classify(ped, planName);
    const sibling = classify(siblingPed, planName);
    expect(pick(result), `"${ped}" on "${planName}" should resolve identically to sibling "${siblingPed}"`).toEqual(pick(sibling));
    if (result) answered++;
  }
  expect(answered, `"${ped}" should be answered by at least one plan`).toBeGreaterThan(0);
}

describe("Tier 1 fix: previously-dead dictionary entries now resolve", () => {
  it("covid.19 and covid19 resolve identically to each other on every plan (answered by at least one)", () => {
    expectSameResolutionAsSibling("covid.19", "covid19");
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
  it("no compiled plan config defines an 'ent' or 'neuroPsych' categoryMap key anymore", () => {
    const compiled = getPlanConfig();
    for (const planName of Object.keys(compiled)) {
      const config = compiled[planName] as unknown as Record<string, unknown>;
      const categoryMap = config.categoryMap as Record<string, unknown> | undefined;
      expect(categoryMap?.["ent"], `plan "${planName}" categoryMap.ent`).toBeUndefined();
      expect(categoryMap?.["neuroPsych"], `plan "${planName}" categoryMap.neuroPsych`).toBeUndefined();
    }
  });
});
