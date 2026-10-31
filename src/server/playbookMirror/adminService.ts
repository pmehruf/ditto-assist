/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * PRODUCT PLAYBOOK MIRROR — data for the admin review screen and the read API
 * (Phase 1, Step 6). Read-only: nothing here writes to the database or Google.
 */

import { desc, eq } from "drizzle-orm";
import type { AnyDb } from "../db/client.js";
import { playbookMirrorConnection, playbookPublished, playbookSnapshots, playbookSourceIssues } from "../db/schema.js";
import { createRepositories } from "../db/repositories/index.js";
import { MIRROR_TABS } from "./config.js";
import { CHECK_PLAYBOOK_DIRECTLY, readCells, visiblePlans, type PublishedContext } from "./readService.js";
import { displayableCells } from "./visibility.js";

export const STALE_AFTER_MS = 24 * 60 * 60 * 1000; // D9

/**
 * Summary for the admin "Playbook Sync" page: only what that page shows.
 * Hidden sheet content is never included (layout problems already withhold it).
 */
export async function overview(db: AnyDb, now: Date = new Date()) {
  const repos = createRepositories(db);
  const [connection] = await db
    .select({ email: playbookMirrorConnection.connectedEmail })
    .from(playbookMirrorConnection)
    .where(eq(playbookMirrorConnection.domain, "Health"));
  const [syncState, snapshots, issues, [published]] = await Promise.all([
    repos.playbookMirrorSnapshots.getSyncState("Health"),
    db
      .select({
        id: playbookSnapshots.id,
        fetchedAt: playbookSnapshots.fetchedAt,
        trigger: playbookSnapshots.trigger,
        status: playbookSnapshots.status,
        rejectedReason: playbookSnapshots.rejectedReason,
        structureReport: playbookSnapshots.structureReport,
      })
      .from(playbookSnapshots)
      .where(eq(playbookSnapshots.domain, "Health"))
      .orderBy(desc(playbookSnapshots.fetchedAt), desc(playbookSnapshots.id))
      .limit(10),
    db
      .select({ id: playbookSourceIssues.id, tabTitle: playbookSourceIssues.tabTitle, a1: playbookSourceIssues.a1, description: playbookSourceIssues.description, showWarning: playbookSourceIssues.showWarning })
      .from(playbookSourceIssues)
      .where(eq(playbookSourceIssues.domain, "Health"))
      .orderBy(playbookSourceIssues.id),
    db.select().from(playbookPublished).where(eq(playbookPublished.domain, "Health")),
  ]);
  const live = published ? await repos.playbookMirrorSnapshots.get(published.snapshotId) : null;
  // A new environment has no layout (which column is which plan, which row is which feature) until it's set up once.
  const layoutReady = (await repos.playbookMirrorStructure.accepted("Health")).plans.length > 0;
  const lastCheckedAt = syncState?.lastSuccessAt ?? null;

  return {
    connectedEmail: connection?.email ?? null,
    layoutReady,
    lastCheckedAt,
    stale: lastCheckedAt ? now.getTime() - new Date(lastCheckedAt).getTime() > STALE_AFTER_MS : null,
    live: published ? { snapshotId: published.snapshotId, sheetAsOf: live?.fetchedAt ?? null, since: published.updatedAt } : null,
    updates: snapshots.map((s) => {
      const st = s.structureReport as { state?: string; problems?: string[] } | null;
      return {
        id: s.id,
        at: s.fetchedAt,
        trigger: s.trigger,
        status: s.status,
        layoutChanged: st?.state === "failed",
        layoutChanges: st?.state === "failed" ? st.problems ?? [] : [],
        reason: s.rejectedReason,
      };
    }),
    notes: issues.filter((i) => i.showWarning),
  };
}

/** Grid of one tab of a snapshot for ADMIN review. Hidden rows/columns are NOT sent (only their numbers, as metadata). */
export async function snapshotGrid(db: AnyDb, snapshotId: number, sheetGid: number) {
  const repos = createRepositories(db);
  const tabs = await repos.playbookMirrorSnapshots.tabs(snapshotId);
  const tab = tabs.find((t) => Number(t.sheetGid) === sheetGid);
  if (!tab) return null;
  const cells = displayableCells(await repos.playbookMirrorSnapshots.cells(snapshotId, sheetGid), tab);
  return {
    snapshotId,
    tabs: tabs.map((t) => ({ sheetGid: Number(t.sheetGid), title: t.title })),
    tab: { sheetGid, title: tab.title, hiddenRows: [...new Set([...tab.hiddenRows, ...tab.rowsHiddenByFilter])].sort((a, b) => a - b), hiddenCols: tab.hiddenCols, frozenRows: tab.frozenRows, frozenCols: tab.frozenCols },
    cells: cells.map((c) => ({
      a1: c.a1, rowNum: c.rowNum, colNum: c.colNum, valueKind: c.valueKind, rawText: c.rawText, numberRaw: c.numberRaw,
      formattedValue: c.formattedValue, resolvedRuns: c.resolvedRuns, note: c.note, mergeRange: c.mergeRange, coveredBy: c.coveredBy,
      background: (c.effectiveFormat as any)?.backgroundColorStyle ?? (c.userEnteredFormat as any)?.backgroundColorStyle ?? null, // eslint-disable-line @typescript-eslint/no-explicit-any
    })),
  };
}

