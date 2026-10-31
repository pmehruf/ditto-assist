/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from "vitest";

const request = vi.fn(async () => ({ data: '{"ok":true}' }));
vi.mock("./mirrorGrant.js", () => ({
  getVerifiedMirrorClient: vi.fn(async () => ({ client: { request }, email: "reader@joinditto.in", scopes: [] })),
}));
vi.mock("./mirrorTokenCrypto.js", () => ({ decryptMirrorRefreshToken: () => "refresh" }));

const { createVerifiedMirrorTextClient } = await import("./client.js");

const connections = {
  get: async () => ({ connectedEmail: "reader@joinditto.in", encryptedRefreshToken: "enc", grantedScopes: ["openid"] }),
} as never;

describe("createVerifiedMirrorTextClient", () => {
  it("only issues GET requests to this spreadsheet and returns the body unchanged", async () => {
    const client = await createVerifiedMirrorTextClient(connections, "SHEET1");
    expect(await client.requestText("https://sheets.googleapis.com/v4/spreadsheets/SHEET1?fields=x")).toBe('{"ok":true}');
    expect(request).toHaveBeenCalledWith({ url: "https://sheets.googleapis.com/v4/spreadsheets/SHEET1?fields=x", method: "GET", responseType: "text" });
  });

  it("refuses any other URL", async () => {
    const client = await createVerifiedMirrorTextClient(connections, "SHEET1");
    await expect(client.requestText("https://sheets.googleapis.com/v4/spreadsheets/OTHER?fields=x")).rejects.toThrow(/only read its own spreadsheet/);
    await expect(client.requestText("https://sheets.googleapis.com/v4/spreadsheets/SHEET1/values:batchUpdate?x")).rejects.toThrow(/only read its own spreadsheet/);
  });

  it("fails clearly when the mirror isn't connected", async () => {
    await expect(createVerifiedMirrorTextClient({ get: async () => undefined } as never, "SHEET1")).rejects.toThrow(/not connected/);
  });
});
