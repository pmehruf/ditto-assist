/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { eq } from "drizzle-orm";
import type { AnyDb } from "../client.js";
import { productAssistQuotaSettings, type ProductAssistQuotaSettingsRow } from "../schema.js";

const SETTINGS_ID = "default";

export type UpdateQuotaSettingsEntry = Partial<
  Pick<
    ProductAssistQuotaSettingsRow,
    | "defaultDailyCredits"
    | "defaultMonthlyCredits"
    | "trialMonthlyCredits"
    | "tokensPerCredit"
    | "warningThresholdPercent"
    | "monthlyBudget"
    | "budgetWarningThresholdPercent"
    | "currency"
    | "modelName"
    | "inputPricePerMillionTokens"
    | "outputPricePerMillionTokens"
    | "eligibleDepartmentId"
    | "eligibleOrgTeamId"
    | "eligibleRoleId"
  >
>;

/**
 * Data Access Layer for `product_assist_quota_settings` — the single global
 * row backing the "AI Usage & Limits" Settings tab (default daily/monthly
 * credits, the trial allotment, token->credit conversion, warning
 * threshold, company budget, and cost-estimation pricing). Migration 0048
 * seeds the one row this table ever has; `get()` defensively re-seeds it if
 * that row is ever missing (e.g. a hand-edited test DB) so every caller can
 * treat the settings as always present.
 */
export class ProductAssistQuotaSettingsRepository {
  constructor(private readonly db: AnyDb) {}

  async get(): Promise<ProductAssistQuotaSettingsRow> {
    const [row] = await this.db
      .select()
      .from(productAssistQuotaSettings)
      .where(eq(productAssistQuotaSettings.id, SETTINGS_ID));
    if (row) return row;
    const [inserted] = await this.db
      .insert(productAssistQuotaSettings)
      .values({ id: SETTINGS_ID })
      .onConflictDoNothing()
      .returning();
    if (inserted) return inserted;
    // Extremely rare race: another caller inserted between our SELECT and
    // INSERT. Re-read rather than assume our insert won.
    const [retry] = await this.db
      .select()
      .from(productAssistQuotaSettings)
      .where(eq(productAssistQuotaSettings.id, SETTINGS_ID));
    return retry;
  }

  async update(patch: UpdateQuotaSettingsEntry, updatedBy: string): Promise<ProductAssistQuotaSettingsRow> {
    // Ensure the row exists before updating (same defensive guarantee as get()).
    await this.get();
    const [row] = await this.db
      .update(productAssistQuotaSettings)
      .set({ ...patch, updatedBy, updatedAt: new Date() })
      .where(eq(productAssistQuotaSettings.id, SETTINGS_ID))
      .returning();
    return row;
  }
}
