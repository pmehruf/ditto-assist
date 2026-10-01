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
import { DEVELOPER_ONLY_FEATURES, isFeatureGroupGrantableForTier, isFeatureGroupRestrictableForTier } from "./constants/featurePermissions";

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
   * The caller's Group Access grants — 2026-09f redesign, at the user's
   * explicit request: "access must be determined by the feature selections
   * made during group configuration, irrespective of the user's tier...
   * Group configuration acts as an additional restriction, allowing only
   * the selected features to be accessible." Membership in an active,
   * access-configured group is now BOTH a raise (same as Access Rules and
   * Custom Grants — a checked item's `level` can only ever raise a member
   * above their tier default, never lower it) AND a restriction: within
   * that tier's restriction scope (see below), any feature NOT checked in
   * ANY of the caller's qualifying groups resolves to "None", overriding
   * whatever the tier default / Access Rules layer above computed.
   *
   * `null`/`undefined` means the caller belongs to no active, access-
   * configured group at all — this layer contributes nothing in either
   * direction, exactly as if Group Access didn't exist for them. A present
   * (possibly empty) object means the caller belongs to at least one such
   * group, so restriction is live: a key present means at least one of the
   * caller's groups has a grant on that featureId, value = the highest
   * `level` across every such group (the CALLER of this module —
   * evaluateAccess.ts / App.tsx / EffectiveAccessModal.tsx — computes that
   * union-max, same as it does for merging multiple matching Access Rules);
   * a featureId absent from the object means NO qualifying group has ever
   * checked it. Belonging to more than one qualifying group only ever
   * WIDENS what's accessible — each group's checked set is unioned in,
   * never intersected — the same additive spirit as the raise side.
   *
   * TIER SCOPE (both for the raise AND the restriction side): a
   * relationship group has no `groupTier` of its own — eligibility is
   * derived per-member, per-feature, from the member's OWN tier via
   * isFeatureGroupGrantableForTier() (featurePermissions.ts). For General
   * tier that's Advisor Zone only (Admin Zone is never reachable by General
   * regardless, checked or not, so restricting it would be a no-op either
   * way). For Admin tier it's BOTH Advisor Zone and Admin Zone — "Admin-
   * tier and above users will be restricted across both... based on the
   * group configuration," per the user's own example: an Admin-tier
   * trainer limited to just Group Management needs their WHOLE Admin Zone
   * surface narrowed, not just the Advisor Zone half.
   *
   * RESTRICTION NEVER APPLIES to Platform Admin or Developer — deliberately
   * exempted so a training/restriction group can never accidentally lock
   * out the app's highest-privilege operators (raising still works
   * identically for every tier, unchanged).
   *
   * RESTRICT_ONLY_FEATURES (2026-09g, featurePermissions.ts) — `profile_
   * access`, `profile_access_directory`, `profile_access_permissions`,
   * `qa_access_groups`, `master_advisors`, and `group_management` — are a
   * special case, at the user's explicit request ("No check box control for
   * access control center. What if the group is not supposed to have it?").
   * These can now be RESTRICTED (for Admin-tier members, same as any Admin
   * Zone feature) but can NEVER be RAISED — the self-escalation boundary
   * that excluded them from ADMIN_ZONE_FEATURES entirely still holds for
   * the raise direction: a group's configuration can never grant a member
   * MORE than their tier already gives them on one of these, only take it
   * away. `isFeatureGroupGrantableForTier()` answers "can this raise?" (false
   * for RESTRICT_ONLY_FEATURES, always); `isFeatureGroupRestrictableForTier()`
   * answers the wider "can this be blocked?" (true for RESTRICT_ONLY_
   * FEATURES at Admin/Platform Admin/Developer — Platform Admin/Developer
   * are still separately exempted from restriction itself, same as above).
   * `group_management` specifically stays reachable by default (Admin gets
   * Viewer unless the group unchecks it) so a restricted Admin-tier trainer
   * can still normally see the very Groups tab that might restrict them —
   * an admin deliberately wanting to hide even that can now do so by
   * unchecking it, but it's no longer hard-wired unreachable. resolveAccess()
   * re-derives all of this from the two functions above — the CALLER of
   * this module is NOT responsible for pre-filtering groupFeatureLevels by
   * tier eligibility (this module must see every one of the caller's group
   * grants, unfiltered, to correctly compute what's NOT present for the
   * restriction check).
   */
  groupFeatureLevels?: Record<string, AccessLevel> | null;
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
 * why. Precedence, in order: DEVELOPER_ONLY_FEATURES hard gate (a no-op as
 * of 2026-09, the Set is now empty for every feature, see
 * featurePermissions.ts) → optional Feature Visibility check → Developer
 * bypass → registry/override tier default → Access Rules → Group Access
 * (raise, then restrict — 2026-09f) → Custom Grants. Access Rules and
 * Custom Grants are pure raises, taking the max against what came before.
 * Group Access is different since 2026-09f: it still raises a checked
 * item's level the same way, but for General/Admin-tier members of an
 * access-configured group it ALSO restricts — any feature within that
 * tier's restriction scope that no qualifying group ever checked resolves
 * to "None", even overriding a level an Access Rule raised. Custom Grants
 * are evaluated last specifically so they can still punch through a
 * restriction as a deliberate per-individual exception (the "flexibility
 * valve" the Custom Grants tab is documented as). Security Tier is never an
 * output of this function, and a grant/rule/group can never widen what a
 * tier could reach in the first place — only Group Access can narrow it.
 */
export function resolveAccess(input: ResolveAccessInput): ResolveAccessResult {
  const { featureId, tier, featureDefaults, overrides, hiddenPages, grants, accessRules, caller, groupFeatureLevels } = input;

  if (DEVELOPER_ONLY_FEATURES.has(featureId)) {
    return isDeveloperPowerTier(tier)
      ? { level: "Editor", source: "Developer-only feature" }
      : { level: "None", source: "Developer-only feature" };
  }

  if (hiddenPages?.includes(featureId) && !isDeveloperPowerTier(tier)) {
    return { level: "None", source: "Hidden (Feature Visibility)" };
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

  // Group Access — 2026-09f redesign (extended 2026-09g for
  // RESTRICT_ONLY_FEATURES), at the user's explicit request: a checked item
  // still only ever RAISES a member above their tier default (never lowers
  // it), but membership in an access-configured group now ALSO RESTRICTS —
  // see groupFeatureLevels's own doc comment above for the full reasoning
  // and the worked "training group" / "admin trainer limited to Group
  // Management" examples that motivated this.
  //
  // `groupFeatureLevels` is null/undefined for a caller who belongs to no
  // active, access-configured group at all — this whole layer is a no-op
  // for them. Once it's a present object, raise-eligibility and restrict-
  // eligibility are checked SEPARATELY (2026-09g) rather than via one
  // shared gate, since RESTRICT_ONLY_FEATURES can be restricted without
  // ever being raisable — isFeatureGroupGrantableForTier() answers the
  // (narrower) raise question, isFeatureGroupRestrictableForTier() the
  // (wider) restrict question. Platform Admin/Developer are excluded from
  // restriction by name below — only raising ever applies to them.
  if (groupFeatureLevels != null) {
    const grantable = isFeatureGroupGrantableForTier(featureId, tier);
    const restrictable = isFeatureGroupRestrictableForTier(featureId, tier);
    if (grantable || restrictable) {
      const groupLevel = groupFeatureLevels[featureId];
      if (groupLevel && grantable) {
        // Raise — unchanged from 2026-09d, applies to every tier
        // isFeatureGroupGrantableForTier allows (General/Admin/Platform
        // Admin/Developer, whichever this featureId's zone permits). Never
        // reached for a RESTRICT_ONLY_FEATURES entry, since grantable is
        // always false there — checking one of those only ever exempts the
        // member from restriction below, it never raises.
        if (ACCESS_LEVEL_RANK[groupLevel] > ACCESS_LEVEL_RANK[level]) {
          level = groupLevel;
          source = "Group Access";
        }
      } else if (!groupLevel && restrictable && (tier === "General" || tier === "Admin")) {
        // Restriction — new in 2026-09f, widened in 2026-09g to also cover
        // RESTRICT_ONLY_FEATURES. Deliberately narrower than the raise
        // side: only General/Admin are ever restricted (Platform Admin/
        // Developer keep raising, but are never blocked — see this input's
        // own doc comment for why). In this tier's restriction scope, but
        // no qualifying group ever checked it — blocked, regardless of
        // what tier default/Access Rules computed above. Custom Grants
        // below can still override this.
        level = "None";
        source = "Group Access (restricted — not selected for this group)";
      }
      // groupLevel present but NOT grantable (a checked RESTRICT_ONLY_
      // FEATURES entry): neither branch runs — the member is exempted from
      // restriction, but level/source stay exactly what the tier default/
      // Access Rules layer above already computed. This is the intended
      // "checking it just means don't take it away" behavior.
    }
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
