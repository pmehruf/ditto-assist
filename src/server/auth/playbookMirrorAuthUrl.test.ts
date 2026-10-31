/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeAll, describe, expect, it } from "vitest";

describe("getPlaybookMirrorAuthUrl", () => {
  let url: URL;
  let existingPlaybookUrl: URL;

  beforeAll(async () => {
    process.env.GOOGLE_CLIENT_ID ??= "test-client-id.apps.googleusercontent.com";
    process.env.GOOGLE_CLIENT_SECRET ??= "test-client-secret";
    const { getPlaybookMirrorAuthUrl, getKbPlaybookSheetsAuthUrl } = await import("./googleOAuth.js");
    url = new URL(getPlaybookMirrorAuthUrl("state123", "a@joinditto.in"));
    existingPlaybookUrl = new URL(getKbPlaybookSheetsAuthUrl("state456", "a@joinditto.in"));
  });

  it("asks only for identity plus read-only Sheets access", () => {
    expect(url.searchParams.get("scope")!.split(" ").sort()).toEqual(
      ["email", "https://www.googleapis.com/auth/spreadsheets.readonly", "openid"].sort()
    );
  });

  it("does not merge in scopes granted to this app elsewhere", () => {
    expect(url.searchParams.get("include_granted_scopes")).toBe("false");
  });

  it("requests an offline grant with fresh consent, the state nonce and the Ditto domain hint", () => {
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent");
    expect(url.searchParams.get("state")).toBe("state123");
    expect(url.searchParams.get("hd")).toBe("joinditto.in");
  });

  it("leaves the existing Product Playbook connect URL exactly as before", () => {
    expect(existingPlaybookUrl.searchParams.get("include_granted_scopes")).toBe("true");
    expect(existingPlaybookUrl.searchParams.get("scope")!.split(" ").sort()).toEqual(
      ["email", "https://www.googleapis.com/auth/spreadsheets.readonly", "openid"].sort()
    );
  });
});
