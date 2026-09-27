/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from "vitest";
import { parseMatrixTab, splitInsurerAndPlan, diffPlanFacts } from "./playbookIngest.js";
import type { KbPlaybookPlanFactRow } from "../db/schema.js";
import type { CreateKbPlaybookPlanFactEntry } from "../db/repositories/kbPlaybookPlanFactsRepository.js";

describe("parseMatrixTab", () => {
  // "Ditto's Recommended Policies" config: rubricCol 0 (ignored), featureCol
  // 1, subFeatureCol 2, planStartCol 3, header row 0 — see playbookIngest.ts's
  // MATRIX_TABS.
  const rows: unknown[][] = [
    ["", "Feature", "Sub-feature", "HDFC Ergo Optima Secure+", "Niva Bupa Aspire"],
    ["", "Room Rent", "Single Private Room", "Covered up to X", "No limit"],
    ["", "", "Shared Room", "Covered", ""],
    ["", "Waiting Period", "Pre-existing Disease", "2 years", "3 years"],
  ];

  it("reshapes the matrix into one fact-sheet per plan column, forward-filling feature/sub-feature labels", () => {
    const entries = parseMatrixTab(rows, "Ditto's Recommended Policies");
    expect(entries).toHaveLength(2);

    const hdfc = entries.find(e => e.insurerName === "HDFC Ergo")!;
    expect(hdfc).toBeDefined();
    expect(hdfc.planName).toBe("Optima Secure+");
    expect(hdfc.sourceTab).toBe("Ditto's Recommended Policies");
    expect(hdfc.content).toContain("Room Rent — Single Private Room: Covered up to X");
    expect(hdfc.content).toContain("Room Rent — Shared Room: Covered");
    expect(hdfc.content).toContain("Waiting Period — Pre-existing Disease: 2 years");

    const niva = entries.find(e => e.insurerName === "Niva Bupa")!;
    expect(niva.planName).toBe("Aspire");
    expect(niva.content).toContain("Room Rent — Single Private Room: No limit");
    // Shared Room was blank for Niva Bupa (empty cell) — never emitted.
    expect(niva.content).not.toContain("Shared Room: ");
  });

  it("gives every plan an empty notes array when no notesGrid is passed", () => {
    const entries = parseMatrixTab(rows, "Ditto's Recommended Policies");
    for (const e of entries) expect(e.notes).toEqual([]);
  });

  describe("with a notesGrid (2026-09, Product Playbook advisor UI)", () => {
    // Same row/col shape as `rows` above — col 3 is HDFC's plan column, col
    // 4 is Niva Bupa's.
    const notesGrid: (string | undefined)[][] = [
      [undefined, undefined, undefined, "Plan withdrawn from sale in some states", undefined],
      [undefined, undefined, undefined, "Only for network hospitals", undefined],
    ];

    it("captures a note on the plan's header cell as {label: 'Plan', note}", () => {
      const entries = parseMatrixTab(rows, "Ditto's Recommended Policies", notesGrid);
      const hdfc = entries.find(e => e.insurerName === "HDFC Ergo")!;
      expect(hdfc.notes).toContainEqual({ label: "Plan", note: "Plan withdrawn from sale in some states" });
    });

    it("captures a note on a specific feature/sub-feature value cell, labeled with that row's own label", () => {
      const entries = parseMatrixTab(rows, "Ditto's Recommended Policies", notesGrid);
      const hdfc = entries.find(e => e.insurerName === "HDFC Ergo")!;
      expect(hdfc.notes).toContainEqual({ label: "Room Rent — Single Private Room", note: "Only for network hospitals" });
      // Only that one value cell had a note — not every HDFC line.
      expect(hdfc.notes).toHaveLength(2); // header note + this one
    });

    it("never leaks a note across plan columns", () => {
      const entries = parseMatrixTab(rows, "Ditto's Recommended Policies", notesGrid);
      const niva = entries.find(e => e.insurerName === "Niva Bupa")!;
      expect(niva.notes).toEqual([]);
    });

    it("leaves `content` byte-identical whether or not notes are present — Product Assist's prompt input must never change shape", () => {
      const withoutNotes = parseMatrixTab(rows, "Ditto's Recommended Policies");
      const withNotes = parseMatrixTab(rows, "Ditto's Recommended Policies", notesGrid);
      const hdfcWithout = withoutNotes.find(e => e.insurerName === "HDFC Ergo")!;
      const hdfcWith = withNotes.find(e => e.insurerName === "HDFC Ergo")!;
      expect(hdfcWith.content).toBe(hdfcWithout.content);
    });
  });
});

