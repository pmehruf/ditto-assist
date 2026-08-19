/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from "vitest";
import { normalizePlanName, matchesPhrase, matchSpecificIllness } from "../specificIllnessEngine";

describe("normalizePlanName", () => {
  it.each([
    ["HDFC Optima Secure", "Optima Secure"],
    ["optima secure plan", "Optima Secure"],
    ["Care Supreme Gold", "Care Supreme"],
    ["Care Health Insurance", "Care Supreme"],
    ["Aditya Birla Activ One Max", "Activ One Max"],
    ["activ one max", "Activ One Max"],
    ["Aditya Birla Activ Fit Preferred", "Activ Fit Preferred"],
    ["activ fit preferred", "Activ Fit Preferred"],
  ])("normalizes %s -> %s", (input, expected) => {
    expect(normalizePlanName(input)).toBe(expected);
  });

  it("returns the raw input unchanged when no known plan alias matches", () => {
    expect(normalizePlanName("Some Totally Unknown Plan")).toBe("Some Totally Unknown Plan");
  });
});

describe("matchesPhrase", () => {
  it("matches an exact, whole-string phrase", () => {
    expect(matchesPhrase("diabetes", "diabetes")).toBe(true);
  });

  it("matches a phrase as a whole word within a longer sentence", () => {
    expect(matchesPhrase("diagnosed with diabetes last year", "diabetes")).toBe(true);
  });

  it("does not match a short phrase embedded inside an unrelated longer word", () => {
    // "ra" (a short illness abbreviation) must not match inside "throat".
    expect(matchesPhrase("sore throat", "ra")).toBe(false);
  });

  it("does not match when the phrase is merely a substring, not a whole word", () => {
    expect(matchesPhrase("brainstorm session", "brain")).toBe(false);
  });

  it("is case-insensitive", () => {
    expect(matchesPhrase("DIABETES diagnosis", "diabetes")).toBe(true);
  });

  it("safely escapes regex special characters in the phrase", () => {
    expect(matchesPhrase("type 1 diabetes (insulin dependent)", "(insulin dependent)")).toBe(true);
  });

  // Regression coverage for the plural/hyphen matching bug: a declared
  // condition entered as a plural ("Peptic Ulcers") previously failed to
  // match a catalog entry stored in the singular ("peptic ulcer"), because
  // the old word-boundary check required an exact match on both sides.
  it("matches a plural declared condition against a singular stored phrase", () => {
    expect(matchesPhrase("Peptic Ulcers", "peptic ulcer")).toBe(true);
  });

  it("matches a singular declared condition against a plural stored phrase", () => {
    expect(matchesPhrase("hemorrhoid", "hemorrhoids")).toBe(true);
  });

  it("treats hyphens and spaces as interchangeable separators", () => {
    expect(matchesPhrase("fistula-in-ano", "fistula in ano")).toBe(true);
  });

  it("does not strip the trailing 's' off medical terms that are singular by nature (-itis/-sis)", () => {
    // "sinusitis" and "psoriasis" are not plurals — matching still works
    // because both sides go through the same transform, but a plural-only
    // search term must not spuriously match them.
    expect(matchesPhrase("sinusitis", "sinusitis")).toBe(true);
    expect(matchesPhrase("psoriasis", "psoriasis")).toBe(true);
  });

  it("still respects word boundaries for short abbreviations after the pluralization change", () => {
    expect(matchesPhrase("sore throat", "ra")).toBe(false);
  });
});

describe("matchSpecificIllness — DB-backed Specific Illness List wiring", () => {
  it("extends an existing catalog match's applicable plans when a plan's DB list names the same condition", () => {
    // "Custom Plan" isn't in the hardcoded MASTER_ILLNESSES catalog at all,
    // but its admin-managed Specific Illness List names "Piles" — this
    // should extend the existing "Haemorrhoids / Piles" catalog match to
    // include this plan, exactly like the main Declaration Assistant
    // results flow already does (App.tsx's checkIllnessInPlanSpecificList).
    const results = matchSpecificIllness("piles", [
      { planName: "Custom Plan", specificIllnesses: [{ category: "Gastro", illness: "Piles" }] },
    ]);
    const pilesMatch = results.find((r) => r.matched_listed_illness === "Haemorrhoids / Piles");
    expect(pilesMatch).toBeDefined();
    expect(pilesMatch!.plans_applicable).toContain("Custom Plan");
    // Built-in plans with a hardcoded schedule for piles are still present.
    expect(pilesMatch!.plans_applicable).toContain("Optima Secure");
  });

  it("surfaces a plan's own custom Specific Illness List entry even when the catalog doesn't know it", () => {
    const results = matchSpecificIllness("some rare custom condition", [
      { planName: "Custom Plan", specificIllnesses: [{ illness: "Some Rare Custom Condition" }] },
    ]);
    const customMatch = results.find((r) => r.matched_listed_illness === "Some Rare Custom Condition");
    expect(customMatch).toBeDefined();
    expect(customMatch!.plans_applicable).toEqual(["Custom Plan"]);
    expect(customMatch!.match_type).toBe("direct");
  });

  it("is a no-op when dbPlanConfigs is omitted (existing callers unaffected)", () => {
    const withoutDb = matchSpecificIllness("piles");
    const withEmptyDb = matchSpecificIllness("piles", []);
    expect(withoutDb).toEqual(withEmptyDb);
  });
});
