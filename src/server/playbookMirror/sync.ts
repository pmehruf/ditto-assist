/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * PRODUCT PLAYBOOK MIRROR — fetch and store a raw snapshot (Phase 1, Step 3b).
 *
 * 1. Gets a client from the dedicated READ-ONLY grant, re-verified with
 *    Google on every run (getVerifiedMirrorClient). No other credential is
 *    ever used.
 * 2. Makes ONE GET request for the fixed configured ranges (config.ts), with
 *    full formatting. Nothing outside those ranges is requested.
 * 3. Stores the response body exactly as received (gzip) with a SHA-256
 *    fingerprint, plus exact cell rows. An identical response to the latest
 *    snapshot creates no new snapshot.
 * 4. Rejects (but still stores, for evidence) a snapshot whose tabs don't
 *    match the configured titles or whose data doesn't start at the configured range.
 *
 * It never publishes, never touches Product Assist / the existing Playbook
 * sync, and never writes to Google.
 */

import { createHash } from "crypto";
import { gzipSync } from "zlib";
import type { PlaybookMirrorSnapshotsRepository } from "../db/repositories/playbookMirrorSnapshotsRepository.js";
import type { PlaybookMirrorStructureRepository } from "../db/repositories/playbookMirrorStructureRepository.js";
import { runStructureCheck } from "./structureService.js";
import { verifySnapshot, type VerifyResult } from "./verifyService.js";
import type { StructureReport } from "./structure.js";
import { gridRanges, MIRROR_GRID_FIELDS, MIRROR_PARSER_VERSION, MIRROR_SPREADSHEET_ID, MIRROR_TABS, parseRange, sheetsGetUrl, type MirrorTabConfig } from "./config.js";
import { transformSheet, type CellRow, type TabRow } from "./transform.js";

export interface MirrorTextClient {
  /** Account the verified grant belongs to. */
  email: string;
  /** Performs a GET and returns the response body exactly as received. */
  requestText(url: string): Promise<string>;
}

export interface MirrorSyncResult {
  ok: boolean;
  skipped?: boolean;
  snapshotId?: number;
  status?: "fetched" | "rejected" | "verified" | "published";
  rejectedReason?: string | null;
  counts?: { tabs: number; cells: number; nonEmpty: number; notes: number; merges: number; runLinks: number };
  rawSha256?: string;
  structure?: Pick<StructureReport, "ok" | "state" | "problems" | "needsReview">;
  verification?: Pick<VerifyResult, "outcome" | "reason" | "reconciliation" | "diff">;
  published?: boolean;
  error?: string;
}

/** v2 (2026-10-30): one ranged read of the fixed configured ranges, no whole-tab scan. (v1 snapshots also carried a scan.) */
export const RAW_ENVELOPE_FORMAT = "playbook-mirror-raw-v2";

