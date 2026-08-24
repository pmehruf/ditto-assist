/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { and, asc, eq } from "drizzle-orm";
import type { AnyDb } from "../client.js";
import { planRestrictions, type PlanRestrictionRow, type NewPlanRestrictionRow } from "../schema.js";

export type CreatePlanRestrictionEntry = Omit<NewPlanRestrictionRow, "id" | "createdAt" | "updatedAt">;
export type UpdatePlanRestrictionEntry = Partial<
  Pick<NewPlanRestrictionRow, "categoryKey" | "mode" | "keywords" | "explanation" | "isActive" | "updatedBy">
>;

/** Data Access Layer for `plan_restrictions` — Plan-Specific Restrictions.
 * See schema.ts's doc comment on the table for the full design (the
 * deterministic, keyword-based replacement for the old hardcoded
 * requiresInsulinForDiabetes/excludePrediabetes/bypassBenignTumors flags). */
export class PlanRestrictionsRepository {
  constructor(private readonly db: AnyDb) {}

  /** All restrictions for one plan (Plan Management's restriction editor) —
   * includes inactive rows so the UI can show/toggle them, unlike
   * listActiveForPlan below. */
  async listForPlan(planName: string): Promise<PlanRestrictionRow[]> {
    return this.db
      .select()
      .from(planRestrictions)
      .where(eq(planRestrictions.planName, planName))
      .orderBy(asc(planRestrictions.categoryKey), asc(planRestrictions.id));
  }

  /** Only active restrictions for one plan — what engine.ts actually reads
   * at match time (see dbRowToPlanConfig's `restrictions` param). */
  async listActiveForPlan(planName: string): Promise<PlanRestrictionRow[]> {
    return this.db
      .select()
      .from(planRestrictions)
      .where(and(eq(planRestrictions.planName, planName), eq(planRestrictions.isActive, true)));
  }

  /** Every active restriction across every plan, in one query — used only
   * by GET /api/plan-configs to embed each plan's restrictions into the
   * list response the client merges into its own planConfigs (App.tsx),
   * so the Lookup page's client-side deterministic path (executeLookupAll)
   * sees the same live restriction data /api/match does server-side.
   * Grouping by planName is the caller's job (server.ts). */
  async listAllActive(): Promise<PlanRestrictionRow[]> {
    return this.db.select().from(planRestrictions).where(eq(planRestrictions.isActive, true));
  }

  async get(id: number): Promise<PlanRestrictionRow | undefined> {
    const [row] = await this.db.select().from(planRestrictions).where(eq(planRestrictions.id, id));
    return row;
  }

  async create(entry: CreatePlanRestrictionEntry): Promise<PlanRestrictionRow> {
    const [row] = await this.db.insert(planRestrictions).values(entry).returning();
    return row;
  }

  async update(id: number, entry: UpdatePlanRestrictionEntry): Promise<PlanRestrictionRow | undefined> {
    const [row] = await this.db
      .update(planRestrictions)
      .set({ ...entry, updatedAt: new Date() })
      .where(eq(planRestrictions.id, id))
      .returning();
    return row;
  }

  async delete(id: number): Promise<void> {
    await this.db.delete(planRestrictions).where(eq(planRestrictions.id, id));
  }

  /** Renames every restriction row tied to a plan — kept in sync with
   * PlanConfigsRepository.rename so a plan rename doesn't orphan its
   * restrictions (see server.ts's PUT /api/plan-configs/:planName rename
   * path). */
  async renamePlan(oldPlanName: string, newPlanName: string): Promise<void> {
    await this.db.update(planRestrictions).set({ planName: newPlanName, updatedAt: new Date() }).where(eq(planRestrictions.planName, oldPlanName));
  }
}
