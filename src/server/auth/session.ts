/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Stateless, signed-cookie session tokens.
 *
 * Cloud Run can scale to multiple instances with no shared memory, so
 * sessions can't live in an in-process store. Instead the "session" is the
 * cookie itself: a base64url JSON payload plus an HMAC-SHA256 signature
 * keyed by SESSION_SECRET. Any instance can verify any token without a
 * shared session store or database round-trip.
 *
 * This only proves "this token was issued by our server and hasn't
 * expired" — it does NOT re-verify the user still belongs to the right
 * Google Group on every request. Role/permission lookups (Phase 4c) are a
 * separate, deliberately-not-cached check layered on top of this identity.
 */

import crypto from "crypto";

export interface SessionUser {
  email: string;
  name: string;
  picture?: string;
}

interface SessionPayload extends SessionUser {
  exp: number;
}

export const SESSION_COOKIE_NAME = "ditto_session";
export const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function getSessionSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error(
      "SESSION_SECRET environment variable is required to sign session cookies. See .env.example."
    );
  }
  return secret;
}

function sign(payload: string): string {
  return crypto.createHmac("sha256", getSessionSecret()).update(payload).digest("base64url");
}

export function createSessionToken(user: SessionUser): string {
  const payload: SessionPayload = { ...user, exp: Date.now() + SESSION_MAX_AGE_MS };
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = sign(encoded);
  return `${encoded}.${signature}`;
}

/** Verifies signature + expiry and returns the embedded user, or null if invalid/expired/missing. */
export function verifySessionToken(token: string | undefined | null): SessionUser | null {
  if (!token) return null;
  const dot = token.lastIndexOf(".");
  if (dot === -1) return null;
  const encoded = token.slice(0, dot);
  const signature = token.slice(dot + 1);
  if (!encoded || !signature) return null;

  const expected = sign(encoded);
  const provided = Buffer.from(signature);
  const expectedBuf = Buffer.from(expected);
  if (provided.length !== expectedBuf.length || !crypto.timingSafeEqual(provided, expectedBuf)) {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as SessionPayload;
    if (typeof payload.exp !== "number" || Date.now() > payload.exp) return null;
    if (typeof payload.email !== "string" || typeof payload.name !== "string") return null;
    return { email: payload.email, name: payload.name, picture: payload.picture };
  } catch {
    return null;
  }
}
