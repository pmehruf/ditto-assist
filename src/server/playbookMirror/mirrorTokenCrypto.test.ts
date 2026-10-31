/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { decryptMirrorRefreshToken, encryptMirrorRefreshToken } from "./mirrorTokenCrypto.js";
import { decryptPlaybookRefreshToken } from "../knowledgeBase/playbookTokenCrypto.js";

describe("mirrorTokenCrypto", () => {
  const previous = process.env.SESSION_SECRET;
  beforeAll(() => {
    process.env.SESSION_SECRET = "test-secret-for-mirror-crypto";
  });
  afterAll(() => {
    if (previous === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = previous;
  });

  it("round-trips a refresh token and never stores it in plain text", () => {
    const encoded = encryptMirrorRefreshToken("1//refresh-token");
    expect(encoded).not.toContain("refresh-token");
    expect(decryptMirrorRefreshToken(encoded)).toBe("1//refresh-token");
  });

  it("rejects a tampered value", () => {
    const raw = Buffer.from(encryptMirrorRefreshToken("1//refresh-token"), "base64");
    raw[raw.length - 1] ^= 0xff;
    expect(() => decryptMirrorRefreshToken(raw.toString("base64"))).toThrow();
  });

  it("uses its own key, independent of the existing Playbook grant's encryption", () => {
    expect(() => decryptPlaybookRefreshToken(encryptMirrorRefreshToken("1//refresh-token"))).toThrow();
  });
});
