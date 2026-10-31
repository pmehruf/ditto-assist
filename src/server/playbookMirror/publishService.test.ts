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
import { publishSnapshot, rejectSnapshot, rollBackTo } from "./publishService.js";
import { overview, readCellsFor, readMeta } from "./adminService.js";
import { SYNTHETIC_TABS, syntheticGrid, syntheticScan } from "./__fixtures__/syntheticSheet.js";

const client = (grid: unknown, scan: unknown): MirrorTextClient => ({
  email: "reader@joinditto.in",
  async requestText(url: string) {
    void url;
    void scan; // fixed configured ranges: one request, no scan
    return JSON.stringify(grid);
  },
});

describe("manual publishing, roll back, reject, status confirmation, read API (synthetic, local database)", () => {
  let db: TestDb;
  let snapshots: PlaybookMirrorSnapshotsRepository;
  let structure: PlaybookMirrorStructureRepository;
  let n = 0;

  /** Fetches a variant of the synthetic sheet (so each fetch is a new snapshot) with the structure check on. */
  async function fetchVariant() {
    const g = syntheticGrid();
    (g.sheets[0].data[0].rowData[2].values[4] as any).userEnteredValue.stringValue = `-${"x".repeat(n++)}`; // E3 differs per fetch
    return syncPlaybookMirror({ tabs: SYNTHETIC_TABS, snapshots, structure, trigger: "t", getClient: async () => client(g, syntheticScan()) });
  }

  beforeEach(async () => {
    db = await createTestDb();
    snapshots = new PlaybookMirrorSnapshotsRepository(db);
    structure = new PlaybookMirrorStructureRepository(db);
    n = 1; // variant 0 would equal the first fetch and be skipped as a duplicate
    const first = await syncPlaybookMirror({ tabs: SYNTHETIC_TABS, snapshots, trigger: "t0", getClient: async () => client(syntheticGrid(), syntheticScan()) });
    const p = await proposeFromSnapshot({ snapshots, structure }, first.snapshotId!);
    await structure.acceptInitial(
      "Health",
      p.plans.map((x, i) => ({ planKey: `plan_${x.column}`, insurer: "Synthetic", displayName: x.displayName, expectedHeader: x.expectedHeader, status: x.status, sortOrder: i })),
      p.features.map((f, i) => ({ featureKey: `feature_${i}`, subKey: f.subKey, expectedLabel: f.expectedLabel, expectedSubLabel: f.expectedSubLabel, sortOrder: i })),
      "reviewer@joinditto.in"
    );
  });

  it("tells the admin page whether the sheet's layout has been set up (new environments start without one)", async () => {
    expect((await overview(db)).layoutReady).toBe(true);
    expect((await overview(await createTestDb())).layoutReady).toBe(false);
  });

  it("without the publish step a verified snapshot stays unpublished; unverified ones can't be published", async () => {
    const a = await fetchVariant();
    expect(a.status).toBe("verified");
    expect((await overview(db)).live).toBeNull();
    const fetchedOnly = await syncPlaybookMirror({ tabs: SYNTHETIC_TABS, snapshots, trigger: "no-structure", getClient: async () => client(syntheticGrid(), syntheticScan({ tab: 0, row: 3, col: 1 })) });
    const refused = await publishSnapshot(db, fetchedOnly.snapshotId!, "admin@joinditto.in");
    expect(refused).toMatchObject({ ok: false });
  });

  it("publishes, supersedes, rolls back, and keeps every published snapshot", async () => {
    const a = await fetchVariant();
    const pa = await publishSnapshot(db, a.snapshotId!, "admin@joinditto.in");
    expect(pa).toMatchObject({ ok: true, previousSnapshotId: null });
    expect(pa.warnings.join(" ")).toMatch(/AD46/); // open source issue surfaced at publish time
    const b = await fetchVariant();
    const pb = await publishSnapshot(db, b.snapshotId!, "admin@joinditto.in");
    expect(pb).toMatchObject({ ok: true, previousSnapshotId: a.snapshotId });
    expect((await snapshots.get(a.snapshotId!))!.status).toBe("superseded");
    const rb = await rollBackTo(db, a.snapshotId!, "admin@joinditto.in");
    expect(rb).toMatchObject({ ok: true, previousSnapshotId: b.snapshotId });
    expect((await snapshots.get(a.snapshotId!))!.status).toBe("published");
    expect((await snapshots.get(b.snapshotId!))!.status).toBe("superseded");
    expect(await rollBackTo(db, b.snapshotId!, "x@joinditto.in")).toMatchObject({ ok: true });
    expect(await rollBackTo(db, b.snapshotId!, "x@joinditto.in")).toMatchObject({ ok: false }); // already published
    await expect(db.execute(sql`delete from playbook_snapshots where id = ${a.snapshotId!}`)).rejects.toThrow();
  });

  it("rejects only fetched/verified snapshots, with a reason", async () => {
    const a = await fetchVariant();
    expect(await rejectSnapshot(db, a.snapshotId!, "admin@joinditto.in", "no")).toMatchObject({ ok: false });
    expect(await rejectSnapshot(db, a.snapshotId!, "admin@joinditto.in", "Product team found an error")).toEqual({ ok: true });
    expect((await snapshots.get(a.snapshotId!))!.rejectedReason).toBe("Rejected by admin@joinditto.in: Product team found an error");
    const b = await fetchVariant();
    await publishSnapshot(db, b.snapshotId!, "admin@joinditto.in");
    expect(await rejectSnapshot(db, b.snapshotId!, "admin@joinditto.in", "Too late to reject")).toMatchObject({ ok: false });
  });

  it("a verified snapshot is published automatically when the sync is given the publish step", async () => {
    const g = syntheticGrid();
    (g.sheets[0].data[0].rowData[2].values[4] as any).userEnteredValue.stringValue = "-auto";
    const r = await syncPlaybookMirror({
      tabs: SYNTHETIC_TABS, snapshots, structure, trigger: "auto", getClient: async () => client(g, syntheticScan()),
      publish: (id) => publishSnapshot(db, id, "auto (verified)"),
    });
    expect(r).toMatchObject({ ok: true, status: "published", published: true });
    expect((await overview(db)).live?.snapshotId).toBe(r.snapshotId);
  });

  it("read API: nothing before publishing; then every plan visible in the sheet, exact cells, no hidden rows/columns", async () => {
    expect(await readMeta(db)).toMatchObject({ published: false, plans: [], features: [] });
    const a = await fetchVariant();
    await publishSnapshot(db, a.snapshotId!, "admin@joinditto.in");
    const meta = await readMeta(db);
    expect(meta.plans.map((p) => p.planKey)).toEqual(["plan_D", "plan_E"]);
    expect(meta.plans[0].header).toBe(" Plan Alpha\r(Status note)"); // header exactly as in the sheet
    const r = await readCellsFor(db, ["plan_D"], []);
    if ("error" in r) throw new Error(r.error);
    expect(r.cells.find((x) => x.a1 === "D2")?.rawText).toBe("1) Heading\nDetail text and link");
    expect(r.cells.some((x) => /^A\d/.test(x.a1) || /^A\d/.test(x.readFrom))).toBe(false);
    expect(r.cells.some((x) => x.a1 === "D4")).toBe(false); // row 4 is hidden in the synthetic sheet
  });
});
