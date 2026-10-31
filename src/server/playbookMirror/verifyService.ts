/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * PRODUCT PLAYBOOK MIRROR — verification (Phase 1, Step 5).
 * A snapshot becomes 'verified' only when ALL of these hold:
 *   - it is still 'fetched' (never re-verifies a rejected/published one);
 *   - its structure check passed against the accepted structure;
 *   - the independent reconciliation finds ZERO differences.
 * Otherwise it is 'rejected' with the reason. Verification never publishes.
 */

import type { PlaybookMirrorSnapshotsRepository } from "../db/repositories/playbookMirrorSnapshotsRepository.js";
import { diffSnapshots, type DiffReport, type DiffSide } from "./diff.js";
import { reconcileSnapshot, type ReconciliationReport } from "./reconcile.js";

export interface VerifyResult {
  ok: boolean;
  snapshotId: number;
  outcome: "verified" | "rejected" | "not_eligible";
  reason: string | null;
  reconciliation?: Pick<ReconciliationReport, "ok" | "differenceCount" | "differences" | "totals" | "raw">;
  diff?: Pick<DiffReport, "baseline" | "baseSnapshotId" | "identical" | "counts">;
}

async function side(snapshots: PlaybookMirrorSnapshotsRepository, snapshotId: number): Promise<DiffSide> {
  const [row, tabs, cells] = await Promise.all([snapshots.get(snapshotId), snapshots.tabs(snapshotId), snapshots.cells(snapshotId)]);
  if (!row) throw new Error(`Snapshot ${snapshotId} not found.`);
  return {
    snapshotId,
    structureReport: row.structureReport,
    tabs: tabs.map((t) => ({ sheetGid: Number(t.sheetGid), title: t.title, hiddenRows: t.hiddenRows, hiddenCols: t.hiddenCols, rowsHiddenByFilter: t.rowsHiddenByFilter, mergesRaw: t.mergesRaw })),
    cells: cells.map((c) => ({ ...c, sheetGid: Number(c.sheetGid) })),
  };
}

/** Difference report for `targetId` against `baseId`, or against the published snapshot when no base is given. */
export async function diffFor(snapshots: PlaybookMirrorSnapshotsRepository, targetId: number, baseId?: number): Promise<DiffReport> {
  const published = baseId === undefined ? await snapshots.publishedSnapshotId("Health") : null;
  const base = baseId ?? published;
  const target = await side(snapshots, targetId);
  if (base === null || base === undefined) return diffSnapshots(null, target, "none");
  return diffSnapshots(await side(snapshots, base), target, baseId === undefined ? "published" : "chosen");
}

export async function verifySnapshot(snapshots: PlaybookMirrorSnapshotsRepository, snapshotId: number): Promise<VerifyResult> {
  const row = await snapshots.get(snapshotId);
  if (!row) throw new Error(`Snapshot ${snapshotId} not found.`);
  const structure = row.structureReport as { state?: string } | null;
  if (row.status !== "fetched") {
    return { ok: false, snapshotId, outcome: "not_eligible", reason: `Snapshot is '${row.status}'; only 'fetched' snapshots can be verified.` };
  }
  if (structure?.state !== "passed") {
    return { ok: false, snapshotId, outcome: "not_eligible", reason: `Structure check has not passed (state: ${structure?.state ?? "not run"}).` };
  }

  const [tabs, cells] = await Promise.all([snapshots.tabs(snapshotId), snapshots.cells(snapshotId)]);
  const reconciliation = reconcileSnapshot(
    { rawResponseGzip: row.rawResponseGzip, rawResponseBytes: row.rawResponseBytes, rawSha256: row.rawSha256 },
    tabs.map((t) => ({ ...t, sheetGid: Number(t.sheetGid) })),
    cells.map((c) => ({ ...c, sheetGid: Number(c.sheetGid) }))
  );
  const diff = await diffFor(snapshots, snapshotId);
  const outcome = reconciliation.ok ? "verified" : "rejected";
  const reason = reconciliation.ok ? null : `Reconciliation found ${reconciliation.differenceCount} difference(s): ${reconciliation.differences.slice(0, 3).join("; ")}`;
  const applied = await snapshots.recordVerification(snapshotId, reconciliation, diff, outcome, reason);
  if (!applied) {
    return { ok: false, snapshotId, outcome: "not_eligible", reason: "Snapshot status changed while verifying; nothing recorded." };
  }
  return {
    ok: reconciliation.ok,
    snapshotId,
    outcome,
    reason,
    reconciliation: { ok: reconciliation.ok, differenceCount: reconciliation.differenceCount, differences: reconciliation.differences.slice(0, 20), totals: reconciliation.totals, raw: reconciliation.raw },
    diff: { baseline: diff.baseline, baseSnapshotId: diff.baseSnapshotId, identical: diff.identical, counts: diff.counts },
  };
}
