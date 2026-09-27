/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * TERM PRODUCT PLAYBOOK — GOOGLE SHEETS READ CLIENT
 * ---------------------------------------------------------------
 * Read-only access to the Term Product Playbook workbook (Sheet ID below),
 * modeled directly on src/server/knowledgeBase/playbookSheetsClient.ts — see
 * that file's header for the full two-path auth writeup. Kept as its own
 * client (own connection table, own cache) rather than reusing Health's,
 * since the Term Playbook Sheet has a different owner/account:
 *
 *   1. Stored user OAuth grant (RECOMMENDED) — whoever has access to the
 *      sheet clicks "Connect Google Sheets" on the Connections page,
 *      consenting to a read-only Sheets scope on the app's existing login
 *      client. The refresh token is encrypted and stored in Postgres (see
 *      termPlaybookConnectionRepository.ts / termPlaybookTokenCrypto.ts).
 *   2. Service account + direct share — set
 *      KB_TERM_PLAYBOOK_GOOGLE_SERVICE_ACCOUNT_KEY(_PATH) and share the
 *      sheet with that service account's email as Viewer. Only used as a
 *      fallback when no user grant is stored.
 *
 * Scope is always spreadsheets.readonly; no code path here can write to the
 * sheet.
 */

import { GoogleAuth, OAuth2Client } from "google-auth-library";
import { getDb } from "../db/client.js";
import { createRepositories } from "../db/repositories/index.js";
import { decryptTermPlaybookRefreshToken } from "./termPlaybookTokenCrypto.js";

// From the sheet's own share URL.
export const TERM_PLAYBOOK_SPREADSHEET_ID = "14TWy-0Bp6H2myW-29Khfc3EcBe_AkUm8a-nmSdheWEU";

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

export async function getStoredTermPlaybookGrantClient(): Promise<OAuth2Client | null> {
  const { termPlaybookConnection } = createRepositories(getDb());
  const row = await termPlaybookConnection.get();
  if (!row) return null;

  if (!cachedOAuthClient || cachedOAuthClient.email !== row.connectedEmail) {
    const client = new OAuth2Client({
      clientId: requireEnv("GOOGLE_CLIENT_ID"),
      clientSecret: requireEnv("GOOGLE_CLIENT_SECRET"),
    });
    client.setCredentials({ refresh_token: decryptTermPlaybookRefreshToken(row.encryptedRefreshToken) });
    cachedOAuthClient = { client, email: row.connectedEmail };
  }
  return cachedOAuthClient.client;
}

/** Invalidates the cached OAuth client — call right after storing a new
 * grant (connect) or clearing one (disconnect). */
export function invalidateTermPlaybookSheetsAuthCache(): void {
  cachedOAuthClient = null;
  serviceAccountAuthClient = null;
}

// Path 2 — service account (direct share). Only used as a fallback when no
// user grant (path 1) is stored.
let serviceAccountAuthClient: GoogleAuth | null = null;

function getServiceAccountAuth(): GoogleAuth | null {
  if (serviceAccountAuthClient) return serviceAccountAuthClient;

  const inlineKey = process.env.KB_TERM_PLAYBOOK_GOOGLE_SERVICE_ACCOUNT_KEY;
  const keyPath = process.env.KB_TERM_PLAYBOOK_GOOGLE_SERVICE_ACCOUNT_KEY_PATH;
  if (!inlineKey && !keyPath) return null;

  if (inlineKey) {
    let credentials: Record<string, unknown>;
    try {
      credentials = JSON.parse(inlineKey);
    } catch {
      throw new Error(
        "KB_TERM_PLAYBOOK_GOOGLE_SERVICE_ACCOUNT_KEY is set but is not valid JSON. Paste the full service-account key file contents as-is."
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
  const userGrantClient = await getStoredTermPlaybookGrantClient();
  if (userGrantClient) return userGrantClient;

  const serviceAccountAuth = getServiceAccountAuth();
  if (serviceAccountAuth) return await serviceAccountAuth.getClient();

  throw new Error(
    'Term Playbook Sheets access is not configured. Click "Connect Google Sheets" on the Connections page ' +
      "(recommended — no admin needed), or set KB_TERM_PLAYBOOK_GOOGLE_SERVICE_ACCOUNT_KEY / " +
      "KB_TERM_PLAYBOOK_GOOGLE_SERVICE_ACCOUNT_KEY_PATH for a service account instead."
  );
}

/** Fetches every row (including the header row) of a single tab as a 2D
 * array of raw cell values. UNFORMATTED_VALUE keeps numbers as numbers
 * (e.g. entry ages) rather than locale-formatted strings. */
export async function fetchTermPlaybookSheetValues(sheetName: string): Promise<unknown[][]> {
  const client = await getActiveAuthClient();

  const range = encodeURIComponent(`'${sheetName}'`);
  const url =
    `https://sheets.googleapis.com/v4/spreadsheets/${TERM_PLAYBOOK_SPREADSHEET_ID}/values/${range}` +
    `?valueRenderOption=UNFORMATTED_VALUE`;

  const res = await client.request<{ values?: unknown[][] }>({ url });
  return res.data.values || [];
}

/** Response shape of spreadsheets.get scoped to one sheet's row/cell notes
 * — see playbookSheetsClient.ts's identical GridDataResponse/
 * fetchPlaybookSheetNotes for the full reasoning this mirrors. */
interface GridDataResponse {
  sheets?: { data?: { rowData?: { values?: { note?: string }[] }[] }[] }[];
}

/** Term twin of fetchPlaybookSheetNotes — same spreadsheets.readonly scope
 * already granted for fetchTermPlaybookSheetValues, no new consent needed.
 * Returns a sparse 2D grid parallel to fetchTermPlaybookSheetValues's own
 * row/column indices; read via `notes[r]?.[c]`. */
export async function fetchTermPlaybookSheetNotes(sheetName: string): Promise<(string | undefined)[][]> {
  const client = await getActiveAuthClient();

  const range = encodeURIComponent(`'${sheetName}'`);
  const url =
    `https://sheets.googleapis.com/v4/spreadsheets/${TERM_PLAYBOOK_SPREADSHEET_ID}` +
    `?ranges=${range}&fields=${encodeURIComponent("sheets.data.rowData.values.note")}`;

  const res = await client.request<GridDataResponse>({ url });
  const rowData = res.data.sheets?.[0]?.data?.[0]?.rowData ?? [];
  return rowData.map(row => (row.values ?? []).map(cell => cell.note));
}

/** Clears cached auth — exposed for tests only. */
export function _resetTermPlaybookSheetsClientForTests(): void {
  invalidateTermPlaybookSheetsAuthCache();
}
