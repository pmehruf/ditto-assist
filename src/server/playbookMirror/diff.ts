/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * PRODUCT PLAYBOOK MIRROR — difference report between two snapshots (Step 5).
 * Cells are matched by tab + address. Each change is labelled with the plan
 * and category it belongs to (from the newer snapshot's structure report),
 * and shows the text before and after EXACTLY as written.
 */

/* eslint-disable @typescript-eslint/no-explicit-any -- compares untyped stored JSON */
import { hiddenOf } from "./visibility.js";

export interface DiffCell {
  sheetGid: number;
  a1: string;
  rowNum: number;
  colNum: number;
  rawText: string | null;
  numberRaw: string | null;
  formattedValue: string | null;
  note: string | null;
  textFormatRuns: unknown;
  effectiveFormat: unknown;
  userEnteredFormat: unknown;
  resolvedRuns: unknown;
  hyperlink: string | null;
}
export interface DiffTab {
  sheetGid: number;
  title: string;
  hiddenRows: number[];
  hiddenCols: number[];
  rowsHiddenByFilter?: number[];
  mergesRaw: unknown;
}
export interface DiffSide {
  snapshotId: number;
  tabs: DiffTab[];
  cells: DiffCell[];
  structureReport: any;
}

export type ChangeKind = "text changed" | "newly filled" | "emptied" | "formatting only" | "note added" | "note changed" | "note removed" | "link changed";

export interface CellChange {
  tab: string;
  a1: string;
  plan: string | null;
  feature: string | null;
  kind: ChangeKind;
  before: string | null;
  after: string | null;
}

export interface DiffReport {
  baseSnapshotId: number | null;
  targetSnapshotId: number;
  generatedAt: string;
  baseline: "published" | "chosen" | "none";
  identical: boolean;
  counts: Record<string, number>;
  plans: { added: string[]; removed: string[]; movedColumn: string[] };
  features: { movedRows: string[] };
  hidden: string[];
  merges: string[];
  cells: CellChange[];
  truncated: boolean;
  /** Things the report could not compare, stated instead of guessed. */
  notes: string[];
}

const MAX_CHANGES = 1000;
const norm = (x: any): any =>
  Array.isArray(x) ? x.map(norm) : x && typeof x === "object" ? Object.keys(x).sort().reduce((o: any, k) => ((o[k] = norm(x[k])), o), {}) : x;
const same = (a: unknown, b: unknown) => JSON.stringify(norm(a ?? null)) === JSON.stringify(norm(b ?? null));
const value = (c: DiffCell | undefined) => (c ? c.rawText ?? c.numberRaw : null);
const links = (c: DiffCell | undefined) => JSON.stringify(((c?.resolvedRuns as any[]) ?? []).filter((r) => r?.link).map((r) => r.link));

export function diffSnapshots(base: DiffSide | null, target: DiffSide, baseline: DiffReport["baseline"], now: Date = new Date()): DiffReport {
  const report: DiffReport = {
    baseSnapshotId: base?.snapshotId ?? null,
    targetSnapshotId: target.snapshotId,
    generatedAt: now.toISOString(),
    baseline,
    identical: false,
    counts: {},
    plans: { added: [], removed: [], movedColumn: [] },
    features: { movedRows: [] },
    hidden: [],
    merges: [],
    cells: [],
    truncated: false,
    notes: [],
  };
  if (!base) {
    report.counts = { "cells in this snapshot": target.cells.length };
    return report;
  }

  // Labels from the newer snapshot's accepted-structure mapping.
  const planByCol = new Map<string, string>();
  for (const [k, col] of Object.entries(target.structureReport?.planColumns ?? {})) planByCol.set(String(col), k);
  const featureByRow = new Map<number, string>();
  for (const [k, rows] of Object.entries(target.structureReport?.featureRows ?? {})) for (const r of rows as number[]) featureByRow.set(r, k);
  const mainGid = target.tabs.find((t) => t.title === "Ditto's Recommended Policies")?.sheetGid;

  const passed = (r: any) => r?.state === "passed";
  if (passed(base.structureReport) && passed(target.structureReport)) {
    const bp = base.structureReport.planColumns ?? {};
    const tp = target.structureReport.planColumns ?? {};
    report.plans.added = Object.keys(tp).filter((k) => !(k in bp));
    report.plans.removed = Object.keys(bp).filter((k) => !(k in tp));
    report.plans.movedColumn = Object.keys(tp).filter((k) => k in bp && bp[k] !== tp[k]).map((k) => `${k}: ${bp[k]} → ${tp[k]}`);
    const bf = base.structureReport.featureRows ?? {};
    const tf = target.structureReport.featureRows ?? {};
    report.features.movedRows = Object.keys(tf).filter((k) => k in bf && !same(bf[k], tf[k])).map((k) => `${k}: ${bf[k].join("–")} → ${tf[k].join("–")}`);
  } else {
    report.notes.push(
      `Plan and category positions were not compared: snapshot ${passed(base.structureReport) ? target.snapshotId : base.snapshotId} has no passed structure check. Cell-by-cell differences below are still complete.`
    );
  }

  for (const t of target.tabs) {
    const b = base.tabs.find((x) => Number(x.sheetGid) === Number(t.sheetGid));
    if (!b) continue;
    if (!same(b.hiddenCols, t.hiddenCols)) report.hidden.push(`"${t.title}" hidden columns: ${JSON.stringify(b.hiddenCols)} → ${JSON.stringify(t.hiddenCols)}`);
    if (!same(b.hiddenRows, t.hiddenRows)) report.hidden.push(`"${t.title}" hidden rows: ${JSON.stringify(b.hiddenRows)} → ${JSON.stringify(t.hiddenRows)}`);
    const bm = (b.mergesRaw as unknown[]) ?? [];
    const tm = (t.mergesRaw as unknown[]) ?? [];
    const bs = new Set(bm.map((m) => JSON.stringify(norm(m))));
    const ts = new Set(tm.map((m) => JSON.stringify(norm(m))));
    const added = [...ts].filter((m) => !bs.has(m)).length;
    const removed = [...bs].filter((m) => !ts.has(m)).length;
    if (added || removed) report.merges.push(`"${t.title}": ${added} merge(s) added, ${removed} removed (${bm.length} → ${tm.length})`);
  }

  const key = (c: DiffCell) => `${Number(c.sheetGid)}|${c.a1}`;
  const before = new Map(base.cells.map((c) => [key(c), c]));
  const after = new Map(target.cells.map((c) => [key(c), c]));
  const title = (gid: number) => target.tabs.find((t) => Number(t.sheetGid) === gid)?.title ?? base.tabs.find((t) => Number(t.sheetGid) === gid)?.title ?? String(gid);
  const counts: Record<string, number> = {};
  // Content in a row/column hidden in EITHER snapshot is never listed (decision 2026-10-30); it is only counted.
  const hiddenIn = (side: DiffSide, gid: number) => hiddenOf(side.tabs.find((t) => Number(t.sheetGid) === gid));
  const push = (b: DiffCell | undefined, a: DiffCell | undefined, kind: ChangeKind, bt: string | null, at: string | null) => {
    const cell = (a ?? b)!;
    const gid = Number(cell.sheetGid);
    if (hiddenIn(base, gid).isHidden(cell.rowNum, cell.colNum) || hiddenIn(target, gid).isHidden(cell.rowNum, cell.colNum)) {
      const k = "changes in hidden rows/columns (not shown)";
      counts[k] = (counts[k] ?? 0) + 1;
      return;
    }
    counts[kind] = (counts[kind] ?? 0) + 1;
    if (report.cells.length >= MAX_CHANGES) {
      report.truncated = true;
      return;
    }
    const c = (a ?? b)!;
    const isMain = Number(c.sheetGid) === Number(mainGid);
    const col = c.a1.replace(/\d+$/, "");
    report.cells.push({
      tab: title(Number(c.sheetGid)),
      a1: c.a1,
      plan: isMain ? planByCol.get(col) ?? null : null,
      feature: isMain ? featureByRow.get(c.rowNum) ?? null : null,
      kind,
      before: bt,
      after: at,
    });
  };

  for (const k of new Set([...before.keys(), ...after.keys()])) {
    const b = before.get(k);
    const a = after.get(k);
    const bv = value(b);
    const av = value(a);
    if (bv === null && av !== null) push(b, a, "newly filled", bv, av);
    else if (bv !== null && av === null) push(b, a, "emptied", bv, av);
    else if (bv !== av) push(b, a, "text changed", bv, av);
    else if (
      (b || a) &&
      (!same(b?.textFormatRuns, a?.textFormatRuns) || !same(b?.effectiveFormat, a?.effectiveFormat) || !same(b?.userEnteredFormat, a?.userEnteredFormat) || (b?.formattedValue ?? null) !== (a?.formattedValue ?? null)) &&
      links(b) === links(a)
    ) push(b, a, "formatting only", bv, av);
    if (links(b) !== links(a)) push(b, a, "link changed", links(b), links(a));
    const bn = b?.note ?? null;
    const an = a?.note ?? null;
    if (bn === null && an !== null) push(b, a, "note added", bn, an);
    else if (bn !== null && an === null) push(b, a, "note removed", bn, an);
    else if (bn !== an) push(b, a, "note changed", bn, an);
  }

  report.counts = counts;
  report.identical =
    report.notes.length === 0 &&
    report.cells.length === 0 && !report.truncated && report.hidden.length === 0 && report.merges.length === 0 &&
    report.plans.added.length + report.plans.removed.length + report.plans.movedColumn.length + report.features.movedRows.length === 0;
  return report;
}
