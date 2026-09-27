/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Regression tests for resolveAccess() — Access Control Center Phase 1
 * (docs/ACCESS_CONTROL_CENTER_PHASE_PLAN.md).
 *
 * Two jobs:
 *   1. Prove that with zero access_rules, resolveAccess() reproduces
 *      today's requireFeatureAccess()/hasAccess() output exactly, across
 *      every shipped feature and tier — the "must reproduce today's output
 *      before anything is wired to it" requirement Phase 1 promised.
 *   2. Exercise the new Access Rule matching/OR/additive-max behavior in
 *      isolation, since nothing else in the app does yet.
 *
 * This does not (and structurally cannot) import requireFeatureAccess()
 * itself — it's an unexported function inside server.ts's Express app, not
 * a testable unit. Instead, each "reproduces current behavior" test encodes
 * the known current output directly from DEFAULT_FEATURE_PERMISSIONS /
 * DEVELOPER_ONLY_FEATURES / the documented resolution order in
 * requireFeatureAccess()'s own comments (server.ts:1907-1963) and
 * hasAccess()'s (App.tsx:1313-1403) — both read immediately before writing
 * this evaluator, see accessRuleEvaluator.ts's header comment.
 */
import { describe, expect, it } from "vitest";
import { resolveAccess, ruleMatchesCaller, levelAllows, isDeveloperPowerTier, type AccessRuleLike, type CustomGrantLike, type FeatureOverrideLike } from "./accessRuleEvaluator";
import { DEFAULT_FEATURE_PERMISSIONS, DEVELOPER_ONLY_FEATURES, GROUP_RESTRICTABLE_FEATURES, isFeatureGroupRestrictableForTier } from "./constants/featurePermissions";

const NO_OVERRIDES: FeatureOverrideLike[] = [];
const NO_GRANTS: CustomGrantLike[] = [];
const NO_RULES: AccessRuleLike[] = [];
const NO_CALLER = {};

describe("resolveAccess — reproduces today's behavior with zero Access Rules", () => {
  it("DEVELOPER_ONLY_FEATURES is empty as of 2026-09 — the hard gate is a no-op for every shipped feature", () => {
    // owner_controls, connections, smoke_test, and product_assist_quota used
    // to live in this Set and get hard-gated here, before the registry/
    // override table was ever consulted (see this Set's own doc comment in
    // featurePermissions.ts for why it changed). Confirm the Set really is
    // empty, then confirm those 4 ids now resolve through the ordinary
    // registry/override path with their shipped defaults preserved exactly
    // — each default was deliberately set to match what that feature's old
    // hardcoded gate actually allowed (see each entry's own comment in
    // featurePermissions.ts).
    expect(DEVELOPER_ONLY_FEATURES.size).toBe(0);

    const previouslyHardGated: Array<[string, "General" | "Admin" | "Platform Admin" | "Developer", "None" | "Editor"]> = [
      // owner_controls / smoke_test / product_assist_quota were all
      // isDeveloperPower-only (Developer or Platform Admin) — General and
      // Admin both stay "None" by default.
      ["owner_controls", "General", "None"],
      ["owner_controls", "Admin", "None"],
      ["owner_controls", "Platform Admin", "Editor"],
      ["owner_controls", "Developer", "Editor"],
      ["smoke_test", "General", "None"],
      ["smoke_test", "Admin", "None"],
      ["smoke_test", "Platform Admin", "Editor"],
      ["smoke_test", "Developer", "Editor"],
      ["product_assist_quota", "General", "None"],
      ["product_assist_quota", "Admin", "None"],
      ["product_assist_quota", "Platform Admin", "Editor"],
      ["product_assist_quota", "Developer", "Editor"],
      // connections was isAdminPower-only (Admin, Platform Admin, or
      // Developer) — Admin defaults to "Editor" to preserve that, unlike
      // the three above.
      ["connections", "General", "None"],
      ["connections", "Admin", "Editor"],
      ["connections", "Platform Admin", "Editor"],
      ["connections", "Developer", "Editor"],
    ];
    for (const [featureId, tier, expected] of previouslyHardGated) {
      const result = resolveAccess({ featureId, tier, featureDefaults: DEFAULT_FEATURE_PERMISSIONS, overrides: NO_OVERRIDES, grants: NO_GRANTS, accessRules: NO_RULES, caller: NO_CALLER });
      expect(result.level).toBe(expected);
    }
  });

  it("a real Developer gets Editor on every shipped feature, governed or not", () => {
    for (const perm of DEFAULT_FEATURE_PERMISSIONS) {
      expect(resolveAccess({ featureId: perm.id, tier: "Developer", featureDefaults: DEFAULT_FEATURE_PERMISSIONS, overrides: NO_OVERRIDES, grants: NO_GRANTS, accessRules: NO_RULES, caller: NO_CALLER }).level).toBe("Editor");
    }
    expect(resolveAccess({ featureId: "totally_unknown_id", tier: "Developer", featureDefaults: DEFAULT_FEATURE_PERMISSIONS, overrides: NO_OVERRIDES, grants: NO_GRANTS, accessRules: NO_RULES, caller: NO_CALLER }).level).toBe("Editor");
  });

  it("Platform Admin defaults to Editor when unconfigured (old unconditional-bypass reproduction)", () => {
    // DEVELOPER_ONLY_FEATURES is empty as of 2026-09 (see this Set's own doc
    // comment in featurePermissions.ts), so every shipped feature — including
    // the 4 it used to hard-gate — goes through this same loop; Platform
    // Admin's own separate always-Editor-by-default branch in resolveAccess()
    // covers all of them regardless.
    for (const perm of DEFAULT_FEATURE_PERMISSIONS) {
      const result = resolveAccess({ featureId: perm.id, tier: "Platform Admin", featureDefaults: DEFAULT_FEATURE_PERMISSIONS, overrides: NO_OVERRIDES, grants: NO_GRANTS, accessRules: NO_RULES, caller: NO_CALLER });
      expect(result.level).toBe("Editor");
      expect(result.source).toBe("Default (Platform Admin)");
    }
  });

  it("Platform Admin narrows via an explicit override", () => {
    const overrides: FeatureOverrideLike[] = [{ featureId: "lookup", generalAccess: null, adminAccess: null, platformAdminAccess: "Viewer" }];
    const result = resolveAccess({ featureId: "lookup", tier: "Platform Admin", featureDefaults: DEFAULT_FEATURE_PERMISSIONS, overrides, grants: NO_GRANTS, accessRules: NO_RULES, caller: NO_CALLER });
    expect(result).toEqual({ level: "Viewer", source: "Override" });
  });

  it("General/Admin resolve to the shipped default for every governed feature (spot check)", () => {
    const cases: Array<[string, "General" | "Admin", "None" | "Viewer" | "Editor"]> = [
      // Corrected 2026-09 (permission architecture fix): "lookup" has no
      // admin/configuration action of its own — normal use (entering PED
      // details, selecting a plan, running the mapping, viewing results) is
      // Viewer, not Editor. See featurePermissions.ts's own comment on this
      // entry.
      ["lookup", "General", "Viewer"],
      ["lookup", "Admin", "Viewer"],
      ["audit", "General", "None"],
      ["audit", "Admin", "Editor"],
      ["profile_access", "General", "None"],
      ["profile_access", "Admin", "Viewer"],
      ["advisory_zone", "General", "Viewer"],
      ["qa_dashboard", "General", "Viewer"],
    ];
    for (const [featureId, tier, expected] of cases) {
      const result = resolveAccess({ featureId, tier, featureDefaults: DEFAULT_FEATURE_PERMISSIONS, overrides: NO_OVERRIDES, grants: NO_GRANTS, accessRules: NO_RULES, caller: NO_CALLER });
      expect(result.level, `${featureId}/${tier}`).toBe(expected);
      expect(result.source, `${featureId}/${tier}`).toBe("Default");
    }
  });

  it("General/Admin resolve through an explicit override when one exists", () => {
    const overrides: FeatureOverrideLike[] = [{ featureId: "audit", generalAccess: "Viewer", adminAccess: null, platformAdminAccess: null }];
    const result = resolveAccess({ featureId: "audit", tier: "General", featureDefaults: DEFAULT_FEATURE_PERMISSIONS, overrides, grants: NO_GRANTS, accessRules: NO_RULES, caller: NO_CALLER });
    expect(result).toEqual({ level: "Viewer", source: "Override" });
  });

  it("an unknown feature id resolves open (Editor) for every tier, matching the 'kept open' fallback", () => {
    for (const tier of ["General", "Admin", "Platform Admin"] as const) {
      const result = resolveAccess({ featureId: "made_up_id", tier, featureDefaults: DEFAULT_FEATURE_PERMISSIONS, overrides: NO_OVERRIDES, grants: NO_GRANTS, accessRules: NO_RULES, caller: NO_CALLER });
      expect(result.level).toBe("Editor");
    }
  });

  it("hiddenPages is optional — omitting it (server behavior) never blocks; passing it (client behavior) does", () => {
    const withoutHidden = resolveAccess({ featureId: "lookup", tier: "General", featureDefaults: DEFAULT_FEATURE_PERMISSIONS, overrides: NO_OVERRIDES, grants: NO_GRANTS, accessRules: NO_RULES, caller: NO_CALLER });
    expect(withoutHidden.level).toBe("Viewer"); // "lookup" defaults General to Viewer (2026-09 correction) — nothing here needs Editor.

    const withHidden = resolveAccess({ featureId: "lookup", tier: "General", featureDefaults: DEFAULT_FEATURE_PERMISSIONS, overrides: NO_OVERRIDES, hiddenPages: ["lookup"], grants: NO_GRANTS, accessRules: NO_RULES, caller: NO_CALLER });
    expect(withHidden).toEqual({ level: "None", source: "Hidden (Feature Visibility)" });

    // A real Developer/Platform Admin is exempt from Feature Visibility.
    const devWithHidden = resolveAccess({ featureId: "lookup", tier: "Developer", featureDefaults: DEFAULT_FEATURE_PERMISSIONS, overrides: NO_OVERRIDES, hiddenPages: ["lookup"], grants: NO_GRANTS, accessRules: NO_RULES, caller: NO_CALLER });
    expect(devWithHidden.level).toBe("Editor");
  });

  it("a Custom Grant only ever raises, never lowers, the resolved level", () => {
    const grants: CustomGrantLike[] = [{ active: true, grantType: "feature_access", targetId: "audit", level: "Editor" }];
    const raised = resolveAccess({ featureId: "audit", tier: "General", featureDefaults: DEFAULT_FEATURE_PERMISSIONS, overrides: NO_OVERRIDES, grants, accessRules: NO_RULES, caller: NO_CALLER });
    expect(raised).toEqual({ level: "Editor", source: "Custom Grant" });

    // A grant weaker than the shipped default never lowers Admin's own "audit" Editor default.
    const weakGrant: CustomGrantLike[] = [{ active: true, grantType: "feature_access", targetId: "audit", level: "Viewer" }];
    const unaffected = resolveAccess({ featureId: "audit", tier: "Admin", featureDefaults: DEFAULT_FEATURE_PERMISSIONS, overrides: NO_OVERRIDES, grants: weakGrant, accessRules: NO_RULES, caller: NO_CALLER });
    expect(unaffected.level).toBe("Editor");

    // An inactive grant is ignored entirely.
    const inactive: CustomGrantLike[] = [{ active: false, grantType: "feature_access", targetId: "audit", level: "Editor" }];
    const ignored = resolveAccess({ featureId: "audit", tier: "General", featureDefaults: DEFAULT_FEATURE_PERMISSIONS, overrides: NO_OVERRIDES, grants: inactive, accessRules: NO_RULES, caller: NO_CALLER });
    expect(ignored.level).toBe("None");
  });
});