export async function syncPlaybookMirror(deps: {
  snapshots: PlaybookMirrorSnapshotsRepository;
  /** When given, every new snapshot is checked against the accepted structure (Step 4). */
  structure?: PlaybookMirrorStructureRepository;
  /**
   * When given, a snapshot that VERIFIES (structure passed + zero reconciliation
   * differences) is published straight away (decision 2026-10-30: the verified
   * snapshot is what users see; no separate review step). Never called otherwise.
   */
  publish?: (snapshotId: number) => Promise<{ ok: boolean; error?: string }>;
  trigger: string;
  getClient: () => Promise<MirrorTextClient>;
  tabs?: MirrorTabConfig[];
  spreadsheetId?: string;
  now?: () => Date;
}): Promise<MirrorSyncResult> {
  const now = deps.now ?? (() => new Date());
  const tabs = deps.tabs ?? MIRROR_TABS;
  const spreadsheetId = deps.spreadsheetId ?? MIRROR_SPREADSHEET_ID;
  const { snapshots, trigger } = deps;
  await snapshots.recordSyncState("Health", { lastAttemptAt: now(), lastTrigger: trigger });

  try {
    const client = await deps.getClient();
    // ONE request, limited to the fixed configured ranges. Nothing outside them is fetched.
    const gRanges = gridRanges(tabs);
    const gridText = await client.requestText(sheetsGetUrl(spreadsheetId, gRanges, MIRROR_GRID_FIELDS));

    const envelope = JSON.stringify({ format: RAW_ENVELOPE_FORMAT, ranges: gRanges, grid: gridText });
    const rawSha256 = createHash("sha256").update(envelope, "utf8").digest("hex");

    const latest = await snapshots.latest("Health");
    if (latest && latest.rawSha256 === rawSha256 && latest.parserVersion === MIRROR_PARSER_VERSION) {
      await snapshots.recordSyncState("Health", { lastSuccessAt: now(), lastError: null, lastSnapshotId: latest.id });
      return { ok: true, skipped: true, snapshotId: latest.id, status: latest.status as "fetched" | "rejected", rawSha256 };
    }

    const grid = JSON.parse(gridText);
    const problems: string[] = [];
    const gridSheets: unknown[] = grid.sheets ?? [];
    const titles = gridSheets.map((s) => (s as { properties?: { title?: string } })?.properties?.title);
    if (JSON.stringify(titles) !== JSON.stringify(tabs.map((t) => t.title))) {
      problems.push(`Tabs returned ${JSON.stringify(titles)} do not match the configured tabs ${JSON.stringify(tabs.map((t) => t.title))}.`);
    }

    const tabRows: TabRow[] = [];
    const cellRows: CellRow[] = [];
    gridSheets.forEach((sheet, i) => {
      const cfg = tabs[i];
      const bounds = cfg ? parseRange(cfg.range) : undefined;
      // Fail closed if Google's data doesn't start where the configured range does.
      const data = ((sheet as { data?: { startRow?: number; startColumn?: number }[] }).data ?? [])[0] ?? {};
      if (bounds && ((data.startRow ?? 0) + 1 !== bounds.firstRow || (data.startColumn ?? 0) + 1 !== bounds.firstCol)) {
        problems.push(`"${cfg.title}": Google returned data starting at row ${(data.startRow ?? 0) + 1}, column ${(data.startColumn ?? 0) + 1}, not at the configured range ${cfg.range}.`);
      }
      const { tab, cells } = transformSheet(sheet, undefined, bounds);
      tabRows.push(tab);
      cellRows.push(...cells);
    });

    const status = problems.length > 0 ? "rejected" : "fetched";
    const rejectedReason = problems.length > 0 ? problems.join(" ") : null;
    const inserted = await snapshots.insertSnapshot(
      {
        domain: "Health",
        spreadsheetId,
        fetchedVia: client.email,
        trigger,
        requestRanges: gRanges,
        requestFields: MIRROR_GRID_FIELDS,
        rawResponseGzip: gzipSync(Buffer.from(envelope, "utf8")),
        rawResponseBytes: Buffer.byteLength(envelope, "utf8"),
        rawSha256,
        parserVersion: MIRROR_PARSER_VERSION,
        status,
        rejectedReason,
      },
      tabRows,
      cellRows
    );
    if (!inserted) {
      return { ok: false, error: "Another Playbook mirror sync is already running. Try again shortly." };
    }

    let structure: MirrorSyncResult["structure"];
    let finalStatus: "fetched" | "rejected" | "verified" | "published" = status;
    let published = false;
    let verification: MirrorSyncResult["verification"];
    let finalReason = rejectedReason;
    if (deps.structure && status === "fetched") {
      const report = await runStructureCheck({ snapshots, structure: deps.structure }, inserted.id);
      structure = { ok: report.ok, state: report.state, problems: report.problems, needsReview: report.needsReview };
      if (report.state === "failed") {
        finalStatus = "rejected";
        finalReason = `Structure check failed: ${report.problems.slice(0, 5).join(" ")}`;
      } else if (report.state === "passed") {
        // Step 5: independent reconciliation; 'verified' only with zero differences. Never publishes.
        const v = await verifySnapshot(snapshots, inserted.id);
        verification = { outcome: v.outcome, reason: v.reason, reconciliation: v.reconciliation, diff: v.diff };
        if (v.outcome === "verified") {
          finalStatus = "verified";
          if (deps.publish) {
            const p = await deps.publish(inserted.id);
            if (p.ok) {
              finalStatus = "published";
              published = true;
            } else {
              finalReason = `Verified but not published: ${p.error}`;
            }
          }
        }
        if (v.outcome === "rejected") {
          finalStatus = "rejected";
          finalReason = v.reason;
        }
      }
    }

    await snapshots.recordSyncState("Health", {
      lastSuccessAt: now(),
      lastError: finalReason ? `Latest snapshot rejected: ${finalReason}` : null,
      lastSnapshotId: inserted.id,
    });
    const nonEmpty = cellRows.filter((c) => c.valueKind !== "empty");
    return {
      ok: true,
      snapshotId: inserted.id,
      status: finalStatus,
      rejectedReason: finalReason,
      rawSha256,
      structure,
      verification,
      published,
      counts: {
        tabs: tabRows.length,
        cells: cellRows.length,
        nonEmpty: nonEmpty.length,
        notes: cellRows.filter((c) => c.note !== null).length,
        merges: tabRows.reduce((n, t) => n + t.mergesRaw.length, 0),
        runLinks: cellRows.reduce((n, c) => n + (c.resolvedRuns ?? []).filter((r) => r.link).length, 0),
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await snapshots.recordSyncState("Health", { lastError: message });
    return { ok: false, error: message };
  }
}
