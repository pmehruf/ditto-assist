/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { asc, eq } from "drizzle-orm";
import type { AnyDb } from "../client.js";
import { planConfigs, type PlanConfigRow, type NewPlanConfigRow } from "../schema.js";

export type PlanQuestion = { text: string; tag: "Specific" | "Umbrella" | "Catch-all" };

export type CreatePlanConfigEntry = Omit<NewPlanConfigRow, "createdAt" | "updatedAt">;
export type UpdatePlanConfigEntry = Partial<Omit<NewPlanConfigRow, "planName" | "addedBy" | "createdAt" | "updatedAt">>;

/**
 * Data Access Layer for insurance plan declaration questionnaires. This is
 * the *live* source of truth /api/match reads from — the hardcoded
 * getPlanConfig() in types.ts is only consulted as a bootstrap seed for the
 * 4 original plans (see the seed migration and the merge in server.ts).
 * Read by everyone (needed for the plan picker + matching to work for every
 * tier); writes gated to Admin/Developer in the API route layer.
 */
export class PlanConfigsRepository {
  constructor(private readonly db: AnyDb) {}

  async list(): Promise<PlanConfigRow[]> {
    return this.db.select().from(planConfigs).orderBy(asc(planConfigs.planName));
  }

  async get(planName: string): Promise<PlanConfigRow | undefined> {
    const [row] = await this.db.select().from(planConfigs).where(eq(planConfigs.planName, planName));
    return row;
  }

  async upsert(entry: CreatePlanConfigEntry): Promise<PlanConfigRow> {
    const [row] = await this.db
      .insert(planConfigs)
      .values(entry)
      .onConflictDoUpdate({
        target: planConfigs.planName,
        set: { ...entry, updatedAt: new Date() },
      })
      .returning();
    return row;
  }

  async update(planName: string, entry: UpdatePlanConfigEntry): Promise<PlanConfigRow | undefined> {
    const [row] = await this.db
      .update(planConfigs)
      .set({ ...entry, updatedAt: new Date() })
      .where(eq(planConfigs.planName, planName))
      .returning();
    return row;
  }

  /**
   * Renames a plan in place — an actual UPDATE of the `plan_configs` primary
   * key (Postgres allows updating a PK column; no other table has a FK
   * reference to plan_configs.planName, so this is safe). Replaces the old
   * "POST a new row under the new name, then fire-and-forget DELETE the old
   * one" two-step the UI used to do, which could leave an orphaned duplicate
   * row (and therefore a stale, still-matchable "identity") if the DELETE
   * ever failed. Any other field in `entry` is updated in the same
   * statement. Throws (Postgres 23505) if `newPlanName` already belongs to
   * an ACTIVE (removed=false) plan.
   *
   * Reclaims a removed-plan tombstone at `newPlanName` first (2026-08-25
   * fix): Plan Management's Delete action writes `removed=true` rather than
   * DELETE-ing the row (see schema.ts's comment on `removed`), so that name
   * still occupies the `planName` primary-key slot. Without this, renaming
   * a different plan onto that exact name — e.g. deleting "Care Supreme",
   * then trying to rename "Care Supreme New" back to "Care Supreme" — hit a
   * spurious Postgres 23505 on the PK and surfaced as "A plan with that
   * name already exists," even though the name had been deleted. A
   * genuinely ACTIVE row at `newPlanName` is left untouched, so that case
   * still throws 23505 and the existing 409 handling in server.ts is
   * unchanged.
   */
  async rename(oldPlanName: string, newPlanName: string, entry: UpdatePlanConfigEntry): Promise<PlanConfigRow | undefined> {
    return this.db.transaction(async (tx) => {
      const [existing] = await tx.select().from(planConfigs).where(eq(planConfigs.planName, newPlanName));
      if (existing && existing.removed) {
        await tx.delete(planConfigs).where(eq(planConfigs.planName, newPlanName));
      }
      const [row] = await tx
        .update(planConfigs)
        .set({ ...entry, planName: newPlanName, updatedAt: new Date() })
        .where(eq(planConfigs.planName, oldPlanName))
        .returning();
      return row;
    });
  }

  async delete(planName: string): Promise<void> {
    await this.db.delete(planConfigs).where(eq(planConfigs.planName, planName));
  }
}
