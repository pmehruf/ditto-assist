/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * QA DASHBOARD — REFRESH TOKEN ENCRYPTION AT REST
 * ---------------------------------------------------------------
 * The stored Google OAuth refresh token (see qaDashboardConnectionRepository)
 * grants read-only access to the QA team's Sheet on behalf of whoever
 * clicked "Connect Google Sheets" in Developer Controls. It's encrypted
 * before it ever touches Postgres — AES-256-GCM, keyed from the same
 * SESSION_SECRET already required for session cookies (no new secret to
 * provision), so a database dump or leaked backup alone can't be used to
 * read the sheet.
 */

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "crypto";

// Fixed, non-secret salt — scrypt still requires one, but the actual secret
// (SESSION_SECRET) is what makes the derived key unguessable. Versioned in
// case the derivation ever needs to change without silently breaking
// previously-encrypted rows.
const KEY_SALT = "qa-dashboard-refresh-token-v1";

function getKey(): Buffer {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error("SESSION_SECRET is required to encrypt/decrypt the QA Dashboard's stored Google refresh token.");
  }
  return scryptSync(secret, KEY_SALT, 32);
}

/** Encrypts a plaintext refresh token to a single base64 string
 * (iv || authTag || ciphertext). */
export function encryptQaRefreshToken(plain: string): string {
  const key = getKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, ciphertext]).toString("base64");
}

/** Reverses encryptQaRefreshToken. Throws if the value was tampered with or
 * SESSION_SECRET has changed since encryption (GCM auth-tag mismatch). */
export function decryptQaRefreshToken(encoded: string): string {
  const key = getKey();
  const raw = Buffer.from(encoded, "base64");
  const iv = raw.subarray(0, 12);
  const authTag = raw.subarray(12, 28);
  const ciphertext = raw.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}
