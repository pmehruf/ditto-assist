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
import { readCells, visiblePlans, type PublishedContext } from "./readService.js";
import { displayableCells, hiddenOf } from "./visibility.js";

export const STALE_AFTER_MS = 24 * 60 * 60 * 1000; // D9

export async function overview(db: AnyDb, now: Date = new Date()) {
  const repos = createRepositories(db);
  const [connection] = await db
    .select({ email: playbookMirrorConnection.connectedEmail, scopes: playbookMirrorConnection.grantedScopes, connectedAt: playbookMirrorConnection.connectedAt, connectedBy: playbookMirrorConnection.connectedBy })
    .from(playbookMirrorConnection)
    .where(eq(playbookMirrorConnection.domain, "Health"));
  const [syncState, snapshots, structure, issues, [published]] = await Promise.all([
    repos.playbookMirrorSnapshots.getSyncState("Health"),
    db
      .select({
        id: playbookSnapshots.id,
        fetchedAt: playbookSnapshots.fetchedAt,
        trigger: playbookSnapshots.trigger,
        status: playbookSnapshots.status,
        parserVersion: playbookSnapshots.parserVersion,
        rawSha256: playbookSnapshots.rawSha256,
        rejectedReason: playbookSnapshots.rejectedReason,
        publishedAt: playbookSnapshots.publishedAt,
        publishedBy: playbookSnapshots.publishedBy,
        structureReport: playbookSnapshots.structureReport,
        reconciliationReport: playbookSnapshots.reconciliationReport,
      })
      .from(playbookSnapshots)
      .where(eq(playbookSnapshots.domain, "Health"))
      .orderBy(desc(playbookSnapshots.fetchedAt), desc(playbookSnapshots.id))
      .limit(30),
    repos.playbookMirrorStructure.accepted("Health"),
    db.select().from(playbookSourceIssues).where(eq(playbookSourceIssues.domain, "Health")).orderBy(playbookSourceIssues.id),
    db.select().from(playbookPublished).where(eq(playbookPublished.domain, "Health")),
  ]);

  const warnings: { level: "error" | "warning" | "info"; text: string }[] = [];
  if (!connection) warnings.push({ level: "error", text: "The read-only Google access is not connected." });
  if (syncState?.lastError) warnings.push({ level: "error", text: syncState.lastError });
  const lastSuccess = syncState?.lastSuccessAt ? new Date(syncState.lastSuccessAt) : null;
  if (!lastSuccess) warnings.push({ level: "warning", text: "No successful fetch yet." });
  else if (now.getTime() - lastSuccess.getTime() > STALE_AFTER_MS) warnings.push({ level: "warning", text: `Last successful fetch was more than 24 hours ago (${lastSuccess.toISOString()}).` });
  if (snapshots[0]?.status === "rejected") warnings.push({ level: "error", text: `The latest snapshot (#${snapshots[0].id}) was rejected: ${snapshots[0].rejectedReason}` });
  for (const i of issues) if (i.showWarning) warnings.push({ level: "info", text: `Not mirrored: ${i.a1} — ${i.description}` });
  const hiddenPlanKeys = new Set<string>();
  const lastPassed = snapshots.find((s) => (s.structureReport as { state?: string } | null)?.state === "passed");
  if (lastPassed) {
    const mainTab = (await repos.playbookMirrorSnapshots.tabs(lastPassed.id)).find((t) => t.title === MIRROR_TABS[0].title);
    const h = hiddenOf(mainTab);
    const cols = (lastPassed.structureReport as { planColumns?: Record<string, string> }).planColumns ?? {};
    for (const [key, col] of Object.entries(cols)) if (h.isHiddenA1(`${col}1`)) hiddenPlanKeys.add(key);
  }
  if (!published) warnings.push({ level: "warning", text: "No verified snapshot is published yet, so users see nothing." });

  return {
    connection: connection ? { email: connection.email, scopes: connection.scopes, connectedAt: connection.connectedAt, connectedBy: connection.connectedBy } : null,
    syncState: syncState ?? null,
    published: published ? { snapshotId: published.snapshotId, updatedBy: published.updatedBy, updatedAt: published.updatedAt } : null,
    snapshots: snapshots.map((s) => {
      const st = s.structureReport as { state?: string; problems?: string[]; needsReview?: string[] } | null;
      const rc = s.reconciliationReport as { ok?: boolean; differenceCount?: number } | null;
      return {
        id: s.id, fetchedAt: s.fetchedAt, trigger: s.trigger, status: s.status, parserVersion: s.parserVersion, rawSha256: s.rawSha256,
        rejectedReason: s.rejectedReason, publishedAt: s.publishedAt, publishedBy: s.publishedBy,
        structure: st ? { state: st.state ?? null, problems: st.problems ?? [], needsReview: st.needsReview ?? [] } : null,
        reconciliation: rc ? { ok: !!rc.ok, differenceCount: rc.differenceCount ?? null } : null,
      };
    }),
    // A plan in a column hidden in the sheet: its header text is hidden content, so it is not sent for display.
    plans: structure.plans.map((p) =>
      hiddenPlanKeys.has(p.planKey) ? { ...p, expectedHeader: null, displayName: null, hiddenInSource: true } : { ...p, hiddenInSource: false }
    ),
    featureCount: structure.features.length,
    issues,
    warnings,
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

export async function readCellsFor(db: AnyDb, planKeys: string[], featureKeys: string[]) {
  const ctx = await publishedContext(db);
  const repos = createRepositories(db);
  const structure = await repos.playbookMirrorStructure.accepted("Health");
  const cells = ctx ? await repos.playbookMirrorSnapshots.cells(ctx.snapshotId, ctx.mainSheetGid) : [];
  const result = readCells({
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
  return {
    ok: true as const,
    snapshotId: pub.snapshotId,
    playbookAsOf: snap.fetchedAt,
    tab: { title: tab.title, hiddenRows: [...new Set([...tab.hiddenRows, ...tab.rowsHiddenByFilter])], hiddenCols: tab.hiddenCols },
    cells: cells.map((c) => ({
      a1: c.a1, rowNum: c.rowNum, colNum: c.colNum, valueKind: c.valueKind, rawText: c.rawText, numberRaw: c.numberRaw,
      formattedValue: c.formattedValue, resolvedRuns: c.resolvedRuns, note: c.note, mergeRange: c.mergeRange, coveredBy: c.coveredBy,
      background: (c.effectiveFormat as any)?.backgroundColorStyle ?? (c.userEnteredFormat as any)?.backgroundColorStyle ?? null, // eslint-disable-line @typescript-eslint/no-explicit-any
    })),
  };
}