describe("ruleMatchesCaller — AND semantics within one rule", () => {
  const baseRule: AccessRuleLike = {
    resourceKey: "audit",
    name: "Bliss Advisors see Activity Log",
    active: true,
    orgTeamId: 1,
    departmentId: null,
    roleId: null,
    productTag: null,
    grantedLevel: "Viewer",
  };

  it("matches a caller equal on every non-null condition", () => {
    expect(ruleMatchesCaller(baseRule, { orgTeamId: 1 })).toBe(true);
  });

  it("does not match a caller who differs on any one non-null condition", () => {
    expect(ruleMatchesCaller(baseRule, { orgTeamId: 2 })).toBe(false);
    expect(ruleMatchesCaller(baseRule, {})).toBe(false); // caller.orgTeamId undefined !== 1
  });

  it("null conditions are 'don't care' and never block a match", () => {
    const blanket: AccessRuleLike = { ...baseRule, orgTeamId: null };
    expect(ruleMatchesCaller(blanket, {})).toBe(true);
    expect(ruleMatchesCaller(blanket, { orgTeamId: 999, departmentId: 5, roleId: 7 })).toBe(true);
  });

  it("productTag matches against membership in caller.tags, not equality", () => {
    const tagRule: AccessRuleLike = { ...baseRule, orgTeamId: null, productTag: "Health" };
    expect(ruleMatchesCaller(tagRule, { tags: ["Health", "Term"] })).toBe(true);
    expect(ruleMatchesCaller(tagRule, { tags: ["Term"] })).toBe(false);
    expect(ruleMatchesCaller(tagRule, {})).toBe(false);
  });

  it("every condition must match simultaneously (AND), not any one", () => {
    const strict: AccessRuleLike = { resourceKey: "audit", name: "strict", active: true, orgTeamId: 1, departmentId: 2, roleId: 3, productTag: "Health", grantedLevel: "Editor" };
    expect(ruleMatchesCaller(strict, { orgTeamId: 1, departmentId: 2, roleId: 3, tags: ["Health"] })).toBe(true);
    expect(ruleMatchesCaller(strict, { orgTeamId: 1, departmentId: 2, roleId: 3, tags: ["Term"] })).toBe(false);
    expect(ruleMatchesCaller(strict, { orgTeamId: 1, departmentId: 999, roleId: 3, tags: ["Health"] })).toBe(false);
  });
});

