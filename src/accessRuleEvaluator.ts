/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * ACCESS RULE EVALUATOR — Access Control Center Phase 1
 * (docs/ACCESS_CONTROL_CENTER_PHASE_PLAN.md).
 *
 * A single, pure, framework-free function that decides what level of access
 * (`None`/`Viewer`/`Editor`) a caller has on one resource (a featurePermissions
 * id). It exists to end the duplication between what used to be three
 * separate, independently-maintained copies of the same logic:
 *
 *   1. `hasAccess()` in App.tsx — client-side, gates the UI.
 *   2. `requireFeatureAccess()` in server.ts — server-side, the actual
 *      enforcement boundary.
 *   3. `resolveEffectiveAccess()` in EffectiveAccessModal.tsx — a
 *      display-only re-derivation for "why does this user have access".
 *
 * Phase 1 shipped this module inert, proven byte-for-byte identical to
 * `requireFeatureAccess()`'s then-current output via
 * accessRuleEvaluator.test.ts. Phase 3 (complete) is what actually pointed
 * all three of the above at this function — they now delegate here instead
 * of each maintaining their own resolution logic; see this module's own
 * `resolveAccess()` doc comment for the exact precedence it implements.
 *
 * WHAT'S NEW HERE (that neither original implementation had): Access Rules
 * — population-level grants keyed off a caller's Team/Department/Role/
 * Product Tag, on top of tier + feature_access_overrides + per-individual
 * custom_access_grants. See schema.ts's doc comment on `access_rules` for
 * the full reasoning.
 *
 * DELIBERATE SCOPE LIMIT: this module is pure and framework-free by design
 * — zero DB access, zero React — so it is safe to import from both the
 * client bundle and the server. Fetching the inputs (from the database on
 * the server, from already-loaded React state on the client) is each
 * caller's job; see src/server/accessControl/evaluateAccess.ts for the
 * server-side DB-fetching wrapper.
 *
 * KNOWN, DELIBERATE ASYMMETRY (not introduced by this file, just made
 * explicit here): `hasAccess()` additionally checks Feature Visibility
 * (`hiddenPages`) before falling through to tier/override resolution;
 * `requireFeatureAccess()` today does NOT check hiddenPages at all — hiding
 * a page only ever hid it from the UI, never blocked the API. This function
 * takes `hiddenPages` as an optional parameter (default: none hidden) so
 * either caller can reproduce their own current behavior exactly; Phase 3
 * decides whether to close that asymmetry, which this module doesn't do on
 * its own.
 */

import type { FeaturePermission } from "./types/permissions";
import { DEVELOPER_ONLY_FEATURES, isFeatureGroupRestrictableForTier } from "./constants/featurePermissions";

export type AccessLevel = "None" | "Viewer" | "Editor";
export type ActionType = "Viewer" | "Editor";
export type Tier = "General" | "Admin" | "Platform Admin" | "Developer";

export const ACCESS_LEVEL_RANK: Record<AccessLevel, number> = { None: 0, Viewer: 1, Editor: 2 };

/** True for both real Developer and Platform Admin — mirrors
 * `isDeveloperPower`/`isDeveloperPowerTier` in server.ts/App.tsx. */
export function isDeveloperPowerTier(tier: Tier): boolean {
  return tier === "Developer" || tier === "Platform Admin";
}

/** Whether an effective `level` permits the requested `actionType` — the
 * same `level === "Editor" ? true : level === "Viewer" ? actionType ===
 * "Viewer" : false` ternary duplicated at the end of both hasAccess() and
 * requireFeatureAccess() today. */
export function levelAllows(level: AccessLevel, actionType: ActionType): boolean {
  if (level === "Editor") return true;
  if (level === "Viewer") return actionType === "Viewer";
  return false;
}

/** The caller's organizational attributes — Access Control Center Phase 2
 * foundation (org_teams/departments/roles/tags), read off their UserRow/
 * UserProfile. Every field is nullable/optional: an unassigned caller
 * simply can't match a rule that requires a specific value for that
 * dimension. */
