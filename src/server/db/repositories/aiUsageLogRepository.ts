/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { and, gte, lt, sql } from "drizzle-orm";
import type { AnyDb } from "../client.js";
import { aiUsageLog, type NewAiUsageLogRow } from "../schema.js";

export type AiUsageSource = NewAiUsageLogRow["source"];

export type RecordAiUsageEntry = Omit<NewAiUsageLogRow, "id" | "createdAt" | "totalTokens"> & {
  totalTokens?: number;
};

export interface AiUsageBySourceModel {
  source: AiUsageSource;
  model: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  requestCount: number;
}

/**
 * Data Access Layer for `ai_usage_log` — see that table's schema.ts comment
 * for the full "visibility only, never enforcement" design. `record()` is
 * called fire-and-forget from every AI call site that opts in (Product
 * Assist, Declaration Assist matching, Specific Illness Check, Plan
 * Management's "Refine with AI") — a logging failure must never affect the
 * actual AI response.
 */
export class AiUsageLogRepository {
  constructor(private readonly db: AnyDb) {}

  async record(entry: RecordAiUsageEntry): Promise<void> {
    await this.db.insert(aiUsageLog).values({
      ...entry,
      userEmail: entry.userEmail.toLowerCase(),
      totalTokens: entry.totalTokens ?? entry.inputTokens + entry.outputTokens,
    });
  }

  /** Every IST calendar month ("YYYY-MM") that has at least one logged
   * AI call — feeds the Overview tab's month selector. */
  async distinctMonthsIST(): Promise<string[]> {
    const rows: { month: string }[] = await this.db
      .selectDistinct({
        month: sql<string>`to_char(${aiUsageLog.createdAt} AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM')`,
      })
      .from(aiUsageLog);
    return rows.map((r) => r.month);
  }

  /** Token/request totals grouped by (source, model) in a date range — the
   * building block for the Overview tab's cross-feature cost breakdown,
   * since cost must be computed per model (see ai_model_pricing) before it
   * can be summed per source. `to` is exclusive; omit it for "from -> now". */
  async companyTotalsByModel(from: Date, to?: Date): Promise<AiUsageBySourceModel[]> {
    const conditions = [gte(aiUsageLog.createdAt, from)];
    if (to) conditions.push(lt(aiUsageLog.createdAt, to));
    const rows: { source: AiUsageSource; model: string; inputTokens: string | null; outputTokens: string | null; totalTokens: string | null; requestCount: string | null }[] =
      await this.db
        .select({
          source: aiUsageLog.source,
          model: aiUsageLog.model,
          inputTokens: sql<string | null>`COALESCE(SUM(${aiUsageLog.inputTokens}), 0)`,
          outputTokens: sql<string | null>`COALESCE(SUM(${aiUsageLog.outputTokens}), 0)`,
          totalTokens: sql<string | null>`COALESCE(SUM(${aiUsageLog.totalTokens}), 0)`,
          requestCount: sql<string | null>`COUNT(*)`,
        })
        .from(aiUsageLog)
        .where(and(...conditions))
        .groupBy(aiUsageLog.source, aiUsageLog.model);
    return rows.map(r => ({
      source: r.source,
      model: r.model,
      inputTokens: Number(r.inputTokens ?? 0),
      outputTokens: Number(r.outputTokens ?? 0),
      totalTokens: Number(r.totalTokens ?? 0),
      requestCount: Number(r.requestCount ?? 0),
    }));
  }
}
