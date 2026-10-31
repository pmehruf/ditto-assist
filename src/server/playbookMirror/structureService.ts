/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { PlaybookMirrorSnapshotsRepository } from "../db/repositories/playbookMirrorSnapshotsRepository.js";
import type { PlaybookMirrorStructureRepository } from "../db/repositories/playbookMirrorStructureRepository.js";
import { MIRROR_TABS } from "./config.js";
import { checkStructure, extractMainTab, proposeStructure, type StructCell, type StructTab, type StructureReport } from "./structure.js";
import { hiddenOf } from "./visibility.js";

interface Repos {
  snapshots: PlaybookMirrorSnapshotsRepository;
  structure: PlaybookMirrorStructureRepository;
}

async function loadSnapshot(repos: Repos, snapshotId: number) {
  const tabs = await repos.snapshots.tabs(snapshotId);
  if (tabs.length === 0) throw new Error(`Snapshot ${snapshotId} not found.`);
  const toTab = (t: (typeof tabs)[number]): StructTab => ({ sheetGid: Number(t.sheetGid), title: t.title, hiddenRows: t.hiddenRows, hiddenCols: t.hiddenCols, rowsHiddenByFilter: t.rowsHiddenByFilter });
  const main = tabs.find((t) => t.title === MIRROR_TABS[0].title);
  const tab2 = tabs.find((t) => t.title === MIRROR_TABS[1].title);
  if (!main) throw new Error(`Snapshot ${snapshotId} has no "${MIRROR_TABS[0].title}" tab.`);
  const cells: StructCell[] = (await repos.snapshots.cells(snapshotId)).map((c) => ({
    sheetGid: Number(c.sheetGid),
    rowNum: c.rowNum,
    colNum: c.colNum,
    a1: c.a1,
    valueKind: c.valueKind,
    rawText: c.rawText,
    numberRaw: c.numberRaw,
    coveredBy: c.coveredBy,
    mergeRange: c.mergeRange,
  }));
  return { main: toTab(main), tab2: tab2 ? toTab(tab2) : undefined, cells };
}

/** Builds the plan/feature proposal from a snapshot, for a person to review. Writes nothing. */
export async function proposeFromSnapshot(repos: Repos, snapshotId: number) {
  const { main, cells } = await loadSnapshot(repos, snapshotId);
  return proposeStructure(extractMainTab(main, cells));
}

/**
 * The proposal as it may be DISPLAYED: a plan in a hidden column, or a category in
 * hidden rows, keeps its key but its sheet text is withheld (decision 2026-10-30).
 * Acceptance always uses the full proposal internally, never this view.
 */
export async function proposalForDisplay(repos: Repos, snapshotId: number) {
  const { main, cells } = await loadSnapshot(repos, snapshotId);
  const proposal = proposeStructure(extractMainTab(main, cells));
  const h = hiddenOf(main);
  return {
    plans: proposal.plans.map((p) =>
      h.isHiddenA1(`${p.column}1`) ? { ...p, expectedHeader: null, displayName: null, statusReason: "Column hidden in the sheet (text not shown)", hiddenInSource: true } : { ...p, hiddenInSource: false }
    ),
    features: proposal.features.map((f) =>
      f.rows.every((r) => h.rows.has(r)) ? { ...f, expectedLabel: null, expectedSubLabel: null, hiddenInSource: true } : { ...f, hiddenInSource: false }
    ),
  };
}

/** Runs the structure check on a stored snapshot and records the result on it. */
export async function runStructureCheck(repos: Repos, snapshotId: number): Promise<StructureReport> {
  const { main, tab2, cells } = await loadSnapshot(repos, snapshotId);
  const accepted = await repos.structure.accepted("Health");
  const previousHidden = await repos.structure.previousPassedHidden("Health", snapshotId);
  const report = checkStructure({
    mainTab: main,
    tab2,
    cells,
    accepted: {
      plans: accepted.plans.map((p) => ({ planKey: p.planKey, expectedHeader: p.expectedHeader })),
      features: accepted.features.map((f) => ({ featureKey: f.featureKey, subKey: f.subKey, expectedLabel: f.expectedLabel, expectedSubLabel: f.expectedSubLabel, sortOrder: f.sortOrder })),
    },
    previousHidden,
  });
  const reject = report.state === "failed" ? `Structure check failed: ${report.problems.slice(0, 5).join(" ")}${report.problems.length > 5 ? ` (+${report.problems.length - 5} more)` : ""}` : null;
  await repos.structure.recordCheck(snapshotId, report, reject);
  return report;
}

/** First-run acceptance of the proposal derived from a snapshot (all plans keep provisional statuses, hidden from advisors). */
export async function acceptProposalFromSnapshot(repos: Repos, snapshotId: number, acceptedBy: string) {
  const proposal = await proposeFromSnapshot(repos, snapshotId);
  const unmapped = [...proposal.plans.filter((p) => !p.keyFromMap).map((p) => p.expectedHeader), ...proposal.features.filter((f) => !f.keyFromMap).map((f) => f.expectedLabel)];
  if (unmapped.length > 0) {
    throw new Error(`The proposal contains entries without a reviewed key (${unmapped.length}): ${unmapped.slice(0, 5).map((u) => JSON.stringify(u)).join(", ")}. Review them before accepting.`);
  }
  const keys = proposal.features.map((f) => `${f.featureKey}.${f.subKey}`);
  const dup = keys.find((k, i) => keys.indexOf(k) !== i);
  if (dup) throw new Error(`The proposal has a duplicate feature key "${dup}". Review before accepting.`);
  await repos.structure.acceptInitial(
    "Health",
    proposal.plans.map(({ planKey, insurer, displayName, expectedHeader, status, sortOrder }) => ({ planKey, insurer, displayName, expectedHeader, status, sortOrder })),
    proposal.features.map(({ featureKey, subKey, expectedLabel, expectedSubLabel, sortOrder }) => ({ featureKey, subKey, expectedLabel, expectedSubLabel, sortOrder })),
    acceptedBy
  );
  return runStructureCheck(repos, snapshotId);
}