export interface CallerAttributes {
  orgTeamId?: number | null;
  departmentId?: number | null;
  roleId?: number | null;
  tags?: string[];
}

/** Minimal structural shapes this module actually reads — deliberately NOT
 * the full `FeatureAccessOverride`/`CustomAccessGrant`/`AccessRule` client
 * types from types/permissions.ts (those type their timestamp fields as
 * `string`, which the server's Drizzle row types don't satisfy — `Date`
 * instead). Keeping this module's own minimal contracts means both the
 * client (already-fetched React state) and the server (Drizzle rows via
 * evaluateAccess.ts) can pass their data straight through with no mapping
 * step, since both shapes are structural supersets of these. */
export interface FeatureOverrideLike {
  featureId: string;
  generalAccess: AccessLevel | null;
  adminAccess: AccessLevel | null;
  platformAdminAccess: AccessLevel | null;
}

export interface CustomGrantLike {
  active: boolean;
  grantType: string;
  targetId: string;
  level: AccessLevel | null;
}

export interface AccessRuleLike {
  resourceKey: string;
  name: string;
  active: boolean;
  orgTeamId: number | null;
  departmentId: number | null;
  roleId: number | null;
  productTag: string | null;
  grantedLevel: AccessLevel;
}

/** True if every non-null condition on `rule` matches `caller` — AND
 * semantics within one rule, per schema.ts's doc comment on `access_rules`.
 * A rule with every condition null matches everyone (a blanket grant) — a
 * valid, if unusual, configuration; Phase 2's admin UI is responsible for
 * making that obvious to whoever creates one, not this function. */
export function ruleMatchesCaller(rule: AccessRuleLike, caller: CallerAttributes): boolean {
  if (rule.orgTeamId != null && rule.orgTeamId !== caller.orgTeamId) return false;
  if (rule.departmentId != null && rule.departmentId !== caller.departmentId) return false;
  if (rule.roleId != null && rule.roleId !== caller.roleId) return false;
  if (rule.productTag != null && !(caller.tags ?? []).includes(rule.productTag)) return false;
  return true;
}

export interface ResolveAccessInput {
  featureId: string;
  tier: Tier;
  /** DEFAULT_FEATURE_PERMISSIONS — the shipped registry. */
  featureDefaults: FeaturePermission[];
  /** feature_access_overrides rows (any/all features — this function finds
   * the one for `featureId` itself). */
  overrides: FeatureOverrideLike[];
  /** Feature Visibility's hidden feature ids. Optional — omit to reproduce
   * requireFeatureAccess()'s current behavior (no hidden-page check); pass
   * the real list to reproduce hasAccess()'s current behavior. See this
   * module's header comment. */
  hiddenPages?: string[];
  /** This caller's OWN active custom_access_grants rows (any/all grant
   * types — this function filters to grantType "feature_access" itself). */
  grants: CustomGrantLike[];
  /** Every active access_rules row for `featureId` (already filtered by
   * resourceKey — or pass the full table, this function filters again
   * defensively). */
  accessRules: AccessRuleLike[];
  /** This caller's own Team/Department/Role/Product Tags. */
  caller: CallerAttributes;
  /**
   * Feature ids this caller's relationship group has enabled for its
   * members (Groups tab, `group_tool_access` table) — 2026-09.
   * `null`/`undefined` means the caller isn't a restricted group member at
   * all (they aren't the subject of an active relationship whose group has
   * `usedForGroupAccess` set, AT the tier that group's `groupTier` targets
   * — see below): no restriction, current behavior unchanged. An empty
   * array means a member whose group owner hasn't enabled anything yet —
   * every feature `isFeatureGroupRestrictableForTier()` says is
   * restrictable AT THIS CALLER'S OWN TIER resolves to "None" until the
   * owner's grant list is populated (fail-closed by design, see schema.ts's
   * comment on the table). Only ever affects a feature
   * `isFeatureGroupRestrictableForTier(featureId, tier)` returns true for —
   * every other feature is completely unaffected even if this is set (see
   * that function's own doc comment in featurePermissions.ts for why the
   * gate below is tier-aware rather than checking the flat
   * GROUP_RESTRICTABLE_FEATURES Set directly — that Set is now a union
   * across every tier, since Group Tier can target Admin/Platform Admin
   * too, not just a fixed "Advisor Zone" list). Two-way, not narrow-only:
   * an id in this list resolves straight to
   * "Editor" (complete access to that feature, regardless of its own
   * generalAccess/adminAccess default), an id NOT in this list resolves
   * straight to "None" — see resolveAccess()'s own comment.
   *
   * TIER SCOPE (2026-09, Group Tier / migration 0082): each relationship
   * group has its own `groupTier` (`General`/`Admin`/`Platform Admin`,
   * default `General`) selecting which tier of member its restriction
   * ceiling applies to — independent of the group's owner's own
   * tier/permissions. The CALLER of this module (evaluateAccess.ts /
   * App.tsx / EffectiveAccessModal.tsx) is responsible for only computing
   * this value from groups whose `groupTier` matches `input.tier`; by the
   * time it reaches this function it's already tier-scoped, which is why
   * the gate below no longer hardcodes a tier check itself. `groupTier` can
   * never legally be `"Developer"`, so a Developer caller can never have a
   * matching group — combined with the `tier !== "Developer"` guard below,
   * Developer stays permanently exempt from Group Access Restriction no
   * matter how any group is configured.
   */
  groupAllowedFeatureIds?: string[] | null;
}

