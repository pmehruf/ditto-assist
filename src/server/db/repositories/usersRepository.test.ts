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
    tier: "Developer" as const,
    status: "Active" as const,
  };

  it("creates a user, normalizing email to lowercase", async () => {
    const created = await repo.create(baseEntry);
    expect(created.email).toBe("alice@joinditto.in");
    expect(created.tier).toBe("Developer");
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
    // a Developer only changed Bob's tier — Alice's row is round-tripped
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
      { email: baseEntry.email.toLowerCase(), name: "Alice", tactId: "TACT-101", tier: "Developer", status: "Active" },
      { email: "dave@joinditto.in", name: "Dave", tactId: "TACT-301", tier: "General", status: "Active" },
    ]);
    const dave = replaced.find((r) => r.email === "dave@joinditto.in");
    expect(dave?.createdAt.getTime()).toBeGreaterThanOrEqual(before);
  });

  // ── Pagination + single-row update/delete (added alongside server-side
  // pagination for the User Management admin table — see updateUser's and
  // deleteUser's doc comments for why the full-array replaceAll above is no
  // longer used by that UI for editing/removing an existing row). ──────────

  const seedFour = async () => {
    await repo.create({ email: "mehruf.p@joinditto.in", name: "Mehruf P", tactId: "TACT-101", tier: "Developer", status: "Active" });
    await repo.create({ email: "rebecca.s@joinditto.in", name: "Rebecca S", tactId: "TACT-102", tier: "Admin", status: "Active" });
    await repo.create({ email: "shashank@joinditto.in", name: "Shashank J", tactId: "TACT-103", tier: "General", status: "Active" });
    await repo.create({ email: "disabled.user@joinditto.in", name: "Disabled User", tactId: "TACT-104", tier: "General", status: "Disabled" });
  };

  it("paginates and reports an accurate total independent of page size", async () => {
    await seedFour();
    const page1 = await repo.listPaginated({ page: 1, pageSize: 2 });
    expect(page1.data).toHaveLength(2);
    expect(page1.total).toBe(4);
    expect(page1.totalPages).toBe(2);
  });

  it("clamps an out-of-range page into bounds", async () => {
    await seedFour();
    const result = await repo.listPaginated({ page: 99, pageSize: 2 });
    expect(result.page).toBe(2);
    expect(result.data).toHaveLength(2);
  });

  it("filters by tier and status", async () => {
    await seedFour();
    expect((await repo.listPaginated({ tier: "General" })).total).toBe(2);
    expect((await repo.listPaginated({ status: "Disabled" })).total).toBe(1);
    expect((await repo.listPaginated({ tier: "General", status: "Disabled" })).total).toBe(1);
  });

  it("searches name, email, and tactId case-insensitively", async () => {
    await seedFour();
    expect((await repo.listPaginated({ search: "rebecca" })).total).toBe(1);
    expect((await repo.listPaginated({ search: "joinditto.in" })).total).toBe(4);
    expect((await repo.listPaginated({ search: "TACT-103" })).total).toBe(1);
  });

  it("sorts by any whitelisted column in either direction", async () => {
    await seedFour();
    const asc = await repo.listPaginated({ sortBy: "name", sortDir: "asc", pageSize: 10 });
    expect(asc.data[0].name).toBe("Disabled User");
    const desc = await repo.listPaginated({ sortBy: "name", sortDir: "desc", pageSize: 10 });
    expect(desc.data[0].name).toBe("Shashank J");
  });

  it("falls back to the default sort column (createdAt) for an unrecognized sortBy", async () => {
    await seedFour();
    const result = await repo.listPaginated({ sortBy: "not_a_real_column", pageSize: 10 });
    expect(result.data).toHaveLength(4);
  });

  it("listMatching returns every matching row unpaginated, for export/parity", async () => {
    await seedFour();
    const rows = await repo.listMatching({ tier: "General" });
    expect(rows).toHaveLength(2);
  });

  it("updateUser patches only the targeted row, leaving the email/primary key intact", async () => {
    await seedFour();
    const updated = await repo.updateUser("shashank@joinditto.in", { name: "Shashank Jain", tactId: "TACT-103", tier: "Admin", status: "Active" });
    expect(updated?.name).toBe("Shashank Jain");
    expect(updated?.tier).toBe("Admin");
    expect(updated?.email).toBe("shashank@joinditto.in");

    const untouched = await repo.findByEmail("rebecca.s@joinditto.in");
    expect(untouched?.name).toBe("Rebecca S");
  });

  it("deleteUser removes only the targeted row", async () => {
    await seedFour();
    await repo.deleteUser("disabled.user@joinditto.in");
    const all = await repo.list();
    expect(all).toHaveLength(3);
    expect(all.some(u => u.email === "disabled.user@joinditto.in")).toBe(false);
  });

  it("countOtherDevelopers excludes the given email and counts only Developer tier", async () => {
    await seedFour();
    // Only one Developer (mehruf.p) exists — excluding anyone else should
    // still count that one Developer.
    expect(await repo.countOtherDevelopers("shashank@joinditto.in")).toBe(1);
    // Excluding the Developer themself should count zero remaining.
    expect(await repo.countOtherDevelopers("mehruf.p@joinditto.in")).toBe(0);
  });
});
