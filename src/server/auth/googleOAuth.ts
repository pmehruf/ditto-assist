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
