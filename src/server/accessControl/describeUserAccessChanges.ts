/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Access Control Center follow-up (docs/ACCESS_CONTROL_CENTER_PHASE_PLAN.md,
 * Phase 5) — durable audit logging for User Directory mutations. Every
 * server.ts route that touches tier/status/tags/departmentId/orgTeamId/
 * roleId writes a change_logs entry describing exactly what changed, using
 * catalog names (not raw ids) so the entry reads plainly. Name/TACT ID are
 * NOT access-control-relevant and are deliberately excluded from the diff —
 * PATCH /api/users/:email only logs when at least one of the fields this
 * function checks actually changed, so an edit that touches only name/TACT
 * ID produces no entry.
 *
 * Pulled into its own module (rather than living inline in server.ts, like
 * the Phase 1-4 evaluators before it) so it can be unit tested directly
 * without spinning up a DB — `catalogs` here only needs a `.get(id)` per
 * catalog, which the tests stub with plain objects instead of real
 * repositories.
 */
export interface UserAccessCatalogLookup {
  get(id: number): Promise<{ name: string } | undefined>;
}

export interface UserAccessCatalogs {
  departments: UserAccessCatalogLookup;
  orgTeams: UserAccessCatalogLookup;
  roles: UserAccessCatalogLookup;
}

export interface UserAccessAttributesBefore {
  tier: string;
  status: string;
  tags: string[];
  departmentId: number | null;
  orgTeamId: number | null;
  roleId: number | null;
}

export interface UserAccessAttributesAfter {
  tier?: string;
  status?: string;
  tags?: string[];
  departmentId?: number | null;
  orgTeamId?: number | null;
  roleId?: number | null;
}

export async function describeUserAccessChanges(
  before: UserAccessAttributesBefore,
  after: UserAccessAttributesAfter,
  catalogs: UserAccessCatalogs
): Promise<string[]> {
  const clauses: string[] = [];
  if (after.tier !== undefined && after.tier !== before.tier) clauses.push(`tier ${before.tier} → ${after.tier}`);
  if (after.status !== undefined && after.status !== before.status) clauses.push(`status ${before.status} → ${after.status}`);
  if (after.tags !== undefined) {
    const beforeTags = [...before.tags].sort().join(",");
    const afterTags = [...after.tags].sort().join(",");
    if (beforeTags !== afterTags) {
      clauses.push(`tags ${before.tags.length ? before.tags.join("/") : "none"} → ${after.tags.length ? after.tags.join("/") : "none"}`);
    }
  }
  const catalogDiff = async (label: string, beforeId: number | null, afterId: number | undefined, repo: UserAccessCatalogLookup) => {
    if (afterId === undefined || afterId === beforeId) return;
    const [oldName, newName] = await Promise.all([
      beforeId ? repo.get(beforeId).then((r) => r?.name ?? "Unknown") : Promise.resolve("Unassigned"),
      afterId ? repo.get(afterId).then((r) => r?.name ?? "Unknown") : Promise.resolve("Unassigned"),
    ]);
    clauses.push(`${label} ${oldName} → ${newName}`);
  };
  await Promise.all([
    catalogDiff("business unit", before.orgTeamId, after.orgTeamId, catalogs.orgTeams),
    catalogDiff("department", before.departmentId, after.departmentId, catalogs.departments),
    catalogDiff("role", before.roleId, after.roleId, catalogs.roles),
  ]);
  return clauses;
}