describe("resolveAccess — Access Rules (new in Phase 1)", () => {
  const caller = { orgTeamId: 1, departmentId: 2, roleId: 3, tags: ["Health"] };

  it("a matching rule raises a General caller above the tier default (audit defaults to None for General)", () => {
    const rules: AccessRuleLike[] = [{ resourceKey: "audit", name: "Bliss health advisors", active: true, orgTeamId: 1, departmentId: null, roleId: null, productTag: "Health", grantedLevel: "Viewer" }];
    const result = resolveAccess({ featureId: "audit", tier: "General", featureDefaults: DEFAULT_FEATURE_PERMISSIONS, overrides: NO_OVERRIDES, grants: NO_GRANTS, accessRules: rules, caller });
    expect(result).toEqual({ level: "Viewer", source: 'Access Rule ("Bliss health advisors")' });
  });

  it("a non-matching rule for the same resource has no effect", () => {
    const rules: AccessRuleLike[] = [{ resourceKey: "audit", name: "Falcon only", active: true, orgTeamId: 999, departmentId: null, roleId: null, productTag: null, grantedLevel: "Editor" }];
    const result = resolveAccess({ featureId: "audit", tier: "General", featureDefaults: DEFAULT_FEATURE_PERMISSIONS, overrides: NO_OVERRIDES, grants: NO_GRANTS, accessRules: rules, caller });
    expect(result.level).toBe("None");
  });

  it("an inactive rule never matches, even if its conditions would", () => {
    const rules: AccessRuleLike[] = [{ resourceKey: "audit", name: "Disabled rule", active: false, orgTeamId: 1, departmentId: null, roleId: null, productTag: null, grantedLevel: "Editor" }];
    const result = resolveAccess({ featureId: "audit", tier: "General", featureDefaults: DEFAULT_FEATURE_PERMISSIONS, overrides: NO_OVERRIDES, grants: NO_GRANTS, accessRules: rules, caller });
    expect(result.level).toBe("None");
  });

  it("a rule for a different resourceKey never applies", () => {
    const rules: AccessRuleLike[] = [{ resourceKey: "profile_access", name: "Wrong resource", active: true, orgTeamId: 1, departmentId: null, roleId: null, productTag: null, grantedLevel: "Editor" }];
    const result = resolveAccess({ featureId: "audit", tier: "General", featureDefaults: DEFAULT_FEATURE_PERMISSIONS, overrides: NO_OVERRIDES, grants: NO_GRANTS, accessRules: rules, caller });
    expect(result.level).toBe("None");
  });

  it("multiple matching rules are OR'd — the strongest matching rule wins, not the last one", () => {
    const rules: AccessRuleLike[] = [
      { resourceKey: "audit", name: "Viewer rule", active: true, orgTeamId: 1, departmentId: null, roleId: null, productTag: null, grantedLevel: "Viewer" },
      { resourceKey: "audit", name: "Editor rule", active: true, orgTeamId: null, departmentId: 2, roleId: null, productTag: null, grantedLevel: "Editor" },
    ];
    const result = resolveAccess({ featureId: "audit", tier: "General", featureDefaults: DEFAULT_FEATURE_PERMISSIONS, overrides: NO_OVERRIDES, grants: NO_GRANTS, accessRules: rules, caller });
    expect(result).toEqual({ level: "Editor", source: 'Access Rule ("Editor rule")' });
  });

  it("a rule never lowers what the tier default already grants (additive only)", () => {
    // "audit" is already Editor for Admin by default — a Viewer-level rule can't demote it.
    const rules: AccessRuleLike[] = [{ resourceKey: "audit", name: "Weaker rule", active: true, orgTeamId: 1, departmentId: null, roleId: null, productTag: null, grantedLevel: "Viewer" }];
    const result = resolveAccess({ featureId: "audit", tier: "Admin", featureDefaults: DEFAULT_FEATURE_PERMISSIONS, overrides: NO_OVERRIDES, grants: NO_GRANTS, accessRules: rules, caller });
    expect(result).toEqual({ level: "Editor", source: "Default" });
  });

  it("a Custom Grant still wins over a matching Access Rule when it's stronger", () => {
    const rules: AccessRuleLike[] = [{ resourceKey: "audit", name: "Rule", active: true, orgTeamId: 1, departmentId: null, roleId: null, productTag: null, grantedLevel: "Viewer" }];
    const grants: CustomGrantLike[] = [{ active: true, grantType: "feature_access", targetId: "audit", level: "Editor" }];
    const result = resolveAccess({ featureId: "audit", tier: "General", featureDefaults: DEFAULT_FEATURE_PERMISSIONS, overrides: NO_OVERRIDES, grants, accessRules: rules, caller });
    expect(result).toEqual({ level: "Editor", source: "Custom Grant" });
  });

  it("Access Rules now DO apply to the 4 formerly-DEVELOPER_ONLY_FEATURES ids (2026-09 un-hard-gating)", () => {
    // Through 2026-08 this was the opposite: a rule targeting one of these
    // ids was silently ignored because the DEVELOPER_ONLY_FEATURES hard gate
    // short-circuited before Access Rules were ever consulted. Now that the
    // Set is empty, a matching rule raises a General caller above the "None"
    // shipped default exactly like it would for any other governed feature —
    // this is the whole point of making these 4 features reassignable.
    for (const featureId of ["owner_controls", "connections", "smoke_test", "product_assist_quota"]) {
      const rules: AccessRuleLike[] = [
        { resourceKey: featureId, name: "Should now apply", active: true, orgTeamId: 1, departmentId: null, roleId: null, productTag: null, grantedLevel: "Editor" },
      ];
      const result = resolveAccess({ featureId, tier: "General", featureDefaults: DEFAULT_FEATURE_PERMISSIONS, overrides: NO_OVERRIDES, grants: NO_GRANTS, accessRules: rules, caller });
      expect(result.level).toBe("Editor");
    }
  });
});

