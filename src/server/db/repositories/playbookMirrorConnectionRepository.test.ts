/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../testUtils.js";
import { PlaybookMirrorConnectionRepository } from "./playbookMirrorConnectionRepository.js";
import { KbPlaybookConnectionRepository } from "./kbPlaybookConnectionRepository.js";

const READONLY = "https://www.googleapis.com/auth/spreadsheets.readonly";

describe("PlaybookMirrorConnectionRepository", () => {
  let db: TestDb;
  let repo: PlaybookMirrorConnectionRepository;

  beforeEach(async () => {
    db = await createTestDb();
    repo = new PlaybookMirrorConnectionRepository(db);
  });

  it("stores, replaces and clears the read-only grant", async () => {
    expect(await repo.get()).toBeUndefined();
    await repo.upsert({ connectedEmail: "a@joinditto.in", encryptedRefreshToken: "enc1", grantedScopes: ["openid", READONLY], connectedBy: "a@joinditto.in" });
    await repo.upsert({ connectedEmail: "b@joinditto.in", encryptedRefreshToken: "enc2", grantedScopes: [READONLY], connectedBy: "b@joinditto.in" });
    const row = await repo.get();
    expect(row).toMatchObject({ domain: "Health", connectedEmail: "b@joinditto.in", encryptedRefreshToken: "enc2", grantedScopes: [READONLY] });
    await repo.clear();
    expect(await repo.get()).toBeUndefined();
  });

  it("is refused by the database when the recorded scopes include write access", async () => {
    let error: { message: string; cause?: { message?: string } } | null = null;
    try {
      await repo.upsert({
        connectedEmail: "a@joinditto.in",
        encryptedRefreshToken: "enc",
        grantedScopes: [READONLY, "https://www.googleapis.com/auth/spreadsheets"],
        connectedBy: "a@joinditto.in",
      });
    } catch (e) {
      error = e as { message: string; cause?: { message?: string } };
    }
    expect(error).not.toBeNull();
    expect(`${error?.cause?.message ?? ""} ${error?.message ?? ""}`).toMatch(/playbook_mirror_connection_readonly_scopes/);
    expect(await repo.get()).toBeUndefined();
  });

  it("never touches the existing Product Playbook connection", async () => {
    const existing = new KbPlaybookConnectionRepository(db);
    await existing.upsert({ connectedEmail: "old@joinditto.in", encryptedRefreshToken: "old", connectedBy: "old@joinditto.in" });
    await repo.upsert({ connectedEmail: "a@joinditto.in", encryptedRefreshToken: "enc", grantedScopes: [READONLY], connectedBy: "a@joinditto.in" });
    await repo.clear();
    expect(await existing.get()).toMatchObject({ connectedEmail: "old@joinditto.in", encryptedRefreshToken: "old" });
  });
});
