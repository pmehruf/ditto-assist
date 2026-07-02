/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from "vitest";
import { getPlanConfig } from "../types";
import {
  normalizeText,
  detectSupportingFlags,
  resolvePlanQuestion,
  questionForCategory,
  findQuestion,
  sanitizeOutput,
  checkNaturalLifeStages,
  applyPostGuards,
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
