/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../testUtils.js";
import { AnnouncementsRepository } from "./announcementsRepository.js";

describe("AnnouncementsRepository", () => {
  let db: TestDb;
  let repo: AnnouncementsRepository;

  beforeEach(async () => {
    db = await createTestDb();
    repo = new AnnouncementsRepository(db);
  });

  afterEach(async () => {
    await db.$client.close();
  });

  const baseEntry = {
    announcement: "New PED mapping released for Plan A.",
    category: "Plan A",
    addedBy: "Alice",
  };

  it("creates with defaulted type and lists most-recent-first", async () => {
    const created = await repo.create(baseEntry);
    expect(created.type).toBe("QA Announcement");

    await repo.create({ ...baseEntry, announcement: "Second announcement" });
    const rows = await repo.list();
    expect(rows).toHaveLength(2);
    expect(rows[0].announcement).toBe("Second announcement");
  });

  it("updates fields in place", async () => {
    const created = await repo.create(baseEntry);
    const updated = await repo.update(created.id, { title: "Updated Title" });
    expect(updated?.title).toBe("Updated Title");
    expect(updated?.announcement).toBe(baseEntry.announcement);
  });

  it("deletes an announcement", async () => {
    const created = await repo.create(baseEntry);
    await repo.delete(created.id);
    expect(await repo.getById(created.id)).toBeUndefined();
  });

  it("filters by category and type", async () => {
    await repo.create({ ...baseEntry, category: "Plan A", type: "QA Announcement" });
    await repo.create({ ...baseEntry, category: "Plan B", type: "General Announcement" });

    expect(await repo.list({ category: "Plan A" })).toHaveLength(1);
    expect(await repo.list({ type: "General Announcement" })).toHaveLength(1);
  });

  it("filters by validAsOf against validTillDate", async () => {
    await repo.create({ ...baseEntry, validTillDate: "2026-12-31" });
    await repo.create({ ...baseEntry, validTillDate: "2026-01-01" });

    const rows = await repo.list({ validAsOf: "2026-06-01" });
    expect(rows).toHaveLength(1);
    expect(rows[0].validTillDate).toBe("2026-12-31");
  });

  describe("enforceRetentionLimit", () => {
    it("does nothing when the count is at or under the limit", async () => {
      await repo.create({ ...baseEntry, type: "QA Announcement" });
      await repo.create({ ...baseEntry, type: "QA Announcement" });
      const deleted = await repo.enforceRetentionLimit("QA Announcement", 2);
      expect(deleted).toEqual([]);
      expect(await repo.list({ type: "QA Announcement" })).toHaveLength(2);
    });

    it("deletes only the oldest rows beyond the limit, keeping the newest", async () => {
      const first = await repo.create({ ...baseEntry, announcement: "oldest", type: "QA Announcement" });
      const second = await repo.create({ ...baseEntry, announcement: "middle", type: "QA Announcement" });
      const third = await repo.create({ ...baseEntry, announcement: "newest", type: "QA Announcement" });

      const deleted = await repo.enforceRetentionLimit("QA Announcement", 2);
      expect(deleted).toEqual([first.id]);

      const remaining = await repo.list({ type: "QA Announcement" });
      expect(remaining.map((r) => r.id).sort()).toEqual([second.id, third.id].sort());
    });

    it("prunes QA and General independently — trimming one never touches the other", async () => {
      const oldQa = await repo.create({ ...baseEntry, announcement: "old qa", type: "QA Announcement" });
      await repo.create({ ...baseEntry, announcement: "new qa", type: "QA Announcement" });
      const oldGeneral = await repo.create({ ...baseEntry, announcement: "old general", type: "General Announcement" });

      const deleted = await repo.enforceRetentionLimit("QA Announcement", 1);
      expect(deleted).toEqual([oldQa.id]);

      // General's single row survives untouched even though it would also
      // exceed a limit of 1 on its own — this call only ever scopes to the
      // type it was called with.
      expect(await repo.getById(oldGeneral.id)).toBeDefined();
    });
  });
});
