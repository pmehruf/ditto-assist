/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { desc, eq, sql } from "drizzle-orm";
import type { AnyDb } from "../client.js";
import { productAssistExtraCreditGrants, type ProductAssistExtraCreditGrantRow } from "../schema.js";

export interface CreateExtraCreditGrantEntry {
  userEmail: string;
  /** Positive = grant, negative = an admin removal/reduction entry. */
  amount: number;
  reason: string | null;
  grantedBy: string;
}

/**
 * Data Access Layer for `product_assist_extra_credit_grants` — an
 * append-only ledger (never expires, never mutated after insert). A
 * "removal" is simply a new negative-amount row, so the full grant history
 * stays intact for the audit trail. The user's current extra-credit
 * balance is SUM(amount) across their rows, added on top of their MONTHLY
 * limit only (see productAssistQuota.ts).
 */
export class ProductAssistExtraCreditGrantsRepository {
  constructor(private readonly db: AnyDb) {}

  async create(entry: CreateExtraCreditGrantEntry): Promise<ProductAssistExtraCreditGrantRow> {
    const [row] = await this.db
      .insert(productAssistExtraCreditGrants)
      .values({
        userEmail: entry.userEmail.toLowerCase(),
        amount: entry.amount,
        reason: entry.reason,
        grantedBy: entry.grantedBy,
      })
      .returning();
    return row;
  }

  async listForUser(userEmail: string): Promise<ProductAssistExtraCreditGrantRow[]> {
    return this.db
      .select()
      .from(productAssistExtraCreditGrants)
      .where(eq(productAssistExtraCreditGrants.userEmail, userEmail.toLowerCase()))
      .orderBy(desc(productAssistExtraCreditGrants.grantedAt));
  }

  /** Current extra-credit balance for one user (0 if they have no rows). */
  async balanceForUser(userEmail: string): Promise<number> {
    const [row] = await this.db
      .select({ total: sql<string | null>`COALESCE(SUM(${productAssistExtraCreditGrants.amount}), 0)` })
      .from(productAssistExtraCreditGrants)
      .where(eq(productAssistExtraCreditGrants.userEmail, userEmail.toLowerCase()));
    return Number(row?.total ?? 0);
  }

  /** Extra-credit balance for every user that has at least one grant row —
   * used to build the admin Users table without an N+1 per-user query. */
  async balancesByUser(): Promise<Map<string, number>> {
    const rows: { userEmail: string; total: string | null }[] = await this.db
      .select({
        userEmail: productAssistExtraCreditGrants.userEmail,
        total: sql<string | null>`SUM(${productAssistExtraCreditGrants.amount})`,
      })
      .from(productAssistExtraCreditGrants)
      .groupBy(productAssistExtraCreditGrants.userEmail);
    return new Map(rows.map((r) => [r.userEmail, Number(r.total ?? 0)]));
  }

  /** Most recent grants/removals across all users, for the admin Overview /
   * audit-adjacent views. */
  async listRecent(limit = 50): Promise<ProductAssistExtraCreditGrantRow[]> {
    return this.db
      .select()
      .from(productAssistExtraCreditGrants)
      .orderBy(desc(productAssistExtraCreditGrants.grantedAt))
      .limit(limit);
  }
}
