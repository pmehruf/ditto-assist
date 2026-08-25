/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Regression tests for the Advisor Directory Sync (2026-08) — against a real
 * (PGlite) Postgres instance, exactly like productAssistQuota.test.ts, so
 * the Department/Team/Role catalog seeds (migrations 0038/0049) and the
 * users table's real constraints are exercised for real. Only the Google
 * Sheets read (getMasterAdvisorsRowsForSync) is mocked — everything else
 * (matching, assignment, idempotency, revert-on-departure) runs against
 * real repositories.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDb, type TestDb } from "../db/testUtils.js";
import { createRepositories, type Repositories } from "../db/repositories/index.js";
import { resolveQuotaBucket } from "../knowledgeBase/productAssistQuota.js";
import type { MasterAdvisorsRow } from "./qaDataEngine.js";

const getMasterAdvisorsRowsForSyncMock = vi.fn<() => Promise<{ totalRows: number; rows: MasterAdvisorsRow[] }>>();

vi.mock("./qaDataEngine.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./qaDataEngine.js")>();
  return { ...actual, getMasterAdvisorsRowsForSync: getMasterAdvisorsRowsForSyncMock };
});

// Imported AFTER the mock is registered, per vitest's hoisting contract.
const { syncAdvisorDirectory } = await import("./advisorDirectorySync.js");

function sheetRow(overrides: Partial<MasterAdvisorsRow> = {}): MasterAdvisorsRow {
  return {
    tactId: "TACT1001",
    name: "Priya Sharma",
    guide: null,
    mentor: null,
    skillDomain: "Health",
    email: "priya@joinditto.in",
    statusRaw: "Currently Employed",
    ...overrides,
  };
}

function mockSheet(rows: MasterAdvisorsRow[]): void {
  getMasterAdvisorsRowsForSyncMock.mockResolvedValue({ totalRows: rows.length, rows });
}

