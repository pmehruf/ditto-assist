/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * QUERY ASSIST LOG EXPORT — GOOGLE SHEETS WRITE CLIENT
 * ---------------------------------------------------------------
 * Appends product_assist_logs rows to a Google Sheet the user creates and
 * owns (its ID is set via PRODUCT_ASSIST_LOG_SHEET_ID — this is a
 * user-provided destination, not a fixed workbook this app owns the way
 * the QA Dashboard/Playbook IDs are). Auth is the single stored WRITE-scope
 * OAuth grant from "Connect Google Sheets" in Connections (see
 * productAssistLogExportConnectionRepository.ts / productAssistLogTokenCrypto.ts) —
 * deliberately no service-account fallback path, unlike sheetsClient.ts /
 * playbookSheetsClient.ts, since this is a narrower, temporary, single-owner
 * tool rather than a shared team integration.
 *
 * Uses google-auth-library's OAuth2Client directly against the Sheets API
 * v4 REST endpoint, same approach as the two read-only clients.
 */

import { OAuth2Client } from "google-auth-library";
import { getDb } from "../db/client.js";
import { createRepositories } from "../db/repositories/index.js";
import { decryptProductAssistLogRefreshToken } from "./productAssistLogTokenCrypto.js";
import type { ProductAssistLogRow } from "../db/schema.js";

const DEFAULT_TAB_NAME = "Sheet1";

const HEADER_ROW = [
  "id",
  "created_at",
  "user_email",
  "category_name",
  "plan_tags",
  "question",
  "answer",
  "share",
  "sources",
  "had_no_matches",
  "retrieved_chunk_count",
  "playbook_fact_count",
  "history_turn_count",
  "input_tokens",
  "output_tokens",
  "model_name",
  "latency_ms",
];

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} environment variable is required. See .env.example.`);
  return value;
}

function getTargetSheetId(): string {
  return requireEnv("PRODUCT_ASSIST_LOG_SHEET_ID");
}

function getTargetTabName(): string {
  return process.env.PRODUCT_ASSIST_LOG_SHEET_TAB_NAME?.trim() || DEFAULT_TAB_NAME;
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

/** Invalidates the cached OAuth client — call right after storing a new
 * grant (connect) or clearing one (disconnect) so the very next export
 * picks up the change without waiting for a server restart. */
export function invalidateProductAssistLogSheetsAuthCache(): void {
  cachedOAuthClient = null;
}

// ── Export health (2026-09) — same passive-tracking pattern as
// sheetsClient.ts's getQaSheetsHealth: records the outcome of every real
// export attempt (manual "Export & Clear Now" or the monthly Cloud
// Scheduler run), no dedicated probe. Surfaced by GET
// /api/product-assist-logs/connection-status so "Connected" can't mask a
// genuinely broken/expired grant the way a stored-row-only check would. ──
interface ProductAssistLogExportHealth {
  lastSuccessAt: Date | null;
  lastErrorAt: Date | null;
  lastErrorMessage: string | null;
}
const exportHealth: ProductAssistLogExportHealth = { lastSuccessAt: null, lastErrorAt: null, lastErrorMessage: null };

export function getProductAssistLogExportHealth(): ProductAssistLogExportHealth {
  return { ...exportHealth };
}

// Google Sheets rejects any single cell over 50,000 characters, which fails
// the whole append (and so the export). Stay under the cap and mark
// truncation so it's visible in the sheet.
const MAX_CELL_CHARS = 49000;
const TRUNCATION_MARKER = "… [truncated]";

function clampCell(value: string): string {
  if (value.length <= MAX_CELL_CHARS) return value;
  return value.slice(0, MAX_CELL_CHARS - TRUNCATION_MARKER.length) + TRUNCATION_MARKER;
}

function rowToValues(row: ProductAssistLogRow): (string | number | boolean)[] {
  return [
    row.id,
    row.createdAt.toISOString(),
    row.userEmail,
    row.categoryName ?? "",
    clampCell(row.planTags.join(", ")),
    clampCell(row.question),
    clampCell(row.answer),
    clampCell(row.share ?? ""),
    clampCell(JSON.stringify(row.sources ?? [])),
    row.hadNoMatches,
    row.retrievedChunkCount,
    row.playbookFactCount,
    row.historyTurnCount,
    row.inputTokens ?? "",
    row.outputTokens ?? "",
    row.modelName ?? "",
    row.latencyMs ?? "",
  ];
}

/**
 * Appends the given log rows to the configured Sheet, writing the header
 * row first if the sheet's first tab is currently empty (a brand-new sheet
 * the user just created). Throws if no write grant is connected or
 * PRODUCT_ASSIST_LOG_SHEET_ID isn't set — callers (productAssistLogExport.ts)
 * must treat that as "do not delete anything from the DB," never silently
 * swallow it.
 */
export async function appendProductAssistLogRows(rows: ProductAssistLogRow[]): Promise<void> {
  if (rows.length === 0) return;

  try {
    const client = await getStoredWriteGrantClient();
    if (!client) {
      throw new Error(
        'Product Assist Log Export is not connected. Click "Connect Google Sheets" for Product Assist Log Export in Connections first.'
      );
    }

    const sheetId = getTargetSheetId();
    const tab = getTargetTabName();
    const range = encodeURIComponent(`'${tab}'`);

    // Check whether the sheet already has a header row (first cell of the
    // tab is non-empty) — a brand-new sheet the user just created will be
    // completely empty, so this export is also responsible for laying down
    // HEADER_ROW exactly once.
    const existing = await client.request<{ values?: unknown[][] }>({
      url: `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(`'${tab}'!A1`)}`,
    });
    const hasHeader = (existing.data.values?.length ?? 0) > 0;

    const values = hasHeader ? rows.map(rowToValues) : [HEADER_ROW, ...rows.map(rowToValues)];

    await client.request({
      url:
        `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${range}:append` +
        `?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
      method: "POST",
      data: { values },
    });
    exportHealth.lastSuccessAt = new Date();
    exportHealth.lastErrorAt = null;
    exportHealth.lastErrorMessage = null;
  } catch (err) {
    exportHealth.lastErrorAt = new Date();
    exportHealth.lastErrorMessage = err instanceof Error ? err.message : String(err);
    throw err;
  }
}
