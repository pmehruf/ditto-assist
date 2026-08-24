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
 * Appends every currently-stored product_assist_logs row to the configured
 * Google Sheet, then deletes ONLY those exact rows (by id) from the
 * database — never a blanket clear — so a row logged by a live advisor
 * question that arrives mid-export is never lost. If the Sheet append
 * throws for any reason (not connected, API error, sheet ID misconfigured),
 * nothing is deleted — the rows simply remain queued for the next attempt.
 * Called from server.ts's POST /api/product-assist-logs/export-and-clear,
 * either by a Developer clicking "Export & Clear Now" in Connections or by
 * an external monthly scheduler hitting the same route.
 */
export async function runProductAssistLogExport(repos: Repositories): Promise<ProductAssistLogExportResult> {
  const rows = await repos.productAssistLogs.listAll();
  if (rows.length === 0) {
    return { exportedCount: 0, skipped: true };
  }

  await appendProductAssistLogRows(rows);
  await repos.productAssistLogs.deleteByIds(rows.map(r => r.id));

  return { exportedCount: rows.length, skipped: false };
}
