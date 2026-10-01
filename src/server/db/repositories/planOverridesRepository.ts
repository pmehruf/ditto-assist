/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { and, eq, inArray } from "drizzle-orm";
import type { AnyDb } from "../client.js";
import { planOverrides, pedRepository, pedAliases, type PlanOverrideRow, type NewPlanOverrideRow } from "../schema.js";
import { normalizeDictionaryKey } from "../../../engine.js";

export type CreatePlanOverrideEntry = Omit<NewPlanOverrideRow, "id" | "createdAt">;

export interface PlanOverrideDetailedRow extends PlanOverrideRow {
  pedName: string;
  pedCode: string;
  pedCategoryKey: string | null;
  aliases: string[];
}

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

  /** Override rows joined to their PED (name, code, default category) plus
   * every normalized alias of that PED — exactly what the engine's
   * applyPlanPedOverride and the Plan Management editor need. Two queries
   * total regardless of row count. Read fresh on every /api/match call so
   * an admin edit reaches every user/server instance immediately. */
  async listDetailed(planName?: string): Promise<PlanOverrideDetailedRow[]> {
    const rows = await this.db
      .select({
        override: planOverrides,
        pedName: pedRepository.canonicalName,
        pedCode: pedRepository.pedCode,
        pedCategoryKey: pedRepository.categoryKey,
      })
      .from(planOverrides)
      .innerJoin(pedRepository, eq(pedRepository.id, planOverrides.pedId))
      .where(planName ? eq(planOverrides.planName, planName) : undefined);
    if (rows.length === 0) return [];
    const pedIds = Array.from(new Set(rows.map((r) => r.override.pedId)));
    const aliasRows = await this.db
      .select({ pedId: pedAliases.pedId, normalizedAlias: pedAliases.normalizedAlias })
      .from(pedAliases)
      .where(inArray(pedAliases.pedId, pedIds));
    const aliasesByPed = new Map<number, string[]>();
    for (const a of aliasRows) {
      const list = aliasesByPed.get(a.pedId) || [];
      list.push(a.normalizedAlias);
      aliasesByPed.set(a.pedId, list);
    }
    return rows.map((r) => ({
      ...r.override,
      pedName: r.pedName,
      pedCode: r.pedCode,
      pedCategoryKey: r.pedCategoryKey,
      aliases: Array.from(new Set([normalizeDictionaryKey(r.pedName), ...(aliasesByPed.get(r.override.pedId) || [])])),
    }));
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
        set: { categoryKey: entry.categoryKey ?? null, targetQuestion: entry.targetQuestion ?? null, reason: entry.reason, addedBy: entry.addedBy, createdAt: new Date() },
      })
      .returning();
    return row;
  }

  async delete(planName: string, pedId: number): Promise<void> {
    await this.db
      .delete(planOverrides)
      .where(and(eq(planOverrides.planName, planName), eq(planOverrides.pedId, pedId)));
  }

  /** Carries every override over when a plan is renamed in Plan Management
   * (mirrors PlanRestrictionsRepository.renamePlan). */
  async renamePlan(oldPlanName: string, newPlanName: string): Promise<void> {
    await this.db.update(planOverrides).set({ planName: newPlanName }).where(eq(planOverrides.planName, oldPlanName));
  }
}
