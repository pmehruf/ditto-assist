/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../testUtils.js";
import { SearchHistoryRepository } from "./searchHistoryRepository.js";

describe("SearchHistoryRepository", () => {
  let db: TestDb;
  let repo: SearchHistoryRepository;

  beforeEach(async () => {
    db = await createTestDb();
    repo = new SearchHistoryRepository(db);
  });

  afterEach(async () => {
    await db.$client.close();
  });

  const baseEntry = {
    userEmail: "alice@joinditto.in",
    planName: "Plan A",
    pedInput: "diabetes",
    matchedQuestion: "Do you have diabetes?",
    matchType: "Exact",
    source: "System Rule",
    explanation: "Matched via keyword rule.",
  };

  it("creates and lists entries most-recent-first", async () => {
    await repo.create({ ...baseEntry, timestamp: "2026-01-01T00:00:00Z" });
    await repo.create({ ...baseEntry, timestamp: "2026-01-02T00:00:00Z", pedInput: "asthma" });

    const rows = await repo.list();
    expect(rows).toHaveLength(2);
    expect(rows[0].pedInput).toBe("asthma");
    expect(rows[1].pedInput).toBe("diabetes");
  });

  it("filters by userEmail (powers My Activity tab)", async () => {
    await repo.create({ ...baseEntry, userEmail: "alice@joinditto.in" });
    await repo.create({ ...baseEntry, userEmail: "bob@joinditto.in" });

    const rows = await repo.list({ userEmail: "bob@joinditto.in" });
    expect(rows).toHaveLength(1);
    expect(rows[0].userEmail).toBe("bob@joinditto.in");
  });

  it("filters by planName and date range", async () => {
    await repo.create({ ...baseEntry, planName: "Plan A", timestamp: "2026-01-01T00:00:00Z" });
    await repo.create({ ...baseEntry, planName: "Plan B", timestamp: "2026-01-05T00:00:00Z" });

    const byPlan = await repo.list({ planName: "Plan A" });
    expect(byPlan).toHaveLength(1);

    const byDate = await repo.list({ from: "2026-01-03T00:00:00Z" });
    expect(byDate).toHaveLength(1);
    expect(byDate[0].planName).toBe("Plan B");
  });

  it("respects the limit option", async () => {
    for (let i = 0; i < 5; i++) {
      await repo.create({ ...baseEntry, pedInput: `condition-${i}` });
    }
    const rows = await repo.list({ limit: 2 });
    expect(rows).toHaveLength(2);
  });

  it("clearAll empties the table", async () => {
    await repo.create(baseEntry);
    await repo.clearAll();
    const rows = await repo.list();
    expect(rows).toHaveLength(0);
  });
});
