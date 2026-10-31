/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import { checkStructure, extractMainTab, proposeStructure, type StructCell, type StructTab } from "./structure.js";
import { columnToNum } from "./a1.js";

// Synthetic main tab (D7): shapes copied from the real sheet, text partly real labels (they are structure, not content).
function cell(a1: string, text: string | null, extra: Partial<StructCell> = {}, gid = 0): StructCell {
  const m = /^([A-Z]+)(\d+)$/.exec(a1)!;
  return { sheetGid: gid, a1, rowNum: Number(m[2]), colNum: columnToNum(m[1]), valueKind: text === null ? "empty" : "text", rawText: text, numberRaw: null, coveredBy: null, mergeRange: null, ...extra };
}

function mainCells(overrides: Record<string, string | null> = {}): StructCell[] {
  const base: StructCell[] = [
    cell("B1", "   "),
    cell("D1", "HDFC Ergo Optima Secure"),
    cell("E1", "Care Advantage\n(Discontinued for Fresh & Porting applications)"),
    cell("F1", "Care Senior Health Advantage"),
    cell("G1", "Care Supreme Shine\n(Brochure)"),
    cell("B2", "Entry Age for Adults", { mergeRange: "B2:B3" }),
    cell("C2", "Min"),
    cell("B3", null, { coveredBy: "B2" }),
    cell("C3", "Max"),
    cell("B4", "Co- payment "),
    cell("C4", "Yes/No"),
    cell("B5", "Add-ons", { mergeRange: "B5:B6" }),
    cell("C5", null, { mergeRange: "C5:C6" }),
    cell("B6", null, { coveredBy: "B5" }),
    cell("C6", null, { coveredBy: "C5" }),
    cell("B7", "Other Points\n\nSynthetic note in the label"),
    cell("D7", "-"),
  ];
  return base.map((c) => (c.a1 in overrides ? { ...c, rawText: overrides[c.a1], valueKind: overrides[c.a1] === null ? "empty" : "text" } : c));
}
const tab2Cells = (pairBroken = false, header = "SNo."): StructCell[] => [
  cell("A1", header, {}, 9),
  cell("B1", "Specific Use cases", {}, 9),
  cell("D1", "Recommendation", {}, 9),
  cell("G1", "Customer wants more options", {}, 9),
  cell("C3", "Policy", {}, 9),
  cell("C4", pairBroken ? "Addons" : "Add-ons", {}, 9),
];
const mainTab: StructTab = { sheetGid: 0, title: "Ditto's Recommended Policies", hiddenRows: [], hiddenCols: [6] };
const tab2: StructTab = { sheetGid: 9, title: "Recommendation specifics", hiddenRows: [13], hiddenCols: [] };

describe("extractMainTab", () => {
  const s = extractMainTab(mainTab, mainCells());
  it("reads plan headers from column D exactly, with hidden flags", () => {
    expect(s.plans.map((p) => [p.col, p.header, p.hidden])).toEqual([
      ["D", "HDFC Ergo Optima Secure", false],
      ["E", "Care Advantage\n(Discontinued for Fresh & Porting applications)", false],
      ["F", "Care Senior Health Advantage", true],
      ["G", "Care Supreme Shine\n(Brochure)", false],
    ]);
  });
  it("follows merged labels, keeps exact spellings, and treats a merged empty sub-label as one entry", () => {
    expect(s.features.map((f) => [f.rows, f.label, f.subLabel])).toEqual([
      [[2], "Entry Age for Adults", "Min"],
      [[3], "Entry Age for Adults", "Max"],
      [[4], "Co- payment ", "Yes/No"],
      [[5, 6], "Add-ons", null],
      [[7], "Other Points\n\nSynthetic note in the label", null],
    ]);
  });
});

