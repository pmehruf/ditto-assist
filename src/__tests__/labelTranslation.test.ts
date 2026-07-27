/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from "vitest";
import {
  translateMatchTypeToLayman,
  translateFallbackToLayman,
  translateSourceToLayman,
  getSourceInfo,
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
    "Deterministic Underwriting Rule",
    "Deterministic Engine",
  ])("classifies %s as a System Rule", (input) => {
    expect(translateSourceToLayman(input)).toBe("System Rule");
  });

  it("classifies a Gemini-based source as AI Generated", () => {
    expect(translateSourceToLayman("Live Gemini API")).toBe("AI Generated");
  });

  // Regression coverage for a real bug: both of these are local/offline
  // safety-net fallbacks (see App.tsx's executeLookupAll catch block and
  // server.ts's /api/match catch block) that fire when the backend or the
  // Gemini call itself is unreachable — no AI reasoning happens on this
  // path. The previous keyword check (substring "deterministic"/"standard"/
  // "registry") missed these, so the SOURCE column and the audit page's
  // source filter both mislabeled them as AI-generated.
  it.each([
    "Match API Error Fallback",
    "Disaster Recovery Local Rules",
  ])("classifies the offline fallback source %s as a System Rule, not AI", (input) => {
    expect(translateSourceToLayman(input)).toBe("System Rule");
  });
});

describe("getSourceInfo", () => {
  it("flags Gemini-based sources as AI-generated", () => {
    expect(getSourceInfo("Live Gemini API")).toEqual({ isSystemRule: false, label: "AI Generated" });
    expect(getSourceInfo("Clinical Guidance System AI")).toEqual({ isSystemRule: false, label: "AI Generated" });
  });

  it("flags deterministic and local-fallback sources as system rules", () => {
    expect(getSourceInfo("Deterministic Engine")).toEqual({ isSystemRule: true, label: "System Rule" });
    expect(getSourceInfo("Match API Error Fallback")).toEqual({ isSystemRule: true, label: "System Rule" });
    expect(getSourceInfo("Disaster Recovery Local Rules")).toEqual({ isSystemRule: true, label: "System Rule" });
  });

  it("treats a missing source as a system rule by default", () => {
    expect(getSourceInfo(null)).toEqual({ isSystemRule: true, label: "System Rule" });
    expect(getSourceInfo(undefined)).toEqual({ isSystemRule: true, label: "System Rule" });
  });
});
