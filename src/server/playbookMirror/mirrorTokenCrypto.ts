/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * PRODUCT PLAYBOOK MIRROR — REFRESH TOKEN ENCRYPTION AT REST
 * Same scheme as src/server/knowledgeBase/playbookTokenCrypto.ts
 * (AES-256-GCM, keyed from SESSION_SECRET), with its own versioned salt so
 * the mirror's grant stays independent of the existing Playbook grant.
 */

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "crypto";

const KEY_SALT = "playbook-mirror-refresh-token-v1";

function getKey(): Buffer {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error("SESSION_SECRET is required to encrypt/decrypt the Playbook mirror's stored Google refresh token.");
  }
  return scryptSync(secret, KEY_SALT, 32);
}

/** Encrypts a plaintext refresh token to base64(iv || authTag || ciphertext). */
export function encryptMirrorRefreshToken(plain: string): string {
  const key = getKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString("base64");
}

/** Reverses encryptMirrorRefreshToken. Throws if tampered with or SESSION_SECRET changed. */
export function decryptMirrorRefreshToken(encoded: string): string {
  const key = getKey();
  const raw = Buffer.from(encoded, "base64");
  const decipher = createDecipheriv("aes-256-gcm", key, raw.subarray(0, 12));
  decipher.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8");
}
