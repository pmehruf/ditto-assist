/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from "vitest";
import { parseTermMatrixTab, parseTermGlossaryTab, parseRecommendationSpecificTab } from "./termPlaybookIngest.js";

describe("parseTermMatrixTab", () => {
  it("reshapes 'Ditto's Recommended Policies' (feature/sub-feature, header row 1, no rubric column) into one fact-sheet per plan column", () => {
    const rows: unknown[][] = [
      ["Features", "", "HDFC Life Click 2 Protect Supreme Plus", "ICICI Prudential iProtect Smart Plus"],
      ["Entry Age", "Min Age", 18, 18],
      ["", "Max Age", 65, 60],
      ["Educational Qualification", "Min. education", "SSC/10th", "HSC/12th"],
    ];
    const entries = parseTermMatrixTab(rows, "Ditto's Recommended Policies");
    expect(entries).toHaveLength(2);

    const hdfc = entries.find(e => e.insurerName === "HDFC Life")!;
    expect(hdfc).toBeDefined();
    expect(hdfc.planName).toBe("Click 2 Protect Supreme Plus");
    expect(hdfc.sourceTab).toBe("Ditto's Recommended Policies");
    expect(hdfc.domain).toBe("Term");
    expect(hdfc.content).toContain("Entry Age — Min Age: 18");
    expect(hdfc.content).toContain("Entry Age — Max Age: 65");
    expect(hdfc.content).toContain("Educational Qualification — Min. education: SSC/10th");

    const icici = entries.find(e => e.insurerName === "ICICI Prudential")!;
    expect(icici.planName).toBe("iProtect Smart Plus");
    expect(icici.content).toContain("Entry Age — Max Age: 60");
  });

  it("strips the full 'Axis Max Life Insurance' prefix, and the shorter 'Bajaj Life' prefix, from their plan headers", () => {
    const rows: unknown[][] = [
      ["Features", "", "Axis Max Life Insurance Smart Term Plan Plus", "Bajaj Life eTouch II"],
      ["Entry Age", "Min Age", 18, 18],
    ];
    const entries = parseTermMatrixTab(rows, "Ditto's Recommended Policies");
    const axis = entries.find(e => e.insurerName === "Axis Max Life Insurance")!;
    expect(axis.planName).toBe("Smart Term Plan Plus");
    const bajaj = entries.find(e => e.insurerName === "Bajaj Life")!;
    expect(bajaj.planName).toBe("eTouch II");
  });

  it("reshapes 'NRI Eligibility & Recommendation' using its own header row index (row 2, single-level feature column)", () => {
    const rows: unknown[][] = [
      ["", "Primary Recommendation", "", ""],
      ["Policies", "Bajaj Life eTouch II", "Axis Max Life Insurance Smart Term Plan Plus", "ICICI Prudential iProtect Smart Plus"],
      ["Min age (Yrs)", 18, 18, 18],
      ["Max age (Yrs)", 60, 60, 60],
      ["Max cover amount", "20 cr", "25 Cr", "10 Cr"],
    ];
    const entries = parseTermMatrixTab(rows, "NRI Eligibility & Recommendation");
    expect(entries).toHaveLength(3);
    const bajaj = entries.find(e => e.insurerName === "Bajaj Life")!;
    expect(bajaj.planName).toBe("eTouch II");
    expect(bajaj.content).toContain("Min age (Yrs): 18");
    expect(bajaj.content).toContain("Max cover amount: 20 cr");
    expect(bajaj.domain).toBe("Term");
  });

  it("returns nothing for an unconfigured tab name or a tab shorter than its header row", () => {
    expect(parseTermMatrixTab([["a", "b"]], "Some Other Tab")).toEqual([]);
    expect(parseTermMatrixTab([["only one row"]], "NRI Eligibility & Recommendation")).toEqual([]);
  });

  it("gives every plan an empty notes array when no notesGrid is passed", () => {
    const rows: unknown[][] = [
      ["Features", "", "HDFC Life Click 2 Protect Supreme Plus", "ICICI Prudential iProtect Smart Plus"],
      ["Entry Age", "Min Age", 18, 18],
    ];
    const entries = parseTermMatrixTab(rows, "Ditto's Recommended Policies");
    for (const e of entries) expect(e.notes).toEqual([]);
  });

  describe("with a notesGrid (2026-09, Product Playbook advisor UI)", () => {
    it("uses config.headerRowIndex (not always row 0) to find the plan header note, for a tab whose header sits on a later row", () => {
      // "NRI Eligibility & Recommendation" — headerRowIndex 1 (row 0 is a
      // decorative section title, matching syncTermPlaybook's own MATRIX_TABS
      // config).
      const rows: unknown[][] = [
        ["", "Primary Recommendation", "", ""],
        ["Policies", "Bajaj Life eTouch II", "Axis Max Life Insurance Smart Term Plan Plus", "ICICI Prudential iProtect Smart Plus"],
        ["Min age (Yrs)", 18, 18, 18],
      ];
      const notesGrid: (string | undefined)[][] = [
        [],
        [undefined, "Only sold via this NRI-eligible variant", undefined, undefined],
        [undefined, "Subject to medical underwriting", undefined, undefined],
      ];
      const entries = parseTermMatrixTab(rows, "NRI Eligibility & Recommendation", notesGrid);
      const bajaj = entries.find(e => e.insurerName === "Bajaj Life")!;
      expect(bajaj.notes).toContainEqual({ label: "Plan", note: "Only sold via this NRI-eligible variant" });
      expect(bajaj.notes).toContainEqual({ label: "Min age (Yrs)", note: "Subject to medical underwriting" });

      const axis = entries.find(e => e.insurerName === "Axis Max Life Insurance")!;
      expect(axis.notes).toEqual([]);
    });

    it("leaves `content` byte-identical whether or not notes are present", () => {
      const rows: unknown[][] = [
        ["Features", "", "HDFC Life Click 2 Protect Supreme Plus"],
        ["Entry Age", "Min Age", 18],
      ];
      const notesGrid: (string | undefined)[][] = [[], [undefined, undefined, "note on the value cell"]];
      const withoutNotes = parseTermMatrixTab(rows, "Ditto's Recommended Policies");
      const withNotes = parseTermMatrixTab(rows, "Ditto's Recommended Policies", notesGrid);
      expect(withNotes[0].content).toBe(withoutNotes[0].content);
    });
  });
});