/** Loads the published snapshot's context for the read API (null when nothing is published). */
export async function publishedContext(db: AnyDb): Promise<PublishedContext | null> {
  const [pub] = await db.select().from(playbookPublished).where(eq(playbookPublished.domain, "Health"));
  if (!pub) return null;
  const repos = createRepositories(db);
  const snap = await repos.playbookMirrorSnapshots.get(pub.snapshotId);
  if (!snap || snap.status !== "published") return null;
  const report = snap.structureReport as { state?: string; planColumns?: Record<string, string>; featureRows?: Record<string, number[]> } | null;
  if (report?.state !== "passed") return null;
  const main = (await repos.playbookMirrorSnapshots.tabs(pub.snapshotId)).find((t) => t.title === MIRROR_TABS[0].title);
  if (!main) return null;
  return {
    snapshotId: pub.snapshotId,
    publishedAt: snap.publishedAt,
    fetchedAt: snap.fetchedAt,
    mainSheetGid: Number(main.sheetGid),
    hiddenCols: main.hiddenCols,
    hiddenRows: [...main.hiddenRows, ...main.rowsHiddenByFilter],
    planColumns: report.planColumns ?? {},
    featureRows: report.featureRows ?? {},
  };
}

export async function readMeta(db: AnyDb, now: Date = new Date()) {
  const ctx = await publishedContext(db);
  const repos = createRepositories(db);
  const structure = await repos.playbookMirrorStructure.accepted("Health");
  const plans = visiblePlans(structure.plans, ctx);
  const fetchedAt = ctx ? new Date(ctx.fetchedAt) : null;
  return {
    published: !!ctx,
    snapshotId: ctx?.snapshotId ?? null,
    publishedAt: ctx?.publishedAt ?? null,
    playbookAsOf: ctx?.fetchedAt ?? null,
    stale: fetchedAt ? now.getTime() - fetchedAt.getTime() > STALE_AFTER_MS : null,
    plans: plans.map((p) => ({ planKey: p.planKey, insurer: p.insurer, displayName: p.displayName, header: p.expectedHeader, status: p.status })),
    features: ctx
      ? structure.features
          .filter((f) => (ctx.featureRows[f.subKey ? `${f.featureKey}.${f.subKey}` : f.featureKey] ?? []).some((r) => !ctx.hiddenRows.includes(r)))
          .map((f) => ({ featureKey: f.featureKey, subKey: f.subKey, label: f.expectedLabel, subLabel: f.expectedSubLabel }))
      : [],
  };
}

/** Cells on a tab where the sheet has something the mirror can't show and the warning is on. */
async function openGapCells(db: AnyDb, tabTitle: string): Promise<string[]> {
  const rows = await db.select({ a1: playbookSourceIssues.a1, tabTitle: playbookSourceIssues.tabTitle, kind: playbookSourceIssues.kind, showWarning: playbookSourceIssues.showWarning })
    .from(playbookSourceIssues).where(eq(playbookSourceIssues.domain, "Health"));
  return rows.filter((r) => r.tabTitle === tabTitle && r.kind === "source_gap" && r.showWarning).map((r) => r.a1);
}

export async function readCellsFor(db: AnyDb, planKeys: string[], featureKeys: string[]) {
  const ctx = await publishedContext(db);
  const repos = createRepositories(db);
  const structure = await repos.playbookMirrorStructure.accepted("Health");
  const cells = ctx ? await repos.playbookMirrorSnapshots.cells(ctx.snapshotId, ctx.mainSheetGid) : [];
  const gapCells = await openGapCells(db, MIRROR_TABS[0].title);
  const result = readCells({
    gapCells,
    ctx,
    plans: structure.plans,
    features: structure.features,
    cells: cells.map((c) => ({ ...c, sheetGid: Number(c.sheetGid) })),
    planKeys,
    featureKeys,
  });
  return result.ok ? { ok: true as const, snapshotId: ctx!.snapshotId, playbookAsOf: ctx!.fetchedAt, cells: result.cells } : result;
}

/**
 * One tab of the PUBLISHED snapshot as users see it: only rows/columns visible in
 * the sheet (hidden ones are never sent). Used for "Recommendation specifics".
 */
export async function readGrid(db: AnyDb, tabTitle: string) {
  const [pub] = await db.select().from(playbookPublished).where(eq(playbookPublished.domain, "Health"));
  if (!pub) return { ok: false as const, error: "Nothing has been published yet." };
  const repos = createRepositories(db);
  const snap = await repos.playbookMirrorSnapshots.get(pub.snapshotId);
  if (!snap || snap.status !== "published") return { ok: false as const, error: "Nothing has been published yet." };
  const tab = (await repos.playbookMirrorSnapshots.tabs(pub.snapshotId)).find((t) => t.title === tabTitle);
  if (!tab) return { ok: false as const, error: "Unknown tab." };
  const cells = displayableCells(await repos.playbookMirrorSnapshots.cells(pub.snapshotId, Number(tab.sheetGid)), tab);
  const gaps = new Set(await openGapCells(db, tab.title));
  return {
    ok: true as const,
    snapshotId: pub.snapshotId,
    playbookAsOf: snap.fetchedAt,
    tab: { title: tab.title, hiddenRows: [...new Set([...tab.hiddenRows, ...tab.rowsHiddenByFilter])], hiddenCols: tab.hiddenCols },
    cells: cells.map((c) => ({
      a1: c.a1, rowNum: c.rowNum, colNum: c.colNum, valueKind: c.valueKind, rawText: c.rawText, numberRaw: c.numberRaw,
      formattedValue: c.formattedValue, resolvedRuns: c.resolvedRuns, note: c.note, mergeRange: c.mergeRange, coveredBy: c.coveredBy,
      background: (c.effectiveFormat as any)?.backgroundColorStyle ?? (c.userEnteredFormat as any)?.backgroundColorStyle ?? null, // eslint-disable-line @typescript-eslint/no-explicit-any
      warning: gaps.has(c.a1) ? CHECK_PLAYBOOK_DIRECTLY : null,
    })),
  };
}
