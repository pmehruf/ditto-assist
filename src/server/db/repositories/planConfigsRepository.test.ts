/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Regression coverage for the 2026-08-25 rename-after-delete fix: renaming
 * a plan onto a name that was previously "deleted" (removed=true tombstone,
 * not an actual DELETE — see schema.ts's comment on plan_configs.removed)
 * must reclaim that name, not fail with a spurious "already exists".
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../testUtils.js";
import { createRepositories, type Repositories } from "./index.js";

function baseEntry(planName: string, overrides: Partial<Parameters<Repositories["planConfigs"]["upsert"]>[0]> = {}) {
  return {
    planName,
    insurerName: "Test Insurer",
    questions: [{ text: "Any other conditions?", tag: "Catch-all" as const }],
    categoryMap: {},
    anyOther: "Any other conditions?",
    hasUmbrella: false,
    umbrellaQuestions: [],
    specificIllnesses: [],
    overrides: null,
    disabled: false,
    disabledNote: null,
    removed: false,
    addedBy: "tester (Developer)",
    ...overrides,
  };
}

describe("PlanConfigsRepository.rename", () => {
  let db: TestDb;
  let repos: Repositories;

  beforeEach(async () => {
    db = await createTestDb();
    repos = createRepositories(db);
  });

  afterEach(async () => {
    await db.$client.close();
  });

  it("reclaims a removed (soft-deleted) plan's name when renaming a different plan onto it", async () => {
    // "Care Supreme" existed, got Deleted (removed=true tombstone, not an
    // actual row delete).
    await repos.planConfigs.upsert(baseEntry("Care Supreme"));
    await repos.planConfigs.update("Care Supreme", { removed: true });

    // Separately, "Care Supreme New" exists and the admin renames it back.
    await repos.planConfigs.upsert(baseEntry("Care Supreme New"));
    const renamed = await repos.planConfigs.rename("Care Supreme New", "Care Supreme", {});

    expect(renamed).toBeDefined();
    expect(renamed?.planName).toBe("Care Supreme");
    expect(renamed?.removed).toBe(false);

    // Old name is gone (renamed away), no leftover tombstone duplicate.
    expect(await repos.planConfigs.get("Care Supreme New")).toBeUndefined();
    const all = await repos.planConfigs.list();
    expect(all.filter((p) => p.planName === "Care Supreme")).toHaveLength(1);
  });

  it("still rejects renaming onto a name that belongs to an ACTIVE plan", async () => {
    await repos.planConfigs.upsert(baseEntry("Plan A"));
    await repos.planConfigs.upsert(baseEntry("Plan B"));

    await expect(repos.planConfigs.rename("Plan B", "Plan A", {})).rejects.toThrow();

    // Neither plan was touched by the failed rename.
    expect(await repos.planConfigs.get("Plan A")).toBeDefined();
    expect(await repos.planConfigs.get("Plan B")).toBeDefined();
  });

  it("a plain rename with no prior tombstone at the target name still works", async () => {
    await repos.planConfigs.upsert(baseEntry("Old Name"));
    const renamed = await repos.planConfigs.rename("Old Name", "New Name", {});
    expect(renamed?.planName).toBe("New Name");
    expect(await repos.planConfigs.get("Old Name")).toBeUndefined();
  });
});
