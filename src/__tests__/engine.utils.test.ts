/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from "vitest";
import { getPlanConfig, PlanConfig } from "../types";
import {
  normalizeText,
  detectSupportingFlags,
  resolvePlanQuestion,
  questionForCategory,
  findQuestion,
  sanitizeOutput,
  checkNaturalLifeStages,
  applyPostGuards,
  resolvePlanDecision,
} from "../engine";

const planConfigs = getPlanConfig();
const optimaSecure = planConfigs["Optima Secure"];
const careSupreme = planConfigs["Care Supreme"];

describe("normalizeText", () => {
  it("lowercases, collapses whitespace, and trims", () => {
    expect(normalizeText("  Diabetes   Type   2  ")).toBe("diabetes type 2");
  });

  it("handles null/undefined/non-string input without throwing", () => {
    expect(normalizeText(null as unknown as string)).toBe("");
    expect(normalizeText(undefined as unknown as string)).toBe("");
  });
});

describe("detectSupportingFlags", () => {
  it("flags test/investigation language", () => {
    expect(detectSupportingFlags("underwent an MRI scan").tests).toBe(true);
    expect(detectSupportingFlags("routine checkup").tests).toBe(false);
  });

  it("flags medication language", () => {
    expect(detectSupportingFlags("on insulin medication").medication).toBe(true);
    expect(detectSupportingFlags("no known conditions").medication).toBe(false);
  });

  it("flags hospitalisation/surgery language (both spellings)", () => {
    expect(detectSupportingFlags("hospitalization for bypass surgery").hospitalisation).toBe(true);
    expect(detectSupportingFlags("hospitalisation last year").hospitalisation).toBe(true);
    expect(detectSupportingFlags("mild seasonal allergy").hospitalisation).toBe(false);
  });
});

describe("resolvePlanQuestion", () => {
  it("resolves a question ignoring a leading numbered-list prefix", () => {
    const rawQs = ["1. Hypertension / High blood pressure?", "2. Diabetes?"];
    expect(resolvePlanQuestion("Hypertension / High blood pressure?", rawQs)).toBe(
      "1. Hypertension / High blood pressure?"
    );
  });

  it("is whitespace/case-insensitive", () => {
    const rawQs = ["Hypertension / High blood pressure?"];
    expect(resolvePlanQuestion("  hypertension /   high blood pressure? ", rawQs)).toBe(
      "Hypertension / High blood pressure?"
    );
  });

  it("returns an empty string when there is no match", () => {
    expect(resolvePlanQuestion("Something Unlisted", ["Diabetes?"])).toBe("");
  });

  it("returns an empty string for falsy input", () => {
    expect(resolvePlanQuestion("", ["Diabetes?"])).toBe("");
  });
});

describe("questionForCategory", () => {
  it("resolves a real category from a real plan config (Optima Secure: hypertension)", () => {
    expect(questionForCategory(optimaSecure, "hypertension")).toBe(
      "Hypertension / High blood pressure?"
    );
  });

  it("returns an empty string for a category the plan doesn't map", () => {
    expect(questionForCategory(optimaSecure, "not_a_real_category")).toBe("");
  });

  it("returns an empty string when config or categoryMap is missing", () => {
    expect(questionForCategory(undefined as never, "hypertension")).toBe("");
  });
});

// Plan Decision Engine (approved architecture, 2026-07-29): given an
// already-resolved category, what does THIS plan want to do with it?
// Real plan configs already contain live examples of all three outcomes —
// these tests pin that existing behavior down explicitly, by name, so a
// future change to types.ts's categoryMap entries can't silently collapse
// one outcome into another without a test failing.
describe("resolvePlanDecision", () => {
  it("direct_question: a category with a real, specific mapped question", () => {
    const decision = resolvePlanDecision("hypertension", optimaSecure, "Hypertension", "hypertension");
    expect(decision.kind).toBe("direct_question");
    if (decision.kind === "direct_question") {
      expect(decision.question).toBe("Hypertension / High blood pressure?");
    }
  });

  it("explicit_catchall: a category deliberately mapped straight to anyOther (Optima Secure's 'covid' entry)", () => {
    const decision = resolvePlanDecision("covid", optimaSecure, "Covid-19", "covid19");
    expect(decision.kind).toBe("explicit_catchall");
    if (decision.kind === "explicit_catchall") {
      expect(decision.question).toBe(optimaSecure.anyOther);
    }
  });

  it("no_mapping: a category entirely absent from this plan's categoryMap", () => {
    const decision = resolvePlanDecision("not_a_real_category", optimaSecure, "Something", "something");
    expect(decision).toEqual({ kind: "no_mapping" });
  });

  it("no_mapping lets the caller keep evaluating other deterministic sections — it must never itself resolve to a question", () => {
    // "autoimmune" is deliberately absent from Optima Secure's categoryMap —
    // that gap is exactly why classifyDeterministic has its own hardcoded
    // pre-empt for "autoimmune" + "Optima Secure" before ever reaching this
    // function. Confirms the gap this function is meant to report still
    // exists, so that pre-empt is still load-bearing and not dead code.
    const decision = resolvePlanDecision("autoimmune", optimaSecure, "Lupus", "lupus");
    expect(decision.kind).toBe("no_mapping");
  });

  it("direct_question via root-fallback rescue: a category with no dedicated question rescues to a related root disease's question instead of anyOther", () => {
    // Synthetic plan: "eye" has no dedicated question (falls to anyOther),
    // but "diabetes" does — mirrors a real plan shape without depending on
    // which of the 6 live plans currently has this exact combination.
    const syntheticPlan: PlanConfig = {
      questions: ["Diabetes / High blood sugar / Sugar in urine?", "Any other disease / condition not mentioned above?"],
      anyOther: "Any other disease / condition not mentioned above?",
      hasUmbrella: false,
      umbrellaQuestions: [],
      categoryMap: {
        diabetes: "Diabetes / High blood sugar / Sugar in urine?",
        eye: "Any other disease / condition not mentioned above?",
      },
    };
    const decision = resolvePlanDecision("eye", syntheticPlan, "Diabetic retinopathy", "diabetic retinopathy");
    expect(decision.kind).toBe("direct_question");
    if (decision.kind === "direct_question") {
      expect(decision.question).toBe("Diabetes / High blood sugar / Sugar in urine?");
    }
  });
});

