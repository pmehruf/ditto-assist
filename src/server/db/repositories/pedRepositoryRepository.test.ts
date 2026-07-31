/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../testUtils.js";
import { PedRepositoryRepository } from "./pedRepositoryRepository.js";

describe("PedRepositoryRepository", () => {
  let db: TestDb;
  let repo: PedRepositoryRepository;

  beforeEach(async () => {
    db = await createTestDb();
    repo = new PedRepositoryRepository(db);
  });

  afterEach(async () => {
    await db.$client.close();
  });

  const seed = async () => {
    await repo.create({ canonicalName: "Diabetes Type 2", categoryKey: "diabetes", status: "approved", addedBy: "Seed" });
    await repo.create({ canonicalName: "Hypertension", categoryKey: "cardiac", status: "approved", addedBy: "Seed" });
    await repo.create({ canonicalName: "Asthma", categoryKey: "respiratory", status: "draft", addedBy: "Seed" });
    await repo.create({ canonicalName: "Chronic Kidney Disease", categoryKey: "kidney", status: "draft", addedBy: "Seed" });
    await repo.create({ canonicalName: "Diabetes Type 1", categoryKey: "diabetes", status: "deprecated", addedBy: "Seed" });
  };

  it("stamps a stable PED-###### code derived from the row id", async () => {
    const row = await repo.create({ canonicalName: "Migraine", addedBy: "Tester" });
    expect(row.pedCode).toMatch(/^PED-\d{6}$/);
  });

  it("paginates results and reports total/totalPages independent of page size", async () => {
    await seed();
    const page1 = await repo.listPaginated({ page: 1, pageSize: 2 });
    expect(page1.data).toHaveLength(2);
    expect(page1.total).toBe(5);
    expect(page1.totalPages).toBe(3);

    const page3 = await repo.listPaginated({ page: 3, pageSize: 2 });
    expect(page3.data).toHaveLength(1);
  });

  it("clamps an out-of-range page into bounds", async () => {
    await seed();
    const result = await repo.listPaginated({ page: 99, pageSize: 2 });
    expect(result.page).toBe(3);
    expect(result.data).toHaveLength(1);
  });

  it("defaults to alphabetical order by canonicalName", async () => {
    await seed();
    const result = await repo.listPaginated({ pageSize: 10 });
    expect(result.data.map(r => r.canonicalName)).toEqual([
      "Asthma",
      "Chronic Kidney Disease",
      "Diabetes Type 1",
      "Diabetes Type 2",
      "Hypertension",
    ]);
  });

  it("searches canonicalName and pedCode case-insensitively, across the full dataset not just one page", async () => {
    await seed();
    const bySearch = await repo.listPaginated({ search: "diabetes", pageSize: 1 });
    expect(bySearch.total).toBe(2);
  });

  it("filters by categoryKey and status", async () => {
    await seed();
    expect((await repo.listPaginated({ categoryKey: "diabetes" })).total).toBe(2);
    expect((await repo.listPaginated({ status: "draft" })).total).toBe(2);
    expect((await repo.listPaginated({ categoryKey: "diabetes", status: "deprecated" })).total).toBe(1);
  });

  it("sorts by any whitelisted column in either direction", async () => {
    await seed();
    const desc = await repo.listPaginated({ sortBy: "canonicalName", sortDir: "desc", pageSize: 10 });
    expect(desc.data[0].canonicalName).toBe("Hypertension");
  });

  it("falls back to the default sort column for an unrecognized sortBy", async () => {
    await seed();
    const result = await repo.listPaginated({ sortBy: "not_a_real_column", pageSize: 10 });
    expect(result.data[0].canonicalName).toBe("Asthma");
  });
});
