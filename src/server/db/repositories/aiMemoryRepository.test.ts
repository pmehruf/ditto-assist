/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../testUtils.js";
import { AiMemoryRepository, normalizeCondition } from "./aiMemoryRepository.js";

describe("AiMemoryRepository", () => {
  let db: TestDb;
  let repo: AiMemoryRepository;

  beforeEach(async () => {
    db = await createTestDb();
    repo = new AiMemoryRepository(db);
  });

  afterEach(async () => {
    await db.$client.close();
  });

  const seedEntry = (overrides: Partial<Parameters<AiMemoryRepository["recordPending"]>[0]> = {}) => ({
    condition: overrides.condition ?? "Diabetes",
    normalizedCondition: normalizeCondition(overrides.condition ?? "Diabetes"),
    planName: overrides.planName ?? "Care Supreme",
    engineVersion: "v1",
    promptVersion: "p1",
    geminiModel: "gemini-2.0",
    aiResponse: overrides.aiResponse ?? { result: { match_type: "P1", matched_question: "Any diabetes?" } },
    status: overrides.status ?? "pending",
  });

  const seed = async () => {
    // Each row gets its OWN matched_question (rather than relying on
    // seedEntry's shared "Any diabetes?" default) — three rows silently
    // sharing that default previously made the "search matches exactly 1
    // row" and "sorts by matched_question" tests below assert on data that
    // wasn't actually true.
    await repo.recordPending(seedEntry({ condition: "Diabetes Type 2", planName: "Care Supreme", status: "pending", aiResponse: { result: { match_type: "P1", matched_question: "Any diabetes symptoms?" } } }));
    await repo.recordPending(seedEntry({ condition: "Hypertension", planName: "Optima Secure", status: "approved", aiResponse: { result: { match_type: "P1", matched_question: "Any heart condition?" } } }));
    await repo.recordPending(seedEntry({ condition: "Asthma", planName: "Care Supreme", status: "rejected", aiResponse: { result: { match_type: "P1", matched_question: "Any breathing issues?" } } }));
    await repo.recordPending(seedEntry({ condition: "Migraine", planName: "Activ One Max", status: "pending", aiResponse: { result: { match_type: "P1", matched_question: "Any recurring headaches?" } } }));
  };

  it("normalizeCondition trims, lowercases, and collapses whitespace", () => {
    expect(normalizeCondition("  Diabetes   Type  2 ")).toBe("diabetes type 2");
  });

  it("paginates and reports an accurate total independent of page size", async () => {
    await seed();
    const page1 = await repo.listPaginated({ page: 1, pageSize: 2 });
    expect(page1.data).toHaveLength(2);
    expect(page1.total).toBe(4);
    expect(page1.totalPages).toBe(2);
  });

  it("filters by status and planName", async () => {
    await seed();
    expect((await repo.listPaginated({ status: "pending" })).total).toBe(2);
    expect((await repo.listPaginated({ planName: "Care Supreme" })).total).toBe(2);
    expect((await repo.listPaginated({ status: "pending", planName: "Care Supreme" })).total).toBe(1);
  });

  it("searches condition, planName, and the nested matched_question, case-insensitively", async () => {
    await seed();
    expect((await repo.listPaginated({ search: "diabetes" })).total).toBe(1);
    expect((await repo.listPaginated({ search: "optima" })).total).toBe(1);
    expect((await repo.listPaginated({ search: "heart condition" })).total).toBe(1);
  });

  it("defaults to newest-first order", async () => {
    await seed();
    const result = await repo.listPaginated({ pageSize: 10 });
    expect(result.data[0].condition).toBe("Migraine");
    expect(result.data[result.data.length - 1].condition).toBe("Diabetes Type 2");
  });

  it("sorts by the nested matched_question field", async () => {
    await seed();
    const result = await repo.listPaginated({ sortBy: "matched_question", sortDir: "asc", pageSize: 10 });
    // Alphabetical by matched_question: "Any breathing issues?" < "Any
    // diabetes symptoms?" < "Any heart condition?" < "Any recurring headaches?"
    expect(result.data.map(r => r.condition)).toEqual(["Asthma", "Diabetes Type 2", "Hypertension", "Migraine"]);
  });

  it("listMatching returns every matching row unpaginated, for CSV export", async () => {
    await seed();
    const rows = await repo.listMatching({ planName: "Care Supreme" });
    expect(rows).toHaveLength(2);
  });
});
