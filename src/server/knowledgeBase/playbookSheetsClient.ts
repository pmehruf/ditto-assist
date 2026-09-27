/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * PRODUCT PLAYBOOK — GOOGLE SHEETS READ CLIENT
 * ---------------------------------------------------------------
 * Read-only access to the Product Playbook workbook (Sheet ID below),
 * modeled directly on src/server/qaDashboard/sheetsClient.ts — see that
 * file's header for the full two-path auth writeup. Kept as its own client
 * (own connection table, own cache) rather than a generalized/shared one
 * since the Playbook Sheet has a different owner/account than the QA
 * workbook:
 *
 *   1. Stored user OAuth grant (RECOMMENDED) — whoever has access to the
 *      sheet clicks "Connect Google Sheets" in Knowledge Base Management,
 *      consenting to a read-only Sheets scope on the app's existing login
 *      client. The refresh token is encrypted and stored in Postgres (see
 *      kbPlaybookConnectionRepository.ts / playbookTokenCrypto.ts).
 *   2. Service account + direct share — set
 *      KB_PLAYBOOK_GOOGLE_SERVICE_ACCOUNT_KEY(_PATH) and share the sheet
 *      with that service account's email as Viewer. Only used as a
 *      fallback when no user grant is stored.
 *
 * Scope is always spreadsheets.readonly; no code path here can write to
 * the sheet.
 */

import { GoogleAuth, OAuth2Client } from "google-auth-library";
import { getDb } from "../db/client.js";
import { createRepositories } from "../db/repositories/index.js";
import { decryptPlaybookRefreshToken } from "./playbookTokenCrypto.js";

// From the sheet's own share URL — see KnowledgeBaseManagementPage's
// Product Playbook panel for where this is surfaced to admins.
export const PLAYBOOK_SPREADSHEET_ID = "1BT5ugkkfxUDIlaPkM5G2IW6Kuxt-eHsrXkZk_GruIOk";

const SHEETS_READONLY_SCOPE = "https://www.googleapis.com/auth/spreadsheets.readonly";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} environment variable is required. See .env.example.`);
  return value;
}

// Path 1 — stored user OAuth grant. Cached by connected email so a
// reconnect-as-someone-else picks up the new grant instead of reusing a
// stale client for the old one.
let cachedOAuthClient: { client: OAuth2Client; email: string } | null = null;

export async function getStoredPlaybookGrantClient(): Promise<OAuth2Client | null> {
  const { kbPlaybookConnection } = createRepositories(getDb());
  const row = await kbPlaybookConnection.get();
  if (!row) return null;

  if (!cachedOAuthClient || cachedOAuthClient.email !== row.connectedEmail) {
    const client = new OAuth2Client({
      clientId: requireEnv("GOOGLE_CLIENT_ID"),
      clientSecret: requireEnv("GOOGLE_CLIENT_SECRET"),
    });
    client.setCredentials({ refresh_token: decryptPlaybookRefreshToken(row.encryptedRefreshToken) });
    cachedOAuthClient = { client, email: row.connectedEmail };
  }
  return cachedOAuthClient.client;
}

/** Invalidates the cached OAuth client — call right after storing a new
 * grant (connect) or clearing one (disconnect). */
export function invalidatePlaybookSheetsAuthCache(): void {
  cachedOAuthClient = null;
  serviceAccountAuthClient = null;
}

// Path 2 — service account (direct share). Only used as a fallback when no
// user grant (path 1) is stored.
let serviceAccountAuthClient: GoogleAuth | null = null;

function getServiceAccountAuth(): GoogleAuth | null {
  if (serviceAccountAuthClient) return serviceAccountAuthClient;

  const inlineKey = process.env.KB_PLAYBOOK_GOOGLE_SERVICE_ACCOUNT_KEY;
  const keyPath = process.env.KB_PLAYBOOK_GOOGLE_SERVICE_ACCOUNT_KEY_PATH;
  if (!inlineKey && !keyPath) return null;

  if (inlineKey) {
    let credentials: Record<string, unknown>;
    try {
      credentials = JSON.parse(inlineKey);
    } catch {
      throw new Error(
        "KB_PLAYBOOK_GOOGLE_SERVICE_ACCOUNT_KEY is set but is not valid JSON. Paste the full service-account key file contents as-is."
      );
    }
    serviceAccountAuthClient = new GoogleAuth({ credentials, scopes: [SHEETS_READONLY_SCOPE] });
  } else {
    serviceAccountAuthClient = new GoogleAuth({ keyFile: keyPath, scopes: [SHEETS_READONLY_SCOPE] });
  }
  return serviceAccountAuthClient;
}

/** Resolves whichever auth path is actually configured, preferring the
 * stored user grant (path 1). */
async function getActiveAuthClient(): Promise<{ request<T>(opts: { url: string }): Promise<{ data: T }> }> {
  const userGrantClient = await getStoredPlaybookGrantClient();
  if (userGrantClient) return userGrantClient;

  const serviceAccountAuth = getServiceAccountAuth();
  if (serviceAccountAuth) return await serviceAccountAuth.getClient();

  throw new Error(
    'Product Playbook Sheets access is not configured. Click "Connect Google Sheets" in Knowledge Base Management ' +
      "(recommended — no admin needed), or set KB_PLAYBOOK_GOOGLE_SERVICE_ACCOUNT_KEY / " +
      "KB_PLAYBOOK_GOOGLE_SERVICE_ACCOUNT_KEY_PATH for a service account instead."
  );
}

/** Fetches every row (including the header row) of a single tab as a 2D
 * array of raw cell values. UNFORMATTED_VALUE keeps numbers as numbers
 * (e.g. entry ages) rather than locale-formatted strings. */
export async function fetchPlaybookSheetValues(sheetName: string): Promise<unknown[][]> {
  const client = await getActiveAuthClient();

  const range = encodeURIComponent(`'${sheetName}'`);
  const url =
    `https://sheets.googleapis.com/v4/spreadsheets/${PLAYBOOK_SPREADSHEET_ID}/values/${range}` +
    `?valueRenderOption=UNFORMATTED_VALUE`;

  const res = await client.request<{ values?: unknown[][] }>({ url });
  return res.data.values || [];
}

