/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { and, desc, eq, gte, lte } from "drizzle-orm";
import type { AnyDb } from "../client.js";
import {
  productAssistUnresolvedQueries,
  type ProductAssistUnresolvedQueryRow,
  type NewProductAssistUnresolvedQueryRow,
} from "../schema.js";

export type CreateUnresolvedQueryEntry = Omit<
  NewProductAssistUnresolvedQueryRow,
  "id" | "createdAt" | "status" | "resolvedSpecialInstructionId" | "resolvedBy" | "resolvedAt"
>;

export interface UnresolvedQueryFilter {
  domain?: "Health" | "Term";
  status?: "unresolved" | "resolved" | "skipped";
  /** Inclusive createdAt lower/upper bounds — used by the Unresolved
   * Queries admin panel's date filter. */
  from?: Date;
  to?: Date;
}

export interface UpdateUnresolvedQueryStatusEntry {
  status: "unresolved" | "resolved" | "skipped";
  resolvedBy?: string | null;
  /** Only meaningful when status="resolved" (see schema.ts's doc comment on
   * this column) — omit/null on "skipped" or "unresolved" (reopen). */
  resolvedSpecialInstructionId?: number | null;
}

/**
 * Data Access Layer for `product_assist_unresolved_queries` — see that
 * table's schema.ts comment for the full design (why it's separate from and
 * unrelated to product_assist_logs, the automatic-recording trigger, and the
 * resolve/skip/reopen workflow).
 */
export class ProductAssistUnresolvedQueriesRepository {
  constructor(private readonly db: AnyDb) {}

  /** Called fire-and-forget from server.ts's POST /api/product-assist/ask
   * whenever answerQuery() returns hadNoMatches=true — never awaited by the
   * advisor's response, so a failure here must never affect their answer. */
  async create(entry: CreateUnresolvedQueryEntry): Promise<void> {
    await this.db.insert(productAssistUnresolvedQueries).values(entry);
  }

  async get(id: number): Promise<ProductAssistUnresolvedQueryRow | undefined> {
    const [row] = await this.db.select().from(productAssistUnresolvedQueries).where(eq(productAssistUnresolvedQueries.id, id));
    return row;
  }

  /** Newest first — matches the admin panel's default "most recent gap
   * first" review order. */
  async list(filter: UnresolvedQueryFilter = {}): Promise<ProductAssistUnresolvedQueryRow[]> {
    const conditions = [];
    if (filter.domain !== undefined) conditions.push(eq(productAssistUnresolvedQueries.domain, filter.domain));
    if (filter.status !== undefined) conditions.push(eq(productAssistUnresolvedQueries.status, filter.status));
    if (filter.from !== undefined) conditions.push(gte(productAssistUnresolvedQueries.createdAt, filter.from));
    if (filter.to !== undefined) conditions.push(lte(productAssistUnresolvedQueries.createdAt, filter.to));
    const query = this.db.select().from(productAssistUnresolvedQueries);
    const rows = conditions.length > 0 ? await query.where(and(...conditions)) : await query;
    return [...rows].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  /** Every row currently exported (used by the Google Sheets export, which
   * always writes the full current snapshot rather than an incremental
   * append — see productAssistUnresolvedQueriesSheetsClient.ts). */
  async listAll(): Promise<ProductAssistUnresolvedQueryRow[]> {
    return this.db.select().from(productAssistUnresolvedQueries).orderBy(desc(productAssistUnresolvedQueries.createdAt));
  }

  /** The one write this table supports outside of create() — resolving
   * (optionally linked to a just-created Special Instruction), skipping, or
   * reopening (status="unresolved", clearing the resolved-* fields) a row.
   * resolvedAt is stamped automatically whenever status leaves "unresolved",
   * and cleared on reopen — callers never set it directly. */
  async updateStatus(id: number, entry: UpdateUnresolvedQueryStatusEntry): Promise<ProductAssistUnresolvedQueryRow | undefined> {
    const [row] = await this.db
      .update(productAssistUnresolvedQueries)
      .set({
        status: entry.status,
        resolvedBy: entry.status === "unresolved" ? null : entry.resolvedBy ?? null,
        resolvedSpecialInstructionId: entry.status === "resolved" ? entry.resolvedSpecialInstructionId ?? null : null,
        resolvedAt: entry.status === "unresolved" ? null : new Date(),
      })
      .where(eq(productAssistUnresolvedQueries.id, id))
      .returning();
    return row;
  }
}
