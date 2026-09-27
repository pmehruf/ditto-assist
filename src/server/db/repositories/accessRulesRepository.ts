/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { asc, eq } from "drizzle-orm";
import type { AnyDb } from "../client.js";
import { accessRules, type AccessRuleRow } from "../schema.js";

export type AccessRuleLevel = "None" | "Viewer" | "Editor";

export interface CreateAccessRuleEntry {
  resourceKey: string;
  name: string;
  orgTeamId: number | null;
  departmentId: number | null;
  roleId: number | null;
  productTag: string | null;
  grantedLevel: AccessRuleLevel;
  createdBy: string;
}

export type UpdateAccessRuleEntry = Partial<
  Pick<AccessRuleRow, "name" | "active" | "orgTeamId" | "departmentId" | "roleId" | "productTag" | "grantedLevel">
>;

/**
 * Data Access Layer for `access_rules` — see schema.ts's doc comment on the
 * table for the full reasoning. Read by every signed-in user once Phase 3
 * wires evaluateAccess() into real enforcement (the evaluator needs every
 * active rule for a resource to decide who matches); writes gated to
 * Developer+Platform Admin in the API route layer, same posture as
 * org_teams/departments/roles.
 */
export class AccessRulesRepository {
  constructor(private readonly db: AnyDb) {}

  async list(): Promise<AccessRuleRow[]> {
    return this.db.select().from(accessRules).orderBy(asc(accessRules.resourceKey), asc(accessRules.name));
  }

  /** Every active rule for one resource — what evaluateAccess() actually
   * needs per call, rather than filtering the full table client-side each
   * time. */
  async listActiveForResource(resourceKey: string): Promise<AccessRuleRow[]> {
    const rows = await this.db.select().from(accessRules).where(eq(accessRules.resourceKey, resourceKey));
    return rows.filter((r) => r.active);
  }

  async get(id: number): Promise<AccessRuleRow | undefined> {
    const [row] = await this.db.select().from(accessRules).where(eq(accessRules.id, id));
    return row;
  }

  async create(entry: CreateAccessRuleEntry): Promise<AccessRuleRow> {
    const [row] = await this.db
      .insert(accessRules)
      .values({
        resourceKey: entry.resourceKey,
        name: entry.name,
        orgTeamId: entry.orgTeamId,
        departmentId: entry.departmentId,
        roleId: entry.roleId,
        productTag: entry.productTag,
        grantedLevel: entry.grantedLevel,
        createdBy: entry.createdBy,
      })
      .returning();
    return row;
  }

  /** Deactivate (not delete) is the only removal path for a rule —
   * deliberate, unlike departments/org_teams/roles which got a real delete
   * endpoint in Phase 4 (see schema.ts's `accessRules` comment for why).
   * `active: false` in the patch is how a rule is turned off. */
  async update(id: number, patch: UpdateAccessRuleEntry): Promise<AccessRuleRow | undefined> {
    const [row] = await this.db.update(accessRules).set(patch).where(eq(accessRules.id, id)).returning();
    return row;
  }
}
