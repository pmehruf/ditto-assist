/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * QA DASHBOARD — GOOGLE SHEETS READ CLIENT
 * ---------------------------------------------------------------
 * Read-only access to the QA Dashboard's master workbook (Sheet ID below),
 * which remains the single source of truth for QA data — this app never
 * writes to it. See QA_DASHBOARD_SHEETS_SETUP.md for the one-time Google
 * Cloud step (service account + share) this depends on.
 *
 * Auth — THREE possible paths, tried in this order (see
 * QA_DASHBOARD_SHEETS_SETUP.md for the full walkthrough of all three):
 *
 *   1. Stored user OAuth grant (RECOMMENDED — no admin involvement at all).
 *      Whoever already has access to the sheet clicks "Connect Google
 *      Sheets" in Developer Controls, consenting to one extra read-only
 *      scope on the app's existing login client. The resulting refresh
 *      token is encrypted and stored in Postgres (see
 *      qaDashboardConnectionRepository.ts / tokenCrypto.ts) and used here —
 *      this app then reads the sheet exactly as that person already can,
 *      with no sharing, service account, or Workspace policy involved.
 *   2. Service account + direct share — the sheet is shared with a service
 *      account's email as Viewer. Simple, but many Workspace orgs block
 *      sharing with any non-@yourdomain identity (service accounts
 *      included) via an external-sharing allowlist policy.
 *   3. Service account + domain-wide delegation (QA_DASHBOARD_IMPERSONATE_SUBJECT) —
 *      needs a Workspace admin to authorize the service account org-wide.
 *      Only relevant if you specifically want a machine identity instead of
 *      a real person's OAuth grant; path 1 above is preferred for most setups.
 *
 * Scope is always spreadsheets.readonly, matching the source sheet's own
 * "STRICT RESTRICTION — READ ONLY" annotation; no code path here can write
 * to the sheet even under path 1's broader user identity.
 *
 * Uses google-auth-library's GoogleAuth (already a dependency, used for the
 * OAuth login flow) directly against the Sheets API v4 REST endpoint, so no
 * extra `googleapis` package is needed for what is otherwise a handful of
 * GET calls.
 *
 * DATE HANDLING — why there's no timezone conversion anywhere in here:
 * Values are fetched with dateTimeRenderOption=SERIAL_NUMBER, so date cells
 * come back as Sheets/Excel-style serial numbers (integer part = calendar
 * day count since 1899-12-30, fractional part = time of day) rather than
 * locale-formatted strings or JS Date objects. A serial's integer part
 * already IS the cell's displayed calendar date — no timezone attaches to
 * it at all, unlike Apps Script's getValues(), which hands back real Date
 * objects anchored to the spreadsheet's timezone (the source of the
 * timezone bug documented in Phase1_DataEngine.gs's _parseSheetDate). As
 * long as filter boundaries are built the same way (see dateStringToSerial
 * below) and every comparison happens in serial-number space (qaDataEngine.ts),
 * comparisons are exact and there's no equivalent bug to reintroduce here.
 */

import { GoogleAuth, OAuth2Client } from "google-auth-library";
import { getDb } from "../db/client.js";
import { createRepositories } from "../db/repositories/index.js";
import { decryptQaRefreshToken } from "./tokenCrypto.js";

// Same workbook the standalone Apps Script project reads
// (Phase1_DataEngine.gs MASTER_SPREADSHEET_ID) — do not change without
// confirming with whoever owns the QA process; this is their source of
// truth, not something this app's team can migrate unilaterally.
export const QA_MASTER_SPREADSHEET_ID = "1G3x6NyoeLKHNvCmivgHZbEChnyskQVH8RgL3SlmmzWY";

