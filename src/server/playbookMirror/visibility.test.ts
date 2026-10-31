/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-disable @typescript-eslint/no-explicit-any -- tests edit untyped synthetic Google JSON */
import { gunzipSync } from "zlib";
import { beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { createTestDb, type TestDb } from "../db/testUtils.js";
import { PlaybookMirrorSnapshotsRepository } from "../db/repositories/playbookMirrorSnapshotsRepository.js";
import { PlaybookMirrorStructureRepository } from "../db/repositories/playbookMirrorStructureRepository.js";
import { displayableCells, hiddenOf } from "./visibility.js";
import { diffSnapshots, type DiffSide } from "./diff.js";
import { checkStructure, type StructCell } from "./structure.js";
import { syncPlaybookMirror, type MirrorTextClient } from "./sync.js";
import { proposalForDisplay, proposeFromSnapshot } from "./structureService.js";
import { publishSnapshot } from "./publishService.js";
import { overview, readCellsFor, readGrid, readMeta, snapshotGrid } from "./adminService.js";
import { SYNTHETIC_TABS, syntheticGrid } from "./__fixtures__/syntheticSheet.js";

describe("hiddenOf / displayableCells", () => {
  const tab = { hiddenRows: [4], hiddenCols: [5], rowsHiddenByFilter: [7] };
  it("treats user-hidden and filter-hidden rows, and hidden columns, as hidden", () => {
    const h = hiddenOf(tab);
    expect([h.isHidden(4, 1), h.isHidden(7, 1), h.isHidden(1, 5), h.isHidden(1, 4)]).toEqual([true, true, true, false]);
    expect([h.isHiddenA1("E2"), h.isHiddenA1("D2")]).toEqual([true, false]);
  });
  it("removes hidden cells and blanks a visible cell whose merge anchor is hidden", () => {
    const cells = [
      { a1: "D4", rowNum: 4, colNum: 4, coveredBy: null, text: "hidden row" },
      { a1: "E1", rowNum: 1, colNum: 5, coveredBy: null, text: "hidden col" },
      { a1: "D5", rowNum: 5, colNum: 4, coveredBy: "D4", text: null },
      { a1: "D1", rowNum: 1, colNum: 4, coveredBy: null, text: "visible" },
    ];
    expect(displayableCells(cells, tab)).toEqual([
      { a1: "D5", rowNum: 5, colNum: 4, coveredBy: null, text: null },
      { a1: "D1", rowNum: 1, colNum: 4, coveredBy: null, text: "visible" },
    ]);
  });
});

describe("difference report never lists hidden content", () => {
  const cell = (a1: string, rawText: string | null) => {
    const m = /^([A-Z]+)(\d+)$/.exec(a1)!;
    return { sheetGid: 0, a1, rowNum: Number(m[2]), colNum: m[1].charCodeAt(0) - 64, rawText, numberRaw: null, formattedValue: rawText, note: null, textFormatRuns: null, effectiveFormat: null, userEnteredFormat: null, resolvedRuns: null, hyperlink: null };
  };
  const side = (id: number, d4: string, e1: string, d1: string, hiddenCols: number[]): DiffSide => ({
    snapshotId: id,
    structureReport: { state: "passed", planColumns: {}, featureRows: {} },
    tabs: [{ sheetGid: 0, title: "Ditto's Recommended Policies", hiddenRows: [4], hiddenCols, mergesRaw: [] }],
    cells: [cell("D4", d4), cell("E1", e1), cell("D1", d1)],
  });
  it("counts changes in hidden rows/columns without showing them", () => {
    const r = diffSnapshots(side(1, "secret-a", "secret-x", "old", [5]), side(2, "secret-b", "secret-y", "new", [5]), "chosen");
    expect(r.cells.map((c) => c.a1)).toEqual(["D1"]);
    expect(r.counts["changes in hidden rows/columns (not shown)"]).toBe(2);
    expect(JSON.stringify(r)).not.toMatch(/secret/);
  });
  it("hides a change if the cell is hidden in either snapshot", () => {
    const r = diffSnapshots(side(1, "a", "x", "same", []), side(2, "a", "y", "same", [5]), "chosen");
    expect(r.cells).toEqual([]);
    expect(JSON.stringify(r)).not.toMatch(/"x"|"y"/);
  });
});

describe("structure-check messages never quote hidden content", () => {
  const c = (a1: string, rawText: string, extra: Partial<StructCell> = {}): StructCell => {
    const m = /^([A-Z]+)(\d+)$/.exec(a1)!;
    return { sheetGid: 0, a1, rowNum: Number(m[2]), colNum: [...m[1]].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0), valueKind: "text", rawText, numberRaw: null, coveredBy: null, mergeRange: null, ...extra };
  };
  it("does not quote a new header in a hidden column, a hidden row's labels, or any accepted header", () => {
    const r = checkStructure({
      mainTab: { sheetGid: 0, title: "Ditto's Recommended Policies", hiddenRows: [3], hiddenCols: [6] },
      tab2: undefined,
      cells: [c("D1", "Visible Plan"), c("F1", "SECRET hidden plan"), c("B2", "Cover"), c("B3", "SECRET hidden label")],
      accepted: {
        plans: [{ planKey: "visible", expectedHeader: "Visible Plan" }, { planKey: "gone", expectedHeader: "SECRET accepted header" }],
        features: [
          { featureKey: "cover", subKey: "", expectedLabel: "Cover", expectedSubLabel: null, sortOrder: 0 },
          { featureKey: "other", subKey: "", expectedLabel: "Other", expectedSubLabel: null, sortOrder: 1 },
        ],
      },
    });
    expect(r.state).toBe("failed");
    const text = r.problems.join(" ");
    expect(text).toMatch(/New plan column F: \(column hidden in the sheet; header not shown\)/);
    expect(text).toMatch(/Plan "gone": its accepted header was not found/);
    expect(text).toMatch(/row hidden in the sheet; text not shown/);
    expect(text).not.toMatch(/SECRET/);
  });
});

