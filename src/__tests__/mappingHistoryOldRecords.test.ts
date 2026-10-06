/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createMappingTestEnv, type MappingTestEnv } from "./helpers/mappingTestDb";

/**
 * The review window no longer asks for an owner's approval. Changes saved earlier keep the value they were saved with
 * ("none" or "approved: <name>"); History does not depend on it, and a new change simply stores "none".
 */

let env: MappingTestEnv;
beforeAll(async () => {
  env = await createMappingTestEnv();
}, 60_000);

describe("History after the approval question was removed", () => {
  it("lists an older change that was saved with an approval, value untouched", async () => {
    const created = await env.repos.mappingChangeSets.create({
      kind: "admin_change",
      summary: "Edited a plan",
      status: "applied",
      ops: [],
      verification: {},
      performedBy: "Someone (Admin)",
      reason: "R10 correction (owner-approved)",
      changeCategory: "Regression fix",
      businessDecision: "approved: Mehruf P",
      impactTier: "high",
    });
    const recent = await env.repos.mappingChangeSets.listRecent(50);
    const old = recent.find((r) => r.id === created.id);
    expect(old?.businessDecision).toBe("approved: Mehruf P");
    expect(old?.changeCategory).toBe("Regression fix");
    expect(old?.reason).toMatch(/R10 correction/);
  });

  it("a change saved without any approval value reads back as none", async () => {
    const created = await env.repos.mappingChangeSets.create({
      kind: "admin_change",
      summary: "Edited a plan",
      status: "applied",
      ops: [],
      verification: {},
      performedBy: "Someone (Admin)",
      reason: "A newer change",
      changeCategory: "Plan override",
      businessDecision: "none",
      impactTier: "low",
    });
    expect((await env.repos.mappingChangeSets.get(created.id))?.businessDecision).toBe("none");
  });

  it("the History screen never reads the approval value", () => {
    const history = readFileSync(new URL("../../src/components/MappingHistoryPanel.tsx", import.meta.url), "utf8");
    expect(history).not.toMatch(/businessDecision/);
  });
});