describe("Group Access Restriction", () => {
  // "lookup"/"product_assist"/"porting_assist"/"coverage_projection"/
  // "specific_illness_check"/"qa_dashboard"/"team_tracker"/"advisory_zone"/
  // "announcement_archive"/"resources"/"my_activity" are the 11
  // GROUP_RESTRICTABLE_FEATURES ids (see featurePermissions.ts — originally
  // just the first 5, expanded 2026-09). "audit" is deliberately NOT one of
  // them — used throughout to prove the ceiling never touches an unscoped
  // feature.
  const caller = { orgTeamId: null, departmentId: null, roleId: null, tags: [] };

  it("groupAllowedFeatureIds omitted/null/undefined leaves today's behavior completely unchanged (regression safety)", () => {
    for (const groupAllowedFeatureIds of [undefined, null]) {
      const result = resolveAccess({
        featureId: "product_assist",
        tier: "General",
        featureDefaults: DEFAULT_FEATURE_PERMISSIONS,
        overrides: NO_OVERRIDES,
        grants: NO_GRANTS,
        accessRules: NO_RULES,
        caller,
        groupAllowedFeatureIds,
      });
      // Ordinary General-tier default for product_assist — untouched by the ceiling.
      expect(result.source).not.toBe("Group Access Restriction");
    }
  });

  it("an empty allow-list (fail-closed: mapped to a group owner who hasn't enabled anything yet) blocks every General-applicable restrictable feature for a General caller, and leaves every other feature GROUP_RESTRICTABLE_FEATURES now also admits (Admin/Platform-Admin-only ones, since it's a union across tiers as of 2026-09c) completely untouched", () => {
    for (const featureId of GROUP_RESTRICTABLE_FEATURES) {
      const result = resolveAccess({
        featureId,
        tier: "General",
        featureDefaults: DEFAULT_FEATURE_PERMISSIONS,
        overrides: NO_OVERRIDES,
        grants: NO_GRANTS,
        accessRules: NO_RULES,
        caller,
        groupAllowedFeatureIds: [],
      });
      if (isFeatureGroupRestrictableForTier(featureId, "General")) {
        expect(result).toEqual({ level: "None", source: "Group Access Restriction" });
      } else {
        // e.g. "plan_scope", "audit" — Admin/Platform-Admin-only features
        // that GROUP_RESTRICTABLE_FEATURES now also contains (2026-09c) but
        // that a General-tier group's checklist could never have offered in
        // the first place; a General-tier caller's empty allow-list must
        // never reach these. Regression coverage for the exact bug the
        // tier-aware isFeatureGroupRestrictableForTier() gate (rather than a
        // flat Set check) prevents — see its own doc comment.
        expect(result.source).not.toBe("Group Access Restriction");
      }
    }
  });

  it("a non-empty allow-list gives the listed features COMPLETE (Editor) access while every other General-applicable restrictable feature stays blocked — and Admin/Platform-Admin-only features are left alone entirely", () => {
    const allowed = ["coverage_projection", "porting_assist", "qa_dashboard", "resources"];
    for (const featureId of GROUP_RESTRICTABLE_FEATURES) {
      const result = resolveAccess({
        featureId,
        tier: "General",
        featureDefaults: DEFAULT_FEATURE_PERMISSIONS,
        overrides: NO_OVERRIDES,
        grants: NO_GRANTS,
        accessRules: NO_RULES,
        caller,
        groupAllowedFeatureIds: allowed,
      });
      if (!isFeatureGroupRestrictableForTier(featureId, "General")) {
        expect(result.source).not.toBe("Group Access Restriction");
        continue;
      }
      if (allowed.includes(featureId)) {
        // Complete access — "Editor" — regardless of the feature's own
        // generalAccess default (several of these, e.g. porting_assist,
        // coverage_projection, resources, qa_dashboard, default to
        // "Viewer" for ordinary General-tier users).
        expect(result).toEqual({ level: "Editor", source: "Group Access Restriction" });
      } else {
        expect(result).toEqual({ level: "None", source: "Group Access Restriction" });
      }
    }
  });

  it("a granted feature resolves to Editor even when the feature's own generalAccess default is Viewer", () => {
    for (const featureId of ["porting_assist", "coverage_projection", "specific_illness_check", "advisory_zone", "announcement_archive", "resources", "qa_dashboard", "team_tracker"]) {
      const ordinary = resolveAccess({ featureId, tier: "General", featureDefaults: DEFAULT_FEATURE_PERMISSIONS, overrides: NO_OVERRIDES, grants: NO_GRANTS, accessRules: NO_RULES, caller });
      expect(ordinary.level).toBe("Viewer"); // sanity-check the premise: these default to Viewer
      const result = resolveAccess({
        featureId,
        tier: "General",
        featureDefaults: DEFAULT_FEATURE_PERMISSIONS,
        overrides: NO_OVERRIDES,
        grants: NO_GRANTS,
        accessRules: NO_RULES,
        caller,
        groupAllowedFeatureIds: [featureId],
      });
      expect(result).toEqual({ level: "Editor", source: "Group Access Restriction" });
    }
  });

  it("Access Rules and Custom Grants are short-circuited (not additionally consulted) once Group Access Restriction has settled the outcome", () => {
    const rules: AccessRuleLike[] = [{ resourceKey: "porting_assist", name: "Extra rule", active: true, orgTeamId: 1, departmentId: null, roleId: null, productTag: null, grantedLevel: "Editor" }];
    const grantedResult = resolveAccess({
      featureId: "porting_assist",
      tier: "General",
      featureDefaults: DEFAULT_FEATURE_PERMISSIONS,
      overrides: NO_OVERRIDES,
      grants: NO_GRANTS,
      accessRules: rules,
      caller: { orgTeamId: 1, departmentId: null, roleId: null, tags: [] },
      groupAllowedFeatureIds: ["porting_assist"],
    });
    // Already at the ceiling — a matching rule can't raise it further, and
    // the source stays "Group Access Restriction", not the rule's.
    expect(grantedResult).toEqual({ level: "Editor", source: "Group Access Restriction" });

    const notGrantedResult = resolveAccess({
      featureId: "porting_assist",
      tier: "General",
      featureDefaults: DEFAULT_FEATURE_PERMISSIONS,
      overrides: NO_OVERRIDES,
      grants: NO_GRANTS,
      accessRules: rules,
      caller: { orgTeamId: 1, departmentId: null, roleId: null, tags: [] },
      groupAllowedFeatureIds: [],
    });
    // Not granted — stays "None" even though a matching Access Rule exists,
    // since the group ceiling short-circuits before rules are consulted.
    expect(notGrantedResult).toEqual({ level: "None", source: "Group Access Restriction" });
  });

  it("Developer is permanently, structurally exempt — never restricted, even with an empty allow-list explicitly passed in (2026-09, Group Tier: superseded the old 'General only' framing below, but Developer's exemption is unconditional either way)", () => {
    for (const featureId of GROUP_RESTRICTABLE_FEATURES) {
      const result = resolveAccess({
        featureId,
        tier: "Developer",
        featureDefaults: DEFAULT_FEATURE_PERMISSIONS,
        overrides: NO_OVERRIDES,
        grants: NO_GRANTS,
        accessRules: NO_RULES,
        caller,
        groupAllowedFeatureIds: [],
      });
      expect(result.source).not.toBe("Group Access Restriction");
    }
  });

  // Admin and Platform Admin used to be unconditionally exempt here too
  // (this test's old title/body, through 2026-09), back when the gate was
  // hardcoded to `tier === "General"`. Group Tier (migration 0082)
  // deliberately supersedes that: see the "Group Tier generalization"
  // describe block below for full coverage of the new, intended behavior
  // (a group can now target Admin or Platform Admin, and Access Rules/
  // Custom Grants stay short-circuited for them too, exactly as they
  // already were for General).

  it("features outside GROUP_RESTRICTABLE_FEATURES are never affected, regardless of the allow-list", () => {
    for (const groupAllowedFeatureIds of [[], ["product_assist"]]) {
      const result = resolveAccess({
        featureId: "audit",
        tier: "General",
        featureDefaults: DEFAULT_FEATURE_PERMISSIONS,
        overrides: NO_OVERRIDES,
        grants: NO_GRANTS,
        accessRules: NO_RULES,
        caller,
        groupAllowedFeatureIds,
      });
      expect(result.source).not.toBe("Group Access Restriction");
    }
  });
});