describe("syncAdvisorDirectory", () => {
  let db: TestDb;
  let repos: Repositories;
  let advisoryId: number;
  let blissId: number;
  let advisorId: number;

  beforeEach(async () => {
    db = await createTestDb();
    repos = createRepositories(db);
    getMasterAdvisorsRowsForSyncMock.mockReset();

    const [departments, orgTeams, roles] = await Promise.all([repos.departments.list(), repos.orgTeams.list(), repos.roles.list()]);
    advisoryId = departments.find((d) => d.name === "Advisory")!.id;
    blissId = orgTeams.find((t) => t.name === "Bliss")!.id;
    advisorId = roles.find((r) => r.name === "Advisor")!.id;
  });

  afterEach(async () => {
    await db.$client.close();
  });

  it("Health -> tags = [Health], Department/Team/Role = Advisory/Bliss/Advisor", async () => {
    await repos.users.create({ email: "priya@joinditto.in", name: "Priya Sharma", tactId: "TACT1001", tier: "General", status: "Active" });
    mockSheet([sheetRow({ skillDomain: "Health" })]);

    const result = await syncAdvisorDirectory(repos, "tester (Developer)");
    expect(result.errors).toEqual([]);
    expect(result.usersUpdated).toBe(1);
    expect(result.usersMatched).toBe(1);

    const user = await repos.users.findByEmail("priya@joinditto.in");
    expect(user?.tags).toEqual(["Health"]);
    expect(user?.departmentId).toBe(advisoryId);
    expect(user?.orgTeamId).toBe(blissId);
    expect(user?.roleId).toBe(advisorId);
  });

  it("Term -> tags = [Term]", async () => {
    await repos.users.create({ email: "priya@joinditto.in", name: "Priya Sharma", tactId: "TACT1001", tier: "General", status: "Active" });
    mockSheet([sheetRow({ skillDomain: "Term" })]);

    await syncAdvisorDirectory(repos, "tester (Developer)");
    const user = await repos.users.findByEmail("priya@joinditto.in");
    expect(user?.tags).toEqual(["Term"]);
  });

  it("Both -> tags = [Health, Term]", async () => {
    await repos.users.create({ email: "priya@joinditto.in", name: "Priya Sharma", tactId: "TACT1001", tier: "General", status: "Active" });
    mockSheet([sheetRow({ skillDomain: "Both" })]);

    await syncAdvisorDirectory(repos, "tester (Developer)");
    const user = await repos.users.findByEmail("priya@joinditto.in");
    expect(user?.tags).toEqual(expect.arrayContaining(["Health", "Term"]));
    expect(user?.tags).toHaveLength(2);
  });

  it("Not Currently Employed -> matched user is left untouched (never synced in the first place)", async () => {
    await repos.users.create({ email: "priya@joinditto.in", name: "Priya Sharma", tactId: "TACT1001", tier: "General", status: "Active" });
    mockSheet([sheetRow({ statusRaw: "Resigned" })]);

    const result = await syncAdvisorDirectory(repos, "tester (Developer)");
    expect(result.currentlyEmployedRecords).toBe(0);
    expect(result.usersMatched).toBe(0);
    expect(result.usersUpdated).toBe(0);

    const user = await repos.users.findByEmail("priya@joinditto.in");
    expect(user?.departmentId).toBeNull();
    expect(user?.tags).toEqual([]);
  });

  it("existing user matched by email gets updated in place, no duplicate created", async () => {
    await repos.users.create({ email: "priya@joinditto.in", name: "Priya Sharma", tactId: "TACT1001", tier: "General", status: "Active" });
    mockSheet([sheetRow()]);
    await syncAdvisorDirectory(repos, "tester (Developer)");

    const allUsers = await repos.users.list();
    expect(allUsers).toHaveLength(1);
  });

  it("missing user (Currently Employed row with no directory match) is reported skipped, never created", async () => {
    mockSheet([sheetRow({ email: "nobody-in-directory@joinditto.in", tactId: "TACT9999" })]);

    const result = await syncAdvisorDirectory(repos, "tester (Developer)");
    expect(result.usersSkippedNotFound).toBe(1);
    expect(result.usersMatched).toBe(0);
    expect(await repos.users.list()).toHaveLength(0);
  });

  it("repeated sync with unchanged sheet data is idempotent — second run reports unchanged, not updated", async () => {
    await repos.users.create({ email: "priya@joinditto.in", name: "Priya Sharma", tactId: "TACT1001", tier: "General", status: "Active" });
    mockSheet([sheetRow()]);

    const first = await syncAdvisorDirectory(repos, "tester (Developer)");
    expect(first.usersUpdated).toBe(1);
    expect(first.usersUnchanged).toBe(0);

    const second = await syncAdvisorDirectory(repos, "tester (Developer)");
    expect(second.usersUpdated).toBe(0);
    expect(second.usersUnchanged).toBe(1);
  });

  it("Product change (Health -> Term) on a re-sync updates the tag, replacing the old one", async () => {
    await repos.users.create({ email: "priya@joinditto.in", name: "Priya Sharma", tactId: "TACT1001", tier: "General", status: "Active" });
    mockSheet([sheetRow({ skillDomain: "Health" })]);
    await syncAdvisorDirectory(repos, "tester (Developer)");
    expect((await repos.users.findByEmail("priya@joinditto.in"))?.tags).toEqual(["Health"]);

    mockSheet([sheetRow({ skillDomain: "Term" })]);
    const result = await syncAdvisorDirectory(repos, "tester (Developer)");
    expect(result.usersUpdated).toBe(1);
    expect((await repos.users.findByEmail("priya@joinditto.in"))?.tags).toEqual(["Term"]);
  });

  it("a user who leaves Currently Employed has this sync's own assignment reverted, but is not deleted", async () => {
    await repos.users.create({ email: "priya@joinditto.in", name: "Priya Sharma", tactId: "TACT1001", tier: "General", status: "Active" });
    mockSheet([sheetRow({ statusRaw: "Currently Employed" })]);
    await syncAdvisorDirectory(repos, "tester (Developer)");
    expect((await repos.users.findByEmail("priya@joinditto.in"))?.departmentId).toBe(advisoryId);

    mockSheet([sheetRow({ statusRaw: "Resigned" })]);
    const result = await syncAdvisorDirectory(repos, "tester (Developer)");
    expect(result.usersReverted).toBe(1);

    const user = await repos.users.findByEmail("priya@joinditto.in");
    expect(user).toBeDefined(); // still exists — never deleted
    expect(user?.departmentId).toBeNull();
    expect(user?.orgTeamId).toBeNull();
    expect(user?.roleId).toBeNull();
    expect(user?.tags).toEqual([]);
  });

  it("a user who disappears from the sheet ENTIRELY (not just a status flip) is also reverted, never deleted", async () => {
    await repos.users.create({ email: "priya@joinditto.in", name: "Priya Sharma", tactId: "TACT1001", tier: "General", status: "Active" });
    mockSheet([sheetRow()]);
    await syncAdvisorDirectory(repos, "tester (Developer)");

    mockSheet([]); // row removed from the sheet entirely
    const result = await syncAdvisorDirectory(repos, "tester (Developer)");
    expect(result.usersReverted).toBe(1);
    expect(await repos.users.list()).toHaveLength(1); // still there
  });

  it("does NOT overwrite a manually-changed field on revert — only reverts what this sync still owns", async () => {
    const otherDept = await repos.departments.create({ name: "Manual Dept", description: null, createdBy: "tester" });
    await repos.users.create({ email: "priya@joinditto.in", name: "Priya Sharma", tactId: "TACT1001", tier: "General", status: "Active" });
    mockSheet([sheetRow()]);
    await syncAdvisorDirectory(repos, "tester (Developer)");

    // Simulate an admin manually reassigning the department after the sync ran.
    await repos.users.updateUser("priya@joinditto.in", { departmentId: otherDept.id });

    mockSheet([sheetRow({ statusRaw: "Resigned" })]);
    await syncAdvisorDirectory(repos, "tester (Developer)");

    const user = await repos.users.findByEmail("priya@joinditto.in");
    // departmentId was manually changed since the sync last touched it, so
    // the revert must leave it alone rather than forcing it back to null.
    expect(user?.departmentId).toBe(otherDept.id);
    // orgTeamId/roleId were never manually touched, so those DO revert.
    expect(user?.orgTeamId).toBeNull();
    expect(user?.roleId).toBeNull();
  });

  it("rehire: a reverted user who becomes Currently Employed again is re-synced correctly", async () => {
    await repos.users.create({ email: "priya@joinditto.in", name: "Priya Sharma", tactId: "TACT1001", tier: "General", status: "Active" });
    mockSheet([sheetRow({ skillDomain: "Health" })]);
    await syncAdvisorDirectory(repos, "tester (Developer)");

    mockSheet([sheetRow({ statusRaw: "Resigned" })]);
    await syncAdvisorDirectory(repos, "tester (Developer)");
    expect((await repos.users.findByEmail("priya@joinditto.in"))?.departmentId).toBeNull();

    mockSheet([sheetRow({ statusRaw: "Currently Employed", skillDomain: "Term" })]);
    const result = await syncAdvisorDirectory(repos, "tester (Developer)");
    expect(result.usersUpdated).toBe(1);
    const user = await repos.users.findByEmail("priya@joinditto.in");
    expect(user?.departmentId).toBe(advisoryId);
    expect(user?.tags).toEqual(["Term"]);
  });

  it("falls back to TACT ID matching when the sheet email doesn't match any directory user", async () => {
    await repos.users.create({ email: "different-login-email@joinditto.in", name: "Priya Sharma", tactId: "TACT1001", tier: "General", status: "Active" });
    mockSheet([sheetRow({ email: "priya-sheet-email@joinditto.in", tactId: "TACT1001" })]);

    const result = await syncAdvisorDirectory(repos, "tester (Developer)");
    expect(result.usersMatched).toBe(1);
    const user = await repos.users.findByEmail("different-login-email@joinditto.in");
    expect(user?.departmentId).toBe(advisoryId);
  });

  it("blank/unrecognized Product value applies Department/Team/Role but leaves tags untouched", async () => {
    await repos.users.create({ email: "priya@joinditto.in", name: "Priya Sharma", tactId: "TACT1001", tier: "General", status: "Active", tags: ["Health"] });
    mockSheet([sheetRow({ skillDomain: "Something Else Entirely" })]);

    const result = await syncAdvisorDirectory(repos, "tester (Developer)");
    expect(result.unrecognizedProductRecords).toBe(1);
    const user = await repos.users.findByEmail("priya@joinditto.in");
    expect(user?.departmentId).toBe(advisoryId);
    expect(user?.tags).toEqual(["Health"]); // untouched, not cleared
  });

  it("reports an actionable error and writes nothing when the Advisory department is missing", async () => {
    const advisory = (await repos.departments.list()).find((d) => d.name === "Advisory")!;
    await repos.departments.update(advisory.id, { name: "Renamed Away" });
    await repos.users.create({ email: "priya@joinditto.in", name: "Priya Sharma", tactId: "TACT1001", tier: "General", status: "Active" });
    mockSheet([sheetRow()]);

    const result = await syncAdvisorDirectory(repos, "tester (Developer)");
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toMatch(/Advisory/);
    const user = await repos.users.findByEmail("priya@joinditto.in");
    expect(user?.departmentId).toBeNull();
  });

  it("a synced Health-tagged Advisory+Bliss+Advisor user is recognized by the Product Assist eligibility evaluator", async () => {
    await repos.users.create({ email: "priya@joinditto.in", name: "Priya Sharma", tactId: "TACT1001", tier: "General", status: "Active" });
    mockSheet([sheetRow({ skillDomain: "Health" })]);
    await syncAdvisorDirectory(repos, "tester (Developer)");

    const user = await repos.users.findByEmail("priya@joinditto.in");
    const bucket = resolveQuotaBucket(
      { tier: user!.tier, tags: user!.tags, departmentId: user!.departmentId, orgTeamId: user!.orgTeamId, roleId: user!.roleId },
      { eligibleDepartmentId: advisoryId, eligibleOrgTeamId: blissId, eligibleRoleId: advisorId }
    );
    expect(bucket).toBe("health_advisor");
  });

  it("a synced Term-only advisor is NOT recognized as health_advisor (no Health tag)", async () => {
    await repos.users.create({ email: "priya@joinditto.in", name: "Priya Sharma", tactId: "TACT1001", tier: "General", status: "Active" });
    mockSheet([sheetRow({ skillDomain: "Term" })]);
    await syncAdvisorDirectory(repos, "tester (Developer)");

    const user = await repos.users.findByEmail("priya@joinditto.in");
    const bucket = resolveQuotaBucket(
      { tier: user!.tier, tags: user!.tags, departmentId: user!.departmentId, orgTeamId: user!.orgTeamId, roleId: user!.roleId },
      { eligibleDepartmentId: advisoryId, eligibleOrgTeamId: blissId, eligibleRoleId: advisorId }
    );
    expect(bucket).toBe("trial");
  });
});
