/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../testUtils.js";
import { FlaggedIssuesRepository } from "./flaggedIssuesRepository.js";

describe("FlaggedIssuesRepository", () => {
  let db: TestDb;
  let repo: FlaggedIssuesRepository;

  beforeEach(async () => {
    db = await createTestDb();
    repo = new FlaggedIssuesRepository(db);
  });

  afterEach(async () => {
    await db.$client.close();
  });

  const baseEntry = {
    userEmail: "alice@joinditto.in",
    userName: "Alice",
    userTactId: "TACT-001",
    planName: "Plan A",
    pedInput: "diabetes",
    matchedQuestion: "Do you have diabetes?",
    matchType: "Exact",
    source: "System Rule",
    explanation: "Matched via keyword rule.",
    issueNotes: "This match looks wrong.",
  };

  it("creates a flagged issue defaulted to Pending", async () => {
    const created = await repo.create(baseEntry);
    expect(created.status).toBe("Pending");
    expect(created.resolvedAt).toBeNull();
  });

  it("lists most-recent-first", async () => {
    await repo.create({ ...baseEntry, timestamp: "2026-01-01T00:00:00Z" });
    await repo.create({ ...baseEntry, timestamp: "2026-01-02T00:00:00Z", pedInput: "asthma" });

    const rows = await repo.list();
    expect(rows).toHaveLength(2);
    expect(rows[0].pedInput).toBe("asthma");
  });

  it("owner can triage: update status, ownerNotes, and resolvedAt", async () => {
    const created = await repo.create(baseEntry);
    const updated = await repo.update(created.id, {
      status: "Resolved",
      ownerNotes: "Confirmed correct after review.",
      resolvedAt: "2026-01-03T00:00:00Z",
    });
    expect(updated?.status).toBe("Resolved");
    expect(updated?.ownerNotes).toBe("Confirmed correct after review.");
    expect(updated?.resolvedAt).not.toBeNull();
  });

  it("filters by status, userEmail, and planName", async () => {
    const created = await repo.create(baseEntry);
    await repo.update(created.id, { status: "Urgent" });
    await repo.create({ ...baseEntry, userEmail: "bob@joinditto.in", planName: "Plan B" });

    expect(await repo.list({ status: "Urgent" })).toHaveLength(1);
    expect(await repo.list({ userEmail: "bob@joinditto.in" })).toHaveLength(1);
    expect(await repo.list({ planName: "Plan A" })).toHaveLength(1);
  });
});
