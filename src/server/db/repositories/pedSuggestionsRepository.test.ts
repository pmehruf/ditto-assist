/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../testUtils.js";
import { PedSuggestionsRepository } from "./pedSuggestionsRepository.js";

describe("PedSuggestionsRepository", () => {
  let db: TestDb;
  let repo: PedSuggestionsRepository;

  beforeEach(async () => {
    db = await createTestDb();
    repo = new PedSuggestionsRepository(db);
  });

  afterEach(async () => {
    await db.$client.close();
  });

  // IMPORTANT: `ped_directory` is not an empty table in a fresh test db —
  // createTestDb() runs the SAME migrations that run in production, and
  // several of those (0007, 0009, 0013) seed ~1,223 real PED terms
  // (including plain "Hypertension", "Asthma", "COPD", ...) as one-time data
  // backfills, not just schema DDL. Every fixture term/category below is
  // prefixed with "Zqtest"/"zqtest_" specifically so it can never collide
  // with that real seed data, and every assertion is scoped (via `search`
  // or a fabricated `category` key) to just these 5 rows — asserting an
  // unscoped `total` or exact category list against the whole table would
  // otherwise be asserting against ~1,223 real rows this test doesn't own.
  const seed = async () => {
    await repo.create({ term: "Zqtest Diabetes Type 2", category: "zqtest_diabetes", addedBy: "Seed" });
    await repo.create({ term: "Zqtest Hypertension Variant", category: "zqtest_cardiac", addedBy: "Seed" });
    await repo.create({ term: "Zqtest Asthma Variant", category: null, addedBy: "Seed" });
    await repo.create({ term: "Zqtest COPD Variant", category: null, addedBy: "Seed" });
    await repo.create({ term: "Zqtest Diabetes Type 1", category: "zqtest_diabetes", addedBy: "Seed" });
  };

  it("paginates and reports an accurate total independent of page size", async () => {
    await seed();
    const page1 = await repo.listPaginated({ search: "zqtest", page: 1, pageSize: 2 });
    expect(page1.data).toHaveLength(2);
    expect(page1.total).toBe(5);
    expect(page1.totalPages).toBe(3);
  });

  it("defaults to alphabetical order by term", async () => {
    await seed();
    const result = await repo.listPaginated({ search: "zqtest", pageSize: 10 });
    expect(result.data.map(r => r.term)).toEqual([
      "Zqtest Asthma Variant",
      "Zqtest COPD Variant",
      "Zqtest Diabetes Type 1",
      "Zqtest Diabetes Type 2",
      "Zqtest Hypertension Variant",
    ]);
  });

  it("searches term case-insensitively across the full table, not just the current page", async () => {
    await seed();
    // "ZQTEST diabetes" (mixed case) matches only the two Diabetes fixtures
    // — proves both the case-insensitivity and the substring match.
    const result = await repo.listPaginated({ search: "ZQTEST diabetes", pageSize: 1 });
    expect(result.total).toBe(2);
  });

  it("filters by category, including the 'uncategorized' pseudo-filter", async () => {
    await seed();
    // A fabricated category key is inherently scoped — nothing else in the
    // table uses it — but "uncategorized" and "all" match every null/every
    // row table-wide, so those two are additionally scoped via `search`.
    expect((await repo.listPaginated({ category: "zqtest_diabetes" })).total).toBe(2);
    expect((await repo.listPaginated({ category: "uncategorized", search: "zqtest" })).total).toBe(2);
    expect((await repo.listPaginated({ category: "all", search: "zqtest" })).total).toBe(5);
  });

  it("combines search and category filter (both narrow the same result set)", async () => {
    await seed();
    const result = await repo.listPaginated({ search: "type", category: "zqtest_diabetes" });
    expect(result.total).toBe(2);
  });

  it("listMatching returns every matching row unpaginated, for CSV export", async () => {
    await seed();
    const rows = await repo.listMatching({ category: "zqtest_diabetes" });
    expect(rows).toHaveLength(2);
  });

  it("listCategoriesInUse includes every distinct category actually present, including null for uncategorized rows", async () => {
    await seed();
    const rows = await repo.listCategoriesInUse();
    const categories = rows.map(r => r.category);
    // Can't assert an exact/closed list here — the real seeded directory
    // has many other real categories too. Assert our fixtures' categories
    // are present, and that selectDistinct never repeats a category.
    expect(categories).toContain("zqtest_diabetes");
    expect(categories).toContain("zqtest_cardiac");
    expect(categories).toContain(null);
    expect(new Set(categories).size).toBe(categories.length);
  });

  it("clamps an out-of-range page into bounds and returns that page's actual data, not an empty array", async () => {
    await seed();
    const result = await repo.listPaginated({ search: "zqtest", page: 99, pageSize: 2 });
    expect(result.page).toBe(3);
    expect(result.data).toHaveLength(1);
    expect(result.data[0].term).toBe("Zqtest Hypertension Variant");
  });
});