describe("proposeStructure", () => {
  const p = proposeStructure(extractMainTab(mainTab, mainCells()));
  it("suggests reviewed keys and provisional statuses (never visibility)", () => {
    expect(p.plans.map((x) => [x.planKey, x.status, x.keyFromMap])).toEqual([
      ["hdfc_optima_secure", "active", true],
      ["care_advantage", "discontinued_fresh_porting", true],
      ["care_senior_health_advantage", "hidden", true],
      ["care_supreme_shine", "brochure_only", true],
    ]);
    expect(p.plans.every((x) => x.expectedHeader.length > 0 && x.statusReason.includes("proposal only"))).toBe(true);
  });
  it("maps the exact labels to keys, including the odd spellings", () => {
    expect(p.features.map((f) => `${f.featureKey}.${f.subKey}`)).toEqual([
      "entry_age_adults.min", "entry_age_adults.max", "co_payment.yes_no", "add_ons.", "other_points.",
    ]);
  });
  it("flags an unknown header instead of guessing", () => {
    const q = proposeStructure(extractMainTab(mainTab, [...mainCells(), cell("H1", "Brand New Plan")]));
    expect(q.plans.at(-1)).toMatchObject({ planKey: "new_brand_new_plan", keyFromMap: false });
  });
});

describe("checkStructure", () => {
  const proposal = proposeStructure(extractMainTab(mainTab, mainCells()));
  const accepted = {
    plans: proposal.plans.map((p) => ({ planKey: p.planKey, expectedHeader: p.expectedHeader })),
    features: proposal.features.map((f) => ({ featureKey: f.featureKey, subKey: f.subKey, expectedLabel: f.expectedLabel, expectedSubLabel: f.expectedSubLabel, sortOrder: f.sortOrder })),
  };
  const run = (cells: StructCell[], opts: { t2?: StructCell[]; main?: StructTab; acc?: typeof accepted; prev?: { mainCols: string[]; tab2Rows: number[] } } = {}) =>
    checkStructure({ mainTab: opts.main ?? mainTab, tab2, cells: [...cells, ...(opts.t2 ?? tab2Cells())], accepted: opts.acc ?? accepted, previousHidden: opts.prev });

  it("reports when nothing has been accepted yet", () => {
    expect(run(mainCells(), { acc: { plans: [], features: [] } }).state).toBe("no_accepted_structure");
  });
  it("passes an unchanged sheet and maps plans to columns by header text", () => {
    const r = run(mainCells());
    expect(r).toMatchObject({ ok: true, state: "passed", problems: [] });
    expect(r.planColumns).toEqual({ hdfc_optima_secure: "D", care_advantage: "E", care_senior_health_advantage: "F", care_supreme_shine: "G" });
    expect(r.featureRows["add_ons"]).toEqual([5, 6]);
  });
  it("fails on a renamed plan header (even a one-space change)", () => {
    const r = run(mainCells({ D1: "HDFC Ergo Optima Secure " }));
    expect(r.state).toBe("failed");
    expect(r.problems.join(" ")).toMatch(/hdfc_optima_secure.*not found/);
    expect(r.problems.join(" ")).toMatch(/New plan column D/);
  });
  it("fails on a new plan column", () => {
    expect(run([...mainCells(), cell("H1", "Brand New Plan")]).problems.join(" ")).toMatch(/New plan column H/);
  });
  it("fails on a changed category label", () => {
    expect(run(mainCells({ B4: "Co-payment" })).problems.join(" ")).toMatch(/co_payment\.yes_no/);
  });
  it("passes when rows only move, and reports the new rows", () => {
    const moved = mainCells().map((c) => (c.rowNum >= 4 ? { ...c, rowNum: c.rowNum + 1, a1: c.a1.replace(/\d+$/, String(c.rowNum + 1)), coveredBy: c.coveredBy ? c.coveredBy.replace(/\d+$/, (d) => String(Number(d) + 1)) : null } : c));
    const r = run(moved);
    expect(r.state).toBe("passed");
    expect(r.featureRows["add_ons"]).toEqual([6, 7]);
  });
  it("lets hidden-flag changes pass but marks them for review", () => {
    const r = run(mainCells(), { prev: { mainCols: ["A"], tab2Rows: [13] } });
    expect(r.ok).toBe(true);
    expect(r.needsReview.join(" ")).toMatch(/Hidden columns on the main tab changed: A → F/);
  });
  it("fails on a changed tab-2 header or a broken Policy/Add-ons pair", () => {
    expect(run(mainCells(), { t2: tab2Cells(false, "S.No.") }).problems.join(" ")).toMatch(/Tab 2 A1/);
    expect(run(mainCells(), { t2: tab2Cells(true) }).problems.join(" ")).toMatch(/Policy"\/"Add-ons/);
  });
});
