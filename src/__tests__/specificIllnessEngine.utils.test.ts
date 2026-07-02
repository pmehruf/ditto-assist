/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from "vitest";
import { normalizePlanName, matchesPhrase } from "../specificIllnessEngine";

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
});
