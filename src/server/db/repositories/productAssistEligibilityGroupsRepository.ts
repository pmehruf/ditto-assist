/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { asc, eq } from "drizzle-orm";
import type { AnyDb } from "../client.js";
import { productAssistEligibilityGroups, type ProductAssistEligibilityGroupRow } from "../schema.js";

export interface CreateEligibilityGroupEntry {
  name: string;
  departmentId: number | null;
  orgTeamId: number | null;
  roleId: number | null;
  tag: string | null;
  dailyCredits: number | null;
  monthlyCredits: number | null;
  sortOrder?: number;
  createdBy: string;
}

export type UpdateEligibilityGroupEntry = Partial<
  Pick<CreateEligibilityGroupEntry, "name" | "departmentId" | "orgTeamId" | "roleId" | "tag" | "dailyCredits" | "monthlyCredits" | "sortOrder">
>;

/** Data Access Layer for `product_assist_eligibility_groups` — the ordered
 * list of admin-defined Product Assist eligibility groups that replaced the
 * single global Department/Team/Role rule (2026-09-07). See schema.ts's
 * doc comment for the full reasoning, and productAssistQuota.ts's
 * resolveMatchedGroups()/deriveGroupLimits() for how a user's matched
 * group(s) become their effective limits. Reads/writes are Developer/
 * Platform Admin-only at the route layer (this repo itself places no
 * restriction). */
export class ProductAssistEligibilityGroupsRepository {
  constructor(private readonly db: AnyDb) {}

  async list(): Promise<ProductAssistEligibilityGroupRow[]> {
    return this.db
      .select()
      .from(productAssistEligibilityGroups)
      .orderBy(asc(productAssistEligibilityGroups.sortOrder), asc(productAssistEligibilityGroups.id));
  }

  async get(id: number): Promise<ProductAssistEligibilityGroupRow | undefined> {
    const [row] = await this.db.select().from(productAssistEligibilityGroups).where(eq(productAssistEligibilityGroups.id, id));
    return row;
  }

  async create(entry: CreateEligibilityGroupEntry): Promise<ProductAssistEligibilityGroupRow> {
    const [row] = await this.db
      .insert(productAssistEligibilityGroups)
      .values({
        name: entry.name,
        departmentId: entry.departmentId,
        orgTeamId: entry.orgTeamId,
        roleId: entry.roleId,
        tag: entry.tag,
        dailyCredits: entry.dailyCredits,
        monthlyCredits: entry.monthlyCredits,
        sortOrder: entry.sortOrder ?? 0,
        createdBy: entry.createdBy,
      })
      .returning();
    return row;
  }

  async update(id: number, entry: UpdateEligibilityGroupEntry): Promise<ProductAssistEligibilityGroupRow | undefined> {
    const [row] = await this.db
      .update(productAssistEligibilityGroups)
      .set({ ...entry, updatedAt: new Date() })
      .where(eq(productAssistEligibilityGroups.id, id))
      .returning();
    return row;
  }

  /** Real deletion — unlike access_rules (deactivate-only), a group has no
   * dependent rows anywhere else, so there's nothing that could be left
   * dangling by removing it outright. */
  async delete(id: number): Promise<void> {
    await this.db.delete(productAssistEligibilityGroups).where(eq(productAssistEligibilityGroups.id, id));
  }
}
