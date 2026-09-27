/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Access Control Center Phase 4 (docs/ACCESS_CONTROL_CENTER_PHASE_PLAN.md) —
 * dependency-safe deletion for org_teams/departments/roles. Every FK onto
 * these three catalogs (users.org_team_id/department_id/role_id,
 * access_rules.org_team_id/department_id/role_id,
 * product_assist_eligibility_groups.org_team_id/department_id/role_id) is
 * `ON DELETE SET NULL`, so Postgres itself can never reject a delete or
 * leave a dangling reference. That's exactly the problem: a delete would
 * silently succeed while quietly widening an Access Rule's or a Product
 * Assist eligibility group's conditions (a null condition matches EVERYONE
 * on that dimension, not nobody) — a real functional/security regression
 * the database layer has no way to prevent on its own. This module is that
 * missing check, used by server.ts's three DELETE routes before they ever
 * call a repository's delete().
 */

import { createRepositories } from "../db/repositories/index.js";
import type { AnyDb } from "../db/client.js";

export type CatalogKind = "orgTeam" | "department" | "role";

export interface CatalogDependencySummary {
  users: number;
  activeAccessRules: number;
  inactiveAccessRules: number;
  eligibilityGroups: number;
}

/** True if this summary means "must block deletion outright, suggest
 * Disable instead" — an ACTIVE Access Rule or a Product Assist eligibility
 * group referencing this catalog entry. Both are live,
 * currently-consequential configuration; silently degrading either one is
 * worse than telling the caller no. */
export function blocksDeletion(summary: CatalogDependencySummary): boolean {
  return summary.activeAccessRules > 0 || summary.eligibilityGroups > 0;
}

/** True if this summary means "deletable, but only after the caller
 * explicitly confirms" — users assigned to it, and/or inactive Access
 * Rules referencing it (a rule an admin might reactivate later, at which
 * point its condition on this dimension would have silently vanished). */
export function needsConfirmation(summary: CatalogDependencySummary): boolean {
  return summary.users > 0 || summary.inactiveAccessRules > 0;
}

export async function countCatalogDependencies(db: AnyDb, kind: CatalogKind, id: number): Promise<CatalogDependencySummary> {
  const repos = createRepositories(db);
  const [allUsers, allRules, allEligibilityGroups] = await Promise.all([
    repos.users.list(),
    repos.accessRules.list(),
    repos.productAssistEligibilityGroups.list(),
  ]);

  const userMatches = (u: (typeof allUsers)[number]) =>
    kind === "orgTeam" ? u.orgTeamId === id : kind === "department" ? u.departmentId === id : u.roleId === id;
  const ruleMatches = (r: (typeof allRules)[number]) =>
    kind === "orgTeam" ? r.orgTeamId === id : kind === "department" ? r.departmentId === id : r.roleId === id;
  const groupMatches = (g: (typeof allEligibilityGroups)[number]) =>
    kind === "orgTeam" ? g.orgTeamId === id : kind === "department" ? g.departmentId === id : g.roleId === id;

  const matchingRules = allRules.filter(ruleMatches);
  return {
    users: allUsers.filter(userMatches).length,
    activeAccessRules: matchingRules.filter((r) => r.active).length,
    inactiveAccessRules: matchingRules.filter((r) => !r.active).length,
    eligibilityGroups: allEligibilityGroups.filter(groupMatches).length,
  };
}

/** Plain-English summary of why a delete is blocked or needs confirmation —
 * shared by all three DELETE routes so the wording stays consistent. */
export function describeDependencies(summary: CatalogDependencySummary): string {
  const parts: string[] = [];
  if (summary.users > 0) parts.push(`${summary.users} ${summary.users === 1 ? "user is" : "users are"} currently assigned to it`);
  if (summary.activeAccessRules > 0) parts.push(`${summary.activeAccessRules} active Access ${summary.activeAccessRules === 1 ? "Rule references" : "Rules reference"} it`);
  if (summary.inactiveAccessRules > 0) parts.push(`${summary.inactiveAccessRules} deactivated Access ${summary.inactiveAccessRules === 1 ? "Rule references" : "Rules reference"} it`);
  if (summary.eligibilityGroups > 0) parts.push(`${summary.eligibilityGroups} Product Assist eligibility ${summary.eligibilityGroups === 1 ? "group references" : "groups reference"} it`);
  return parts.join("; ");
}
