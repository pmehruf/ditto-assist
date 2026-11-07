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
import { acceptChangedLayout, acceptProposalFromSnapshot, proposalForDisplay, proposeFromSnapshot, runStructureCheck } from "./structureService.js";
import { SYNTHETIC_TABS, syntheticGrid, syntheticScan } from "./__fixtures__/syntheticSheet.js";
import { resolveNoteCell } from "./readService.js";

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

  it("a changed layout can be accepted: relabelled plans keep their identity, new ones are added, missing ones dropped; the next update then passes", async () => {
    const first = await syncPlaybookMirror({ tabs: SYNTHETIC_TABS, snapshots, trigger: "t", getClient: async () => client(syntheticGrid(), syntheticScan()) });
    const proposal = await proposeFromSnapshot(repos(), first.snapshotId!);
    await expect(acceptChangedLayout(repos(), first.snapshotId!, "admin@joinditto.in")).rejects.toThrow(/first-time setup/);
    await structure.acceptInitial(
      "Health",
      proposal.plans.map((p, i) => ({ planKey: `plan_${i}`, insurer: "Synthetic", displayName: p.displayName, expectedHeader: p.expectedHeader, status: p.status, sortOrder: i })),
      proposal.features.map((f, i) => ({ featureKey: `feature_${i}`, subKey: f.subKey, expectedLabel: f.expectedLabel, expectedSubLabel: f.expectedSubLabel, sortOrder: i })),
      "reviewer@joinditto.in"
    );

    // The sheet changes: Plan Alpha gets a different note, Plan Beta is replaced by Plan Gamma.
    const changed = syntheticGrid();
    const header = changed.sheets[0].data[0].rowData[0].values as any[];
    header[3].userEnteredValue.stringValue = header[3].formattedValue = " Plan Alpha\r(Not available with Ditto)";
    header[4].userEnteredValue.stringValue = header[4].formattedValue = "Plan Gamma";
    const held = await syncPlaybookMirror({ tabs: SYNTHETIC_TABS, snapshots, structure, trigger: "t2", getClient: async () => client(changed, syntheticScan()) });
    expect(held).toMatchObject({ status: "rejected", structure: { state: "failed" } });

    // A preview changes nothing.
    const preview = await acceptChangedLayout(repos(), held.snapshotId!, "admin@joinditto.in", { dryRun: true });
    expect((await structure.accepted()).plans.map((p) => p.planKey)).toEqual(["plan_0", "plan_1"]);
    const summary = await acceptChangedLayout(repos(), held.snapshotId!, "admin@joinditto.in");
    expect(summary).toEqual(preview);
    expect(summary).toEqual({
      added: ["Plan Gamma"],
      removed: ["Plan Beta "],
      relabelled: [{ from: " Plan Alpha\r(Status note)", to: " Plan Alpha\r(Not available with Ditto)" }], // stored exactly as in the sheet (\r kept)
      nowHidden: [],
      notesMoved: [],
      featuresChanged: false,
    });
    const now = await structure.accepted();
    expect(now.plans.map((p) => [p.planKey, p.expectedHeader])).toEqual([["plan_0", " Plan Alpha\r(Not available with Ditto)"], ["plan_gamma", "Plan Gamma"]]);
    expect(now.features.map((f) => f.featureKey)).toEqual(proposal.features.map((_, i) => `feature_${i}`)); // features keep their identity

    // The same (unchanged) sheet is read again rather than skipped, because the last copy was held back — and now passes.
    const again = await syncPlaybookMirror({ tabs: SYNTHETIC_TABS, snapshots, structure, trigger: "t3", getClient: async () => client(changed, syntheticScan()) });
    expect(again).toMatchObject({ ok: true, status: "verified", structure: { state: "passed" } });
    expect(again.skipped).toBeUndefined();
    // An identical copy that went through fine is still skipped.
    const fourth = await syncPlaybookMirror({ tabs: SYNTHETIC_TABS, snapshots, structure, trigger: "t4", getClient: async () => client(changed, syntheticScan()) });
    expect(fourth).toMatchObject({ skipped: true, snapshotId: again.snapshotId });
  });

  it("a note pinned to a plan's cell (e.g. the AD46 picture) is anchored to its plan on a layout change and then follows it when columns move", async () => {
    const first = await syncPlaybookMirror({ tabs: SYNTHETIC_TABS, snapshots, trigger: "t", getClient: async () => client(syntheticGrid(), syntheticScan()) });
    const proposal = await proposeFromSnapshot(repos(), first.snapshotId!);
    await structure.acceptInitial(
      "Health",
      proposal.plans.map((p, i) => ({ planKey: `plan_${i}`, insurer: "Synthetic", displayName: p.displayName, expectedHeader: p.expectedHeader, status: p.status, sortOrder: i })),
      proposal.features.map((f, i) => ({ featureKey: `feature_${i}`, subKey: f.subKey, expectedLabel: f.expectedLabel, expectedSubLabel: f.expectedSubLabel, sortOrder: i })),
      "reviewer@joinditto.in"
    );
    expect(await runStructureCheck(repos(), first.snapshotId!)).toMatchObject({ state: "passed" }); // plan_0 in D, plan_1 in E
    await db.execute(sql`insert into playbook_source_issues (issue_key, kind, status, tab_title, a1, description, show_warning)
      values ('syn_picture', 'source_gap', 'open', ${SYNTHETIC_TABS[0].title}, 'E46', 'A picture over plan_1''s cell', true)`);
    const note = async () => ((await db.execute(sql`select a1 from playbook_source_issues where issue_key = 'syn_picture'`)).rows[0] as { a1: string }).a1;

    // 1. A layout change (Plan Alpha relabelled) is held back, then accepted: the note gets anchored to plan_1, row 46.
    const relabelled = syntheticGrid();
    const h1 = relabelled.sheets[0].data[0].rowData[0].values as any[];
    h1[3].userEnteredValue.stringValue = h1[3].formattedValue = " Plan Alpha\r(Not available with Ditto)";
    const held = await syncPlaybookMirror({ tabs: SYNTHETIC_TABS, snapshots, structure, trigger: "t2", getClient: async () => client(relabelled, syntheticScan()) });
    expect(held.status).toBe("rejected");
    expect((await acceptChangedLayout(repos(), held.snapshotId!, "admin@joinditto.in", { dryRun: true })).notesMoved).toEqual([]); // plan_1 stays in E
    expect(await note()).toBe("E46"); // a preview changes nothing
    await acceptChangedLayout(repos(), held.snapshotId!, "admin@joinditto.in");
    expect(await note()).toBe("plan:plan_1:46");

    // 2. Later the two plans swap columns. Headers still match, so this passes with no accept step,
    //    and the note follows plan_1 to column D.
    const swapped = syntheticGrid();
    const h2 = swapped.sheets[0].data[0].rowData[0].values as any[];
    h2[3].userEnteredValue.stringValue = h2[3].formattedValue = " Plan Alpha\r(Not available with Ditto)";
    [h2[3], h2[4]] = [h2[4], h2[3]];
    const moved = await syncPlaybookMirror({ tabs: SYNTHETIC_TABS, snapshots, structure, trigger: "t3", getClient: async () => client(swapped, syntheticScan()) });
    expect(moved.structure?.state).toBe("passed");
    const cols = await structure.lastPassedPlanColumns("Health");
    expect(cols).toMatchObject({ plan_0: "E", plan_1: "D" });
    expect(resolveNoteCell(await note(), cols)).toBe("D46");
    expect(resolveNoteCell("AD46", cols)).toBe("AD46"); // plain cells are used as they are
    expect(resolveNoteCell("plan:gone:46", cols)).toBeNull(); // a plan no longer in the layout: no note shown
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
