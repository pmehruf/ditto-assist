/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * PRODUCT PLAYBOOK MIRROR — READ-ONLY GOOGLE GRANT CHECKS (Phase 1, Step 3a)
 * ---------------------------------------------------------------
 * The mirror may only ever hold a Google grant that is limited to reading
 * spreadsheets. This module asks Google (tokeninfo) which scopes a token
 * really carries and refuses anything broader:
 *   - at connect time, before the grant is stored (assertReadOnlyScopes);
 *   - every time the grant is used (getVerifiedMirrorClient), so a grant
 *     that has somehow widened since it was stored is never used.
 * The database enforces the same rule independently (CHECK constraint
 * playbook_mirror_connection_readonly_scopes, migration 0090).
 *
 * Nothing in this module can write to Google: it only reads token metadata.
 */

import { OAuth2Client } from "google-auth-library";

export const SHEETS_READONLY_SCOPE = "https://www.googleapis.com/auth/spreadsheets.readonly";

/** Every scope the mirror's grant is allowed to carry. Identity scopes are
 * harmless (they only reveal the account's own email/name); anything not on
 * this list — e.g. `spreadsheets`, `drive`, `script.processes` — is refused. */
export const ALLOWED_MIRROR_SCOPES: ReadonlySet<string> = new Set([
  SHEETS_READONLY_SCOPE,
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
]);

export class MirrorGrantScopeError extends Error {
  constructor(message: string, readonly scopes: string[]) {
    super(message);
    this.name = "MirrorGrantScopeError";
  }
}

/** Throws unless `scopes` includes spreadsheets.readonly and nothing outside ALLOWED_MIRROR_SCOPES. */
export function assertReadOnlyScopes(scopes: string[]): void {
  const unexpected = scopes.filter((s) => !ALLOWED_MIRROR_SCOPES.has(s));
  if (unexpected.length > 0) {
    throw new MirrorGrantScopeError(
      `This Google grant carries more than read-only access (${unexpected.join(", ")}). ` +
        "The Playbook mirror only accepts a read-only grant.",
      scopes
    );
  }
  if (!scopes.includes(SHEETS_READONLY_SCOPE)) {
    throw new MirrorGrantScopeError("This Google grant does not include read access to Google Sheets.", scopes);
  }
}

export interface TokenInfo {
  scopes: string[];
  email: string | null;
}

type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<{ scope?: unknown; email?: unknown }>;
}>;

/** Asks Google which scopes an access token actually carries. The token is
 * sent in a POST body (not the URL) so it never lands in request logs. */
export async function fetchTokenInfo(accessToken: string, fetchImpl: FetchLike = fetch as unknown as FetchLike): Promise<TokenInfo> {
  const res = await fetchImpl("https://oauth2.googleapis.com/tokeninfo", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ access_token: accessToken }).toString(),
  });
  if (!res.ok) throw new Error(`Google could not verify the token's scopes (HTTP ${res.status}).`);
  const info = await res.json();
  const scopes = String(info.scope ?? "")
    .split(" ")
    .map((s: string) => s.trim())
    .filter(Boolean)
    .sort();
  return { scopes, email: typeof info.email === "string" ? info.email.toLowerCase() : null };
}

export interface StoredMirrorGrant {
  connectedEmail: string;
  refreshToken: string;
  grantedScopes: string[];
}

export interface VerifiedMirrorClient {
  client: OAuth2Client;
  email: string;
  scopes: string[];
}

/**
 * Builds an OAuth client from the stored grant and re-checks, with Google,
 * that it is still read-only and still belongs to the stored account before
 * returning it. Callers (the future sync) must use only this function.
 */
export async function getVerifiedMirrorClient(
  grant: StoredMirrorGrant,
  deps: {
    clientId: string;
    clientSecret: string;
    fetchImpl?: FetchLike;
    createClient?: (clientId: string, clientSecret: string) => Pick<OAuth2Client, "setCredentials" | "getAccessToken">;
  }
): Promise<VerifiedMirrorClient> {
  const client = (deps.createClient ?? ((id, secret) => new OAuth2Client({ clientId: id, clientSecret: secret })))(
    deps.clientId,
    deps.clientSecret
  );
  client.setCredentials({ refresh_token: grant.refreshToken });
  const { token } = await client.getAccessToken();
  if (!token) throw new Error("Google did not issue an access token for the stored Playbook mirror grant.");
  const info = await fetchTokenInfo(token, deps.fetchImpl);
  assertReadOnlyScopes(info.scopes);
  const widened = info.scopes.filter((s) => !grant.grantedScopes.includes(s));
  if (widened.length > 0) {
    throw new MirrorGrantScopeError(
      `The stored Playbook mirror grant now carries scopes it did not have when it was connected (${widened.join(", ")}). Reconnect it.`,
      info.scopes
    );
  }
  if (info.email && info.email !== grant.connectedEmail.toLowerCase()) {
    throw new Error("The stored Playbook mirror grant no longer belongs to the account that connected it. Reconnect it.");
  }
  return { client: client as OAuth2Client, email: grant.connectedEmail, scopes: info.scopes };
}
