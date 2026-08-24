/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { eq } from "drizzle-orm";
import type { AnyDb } from "../client.js";
import { productAssistUserQuotaOverrides, type ProductAssistUserQuotaOverrideRow } from "../schema.js";

export interface UpsertUserQuotaOverrideEntry {
  customDailyCredits: number | null;
  customMonthlyCredits: number | null;
  limitsEnabled: boolean;
  unlimitedAccess: boolean;
  updatedBy: string;
}

/**
 * Data Access Layer for `product_assist_user_quota_overrides` — sparse, one
 * row per user with ANY override. No row for a user means "use their
 * computed eligibility-bucket default" (see productAssistQuota.ts). Reads
 * are Developer/Platform Admin-only at the route layer (this repo itself
 * places no restriction).
 */
export class ProductAssistUserQuotaOverridesRepository {
  constructor(private readonly db: AnyDb) {}

  async get(userEmail: string): Promise<ProductAssistUserQuotaOverrideRow | undefined> {
    const [row] = await this.db
      .select()
      .from(productAssistUserQuotaOverrides)
      .where(eq(productAssistUserQuotaOverrides.userEmail, userEmail.toLowerCase()));
    return row;
  }

  /** Every user with any override set — used to build the admin Users table
   * without an N+1 per-user lookup. */
  async list(): Promise<ProductAssistUserQuotaOverrideRow[]> {
    return this.db.select().from(productAssistUserQuotaOverrides);
  }

  async upsert(userEmail: string, entry: UpsertUserQuotaOverrideEntry): Promise<ProductAssistUserQuotaOverrideRow> {
    const email = userEmail.toLowerCase();
    const [row] = await this.db
      .insert(productAssistUserQuotaOverrides)
      .values({
        userEmail: email,
        customDailyCredits: entry.customDailyCredits,
        customMonthlyCredits: entry.customMonthlyCredits,
        limitsEnabled: entry.limitsEnabled,
        unlimitedAccess: entry.unlimitedAccess,
        updatedBy: entry.updatedBy,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: productAssistUserQuotaOverrides.userEmail,
        set: {
          customDailyCredits: entry.customDailyCredits,
          customMonthlyCredits: entry.customMonthlyCredits,
          limitsEnabled: entry.limitsEnabled,
          unlimitedAccess: entry.unlimitedAccess,
          updatedBy: entry.updatedBy,
          updatedAt: new Date(),
        },
      })
      .returning();
    return row;
  }

  /** Reverts a user back to their computed bucket default. */
  async remove(userEmail: string): Promise<void> {
    await this.db
      .delete(productAssistUserQuotaOverrides)
      .where(eq(productAssistUserQuotaOverrides.userEmail, userEmail.toLowerCase()));
  }
}
