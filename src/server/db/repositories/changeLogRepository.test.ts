/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../testUtils.js";
import { ChangeLogRepository } from "./changeLogRepository.js";

describe("ChangeLogRepository", () => {
  let db: TestDb;
  let repo: ChangeLogRepository;

  beforeEach(async () => {
    db = await createTestDb();
    repo = new ChangeLogRepository(db);
  });

  afterEach(async () => {
    await db.$client.close();
  });

  const baseEntry = {
    userName: "Alice",
    role: "Developer",
    actionType: "Draft Approved",
    planName: "Plan A",
    description: "Approved the draft PED mapping.",
  };

  it("creates and lists entries most-recent-first", async () => {
    await repo.create({ ...baseEntry, timestamp: "2026-01-01T00:00:00Z" });
    await repo.create({
      ...baseEntry,
      timestamp: "2026-01-02T00:00:00Z",
      actionType: "Insurer Edited",
    });

    const rows = await repo.list();
    expect(rows).toHaveLength(2);
    expect(rows[0].actionType).toBe("Insurer Edited");
    expect(rows[1].actionType).toBe("Draft Approved");
  });

  it("stores an optional jsonb snapshot", async () => {
    const created = await repo.create({
      ...baseEntry,
      snapshot: { before: { field: "old" }, after: { field: "new" } },
    });
    expect(created.snapshot).toEqual({ before: { field: "old" }, after: { field: "new" } });
  });

  it("filters by actionType, planName, and userName", async () => {
    await repo.create({ ...baseEntry, actionType: "Draft Created", userName: "Alice" });
    await repo.create({ ...baseEntry, actionType: "Draft Approved", userName: "Bob" });

    expect(await repo.list({ actionType: "Draft Created" })).toHaveLength(1);
    expect(await repo.list({ userName: "Bob" })).toHaveLength(1);
    expect(await repo.list({ planName: "Plan A" })).toHaveLength(2);
  });

  it("clearAll empties the table", async () => {
    await repo.create(baseEntry);
    await repo.clearAll();
    expect(await repo.list()).toHaveLength(0);
  });
});
