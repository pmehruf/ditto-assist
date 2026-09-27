/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { asc } from "drizzle-orm";
import type { AnyDb } from "../client.js";
import { aiModelPricing, type AiModelPricingRow } from "../schema.js";

export interface UpsertModelPricingEntry {
  modelName: string;
  inputPricePerMillionTokens: number;
  outputPricePerMillionTokens: number;
  updatedBy: string;
}

export interface ModelPrice {
  inputPricePerMillionTokens: number;
  outputPricePerMillionTokens: number;
}

/**
 * Data Access Layer for `ai_model_pricing` — see that table's schema.ts
 * comment for why it exists separately from product_assist_quota_settings'
 * single model/price pair. Used exclusively by the cross-feature Overview
 * cost estimate (ai_usage_log); Product Assist's own budget tracking is
 * unaffected.
 */
export class AiModelPricingRepository {
  constructor(private readonly db: AnyDb) {}

  async list(): Promise<AiModelPricingRow[]> {
    return this.db.select().from(aiModelPricing).orderBy(asc(aiModelPricing.modelName));
  }

  /** Convenience form for cost computation — modelName -> its prices,
   * missing entries simply absent (caller treats an unknown model as
   * "no price configured" rather than assuming zero silently). */
  async getMap(): Promise<Map<string, ModelPrice>> {
    const rows = await this.list();
    return new Map(rows.map(r => [r.modelName, { inputPricePerMillionTokens: Number(r.inputPricePerMillionTokens), outputPricePerMillionTokens: Number(r.outputPricePerMillionTokens) }]));
  }

  async upsert(entry: UpsertModelPricingEntry): Promise<AiModelPricingRow> {
    const [row] = await this.db
      .insert(aiModelPricing)
      .values({
        modelName: entry.modelName,
        inputPricePerMillionTokens: entry.inputPricePerMillionTokens.toFixed(4),
        outputPricePerMillionTokens: entry.outputPricePerMillionTokens.toFixed(4),
        updatedBy: entry.updatedBy,
      })
      .onConflictDoUpdate({
        target: aiModelPricing.modelName,
        set: {
          inputPricePerMillionTokens: entry.inputPricePerMillionTokens.toFixed(4),
          outputPricePerMillionTokens: entry.outputPricePerMillionTokens.toFixed(4),
          updatedBy: entry.updatedBy,
          updatedAt: new Date(),
        },
      })
      .returning();
    return row;
  }
}
