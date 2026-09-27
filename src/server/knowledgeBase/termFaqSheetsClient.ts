/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * TERM FAQ — GOOGLE SHEETS READ CLIENT
 * ---------------------------------------------------------------
 * Read-only access to the Term FAQ workbook (Sheet ID below), modeled
 * directly on src/server/knowledgeBase/faqSheetsClient.ts — see that file's
 * header for the full two-path auth writeup. Kept as its own client (own
 * connection table, own cache) rather than reusing Health's, since the Term
 * FAQ Sheet has a different owner/account:
 *
 *   1. Stored user OAuth grant (RECOMMENDED) — whoever has access to the
 *      sheet clicks "Connect Google Sheets" on the Connections page,
 *      consenting to a read-only Sheets scope on the app's existing login
 *      client. The refresh token is encrypted and stored in Postgres (see
 *      termFaqConnectionRepository.ts / termFaqTokenCrypto.ts).
 *   2. Service account + direct share — set
 *      KB_TERM_FAQ_GOOGLE_SERVICE_ACCOUNT_KEY(_PATH) and share the sheet
 *      with that service account's email as Viewer. Only used as a fallback
 *      when no user grant is stored.
 *
 * Scope is always spreadsheets.readonly; no code path here can write to the
 * sheet.
 */

import { GoogleAuth, OAuth2Client } from "google-auth-library";
import { getDb } from "../db/client.js";
import { createRepositories } from "../db/repositories/index.js";
import { decryptTermFaqRefreshToken } from "./termFaqTokenCrypto.js";

// From the sheet's own share URL.
export const TERM_FAQ_SPREADSHEET_ID = "1VoS8HiXyTMVMKHoI1FN9OWL_V4Tud5ceCKVPoqOSY7g";

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

export async function getStoredTermFaqGrantClient(): Promise<OAuth2Client | null> {
  const { termFaqConnection } = createRepositories(getDb());
  const row = await termFaqConnection.get();
  if (!row) return null;

  if (!cachedOAuthClient || cachedOAuthClient.email !== row.connectedEmail) {
    const client = new OAuth2Client({
      clientId: requireEnv("GOOGLE_CLIENT_ID"),
      clientSecret: requireEnv("GOOGLE_CLIENT_SECRET"),
    });
    client.setCredentials({ refresh_token: decryptTermFaqRefreshToken(row.encryptedRefreshToken) });
    cachedOAuthClient = { client, email: row.connectedEmail };
  }
  return cachedOAuthClient.client;
}

/** Invalidates the cached OAuth client — call right after storing a new
 * grant (connect) or clearing one (disconnect). */
export function invalidateTermFaqSheetsAuthCache(): void {
  cachedOAuthClient = null;
  serviceAccountAuthClient = null;
}

// Path 2 — service account (direct share). Only used as a fallback when no
// user grant (path 1) is stored.
let serviceAccountAuthClient: GoogleAuth | null = null;

function getServiceAccountAuth(): GoogleAuth | null {
  if (serviceAccountAuthClient) return serviceAccountAuthClient;

  const inlineKey = process.env.KB_TERM_FAQ_GOOGLE_SERVICE_ACCOUNT_KEY;
  const keyPath = process.env.KB_TERM_FAQ_GOOGLE_SERVICE_ACCOUNT_KEY_PATH;
  if (!inlineKey && !keyPath) return null;

  if (inlineKey) {
    let credentials: Record<string, unknown>;
    try {
      credentials = JSON.parse(inlineKey);
    } catch {
      throw new Error(
        "KB_TERM_FAQ_GOOGLE_SERVICE_ACCOUNT_KEY is set but is not valid JSON. Paste the full service-account key file contents as-is."
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
  const userGrantClient = await getStoredTermFaqGrantClient();
  if (userGrantClient) return userGrantClient;

  const serviceAccountAuth = getServiceAccountAuth();
  if (serviceAccountAuth) return await serviceAccountAuth.getClient();

  throw new Error(
    'Term FAQ Sheets access is not configured. Click "Connect Google Sheets" on the Connections page ' +
      "(recommended — no admin needed), or set KB_TERM_FAQ_GOOGLE_SERVICE_ACCOUNT_KEY / " +
      "KB_TERM_FAQ_GOOGLE_SERVICE_ACCOUNT_KEY_PATH for a service account instead."
  );
}

/** Fetches every row (including the header row) of a single tab as a 2D
 * array of raw cell values. UNFORMATTED_VALUE keeps values as plain
 * strings/numbers rather than locale-formatted display text. */
export async function fetchTermFaqSheetValues(sheetName: string): Promise<unknown[][]> {
  const client = await getActiveAuthClient();

  const range = encodeURIComponent(`'${sheetName}'`);
  const url =
    `https://sheets.googleapis.com/v4/spreadsheets/${TERM_FAQ_SPREADSHEET_ID}/values/${range}` +
    `?valueRenderOption=UNFORMATTED_VALUE`;

  const res = await client.request<{ values?: unknown[][] }>({ url });
  return res.data.values || [];
}

/** Clears cached auth — exposed for tests only. */
export function _resetTermFaqSheetsClientForTests(): void {
  invalidateTermFaqSheetsAuthCache();
}