/** Response shape of spreadsheets.get scoped to one sheet's row/cell notes
 * — deliberately narrowed via `fields` to just the `note` property (never
 * the cell's formatting/value/etc.), keeping the response small. */
interface GridDataResponse {
  sheets?: { data?: { rowData?: { values?: { note?: string }[] }[] }[] }[];
}

/**
 * Fetches every cell NOTE (the small hover-only annotation Google Sheets
 * shows with a red-triangle marker in the corner of a cell — distinct from
 * threaded "comments", a separate Drive-API concept this app doesn't use)
 * for one tab, as a 2D grid parallel to fetchPlaybookSheetValues's own
 * row/column indices. A cell with no note is simply absent from its row
 * array (sparse) — callers should read via `notes[r]?.[c]`, never assume
 * every row is present. Uses the exact same spreadsheets.readonly OAuth
 * scope already granted for fetchPlaybookSheetValues (the Sheets API's
 * `ranges` param triggers grid-data return with no extra consent needed —
 * see https://developers.google.com/sheets/api/reference/rest/v4/spreadsheets/get),
 * so this never prompts a re-connect.
 */
export async function fetchPlaybookSheetNotes(sheetName: string): Promise<(string | undefined)[][]> {
  const client = await getActiveAuthClient();

  const range = encodeURIComponent(`'${sheetName}'`);
  const url =
    `https://sheets.googleapis.com/v4/spreadsheets/${PLAYBOOK_SPREADSHEET_ID}` +
    `?ranges=${range}&fields=${encodeURIComponent("sheets.data.rowData.values.note")}`;

  const res = await client.request<GridDataResponse>({ url });
  const rowData = res.data.sheets?.[0]?.data?.[0]?.rowData ?? [];
  return rowData.map(row => (row.values ?? []).map(cell => cell.note));
}

/** Clears cached auth — exposed for tests only. */
export function _resetPlaybookSheetsClientForTests(): void {
  invalidatePlaybookSheetsAuthCache();
}
