/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Server-side Google Workspace OAuth 2.0 login, restricted to @joinditto.in
 * accounts.
 *
 * IMPORTANT: the `hd` (hosted domain) parameter passed to Google's consent
 * screen is only a UI hint that pre-filters the account chooser — a user
 * can still bypass it and authenticate with a personal Gmail account. The
 * actual security boundary is the server-side check in
 * `exchangeCodeForIdentity`, which verifies both the `email` and `hd`
 * claims on the *signature-verified* ID token before an identity is ever
 * trusted. Never rely on the `hd` URL param alone.
 */

import { OAuth2Client } from "google-auth-library";

const ALLOWED_DOMAIN = "joinditto.in";

let _client: OAuth2Client | null = null;

function getRedirectUri(): string {
  const appUrl = process.env.APP_URL || `http://localhost:${process.env.PORT || 3000}`;
  return `${appUrl.replace(/\/+$/, "")}/api/auth/google/callback`;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} environment variable is required. See .env.example.`);
  }
  return value;
}

export function getOAuthClient(): OAuth2Client {
  if (!_client) {
    const clientId = requireEnv("GOOGLE_CLIENT_ID");
    const clientSecret = requireEnv("GOOGLE_CLIENT_SECRET");
    _client = new OAuth2Client({
      clientId,
      clientSecret,
      redirectUri: getRedirectUri(),
    });
  }
  return _client;
}

/** Builds the Google consent-screen URL. `state` should be a random, single-use CSRF nonce. */
export function getGoogleAuthUrl(state: string): string {
  const client = getOAuthClient();
  return client.generateAuthUrl({
    access_type: "online",
    scope: ["openid", "email", "profile"],
    hd: ALLOWED_DOMAIN,
    prompt: "select_account",
    state,
  });
}

export interface GoogleIdentity {
  email: string;
  name: string;
  picture?: string;
}

/**
 * Exchanges an OAuth authorization code for tokens, verifies the ID token's
 * signature/audience/issuer via Google's library, and enforces the
 * @joinditto.in domain restriction server-side. Throws on any failure —
 * callers must treat a thrown error as "reject the login attempt."
 */
export async function exchangeCodeForIdentity(code: string): Promise<GoogleIdentity> {
  const client = getOAuthClient();
  const { tokens } = await client.getToken(code);
  if (!tokens.id_token) {
    throw new Error("Google did not return an id_token for this authorization code.");
  }

  const ticket = await client.verifyIdToken({
    idToken: tokens.id_token,
    audience: requireEnv("GOOGLE_CLIENT_ID"),
  });
  const payload = ticket.getPayload();
  if (!payload || !payload.email) {
    throw new Error("Could not read an identity from the Google ID token.");
  }
  if (!payload.email_verified) {
    throw new Error("Google account email is not verified.");
  }

  const emailDomain = payload.email.split("@")[1]?.toLowerCase();
  const hdClaim = payload.hd?.toLowerCase();
  if (emailDomain !== ALLOWED_DOMAIN || hdClaim !== ALLOWED_DOMAIN) {
    throw new Error(`Access restricted to @${ALLOWED_DOMAIN} Google Workspace accounts.`);
  }

  return {
    email: payload.email.toLowerCase(),
    name: payload.name || payload.email,
    picture: payload.picture,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// QA DASHBOARD — "Connect Google Sheets" incremental-scope grant.
//
// Reuses this exact same OAuth client (same client ID/secret, same
// registered redirect URI) rather than needing a second one registered in
// Cloud Console — the only difference from the login flow above is the
// extra `spreadsheets.readonly` scope and `access_type: "offline"` (so
// Google issues a refresh token) + `prompt: "consent"` (so it issues one
// EVERY time, not just on first-ever consent — otherwise reconnecting after
// a disconnect would silently fail to get a new refresh token). See
// server.ts's /api/qa-dashboard/connect-google and the shared callback
// route, which branches on which of two distinctly-named state cookies is
// present to tell this flow apart from a normal login.
// ─────────────────────────────────────────────────────────────────────────

const QA_SHEETS_READONLY_SCOPE = "https://www.googleapis.com/auth/spreadsheets.readonly";
// Lets this same grant also read the QA Google Sheet's Apps Script project's
// execution history (Executions/Processes API) — used for the "Last
// updated" timestamp on the Workspace's QA Performance card, sourced from
// processRawDump's actual trigger history rather than a guess. Anyone who
// (re)connects needs Editor/Owner access to that Apps Script project itself,
// not just Viewer access to the Sheet — Viewer-on-Sheet doesn't carry
// visibility into the bound script's executions.
const QA_SCRIPT_PROCESSES_SCOPE = "https://www.googleapis.com/auth/script.processes";

export function getQaDashboardSheetsAuthUrl(state: string, loginHint?: string): string {
  const client = getOAuthClient();
  return client.generateAuthUrl({
    access_type: "offline",
    scope: ["openid", "email", QA_SHEETS_READONLY_SCOPE, QA_SCRIPT_PROCESSES_SCOPE],
    hd: ALLOWED_DOMAIN,
    prompt: "consent",
    include_granted_scopes: true,
    state,
    login_hint: loginHint,
  });
}

export interface QaDashboardSheetsGrant {
  email: string;
  refreshToken: string;
}

/**
 * Exchanges the "Connect Google Sheets" authorization code for a refresh
 * token, verifying the consenting identity the same way exchangeCodeForIdentity
 * does (signature/domain-checked ID token) — this grant is only ever
 * useful, and only ever stored, for a real @joinditto.in account.
 */
export async function exchangeCodeForQaDashboardSheetsGrant(code: string): Promise<QaDashboardSheetsGrant> {
  const client = getOAuthClient();
  const { tokens } = await client.getToken(code);

  if (!tokens.refresh_token) {
    throw new Error(
      "Google did not return a refresh token for this connection. This usually happens when the account has a " +
        "prior grant cached — revoke this app's access at https://myaccount.google.com/permissions and try " +
        "connecting again."
    );
  }
  if (!tokens.id_token) {
    throw new Error("Google did not return an id_token for this authorization code.");
  }

  const ticket = await client.verifyIdToken({
    idToken: tokens.id_token,
    audience: requireEnv("GOOGLE_CLIENT_ID"),
  });
  const payload = ticket.getPayload();
  if (!payload || !payload.email) {
    throw new Error("Could not read an identity from the Google ID token.");
  }
  if (!payload.email_verified) {
    throw new Error("Google account email is not verified.");
  }

  const emailDomain = payload.email.split("@")[1]?.toLowerCase();
  const hdClaim = payload.hd?.toLowerCase();
  if (emailDomain !== ALLOWED_DOMAIN || hdClaim !== ALLOWED_DOMAIN) {
    throw new Error(`Access restricted to @${ALLOWED_DOMAIN} Google Workspace accounts.`);
  }

  return { email: payload.email.toLowerCase(), refreshToken: tokens.refresh_token };
}

// ─────────────────────────────────────────────────────────────────────────
// PRODUCT PLAYBOOK SHEET — "Connect Google Sheets" incremental-scope grant.
//
// Same pattern as the QA Dashboard grant above (same OAuth client, same
// registered redirect URI, disambiguated in server.ts's shared callback by
// a distinctly-named state cookie) but its own function pair/scope list —
// kept separate because the Playbook Sheet has a different owner/account
// than the QA workbook, so the two grants are connected independently (from
// Knowledge Base Management, not Developer Controls) and stored in their
// own table (kbPlaybookConnection). Only spreadsheets.readonly is
// requested — no Apps Script execution-history scope, since the Playbook
// doesn't need one.
// ─────────────────────────────────────────────────────────────────────────

const PLAYBOOK_SHEETS_READONLY_SCOPE = "https://www.googleapis.com/auth/spreadsheets.readonly";

export function getKbPlaybookSheetsAuthUrl(state: string, loginHint?: string): string {
  const client = getOAuthClient();
  return client.generateAuthUrl({
    access_type: "offline",
    scope: ["openid", "email", PLAYBOOK_SHEETS_READONLY_SCOPE],
    hd: ALLOWED_DOMAIN,
    prompt: "consent",
    include_granted_scopes: true,
    state,
    login_hint: loginHint,
  });
}

export interface KbPlaybookSheetsGrant {
  email: string;
  refreshToken: string;
}

/**
 * Exchanges the Playbook's "Connect Google Sheets" authorization code for a
 * refresh token — same verification discipline as
 * exchangeCodeForQaDashboardSheetsGrant (signature/domain-checked ID
 * token); only ever stored for a real @joinditto.in account.
 */
export async function exchangeCodeForKbPlaybookSheetsGrant(code: string): Promise<KbPlaybookSheetsGrant> {
  const client = getOAuthClient();
  const { tokens } = await client.getToken(code);

  if (!tokens.refresh_token) {
    throw new Error(
      "Google did not return a refresh token for this connection. This usually happens when the account has a " +
        "prior grant cached — revoke this app's access at https://myaccount.google.com/permissions and try " +
        "connecting again."
    );
  }
  if (!tokens.id_token) {
    throw new Error("Google did not return an id_token for this authorization code.");
  }

  const ticket = await client.verifyIdToken({
    idToken: tokens.id_token,
    audience: requireEnv("GOOGLE_CLIENT_ID"),
  });
  const payload = ticket.getPayload();
  if (!payload || !payload.email) {
    throw new Error("Could not read an identity from the Google ID token.");
  }
  if (!payload.email_verified) {
    throw new Error("Google account email is not verified.");
  }

  const emailDomain = payload.email.split("@")[1]?.toLowerCase();
  const hdClaim = payload.hd?.toLowerCase();
  if (emailDomain !== ALLOWED_DOMAIN || hdClaim !== ALLOWED_DOMAIN) {
    throw new Error(`Access restricted to @${ALLOWED_DOMAIN} Google Workspace accounts.`);
  }

  return { email: payload.email.toLowerCase(), refreshToken: tokens.refresh_token };
}
