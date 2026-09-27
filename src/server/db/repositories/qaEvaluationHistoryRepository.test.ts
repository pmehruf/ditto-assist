/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../testUtils.js";
import { QaEvaluationHistoryRepository, type NewQaEvaluationHistoryEntry } from "./qaEvaluationHistoryRepository.js";

describe("QaEvaluationHistoryRepository", () => {
  let db: TestDb;
  let repo: QaEvaluationHistoryRepository;

  beforeEach(async () => {
    db = await createTestDb();
    repo = new QaEvaluationHistoryRepository(db);
  });

  afterEach(async () => {
    await db.$client.close();
  });

  const row = (checkedDate: string, tactId = "TACT-1"): NewQaEvaluationHistoryEntry => ({
    checkedDate,
    mistakeDate: checkedDate,
    tactId,
    advisorName: "Alice",
    chatId: `chat-${checkedDate}-${tactId}`,
    domain: "CHAT",
    score: 5,
  });

  // Mirrors the real archive's shape: a frozen historical import with no
  // rows in "this month"/"last month" of a live system — see the 2026-08-17
  // investigation (min/max checked_date was 2025-06-01..2026-05-31, and
  // last_30d_rows/this_month_rows both came back 0 against the real table).
  async function seedArchiveLikeData() {
    await repo.bulkInsert([
      row("2025-06-01"),
      row("2025-12-15"),
      row("2026-01-01"),
      row("2026-01-31"),
      row("2026-02-01"),
      row("2026-05-31"),
    ]);
  }

  it("listAll returns every row, sorted by checkedDate, without id/createdAt", async () => {
    await seedArchiveLikeData();
    const rows = await repo.listAll();
    expect(rows).toHaveLength(6);
    expect(rows.map((r) => r.checkedDate)).toEqual(["2025-06-01", "2025-12-15", "2026-01-01", "2026-01-31", "2026-02-01", "2026-05-31"]);
    for (const r of rows) {
      expect(r).not.toHaveProperty("id");
      expect(r).not.toHaveProperty("createdAt");
    }
  });

  it("listInRange returns an empty array for a window with no archived rows — the Home-page 'current month' case", async () => {
    await seedArchiveLikeData();
    // Simulates QaPerformancePeek's monthRange(0)/monthRange(1) once "today"
    // has moved past the archive's actual max checked_date (2026-05-31).
    const rows = await repo.listInRange("2026-07-01", "2026-08-31");
    expect(rows).toEqual([]);
  });

  it("listInRange is inclusive at both boundaries and excludes rows just outside them", async () => {
    await seedArchiveLikeData();
    const rows = await repo.listInRange("2026-01-01", "2026-01-31");
    expect(rows.map((r) => r.checkedDate)).toEqual(["2026-01-01", "2026-01-31"]);
    // Neighboring rows (2025-12-15, 2026-02-01) must NOT leak in.
    expect(rows.some((r) => r.checkedDate === "2025-12-15")).toBe(false);
    expect(rows.some((r) => r.checkedDate === "2026-02-01")).toBe(false);
  });

  it("listInRange over the archive's full span matches listAll (a real historical date-range query)", async () => {
    await seedArchiveLikeData();
    const all = await repo.listAll();
    const ranged = await repo.listInRange("2025-06-01", "2026-05-31");
    expect(ranged).toEqual(all);
  });

  it("listAll (the all-time path getAdvisorReviews relies on) is unaffected by any range semantics", async () => {
    await seedArchiveLikeData();
    // No matter what a caller's own unrelated date filters look like,
    // listAll() must keep returning the complete, unfiltered archive.
    const rows = await repo.listAll();
    expect(rows).toHaveLength(6);
  });

  // ── source_batch scoping (2026-09) — the original (NULL source_batch)
  // import and a later batch-stamped import must never be able to wipe each
  // other out. ──────────────────────────────────────────────────────────
  describe("batch scoping", () => {
    const batchRow = (batch: string, checkedDate: string): NewQaEvaluationHistoryEntry => ({
      checkedDate,
      mistakeDate: null,
      tactId: "TACT-2",
      advisorName: "Bob",
      chatId: `chat-${batch}-${checkedDate}`,
      domain: "FIRST_CALL",
      score: 4,
      sourceBatch: batch,
    });

    it("deleteAll only removes NULL-source_batch rows, leaving batch-stamped rows untouched", async () => {
      await seedArchiveLikeData(); // all NULL source_batch
      await repo.bulkInsert([batchRow("2026-06-manual-backfill", "2026-06-01")]);

      await repo.deleteAll();

      const remaining = await repo.listAll();
      expect(remaining).toHaveLength(1);
      expect(remaining[0].sourceBatch).toBe("2026-06-manual-backfill");
    });

    it("deleteByBatch only removes rows in that batch, leaving the original (NULL) archive and other batches untouched", async () => {
      await seedArchiveLikeData(); // all NULL source_batch, 6 rows
      await repo.bulkInsert([
        batchRow("2026-06-manual-backfill", "2026-06-01"),
        batchRow("2026-06-manual-backfill", "2026-06-02"),
        batchRow("2026-07-manual-backfill", "2026-07-01"),
      ]);

      await repo.deleteByBatch("2026-06-manual-backfill");

      const remaining = await repo.listAll();
      expect(remaining).toHaveLength(7); // 6 original + the untouched 2026-07 batch row
      expect(remaining.some((r) => r.sourceBatch === "2026-06-manual-backfill")).toBe(false);
      expect(remaining.filter((r) => r.sourceBatch === null)).toHaveLength(6);
      expect(remaining.some((r) => r.sourceBatch === "2026-07-manual-backfill")).toBe(true);
    });

    it("countByBatch counts only that batch's rows", async () => {
      await seedArchiveLikeData();
      await repo.bulkInsert([
        batchRow("2026-06-manual-backfill", "2026-06-01"),
        batchRow("2026-06-manual-backfill", "2026-06-02"),
      ]);

      expect(await repo.countByBatch("2026-06-manual-backfill")).toBe(2);
      expect(await repo.countByBatch("2026-07-manual-backfill")).toBe(0);
    });
  });
});
