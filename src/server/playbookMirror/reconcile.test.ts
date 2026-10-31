/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-disable @typescript-eslint/no-explicit-any -- mutation tests edit stored rows in place */
import { gzipSync } from "zlib";
import { createHash } from "crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { createTestDb } from "../db/testUtils.js";
import { PlaybookMirrorSnapshotsRepository } from "../db/repositories/playbookMirrorSnapshotsRepository.js";
import { syncPlaybookMirror, type MirrorTextClient } from "./sync.js";
import { reconcileSnapshot, type ReconCell, type ReconSnapshot, type ReconTab } from "./reconcile.js";
import { SYNTHETIC_TABS, syntheticGrid, syntheticScan } from "./__fixtures__/syntheticSheet.js";

const client = (grid: unknown, scan: unknown): MirrorTextClient => ({
  email: "reader@joinditto.in",
  async requestText(url: string) {
    void url;
    void scan; // fixed configured ranges: one request, no scan
    return JSON.stringify(grid);
  },
});

describe("reconcileSnapshot (independent checker) — synthetic data", () => {
  let snap: ReconSnapshot;
  let tabs: ReconTab[];
  let cells: ReconCell[];
  const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));
  const run = (s = snap, t = tabs, c = cells) => reconcileSnapshot(s, t, c);
  const cellAt = (list: ReconCell[], a1: string, gid = 0) => list.find((c) => c.a1 === a1 && Number(c.sheetGid) === gid)!;

  beforeAll(async () => {
    const db = await createTestDb();
    const repo = new PlaybookMirrorSnapshotsRepository(db);
    const scan = syntheticScan() as any;
    scan.sheets[0].merges = syntheticGrid().sheets[0].merges;
    const r = await syncPlaybookMirror({ tabs: SYNTHETIC_TABS, snapshots: repo, trigger: "t", getClient: async () => client(syntheticGrid(), scan) });
    const row = (await repo.get(r.snapshotId!))!;
    snap = { rawResponseGzip: Buffer.from(row.rawResponseGzip), rawResponseBytes: row.rawResponseBytes, rawSha256: row.rawSha256 };
    tabs = (await repo.tabs(r.snapshotId!)).map((t) => ({ ...t, sheetGid: Number(t.sheetGid) }));
    cells = (await repo.cells(r.snapshotId!)).map((c) => ({ ...c, sheetGid: Number(c.sheetGid) }));
  });

  it("passes an untouched snapshot with zero differences and matching totals", () => {
    const r = run();
    expect(r.differences).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.raw).toEqual({ sha256Matches: true, bytesMatch: true, envelopeFormat: "playbook-mirror-raw-v2" });
    for (const v of Object.values(r.totals)) expect(v.raw).toBe(v.stored);
  });

  const mutations: [string, (c: ReconCell[], t: ReconTab[]) => void, RegExp][] = [
    ["one character of text changed", (c) => { cellAt(c, "D2").rawText = "1) Heading\nDetail text and lunk"; }, /D2: text differs/],
    ["leading space trimmed from a header", (c) => { cellAt(c, "D1").rawText = "Plan Alpha\r(Status note)"; }, /D1: text differs/],
    ["lone CR turned into LF", (c) => { cellAt(c, "D1").rawText = " Plan Alpha\n(Status note)"; }, /D1: text differs/],
    ["trailing space trimmed", (c) => { cellAt(c, "E1").rawText = "Plan Beta"; }, /E1: text differs/],
    ['"-" turned into blank', (c) => { cellAt(c, "E3").rawText = null; cellAt(c, "E3").valueKind = "empty"; }, /E3: text differs/],
    ['"- " turned into "-"', (c) => { cellAt(c, "E4").rawText = "-"; }, /E4: text differs/],
    ["number literal changed (1 -> 1.0)", (c) => { cellAt(c, "E2").numberRaw = "1.0"; }, /E2: number differs/],
    ["displayed value changed (100% -> 1)", (c) => { cellAt(c, "E2").formattedValue = "1"; }, /E2: displayed value differs/],
    ["bold removed from a heading run", (c) => { (cellAt(c, "D2").resolvedRuns as any[])[0].bold = false; }, /D2: processed formatting runs differ/],
    ["heading colour changed", (c) => { (cellAt(c, "D2").resolvedRuns as any[])[0].color = "#BF9000"; }, /D2: processed formatting runs differ/],
    ["link dropped from a run", (c) => { (cellAt(c, "D2").resolvedRuns as any[])[2].link = null; }, /D2: processed formatting runs differ/],
    ["raw formatting run altered", (c) => { (cellAt(c, "D2").textFormatRuns as any[])[1].format.bold = true; }, /D2: raw formatting runs differ/],
    ["note dropped", (c) => { cellAt(c, "E1").note = null; }, /E1: note differs/],
    ["note text altered", (c) => { cellAt(c, "E1").note = "Header note."; }, /E1: note differs/],
    ["cell deleted", (c) => { c.splice(c.indexOf(cellAt(c, "E3")), 1); }, /E3: in Google's response but missing/],
    ["extra cell invented", (c) => { c.push({ ...cellAt(c, "E3"), a1: "Z9", rowNum: 9, colNum: 26, rawText: "invented" }); }, /Z9: stored but not in Google's response/],
    ["merge pointer broken", (c) => { cellAt(c, "B3").coveredBy = "B1"; }, /B3: covered-by differs/],
    ["merge-filler cell given content", (c) => { cellAt(c, "D3").rawText = "x"; cellAt(c, "D3").valueKind = "text"; }, /D3: stored merge-filler cell is not empty/],
    ["merge list shortened", (_c, t) => { (t[0].mergesRaw as unknown[]).pop(); }, /merges differ/],
    ["hidden column flag lost", (_c, t) => { t[0].hiddenCols = []; }, /tab hiddenCols differs/],
    ["hidden row flag lost (tab 2)", (_c, t) => { t.find((x) => x.sheetGid !== 0)!.hiddenRows = []; }, /tab hiddenRows differs/],
    ["background colour of an empty cell lost", (c) => { cellAt(c, "D4").userEnteredFormat = null; }, /D4: raw format differs/],
  ];

  it.each(mutations)("catches: %s", (_name, mutate, expected) => {
    const c = clone(cells);
    const t = clone(tabs);
    mutate(c, t);
    const r = run(snap, t, c);
    expect(r.ok).toBe(false);
    expect(r.differences.join("\n")).toMatch(expected);
  });

  it("catches a tampered raw response (fingerprint)", () => {
    const tampered = { ...snap, rawResponseGzip: gzipSync(Buffer.from('{"format":"playbook-mirror-raw-v1","grid":"{}","scan":"{}"}')) };
    const r = run(tampered);
    expect(r.ok).toBe(false);
    expect(r.raw.sha256Matches).toBe(false);
  });

  it("catches a wrong recorded fingerprint even when the raw is intact", () => {
    const r = run({ ...snap, rawSha256: createHash("sha256").update("other").digest("hex") });
    expect(r.differences.join(" ")).toMatch(/SHA-256/);
  });
});
