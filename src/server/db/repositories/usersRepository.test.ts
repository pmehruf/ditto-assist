/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../testUtils.js";
import { UsersRepository } from "./usersRepository.js";

describe("UsersRepository", () => {
  let db: TestDb;
  let repo: UsersRepository;

  beforeEach(async () => {
    db = await createTestDb();
    repo = new UsersRepository(db);
  });

  afterEach(async () => {
    await db.$client.close();
  });

  const baseEntry = {
    email: "Alice@JoinDitto.in",
    name: "Alice",
    tactId: "TACT-101",
    tier: "Owner" as const,
    status: "Active" as const,
  };

  it("creates a user, normalizing email to lowercase", async () => {
    const created = await repo.create(baseEntry);
    expect(created.email).toBe("alice@joinditto.in");
    expect(created.tier).toBe("Owner");
    expect(created.status).toBe("Active");
  });

  it("findByEmail is case-insensitive", async () => {
    await repo.create(baseEntry);
    expect(await repo.findByEmail("ALICE@joinditto.in")).toBeDefined();
    expect(await repo.findByEmail("bob@joinditto.in")).toBeUndefined();
  });

  it("list returns every directory row", async () => {
    await repo.create(baseEntry);
    await repo.create({ ...baseEntry, email: "bob@joinditto.in", name: "Bob", tier: "General", status: "Disabled" });
    const rows = await repo.list();
    expect(rows).toHaveLength(2);
  });

  it("replaceAll wholesale-replaces the directory", async () => {
    await repo.create(baseEntry);
    const replaced = await repo.replaceAll([
      { email: "carol@joinditto.in", name: "Carol", tactId: "TACT-201", tier: "Admin", status: "Active" },
    ]);
    expect(replaced).toHaveLength(1);
    const rows = await repo.list();
    expect(rows).toHaveLength(1);
    expect(rows[0].email).toBe("carol@joinditto.in");
    expect(await repo.findByEmail("alice@joinditto.in")).toBeUndefined();
  });

  it("replaceAll can empty the directory", async () => {
    await repo.create(baseEntry);
    await repo.replaceAll([]);
    expect(await repo.list()).toHaveLength(0);
  });

  it("replaceAll preserves createdAt for users who already existed (regression: editing one user's tier used to reset everyone's join date)", async () => {
    const alice = await repo.create(baseEntry);
    const bob = await repo.create({ ...baseEntry, email: "bob@joinditto.in", name: "Bob", tier: "General", status: "Active" });

    // Simulate the User Management screen saving the whole directory after
    // an Owner only changed Bob's tier — Alice's row is round-tripped
    // unchanged, exactly like the client does.
    await new Promise((resolve) => setTimeout(resolve, 5));
    await repo.replaceAll([
      { email: alice.email, name: alice.name, tactId: alice.tactId, tier: alice.tier, status: alice.status },
      { email: bob.email, name: bob.name, tactId: bob.tactId, tier: "Admin", status: bob.status },
    ]);

    const rows = await repo.list();
    const aliceAfter = rows.find((r) => r.email === alice.email);
    const bobAfter = rows.find((r) => r.email === bob.email);
    expect(aliceAfter?.createdAt.getTime()).toBe(alice.createdAt.getTime());
    expect(bobAfter?.createdAt.getTime()).toBe(bob.createdAt.getTime());
    expect(bobAfter?.tier).toBe("Admin");
  });

  it("replaceAll still defaults createdAt to now for a genuinely new user", async () => {
    await repo.create(baseEntry);
    const before = Date.now();
    const replaced = await repo.replaceAll([
      { email: baseEntry.email.toLowerCase(), name: "Alice", tactId: "TACT-101", tier: "Owner", status: "Active" },
      { email: "dave@joinditto.in", name: "Dave", tactId: "TACT-301", tier: "General", status: "Active" },
    ]);
    const dave = replaced.find((r) => r.email === "dave@joinditto.in");
    expect(dave?.createdAt.getTime()).toBeGreaterThanOrEqual(before);
  });
});
