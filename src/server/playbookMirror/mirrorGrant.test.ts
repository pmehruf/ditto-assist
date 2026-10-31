/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from "vitest";
import {
  assertReadOnlyScopes,
  fetchTokenInfo,
  getVerifiedMirrorClient,
  MirrorGrantScopeError,
  SHEETS_READONLY_SCOPE,
} from "./mirrorGrant.js";

const WRITE = "https://www.googleapis.com/auth/spreadsheets";
const EMAIL_SCOPE = "https://www.googleapis.com/auth/userinfo.email";

describe("assertReadOnlyScopes", () => {
  it("accepts read-only Sheets plus identity scopes", () => {
    expect(() => assertReadOnlyScopes(["openid", EMAIL_SCOPE, SHEETS_READONLY_SCOPE])).not.toThrow();
  });
  it.each([
    ["Sheets write", WRITE],
    ["Drive", "https://www.googleapis.com/auth/drive"],
    ["Drive file", "https://www.googleapis.com/auth/drive.file"],
    ["Apps Script processes", "https://www.googleapis.com/auth/script.processes"],
    ["an unknown scope", "https://www.googleapis.com/auth/gmail.readonly"],
  ])("refuses a grant that also carries %s", (_label, extra) => {
    expect(() => assertReadOnlyScopes(["openid", SHEETS_READONLY_SCOPE, extra])).toThrow(MirrorGrantScopeError);
  });
  it("refuses a grant without read access to Sheets", () => {
    expect(() => assertReadOnlyScopes(["openid", EMAIL_SCOPE])).toThrow(/does not include read access/);
  });
});

describe("fetchTokenInfo", () => {
  it("sends the token in the POST body, never in the URL, and parses scopes", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ scope: `${SHEETS_READONLY_SCOPE} openid`, email: "A@JoinDitto.in" }) }));
    const info = await fetchTokenInfo("secret-token", fetchImpl);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, { method: string; body: string }];
    expect(url).toBe("https://oauth2.googleapis.com/tokeninfo");
    expect(url).not.toContain("secret-token");
    expect(init.method).toBe("POST");
    expect(init.body).toBe("access_token=secret-token");
    expect(info).toEqual({ scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly", "openid"], email: "a@joinditto.in" });
  });
  it("throws when Google cannot verify the token", async () => {
    const fetchImpl = async () => ({ ok: false, status: 400, json: async () => ({}) });
    await expect(fetchTokenInfo("t", fetchImpl)).rejects.toThrow(/HTTP 400/);
  });
});

describe("getVerifiedMirrorClient", () => {
  const stored = { connectedEmail: "a@joinditto.in", refreshToken: "refresh", grantedScopes: ["openid", SHEETS_READONLY_SCOPE] };
  const fakeClient = (token: string | null = "access") => () => ({
    setCredentials: vi.fn(),
    getAccessToken: vi.fn(async () => ({ token, res: null })),
  });
  const tokeninfo = (scope: string, email = "a@joinditto.in") => async () => ({ ok: true, status: 200, json: async () => ({ scope, email }) });
  const deps = (scope: string, email?: string, token?: string | null) => ({
    clientId: "id",
    clientSecret: "secret",
    fetchImpl: tokeninfo(scope, email),
    createClient: fakeClient(token === undefined ? "access" : token) as never,
  });

  it("returns the client when the live grant is still read-only and unchanged", async () => {
    const result = await getVerifiedMirrorClient(stored, deps(`openid ${SHEETS_READONLY_SCOPE}`));
    expect(result.scopes).toEqual(["https://www.googleapis.com/auth/spreadsheets.readonly", "openid"]);
  });
  it("refuses when the live grant carries write access", async () => {
    await expect(getVerifiedMirrorClient(stored, deps(`openid ${SHEETS_READONLY_SCOPE} ${WRITE}`))).rejects.toThrow(MirrorGrantScopeError);
  });
  it("refuses when the live grant has widened beyond what was stored (even if still read-only)", async () => {
    await expect(getVerifiedMirrorClient(stored, deps(`openid ${EMAIL_SCOPE} ${SHEETS_READONLY_SCOPE}`))).rejects.toThrow(/did not have when it was connected/);
  });
  it("refuses when the token belongs to another account", async () => {
    await expect(getVerifiedMirrorClient(stored, deps(`openid ${SHEETS_READONLY_SCOPE}`, "b@joinditto.in"))).rejects.toThrow(/no longer belongs/);
  });
  it("refuses when Google issues no access token", async () => {
    await expect(getVerifiedMirrorClient(stored, deps(`openid ${SHEETS_READONLY_SCOPE}`, undefined, null))).rejects.toThrow(/did not issue an access token/);
  });
});