export interface ResolveAccessResult {
  level: AccessLevel;
  /** Human-readable explanation of which single mechanism produced the
   * final (highest) level — for EffectiveAccessModal's "why" display
   * (Phase 3). Ties prefer the more specific/explicit source: a matching
   * Access Rule or Custom Grant over a plain tier Default. */
  source: string;
}

/**
 * Resolves what `input.tier`/`input.caller` can do on `input.featureId`, and
 * why. Mirrors requireFeatureAccess()'s exact resolution order
 * (DEVELOPER_ONLY_FEATURES hard gate — a no-op as of 2026-09, the Set is now
 * empty for every feature, see featurePermissions.ts — → optional Feature
 * Visibility check → Developer bypass → registry/override default → Access
 * Rules → Custom
 * Grants, taking the max of the last three), with Access Rules folded in as
 * a new, additive-only layer between the tier default and the per-
 * individual custom grant. Security Tier is never an output of this
 * function — Access Rules and Custom Grants can only raise a Viewer/Editor
 * level within what the tier's own ceiling already resolved to; neither can
 * grant a capability a tier doesn't have a path to, and neither ever
 * changes `tier` itself.
 */
export function resolveAccess(input: ResolveAccessInput): ResolveAccessResult {
  const { featureId, tier, featureDefaults, overrides, hiddenPages, grants, accessRules, caller, groupAllowedFeatureIds } = input;

  if (DEVELOPER_ONLY_FEATURES.has(featureId)) {
    return isDeveloperPowerTier(tier)
      ? { level: "Editor", source: "Developer-only feature" }
      : { level: "None", source: "Developer-only feature" };
  }

  if (hiddenPages?.includes(featureId) && !isDeveloperPowerTier(tier)) {
    return { level: "None", source: "Hidden (Feature Visibility)" };
  }

  // Group Access Restriction — 2026-09 (expanded 2026-09 from the original
  // 5 Advisor Workspace tools to also cover the Quality/Library group;
  // generalized 2026-09b, Group Tier, from General-only to whichever tier
  // a group's `groupTier` targets; widened again 2026-09c so the feature
  // SET ITSELF follows Group Tier instead of a fixed "Advisor Zone" list —
  // see isFeatureGroupRestrictableForTier()'s own doc comment in
  // featurePermissions.ts for the full reasoning, including why the check
  // below is tier-aware rather than a flat Set membership test). A hard,
  // two-way gate on any feature that tier can be restricted on, checked
  // before the Developer bypass immediately below would even be relevant:
  // a feature the caller's group owner has NOT enabled resolves straight to
  // "None", full stop; one they HAVE enabled resolves straight to "Editor"
  // — complete, unrestricted use of that feature, not whatever the tier's
  // own generalAccess/adminAccess default happens to be (several of these
  // — porting_assist, coverage_projection, specific_illness_check,
  // advisory_zone, announcement_archive, resources, qa_dashboard,
  // team_tracker — default to "Viewer" for ordinary General-tier users;
  // several Admin-Zone features similarly default to "Viewer" for Admin).
  // Both branches short-circuit before Access Rules/Custom Grants run:
  // there's nothing for either layer to usefully add once this has
  // already settled on the system's two extremes (None has nothing to
  // raise from without contradicting the group owner's restriction;
  // Editor is already the ceiling, so a rule/grant could never raise it
  // further anyway).
  //
  // `tier !== "Developer"` (rather than no tier check at all) is
  // deliberate, explicit belt-and-suspenders: `groupAllowedFeatureIds` is
  // already tier-scoped by whoever computed it (see its own doc comment),
  // so this condition is structurally redundant today — but Developer's
  // exemption from Group Access Restriction is a hard guarantee this
  // module's own callers rely on, not merely an emergent property of one
  // enum's possible values, so it stays enforced here too rather than
  // resting entirely on the caller getting the input right.
  if (tier !== "Developer" && groupAllowedFeatureIds != null && isFeatureGroupRestrictableForTier(featureId, tier)) {
    return groupAllowedFeatureIds.includes(featureId)
      ? { level: "Editor", source: "Group Access Restriction" }
      : { level: "None", source: "Group Access Restriction" };
  }

  if (tier === "Developer") return { level: "Editor", source: "Developer (full access)" };

  const perm = featureDefaults.find((p) => p.id === featureId);
  if (!perm) return { level: "Editor", source: "Not a governed feature" };

  const override = overrides.find((o) => o.featureId === featureId);

  let level: AccessLevel;
  let source: string;
  if (tier === "Platform Admin") {
    level = override?.platformAdminAccess ?? "Editor";
    source = override?.platformAdminAccess != null ? "Override" : "Default (Platform Admin)";
  } else {
    const overrideLevel = tier === "Admin" ? override?.adminAccess : override?.generalAccess;
    level = overrideLevel ?? (tier === "Admin" ? perm.adminAccess : perm.generalAccess);
    source = overrideLevel != null ? "Override" : "Default";
  }

  // Access Rules — new in Phase 1. Any active rule for this resource whose
  // non-null conditions all match the caller contributes its grantedLevel;
  // multiple matching rules are OR'd (take the max), never AND'd against
  // each other.
  let bestRule: AccessRuleLike | undefined;
  for (const rule of accessRules) {
    if (!rule.active || rule.resourceKey !== featureId) continue;
    if (!ruleMatchesCaller(rule, caller)) continue;
    if (!bestRule || ACCESS_LEVEL_RANK[rule.grantedLevel] > ACCESS_LEVEL_RANK[bestRule.grantedLevel]) {
      bestRule = rule;
    }
  }
  if (bestRule && ACCESS_LEVEL_RANK[bestRule.grantedLevel] > ACCESS_LEVEL_RANK[level]) {
    level = bestRule.grantedLevel;
    source = `Access Rule ("${bestRule.name}")`;
  }

  // Custom Access Grants — per-individual, max-of, grant-only (unchanged
  // from today's hasAccess()/requireFeatureAccess()).
  const grant = grants.find((g) => g.active && g.grantType === "feature_access" && g.targetId === featureId);
  if (grant?.level && ACCESS_LEVEL_RANK[grant.level] > ACCESS_LEVEL_RANK[level]) {
    level = grant.level;
    source = "Custom Grant";
  }

  return { level, source };
}