describe("Group Access Restriction — Group Tier generalization (2026-09, migration 0082)", () => {
  // Group Tier lets a relationship_groups row target which TIER of member
  // its usedForGroupAccess ceiling restricts (General/Admin/Platform Admin,
  // default General) instead of always being General-only — see schema.ts's
  // comment on `relationshipGroups.groupTier` and evaluateAccess.ts's
  // `getGroupAllowedFeatureIds` for the full semantics. resolveAccess()
  // itself is DB-free and tier-agnostic about WHICH groups matched — by the
  // time `groupAllowedFeatureIds` reaches this function it's already been
  // computed for the specific tier in question by getGroupAllowedFeatureIds
  // (see evaluateAccess.test.ts for coverage of THAT tier-matching logic:
  // multiple groups, disabled groups, owner tier vs. group tier, etc. — all
  // DB-backed concerns this pure module doesn't have visibility into). What
  // this describe block proves is narrower and specific to this module: the
  // gate itself must now apply for General OR Admin OR Platform Admin
  // (CASE 1/2/3), must remain permanently inert for Developer no matter what
  // (CASE 4's structural half), and existing precedence (Access Rules/
  // Custom Grants short-circuited, tier default untouched when unaffected)
  // must hold for all three tiers, not just General (CASE 8, generalized).
  const caller = { orgTeamId: null, departmentId: null, roleId: null, tags: [] };

  it("CASE 1/10 — General tier: unchanged, byte-for-byte, from before Group Tier existed (default groupTier, backward compatibility)", () => {
    const result = resolveAccess({
      featureId: "porting_assist",
      tier: "General",
      featureDefaults: DEFAULT_FEATURE_PERMISSIONS,
      overrides: NO_OVERRIDES,
      grants: NO_GRANTS,
      accessRules: NO_RULES,
      caller,
      groupAllowedFeatureIds: ["porting_assist"],
    });
    expect(result).toEqual({ level: "Editor", source: "Group Access Restriction" });
  });

  it("CASE 2 — Admin tier: a group whose groupTier is \"Admin\" can now restrict an Admin caller exactly like General used to be the only tier this ever applied to", () => {
    for (const featureId of GROUP_RESTRICTABLE_FEATURES) {
      const blocked = resolveAccess({
        featureId,
        tier: "Admin",
        featureDefaults: DEFAULT_FEATURE_PERMISSIONS,
        overrides: NO_OVERRIDES,
        grants: NO_GRANTS,
        accessRules: NO_RULES,
        caller,
        groupAllowedFeatureIds: [],
      });
      if (isFeatureGroupRestrictableForTier(featureId, "Admin")) {
        expect(blocked).toEqual({ level: "None", source: "Group Access Restriction" });
      } else {
        // e.g. "smoke_test"/"owner_controls"/"clear_activity"/
        // "product_assist_quota" — Platform-Admin-only (adminAccess:
        // "None") — an Admin-tier group's empty allow-list must never
        // reach these.
        expect(blocked.source).not.toBe("Group Access Restriction");
      }
    }
    const granted = resolveAccess({
      featureId: "qa_dashboard",
      tier: "Admin",
      featureDefaults: DEFAULT_FEATURE_PERMISSIONS,
      overrides: NO_OVERRIDES,
      grants: NO_GRANTS,
      accessRules: NO_RULES,
      caller,
      groupAllowedFeatureIds: ["qa_dashboard"],
    });
    expect(granted).toEqual({ level: "Editor", source: "Group Access Restriction" });
  });

  it("CASE 3 — Platform Admin tier: same generalization applies (a group can target Platform Admin members too)", () => {
    const blocked = resolveAccess({
      featureId: "team_tracker",
      tier: "Platform Admin",
      featureDefaults: DEFAULT_FEATURE_PERMISSIONS,
      overrides: NO_OVERRIDES,
      grants: NO_GRANTS,
      accessRules: NO_RULES,
      caller,
      groupAllowedFeatureIds: [],
    });
    expect(blocked).toEqual({ level: "None", source: "Group Access Restriction" });

    const granted = resolveAccess({
      featureId: "team_tracker",
      tier: "Platform Admin",
      featureDefaults: DEFAULT_FEATURE_PERMISSIONS,
      overrides: NO_OVERRIDES,
      grants: NO_GRANTS,
      accessRules: NO_RULES,
      caller,
      groupAllowedFeatureIds: ["team_tracker"],
    });
    expect(granted).toEqual({ level: "Editor", source: "Group Access Restriction" });
  });

  it("CASE 4 — Developer stays permanently exempt no matter what is passed in, unlike General/Admin/Platform Admin — the one tier this gate can never apply to", () => {
    // Note the asymmetry with General/Admin/Platform Admin just above: for
    // those three, a non-null groupAllowedFeatureIds DOES trigger the gate.
    // For Developer it never does, regardless — this is what makes it safe
    // for evaluateAccess.ts to skip computing groupAllowedFeatureIds for
    // Developer entirely as a pure cost optimization (see its own comment)
    // rather than a correctness requirement: even if it were computed and
    // passed in anyway, this function still ignores it for Developer.
    for (const featureId of GROUP_RESTRICTABLE_FEATURES) {
      const result = resolveAccess({
        featureId,
        tier: "Developer",
        featureDefaults: DEFAULT_FEATURE_PERMISSIONS,
        overrides: NO_OVERRIDES,
        grants: NO_GRANTS,
        accessRules: NO_RULES,
        caller,
        groupAllowedFeatureIds: [],
      });
      expect(result.source).not.toBe("Group Access Restriction");
      expect(result.level).toBe("Editor"); // Developer's own unconditional bypass, unaffected.
    }
  });

  it("CASE 8 — an Admin/Platform Admin caller's Access Rules and Custom Grants are short-circuited once Group Access Restriction has settled the outcome, same as General already was", () => {
    for (const tier of ["Admin", "Platform Admin"] as const) {
      const rules: AccessRuleLike[] = [{ resourceKey: "porting_assist", name: "Extra rule", active: true, orgTeamId: 1, departmentId: null, roleId: null, productTag: null, grantedLevel: "Editor" }];
      const grants: CustomGrantLike[] = [{ active: true, grantType: "feature_access", targetId: "porting_assist", level: "Editor" }];

      const notGranted = resolveAccess({
        featureId: "porting_assist",
        tier,
        featureDefaults: DEFAULT_FEATURE_PERMISSIONS,
        overrides: NO_OVERRIDES,
        grants,
        accessRules: rules,
        caller: { orgTeamId: 1, departmentId: null, roleId: null, tags: [] },
        groupAllowedFeatureIds: [],
      });
      // Not granted by the group -- stays "None" even though a matching
      // Access Rule AND an active Custom Grant both exist, since the group
      // ceiling short-circuits before either is consulted.
      expect(notGranted).toEqual({ level: "None", source: "Group Access Restriction" });
    }
  });
});

describe("Group Access Restriction — feature list follows Group Tier, not a fixed Advisor-Zone list (2026-09c)", () => {
  // Group Tier's actual purpose is "which tier's feature access am I
  // configuring?" — so an Admin- or Platform-Admin-tier group must be able
  // to restrict Admin-Zone features (Plan Management, Announcement
  // Manager, Knowledge Base, etc.), not just the original 11 Advisor-Zone
  // tools. See featurePermissions.ts's GROUP_RESTRICTABLE_FEATURES and
  // isFeatureGroupRestrictableForTier() doc comments for the full
  // reasoning; this describe block proves the resulting resolveAccess()
  // behavior directly.
  const caller = { orgTeamId: null, departmentId: null, roleId: null, tags: [] };

  it("an Admin-tier group can now grant an Admin-Zone feature (\"plan_scope\") complete access, exactly like an Advisor-Zone feature always could", () => {
    const ordinary = resolveAccess({ featureId: "plan_scope", tier: "Admin", featureDefaults: DEFAULT_FEATURE_PERMISSIONS, overrides: NO_OVERRIDES, grants: NO_GRANTS, accessRules: NO_RULES, caller });
    expect(ordinary).toEqual({ level: "Editor", source: "Default" }); // sanity-check the premise: Admin already gets Editor by default here

    const blocked = resolveAccess({
      featureId: "plan_scope",
      tier: "Admin",
      featureDefaults: DEFAULT_FEATURE_PERMISSIONS,
      overrides: NO_OVERRIDES,
      grants: NO_GRANTS,
      accessRules: NO_RULES,
      caller,
      groupAllowedFeatureIds: [], // group exists but hasn't checked "plan_scope"
    });
    expect(blocked).toEqual({ level: "None", source: "Group Access Restriction" });

    const granted = resolveAccess({
      featureId: "plan_scope",
      tier: "Admin",
      featureDefaults: DEFAULT_FEATURE_PERMISSIONS,
      overrides: NO_OVERRIDES,
      grants: NO_GRANTS,
      accessRules: NO_RULES,
      caller,
      groupAllowedFeatureIds: ["plan_scope"],
    });
    expect(granted).toEqual({ level: "Editor", source: "Group Access Restriction" });
  });

  it("a General-tier group can never reach an Admin-Zone-only feature (\"audit\"), even with an explicit allow-list naming it — the gate is tier-aware, not a flat Set check", () => {
    const result = resolveAccess({
      featureId: "audit",
      tier: "General",
      featureDefaults: DEFAULT_FEATURE_PERMISSIONS,
      overrides: NO_OVERRIDES,
      grants: NO_GRANTS,
      accessRules: NO_RULES,
      caller,
      groupAllowedFeatureIds: ["audit"], // could only get here via a raw API call — the UI never offers "audit" for a General-tier group
    });
    // Falls through to General's own ordinary default (None) — the group's
    // allow-list is simply irrelevant to this featureId at General tier.
    expect(result).toEqual({ level: "None", source: "Default" });
  });

  it("Platform Admin-tier group access reaches virtually every feature, including ones Developer-tier-tagged by default (e.g. \"connections\")", () => {
    const granted = resolveAccess({
      featureId: "connections",
      tier: "Platform Admin",
      featureDefaults: DEFAULT_FEATURE_PERMISSIONS,
      overrides: NO_OVERRIDES,
      grants: NO_GRANTS,
      accessRules: NO_RULES,
      caller,
      groupAllowedFeatureIds: ["connections"],
    });
    expect(granted).toEqual({ level: "Editor", source: "Group Access Restriction" });
  });

  it("\"profile_access\" (Access Control Center) is NEVER reachable through Group Access Restriction, at any tier — the same self-escalation boundary Custom Grants already respect", () => {
    for (const tier of ["General", "Admin", "Platform Admin"] as const) {
      expect(isFeatureGroupRestrictableForTier("profile_access", tier)).toBe(false);
      const result = resolveAccess({
        featureId: "profile_access",
        tier,
        featureDefaults: DEFAULT_FEATURE_PERMISSIONS,
        overrides: NO_OVERRIDES,
        grants: NO_GRANTS,
        accessRules: NO_RULES,
        caller,
        groupAllowedFeatureIds: ["profile_access"], // even if a raw API call somehow saved this
      });
      expect(result.source).not.toBe("Group Access Restriction");
    }
  });

  it("isolation regression: an Admin caller's unrelated Custom Grant on a Platform-Admin-only feature (\"clear_activity\") survives untouched while they're subject to an active Admin-tier group restriction that never mentions it — the exact bug a flat (non-tier-aware) Set check would have caused", () => {
    const grants: CustomGrantLike[] = [{ active: true, grantType: "feature_access", targetId: "clear_activity", level: "Editor" }];
    const result = resolveAccess({
      featureId: "clear_activity",
      tier: "Admin",
      featureDefaults: DEFAULT_FEATURE_PERMISSIONS,
      overrides: NO_OVERRIDES,
      grants,
      accessRules: NO_RULES,
      caller,
      // This Admin-tier group restricts "plan_scope" only — "clear_activity"
      // isn't Admin-applicable (adminAccess: "None"), so it was never an
      // option on this group's checklist and must stay completely outside
      // this gate's reach.
      groupAllowedFeatureIds: ["plan_scope"],
    });
    expect(result).toEqual({ level: "Editor", source: "Custom Grant" });
  });
});

