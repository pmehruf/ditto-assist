/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import { readCells, visiblePlans, type PublishedContext, type ReadCellRow, type ReadFeature, type ReadPlan } from "./readService.js";

// Synthetic (D7). Column A holds a "QA guide" text; column S is hidden; row 13 is hidden.
const ctx: PublishedContext = {
  snapshotId: 7,
  publishedAt: "2026-10-30T00:00:00Z",
  fetchedAt: "2026-10-30T00:00:00Z",
  mainSheetGid: 0,
  hiddenCols: [1, 19],
  hiddenRows: [13],
  planColumns: { alpha: "D", beta: "E", hiddenPlan: "S", sneaky: "A" },
  featureRows: { ambulance: [12, 13], cover: [14], add_ons: [15, 16] },
};
const plan = (planKey: string, confirmed: boolean, show: boolean, sortOrder = 0): ReadPlan => ({
  planKey, insurer: "I", displayName: planKey, expectedHeader: planKey, status: "active",
  statusConfirmedBy: confirmed ? "product@joinditto.in" : null, statusConfirmedAt: confirmed ? "2026-10-30" : null, showToAdvisors: show, sortOrder,
});
const plans = [plan("alpha", true, true, 0), plan("beta", true, true, 1), plan("unconfirmed", false, true), plan("notEnabled", true, false), plan("hiddenPlan", true, true), plan("sneaky", true, true)];
const features: ReadFeature[] = [
  { featureKey: "ambulance", subKey: "", expectedLabel: "Ambulance", expectedSubLabel: null, sortOrder: 0 },
  { featureKey: "cover", subKey: "", expectedLabel: "Cover", expectedSubLabel: null, sortOrder: 1 },
  { featureKey: "add_ons", subKey: "", expectedLabel: "Add-ons", expectedSubLabel: null, sortOrder: 2 },
];
const c = (a1: string, rawText: string | null, extra: Partial<ReadCellRow> = {}): ReadCellRow => {
  const m = /^([A-Z]+)(\d+)$/.exec(a1)!;
  return { sheetGid: 0, a1, rowNum: Number(m[2]), colNum: [...m[1]].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0), valueKind: rawText === null ? "empty" : "text", rawText, numberRaw: null, formattedValue: rawText, resolvedRuns: null, note: null, coveredBy: null, ...extra };
};
const cells = [
  c("A12", "QA rating guide text"), c("D12", "Road: covered"), c("D13", "Hidden row content"), c("E12", " Leading space\r"),
  c("D14", "-"), c("E14", null), c("D15", "1) Add-on one", { note: "A note" }), c("D16", null, { coveredBy: "D15" }), c("S12", "Hidden column content"),
];

describe("visiblePlans", () => {
  it("returns only confirmed, advisor-enabled plans in visible plan columns", () => {
    expect(visiblePlans(plans, ctx).map((p) => p.planKey)).toEqual(["alpha", "beta"]);
  });
  it("returns nothing when nothing is published", () => {
    expect(visiblePlans(plans, null)).toEqual([]);
  });
});

describe("readCells", () => {
  const run = (planKeys: string[], featureKeys: string[] = []) => readCells({ ctx, plans, features, cells, planKeys, featureKeys });

  it("returns exact text, follows merges, keeps '-' vs blank, and skips hidden rows", () => {
    const r = run(["alpha", "beta"]);
    if ("error" in r) throw new Error(r.error);
    const get = (p: string, a1: string) => r.cells.find((x) => x.planKey === p && x.a1 === a1);
    expect(get("alpha", "D12")?.rawText).toBe("Road: covered");
    expect(get("beta", "E12")?.rawText).toBe(" Leading space\r");
    expect(get("alpha", "D13")).toBeUndefined(); // hidden row 13
    expect(get("alpha", "D14")).toMatchObject({ rawText: "-", isEmpty: false });
    expect(get("beta", "E14")).toMatchObject({ rawText: null, isEmpty: true });
    expect(get("alpha", "D16")).toMatchObject({ readFrom: "D15", rawText: "1) Add-on one", note: "A note" });
  });

  it("never returns column A, hidden-column, unconfirmed or not-enabled plans", () => {
    for (const k of ["sneaky", "hiddenPlan", "unconfirmed", "notEnabled"]) {
      expect(run([k])).toEqual({ ok: false, error: `Not available: ${k}.` });
    }
    const all = run(["alpha", "beta"]);
    if ("error" in all) throw new Error(all.error);
    expect(all.cells.some((x) => x.a1.startsWith("A") || x.readFrom.startsWith("A") || x.rawText === "QA rating guide text")).toBe(false);
    expect(all.cells.some((x) => x.rawText === "Hidden column content" || x.rawText === "Hidden row content")).toBe(false);
  });

  it("limits to four plans, rejects unknown categories, and refuses when nothing is published", () => {
    expect(run(["a", "b", "c", "d", "e"])).toEqual({ ok: false, error: "At most 4 plans at a time." });
    expect(run(["alpha"], ["nope"])).toEqual({ ok: false, error: "Unknown categories: nope." });
    expect(readCells({ ctx: null, plans, features, cells, planKeys: ["alpha"], featureKeys: [] })).toEqual({ ok: false, error: "Nothing has been published yet." });
  });

  it("filters by category when asked", () => {
    const r = run(["alpha"], ["cover"]);
    if ("error" in r) throw new Error(r.error);
    expect(r.cells.map((x) => x.a1)).toEqual(["D14"]);
  });
});
