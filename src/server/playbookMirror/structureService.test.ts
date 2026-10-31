/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-disable @typescript-eslint/no-explicit-any -- these tests edit untyped synthetic Google JSON in place */
import { beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { createTestDb, type TestDb } from "../db/testUtils.js";
import { PlaybookMirrorSnapshotsRepository } from "../db/repositories/playbookMirrorSnapshotsRepository.js";
import { PlaybookMirrorStructureRepository } from "../db/repositories/playbookMirrorStructureRepository.js";
import { syncPlaybookMirror, type MirrorTextClient } from "./sync.js";
import { acceptProposalFromSnapshot, proposalForDisplay, proposeFromSnapshot, runStructureCheck } from "./structureService.js";
import { SYNTHETIC_TABS, syntheticGrid, syntheticScan } from "./__fixtures__/syntheticSheet.js";

const client = (grid: unknown, scan: unknown): MirrorTextClient => ({
  email: "reader@joinditto.in",
  async requestText(url: string) {
    void url;
    void scan; // fixed configured ranges: one request, no scan
    return JSON.stringify(grid);
  },
});

describe("structure service + sync (synthetic data, local database)", () => {
  let db: TestDb;
  let snapshots: PlaybookMirrorSnapshotsRepository;
  let structure: PlaybookMirrorStructureRepository;
  const repos = () => ({ snapshots, structure });

  beforeEach(async () => {
    db = await createTestDb();
    snapshots = new PlaybookMirrorSnapshotsRepository(db);
    structure = new PlaybookMirrorStructureRepository(db);
  });

  it("checks every new snapshot; with nothing accepted the snapshot stays 'fetched'", async () => {
    const r = await syncPlaybookMirror({ tabs: SYNTHETIC_TABS, snapshots, structure, trigger: "t", getClient: async () => client(syntheticGrid(), syntheticScan()) });
    expect(r).toMatchObject({ ok: true, status: "fetched", structure: { state: "no_accepted_structure" } });
  });

  it("refuses to accept a proposal that still has unreviewed (unmapped) entries", async () => {
    const r = await syncPlaybookMirror({ tabs: SYNTHETIC_TABS, snapshots, trigger: "t", getClient: async () => client(syntheticGrid(), syntheticScan()) });
    await expect(acceptProposalFromSnapshot(repos(), r.snapshotId!, "reviewer@joinditto.in")).rejects.toThrow(/without a reviewed key/);
    const accepted = await structure.accepted();
    expect(accepted.plans).toHaveLength(0);
  });

  it("after acceptance: unchanged sheet passes; a renamed header is rejected on the next fetch", async () => {
    const first = await syncPlaybookMirror({ tabs: SYNTHETIC_TABS, snapshots, trigger: "t", getClient: async () => client(syntheticGrid(), syntheticScan()) });
    const proposal = await proposeFromSnapshot(repos(), first.snapshotId!);
    // Simulate a reviewer assigning keys, then accepting.
    await structure.acceptInitial(
      "Health",
      proposal.plans.map((p, i) => ({ planKey: `plan_${i}`, insurer: "Synthetic", displayName: p.displayName, expectedHeader: p.expectedHeader, status: p.status, sortOrder: i })),
      proposal.features.map((f, i) => ({ featureKey: `feature_${i}`, subKey: f.subKey, expectedLabel: f.expectedLabel, expectedSubLabel: f.expectedSubLabel, sortOrder: i })),
      "reviewer@joinditto.in"
    );
    const passed = await runStructureCheck(repos(), first.snapshotId!);
    expect(passed).toMatchObject({ ok: true, state: "passed" });

    const plans = await db.execute(sql`select show_to_advisors, status_confirmed_by, updated_by from playbook_plans`);
    expect(plans.rows.every((p: any) => p.show_to_advisors === false && p.status_confirmed_by === null && p.updated_by === "reviewer@joinditto.in")).toBe(true);

    await expect(structure.acceptInitial("Health", [], [], "someone@joinditto.in")).rejects.toThrow(/already been accepted/);

    const changed = syntheticGrid();
    (changed.sheets[0].data[0].rowData[0].values[4] as any).userEnteredValue.stringValue = "Plan Beta (renamed)";
    const second = await syncPlaybookMirror({ tabs: SYNTHETIC_TABS, snapshots, structure, trigger: "t2", getClient: async () => client(changed, syntheticScan()) });
    expect(second).toMatchObject({ ok: true, status: "rejected", structure: { state: "failed" } });
    expect(second.rejectedReason).toMatch(/Structure check failed/);
    expect((await snapshots.getSyncState())?.lastError).toMatch(/Latest snapshot rejected/);
  });

  it("the proposal shown to admins withholds a hidden column's header (acceptance data is unaffected)", async () => {
    const r = await syncPlaybookMirror({ tabs: SYNTHETIC_TABS, snapshots, trigger: "t", getClient: async () => client(syntheticGrid(), syntheticScan()) });
    const tabs = await snapshots.tabs(r.snapshotId!);
    expect(tabs.find((t) => t.sheetGid === 0)!.hiddenCols).toEqual([1]); // synthetic column A is hidden
    const full = await proposeFromSnapshot({ snapshots, structure }, r.snapshotId!);
    const shown = await proposalForDisplay({ snapshots, structure }, r.snapshotId!);
    expect(full.plans.map((p) => p.column)).toEqual(shown.plans.map((p) => p.column));
    expect(shown.plans.every((p) => p.hiddenInSource === false)).toBe(true); // plan headers start at column D, none hidden here
  });
});