describe("parseTermGlossaryTab", () => {
  it("reshapes a single-value-column glossary (Features Description) into one section per feature", () => {
    const rows: unknown[][] = [
      ["Features", "Description"],
      ["Maturity Age", "This is the age at which the policy term ends."],
      ["Terminal Illness", "Terminal Illness Benefit provides an advance payout of the sum assured."],
    ];
    const text = parseTermGlossaryTab(rows);
    expect(text).toContain("### Maturity Age");
    expect(text).toContain("Description: This is the age at which the policy term ends.");
    expect(text).toContain("### Terminal Illness");
  });

  it("reshapes a two-value-column glossary (NRI vs OCI) with both columns prefixed by their own header", () => {
    const rows: unknown[][] = [
      ["Criteria", "NRI (Non-Resident Indian)", "OCI (Overseas Citizen of India)"],
      ["Who are they?", "An Indian citizen living outside India.", "A foreign national of Indian origin."],
    ];
    const text = parseTermGlossaryTab(rows);
    expect(text).toContain("### Who are they?");
    expect(text).toContain("NRI (Non-Resident Indian): An Indian citizen living outside India.");
    expect(text).toContain("OCI (Overseas Citizen of India): A foreign national of Indian origin.");
  });

  it("returns an empty string for an empty tab", () => {
    expect(parseTermGlossaryTab([])).toBe("");
  });
});

describe("parseRecommendationSpecificTab", () => {
  it("groups by Specific Use case (column B), folding the Policy/Add Ons row-type into each line's label rather than treating it as its own group", () => {
    const rows: unknown[][] = [
      ["SN", "Specific Use case", "", "Primary Recommendations", "", "Secondary Recommendations"],
      [1, "Standard Profiles (No PEDs)", "Policy", "Smart Term Plan Plus", "", "Click 2 Protect Supreme Plus"],
      ["", "", "Add Ons", "CI, WOP", "", "CI, WOP"],
      [2, "NRI profiles", "Policy", "eTouch II", "", "Smart Term Plan Plus"],
      ["", "", "Add Ons", "As per availability", "", "As per availability"],
    ];
    const text = parseRecommendationSpecificTab(rows);

    expect(text).toContain("### Standard Profiles (No PEDs)");
    expect(text).toContain("Primary Recommendations Policy: Smart Term Plan Plus");
    expect(text).toContain("Primary Recommendations Add Ons: CI, WOP");
    expect(text).toContain("Secondary Recommendations Policy: Click 2 Protect Supreme Plus");

    expect(text).toContain("### NRI profiles");
    expect(text).toContain("Primary Recommendations Policy: eTouch II");

    // Exactly 2 groups (one per use case) — never collapsed into just
    // "Policy"/"Add Ons" buckets.
    expect(text.match(/^### /gm)).toHaveLength(2);
  });

  it("returns an empty string for an empty tab", () => {
    expect(parseRecommendationSpecificTab([])).toBe("");
  });
});
