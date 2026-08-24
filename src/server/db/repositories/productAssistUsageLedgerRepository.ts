/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { and, desc, eq, gte, lt, sql } from "drizzle-orm";
import type { AnyDb } from "../client.js";
import { productAssistUsageLedger, type ProductAssistUsageLedgerRow } from "../schema.js";

export interface RecordUsageEntry {
  userEmail: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  /** Already-computed credits (tokens / tokensPerCredit), as a decimal string
   * or number — stored as numeric(10,3). */
  credits: number;
}

export interface UsageLedgerListFilter {
  userEmail?: string;
  from?: Date;
  to?: Date;
  limit?: number;
  offset?: number;
}

export interface CompanyUsageTotals {
  totalCredits: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
  requestCount: number;
}

/**
 * Data Access Layer for `product_assist_usage_ledger` — the dedicated,
 * always-on quota-enforcement source of truth (see schema.ts's doc comment
 * above the table). `record()` is called SYNCHRONOUSLY (awaited) by the
 * enforcement wrapper immediately after every successful Product Assist AI
 * call, independent of PRODUCT_ASSIST_LOG_ENABLED and never read by
 * anything outside the quota engine and the "AI Usage & Limits" admin page.
 */
export class ProductAssistUsageLedgerRepository {
  constructor(private readonly db: AnyDb) {}

  async record(entry: RecordUsageEntry): Promise<ProductAssistUsageLedgerRow> {
    const [row] = await this.db
      .insert(productAssistUsageLedger)
      .values({
        userEmail: entry.userEmail.toLowerCase(),
        inputTokens: entry.inputTokens,
        outputTokens: entry.outputTokens,
        totalTokens: entry.totalTokens,
        credits: entry.credits.toFixed(3),
      })
      .returning();
    return row;
  }

  /** Total credits consumed by one user from `since` (inclusive) to now —
   * the building block for both the daily and monthly quota checks. */
  async sumCreditsSince(userEmail: string, since: Date): Promise<number> {
    const [row] = await this.db
      .select({ total: sql<string | null>`COALESCE(SUM(${productAssistUsageLedger.credits}), 0)` })
      .from(productAssistUsageLedger)
      .where(
        and(
          eq(productAssistUsageLedger.userEmail, userEmail.toLowerCase()),
          gte(productAssistUsageLedger.createdAt, since)
        )
      );
    return Number(row?.total ?? 0);
  }

  /** Per-user credit totals since `since`, in one query — used to build the
   * admin Users table's daily/monthly "used" columns without an N+1. */
  async sumCreditsGroupedByUserSince(since: Date): Promise<Map<string, number>> {
    const rows: { userEmail: string; total: string | null }[] = await this.db
      .select({
        userEmail: productAssistUsageLedger.userEmail,
        total: sql<string | null>`SUM(${productAssistUsageLedger.credits})`,
      })
      .from(productAssistUsageLedger)
      .where(gte(productAssistUsageLedger.createdAt, since))
      .groupBy(productAssistUsageLedger.userEmail);
    return new Map(rows.map((r) => [r.userEmail, Number(r.total ?? 0)]));
  }

  /** Company-wide totals in a date range (Overview tab + budget tracking).
   * `to` is exclusive; omit it for "from -> now". */
  async companyTotals(from: Date, to?: Date): Promise<CompanyUsageTotals> {
    const conditions = [gte(productAssistUsageLedger.createdAt, from)];
    if (to) conditions.push(lt(productAssistUsageLedger.createdAt, to));
    const [row] = await this.db
      .select({
        totalCredits: sql<string | null>`COALESCE(SUM(${productAssistUsageLedger.credits}), 0)`,
        totalInputTokens: sql<string | null>`COALESCE(SUM(${productAssistUsageLedger.inputTokens}), 0)`,
        totalOutputTokens: sql<string | null>`COALESCE(SUM(${productAssistUsageLedger.outputTokens}), 0)`,
        totalTokens: sql<string | null>`COALESCE(SUM(${productAssistUsageLedger.totalTokens}), 0)`,
        requestCount: sql<string | null>`COUNT(*)`,
      })
      .from(productAssistUsageLedger)
      .where(and(...conditions));
    return {
      totalCredits: Number(row?.totalCredits ?? 0),
      totalInputTokens: Number(row?.totalInputTokens ?? 0),
      totalOutputTokens: Number(row?.totalOutputTokens ?? 0),
      totalTokens: Number(row?.totalTokens ?? 0),
      requestCount: Number(row?.requestCount ?? 0),
    };
  }

  /** Paginated raw rows for the admin Usage History tab (Today / 7-day /
   * month / custom range), optionally scoped to one user. */
  async list(filter: UsageLedgerListFilter): Promise<ProductAssistUsageLedgerRow[]> {
    const conditions = [];
    if (filter.userEmail) conditions.push(eq(productAssistUsageLedger.userEmail, filter.userEmail.toLowerCase()));
    if (filter.from) conditions.push(gte(productAssistUsageLedger.createdAt, filter.from));
    if (filter.to) conditions.push(lt(productAssistUsageLedger.createdAt, filter.to));
    const where = conditions.length ? and(...conditions) : undefined;
    return this.db
      .select()
      .from(productAssistUsageLedger)
      .where(where)
      .orderBy(desc(productAssistUsageLedger.createdAt))
      .limit(filter.limit ?? 500)
      .offset(filter.offset ?? 0);
  }
}
