/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { and, eq } from "drizzle-orm";
import type { AnyDb } from "../client.js";
import { planOverrides, type PlanOverrideRow, type NewPlanOverrideRow } from "../schema.js";

export type CreatePlanOverrideEntry = Omit<NewPlanOverrideRow, "id" | "createdAt">;

/**
 * Data Access Layer for `plan_overrides` — per-plan category overrides for
 * a specific PED (PED_REPOSITORY_DB_MIGRATION_DESIGN.md §1.5), replacing
 * the 4 hardcoded "0.4 PLAN-SPECIFIC OVERRIDES & INTERCEPTS" blocks in
 * engine.ts. One row per (planName, pedId) — enforced by a unique index in
 * the migration, so `upsert` is the normal write path.
 */
export class PlanOverridesRepository {
  constructor(private readonly db: AnyDb) {}

  async listByPlan(planName: string): Promise<PlanOverrideRow[]> {
    return this.db.select().from(planOverrides).where(eq(planOverrides.planName, planName));
  }

  async listByPed(pedId: number): Promise<PlanOverrideRow[]> {
    return this.db.select().from(planOverrides).where(eq(planOverrides.pedId, pedId));
  }

  /** Every override row — used to build the full in-memory runtime lookup
   * Map ((planName, pedId) -> categoryKey) at boot. */
  async listAll(): Promise<PlanOverrideRow[]> {
    return this.db.select().from(planOverrides);
  }

  async get(planName: string, pedId: number): Promise<PlanOverrideRow | undefined> {
    const [row] = await this.db
      .select()
      .from(planOverrides)
      .where(and(eq(planOverrides.planName, planName), eq(planOverrides.pedId, pedId)));
    return row;
  }

  async upsert(entry: CreatePlanOverrideEntry): Promise<PlanOverrideRow> {
    const [row] = await this.db
      .insert(planOverrides)
      .values(entry)
      .onConflictDoUpdate({
        target: [planOverrides.planName, planOverrides.pedId],
        set: { categoryKey: entry.categoryKey, reason: entry.reason, addedBy: entry.addedBy },
      })
      .returning();
    return row;
  }

  async delete(planName: string, pedId: number): Promise<void> {
    await this.db
      .delete(planOverrides)
      .where(and(eq(planOverrides.planName, planName), eq(planOverrides.pedId, pedId)));
  }
}
