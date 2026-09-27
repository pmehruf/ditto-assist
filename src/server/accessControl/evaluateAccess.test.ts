/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * DB-integration tests for evaluateAccess() — Access Control Center Phase 1
 * (docs/ACCESS_CONTROL_CENTER_PHASE_PLAN.md). Runs against a real (PGlite)
 * Postgres instance with every migration applied (including 0060's new
 * access_rules table), so this also exercises that migration file for real.
 *
 * The pure decision logic itself is covered exhaustively in
 * accessRuleEvaluator.test.ts (no DB needed there); this file only proves
 * evaluateAccess() wires the right DB reads to it — caller tier/org
 * attributes from `users`, overrides from `feature_access_overrides`,
 * active rules scoped to the right resourceKey from `access_rules`, and
 * this caller's own grants from `custom_access_grants`.
 */
import { describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../db/testUtils.js";
import { createRepositories } from "../db/repositories/index.js";
import { evaluateAccess, getGroupAllowedFeatureIds } from "./evaluateAccess.js";

// Deliberately NOT "Bliss"/"Advisory"/"Advisor" — migration 0038 already
// seeds org_teams with Bliss/Falcon/Central and roles with Advisor/Mentor/
// Guide as convenience starting rows, and each catalog has a unique-name
// constraint. Using distinct test-only names avoids colliding with those.
async function seedOrg(db: TestDb) {
  const { orgTeams, departments, roles } = createRepositories(db);
  const bliss = await orgTeams.create({ name: "Test Team", description: null, createdBy: "test" });
  const advisory = await departments.create({ name: "Test Department", description: null, createdBy: "test" });
  const advisor = await roles.create({ name: "Test Role", description: null, createdBy: "test" });
  return { bliss, advisory, advisor };
}

describe("evaluateAccess — DB-backed wrapper", () => {
  it("an unknown/never-logged-in email resolves as General tier with no org attributes", async () => {
    const db = await createTestDb();
    const result = await evaluateAccess(db, "nobody@example.com", "lookup");
    expect(result.level).toBe("Viewer"); // "lookup" is Viewer for General by default (2026-09 permission architecture fix)
    expect(result.source).toBe("Default");
  });

  it("a caller with no matching Access Rule resolves to the plain tier default", async () => {
    const db = await createTestDb();
    const { users } = createRepositories(db);
    await users.create({ email: "advisor@example.com", name: "Advisor One", tactId: "T1", tier: "General" });

    const result = await evaluateAccess(db, "advisor@example.com", "audit");
    expect(result).toEqual({ level: "None", source: "Default" });
  });

  it("a matching Access Rule raises the resolved level, sourced from the rule's own name", async () => {
    const db = await createTestDb();
    const { users, accessRules } = createRepositories(db);
    const { bliss, advisory, advisor } = await seedOrg(db);
    await users.create({
      email: "advisor@example.com",
      name: "Advisor One",
      tactId: "T1",
      tier: "General",
      orgTeamId: bliss.id,
      departmentId: advisory.id,
      roleId: advisor.id,
      tags: ["Health"],
    });
    await accessRules.create({
      resourceKey: "audit",
      name: "Bliss Advisory Health Advisors see Activity Log",
      orgTeamId: bliss.id,
      departmentId: advisory.id,
      roleId: advisor.id,
      productTag: "Health",
      grantedLevel: "Viewer",
      createdBy: "test",
    });

    const result = await evaluateAccess(db, "advisor@example.com", "audit");
    expect(result).toEqual({ level: "Viewer", source: 'Access Rule ("Bliss Advisory Health Advisors see Activity Log")' });
  });

  it("a rule scoped to a DIFFERENT resource never leaks into this one", async () => {
    const db = await createTestDb();
    const { users, accessRules } = createRepositories(db);
    const { bliss } = await seedOrg(db);
    await users.create({ email: "advisor@example.com", name: "Advisor One", tactId: "T1", tier: "General", orgTeamId: bliss.id });
    await accessRules.create({
      resourceKey: "profile_access",
      name: "Wrong resource",
      orgTeamId: bliss.id,
      departmentId: null,
      roleId: null,
      productTag: null,
      grantedLevel: "Editor",
      createdBy: "test",
    });

    const result = await evaluateAccess(db, "advisor@example.com", "audit");
    expect(result.level).toBe("None");
  });

  it("a deactivated rule is ignored even though its conditions would match", async () => {
    const db = await createTestDb();
    const { users, accessRules } = createRepositories(db);
    const { bliss } = await seedOrg(db);
    await users.create({ email: "advisor@example.com", name: "Advisor One", tactId: "T1", tier: "General", orgTeamId: bliss.id });
    const rule = await accessRules.create({
      resourceKey: "audit",
      name: "Will be disabled",
      orgTeamId: bliss.id,
      departmentId: null,
      roleId: null,
      productTag: null,
      grantedLevel: "Editor",
      createdBy: "test",
    });
    await accessRules.update(rule.id, { active: false });

    const result = await evaluateAccess(db, "advisor@example.com", "audit");
    expect(result.level).toBe("None");
  });

  it("this caller's own active Custom Grant still wins over a matching rule when stronger", async () => {
    const db = await createTestDb();
    const { users, accessRules, customAccessGrants } = createRepositories(db);
    const { bliss } = await seedOrg(db);
    await users.create({ email: "advisor@example.com", name: "Advisor One", tactId: "T1", tier: "General", orgTeamId: bliss.id });
    await accessRules.create({
      resourceKey: "audit",
      name: "Bliss rule",
      orgTeamId: bliss.id,
      departmentId: null,
      roleId: null,
      productTag: null,
      grantedLevel: "Viewer",
      createdBy: "test",
    });
    await customAccessGrants.set({ userEmail: "advisor@example.com", grantType: "feature_access", targetId: "audit", level: "Editor", note: null, grantedBy: "test" });

    const result = await evaluateAccess(db, "advisor@example.com", "audit");
    expect(result).toEqual({ level: "Editor", source: "Custom Grant" });
  });

  it("Developer tier gets Editor on a formerly-DEVELOPER_ONLY_FEATURES id (smoke_test)", async () => {
    const db = await createTestDb();
    const { users } = createRepositories(db);
    await users.create({ email: "dev@example.com", name: "Dev", tactId: "T1", tier: "Developer" });

    const result = await evaluateAccess(db, "dev@example.com", "smoke_test");
    expect(result.level).toBe("Editor");
  });

  it("an Access Rule now reaches a formerly-DEVELOPER_ONLY_FEATURES id for a General caller (2026-09 un-hard-gating)", async () => {
    // Through 2026-08 this was impossible: DEVELOPER_ONLY_FEATURES hard-gated
    // "smoke_test" before any Access Rule was ever consulted, so a General
    // caller could never reach it no matter what rule targeted them. The Set
    // is empty as of 2026-09 (see its doc comment in featurePermissions.ts),
    // so a matching rule now raises a General caller here exactly like it
    // would for any other governed feature.
    const db = await createTestDb();
    const { users, accessRules } = createRepositories(db);
    const { bliss } = await seedOrg(db);
    await users.create({ email: "advisor@example.com", name: "Advisor One", tactId: "T1", tier: "General", orgTeamId: bliss.id });
    await accessRules.create({
      resourceKey: "smoke_test",
      name: "Bliss can run smoke tests",
      orgTeamId: bliss.id,
      departmentId: null,
      roleId: null,
      productTag: null,
      grantedLevel: "Editor",
      createdBy: "test",
    });

    const result = await evaluateAccess(db, "advisor@example.com", "smoke_test");
    expect(result).toEqual({ level: "Editor", source: 'Access Rule ("Bliss can run smoke tests")' });
  });

  it("an explicit feature_access_overrides row is read and takes priority over the shipped default", async () => {
    const db = await createTestDb();
    const { users, featureAccess } = createRepositories(db);
    await users.create({ email: "advisor@example.com", name: "Advisor One", tactId: "T1", tier: "General" });
    await featureAccess.set({ featureId: "audit", generalAccess: "Viewer", adminAccess: null, platformAdminAccess: null, updatedBy: "test" });

    const result = await evaluateAccess(db, "advisor@example.com", "audit");
    expect(result).toEqual({ level: "Viewer", source: "Override" });
  });
});

describe("getGroupAllowedFeatureIds / Group Access Restriction", () => {
  // Which relationship group(s) count toward group access is an
  // admin-toggled flag (relationship_groups.usedForGroupAccess), not a
  // match on the group's name — see that column's comment in schema.ts.
  // Deliberately using a name that ISN'T "Trainer" throughout most of this
  // suite to prove the name is irrelevant; only the flag matters.
  async function createFlaggedGroup(repos: ReturnType<typeof createRepositories>, name = "Coach") {
    const group = await repos.relationshipGroups.create({ name, description: null, departmentId: null, createdBy: "test" });
    return repos.relationshipGroups.update(group.id, { usedForGroupAccess: true });
  }

  it("returns null when no relationship group is flagged usedForGroupAccess at all", async () => {
    const db = await createTestDb();
    const repos = createRepositories(db);
    await repos.users.create({ email: "member@example.com", name: "Member One", tactId: "T1", tier: "General" });
    // A group exists but nobody flagged it — should behave exactly like no
    // group existing at all.
    await repos.relationshipGroups.create({ name: "Coach", description: null, departmentId: null, createdBy: "test" });

    const result = await getGroupAllowedFeatureIds(repos, "member@example.com", "General");
    expect(result).toBeNull();
  });

  it("returns null when a flagged group exists but this caller isn't a subject of it", async () => {
    const db = await createTestDb();
    const repos = createRepositories(db);
    await createFlaggedGroup(repos);
    await repos.users.create({ email: "someone@example.com", name: "Someone", tactId: "T1", tier: "General" });

    const result = await getGroupAllowedFeatureIds(repos, "someone@example.com", "General");
    expect(result).toBeNull();
  });

  it("a mapped member whose group has enabled some tools gets exactly that group's list", async () => {
    const db = await createTestDb();
    const repos = createRepositories(db);
    // ownerEmail/subjectEmail carry a real FK onto users.email, so both
    // sides of the relationship need a user row first — not just the
    // member.
    await repos.users.create({ email: "owner@example.com", name: "Owner One", tactId: "T-OWNER", tier: "General" });
    await repos.users.create({ email: "member@example.com", name: "Member One", tactId: "T1", tier: "General" });
    const group = await createFlaggedGroup(repos);
    await repos.userRelationships.create({ ownerEmail: "owner@example.com", subjectEmail: "member@example.com", relationshipGroupId: group!.id, createdBy: "test" });
    await repos.groupToolAccess.replaceForGroup(group!.id, ["coverage_projection", "porting_assist"], "test");

    const result = await getGroupAllowedFeatureIds(repos, "member@example.com", "General");
    expect(result).not.toBeNull();
    expect(new Set(result)).toEqual(new Set(["coverage_projection", "porting_assist"]));
  });

  it("a mapped member whose group hasn't enabled anything gets an empty array (fail-closed), not null", async () => {
    const db = await createTestDb();
    const repos = createRepositories(db);
    await repos.users.create({ email: "owner@example.com", name: "Owner One", tactId: "T-OWNER", tier: "General" });
    await repos.users.create({ email: "member@example.com", name: "Member One", tactId: "T1", tier: "General" });
    const group = await createFlaggedGroup(repos);
    await repos.userRelationships.create({ ownerEmail: "owner@example.com", subjectEmail: "member@example.com", relationshipGroupId: group!.id, createdBy: "test" });

    const result = await getGroupAllowedFeatureIds(repos, "member@example.com", "General");
    expect(result).toEqual([]);
  });

  it("permissions are GROUP-level, not owner-level: one owner managing two different groups can give them different access (migration 0081)", async () => {
    // The exact scenario the owner-keyed schema got wrong before migration
    // 0081: a single owner manages two distinct groups (groupA, groupB),
    // each with its own members and its own, independently configured tool
    // set. Under the old groupOwnerEmail-keyed table, configuring one of
    // this owner's groups would have silently applied to both.
    const db = await createTestDb();
    const repos = createRepositories(db);
    await repos.users.create({ email: "owner@example.com", name: "Owner One", tactId: "T-OWNER", tier: "General" });
    await repos.users.create({ email: "member-a@example.com", name: "Member A", tactId: "T-MA", tier: "General" });
    await repos.users.create({ email: "member-b@example.com", name: "Member B", tactId: "T-MB", tier: "General" });
    const groupA = await createFlaggedGroup(repos, "DH100");
    const groupB = await createFlaggedGroup(repos, "DH200");
    await repos.userRelationships.create({ ownerEmail: "owner@example.com", subjectEmail: "member-a@example.com", relationshipGroupId: groupA!.id, createdBy: "test" });
    await repos.userRelationships.create({ ownerEmail: "owner@example.com", subjectEmail: "member-b@example.com", relationshipGroupId: groupB!.id, createdBy: "test" });
    await repos.groupToolAccess.replaceForGroup(groupA!.id, ["porting_assist"], "test");
    await repos.groupToolAccess.replaceForGroup(groupB!.id, ["coverage_projection"], "test");

    const memberAResult = await getGroupAllowedFeatureIds(repos, "member-a@example.com", "General");
    expect(memberAResult).toEqual(["porting_assist"]);

    const memberBResult = await getGroupAllowedFeatureIds(repos, "member-b@example.com", "General");
    expect(memberBResult).toEqual(["coverage_projection"]);
  });

  it("two DIFFERENT flagged relationship groups both feed the same member's access (union across groups the member actually belongs to)", async () => {
    const db = await createTestDb();
    const repos = createRepositories(db);
    await repos.users.create({ email: "owner-a@example.com", name: "Owner A", tactId: "T-OA", tier: "General" });
    await repos.users.create({ email: "owner-b@example.com", name: "Owner B", tactId: "T-OB", tier: "General" });
    await repos.users.create({ email: "member@example.com", name: "Member One", tactId: "T1", tier: "General" });
    const groupA = await createFlaggedGroup(repos, "Coach");
    const groupB = await createFlaggedGroup(repos, "Training Lead");
    await repos.userRelationships.create({ ownerEmail: "owner-a@example.com", subjectEmail: "member@example.com", relationshipGroupId: groupA!.id, createdBy: "test" });
    await repos.userRelationships.create({ ownerEmail: "owner-b@example.com", subjectEmail: "member@example.com", relationshipGroupId: groupB!.id, createdBy: "test" });
    await repos.groupToolAccess.replaceForGroup(groupA!.id, ["porting_assist"], "test");
    await repos.groupToolAccess.replaceForGroup(groupB!.id, ["lookup"], "test");

    const result = await getGroupAllowedFeatureIds(repos, "member@example.com", "General");
    expect(new Set(result)).toEqual(new Set(["porting_assist", "lookup"]));
  });

  it("being someone's group owner doesn't make you a restricted member of yourself", async () => {
    const db = await createTestDb();
    const repos = createRepositories(db);
    await repos.users.create({ email: "owner@example.com", name: "Owner One", tactId: "T-OWNER", tier: "General" });
    await repos.users.create({ email: "member@example.com", name: "Member One", tactId: "T1", tier: "General" });
    const group = await createFlaggedGroup(repos);
    await repos.userRelationships.create({ ownerEmail: "owner@example.com", subjectEmail: "member@example.com", relationshipGroupId: group!.id, createdBy: "test" });

    const result = await getGroupAllowedFeatureIds(repos, "owner@example.com", "General");
    expect(result).toBeNull();
  });

  it("a relationship of an UNFLAGGED group (e.g. the seeded 'Guide' group) never activates the member ceiling", async () => {
    // Migration 0038 already seeds relationship_groups with Mentor/Guide,
    // populated for nearly every advisor via the Advisor Directory sync —
    // this is exactly the case the flag (instead of matching any group)
    // exists to protect: Guide stays inert unless an admin opts it in too.
    const db = await createTestDb();
    const repos = createRepositories(db);
    await createFlaggedGroup(repos, "Coach"); // some OTHER group is flagged...
    const guideGroup = (await repos.relationshipGroups.list()).find((g) => g.name === "Guide")!;
    expect(guideGroup.usedForGroupAccess).toBe(false); // ...but Guide itself never was.
    await repos.users.create({ email: "guide@example.com", name: "Guide One", tactId: "T-GUIDE", tier: "General" });
    await repos.users.create({ email: "guidee@example.com", name: "Guidee One", tactId: "T1", tier: "General" });
    await repos.userRelationships.create({ ownerEmail: "guide@example.com", subjectEmail: "guidee@example.com", relationshipGroupId: guideGroup.id, createdBy: "test" });

    const result = await getGroupAllowedFeatureIds(repos, "guidee@example.com", "General");
    expect(result).toBeNull();
  });

  it("unflagging a group after mappings exist immediately stops it from activating the ceiling", async () => {
    const db = await createTestDb();
    const repos = createRepositories(db);
    await repos.users.create({ email: "owner@example.com", name: "Owner One", tactId: "T-OWNER", tier: "General" });
    await repos.users.create({ email: "member@example.com", name: "Member One", tactId: "T1", tier: "General" });
    const group = await createFlaggedGroup(repos);
    await repos.userRelationships.create({ ownerEmail: "owner@example.com", subjectEmail: "member@example.com", relationshipGroupId: group!.id, createdBy: "test" });
    await repos.groupToolAccess.replaceForGroup(group!.id, ["porting_assist"], "test");

    expect(await getGroupAllowedFeatureIds(repos, "member@example.com", "General")).toEqual(["porting_assist"]);

    await repos.relationshipGroups.update(group!.id, { usedForGroupAccess: false });
    expect(await getGroupAllowedFeatureIds(repos, "member@example.com", "General")).toBeNull();
  });

  it("disabling (unflagging) one group cannot affect another group owned by the same person (migration 0081 regression)", async () => {
    // Same owner manages groupA and groupB, each with its own member and
    // its own tool grant. Unflagging groupA must leave groupB — and its
    // member's access — completely untouched.
    const db = await createTestDb();
    const repos = createRepositories(db);
    await repos.users.create({ email: "owner@example.com", name: "Owner One", tactId: "T-OWNER", tier: "General" });
    await repos.users.create({ email: "member-a@example.com", name: "Member A", tactId: "T-MA", tier: "General" });
    await repos.users.create({ email: "member-b@example.com", name: "Member B", tactId: "T-MB", tier: "General" });
    const groupA = await createFlaggedGroup(repos, "DH100");
    const groupB = await createFlaggedGroup(repos, "DH200");
    await repos.userRelationships.create({ ownerEmail: "owner@example.com", subjectEmail: "member-a@example.com", relationshipGroupId: groupA!.id, createdBy: "test" });
    await repos.userRelationships.create({ ownerEmail: "owner@example.com", subjectEmail: "member-b@example.com", relationshipGroupId: groupB!.id, createdBy: "test" });
    await repos.groupToolAccess.replaceForGroup(groupA!.id, ["porting_assist"], "test");
    await repos.groupToolAccess.replaceForGroup(groupB!.id, ["coverage_projection"], "test");

    expect(await getGroupAllowedFeatureIds(repos, "member-a@example.com", "General")).toEqual(["porting_assist"]);
    expect(await getGroupAllowedFeatureIds(repos, "member-b@example.com", "General")).toEqual(["coverage_projection"]);

    // Disable groupA only.
    await repos.relationshipGroups.update(groupA!.id, { usedForGroupAccess: false });

    expect(await getGroupAllowedFeatureIds(repos, "member-a@example.com", "General")).toBeNull();
    // groupB, same owner, is completely unaffected.
    expect(await getGroupAllowedFeatureIds(repos, "member-b@example.com", "General")).toEqual(["coverage_projection"]);

    // groupB's own tool grant row is untouched at the data level too.
    const groupBGrants = await repos.groupToolAccess.listForGroup(groupB!.id);
    expect(groupBGrants.map((g) => g.featureId)).toEqual(["coverage_projection"]);
  });

  describe("disabling a group (active=false) — 2026-09 fix", () => {
    // Distinct from the usedForGroupAccess flag above: "active" is the
    // Groups tab's actual Disable/Enable (Power icon) toggle. Before this
    // fix, getGroupAllowedFeatureIds never checked `active` at all, so a
    // disabled-but-still-usedForGroupAccess group kept restricting its
    // members exactly as if nothing had changed — this suite proves the
    // fix and that disabling never touches the roster or the tool grants.

    it("disabling a group immediately drops its members back to unrestricted, without touching its roster or tool grants", async () => {
      const db = await createTestDb();
      const repos = createRepositories(db);
      await repos.users.create({ email: "owner@example.com", name: "Owner One", tactId: "T-OWNER", tier: "General" });
      await repos.users.create({ email: "member@example.com", name: "Member One", tactId: "T1", tier: "General" });
      const group = await createFlaggedGroup(repos);
      await repos.userRelationships.create({ ownerEmail: "owner@example.com", subjectEmail: "member@example.com", relationshipGroupId: group!.id, createdBy: "test" });
      await repos.groupToolAccess.replaceForGroup(group!.id, ["porting_assist", "coverage_projection"], "test");

      expect(await getGroupAllowedFeatureIds(repos, "member@example.com", "General")).toEqual(expect.arrayContaining(["porting_assist", "coverage_projection"]));

      await repos.relationshipGroups.update(group!.id, { active: false });

      // The restriction is fully suspended — same as an ordinary,
      // never-mapped General-tier user.
      expect(await getGroupAllowedFeatureIds(repos, "member@example.com", "General")).toBeNull();

      // Nothing about the roster or the configured tool grants was
      // touched by disabling — only the evaluator's treatment of them
      // changed.
      const rosterAfterDisable = await repos.userRelationships.listForEmail("member@example.com");
      expect(rosterAfterDisable).toHaveLength(1);
      expect(rosterAfterDisable[0].relationshipGroupId).toBe(group!.id);
      const grantsAfterDisable = await repos.groupToolAccess.listForGroup(group!.id);
      expect(grantsAfterDisable.map((g) => g.featureId).sort()).toEqual(["coverage_projection", "porting_assist"]);
    });

    it("re-enabling a disabled group restores its exact previous restriction with no reconfiguration", async () => {
      const db = await createTestDb();
      const repos = createRepositories(db);
      await repos.users.create({ email: "owner@example.com", name: "Owner One", tactId: "T-OWNER", tier: "General" });
      await repos.users.create({ email: "member@example.com", name: "Member One", tactId: "T1", tier: "General" });
      const group = await createFlaggedGroup(repos);
      await repos.userRelationships.create({ ownerEmail: "owner@example.com", subjectEmail: "member@example.com", relationshipGroupId: group!.id, createdBy: "test" });
      await repos.groupToolAccess.replaceForGroup(group!.id, ["porting_assist"], "test");

      await repos.relationshipGroups.update(group!.id, { active: false });
      expect(await getGroupAllowedFeatureIds(repos, "member@example.com", "General")).toBeNull();

      await repos.relationshipGroups.update(group!.id, { active: true });
      expect(await getGroupAllowedFeatureIds(repos, "member@example.com", "General")).toEqual(["porting_assist"]);
    });

    it("disabling one group cannot affect another group owned by the same person", async () => {
      const db = await createTestDb();
      const repos = createRepositories(db);
      await repos.users.create({ email: "owner@example.com", name: "Owner One", tactId: "T-OWNER", tier: "General" });
      await repos.users.create({ email: "member-a@example.com", name: "Member A", tactId: "T-MA", tier: "General" });
      await repos.users.create({ email: "member-b@example.com", name: "Member B", tactId: "T-MB", tier: "General" });
      const groupA = await createFlaggedGroup(repos, "DH100");
      const groupB = await createFlaggedGroup(repos, "DH200");
      await repos.userRelationships.create({ ownerEmail: "owner@example.com", subjectEmail: "member-a@example.com", relationshipGroupId: groupA!.id, createdBy: "test" });
      await repos.userRelationships.create({ ownerEmail: "owner@example.com", subjectEmail: "member-b@example.com", relationshipGroupId: groupB!.id, createdBy: "test" });
      await repos.groupToolAccess.replaceForGroup(groupA!.id, ["porting_assist"], "test");
      await repos.groupToolAccess.replaceForGroup(groupB!.id, ["coverage_projection"], "test");

      await repos.relationshipGroups.update(groupA!.id, { active: false });

      expect(await getGroupAllowedFeatureIds(repos, "member-a@example.com", "General")).toBeNull();
      expect(await getGroupAllowedFeatureIds(repos, "member-b@example.com", "General")).toEqual(["coverage_projection"]);
    });

    it("end-to-end via evaluateAccess: disabling a group resolves the tier's normal default again, not 'None'", async () => {
      const db = await createTestDb();
      const repos = createRepositories(db);
      await repos.users.create({ email: "owner@example.com", name: "Owner One", tactId: "T-OWNER", tier: "General" });
      await repos.users.create({ email: "member@example.com", name: "Member One", tactId: "T1", tier: "General" });
      const group = await createFlaggedGroup(repos);
      await repos.userRelationships.create({ ownerEmail: "owner@example.com", subjectEmail: "member@example.com", relationshipGroupId: group!.id, createdBy: "test" });
      await repos.groupToolAccess.replaceForGroup(group!.id, ["porting_assist"], "test");

      // While enabled, an un-granted restrictable tool resolves to None.
      const restricted = await evaluateAccess(db, "member@example.com", "coverage_projection");
      expect(restricted.level).toBe("None");

      await repos.relationshipGroups.update(group!.id, { active: false });

      // Once disabled, the same feature falls back to whatever a
      // completely unrestricted General-tier caller would get — the
      // Group Access Restriction source no longer applies at all.
      const afterDisable = await evaluateAccess(db, "member@example.com", "coverage_projection");
      expect(afterDisable.source).not.toBe("Group Access Restriction");
    });
  });

  it("end-to-end via evaluateAccess: a member with a restricted group resolves 'None' on an un-enabled restrictable tool", async () => {
    const db = await createTestDb();
    const repos = createRepositories(db);
    await repos.users.create({ email: "owner@example.com", name: "Owner One", tactId: "T-OWNER", tier: "General" });
    await repos.users.create({ email: "member@example.com", name: "Member One", tactId: "T1", tier: "General" });
    const group = await createFlaggedGroup(repos);
    await repos.userRelationships.create({ ownerEmail: "owner@example.com", subjectEmail: "member@example.com", relationshipGroupId: group!.id, createdBy: "test" });
    await repos.groupToolAccess.replaceForGroup(group!.id, ["porting_assist"], "test");

    const blocked = await evaluateAccess(db, "member@example.com", "coverage_projection");
    expect(blocked).toEqual({ level: "None", source: "Group Access Restriction" });

    const allowed = await evaluateAccess(db, "member@example.com", "porting_assist");
    expect(allowed).toEqual({ level: "Editor", source: "Group Access Restriction" });
  });

  it("end-to-end via evaluateAccess: a granted 2026-09 expansion feature (e.g. qa_dashboard) resolves 'Editor', not its own Viewer default", async () => {
    const db = await createTestDb();
    const repos = createRepositories(db);
    await repos.users.create({ email: "owner@example.com", name: "Owner One", tactId: "T-OWNER", tier: "General" });
    await repos.users.create({ email: "member@example.com", name: "Member One", tactId: "T1", tier: "General" });
    const group = await createFlaggedGroup(repos);
    await repos.userRelationships.create({ ownerEmail: "owner@example.com", subjectEmail: "member@example.com", relationshipGroupId: group!.id, createdBy: "test" });
    await repos.groupToolAccess.replaceForGroup(group!.id, ["qa_dashboard", "my_activity"], "test");

    const granted = await evaluateAccess(db, "member@example.com", "qa_dashboard");
    expect(granted).toEqual({ level: "Editor", source: "Group Access Restriction" });

    const notGranted = await evaluateAccess(db, "member@example.com", "team_tracker");
    expect(notGranted).toEqual({ level: "None", source: "Group Access Restriction" });
  });

  it("end-to-end via evaluateAccess: a non-restricted General user is completely unaffected", async () => {
    const db = await createTestDb();
    const repos = createRepositories(db);
    await repos.users.create({ email: "regular@example.com", name: "Regular Advisor", tactId: "T1", tier: "General" });

    const result = await evaluateAccess(db, "regular@example.com", "coverage_projection");
    expect(result.source).not.toBe("Group Access Restriction");
  });

  it("end-to-end via evaluateAccess: an Admin member (mistakenly relationship-tagged) is never restricted", async () => {
    const db = await createTestDb();
    const repos = createRepositories(db);
    await repos.users.create({ email: "owner@example.com", name: "Owner One", tactId: "T-OWNER", tier: "General" });
    await repos.users.create({ email: "admin-member@example.com", name: "Admin", tactId: "T-ADMIN", tier: "Admin" });
    const group = await createFlaggedGroup(repos);
    await repos.userRelationships.create({ ownerEmail: "owner@example.com", subjectEmail: "admin-member@example.com", relationshipGroupId: group!.id, createdBy: "test" });
    // Owner hasn't enabled anything — would fail-closed at General tier.
    // Also now doubles as a Group Tier regression: this group was never
    // given an explicit groupTier, so it stays at the column default
    // ("General") — an Admin member is unaffected by a General-targeted
    // group for exactly that reason (tier mismatch), not because Admin is
    // hardcoded-exempt anymore. See the "Group Tier" describe block below
    // for the case where a group DOES target Admin and this Admin member
    // WOULD be restricted.

    const result = await evaluateAccess(db, "admin-member@example.com", "coverage_projection");
    expect(result.source).not.toBe("Group Access Restriction");
  });
});

describe("getGroupAllowedFeatureIds / Group Access Restriction — Group Tier (2026-09, migration 0082)", () => {
  // Group Tier lets a relationship_groups row target which TIER of member
  // its usedForGroupAccess ceiling restricts (General/Admin/Platform Admin,
  // default General) — see schema.ts's comment on
  // `relationshipGroups.groupTier` for the full semantics, and this file's
  // "getGroupAllowedFeatureIds / Group Access Restriction" describe block
  // above for the (still fully intact, untouched-by-this-feature) group
  // isolation/disable/multi-group behavior at the default General tier.
  // This block is specifically about the NEW tier-targeting dimension.
  async function createFlaggedGroup(repos: ReturnType<typeof createRepositories>, name: string, groupTier: "General" | "Admin" | "Platform Admin" = "General") {
    const group = await repos.relationshipGroups.create({ name, description: null, departmentId: null, createdBy: "test", groupTier });
    return repos.relationshipGroups.update(group.id, { usedForGroupAccess: true });
  }

  it("CASE 1/10 — an explicitly-\"General\" group behaves identically to the (legacy, un-set) default — General-tier member restricted as always", async () => {
    const db = await createTestDb();
    const repos = createRepositories(db);
    await repos.users.create({ email: "owner@example.com", name: "Owner One", tactId: "T-OWNER", tier: "General" });
    await repos.users.create({ email: "member@example.com", name: "Member One", tactId: "T1", tier: "General" });
    const group = await createFlaggedGroup(repos, "Coach", "General");
    await repos.userRelationships.create({ ownerEmail: "owner@example.com", subjectEmail: "member@example.com", relationshipGroupId: group!.id, createdBy: "test" });
    await repos.groupToolAccess.replaceForGroup(group!.id, ["porting_assist"], "test");

    expect(await getGroupAllowedFeatureIds(repos, "member@example.com", "General")).toEqual(["porting_assist"]);
  });

  it("CASE 2 — an \"Admin\"-tier group restricts an Admin-tier member exactly like a General-tier group restricts a General-tier member", async () => {
    const db = await createTestDb();
    const repos = createRepositories(db);
    await repos.users.create({ email: "owner@example.com", name: "Owner One", tactId: "T-OWNER", tier: "General" });
    await repos.users.create({ email: "admin-member@example.com", name: "Admin Member", tactId: "T-AM", tier: "Admin" });
    const group = await createFlaggedGroup(repos, "Admin Cohort", "Admin");
    await repos.userRelationships.create({ ownerEmail: "owner@example.com", subjectEmail: "admin-member@example.com", relationshipGroupId: group!.id, createdBy: "test" });
    await repos.groupToolAccess.replaceForGroup(group!.id, ["qa_dashboard"], "test");

    expect(await getGroupAllowedFeatureIds(repos, "admin-member@example.com", "Admin")).toEqual(["qa_dashboard"]);

    // End-to-end via evaluateAccess: a not-granted restrictable tool
    // resolves None (real restriction, not just a raw allow-list check),
    // and the granted one resolves Editor despite qa_dashboard defaulting
    // to Viewer for ordinary Admin-tier users.
    const blocked = await evaluateAccess(db, "admin-member@example.com", "team_tracker");
    expect(blocked).toEqual({ level: "None", source: "Group Access Restriction" });
    const granted = await evaluateAccess(db, "admin-member@example.com", "qa_dashboard");
    expect(granted).toEqual({ level: "Editor", source: "Group Access Restriction" });
  });

  it("CASE 3 — a \"Platform Admin\"-tier group restricts a Platform Admin-tier member", async () => {
    const db = await createTestDb();
    const repos = createRepositories(db);
    await repos.users.create({ email: "owner@example.com", name: "Owner One", tactId: "T-OWNER", tier: "General" });
    await repos.users.create({ email: "pa-member@example.com", name: "PA Member", tactId: "T-PA", tier: "Platform Admin" });
    const group = await createFlaggedGroup(repos, "PA Cohort", "Platform Admin");
    await repos.userRelationships.create({ ownerEmail: "owner@example.com", subjectEmail: "pa-member@example.com", relationshipGroupId: group!.id, createdBy: "test" });
    await repos.groupToolAccess.replaceForGroup(group!.id, ["resources"], "test");

    expect(await getGroupAllowedFeatureIds(repos, "pa-member@example.com", "Platform Admin")).toEqual(["resources"]);

    const granted = await evaluateAccess(db, "pa-member@example.com", "resources");
    expect(granted).toEqual({ level: "Editor", source: "Group Access Restriction" });
  });

  it("CASE 4 — a member's own tier not matching the group's groupTier leaves them completely unaffected by it, even though they're genuinely a mapped subject", async () => {
    const db = await createTestDb();
    const repos = createRepositories(db);
    await repos.users.create({ email: "owner@example.com", name: "Owner One", tactId: "T-OWNER", tier: "General" });
    await repos.users.create({ email: "general-member@example.com", name: "General Member", tactId: "T-GM", tier: "General" });
    // This group targets ADMIN-tier members only.
    const group = await createFlaggedGroup(repos, "Admin Cohort", "Admin");
    await repos.userRelationships.create({ ownerEmail: "owner@example.com", subjectEmail: "general-member@example.com", relationshipGroupId: group!.id, createdBy: "test" });
    await repos.groupToolAccess.replaceForGroup(group!.id, ["porting_assist"], "test");

    // A real, mapped subject of a real, flagged, active group — but their
    // OWN tier ("General") doesn't match this group's groupTier ("Admin"),
    // so it's exactly as if they weren't mapped to any restricting group.
    expect(await getGroupAllowedFeatureIds(repos, "general-member@example.com", "General")).toBeNull();
    const result = await evaluateAccess(db, "general-member@example.com", "porting_assist");
    expect(result.source).not.toBe("Group Access Restriction");
  });

  it("CASE 5 — the group OWNER's own tier has zero bearing on which members it restricts; only groupTier vs. the MEMBER's tier matters", async () => {
    const db = await createTestDb();
    const repos = createRepositories(db);
    // Owner is Platform Admin, but the group they manage targets General-tier
    // members — the owner's own tier never enters this computation at all.
    await repos.users.create({ email: "pa-owner@example.com", name: "PA Owner", tactId: "T-PAO", tier: "Platform Admin" });
    await repos.users.create({ email: "member@example.com", name: "Member One", tactId: "T1", tier: "General" });
    const group = await createFlaggedGroup(repos, "Coach", "General");
    await repos.userRelationships.create({ ownerEmail: "pa-owner@example.com", subjectEmail: "member@example.com", relationshipGroupId: group!.id, createdBy: "test" });
    await repos.groupToolAccess.replaceForGroup(group!.id, ["porting_assist"], "test");

    expect(await getGroupAllowedFeatureIds(repos, "member@example.com", "General")).toEqual(["porting_assist"]);
    // The owner themselves, being Platform Admin, is never restricted by
    // their own group either way (Platform Admin has no path to being a
    // restricted "member" here, same guarantee as before Group Tier).
    expect(await getGroupAllowedFeatureIds(repos, "pa-owner@example.com", "Platform Admin")).toBeNull();
  });

  it("CASE 6 — disabling an Admin-tier group suspends its restriction exactly like disabling a General-tier group always did", async () => {
    const db = await createTestDb();
    const repos = createRepositories(db);
    await repos.users.create({ email: "owner@example.com", name: "Owner One", tactId: "T-OWNER", tier: "General" });
    await repos.users.create({ email: "admin-member@example.com", name: "Admin Member", tactId: "T-AM", tier: "Admin" });
    const group = await createFlaggedGroup(repos, "Admin Cohort", "Admin");
    await repos.userRelationships.create({ ownerEmail: "owner@example.com", subjectEmail: "admin-member@example.com", relationshipGroupId: group!.id, createdBy: "test" });
    await repos.groupToolAccess.replaceForGroup(group!.id, ["porting_assist"], "test");

    expect(await getGroupAllowedFeatureIds(repos, "admin-member@example.com", "Admin")).toEqual(["porting_assist"]);

    await repos.relationshipGroups.update(group!.id, { active: false });
    expect(await getGroupAllowedFeatureIds(repos, "admin-member@example.com", "Admin")).toBeNull();

    await repos.relationshipGroups.update(group!.id, { active: true });
    expect(await getGroupAllowedFeatureIds(repos, "admin-member@example.com", "Admin")).toEqual(["porting_assist"]);
  });

  it("CASE 7/9 — a member in TWO groups targeting DIFFERENT tiers: only the group matching their own tier counts, the other is simply irrelevant to them (not merely 'isolated', genuinely excluded)", async () => {
    const db = await createTestDb();
    const repos = createRepositories(db);
    await repos.users.create({ email: "owner@example.com", name: "Owner One", tactId: "T-OWNER", tier: "General" });
    await repos.users.create({ email: "admin-member@example.com", name: "Admin Member", tactId: "T-AM", tier: "Admin" });
    const generalGroup = await createFlaggedGroup(repos, "General Cohort", "General");
    const adminGroup = await createFlaggedGroup(repos, "Admin Cohort", "Admin");
    // Same person mapped into BOTH groups (e.g. via two different roster
    // entries) — realistic if an admin re-purposes an existing membership.
    await repos.userRelationships.create({ ownerEmail: "owner@example.com", subjectEmail: "admin-member@example.com", relationshipGroupId: generalGroup!.id, createdBy: "test" });
    await repos.userRelationships.create({ ownerEmail: "owner@example.com", subjectEmail: "admin-member@example.com", relationshipGroupId: adminGroup!.id, createdBy: "test" });
    await repos.groupToolAccess.replaceForGroup(generalGroup!.id, ["lookup"], "test");
    await repos.groupToolAccess.replaceForGroup(adminGroup!.id, ["qa_dashboard"], "test");

    // As an Admin-tier caller, only adminGroup's grant list applies —
    // generalGroup's "lookup" grant never bleeds in, because generalGroup
    // doesn't target this caller's tier at all.
    expect(await getGroupAllowedFeatureIds(repos, "admin-member@example.com", "Admin")).toEqual(["qa_dashboard"]);

    // Two DIFFERENT Admin-tier groups, by contrast, still union together
    // exactly like two General-tier groups always did (isolation between
    // groups is about DIFFERENT groups, not about tiers — this is the
    // pre-existing "two DIFFERENT flagged relationship groups both feed the
    // same member's access" behavior, now re-proven at Admin tier too).
    const secondAdminGroup = await createFlaggedGroup(repos, "Second Admin Cohort", "Admin");
    await repos.userRelationships.create({ ownerEmail: "owner@example.com", subjectEmail: "admin-member@example.com", relationshipGroupId: secondAdminGroup!.id, createdBy: "test" });
    await repos.groupToolAccess.replaceForGroup(secondAdminGroup!.id, ["resources"], "test");
    const result = await getGroupAllowedFeatureIds(repos, "admin-member@example.com", "Admin");
    expect(new Set(result)).toEqual(new Set(["qa_dashboard", "resources"]));
  });
});
