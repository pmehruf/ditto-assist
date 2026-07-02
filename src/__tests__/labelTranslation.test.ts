/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from "vitest";
import {
  translateMatchTypeToLayman,
  translateFallbackToLayman,
  translateSourceToLayman,
} from "../utils/labelTranslation";

describe("translateMatchTypeToLayman", () => {
  it("returns a generic label for an empty/falsy match type", () => {
    expect(translateMatchTypeToLayman("")).toBe("Suggested Match");
  });

  it.each([
    ["P0", "Level 1: Exact Match"],
    ["EXACT", "Level 1: Exact Match"],
    ["P1", "Level 2: Related Category Match"],
    ["LIVE_MATCH", "Level 2: Related Category Match"],
    ["LIVE MATCH", "Level 2: Related Category Match"],
    ["P2", "Level 3: Generic Screen Match"],
    ["FALLBACK", "No Policy Exclusions Mapped"],
    ["ESCALATE", "Manual Underwriting Review"],
    ["NON_AILMENT", "Exempt Physiological State"],
  ])("maps %s -> %s", (input, expected) => {
    expect(translateMatchTypeToLayman(input)).toBe(expected);
  });

  it("is case-insensitive on known match types", () => {
    expect(translateMatchTypeToLayman("p0")).toBe("Level 1: Exact Match");
    expect(translateMatchTypeToLayman("fallback")).toBe("No Policy Exclusions Mapped");
  });

  it("title-cases and strips underscores from unrecognized match types", () => {
    expect(translateMatchTypeToLayman("SOME_UNKNOWN_TYPE")).toBe("Some Unknown Type");
  });
});

describe("translateFallbackToLayman", () => {
  it("returns a default for an empty/falsy fallback", () => {
    expect(translateFallbackToLayman("")).toBe("Direct Code Match");
  });

  it.each([
    ["INTENTIONAL SHIELD", "Policy Protected Benefit"],
    ["SHIELD", "Policy Protected Benefit"],
    ["GENERIC FALLBACK", "Suggested Assessment"],
    ["ROUTING ESCALATION", "Requires Officer Escalation"],
    ["ESCALATION", "Requires Officer Escalation"],
    ["N/A", "Direct Match"],
  ])("maps %s -> %s", (input, expected) => {
    expect(translateFallbackToLayman(input)).toBe(expected);
  });

  it("passes through unrecognized fallback values unchanged", () => {
    expect(translateFallbackToLayman("Some Custom Reason")).toBe("Some Custom Reason");
  });
});

describe("translateSourceToLayman", () => {
  it("returns a default for an empty/falsy source", () => {
    expect(translateSourceToLayman("")).toBe("Plan Mapping");
  });

  it.each([
    ["Deterministic Underwriting Rule", "Official Plan Rule"],
    ["Deterministic Engine", "Official Plan Rule"],
    ["Standard Policy Wording", "Official Plan Rule"],
    ["Insurer Registry Match", "Official Plan Rule"],
  ])("classifies %s as an official plan rule", (input) => {
    expect(translateSourceToLayman(input)).toBe("Official Plan Rule");
  });

  it.each([
    "Live Gemini API",
    "Disaster Recovery Local Rules Fallback",
  ])("classifies %s as a clinical assessment match (AI fallback)", (input) => {
    expect(translateSourceToLayman(input)).toBe("Clinical Assessment Match");
  });
});
