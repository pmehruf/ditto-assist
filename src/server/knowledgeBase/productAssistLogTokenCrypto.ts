/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * QUERY ASSIST LOG EXPORT — REFRESH TOKEN ENCRYPTION AT REST
 * ---------------------------------------------------------------
 * The stored Google OAuth refresh token (see
 * productAssistLogExportConnectionRepository) grants WRITE access to the
 * export Google Sheet on behalf of whoever clicked "Connect Google Sheets"
 * for Product Assist Log Export in Connections. Same AES-256-GCM-keyed-from-
 * SESSION_SECRET approach as qaDashboard/tokenCrypto.ts and
 * playbookTokenCrypto.ts (own salt, own copy — this app's established
 * one-copy-per-feature convention for this exact pattern), so a database
 * dump or leaked backup alone can't be used to write to the sheet.
 */

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "crypto";

// Fixed, non-secret salt — scrypt still requires one, but the actual secret
// (SESSION_SECRET) is what makes the derived key unguessable. Deliberately
// distinct from the QA Dashboard's and Playbook's own salts so the three
// derived keys are independent even though they share the same underlying
// secret.
const KEY_SALT = "product-assist-log-export-refresh-token-v1";

function getKey(): Buffer {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error("SESSION_SECRET is required to encrypt/decrypt the Product Assist Log Export's stored Google refresh token.");
  }
  return scryptSync(secret, KEY_SALT, 32);
}

/** Encrypts a plaintext refresh token to a single base64 string
 * (iv || authTag || ciphertext). */
export function encryptProductAssistLogRefreshToken(plain: string): string {
  const key = getKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, ciphertext]).toString("base64");
}

/** Reverses encryptProductAssistLogRefreshToken. Throws if the value was
 * tampered with or SESSION_SECRET has changed since encryption (GCM
 * auth-tag mismatch). */
export function decryptProductAssistLogRefreshToken(encoded: string): string {
  const key = getKey();
  const raw = Buffer.from(encoded, "base64");
  const iv = raw.subarray(0, 12);
  const authTag = raw.subarray(12, 28);
  const ciphertext = raw.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}
