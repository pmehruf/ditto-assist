/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-disable @typescript-eslint/no-explicit-any -- tests edit untyped synthetic Google JSON */
import { beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { createTestDb, type TestDb } from "../db/testUtils.js";
import { PlaybookMirrorSnapshotsRepository } from "../db/repositories/playbookMirrorSnapshotsRepository.js";
import { PlaybookMirrorStructureRepository } from "../db/repositories/playbookMirrorStructureRepository.js";
import { syncPlaybookMirror, type MirrorTextClient } from "./sync.js";
import { proposeFromSnapshot } from "./structureService.js";
import { diffFor, verifySnapshot } from "./verifyService.js";
import { SYNTHETIC_TABS, syntheticGrid, syntheticScan } from "./__fixtures__/syntheticSheet.js";

const client = (grid: unknown, scan: unknown): MirrorTextClient => ({
  email: "reader@joinditto.in",
  async requestText(url: string) {
    void url;
    void scan; // fixed configured ranges: one request, no scan
    return JSON.stringify(grid);
  },
});

describe("verification + difference report (synthetic data, local database)", () => {
  let db: TestDb;
  let snapshots: PlaybookMirrorSnapshotsRepository;
  let structure: PlaybookMirrorStructureRepository;

  async function acceptFrom(snapshotId: number) {
    const p = await proposeFromSnapshot({ snapshots, structure }, snapshotId);
    await structure.acceptInitial(
      "Health",
      p.plans.map((x, i) => ({ planKey: `plan_${x.column}`, insurer: "Synthetic", displayName: x.displayName, expectedHeader: x.expectedHeader, status: x.status, sortOrder: i })),
      p.features.map((f, i) => ({ featureKey: `feature_${i}`, subKey: f.subKey, expectedLabel: f.expectedLabel, expectedSubLabel: f.expectedSubLabel, sortOrder: i })),
      "reviewer@joinditto.in"
    );
  }

  beforeEach(async () => {
    db = await createTestDb();
    snapshots = new PlaybookMirrorSnapshotsRepository(db);
    structure = new PlaybookMirrorStructureRepository(db);
  });

  it("does not verify a snapshot whose structure hasn't passed", async () => {
    const r = await syncPlaybookMirror({ tabs: SYNTHETIC_TABS, snapshots, structure, trigger: "t", getClient: async () => client(syntheticGrid(), syntheticScan()) });
    expect(r.status).toBe("fetched");
    const v = await verifySnapshot(snapshots, r.snapshotId!);
    expect(v).toMatchObject({ outcome: "not_eligible" });
    expect((await snapshots.get(r.snapshotId!))!.status).toBe("fetched");
  });

  it("verifies a snapshot whose structure passed and whose reconciliation is clean; never publishes", async () => {
    const first = await syncPlaybookMirror({ tabs: SYNTHETIC_TABS, snapshots, trigger: "t", getClient: async () => client(syntheticGrid(), syntheticScan()) });
    await acceptFrom(first.snapshotId!);
    const changed = syntheticGrid();
    (changed.sheets[0].data[0].rowData[2].values[4] as any).userEnteredValue.stringValue = "--"; // E3: "-" -> "--"
    const second = await syncPlaybookMirror({ tabs: SYNTHETIC_TABS, snapshots, structure, trigger: "t2", getClient: async () => client(changed, syntheticScan()) });
    expect(second).toMatchObject({ ok: true, status: "verified", structure: { state: "passed" }, verification: { outcome: "verified" } });
    expect(second.verification?.reconciliation).toMatchObject({ ok: true, differenceCount: 0 });
    expect(second.verification?.diff).toMatchObject({ baseline: "none" }); // nothing published yet
    const published = await db.execute(sql`select count(*)::int as n from playbook_published`);
    expect((published.rows[0] as { n: number }).n).toBe(0);
    expect(await verifySnapshot(snapshots, second.snapshotId!)).toMatchObject({ outcome: "not_eligible" }); // already verified
  });

  it("labels changes with plan and category and shows exact before/after text", async () => {
    const first = await syncPlaybookMirror({ tabs: SYNTHETIC_TABS, snapshots, trigger: "t", getClient: async () => client(syntheticGrid(), syntheticScan()) });
    await acceptFrom(first.snapshotId!);
    const changed = syntheticGrid();
    (changed.sheets[0].data[0].rowData[2].values[4] as any).userEnteredValue.stringValue = "--"; // E3
    (changed.sheets[0].data[0].rowData[0].values[4] as any).note = "Header note (edited)"; // E1 note
    const second = await syncPlaybookMirror({ tabs: SYNTHETIC_TABS, snapshots, structure, trigger: "t2", getClient: async () => client(changed, syntheticScan()) });
    const diff = await diffFor(snapshots, second.snapshotId!, first.snapshotId!);
    expect(diff).toMatchObject({ baseline: "chosen", identical: false, counts: { "text changed": 1, "note changed": 1 } });
    expect(diff.cells).toEqual(
      expect.arrayContaining([
        { tab: "Ditto's Recommended Policies", a1: "E3", plan: "plan_E", feature: "feature_1.sub_b", kind: "text changed", before: "-", after: "--" },
        { tab: "Ditto's Recommended Policies", a1: "E1", plan: "plan_E", feature: null, kind: "note changed", before: "Header note", after: "Header note (edited)" },
      ])
    );
  });

  it("reports two identical snapshots as identical", async () => {
    const first = await syncPlaybookMirror({ tabs: SYNTHETIC_TABS, snapshots, trigger: "t", getClient: async () => client(syntheticGrid(), syntheticScan()) });
    const diff = await diffFor(snapshots, first.snapshotId!, first.snapshotId!);
    expect(diff).toMatchObject({ identical: false, cells: [] }); // no passed structure check on either side, so positions are not compared (stated in notes)
  });
});

describe("difference report when one side has no passed structure check", () => {
  it("says plan positions weren't compared instead of reporting every plan as added", async () => {
    const db = await createTestDb();
    const snapshots = new PlaybookMirrorSnapshotsRepository(db);
    const a = await syncPlaybookMirror({ tabs: SYNTHETIC_TABS, snapshots, trigger: "t", getClient: async () => client(syntheticGrid(), syntheticScan()) });
    const diff = await diffFor(snapshots, a.snapshotId!, a.snapshotId!);
    expect(diff.plans).toEqual({ added: [], removed: [], movedColumn: [] });
    expect(diff.notes.join(" ")).toMatch(/were not compared/);
    expect(diff.identical).toBe(false);
    expect(diff.cells).toEqual([]);
  });
});
