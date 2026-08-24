/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { and, desc, eq, gt, isNull, or, sql } from "drizzle-orm";
import type { AnyDb } from "../client.js";
import { productAssistExtraCreditGrants, type ProductAssistExtraCreditGrantRow } from "../schema.js";

export interface CreateExtraCreditGrantEntry {
  userEmail: string;
  /** Positive = grant, negative = an admin removal/reduction entry. */
  amount: number;
  reason: string | null;
  grantedBy: string;
  /** Optional (migration 0049). Undefined/null = never expires, the
   * original default behavior. */
  expiresAt?: Date | null;
}

/** Matches a row that has NOT expired as of `now` — either it has no
 * expiry at all, or its expiry is still in the future. Shared by both
 * balance queries below so they can never drift apart. */
function notExpired(now: Date) {
  return or(isNull(productAssistExtraCreditGrants.expiresAt), gt(productAssistExtraCreditGrants.expiresAt, now));
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
        expiresAt: entry.expiresAt ?? null,
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

  /** Current extra-credit balance for one user (0 if they have no rows).
   * Excludes any row whose expiresAt has passed — see notExpired() above. */
  async balanceForUser(userEmail: string, now: Date = new Date()): Promise<number> {
    const [row] = await this.db
      .select({ total: sql<string | null>`COALESCE(SUM(${productAssistExtraCreditGrants.amount}), 0)` })
      .from(productAssistExtraCreditGrants)
      .where(and(eq(productAssistExtraCreditGrants.userEmail, userEmail.toLowerCase()), notExpired(now)));
    return Number(row?.total ?? 0);
  }

  /** Extra-credit balance for every user that has at least one non-expired
   * grant row — used to build the admin Users table without an N+1
   * per-user query. */
  async balancesByUser(now: Date = new Date()): Promise<Map<string, number>> {
    const rows: { userEmail: string; total: string | null }[] = await this.db
      .select({
        userEmail: productAssistExtraCreditGrants.userEmail,
        total: sql<string | null>`SUM(${productAssistExtraCreditGrants.amount})`,
      })
      .from(productAssistExtraCreditGrants)
      .where(notExpired(now))
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
