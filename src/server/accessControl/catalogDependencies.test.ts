/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * DB-integration tests for countCatalogDependencies()/blocksDeletion()/
 * needsConfirmation() — Access Control Center Phase 4
 * (docs/ACCESS_CONTROL_CENTER_PHASE_PLAN.md). Runs against a real (PGlite)
 * Postgres instance with every migration applied.
 */
import { describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../db/testUtils.js";
import { createRepositories } from "../db/repositories/index.js";
import { countCatalogDependencies, blocksDeletion, needsConfirmation, describeDependencies } from "./catalogDependencies.js";

// Deliberately NOT "Bliss"/"Advisory"/"Advisor" — migration 0038 already
// seeds those as convenience starting rows; distinct test-only names avoid
// colliding with each catalog's unique-name constraint.
async function seedOrg(db: TestDb) {
  const { orgTeams, departments, roles } = createRepositories(db);
  const team = await orgTeams.create({ name: "Test Team", description: null, createdBy: "test" });
  const dept = await departments.create({ name: "Test Department", description: null, createdBy: "test" });
  const role = await roles.create({ name: "Test Role", description: null, createdBy: "test" });
  return { team, dept, role };
}

describe("countCatalogDependencies", () => {
  it("zero dependencies -> deletable outright (no block, no confirmation needed)", async () => {
    const db = await createTestDb();
    const { team } = await seedOrg(db);
    const summary = await countCatalogDependencies(db, "orgTeam", team.id);
    expect(summary).toEqual({ users: 0, activeAccessRules: 0, inactiveAccessRules: 0, eligibilityGroups: 0 });
    expect(blocksDeletion(summary)).toBe(false);
    expect(needsConfirmation(summary)).toBe(false);
  });

  it("a user assigned to it -> needs confirmation, does not block", async () => {
    const db = await createTestDb();
    const { users } = createRepositories(db);
    const { dept } = await seedOrg(db);
    await users.create({ email: "advisor@example.com", name: "Advisor One", tactId: "T1", tier: "General", departmentId: dept.id });

    const summary = await countCatalogDependencies(db, "department", dept.id);
    expect(summary.users).toBe(1);
    expect(blocksDeletion(summary)).toBe(false);
    expect(needsConfirmation(summary)).toBe(true);
  });

  it("an ACTIVE access rule referencing it -> blocks deletion outright", async () => {
    const db = await createTestDb();
    const { accessRules } = createRepositories(db);
    const { role } = await seedOrg(db);
    await accessRules.create({
      resourceKey: "audit",
      name: "Blocking rule",
      orgTeamId: null,
      departmentId: null,
      roleId: role.id,
      productTag: null,
      grantedLevel: "Viewer",
      createdBy: "test",
    });

    const summary = await countCatalogDependencies(db, "role", role.id);
    expect(summary.activeAccessRules).toBe(1);
    expect(blocksDeletion(summary)).toBe(true);
  });

  it("only an INACTIVE access rule referencing it -> needs confirmation, does not block", async () => {
    const db = await createTestDb();
    const { accessRules } = createRepositories(db);
    const { role } = await seedOrg(db);
    const rule = await accessRules.create({
      resourceKey: "audit",
      name: "Disabled rule",
      orgTeamId: null,
      departmentId: null,
      roleId: role.id,
      productTag: null,
      grantedLevel: "Viewer",
      createdBy: "test",
    });
    await accessRules.update(rule.id, { active: false });

    const summary = await countCatalogDependencies(db, "role", role.id);
    expect(summary.activeAccessRules).toBe(0);
    expect(summary.inactiveAccessRules).toBe(1);
    expect(blocksDeletion(summary)).toBe(false);
    expect(needsConfirmation(summary)).toBe(true);
  });

  it("a Product Assist eligibility group referencing it -> blocks deletion outright", async () => {
    const db = await createTestDb();
    const { productAssistEligibilityGroups } = createRepositories(db);
    const { team, dept, role } = await seedOrg(db);
    await productAssistEligibilityGroups.create({
      name: "Test Group",
      orgTeamId: team.id,
      departmentId: dept.id,
      roleId: role.id,
      tag: null,
      dailyCredits: null,
      monthlyCredits: 100,
      createdBy: "test",
    });

    for (const [kind, id] of [
      ["orgTeam", team.id],
      ["department", dept.id],
      ["role", role.id],
    ] as const) {
      const summary = await countCatalogDependencies(db, kind, id);
      expect(summary.eligibilityGroups, kind).toBe(1);
      expect(blocksDeletion(summary), kind).toBe(true);
    }
  });

  it("a rule/user referencing a DIFFERENT id never counts against this one", async () => {
    const db = await createTestDb();
    const { users, accessRules } = createRepositories(db);
    const { dept } = await seedOrg(db);
    const otherDept = await createRepositories(db).departments.create({ name: "Other Department", description: null, createdBy: "test" });
    await users.create({ email: "advisor@example.com", name: "Advisor One", tactId: "T1", tier: "General", departmentId: otherDept.id });
    await accessRules.create({
      resourceKey: "audit",
      name: "Other dept rule",
      orgTeamId: null,
      departmentId: otherDept.id,
      roleId: null,
      productTag: null,
      grantedLevel: "Viewer",
      createdBy: "test",
    });

    const summary = await countCatalogDependencies(db, "department", dept.id);
    expect(summary).toEqual({ users: 0, activeAccessRules: 0, inactiveAccessRules: 0, eligibilityGroups: 0 });
  });

  it("describeDependencies produces a readable, non-empty summary whenever anything blocks or needs confirmation", async () => {
    const db = await createTestDb();
    const { users, accessRules } = createRepositories(db);
    const { team } = await seedOrg(db);
    await users.create({ email: "advisor@example.com", name: "Advisor One", tactId: "T1", tier: "General", orgTeamId: team.id });
    await accessRules.create({
      resourceKey: "audit",
      name: "Rule",
      orgTeamId: team.id,
      departmentId: null,
      roleId: null,
      productTag: null,
      grantedLevel: "Viewer",
      createdBy: "test",
    });

    const summary = await countCatalogDependencies(db, "orgTeam", team.id);
    const description = describeDependencies(summary);
    expect(description).toContain("1 user is currently assigned to it");
    expect(description).toContain("1 active Access Rule references it");
  });
});