const SHEETS_READONLY_SCOPE = "https://www.googleapis.com/auth/spreadsheets.readonly";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} environment variable is required. See .env.example.`);
  return value;
}

// Path 1 — stored user OAuth grant (see qaDashboardConnectionRepository.ts).
// Cached by connected email so a reconnect-as-someone-else picks up the new
// grant instead of reusing a stale client for the old one.
let cachedOAuthClient: { client: OAuth2Client; email: string } | null = null;

async function getStoredUserGrantClient(): Promise<OAuth2Client | null> {
  const { qaDashboardConnection } = createRepositories(getDb());
  const row = await qaDashboardConnection.get();
  if (!row) return null;

  if (!cachedOAuthClient || cachedOAuthClient.email !== row.connectedEmail) {
    const client = new OAuth2Client({
      clientId: requireEnv("GOOGLE_CLIENT_ID"),
      clientSecret: requireEnv("GOOGLE_CLIENT_SECRET"),
    });
    client.setCredentials({ refresh_token: decryptQaRefreshToken(row.encryptedRefreshToken) });
    cachedOAuthClient = { client, email: row.connectedEmail };
  }
  return cachedOAuthClient.client;
}

/** Invalidates the cached OAuth client — call right after storing a new
 * grant (connect) or clearing one (disconnect) so the very next read picks
 * up the change without waiting for a server restart. */
export function invalidateQaSheetsAuthCache(): void {
  cachedOAuthClient = null;
  serviceAccountAuthClient = null;
}

// Path 2/3 — service account (direct share, or domain-wide delegation via
// QA_DASHBOARD_IMPERSONATE_SUBJECT). Only used as a fallback when no user
// grant (path 1) is stored — see file header for when you'd want this.
let serviceAccountAuthClient: GoogleAuth | null = null;

function getServiceAccountAuth(): GoogleAuth | null {
  if (serviceAccountAuthClient) return serviceAccountAuthClient;

  const inlineKey = process.env.QA_DASHBOARD_GOOGLE_SERVICE_ACCOUNT_KEY;
  const keyPath = process.env.QA_DASHBOARD_GOOGLE_SERVICE_ACCOUNT_KEY_PATH;
  if (!inlineKey && !keyPath) return null;

  const impersonateSubject = process.env.QA_DASHBOARD_IMPERSONATE_SUBJECT || undefined;
  const clientOptions = impersonateSubject ? { subject: impersonateSubject } : undefined;

  if (inlineKey) {
    let credentials: Record<string, unknown>;
    try {
      credentials = JSON.parse(inlineKey);
    } catch {
      throw new Error(
        "QA_DASHBOARD_GOOGLE_SERVICE_ACCOUNT_KEY is set but is not valid JSON. " +
          "Paste the full service-account key file contents as-is."
      );
    }
    serviceAccountAuthClient = new GoogleAuth({ credentials, scopes: [SHEETS_READONLY_SCOPE], clientOptions });
  } else {
    serviceAccountAuthClient = new GoogleAuth({ keyFile: keyPath, scopes: [SHEETS_READONLY_SCOPE], clientOptions });
  }
  return serviceAccountAuthClient;
}

/** Resolves whichever auth path is actually configured, preferring the
 * stored user grant (path 1) — see file header for the full priority order
 * and why. Both GoogleAuth and OAuth2Client expose a compatible
 * `.request()` method, so callers don't need to care which one they got. */
async function getActiveAuthClient(): Promise<{ request<T>(opts: { url: string }): Promise<{ data: T }> }> {
  const userGrantClient = await getStoredUserGrantClient();
  if (userGrantClient) return userGrantClient;

  const serviceAccountAuth = getServiceAccountAuth();
  if (serviceAccountAuth) return await serviceAccountAuth.getClient();

  throw new Error(
    "QA Dashboard Sheets access is not configured. Either click \"Connect Google Sheets\" in Developer Controls " +
      "(recommended — no admin needed), or set QA_DASHBOARD_GOOGLE_SERVICE_ACCOUNT_KEY / " +
      "QA_DASHBOARD_GOOGLE_SERVICE_ACCOUNT_KEY_PATH for a service account instead — see QA_DASHBOARD_SHEETS_SETUP.md."
  );
}

/** Fetches every row (including the header row) of a single sheet/tab as a
 * 2D array of raw cell values, exactly like Apps Script's
 * sheet.getDataRange().getValues() — except date cells are Sheets serial
 * numbers (see file header) rather than JS Date objects; qaDataEngine.ts's
 * column-aware readers convert only the columns it knows are dates. */
export async function fetchSheetValues(sheetName: string): Promise<unknown[][]> {
  const client = await getActiveAuthClient();

  const range = encodeURIComponent(`'${sheetName}'`);
  const url =
    `https://sheets.googleapis.com/v4/spreadsheets/${QA_MASTER_SPREADSHEET_ID}/values/${range}` +
    `?valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=SERIAL_NUMBER`;

  const res = await client.request<{ values?: unknown[][] }>({ url });
  return res.data.values || [];
}

const SHEETS_SERIAL_EPOCH = Date.UTC(1899, 11, 30); // day 0 of the Sheets/Excel serial system
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Converts a "yyyy-MM-dd" filter-input string (from an HTML date input)
 * into the same serial-number space sheet date cells live in, so range
 * comparisons never have to cross a timezone boundary. `endOfDay` mirrors
 * _parseSheetDate(dateStr, true) — pushes to just before the next day's
 * serial, matching the pattern used for the "checkedTo" (inclusive end)
 * boundary. */
export function dateStringToSerial(dateStr: string, endOfDay = false): number {
  const [y, m, d] = dateStr.trim().split("-").map(Number);
  const utcMidnight = Date.UTC(y, (m || 1) - 1, d || 1);
  const dayInt = Math.round((utcMidnight - SHEETS_SERIAL_EPOCH) / MS_PER_DAY);
  return endOfDay ? dayInt + 1 - 1e-9 : dayInt;
}

/** Converts a sheet date serial back to "DD-MM-YY" for display, matching
 * Phase1_DataEngine.gs's _formatDateDMY(). Pure calendar math on the
 * integer day count — no timezone involved (see file header). */
export function serialToDMY(serial: number): string {
  const ms = SHEETS_SERIAL_EPOCH + Math.floor(serial) * MS_PER_DAY;
  const d = new Date(ms);
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const yy = String(d.getUTCFullYear()).slice(-2);
  return `${dd}-${mm}-${yy}`;
}

/** Clears cached auth — exposed for tests only. */
export function _resetSheetsClientForTests(): void {
  invalidateQaSheetsAuthCache();
}