describe("resolveAccess — \"group_management\" (delegated Access Control Center permission, 2026-09)", () => {
  // Covers the validation scenarios from the Group Level Access spec
  // (section 40, scenarios A-F — G/H are about Phase B's group-ownership
  // scoping, not this featureId, and aren't exercised here). This proves
  // the SAME resolveAccess() used by both App.tsx's hasAccess() and
  // server.ts's requireFeatureAccess() — see this file's own header comment
  // on why requireFeatureAccess() itself can't be imported directly —
  // produces the intended effective permission for every tier/grant
  // combination, i.e. that Custom Grant support for this capability is
  // real end-to-end and not merely a frontend-only flag.

  it("Scenario A: Platform Admin is unaffected — Editor by default, no grant needed", () => {
    const result = resolveAccess({ featureId: "group_management", tier: "Platform Admin", featureDefaults: DEFAULT_FEATURE_PERMISSIONS, overrides: NO_OVERRIDES, grants: NO_GRANTS, accessRules: NO_RULES, caller: NO_CALLER });
    expect(result.level).toBe("Editor");
  });

  it("Scenario A: Developer is unaffected — Editor by default, no grant needed", () => {
    const result = resolveAccess({ featureId: "group_management", tier: "Developer", featureDefaults: DEFAULT_FEATURE_PERMISSIONS, overrides: NO_OVERRIDES, grants: NO_GRANTS, accessRules: NO_RULES, caller: NO_CALLER });
    expect(result.level).toBe("Editor");
  });

  it("Scenario B/F: an ordinary Admin with no grant gets Viewer only — can see the tabs but canEdit stays false (levelAllows(\"Viewer\",\"Editor\") is false), matching today's read-only behavior", () => {
    const result = resolveAccess({ featureId: "group_management", tier: "Admin", featureDefaults: DEFAULT_FEATURE_PERMISSIONS, overrides: NO_OVERRIDES, grants: NO_GRANTS, accessRules: NO_RULES, caller: NO_CALLER });
    expect(result).toEqual({ level: "Viewer", source: "Default" });
    expect(levelAllows(result.level, "Editor")).toBe(false);
  });

  it("Scenario E: a General-tier caller with no grant is denied entirely (None by default)", () => {
    const result = resolveAccess({ featureId: "group_management", tier: "General", featureDefaults: DEFAULT_FEATURE_PERMISSIONS, overrides: NO_OVERRIDES, grants: NO_GRANTS, accessRules: NO_RULES, caller: NO_CALLER });
    expect(result).toEqual({ level: "None", source: "Default" });
    expect(levelAllows(result.level, "Editor")).toBe(false);
  });

  it("Scenario C: an Admin with an explicit Custom Grant gets Editor — canManageGroups becomes true", () => {
    const grants: CustomGrantLike[] = [{ active: true, grantType: "feature_access", targetId: "group_management", level: "Editor" }];
    const result = resolveAccess({ featureId: "group_management", tier: "Admin", featureDefaults: DEFAULT_FEATURE_PERMISSIONS, overrides: NO_OVERRIDES, grants, accessRules: NO_RULES, caller: NO_CALLER });
    expect(result).toEqual({ level: "Editor", source: "Custom Grant" });
    expect(levelAllows(result.level, "Editor")).toBe(true);
  });

  it("Scenario D: a General-tier caller with an explicit Custom Grant is raised all the way to Editor — proves the grant works through the real evaluator, not a UI-only flag", () => {
    const grants: CustomGrantLike[] = [{ active: true, grantType: "feature_access", targetId: "group_management", level: "Editor" }];
    const result = resolveAccess({ featureId: "group_management", tier: "General", featureDefaults: DEFAULT_FEATURE_PERMISSIONS, overrides: NO_OVERRIDES, grants, accessRules: NO_RULES, caller: NO_CALLER });
    expect(result).toEqual({ level: "Editor", source: "Custom Grant" });
  });

  it("an inactive Custom Grant for group_management is ignored — a revoked grant can't leave residual access", () => {
    const grants: CustomGrantLike[] = [{ active: false, grantType: "feature_access", targetId: "group_management", level: "Editor" }];
    const result = resolveAccess({ featureId: "group_management", tier: "General", featureDefaults: DEFAULT_FEATURE_PERMISSIONS, overrides: NO_OVERRIDES, grants, accessRules: NO_RULES, caller: NO_CALLER });
    expect(result.level).toBe("None");
  });

  it("a grant for a different featureId never leaks Editor onto group_management (no cross-feature escalation)", () => {
    const grants: CustomGrantLike[] = [{ active: true, grantType: "feature_access", targetId: "profile_access", level: "Editor" }];
    const result = resolveAccess({ featureId: "group_management", tier: "General", featureDefaults: DEFAULT_FEATURE_PERMISSIONS, overrides: NO_OVERRIDES, grants, accessRules: NO_RULES, caller: NO_CALLER });
    expect(result.level).toBe("None");
  });

  it("a group_management grant never raises the caller's access to the unrelated, self-escalation-risk \"profile_access\" feature (the whole reason this is a separate, narrower featureId)", () => {
    const grants: CustomGrantLike[] = [{ active: true, grantType: "feature_access", targetId: "group_management", level: "Editor" }];
    const result = resolveAccess({ featureId: "profile_access", tier: "Admin", featureDefaults: DEFAULT_FEATURE_PERMISSIONS, overrides: NO_OVERRIDES, grants, accessRules: NO_RULES, caller: NO_CALLER });
    // Admin's own ordinary profile_access default (Viewer) — completely untouched.
    expect(result).toEqual({ level: "Viewer", source: "Default" });
  });
});

