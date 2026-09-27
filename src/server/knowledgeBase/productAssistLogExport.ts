/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Repositories } from "../db/repositories/index.js";
import { appendProductAssistLogRows } from "./productAssistLogSheetsClient.js";

export interface ProductAssistLogExportResult {
  exportedCount: number;
  skipped: boolean;
}

/**
 * Appends every not-yet-exported product_assist_logs row to the configured
 * Google Sheet, then marks ONLY those exact rows (by id) as exported — never
 * a blanket update — so a row logged by a live advisor question that
 * arrives mid-export is never skipped. If the Sheet append throws for any
 * reason (not connected, API error, sheet ID misconfigured), nothing is
 * marked exported — the rows simply remain queued for the next attempt.
 *
 * PERMANENCE (2026-09): this used to delete rows from the database right
 * after a successful append (a move, not a copy) — changed on direct user
 * request so the "AI Usage & Limits" > Usage History admin tab can always
 * expand a row to show its full query detail, exported or not. The Sheet
 * export is now a periodic COPY.
 *
 * Called from server.ts's POST /api/product-assist-logs/export-and-clear,
 * either by a Developer clicking "Export Now" in Connections or by an
 * external monthly scheduler hitting the same route.
 */
export async function runProductAssistLogExport(repos: Repositories): Promise<ProductAssistLogExportResult> {
  const rows = await repos.productAssistLogs.listUnexported();
  if (rows.length === 0) {
    return { exportedCount: 0, skipped: true };
  }

  await appendProductAssistLogRows(rows);
  await repos.productAssistLogs.markExported(rows.map(r => r.id));

  return { exportedCount: rows.length, skipped: false };
}
