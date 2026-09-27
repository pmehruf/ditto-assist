/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * DB-integration tests for ChangeLogRepository's `actionTypePrefixes`
 * filter — Access Control Center Phase 5
 * (docs/ACCESS_CONTROL_CENTER_PHASE_PLAN.md). Runs against a real (PGlite)
 * Postgres instance with every migration applied. The pre-existing single
 * `actionType` prefix filter already has real-world coverage via every
 * route that calls GET /api/change-logs; these tests focus on the new
 * OR-of-prefix behavior added for `scope=access-control`.
 */
import { describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../testUtils.js";
import { createRepositories } from "./index.js";

async function seedEntries(db: TestDb) {
  const { changeLogs } = createRepositories(db);
  await changeLogs.create({ userName: "Test User", role: "Developer", actionType: "Department Created", planName: null, description: "d1" });
  await changeLogs.create({ userName: "Test User", role: "Developer", actionType: "Team Edited", planName: null, description: "d2" });
  await changeLogs.create({ userName: "Test User", role: "Developer", actionType: "Announcement Added", planName: null, description: "d3" });
  await changeLogs.create({ userName: "Test User", role: "Developer", actionType: "PED Repository Entry Added", planName: null, description: "d4" });
}

describe("ChangeLogRepository actionTypePrefixes filter", () => {
  it("listPaginated: matches any of several prefixes (OR), excludes the rest", async () => {
    const db = await createTestDb();
    await seedEntries(db);
    const { changeLogs } = createRepositories(db);

    const result = await changeLogs.listPaginated({ actionTypePrefixes: ["Department", "Team"] });
    expect(result.total).toBe(2);
    expect(result.data.map((r) => r.actionType).sort()).toEqual(["Department Created", "Team Edited"]);
  });

  it("listPaginated: an explicit single actionType prefix wins over actionTypePrefixes when both are given", async () => {
    const db = await createTestDb();
    await seedEntries(db);
    const { changeLogs } = createRepositories(db);

    const result = await changeLogs.listPaginated({ actionType: "Department", actionTypePrefixes: ["Department", "Team", "Announcement"] });
    expect(result.total).toBe(1);
    expect(result.data[0].actionType).toBe("Department Created");
  });

  it("listPaginated: an empty actionTypePrefixes array is treated as no filter", async () => {
    const db = await createTestDb();
    await seedEntries(db);
    const { changeLogs } = createRepositories(db);

    const result = await changeLogs.listPaginated({ actionTypePrefixes: [] });
    expect(result.total).toBe(4);
  });

  it("listMatching: same OR-of-prefix behavior, unpaginated", async () => {
    const db = await createTestDb();
    await seedEntries(db);
    const { changeLogs } = createRepositories(db);

    const rows = await changeLogs.listMatching({ actionTypePrefixes: ["Announcement", "PED Repository"] });
    expect(rows.map((r) => r.actionType).sort()).toEqual(["Announcement Added", "PED Repository Entry Added"]);
  });

  it("listPaginated: actionTypePrefixes combines with search (AND)", async () => {
    const db = await createTestDb();
    await seedEntries(db);
    const { changeLogs } = createRepositories(db);

    const matches = await changeLogs.listPaginated({ actionTypePrefixes: ["Department", "Team"], search: "d2" });
    expect(matches.total).toBe(1);
    expect(matches.data[0].actionType).toBe("Team Edited");

    const noMatches = await changeLogs.listPaginated({ actionTypePrefixes: ["Department", "Team"], search: "d3" });
    expect(noMatches.total).toBe(0);
  });
});
