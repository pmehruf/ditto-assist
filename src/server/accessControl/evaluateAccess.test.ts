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
import { evaluateAccess, getGroupFeatureLevels } from "./evaluateAccess.js";

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

describe("getGroupFeatureLevels / Group Access (2026-09d redesign: additive raise; 2026-09f layered restriction on top)", () => {
  // Which relationship group(s) count toward group access is an
  // admin-toggled flag (relationship_groups.usedForGroupAccess), not a
  // match on the group's name — see that column's comment in schema.ts.
  // Deliberately using a name that ISN'T "Trainer" throughout most of this
  // suite to prove the name is irrelevant; only the flag matters.
  //
  // getGroupFeatureLevels() ITSELF is unchanged by 2026-09f — it still
  // returns null whenever the union of every qualifying group's grants is
  // empty (no group has checked anything yet), and a plain featureId->level
  // map otherwise. It has no notion of restriction; that's entirely
  // resolveAccess()'s job once it reads a null-vs-present map back out (see
  // accessRuleEvaluator.test.ts's "Group Access — restriction (2026-09f)"
  // block for the exhaustive decision-matrix coverage). The tests below that
  // exercise evaluateAccess() end-to-end are what changed for 2026-09f — see
  // each one's own comment.
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

    const result = await getGroupFeatureLevels(repos, "member@example.com");
    expect(result).toBeNull();
  });

  it("returns null when a flagged group exists but this caller isn't a subject of it", async () => {
    const db = await createTestDb();
    const repos = createRepositories(db);
    await createFlaggedGroup(repos);
    await repos.users.create({ email: "someone@example.com", name: "Someone", tactId: "T1", tier: "General" });

    const result = await getGroupFeatureLevels(repos, "someone@example.com");
    expect(result).toBeNull();
  });

  it("a mapped member whose group has granted some features gets exactly that group's grants, as a featureId -> level map", async () => {
    const db = await createTestDb();
    const repos = createRepositories(db);
    // ownerEmail/subjectEmail carry a real FK onto users.email, so both
    // sides of the relationship need a user row first — not just the
    // member.
    await repos.users.create({ email: "owner@example.com", name: "Owner One", tactId: "T-OWNER", tier: "General" });
    await repos.users.create({ email: "member@example.com", name: "Member One", tactId: "T1", tier: "General" });
    const group = await createFlaggedGroup(repos);
    await repos.userRelationships.create({ ownerEmail: "owner@example.com", subjectEmail: "member@example.com", relationshipGroupId: group!.id, createdBy: "test" });
    await repos.groupToolAccess.replaceForGroup(group!.id, [{ featureId: "coverage_projection", level: "Editor" }, { featureId: "porting_assist", level: "Viewer" }], "test");

    const result = await getGroupFeatureLevels(repos, "member@example.com");
    expect(result).toEqual({ coverage_projection: "Editor", porting_assist: "Viewer" });
  });

  it("a mapped member whose group hasn't granted anything gets null — no more fail-closed blocking (2026-09d)", async () => {
    const db = await createTestDb();
    const repos = createRepositories(db);
    await repos.users.create({ email: "owner@example.com", name: "Owner One", tactId: "T-OWNER", tier: "General" });
    await repos.users.create({ email: "member@example.com", name: "Member One", tactId: "T1", tier: "General" });
    const group = await createFlaggedGroup(repos);
    await repos.userRelationships.create({ ownerEmail: "owner@example.com", subjectEmail: "member@example.com", relationshipGroupId: group!.id, createdBy: "test" });

    const result = await getGroupFeatureLevels(repos, "member@example.com");
    expect(result).toBeNull();
  });

  it("permissions are GROUP-level, not owner-level: one owner managing two different groups can give them different access (migration 0081)", async () => {
    // The exact scenario the owner-keyed schema got wrong before migration
    // 0081: a single owner manages two distinct groups (groupA, groupB),
    // each with its own members and its own, independently configured
    // grant set. Under the old groupOwnerEmail-keyed table, configuring one
    // of this owner's groups would have silently applied to both.
    const db = await createTestDb();
    const repos = createRepositories(db);
    await repos.users.create({ email: "owner@example.com", name: "Owner One", tactId: "T-OWNER", tier: "General" });
    await repos.users.create({ email: "member-a@example.com", name: "Member A", tactId: "T-MA", tier: "General" });
    await repos.users.create({ email: "member-b@example.com", name: "Member B", tactId: "T-MB", tier: "General" });
    const groupA = await createFlaggedGroup(repos, "DH100");
    const groupB = await createFlaggedGroup(repos, "DH200");
    await repos.userRelationships.create({ ownerEmail: "owner@example.com", subjectEmail: "member-a@example.com", relationshipGroupId: groupA!.id, createdBy: "test" });
    await repos.userRelationships.create({ ownerEmail: "owner@example.com", subjectEmail: "member-b@example.com", relationshipGroupId: groupB!.id, createdBy: "test" });
    await repos.groupToolAccess.replaceForGroup(groupA!.id, [{ featureId: "porting_assist", level: "Editor" }], "test");
    await repos.groupToolAccess.replaceForGroup(groupB!.id, [{ featureId: "coverage_projection", level: "Editor" }], "test");

    expect(await getGroupFeatureLevels(repos, "member-a@example.com")).toEqual({ porting_assist: "Editor" });
    expect(await getGroupFeatureLevels(repos, "member-b@example.com")).toEqual({ coverage_projection: "Editor" });
  });

  it("two DIFFERENT flagged relationship groups both feed the same member's access — merged, taking the higher level on overlap", async () => {
    const db = await createTestDb();
    const repos = createRepositories(db);
    await repos.users.create({ email: "owner-a@example.com", name: "Owner A", tactId: "T-OA", tier: "General" });
    await repos.users.create({ email: "owner-b@example.com", name: "Owner B", tactId: "T-OB", tier: "General" });
    await repos.users.create({ email: "member@example.com", name: "Member One", tactId: "T1", tier: "General" });
    const groupA = await createFlaggedGroup(repos, "Coach");
    const groupB = await createFlaggedGroup(repos, "Training Lead");
    await repos.userRelationships.create({ ownerEmail: "owner-a@example.com", subjectEmail: "member@example.com", relationshipGroupId: groupA!.id, createdBy: "test" });
    await repos.userRelationships.create({ ownerEmail: "owner-b@example.com", subjectEmail: "member@example.com", relationshipGroupId: groupB!.id, createdBy: "test" });
    // groupA grants porting_assist at Viewer; groupB grants it at Editor
    // (plus an unrelated "lookup" grant) — the member should end up with
    // the HIGHER of the two on the overlapping feature, unioned with the
    // non-overlapping one.
    await repos.groupToolAccess.replaceForGroup(groupA!.id, [{ featureId: "porting_assist", level: "Viewer" }], "test");
    await repos.groupToolAccess.replaceForGroup(groupB!.id, [{ featureId: "porting_assist", level: "Editor" }, { featureId: "lookup", level: "Viewer" }], "test");

    const result = await getGroupFeatureLevels(repos, "member@example.com");
    expect(result).toEqual({ porting_assist: "Editor", lookup: "Viewer" });
  });

  it("being someone's group owner doesn't make you a restricted member of yourself", async () => {
    const db = await createTestDb();
    const repos = createRepositories(db);
    await repos.users.create({ email: "owner@example.com", name: "Owner One", tactId: "T-OWNER", tier: "General" });
    await repos.users.create({ email: "member@example.com", name: "Member One", tactId: "T1", tier: "General" });
    const group = await createFlaggedGroup(repos);
    await repos.userRelationships.create({ ownerEmail: "owner@example.com", subjectEmail: "member@example.com", relationshipGroupId: group!.id, createdBy: "test" });

    const result = await getGroupFeatureLevels(repos, "owner@example.com");
    expect(result).toBeNull();
  });

  it("a relationship of an UNFLAGGED group (e.g. the seeded 'Guide' group) never contributes any grants", async () => {
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

    const result = await getGroupFeatureLevels(repos, "guidee@example.com");
    expect(result).toBeNull();
  });

  it("unflagging a group after mappings exist immediately stops its grants from applying", async () => {
    const db = await createTestDb();
    const repos = createRepositories(db);
    await repos.users.create({ email: "owner@example.com", name: "Owner One", tactId: "T-OWNER", tier: "General" });
    await repos.users.create({ email: "member@example.com", name: "Member One", tactId: "T1", tier: "General" });
    const group = await createFlaggedGroup(repos);
    await repos.userRelationships.create({ ownerEmail: "owner@example.com", subjectEmail: "member@example.com", relationshipGroupId: group!.id, createdBy: "test" });
    await repos.groupToolAccess.replaceForGroup(group!.id, [{ featureId: "porting_assist", level: "Editor" }], "test");

    expect(await getGroupFeatureLevels(repos, "member@example.com")).toEqual({ porting_assist: "Editor" });

    await repos.relationshipGroups.update(group!.id, { usedForGroupAccess: false });
    expect(await getGroupFeatureLevels(repos, "member@example.com")).toBeNull();
  });

  it("disabling (unflagging) one group cannot affect another group owned by the same person (migration 0081 regression)", async () => {
    // Same owner manages groupA and groupB, each with its own member and
    // its own grant. Unflagging groupA must leave groupB — and its
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
    await repos.groupToolAccess.replaceForGroup(groupA!.id, [{ featureId: "porting_assist", level: "Editor" }], "test");
    await repos.groupToolAccess.replaceForGroup(groupB!.id, [{ featureId: "coverage_projection", level: "Editor" }], "test");

    expect(await getGroupFeatureLevels(repos, "member-a@example.com")).toEqual({ porting_assist: "Editor" });
    expect(await getGroupFeatureLevels(repos, "member-b@example.com")).toEqual({ coverage_projection: "Editor" });

    // Disable groupA only.
    await repos.relationshipGroups.update(groupA!.id, { usedForGroupAccess: false });

    expect(await getGroupFeatureLevels(repos, "member-a@example.com")).toBeNull();
    // groupB, same owner, is completely unaffected.
    expect(await getGroupFeatureLevels(repos, "member-b@example.com")).toEqual({ coverage_projection: "Editor" });

    // groupB's own grant row is untouched at the data level too.
    const groupBGrants = await repos.groupToolAccess.listForGroup(groupB!.id);
    expect(groupBGrants.map((g) => g.featureId)).toEqual(["coverage_projection"]);
  });

  describe("disabling a group (active=false) — 2026-09 fix, still intact post-2026-09d", () => {
    // Distinct from the usedForGroupAccess flag above: "active" is the
    // Groups tab's actual Disable/Enable (Power icon) toggle. Before the
    // 2026-09 fix, this never checked `active` at all, so a
    // disabled-but-still-usedForGroupAccess group kept contributing grants
    // exactly as if nothing had changed — this suite proves the fix and
    // that disabling never touches the roster or the grant rows.

    it("disabling a group immediately drops its members' grants, without touching its roster or the grant rows", async () => {
      const db = await createTestDb();
      const repos = createRepositories(db);
      await repos.users.create({ email: "owner@example.com", name: "Owner One", tactId: "T-OWNER", tier: "General" });
      await repos.users.create({ email: "member@example.com", name: "Member One", tactId: "T1", tier: "General" });
      const group = await createFlaggedGroup(repos);
      await repos.userRelationships.create({ ownerEmail: "owner@example.com", subjectEmail: "member@example.com", relationshipGroupId: group!.id, createdBy: "test" });
      await repos.groupToolAccess.replaceForGroup(group!.id, [{ featureId: "porting_assist", level: "Editor" }, { featureId: "coverage_projection", level: "Editor" }], "test");

      expect(await getGroupFeatureLevels(repos, "member@example.com")).toEqual({ porting_assist: "Editor", coverage_projection: "Editor" });

      await repos.relationshipGroups.update(group!.id, { active: false });

      // The grants are fully suspended — same as an ordinary, never-mapped
      // General-tier user.
      expect(await getGroupFeatureLevels(repos, "member@example.com")).toBeNull();

      // Nothing about the roster or the configured grants was touched by
      // disabling — only the evaluator's treatment of them changed.
      const rosterAfterDisable = await repos.userRelationships.listForEmail("member@example.com");
      expect(rosterAfterDisable).toHaveLength(1);
      expect(rosterAfterDisable[0].relationshipGroupId).toBe(group!.id);
      const grantsAfterDisable = await repos.groupToolAccess.listForGroup(group!.id);
      expect(grantsAfterDisable.map((g) => g.featureId).sort()).toEqual(["coverage_projection", "porting_assist"]);
    });

    it("re-enabling a disabled group restores its exact previous grants with no reconfiguration", async () => {
      const db = await createTestDb();
      const repos = createRepositories(db);
      await repos.users.create({ email: "owner@example.com", name: "Owner One", tactId: "T-OWNER", tier: "General" });
      await repos.users.create({ email: "member@example.com", name: "Member One", tactId: "T1", tier: "General" });
      const group = await createFlaggedGroup(repos);
      await repos.userRelationships.create({ ownerEmail: "owner@example.com", subjectEmail: "member@example.com", relationshipGroupId: group!.id, createdBy: "test" });
      await repos.groupToolAccess.replaceForGroup(group!.id, [{ featureId: "porting_assist", level: "Editor" }], "test");

      await repos.relationshipGroups.update(group!.id, { active: false });
      expect(await getGroupFeatureLevels(repos, "member@example.com")).toBeNull();

      await repos.relationshipGroups.update(group!.id, { active: true });
      expect(await getGroupFeatureLevels(repos, "member@example.com")).toEqual({ porting_assist: "Editor" });
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
      await repos.groupToolAccess.replaceForGroup(groupA!.id, [{ featureId: "porting_assist", level: "Editor" }], "test");
      await repos.groupToolAccess.replaceForGroup(groupB!.id, [{ featureId: "coverage_projection", level: "Editor" }], "test");

      await repos.relationshipGroups.update(groupA!.id, { active: false });

      expect(await getGroupFeatureLevels(repos, "member-a@example.com")).toBeNull();
      expect(await getGroupFeatureLevels(repos, "member-b@example.com")).toEqual({ coverage_projection: "Editor" });
    });

    it("end-to-end via evaluateAccess: disabling a group resolves the tier's normal default again, source no longer 'Group Access'", async () => {
      const db = await createTestDb();
      const repos = createRepositories(db);
      await repos.users.create({ email: "owner@example.com", name: "Owner One", tactId: "T-OWNER", tier: "General" });
      await repos.users.create({ email: "member@example.com", name: "Member One", tactId: "T1", tier: "General" });
      const group = await createFlaggedGroup(repos);
      await repos.userRelationships.create({ ownerEmail: "owner@example.com", subjectEmail: "member@example.com", relationshipGroupId: group!.id, createdBy: "test" });
      await repos.groupToolAccess.replaceForGroup(group!.id, [{ featureId: "porting_assist", level: "Editor" }], "test");

      const withGrant = await evaluateAccess(db, "member@example.com", "porting_assist");
      expect(withGrant).toEqual({ level: "Editor", source: "Group Access" });

      await repos.relationshipGroups.update(group!.id, { active: false });

      // Once disabled, the same feature falls back to whatever a
      // completely unrestricted General-tier caller would get — the
      // Group Access source no longer applies at all.
      const afterDisable = await evaluateAccess(db, "member@example.com", "porting_assist");
      expect(afterDisable.source).not.toBe("Group Access");
    });
  });

  it("end-to-end via evaluateAccess (2026-09f): once a group grants AT LEAST ONE feature, an UNCONFIGURED feature within this member's restriction scope is now BLOCKED, not left at the tier default; the GRANTED feature is still raised", async () => {
    // Superseded by 2026-09f: through 2026-09d, an unconfigured feature
    // always stayed at its ordinary tier default once Group Access became
    // raise-only. The user's explicit follow-up request layered a
    // restriction back on top for General/Admin members of a group that
    // HAS configured at least one grant — see accessRuleEvaluator.ts's
    // groupFeatureLevels doc comment and accessRuleEvaluator.test.ts's
    // "Group Access — restriction (2026-09f)" describe block for the full
    // decision-matrix coverage; this test only proves evaluateAccess() (the
    // DB-fetching wrapper) actually wires a real group's grants into that
    // restriction end-to-end, same as it always did for the raise side.
    const db = await createTestDb();
    const repos = createRepositories(db);
    await repos.users.create({ email: "owner@example.com", name: "Owner One", tactId: "T-OWNER", tier: "General" });
    await repos.users.create({ email: "member@example.com", name: "Member One", tactId: "T1", tier: "General" });
    const group = await createFlaggedGroup(repos);
    await repos.userRelationships.create({ ownerEmail: "owner@example.com", subjectEmail: "member@example.com", relationshipGroupId: group!.id, createdBy: "test" });
    await repos.groupToolAccess.replaceForGroup(group!.id, [{ featureId: "porting_assist", level: "Editor" }], "test");

    // "coverage_projection" has no grant in this group at all — blocked to
    // None, since this group DID configure something (just not this
    // feature) — the "trainee sees only the one tool selected" behavior.
    const blocked = await evaluateAccess(db, "member@example.com", "coverage_projection");
    expect(blocked).toEqual({ level: "None", source: "Group Access (restricted — not selected for this group)" });

    const granted = await evaluateAccess(db, "member@example.com", "porting_assist");
    expect(granted).toEqual({ level: "Editor", source: "Group Access" });
  });

  it("end-to-end via evaluateAccess (2026-09f): a granted feature resolves to the granted level even above its own Viewer default, while an ungranted one in the same restriction scope is blocked", async () => {
    const db = await createTestDb();
    const repos = createRepositories(db);
    await repos.users.create({ email: "owner@example.com", name: "Owner One", tactId: "T-OWNER", tier: "General" });
    await repos.users.create({ email: "member@example.com", name: "Member One", tactId: "T1", tier: "General" });
    const group = await createFlaggedGroup(repos);
    await repos.userRelationships.create({ ownerEmail: "owner@example.com", subjectEmail: "member@example.com", relationshipGroupId: group!.id, createdBy: "test" });
    await repos.groupToolAccess.replaceForGroup(group!.id, [{ featureId: "qa_dashboard", level: "Editor" }], "test");

    const granted = await evaluateAccess(db, "member@example.com", "qa_dashboard");
    expect(granted).toEqual({ level: "Editor", source: "Group Access" });

    // "team_tracker" is ungranted by this group — now blocked to None
    // (2026-09f), not left at its ordinary General-tier default (Viewer).
    const blocked = await evaluateAccess(db, "member@example.com", "team_tracker");
    expect(blocked).toEqual({ level: "None", source: "Group Access (restricted — not selected for this group)" });
  });

  it("end-to-end via evaluateAccess (2026-09f): a group that has configured NOTHING at all (zero grants) restricts nobody — restriction only turns on once at least one feature is checked", async () => {
    // Distinct from the two tests above: this group is flagged
    // usedForGroupAccess AND the member is really mapped to it, but nobody
    // has checked a single feature yet — getGroupFeatureLevels() returns
    // null (not an empty object) for exactly this case, which resolveAccess()
    // treats identically to "belongs to no qualifying group at all". This is
    // deliberate bootstrapping behavior: a freshly created, not-yet-
    // configured group must never silently lock out everyone added to it
    // before its trainer has picked its first tool.
    const db = await createTestDb();
    const repos = createRepositories(db);
    await repos.users.create({ email: "owner@example.com", name: "Owner One", tactId: "T-OWNER", tier: "General" });
    await repos.users.create({ email: "member@example.com", name: "Member One", tactId: "T1", tier: "General" });
    const group = await createFlaggedGroup(repos);
    await repos.userRelationships.create({ ownerEmail: "owner@example.com", subjectEmail: "member@example.com", relationshipGroupId: group!.id, createdBy: "test" });

    const result = await evaluateAccess(db, "member@example.com", "coverage_projection");
    expect(result).toEqual({ level: "Viewer", source: "Default" });
  });

  it("end-to-end via evaluateAccess (2026-09f/g): Admin-tier restriction spans both zones AND the Administrative Access zone — an unconfigured Admin Zone feature and an unconfigured RESTRICT_ONLY_FEATURES entry are both blocked, but neither is ever RAISED", async () => {
    const db = await createTestDb();
    const repos = createRepositories(db);
    await repos.users.create({ email: "owner@example.com", name: "Owner One", tactId: "T-OWNER", tier: "General" });
    await repos.users.create({ email: "admin-member@example.com", name: "Admin Member", tactId: "T-AM", tier: "Admin" });
    const group = await createFlaggedGroup(repos);
    await repos.userRelationships.create({ ownerEmail: "owner@example.com", subjectEmail: "admin-member@example.com", relationshipGroupId: group!.id, createdBy: "test" });
    // This trainer's group checked "porting_assist" and "group_management"
    // — everything else in Admin's restriction scope (both zones, plus the
    // Administrative Access / RESTRICT_ONLY_FEATURES zone — 2026-09g)
    // should now be blocked, EXCEPT group_management itself, which was
    // explicitly checked.
    await repos.groupToolAccess.replaceForGroup(
      group!.id,
      [{ featureId: "porting_assist", level: "Editor" }, { featureId: "group_management", level: "Viewer" }],
      "test"
    );

    // An ordinary Admin Zone feature this Admin-tier member's tier default
    // would otherwise reach (Announcement Manager) is now blocked.
    const adminZoneBlocked = await evaluateAccess(db, "admin-member@example.com", "qa_announcement_log");
    expect(adminZoneBlocked).toEqual({ level: "None", source: "Group Access (restricted — not selected for this group)" });

    // An Advisor Zone feature is blocked too — Admin's restriction scope
    // covers both zones, not just Admin Zone.
    const advisorZoneBlocked = await evaluateAccess(db, "admin-member@example.com", "resources");
    expect(advisorZoneBlocked).toEqual({ level: "None", source: "Group Access (restricted — not selected for this group)" });

    // group_management WAS checked, so this restricted trainer is exempted
    // from restriction and keeps their ordinary tier default (Viewer) — but
    // note the source is still "Default", NOT "Group Access": checking a
    // RESTRICT_ONLY_FEATURES entry never RAISES the level, even though the
    // group grant row itself says "Editor"-capable level "Viewer" here.
    const groupManagement = await evaluateAccess(db, "admin-member@example.com", "group_management");
    expect(groupManagement).toEqual({ level: "Viewer", source: "Default" });

    // profile_access (Access Control Center itself) was NEVER checked by
    // this group — 2026-09g at the user's explicit request ("No check box
    // control for access control center. What if the group is not supposed
    // to have it?"), it's now blocked exactly like any other unconfigured
    // Admin Zone feature, even though it can still never be RAISED through
    // Group Access (the self-escalation boundary for the raise direction is
    // unchanged).
    const profileAccess = await evaluateAccess(db, "admin-member@example.com", "profile_access");
    expect(profileAccess).toEqual({ level: "None", source: "Group Access (restricted — not selected for this group)" });
  });

  it("end-to-end via evaluateAccess: a non-restricted General user is completely unaffected", async () => {
    const db = await createTestDb();
    const repos = createRepositories(db);
    await repos.users.create({ email: "regular@example.com", name: "Regular Advisor", tactId: "T1", tier: "General" });

    const result = await evaluateAccess(db, "regular@example.com", "coverage_projection");
    expect(result.source).not.toBe("Group Access");
  });

  it("end-to-end via evaluateAccess: an Admin member mapped to a group with zero grants stays completely ordinary", async () => {
    const db = await createTestDb();
    const repos = createRepositories(db);
    await repos.users.create({ email: "owner@example.com", name: "Owner One", tactId: "T-OWNER", tier: "General" });
    await repos.users.create({ email: "admin-member@example.com", name: "Admin", tactId: "T-ADMIN", tier: "Admin" });
    const group = await createFlaggedGroup(repos);
    await repos.userRelationships.create({ ownerEmail: "owner@example.com", subjectEmail: "admin-member@example.com", relationshipGroupId: group!.id, createdBy: "test" });
    // Owner hasn't granted anything — getGroupFeatureLevels returns null,
    // so this Admin member is completely ordinary.

    const result = await evaluateAccess(db, "admin-member@example.com", "coverage_projection");
    expect(result.source).not.toBe("Group Access");
  });
});