describe("findQuestion", () => {
  it("finds the first question matching a regex pattern", () => {
    const q = findQuestion(optimaSecure, /diabetes/i);
    expect(q).toBe("Diabetes / High blood sugar / Sugar in urine?");
  });

  it("returns an empty string when nothing matches", () => {
    expect(findQuestion(optimaSecure, /zzz_no_such_condition/i)).toBe("");
  });
});

describe("sanitizeOutput", () => {
  it("defaults an invalid/missing match_type to FALLBACK", () => {
    const result = sanitizeOutput({}, "some condition", optimaSecure);
    expect(result.match_type).toBe("FALLBACK");
  });

  it("passes through a valid match_type unchanged", () => {
    const result = sanitizeOutput({ match_type: "P1" }, "some condition", optimaSecure);
    expect(result.match_type).toBe("P1");
  });

  it("falls back to the plan's anyOther question when matched_question is missing", () => {
    const result = sanitizeOutput({ match_type: "P1" }, "some condition", optimaSecure);
    expect(result.matched_question).toBe(optimaSecure.anyOther);
  });

  it("defaults ped_input to the provided ped when missing", () => {
    const result = sanitizeOutput({}, "hypertension", optimaSecure);
    expect(result.ped_input).toBe("hypertension");
  });

  it("handles a completely non-object input (e.g. null from a malformed AI response)", () => {
    const result = sanitizeOutput(null, "hypertension", optimaSecure);
    expect(result.match_type).toBe("FALLBACK");
    expect(result.ped_input).toBe("hypertension");
  });
});

describe("checkNaturalLifeStages", () => {
  it.each([
    "regular periods",
    "menopause",
    "puberty",
    "pregnancy",
    "routine checkup",
    "vaccination",
    "n/a",
    "none",
    "healthy",
  ])("classifies %s as NON_AILMENT", (input) => {
    const result = checkNaturalLifeStages(input);
    expect(result).not.toBeNull();
    expect(result?.match_type).toBe("NON_AILMENT");
  });

  it("does NOT firewall a genuine ailment (diabetes)", () => {
    expect(checkNaturalLifeStages("diabetes")).toBeNull();
  });

  it("carves out an exception for ectopic pregnancy despite the word 'pregnancy'", () => {
    // Explicit hard-firewall exception in the source: ectopic pregnancy is a
    // real medical emergency, not a normal physiological pregnancy state.
    expect(checkNaturalLifeStages("ectopic pregnancy")).toBeNull();
  });

  it("returns null for empty input", () => {
    expect(checkNaturalLifeStages("")).toBeNull();
  });
});

describe("applyPostGuards", () => {
  it("reroutes non-insulin gestational/Type-2 diabetes to FALLBACK on plans requiring insulin dependency", () => {
    // Care Supreme has overrides.requiresInsulinForDiabetes = true.
    const diabetesQuestion = questionForCategory(careSupreme, "diabetes");
    const output = {
      ped_input: "gestational diabetes",
      match_type: "P1" as const,
      matched_question: diabetesQuestion,
      explanation: "placeholder",
    };
    const result = applyPostGuards(output, "gestational diabetes", "Care Supreme", careSupreme);
    expect(result.match_type).toBe("FALLBACK");
    expect(result.matched_question).toBe(careSupreme.anyOther);
  });

  it("does not touch an output whose matched_question isn't the plan's diabetes question", () => {
    const output = {
      ped_input: "asthma",
      match_type: "P1" as const,
      matched_question: questionForCategory(careSupreme, "respiratory"),
      explanation: "placeholder",
    };
    const result = applyPostGuards(output, "asthma", "Care Supreme", careSupreme);
    expect(result.match_type).toBe("P1");
    expect(result.matched_question).toBe(questionForCategory(careSupreme, "respiratory"));
  });

  it("leaves output completely unchanged when no post-guard rule applies", () => {
    const output = {
      ped_input: "fracture",
      match_type: "P1" as const,
      matched_question: optimaSecure.anyOther,
      explanation: "placeholder",
    };
    const result = applyPostGuards(output, "fracture", "Optima Secure", optimaSecure);
    expect(result).toEqual(output);
  });
});
