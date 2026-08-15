/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../testUtils.js";
import { ProductAssistAcksRepository } from "./productAssistAcksRepository.js";

describe("ProductAssistAcksRepository", () => {
  let db: TestDb;
  let repo: ProductAssistAcksRepository;

  beforeEach(async () => {
    db = await createTestDb();
    repo = new ProductAssistAcksRepository(db);
  });

  afterEach(async () => {
    await db.$client.close();
  });

  it("returns undefined for a user with no row yet", async () => {
    expect(await repo.get("nobody@example.com")).toBeUndefined();
  });

  it("acknowledge() sets both ackedAt and lastReminderDate to the given local date", async () => {
    await repo.acknowledge("Advisor@Example.com", "2026-08-15");
    const row = await repo.get("advisor@example.com");
    expect(row).toBeDefined();
    expect(row!.ackedAt).toBeInstanceOf(Date);
    expect(row!.lastReminderDate).toBe("2026-08-15");
  });

  it("recordReminderShown() sets lastReminderDate without touching ackedAt", async () => {
    await repo.recordReminderShown("advisor@example.com", "2026-08-15");
    let row = await repo.get("advisor@example.com");
    expect(row!.lastReminderDate).toBe("2026-08-15");
    expect(row!.ackedAt).toBeNull();

    // A later day's reminder just updates the date, still no ackedAt.
    await repo.recordReminderShown("advisor@example.com", "2026-08-16");
    row = await repo.get("advisor@example.com");
    expect(row!.lastReminderDate).toBe("2026-08-16");
    expect(row!.ackedAt).toBeNull();
  });

  it("acknowledge() is idempotent — a repeat call just re-stamps both fields", async () => {
    await repo.acknowledge("advisor@example.com", "2026-08-15");
    await repo.acknowledge("advisor@example.com", "2026-08-16");
    const row = await repo.get("advisor@example.com");
    expect(row!.lastReminderDate).toBe("2026-08-16");
  });

  it("is keyed case-insensitively by email, same as the users directory", async () => {
    await repo.acknowledge("Mixed.Case@Example.com", "2026-08-15");
    expect(await repo.get("mixed.case@example.com")).toBeDefined();
  });
});