describe("getGroupFeatureLevels / Group Access — mixed-tier groups & per-member eligibility (2026-09d: no more Group Tier)", () => {
  // Replaces the old "Group Tier" describe block entirely: a relationship
  // group no longer has its own tier-targeting column at all — it can hold
  // members of ANY tier at once, and each grant's effect on a given member
  // is derived purely from that MEMBER's own tier via
  // isFeatureGroupGrantableForTier() (resolveAccess()'s own per-call
  // check — see featurePermissions.ts), never from anything stored on the
  // group. getGroupFeatureLevels() itself returns the EXACT SAME grant map
  // regardless of which member is asking — proving the per-tier filtering
  // genuinely lives in resolveAccess(), not in this DB-backed lookup.
  async function createFlaggedGroup(repos: ReturnType<typeof createRepositories>, name: string) {
    const group = await repos.relationshipGroups.create({ name, description: null, departmentId: null, createdBy: "test" });
    return repos.relationshipGroups.update(group.id, { usedForGroupAccess: true });
  }

  it("CASE 1 — a single group with BOTH a General-tier and an Admin-tier member: an Advisor Zone grant reaches both identically", async () => {
    const db = await createTestDb();
    const repos = createRepositories(db);
    await repos.users.create({ email: "owner@example.com", name: "Owner One", tactId: "T-OWNER", tier: "General" });
    await repos.users.create({ email: "general-member@example.com", name: "General Member", tactId: "T-GM", tier: "General" });
    await repos.users.create({ email: "admin-member@example.com", name: "Admin Member", tactId: "T-AM", tier: "Admin" });
    const group = await createFlaggedGroup(repos, "Mixed Cohort");
    await repos.userRelationships.create({ ownerEmail: "owner@example.com", subjectEmail: "general-member@example.com", relationshipGroupId: group!.id, createdBy: "test" });
    await repos.userRelationships.create({ ownerEmail: "owner@example.com", subjectEmail: "admin-member@example.com", relationshipGroupId: group!.id, createdBy: "test" });
    await repos.groupToolAccess.replaceForGroup(group!.id, [{ featureId: "lookup", level: "Editor" }], "test");

    // The raw grant map is identical for both members — this lookup
    // doesn't know or care about tier at all.
    expect(await getGroupFeatureLevels(repos, "general-member@example.com")).toEqual({ lookup: "Editor" });
    expect(await getGroupFeatureLevels(repos, "admin-member@example.com")).toEqual({ lookup: "Editor" });

    const generalResult = await evaluateAccess(db, "general-member@example.com", "lookup");
    expect(generalResult).toEqual({ level: "Editor", source: "Group Access" });
    const adminResult = await evaluateAccess(db, "admin-member@example.com", "lookup");
    expect(adminResult).toEqual({ level: "Editor", source: "Group Access" });
  });

  it("CASE 2 — the SAME group's Admin Zone grant only takes effect for the Admin-tier member; the General-tier member of the very same group is unaffected", async () => {
    const db = await createTestDb();
    const repos = createRepositories(db);
    await repos.users.create({ email: "owner@example.com", name: "Owner One", tactId: "T-OWNER", tier: "General" });
    await repos.users.create({ email: "general-member@example.com", name: "General Member", tactId: "T-GM", tier: "General" });
    await repos.users.create({ email: "admin-member@example.com", name: "Admin Member", tactId: "T-AM", tier: "Admin" });
    const group = await createFlaggedGroup(repos, "Mixed Cohort");
    await repos.userRelationships.create({ ownerEmail: "owner@example.com", subjectEmail: "general-member@example.com", relationshipGroupId: group!.id, createdBy: "test" });
    await repos.userRelationships.create({ ownerEmail: "owner@example.com", subjectEmail: "admin-member@example.com", relationshipGroupId: group!.id, createdBy: "test" });
    // "product_assist_quota" (AI Usage & Limits) is an Admin Zone feature
    // that defaults to None for Admin (Platform-Admin/Developer-only by
    // default) — unlike "plan_scope", which already defaults to Editor for
    // Admin, so a grant on it wouldn't visibly demonstrate anything being
    // raised.
    await repos.groupToolAccess.replaceForGroup(group!.id, [{ featureId: "product_assist_quota", level: "Editor" }], "test");

    // The map itself is identical for both members — the filtering happens
    // entirely inside resolveAccess(), not here.
    expect(await getGroupFeatureLevels(repos, "general-member@example.com")).toEqual({ product_assist_quota: "Editor" });
    expect(await getGroupFeatureLevels(repos, "admin-member@example.com")).toEqual({ product_assist_quota: "Editor" });

    const adminResult = await evaluateAccess(db, "admin-member@example.com", "product_assist_quota");
    expect(adminResult).toEqual({ level: "Editor", source: "Group Access" });

    // The General-tier member of this SAME group is completely unaffected —
    // "product_assist_quota" defaults to None for General, and Group Access
    // never reaches it for them.
    const generalResult = await evaluateAccess(db, "general-member@example.com", "product_assist_quota");
    expect(generalResult).toEqual({ level: "None", source: "Default" });
  });

  it("CASE 3 — two groups grant the same feature at different levels; the member gets the higher of the two", async () => {
    const db = await createTestDb();
    const repos = createRepositories(db);
    await repos.users.create({ email: "owner@example.com", name: "Owner One", tactId: "T-OWNER", tier: "General" });
    await repos.users.create({ email: "member@example.com", name: "Member One", tactId: "T1", tier: "General" });
    const groupA = await createFlaggedGroup(repos, "Cohort A");
    const groupB = await createFlaggedGroup(repos, "Cohort B");
    await repos.userRelationships.create({ ownerEmail: "owner@example.com", subjectEmail: "member@example.com", relationshipGroupId: groupA!.id, createdBy: "test" });
    await repos.userRelationships.create({ ownerEmail: "owner@example.com", subjectEmail: "member@example.com", relationshipGroupId: groupB!.id, createdBy: "test" });
    await repos.groupToolAccess.replaceForGroup(groupA!.id, [{ featureId: "porting_assist", level: "Viewer" }], "test");
    await repos.groupToolAccess.replaceForGroup(groupB!.id, [{ featureId: "porting_assist", level: "Editor" }], "test");

    expect(await getGroupFeatureLevels(repos, "member@example.com")).toEqual({ porting_assist: "Editor" });
    const result = await evaluateAccess(db, "member@example.com", "porting_assist");
    expect(result).toEqual({ level: "Editor", source: "Group Access" });
  });

  it("CASE 4 — disabling a group immediately drops its grants, restoring the tier's ordinary default", async () => {
    const db = await createTestDb();
    const repos = createRepositories(db);
    await repos.users.create({ email: "owner@example.com", name: "Owner One", tactId: "T-OWNER", tier: "General" });
    await repos.users.create({ email: "admin-member@example.com", name: "Admin Member", tactId: "T-AM", tier: "Admin" });
    const group = await createFlaggedGroup(repos, "Admin Cohort");
    await repos.userRelationships.create({ ownerEmail: "owner@example.com", subjectEmail: "admin-member@example.com", relationshipGroupId: group!.id, createdBy: "test" });
    await repos.groupToolAccess.replaceForGroup(group!.id, [{ featureId: "plan_scope", level: "Viewer" }], "test");

    // plan_scope already defaults to Editor for Admin — a Viewer-level
    // grant can't lower it (raise-only).
    expect(await evaluateAccess(db, "admin-member@example.com", "plan_scope")).toEqual({ level: "Editor", source: "Default" });

    await repos.relationshipGroups.update(group!.id, { active: false });
    expect(await getGroupFeatureLevels(repos, "admin-member@example.com")).toBeNull();

    await repos.relationshipGroups.update(group!.id, { active: true });
    expect(await getGroupFeatureLevels(repos, "admin-member@example.com")).toEqual({ plan_scope: "Viewer" });
  });

  it("CASE 5 — the group owner's own tier has zero bearing on who's affected; only actual membership matters", async () => {
    const db = await createTestDb();
    const repos = createRepositories(db);
    // Owner is Platform Admin — irrelevant, since the owner isn't a subject
    // of their own group.
    await repos.users.create({ email: "pa-owner@example.com", name: "PA Owner", tactId: "T-PAO", tier: "Platform Admin" });
    await repos.users.create({ email: "member@example.com", name: "Member One", tactId: "T1", tier: "General" });
    const group = await createFlaggedGroup(repos, "Coach");
    await repos.userRelationships.create({ ownerEmail: "pa-owner@example.com", subjectEmail: "member@example.com", relationshipGroupId: group!.id, createdBy: "test" });
    await repos.groupToolAccess.replaceForGroup(group!.id, [{ featureId: "porting_assist", level: "Editor" }], "test");

    expect(await getGroupFeatureLevels(repos, "member@example.com")).toEqual({ porting_assist: "Editor" });
    // The owner themselves, not being a subject of the group, is unaffected.
    expect(await getGroupFeatureLevels(repos, "pa-owner@example.com")).toBeNull();
  });
});