describe("end to end with a hidden PLAN column (synthetic, local database)", () => {
  let db: TestDb;
  let snapshots: PlaybookMirrorSnapshotsRepository;
  let structure: PlaybookMirrorStructureRepository;
  const client = (grid: unknown): MirrorTextClient => ({ email: "reader@joinditto.in", requestText: async () => JSON.stringify(grid) });

  beforeEach(async () => {
    db = await createTestDb();
    snapshots = new PlaybookMirrorSnapshotsRepository(db);
    structure = new PlaybookMirrorStructureRepository(db);
  });

  it("stores hidden content in the raw snapshot but never displays or serves it", async () => {
    const grid = syntheticGrid() as any;
    grid.sheets[0].data[0].columnMetadata = [{ hiddenByUser: true }, {}, {}, {}, { hiddenByUser: true }]; // A and E (plan "Plan Beta ") hidden
    const first = await syncPlaybookMirror({ tabs: SYNTHETIC_TABS, snapshots, trigger: "t", getClient: async () => client(grid) });
    const p = await proposeFromSnapshot({ snapshots, structure }, first.snapshotId!);
    await structure.acceptInitial(
      "Health",
      p.plans.map((x, i) => ({ planKey: `plan_${x.column}`, insurer: "Synthetic", displayName: x.displayName, expectedHeader: x.expectedHeader, status: x.status, sortOrder: i })),
      p.features.map((f, i) => ({ featureKey: `feature_${i}`, subKey: f.subKey, expectedLabel: f.expectedLabel, expectedSubLabel: f.expectedSubLabel, sortOrder: i })),
      "reviewer@joinditto.in"
    );
    const grid2 = JSON.parse(JSON.stringify(grid));
    grid2.sheets[0].data[0].rowData[2].values[3] = { userEnteredValue: { stringValue: "changed" }, formattedValue: "changed" }; // D3: new raw
    const snap = await syncPlaybookMirror({ tabs: SYNTHETIC_TABS, snapshots, structure, trigger: "t2", getClient: async () => client(grid2) });
    expect(snap.status).toBe("verified");

    // Raw snapshot keeps everything (audit), including the hidden column's header and the visibility metadata.
    const raw = await db.execute(sql`select raw_response_gzip from playbook_snapshots where id = ${snap.snapshotId!}`);
    expect(gunzipSync(Buffer.from((raw.rows[0] as any).raw_response_gzip)).toString("utf8")).toContain("Plan Beta ");
    expect((await snapshots.tabs(snap.snapshotId!)).find((t) => t.sheetGid === 0)!.hiddenCols).toEqual([1, 5]);

    // Admin grid: no hidden row (4) or hidden column (A, E) cells at all.
    const gridView = (await snapshotGrid(db, snap.snapshotId!, 0))!;
    expect(gridView.cells.some((c) => c.colNum === 1 || c.colNum === 5 || c.rowNum === 4)).toBe(false);
    expect(JSON.stringify(gridView)).not.toContain("Plan Beta");
    expect(JSON.stringify(gridView)).not.toContain("Header note");

    // The admin summary never carries hidden content (e.g. the hidden plan's header).
    const o = await overview(db);
    expect(JSON.stringify(o)).not.toContain("Plan Beta");

    // Proposal view withholds it too.
    expect(JSON.stringify(await proposalForDisplay({ snapshots, structure }, snap.snapshotId!))).not.toContain("Plan Beta");

    // Read API (all users): a plan in a hidden column is never served; visible plans are.
    await publishSnapshot(db, snap.snapshotId!, "admin@joinditto.in");
    const meta = await readMeta(db);
    expect(meta.plans.map((x) => x.planKey)).toEqual(["plan_D"]);
    expect(JSON.stringify(meta)).not.toContain("Plan Beta");
    expect(await readCellsFor(db, ["plan_E"], [])).toEqual({ ok: false, error: "Not available: plan_E." });
    // A category whose only row is hidden (row 4) is not listed.
    expect(meta.features.some((f) => f.label === "Feature Two")).toBe(false);
    // The user grid of a tab never contains hidden rows/columns.
    const userGrid = await readGrid(db, "Ditto's Recommended Policies");
    if (!userGrid.ok) throw new Error("expected a published grid");
    expect(userGrid.cells.some((c) => c.colNum === 1 || c.colNum === 5 || c.rowNum === 4)).toBe(false);
    expect(JSON.stringify(userGrid)).not.toContain("Plan Beta");
  });
});
