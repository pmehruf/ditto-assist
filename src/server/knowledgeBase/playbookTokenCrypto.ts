/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * PRODUCT PLAYBOOK — REFRESH TOKEN ENCRYPTION AT REST
 * ---------------------------------------------------------------
 * Same scheme as src/server/qaDashboard/tokenCrypto.ts (AES-256-GCM, keyed
 * from SESSION_SECRET) — duplicated rather than shared so the Playbook's
 * stored grant (kbPlaybookConnection) stays fully independent of the QA
 * Dashboard's, with its own versioned salt.
 */

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "crypto";

const KEY_SALT = "kb-playbook-refresh-token-v1";

function getKey(): Buffer {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error("SESSION_SECRET is required to encrypt/decrypt the Product Playbook's stored Google refresh token.");
  }
  return scryptSync(secret, KEY_SALT, 32);
}

/** Encrypts a plaintext refresh token to a single base64 string
 * (iv || authTag || ciphertext). */
export function encryptPlaybookRefreshToken(plain: string): string {
  const key = getKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, ciphertext]).toString("base64");
}

/** Reverses encryptPlaybookRefreshToken. Throws if the value was tampered
 * with or SESSION_SECRET has changed since encryption (GCM auth-tag
 * mismatch). */
export function decryptPlaybookRefreshToken(encoded: string): string {
  const key = getKey();
  const raw = Buffer.from(encoded, "base64");
  const iv = raw.subarray(0, 12);
  const authTag = raw.subarray(12, 28);
  const ciphertext = raw.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}
