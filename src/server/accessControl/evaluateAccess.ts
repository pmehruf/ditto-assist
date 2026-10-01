/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Server-side DB-fetching wrapper around the pure `resolveAccess()`
 * evaluator (see src/accessRuleEvaluator.ts for the actual decision logic
 * and docs/ACCESS_CONTROL_CENTER_PHASE_PLAN.md for the phase this belongs
 * to). Fetches exactly what `requireFeatureAccess()` in server.ts fetches
 * (caller tier, feature_access_overrides, this caller's active
 * custom_access_grants) plus the caller's org attributes and every active
 * access_rules row for the requested resource, then hands it all to the
 * same pure function App.tsx's hasAccess() and EffectiveAccessModal also
 * call.
 *
 * Called by `requireFeatureAccess()` in server.ts (Phase 3 wired this up —
 * see evaluateAccess.test.ts for regression coverage proving it reproduces
 * requireFeatureAccess()'s pre-Phase-3 output with zero access_rules rows).
 *
 * Deliberately omits the `hiddenPages` check, exactly like
 * requireFeatureAccess() does — see accessRuleEvaluator.ts's header comment
 * on that asymmetry, which Phase 3 deliberately left as-is rather than
 * silently changing real server behavior.
 */

import type { AnyDb } from "../db/client.js";
import { createRepositories, type Repositories } from "../db/repositories/index.js";
import { DEFAULT_FEATURE_PERMISSIONS, isFeatureGroupRestrictableForTier } from "../../constants/featurePermissions.js";
import { resolveAccess, type ResolveAccessResult, type Tier } from "../../accessRuleEvaluator.js";

/**
 * Resolves `email`'s Group Access grants. Returns null if `email` isn't the
 * subject of any active relationship whose group is both `active` and
 * admin-flagged `usedForGroupAccess` — no groups apply, this layer
 * contributes nothing (no raise, no restriction — see resolveAccess()'s own
 * doc comment on groupFeatureLevels for the 2026-09f dual raise+restrict
 * behavior a non-null return now triggers there). Otherwise returns the
 * union of every (featureId -> level) grant across every qualifying group
 * this member belongs to, taking the higher level when more than one group
 * grants the same feature (e.g. one group grants Viewer on
 * "qa_announcement_log", another grants Editor — the member gets Editor).
 * A featureId genuinely absent from this map — not present in ANY
 * qualifying group's grants — is exactly what resolveAccess() now reads as
 * "restrict this to None" for General/Admin-tier callers, within that
 * tier's restriction scope; this function itself has no notion of
 * restriction, it just reports the raw union of what's been granted.
 *
 * NO MORE GROUP TIER (2026-09d, migration 0083): a group used to have its
 * own `groupTier` selecting which tier of member it could even apply to —
 * removed entirely, since a group can now hold members of mixed tiers at
 * once and per-feature eligibility is derived automatically from each
 * member's OWN tier (see isFeatureGroupGrantableForTier(),
 * featurePermissions.ts, and resolveAccess()'s own re-check of it). This
 * function itself no longer takes or checks a tier at all — every grant
 * row for a qualifying group is included in the returned map regardless of
 * whether the CALLING member's tier can actually use it; resolveAccess()
 * is what filters that per (featureId, tier) pair when it reads a single
 * key back out of this map. That split keeps this function a pure "what
 * has this member's groups granted" lookup, with all the tier-eligibility
 * logic living in one place (isFeatureGroupGrantableForTier()) rather than
 * being duplicated here.
 *
 * PERMISSIONS ARE GROUP-LEVEL, NOT OWNER-LEVEL (migration 0081, 2026-09):
 * this resolves via each matching relationship row's relationshipGroupId,
 * not its ownerEmail — who currently owns a group has no bearing on what
 * that group's members can access. If this member belongs to two DIFFERENT
 * groups (even ones sharing the same owner), each group's grants are
 * looked up and merged independently.
 *
 * "Which relationship group(s) count" is an admin-controlled flag
 * (relationship_groups.usedForGroupAccess, toggled from the Groups tab)
 * rather than a match on the group's name — see that column's own
 * comment in schema.ts for why: this table already carries Mentor/Guide
 * rows populated for nearly every advisor via the Advisor Directory sync
 * (for QA Dashboard/Team Tracker attribution), so matching on ANY
 * relationship group would sweep in most of the advisor base the moment
 * this shipped.
 *
 * A group also has to be `active` to count. Deactivating a group
 * ("disable" in the Groups tab) fully neutralizes it — its grants stop
 * counting toward this member's union immediately. If it was their ONLY
 * qualifying group, they fall back to pure tier default (plus any other
 * rule/grant) with no restriction at all, same as belonging to no groups.
 * If they still belong to at least one OTHER qualifying group, that
 * group's own checked set governs alone — restriction narrows back down to
 * just what it grants (2026-09f). Deactivating does NOT touch the group's
 * roster or its `group_tool_access` rows, so re-enabling restores the
 * exact same grants with no reconfiguration needed.
 *
 * Exported so GET /api/my-group-access (server.ts) can reuse it for the
 * signed-in member's own "what am I granted" client bootstrap fetch.
 */
export async function getGroupFeatureLevels(
  repos: Pick<Repositories, "relationshipGroups" | "userRelationships" | "groupToolAccess">,
  email: string
): Promise<Record<string, "Viewer" | "Editor"> | null> {
  const normalizedEmail = email.toLowerCase();
  const flaggedGroupIds = new Set(
    (await repos.relationshipGroups.list())
      .filter((g) => g.usedForGroupAccess && g.active)
      .map((g) => g.id)
  );
  if (flaggedGroupIds.size === 0) return null;

  const myRelationships = await repos.userRelationships.listForEmail(normalizedEmail);
  const myGroupIds = Array.from(
    new Set(
      myRelationships
        .filter((r) => flaggedGroupIds.has(r.relationshipGroupId) && r.subjectEmail.toLowerCase() === normalizedEmail)
        .map((r) => r.relationshipGroupId)
    )
  );
  if (myGroupIds.length === 0) return null;

  const grants = await repos.groupToolAccess.listForGroups(myGroupIds);
  if (grants.length === 0) return null;

  const levels: Record<string, "Viewer" | "Editor"> = {};
  for (const grant of grants) {
    // grant.level is typed off the DB column, which reuses feature_access_level
    // (so "None" is technically a legal TS value) — but a row here is never
    // actually "None" in practice (see schema.ts's group_tool_access comment:
    // a feature the admin doesn't want to grant simply has no row at all).
    // Guarded defensively rather than asserted, so a stray "None" row is
    // silently skipped instead of poisoning this map's value type.
    if (grant.level !== "Viewer" && grant.level !== "Editor") continue;
    if (levels[grant.featureId] === "Editor") continue;
    levels[grant.featureId] = grant.level;
  }
  return levels;
}

/**
 * Resolves what the user at `email` can do on `featureId`, and why —
 * mirrors requireFeatureAccess()'s DB reads exactly, via the shared
 * evaluator. An unknown/never-logged-in email resolves as "General" tier
 * with no org attributes, same as getCallerTier()'s existing fallback.
 */
export async function evaluateAccess(db: AnyDb, email: string | undefined, featureId: string): Promise<ResolveAccessResult> {
  const repos = createRepositories(db);
  const { users, featureAccess, customAccessGrants, accessRules } = repos;

  const normalizedEmail = email?.toLowerCase();
  const user = normalizedEmail ? await users.findByEmail(normalizedEmail) : undefined;
  const tier: Tier = user?.tier ?? "General";

  // Skip the extra relationship/grant round trips entirely when this
  // featureId isn't even one Group Access can ever apply to FOR THIS
  // CALLER'S TIER specifically, or the caller is Developer (permanently
  // exempt, same as Access Rules/Custom Grants never apply to Developer) —
  // see resolveAccess()'s own checks, mirrored here purely as a query-cost
  // short-circuit, not a correctness requirement (passing null/undefined
  // resolves identically either way, just with an avoidable DB round trip
  // for Developer/non-eligible-for-this-tier features). Tier-aware, not a
  // flat Set check — e.g. a General-tier caller never triggers the extra
  // round trip for an Admin-Zone-only feature like "plan_scope", since
  // General tier could never be granted OR restricted on it via Group
  // Access anyway.
  //
  // Uses isFeatureGroupRestrictableForTier() (featurePermissions.ts), NOT
  // the narrower isFeatureGroupGrantableForTier() — 2026-09g's
  // RESTRICT_ONLY_FEATURES (profile_access, group_management, etc.) can be
  // RESTRICTED for an Admin-tier caller even though they can never be
  // RAISED. Short-circuiting on the grantable-only check would have kept
  // skipping this fetch for those featureIds, silently missing a
  // restriction resolveAccess() should have applied. Restrictable is the
  // wider of the two checks (grantable implies restrictable), so this
  // single check is a valid short-circuit for both directions at once.
  const groupFeatureLevels =
    tier !== "Developer" && normalizedEmail && isFeatureGroupRestrictableForTier(featureId, tier)
      ? await getGroupFeatureLevels(repos, normalizedEmail)
      : null;

  const [overrides, activeRules, grants] = await Promise.all([
    featureAccess.list(),
    accessRules.listActiveForResource(featureId),
    normalizedEmail ? customAccessGrants.listActiveForEmail(normalizedEmail) : Promise.resolve([]),
  ]);

  return resolveAccess({
    featureId,
    tier,
    featureDefaults: DEFAULT_FEATURE_PERMISSIONS,
    overrides,
    grants,
    accessRules: activeRules,
    caller: {
      orgTeamId: user?.orgTeamId,
      departmentId: user?.departmentId,
      roleId: user?.roleId,
      tags: user?.tags,
    },
    groupFeatureLevels,
  });
}
