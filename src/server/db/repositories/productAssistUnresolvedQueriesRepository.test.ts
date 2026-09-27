/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../testUtils.js";
import { ProductAssistUnresolvedQueriesRepository } from "./productAssistUnresolvedQueriesRepository.js";
import { SpecialInstructionsRepository } from "./specialInstructionsRepository.js";

/** A real special_instructions row to satisfy resolvedSpecialInstructionId's
 * FK — the migration correctly enforces this constraint (confirmed by this
 * test file initially failing with a real FK violation before this helper
 * was added), so tests exercising "resolved, linked to an instruction" must
 * create a genuine referenced row rather than an arbitrary id. */
async function createTestInstruction(db: TestDb, topic = "Test Topic") {
  const repo = new SpecialInstructionsRepository(db);
  return repo.create({
    topic,
    instructionText: "Some instruction text.",
    instructionType: "override_rule",
    insurerCategoryId: null,
    productPlanName: null,
    domain: "Health",
    topicEmbedding: new Array(768).fill(0),
    isActive: true,
    createdBy: "test@example.com",
    updatedBy: "test@example.com",
  });
}

describe("ProductAssistUnresolvedQueriesRepository", () => {
  let db: TestDb;
  let repo: ProductAssistUnresolvedQueriesRepository;

  beforeEach(async () => {
    db = await createTestDb();
    repo = new ProductAssistUnresolvedQueriesRepository(db);
  });

  afterEach(async () => {
    await db.$client.close();
  });

  const baseEntry = {
    domain: "Health" as const,
    userEmail: "advisor@example.com",
    categoryId: null,
    categoryName: null,
    planTags: [],
    question: "Does this plan cover bariatric surgery?",
  };

  it("create() defaults a new row to status=unresolved with no resolution fields set", async () => {
    await repo.create(baseEntry);
    const [row] = await repo.list();
    expect(row.status).toBe("unresolved");
    expect(row.resolvedSpecialInstructionId).toBeNull();
    expect(row.resolvedBy).toBeNull();
    expect(row.resolvedAt).toBeNull();
    expect(row.question).toBe(baseEntry.question);
  });

  it("list() returns newest first", async () => {
    await repo.create({ ...baseEntry, question: "first" });
    await repo.create({ ...baseEntry, question: "second" });
    await repo.create({ ...baseEntry, question: "third" });
    const rows = await repo.list();
    expect(rows.map(r => r.question)).toEqual(["third", "second", "first"]);
  });

  it("list() filters by domain", async () => {
    await repo.create({ ...baseEntry, domain: "Health", question: "health q" });
    await repo.create({ ...baseEntry, domain: "Term", question: "term q" });
    const healthRows = await repo.list({ domain: "Health" });
    expect(healthRows).toHaveLength(1);
    expect(healthRows[0].question).toBe("health q");
    const termRows = await repo.list({ domain: "Term" });
    expect(termRows).toHaveLength(1);
    expect(termRows[0].question).toBe("term q");
  });

  it("list() filters by status", async () => {
    await repo.create({ ...baseEntry, question: "still open" });
    await repo.create({ ...baseEntry, question: "to be skipped" });
    const all = await repo.list();
    const toSkip = all.find(r => r.question === "to be skipped")!;
    await repo.updateStatus(toSkip.id, { status: "skipped", resolvedBy: "admin@example.com" });

    const unresolved = await repo.list({ status: "unresolved" });
    expect(unresolved.map(r => r.question)).toEqual(["still open"]);
    const skipped = await repo.list({ status: "skipped" });
    expect(skipped.map(r => r.question)).toEqual(["to be skipped"]);
  });

  it("list() filters by createdAt from/to range", async () => {
    await repo.create(baseEntry);
    const all = await repo.list();
    const createdAt = all[0].createdAt;

    const before = new Date(createdAt.getTime() - 60_000);
    const after = new Date(createdAt.getTime() + 60_000);

    expect(await repo.list({ from: before, to: after })).toHaveLength(1);
    expect(await repo.list({ from: after })).toHaveLength(0);
    expect(await repo.list({ to: before })).toHaveLength(0);
  });

  it("updateStatus(resolved) stamps resolvedBy/resolvedAt and stores the linked instruction id", async () => {
    const instruction = await createTestInstruction(db);
    await repo.create(baseEntry);
    const [row] = await repo.list();
    const updated = await repo.updateStatus(row.id, {
      status: "resolved",
      resolvedBy: "dev@example.com",
      resolvedSpecialInstructionId: instruction.id,
    });
    expect(updated!.status).toBe("resolved");
    expect(updated!.resolvedBy).toBe("dev@example.com");
    expect(updated!.resolvedSpecialInstructionId).toBe(instruction.id);
    expect(updated!.resolvedAt).toBeInstanceOf(Date);
  });

  it("updateStatus(skipped) never stores a resolvedSpecialInstructionId, even if one is passed", async () => {
    const instruction = await createTestInstruction(db);
    await repo.create(baseEntry);
    const [row] = await repo.list();
    const updated = await repo.updateStatus(row.id, {
      status: "skipped",
      resolvedBy: "dev@example.com",
      resolvedSpecialInstructionId: instruction.id,
    });
    expect(updated!.status).toBe("skipped");
    expect(updated!.resolvedSpecialInstructionId).toBeNull();
    expect(updated!.resolvedAt).toBeInstanceOf(Date);
  });

  it("updateStatus(unresolved) — reopening — clears every resolution field", async () => {
    const instruction = await createTestInstruction(db);
    await repo.create(baseEntry);
    const [row] = await repo.list();
    await repo.updateStatus(row.id, { status: "resolved", resolvedBy: "dev@example.com", resolvedSpecialInstructionId: instruction.id });
    const reopened = await repo.updateStatus(row.id, { status: "unresolved" });
    expect(reopened!.status).toBe("unresolved");
    expect(reopened!.resolvedBy).toBeNull();
    expect(reopened!.resolvedSpecialInstructionId).toBeNull();
    expect(reopened!.resolvedAt).toBeNull();
  });

  it("updateStatus() on a nonexistent id returns undefined", async () => {
    expect(await repo.updateStatus(999999, { status: "skipped" })).toBeUndefined();
  });

  it("listAll() returns every row regardless of status, newest first", async () => {
    await repo.create({ ...baseEntry, question: "a" });
    await repo.create({ ...baseEntry, question: "b" });
    const [rowB] = await repo.list();
    await repo.updateStatus(rowB.id, { status: "resolved", resolvedBy: "dev@example.com" });
    const all = await repo.listAll();
    expect(all).toHaveLength(2);
    expect(all[0].question).toBe("b");
  });
});