describe("splitInsurerAndPlan", () => {
  it("strips a known insurer prefix from a plan header", () => {
    expect(splitInsurerAndPlan("HDFC Ergo Optima Secure+")).toEqual({ insurer: "HDFC Ergo", plan: "Optima Secure+" });
  });

  it("falls back to the whole header for both insurer and plan when no known prefix matches", () => {
    expect(splitInsurerAndPlan("Some Unknown Co Super Plan")).toEqual({
      insurer: "Some Unknown Co Super Plan",
      plan: "Some Unknown Co Super Plan",
    });
  });

  // 2026-09 regression test — live wrong-answer report: Care Health's plan
  // headers were having "Care" stripped as if it were a redundant insurer
  // label (like "HDFC Ergo" is), producing plan_name="Supreme" that could
  // never match kb_categories.planNames's actual roster entry "Care
  // Supreme" (Care Health's plans genuinely include "Care" as part of the
  // marketed name). The insurer must still resolve to "Care" so insurer-
  // matching keeps working, but the plan name must keep the full "Care
  // Supreme" text intact.
  it("detects the insurer but keeps the full plan name for a PREFIX_IS_PART_OF_PLAN_NAME insurer (Care Health)", () => {
    expect(splitInsurerAndPlan("Care Supreme")).toEqual({ insurer: "Care", plan: "Care Supreme" });
    expect(splitInsurerAndPlan("Care Freedom")).toEqual({ insurer: "Care", plan: "Care Freedom" });
    expect(splitInsurerAndPlan("Care Heart")).toEqual({ insurer: "Care", plan: "Care Heart" });
  });

  // 2026-09 regression test — same investigation as above: "Ultimate Care"
  // is a real Care Health plan whose header doesn't start with "Care" at
  // all, so it used to fall through to the generic fallback and get stored
  // with insurerName="Ultimate Care" instead of "Care" — never matching the
  // "Care Health" category during findMatching's insurer check.
  it("resolves a PLAN_HEADER_INSURER_OVERRIDE header (Ultimate Care) to its real insurer while keeping the full plan name", () => {
    expect(splitInsurerAndPlan("Ultimate Care")).toEqual({ insurer: "Care", plan: "Ultimate Care" });
    expect(splitInsurerAndPlan("ultimate care")).toEqual({ insurer: "Care", plan: "ultimate care" });
  });
});

// 2026-09 — resync stats (added/removed/changed/unchanged), by admin
// request: the Resync button used to report only the new totals, with no
// way to tell whether anything actually changed. diffPlanFacts is the
// function behind those numbers in syncPlaybook's return value.
describe("diffPlanFacts", () => {
  const row = (overrides: Partial<KbPlaybookPlanFactRow>): KbPlaybookPlanFactRow => ({
    id: 1,
    resourceId: 1,
    domain: "Health",
    insurerName: "HDFC Ergo",
    planName: "Optima Secure+",
    sourceTab: "Ditto's Recommended Policies",
    content: "### HDFC Ergo Optima Secure+\n\nRoom Rent: Covered",
    notes: [],
    updatedAt: new Date(),
    ...overrides,
  });

  const entry = (overrides: Partial<CreateKbPlaybookPlanFactEntry>): CreateKbPlaybookPlanFactEntry => ({
    resourceId: 1,
    domain: "Health",
    insurerName: "HDFC Ergo",
    planName: "Optima Secure+",
    sourceTab: "Ditto's Recommended Policies",
    content: "### HDFC Ergo Optima Secure+\n\nRoom Rent: Covered",
    notes: [],
    ...overrides,
  });

  it("reports every entry as added when there was nothing before (first-ever sync)", () => {
    const result = diffPlanFacts([], [entry({}), entry({ planName: "Optima Secure Plus" })]);
    expect(result).toEqual({ added: 2, removed: 0, changed: 0, unchanged: 0 });
  });

  it("counts an identical (insurer, plan, content) match as unchanged", () => {
    const result = diffPlanFacts([row({})], [entry({})]);
    expect(result).toEqual({ added: 0, removed: 0, changed: 0, unchanged: 1 });
  });

  it("counts a same-plan different-content match as changed", () => {
    const result = diffPlanFacts([row({})], [entry({ content: "### HDFC Ergo Optima Secure+\n\nRoom Rent: No limit (updated)" })]);
    expect(result).toEqual({ added: 0, removed: 0, changed: 1, unchanged: 0 });
  });

  it("counts a plan present before but missing now as removed", () => {
    const result = diffPlanFacts([row({}), row({ planName: "Optima Secure Plus" })], [entry({})]);
    expect(result).toEqual({ added: 0, removed: 1, changed: 0, unchanged: 1 });
  });

  it("matches (insurer, plan) case-insensitively, same convention as findMatching", () => {
    const result = diffPlanFacts([row({ insurerName: "hdfc ergo", planName: "optima secure+" })], [entry({})]);
    expect(result).toEqual({ added: 0, removed: 0, changed: 0, unchanged: 1 });
  });

  it("ignores notes-only differences — content is the only thing that counts as a change", () => {
    const result = diffPlanFacts([row({ notes: [{ label: "Plan", note: "old note" }] })], [entry({})]);
    expect(result).toEqual({ added: 0, removed: 0, changed: 0, unchanged: 1 });
  });
});
