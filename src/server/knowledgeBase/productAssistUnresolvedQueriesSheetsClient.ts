/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * UNRESOLVED QUERIES EXPORT — GOOGLE SHEETS WRITE CLIENT
 * ---------------------------------------------------------------
 * Exports product_assist_unresolved_queries rows to the SAME Sheet/OAuth
 * grant Product Assist Log Export already uses (PRODUCT_ASSIST_LOG_SHEET_ID
 * + the single stored write-scope grant in
 * product_assist_log_export_connection) — deliberately not a second
 * Connections row or a second OAuth flow, since both features write to one
 * admin-provided spreadsheet the connected account already has edit access
 * to. Writes to two DEDICATED tabs, "Unresolved - Health" and "Unresolved -
 * Term" (auto-created on first export if missing), rather than sharing
 * product_assist_logs' "Sheet1" tab — this is a different, longer-lived
 * dataset with its own columns (status/resolution), and the user's explicit
 * ask is that Health and Term stay independently reviewable.
 *
 * Unlike appendProductAssistLogRows (which only ever appends, since that
 * table's rows are deleted from the DB right after a successful export),
 * this OVERWRITES each tab's content with the full current snapshot on every
 * export — these rows are a durable, admin-worked queue whose `status`
 * changes over time (unresolved -> resolved/skipped), so the Sheet should
 * always reflect the current state, not accumulate stale duplicate rows.
 */

import { OAuth2Client } from "google-auth-library";
import { getDb } from "../db/client.js";
import { createRepositories } from "../db/repositories/index.js";
import { decryptProductAssistLogRefreshToken } from "./productAssistLogTokenCrypto.js";
import type { ProductAssistUnresolvedQueryRow } from "../db/schema.js";

const TAB_NAMES: Record<ProductAssistUnresolvedQueryRow["domain"], string> = {
  Health: "Unresolved - Health",
  Term: "Unresolved - Term",
};

const HEADER_ROW = [
  "id",
  "created_at",
  "user_email",
  "category_name",
  "plan_tags",
  "question",
  "status",
  "resolved_special_instruction_topic",
  "resolved_by",
  "resolved_at",
];

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} environment variable is required. See .env.example.`);
  return value;
}

function getTargetSheetId(): string {
  // Reuses Product Assist Log Export's own destination spreadsheet — see
  // this file's header comment for why. Same env var, no new setup step.
  return requireEnv("PRODUCT_ASSIST_LOG_SHEET_ID");
}

let cachedOAuthClient: { client: OAuth2Client; email: string } | null = null;

async function getStoredWriteGrantClient(): Promise<OAuth2Client | null> {
  const { productAssistLogExportConnection } = createRepositories(getDb());
  const row = await productAssistLogExportConnection.get();
  if (!row) return null;

  if (!cachedOAuthClient || cachedOAuthClient.email !== row.connectedEmail) {
    const client = new OAuth2Client({
      clientId: requireEnv("GOOGLE_CLIENT_ID"),
      clientSecret: requireEnv("GOOGLE_CLIENT_SECRET"),
    });
    client.setCredentials({ refresh_token: decryptProductAssistLogRefreshToken(row.encryptedRefreshToken) });
    cachedOAuthClient = { client, email: row.connectedEmail };
  }
  return cachedOAuthClient.client;
}

// ── Export health (2026-09) — same passive-tracking pattern as
// productAssistLogSheetsClient.ts's getProductAssistLogExportHealth,
// surfaced by GET /api/product-assist/unresolved-queries/export-status so
// the Unresolved Queries tab's "Export" button can show a genuine last-
// export outcome rather than only "click to try." ──
interface UnresolvedQueriesExportHealth {
  lastSuccessAt: Date | null;
  lastErrorAt: Date | null;
  lastErrorMessage: string | null;
}
const exportHealth: UnresolvedQueriesExportHealth = { lastSuccessAt: null, lastErrorAt: null, lastErrorMessage: null };

export function getUnresolvedQueriesExportHealth(): UnresolvedQueriesExportHealth {
  return { ...exportHealth };
}

function rowToValues(row: ProductAssistUnresolvedQueryRow, topicById: Map<number, string>): (string | number)[] {
  return [
    row.id,
    row.createdAt.toISOString(),
    row.userEmail,
    row.categoryName ?? "",
    row.planTags.join(", "),
    row.question,
    row.status,
    row.resolvedSpecialInstructionId !== null ? topicById.get(row.resolvedSpecialInstructionId) ?? "" : "",
    row.resolvedBy ?? "",
    row.resolvedAt ? row.resolvedAt.toISOString() : "",
  ];
}

/** Ensures `tabName` exists in the target spreadsheet, creating it via
 * batchUpdate on first export if it's genuinely missing — so admins never
 * have to manually pre-create "Unresolved - Health"/"Unresolved - Term"
 * themselves, they just need the base Product Assist Log Export connection
 * (Connections page) already set up. */
async function ensureTabExists(client: OAuth2Client, sheetId: string, tabName: string): Promise<void> {
  const meta = await client.request<{ sheets?: { properties?: { title?: string } }[] }>({
    url: `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}?fields=sheets.properties.title`,
  });
  const exists = (meta.data.sheets ?? []).some(s => s.properties?.title === tabName);
  if (exists) return;

  await client.request({
    url: `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}:batchUpdate`,
    method: "POST",
    data: { requests: [{ addSheet: { properties: { title: tabName } } }] },
  });
}

/**
 * Overwrites the "Unresolved - Health"/"Unresolved - Term" tabs with the
 * full current set of product_assist_unresolved_queries rows, split by
 * domain. Throws if no write grant is connected or PRODUCT_ASSIST_LOG_SHEET_ID
 * isn't set — callers (server.ts's export route) must surface that as a
 * clear error, not swallow it.
 */
export async function exportUnresolvedQueryRows(rows: ProductAssistUnresolvedQueryRow[]): Promise<void> {
  try {
    const client = await getStoredWriteGrantClient();
    if (!client) {
      throw new Error(
        'Unresolved Queries export uses the same connection as Product Assist Log Export — click "Connect Google Sheets" for it in Connections first.'
      );
    }
    const sheetId = getTargetSheetId();

    // Resolve linked Special Instruction topics in bulk (rather than N
    // separate lookups) so a resolved row's export includes a human-
    // readable "what was added to fix this" column, not just a bare id.
    const { specialInstructions } = createRepositories(getDb());
    const resolvedIds = rows.map(r => r.resolvedSpecialInstructionId).filter((id): id is number => id !== null);
    const topicById = new Map<number, string>();
    if (resolvedIds.length > 0) {
      const idSet = new Set(resolvedIds);
      const all = await specialInstructions.list();
      for (const instr of all) {
        if (idSet.has(instr.id)) topicById.set(instr.id, instr.topic);
      }
    }

    for (const domain of ["Health", "Term"] as const) {
      const tabName = TAB_NAMES[domain];
      await ensureTabExists(client, sheetId, tabName);

      const domainRows = rows.filter(r => r.domain === domain).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      const values = [HEADER_ROW, ...domainRows.map(r => rowToValues(r, topicById))];

      const wholeTabRange = encodeURIComponent(`'${tabName}'`);
      const startCellRange = encodeURIComponent(`'${tabName}'!A1`);
      // Clear the tab first so a shrinking result set (e.g. after deleting
      // stale rows) doesn't leave orphaned old rows below the new data —
      // then write the full snapshot in one update call.
      await client.request({
        url: `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${wholeTabRange}:clear`,
        method: "POST",
      });
      await client.request({
        url: `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${startCellRange}?valueInputOption=RAW`,
        method: "PUT",
        data: { values },
      });
    }

    exportHealth.lastSuccessAt = new Date();
    exportHealth.lastErrorAt = null;
    exportHealth.lastErrorMessage = null;
  } catch (err) {
    exportHealth.lastErrorAt = new Date();
    exportHealth.lastErrorMessage = err instanceof Error ? err.message : String(err);
    throw err;
  }
}