describe("small helpers", () => {
  it("levelAllows matches the shared ternary used everywhere else", () => {
    expect(levelAllows("Editor", "Viewer")).toBe(true);
    expect(levelAllows("Editor", "Editor")).toBe(true);
    expect(levelAllows("Viewer", "Viewer")).toBe(true);
    expect(levelAllows("Viewer", "Editor")).toBe(false);
    expect(levelAllows("None", "Viewer")).toBe(false);
    expect(levelAllows("None", "Editor")).toBe(false);
  });

  it("isDeveloperPowerTier is true for Developer and Platform Admin only", () => {
    expect(isDeveloperPowerTier("Developer")).toBe(true);
    expect(isDeveloperPowerTier("Platform Admin")).toBe(true);
    expect(isDeveloperPowerTier("Admin")).toBe(false);
    expect(isDeveloperPowerTier("General")).toBe(false);
  });
});

describe("Permission architecture — Permissions/Access Rules/Custom Grants are the real baseline (2026-09 fix)", () => {
  // These prove the acceptance criteria from the permission-architecture fix
  // directly against the shared evaluator — the same function App.tsx's
  // hasAccess(), server.ts's requireFeatureAccess(), and EffectiveAccessModal
  // all call. "qa_announcement_log" (Announcement Manager) and "resources"
  // (Workspace Resources) are used as the representative governed features
  // throughout, per the acceptance-test list. Neither is in
  // GROUP_RESTRICTABLE_FEATURES except "resources" — which is, but every
  // test below omits groupAllowedFeatureIds (the ordinary, non-restricted-
  // member case), so the Group Access Restriction gate never engages and
  // doesn't interfere with what's being proven here.
  const caller = { orgTeamId: 5, departmentId: 7, roleId: 9, tags: ["Health"] };

  it("1. None hides the feature entirely, regardless of tier", () => {
    const overrides: FeatureOverrideLike[] = [{ featureId: "qa_announcement_log", generalAccess: "None", adminAccess: "None", platformAdminAccess: null }];
    for (const tier of ["General", "Admin"] as const) {
      const result = resolveAccess({ featureId: "qa_announcement_log", tier, featureDefaults: DEFAULT_FEATURE_PERMISSIONS, overrides, grants: NO_GRANTS, accessRules: NO_RULES, caller: NO_CALLER });
      expect(result.level).toBe("None");
      expect(levelAllows(result.level, "Viewer")).toBe(false);
    }
  });

  it("2. General + Viewer (via override): normal use allowed, administrative action blocked", () => {
    const overrides: FeatureOverrideLike[] = [{ featureId: "qa_announcement_log", generalAccess: "Viewer", adminAccess: null, platformAdminAccess: null }];
    const result = resolveAccess({ featureId: "qa_announcement_log", tier: "General", featureDefaults: DEFAULT_FEATURE_PERMISSIONS, overrides, grants: NO_GRANTS, accessRules: NO_RULES, caller: NO_CALLER });
    expect(result).toEqual({ level: "Viewer", source: "Override" });
    expect(levelAllows(result.level, "Viewer")).toBe(true); // can view announcements
    expect(levelAllows(result.level, "Editor")).toBe(false); // cannot add/edit/delete
  });

  it("3. General + Editor (via override): both normal use and administrative actions are allowed — the baseline itself, no grant needed", () => {
    const overrides: FeatureOverrideLike[] = [{ featureId: "qa_announcement_log", generalAccess: "Editor", adminAccess: null, platformAdminAccess: null }];
    const result = resolveAccess({ featureId: "qa_announcement_log", tier: "General", featureDefaults: DEFAULT_FEATURE_PERMISSIONS, overrides, grants: NO_GRANTS, accessRules: NO_RULES, caller: NO_CALLER });
    expect(result).toEqual({ level: "Editor", source: "Override" });
    expect(levelAllows(result.level, "Editor")).toBe(true);
  });

  it("4. General + Viewer baseline + a Custom Grant of Editor for that one person: they get Editor — the tier ceiling never blocks the grant", () => {
    const overrides: FeatureOverrideLike[] = [{ featureId: "qa_announcement_log", generalAccess: "Viewer", adminAccess: null, platformAdminAccess: null }];
    const grants: CustomGrantLike[] = [{ active: true, grantType: "feature_access", targetId: "qa_announcement_log", level: "Editor" }];
    const grantedCaller = resolveAccess({ featureId: "qa_announcement_log", tier: "General", featureDefaults: DEFAULT_FEATURE_PERMISSIONS, overrides, grants, accessRules: NO_RULES, caller: NO_CALLER });
    expect(grantedCaller).toEqual({ level: "Editor", source: "Custom Grant" });

    // Someone else at the same tier, same feature, no grant — stays at the Viewer baseline.
    const ordinaryCaller = resolveAccess({ featureId: "qa_announcement_log", tier: "General", featureDefaults: DEFAULT_FEATURE_PERMISSIONS, overrides, grants: NO_GRANTS, accessRules: NO_RULES, caller: NO_CALLER });
    expect(ordinaryCaller).toEqual({ level: "Viewer", source: "Override" });
  });

  it("5. General + Viewer baseline + a matching Access Rule of Editor: matching users get Editor, non-matching users keep the Viewer baseline", () => {
    const overrides: FeatureOverrideLike[] = [{ featureId: "qa_announcement_log", generalAccess: "Viewer", adminAccess: null, platformAdminAccess: null }];
    const rules: AccessRuleLike[] = [
      { resourceKey: "qa_announcement_log", name: "QA department gets Editor", active: true, orgTeamId: null, departmentId: 7, roleId: null, productTag: null, grantedLevel: "Editor" },
    ];
    const matching = resolveAccess({ featureId: "qa_announcement_log", tier: "General", featureDefaults: DEFAULT_FEATURE_PERMISSIONS, overrides, grants: NO_GRANTS, accessRules: rules, caller });
    expect(matching).toEqual({ level: "Editor", source: 'Access Rule ("QA department gets Editor")' });

    const nonMatching = resolveAccess({ featureId: "qa_announcement_log", tier: "General", featureDefaults: DEFAULT_FEATURE_PERMISSIONS, overrides, grants: NO_GRANTS, accessRules: rules, caller: { ...caller, departmentId: 999 } });
    expect(nonMatching).toEqual({ level: "Viewer", source: "Override" });
  });

  it("7/8. Workspace Resources: Viewer covers normal use, Editor covers management — the shipped defaults, no override needed", () => {
    const generalDefault = resolveAccess({ featureId: "resources", tier: "General", featureDefaults: DEFAULT_FEATURE_PERMISSIONS, overrides: NO_OVERRIDES, grants: NO_GRANTS, accessRules: NO_RULES, caller: NO_CALLER });
    expect(generalDefault).toEqual({ level: "Viewer", source: "Default" });
    expect(levelAllows(generalDefault.level, "Viewer")).toBe(true); // can view/use resources
    expect(levelAllows(generalDefault.level, "Editor")).toBe(false); // cannot manage them

    const adminDefault = resolveAccess({ featureId: "resources", tier: "Admin", featureDefaults: DEFAULT_FEATURE_PERMISSIONS, overrides: NO_OVERRIDES, grants: NO_GRANTS, accessRules: NO_RULES, caller: NO_CALLER });
    expect(adminDefault).toEqual({ level: "Editor", source: "Default" });
    expect(levelAllows(adminDefault.level, "Editor")).toBe(true); // can manage them
  });

  it("8. Admin does not automatically mean Editor — Admin's level comes from Permissions (registry/override), never a hardcoded tier check", () => {
    // Force Admin down to Viewer on "resources" (normally Editor by
    // default) via an override, proving Admin's level is genuinely
    // registry/override-driven, not hardcoded to always be Editor.
    const overrides: FeatureOverrideLike[] = [{ featureId: "resources", generalAccess: null, adminAccess: "Viewer", platformAdminAccess: null }];
    const result = resolveAccess({ featureId: "resources", tier: "Admin", featureDefaults: DEFAULT_FEATURE_PERMISSIONS, overrides, grants: NO_GRANTS, accessRules: NO_RULES, caller: NO_CALLER });
    expect(result).toEqual({ level: "Viewer", source: "Override" });
    expect(levelAllows(result.level, "Editor")).toBe(false);
  });

  it("Declaration Assist / My Activity / Product Assist have no admin action of their own — corrected to Viewer by default for both General and Admin, matching normal-use-only tools like advisory_zone/porting_assist/coverage_projection", () => {
    for (const featureId of ["lookup", "my_activity", "product_assist"]) {
      const perm = DEFAULT_FEATURE_PERMISSIONS.find((p) => p.id === featureId);
      expect(perm, featureId).toBeDefined();
      expect(perm!.generalAccess, featureId).toBe("Viewer");
      expect(perm!.adminAccess, featureId).toBe("Viewer");
      const result = resolveAccess({ featureId, tier: "General", featureDefaults: DEFAULT_FEATURE_PERMISSIONS, overrides: NO_OVERRIDES, grants: NO_GRANTS, accessRules: NO_RULES, caller: NO_CALLER });
      expect(result.level, featureId).toBe("Viewer");
      expect(levelAllows(result.level, "Viewer"), featureId).toBe(true); // the complete normal workflow is a Viewer-level operation
    }
  });

  // Flagged Responses (2026-09 follow-up fix): GET /api/flagged-issues was
  // still requireAdminOrDeveloper (a hardcoded tier check) while its own
  // PUT (resolve/ignore) already gated on flagged_responses Editor — fixed
  // to flagged_responses Viewer so the two routes agree. These prove the
  // same 5-point acceptance list (None/Viewer/Editor/Custom Grant/Access
  // Rule) specifically for "flagged_responses", not just via the
  // qa_announcement_log/resources stand-ins above.
  it("Flagged Responses: shipped defaults are None for General, Editor for Admin", () => {
    const generalDefault = resolveAccess({ featureId: "flagged_responses", tier: "General", featureDefaults: DEFAULT_FEATURE_PERMISSIONS, overrides: NO_OVERRIDES, grants: NO_GRANTS, accessRules: NO_RULES, caller: NO_CALLER });
    expect(generalDefault).toEqual({ level: "None", source: "Default" });
    expect(levelAllows(generalDefault.level, "Viewer")).toBe(false); // None cannot view

    const adminDefault = resolveAccess({ featureId: "flagged_responses", tier: "Admin", featureDefaults: DEFAULT_FEATURE_PERMISSIONS, overrides: NO_OVERRIDES, grants: NO_GRANTS, accessRules: NO_RULES, caller: NO_CALLER });
    expect(adminDefault).toEqual({ level: "Editor", source: "Default" });
    expect(levelAllows(adminDefault.level, "Viewer")).toBe(true); // Editor can view flagged issues too
    expect(levelAllows(adminDefault.level, "Editor")).toBe(true); // Editor can resolve/ignore them
  });

  it("Flagged Responses: General + Viewer (via override) can view but not resolve/ignore", () => {
    const overrides: FeatureOverrideLike[] = [{ featureId: "flagged_responses", generalAccess: "Viewer", adminAccess: null, platformAdminAccess: null }];
    const result = resolveAccess({ featureId: "flagged_responses", tier: "General", featureDefaults: DEFAULT_FEATURE_PERMISSIONS, overrides, grants: NO_GRANTS, accessRules: NO_RULES, caller: NO_CALLER });
    expect(result).toEqual({ level: "Viewer", source: "Override" });
    expect(levelAllows(result.level, "Viewer")).toBe(true); // can view flagged issues
    expect(levelAllows(result.level, "Editor")).toBe(false); // cannot resolve/ignore
  });

  it("Flagged Responses: a Custom Grant of Viewer for one General user lets them view, while a peer at the same tier stays at None", () => {
    const grants: CustomGrantLike[] = [{ active: true, grantType: "feature_access", targetId: "flagged_responses", level: "Viewer" }];
    const grantedCaller = resolveAccess({ featureId: "flagged_responses", tier: "General", featureDefaults: DEFAULT_FEATURE_PERMISSIONS, overrides: NO_OVERRIDES, grants, accessRules: NO_RULES, caller: NO_CALLER });
    expect(grantedCaller).toEqual({ level: "Viewer", source: "Custom Grant" });

    const ordinaryCaller = resolveAccess({ featureId: "flagged_responses", tier: "General", featureDefaults: DEFAULT_FEATURE_PERMISSIONS, overrides: NO_OVERRIDES, grants: NO_GRANTS, accessRules: NO_RULES, caller: NO_CALLER });
    expect(ordinaryCaller).toEqual({ level: "None", source: "Default" });
  });

  it("Flagged Responses: a matching Access Rule of Viewer grants matching users view access; non-matching users stay at None", () => {
    const rules: AccessRuleLike[] = [
      { resourceKey: "flagged_responses", name: "QA department can view flagged responses", active: true, orgTeamId: null, departmentId: 7, roleId: null, productTag: null, grantedLevel: "Viewer" },
    ];
    const matching = resolveAccess({ featureId: "flagged_responses", tier: "General", featureDefaults: DEFAULT_FEATURE_PERMISSIONS, overrides: NO_OVERRIDES, grants: NO_GRANTS, accessRules: rules, caller });
    expect(matching).toEqual({ level: "Viewer", source: 'Access Rule ("QA department can view flagged responses")' });

    const nonMatching = resolveAccess({ featureId: "flagged_responses", tier: "General", featureDefaults: DEFAULT_FEATURE_PERMISSIONS, overrides: NO_OVERRIDES, grants: NO_GRANTS, accessRules: rules, caller: { ...caller, departmentId: 999 } });
    expect(nonMatching).toEqual({ level: "None", source: "Default" });
  });

  it("Flagged Responses: None (explicit override) hides it even for Admin", () => {
    const overrides: FeatureOverrideLike[] = [{ featureId: "flagged_responses", generalAccess: "None", adminAccess: "None", platformAdminAccess: null }];
    const result = resolveAccess({ featureId: "flagged_responses", tier: "Admin", featureDefaults: DEFAULT_FEATURE_PERMISSIONS, overrides, grants: NO_GRANTS, accessRules: NO_RULES, caller: NO_CALLER });
    expect(result).toEqual({ level: "None", source: "Override" });
    expect(levelAllows(result.level, "Viewer")).toBe(false);
  });

  it("Flagged Responses: Developer always gets Editor regardless of any override, grant, or rule — the Developer bypass is untouched by this fix", () => {
    const overrides: FeatureOverrideLike[] = [{ featureId: "flagged_responses", generalAccess: "None", adminAccess: "None", platformAdminAccess: "None" }];
    const result = resolveAccess({ featureId: "flagged_responses", tier: "Developer", featureDefaults: DEFAULT_FEATURE_PERMISSIONS, overrides, grants: NO_GRANTS, accessRules: NO_RULES, caller: NO_CALLER });
    expect(result.level).toBe("Editor");
  });
});
