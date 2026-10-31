/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { createHash } from "crypto";
import { gunzipSync } from "zlib";
/* eslint-disable @typescript-eslint/no-explicit-any -- tests edit untyped synthetic Google JSON */
import { beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { createTestDb, type TestDb } from "../db/testUtils.js";
import { PlaybookMirrorSnapshotsRepository } from "../db/repositories/playbookMirrorSnapshotsRepository.js";
import { syncPlaybookMirror, RAW_ENVELOPE_FORMAT, type MirrorTextClient } from "./sync.js";
import { SYNTHETIC_TABS, syntheticGrid, syntheticScan } from "./__fixtures__/syntheticSheet.js";

function fakeClient(grid: unknown, scan: unknown): MirrorTextClient & { urls: string[] } {
  const urls: string[] = [];
  return {
    email: "reader@joinditto.in",
    urls,
    async requestText(url: string) {
      urls.push(url);
      void scan; // the whole-tab scan no longer exists (fixed configured ranges only)
      return JSON.stringify(grid);
    },
  };
}

describe("syncPlaybookMirror (synthetic data, local database)", () => {
  let db: TestDb;
  let snapshots: PlaybookMirrorSnapshotsRepository;

  beforeEach(async () => {
    db = await createTestDb();
    snapshots = new PlaybookMirrorSnapshotsRepository(db);
  });

  it("stores the raw response exactly, with a matching fingerprint, plus exact cells", async () => {
    const client = fakeClient(syntheticGrid(), syntheticScan());
    const result = await syncPlaybookMirror({ tabs: SYNTHETIC_TABS, snapshots, trigger: "test", getClient: async () => client });
    expect(result).toMatchObject({ ok: true, status: "fetched" });
    // ONE request, for exactly the configured ranges.
    expect(client.urls).toHaveLength(1);
    expect(client.urls[0].startsWith("https://sheets.googleapis.com/v4/spreadsheets/")).toBe(true);
    const requested = new URL(client.urls[0]).searchParams.getAll("ranges");
    expect(requested).toEqual(["'Ditto''s Recommended Policies'!A1:E10", "'Recommendation specifics'!A1:G10"]);

    const rows = await db.execute(sql`select raw_response_gzip, raw_sha256, raw_response_bytes, status, fetched_via from playbook_snapshots`);
    const row = rows.rows[0] as { raw_response_gzip: Uint8Array; raw_sha256: string; raw_response_bytes: number; status: string; fetched_via: string };
    const envelope = gunzipSync(Buffer.from(row.raw_response_gzip)).toString("utf8");
    expect(createHash("sha256").update(envelope, "utf8").digest("hex")).toBe(row.raw_sha256);
    expect(Buffer.byteLength(envelope, "utf8")).toBe(row.raw_response_bytes);
    const parsed = JSON.parse(envelope);
    expect(parsed.format).toBe(RAW_ENVELOPE_FORMAT);
    expect(parsed.grid).toBe(JSON.stringify(syntheticGrid()));
    expect(parsed.scan).toBeUndefined();
    expect(parsed.ranges).toEqual(requested);
    expect(row.fetched_via).toBe("reader@joinditto.in");

    const cells = await snapshots.cells(result.snapshotId!);
    const d1 = cells.find((c) => c.a1 === "D1" && c.sheetGid === 0)!;
    expect(d1.rawText).toBe(" Plan Alpha\r(Status note)");
    const tabs = await snapshots.tabs(result.snapshotId!);
    expect(tabs.map((t) => [t.title, t.hiddenCols, t.hiddenRows])).toEqual(
      expect.arrayContaining([["Ditto's Recommended Policies", [1], [4]], ["Recommendation specifics", [], [2]]])
    );
    expect(result.counts).toMatchObject({ tabs: 2, notes: 1, merges: 2, runLinks: 1 });

    const state = await snapshots.getSyncState();
    expect(state).toMatchObject({ lastTrigger: "test", lastError: null, lastSnapshotId: result.snapshotId });
  });

  it("creates no new snapshot when the sheet hasn't changed", async () => {
    const first = await syncPlaybookMirror({ tabs: SYNTHETIC_TABS, snapshots, trigger: "t1", getClient: async () => fakeClient(syntheticGrid(), syntheticScan()) });
    const second = await syncPlaybookMirror({ tabs: SYNTHETIC_TABS, snapshots, trigger: "t2", getClient: async () => fakeClient(syntheticGrid(), syntheticScan()) });
    expect(second).toMatchObject({ ok: true, skipped: true, snapshotId: first.snapshotId });
    expect(await snapshots.list()).toHaveLength(1);
  });

  it("stores but rejects a snapshot whose data doesn't start at the configured range, and warns", async () => {
    const tabs = [{ ...SYNTHETIC_TABS[0], range: "B1:E10" }, SYNTHETIC_TABS[1]];
    const result = await syncPlaybookMirror({ tabs, snapshots, trigger: "t", getClient: async () => fakeClient(syntheticGrid(), syntheticScan()) });
    expect(result).toMatchObject({ ok: true, status: "rejected" });
    expect(result.rejectedReason).toMatch(/not at the configured range B1:E10/);
    expect((await snapshots.getSyncState())?.lastError).toMatch(/Latest snapshot rejected/);
  });

  it("never stores a cell, or creates a merge-filler cell, outside the configured range", async () => {
    const grid = syntheticGrid() as any;
    grid.sheets[0].merges.push({ sheetId: 0, startRowIndex: 8, endRowIndex: 14, startColumnIndex: 0, endColumnIndex: 1 }); // A9:A14 crosses row 10
    const result = await syncPlaybookMirror({ tabs: SYNTHETIC_TABS, snapshots, trigger: "t", getClient: async () => fakeClient(grid, syntheticScan()) });
    const cells = await snapshots.cells(result.snapshotId!, 0);
    expect(cells.every((c) => c.rowNum <= 10 && c.colNum <= 5)).toBe(true);
    expect(cells.find((c) => c.a1 === "A10")).toMatchObject({ coveredBy: "A9" });
    expect(cells.find((c) => c.a1 === "A11")).toBeUndefined();
  });

  it("rejects a snapshot whose tabs don't match the configured titles", async () => {
    const grid = syntheticGrid();
    grid.sheets[0].properties.title = "Dittos Recommended Policies";
    const result = await syncPlaybookMirror({ tabs: SYNTHETIC_TABS, snapshots, trigger: "t", getClient: async () => fakeClient(grid, syntheticScan()) });
    expect(result).toMatchObject({ ok: true, status: "rejected" });
    expect(result.rejectedReason).toMatch(/do not match the configured tabs/);
  });

  it("stores nothing and records the error when the read-only grant can't be verified", async () => {
    const result = await syncPlaybookMirror({
      snapshots,
      trigger: "t",
      getClient: async () => {
        throw new Error("This Google grant carries more than read-only access");
      },
    });
    expect(result).toEqual({ ok: false, error: "This Google grant carries more than read-only access" });
    expect(await snapshots.list()).toHaveLength(0);
    expect((await snapshots.getSyncState())?.lastError).toMatch(/more than read-only/);
  });

  it("never touches the published pointer", async () => {
    await syncPlaybookMirror({ tabs: SYNTHETIC_TABS, snapshots, trigger: "t", getClient: async () => fakeClient(syntheticGrid(), syntheticScan()) });
    const rows = await db.execute(sql`select count(*)::int as n from playbook_published`);
    expect((rows.rows[0] as { n: number }).n).toBe(0);
  });
});
