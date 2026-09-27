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
 * Resolves the Group Access Restriction ceiling for `email` — null if
 * they aren't a restricted group member at all (not the subject of an
 * active relationship whose group has been admin-flagged for this),
 * otherwise the union of every tool enabled for the specific group(s) they
 * belong to (possibly empty — see schema.ts's `group_tool_access` comment
 * on why that's fail-closed by design, not a bug).
 *
 * PERMISSIONS ARE GROUP-LEVEL, NOT OWNER-LEVEL (migration 0081, 2026-09):
 * this resolves via each matching relationship row's relationshipGroupId,
 * not its ownerEmail — who currently owns a group has no bearing on what
 * that group's members can access. If this member belongs to two DIFFERENT
 * groups (even ones sharing the same owner), each group's access is looked
 * up and unioned independently; before migration 0081 this instead unioned
 * by owner, which meant an owner managing two groups couldn't give them
 * different access — that was the bug this fixes.
 *
 * "Which relationship group(s) count" is an admin-controlled flag
 * (relationship_groups.usedForGroupAccess, toggled from the Groups tab)
 * rather than a match on the group's name — see that column's own
 * comment in schema.ts for why: this table already carries Mentor/Guide
 * rows populated for nearly every advisor via the Advisor Directory sync
 * (for QA Dashboard/Team Tracker attribution), so matching on ANY
 * relationship group would fail-closed-block most of the advisor base the
 * moment this shipped. Multiple groups can be flagged at once — the result
 * is the union across all of them.
 *
 * A group also has to be `active` to count (2026-09 fix). Deactivating a
 * group ("disable" in the Groups tab) is meant to fully neutralize it —
 * before this fix, `active` was never checked here, so a disabled group
 * that was still `usedForGroupAccess` kept restricting its members exactly
 * as if it were enabled, which contradicted what "disable" plainly means
 * to an admin. Disabling now immediately drops those members back to their
 * normal tier default, same as if they'd never been mapped to a
 * restricted group at all — it does NOT touch the group's roster or its
 * `group_tool_access` rows, so re-enabling restores the exact same
 * restriction with no reconfiguration needed. Group Tier (below) doesn't
 * change any of this: a disabled group stays fully inert no matter what
 * its `groupTier` is set to.
 *
 * `callerTier` (2026-09, Group Tier / migration 0082) — a group also has to
 * have its `groupTier` equal to THIS caller's own tier to count. Each
 * group independently targets exactly one tier of member; a group whose
 * `groupTier` doesn't match this caller is simply not in `flaggedGroupIds`
 * for this call, same as if it weren't `usedForGroupAccess` at all — it may
 * still be actively restricting a DIFFERENT caller whose tier does match.
 * `groupTier` defaults to `"General"` (see schema.ts), so every group
 * created before this parameter existed keeps restricting General-tier
 * members exactly as it always did — zero behavior change for the default
 * case. `groupTier`'s own enum can never legally be `"Developer"` (see
 * schema.ts's comment on `groupTierEnum`), so passing `callerTier:
 * "Developer"` here can never match any group — Developer stays
 * permanently exempt from Group Access Restriction, exactly as before,
 * without needing a special case in this function. This does NOT change
 * the caller's own tier, and does NOT change the group owner's tier or
 * permissions — `groupTier` only ever selects which tier of MEMBER a
 * group's restriction ceiling applies to.
 *
 * Exported so GET /api/my-group-access (server.ts) can reuse it for the
 * signed-in member's own "what am I allowed" client bootstrap fetch.
 */
export async function getGroupAllowedFeatureIds(
  repos: Pick<Repositories, "relationshipGroups" | "userRelationships" | "groupToolAccess">,
  email: string,
  callerTier: Tier
): Promise<string[] | null> {
  const normalizedEmail = email.toLowerCase();
  const flaggedGroupIds = new Set(
    (await repos.relationshipGroups.list())
      .filter((g) => g.usedForGroupAccess && g.active && g.groupTier === callerTier)
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
  return Array.from(new Set(grants.map((g) => g.featureId)));
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
  // featureId isn't even one Group Access Restriction ever governs FOR
  // THIS CALLER'S TIER specifically, or the caller is Developer
  // (permanently exempt — no group's groupTier can ever legally be
  // "Developer", see getGroupAllowedFeatureIds's own doc comment) — see
  // resolveAccess()'s own check (isFeatureGroupRestrictableForTier(),
  // featurePermissions.ts), mirrored here purely as a query-cost
  // short-circuit, not a correctness requirement (passing null/undefined
  // would resolve identically either way, just with an avoidable DB round
  // trip for Developer/non-restrictable features). Tier-aware, not a flat
  // Set check (2026-09c, Group Tier widening) — e.g. a General-tier caller
  // never triggers the extra round trip for an Admin-Zone-only feature like
  // "plan_scope", since General tier could never be restricted on it
  // anyway. General/Admin/Platform Admin all reach this now (2026-09,
  // Group Tier) — it used to be General-only before a group could target
  // any tier.
  const groupAllowedFeatureIds =
    tier !== "Developer" && normalizedEmail && isFeatureGroupRestrictableForTier(featureId, tier)
      ? await getGroupAllowedFeatureIds(repos, normalizedEmail, tier)
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
    groupAllowedFeatureIds,
  });
}
