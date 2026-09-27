/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { asc, count, eq, inArray, isNull, sql } from "drizzle-orm";
import type { AnyDb } from "../client.js";
import { productAssistLogs, type ProductAssistLogRow, type NewProductAssistLogRow } from "../schema.js";

export type CreateProductAssistLogEntry = Omit<NewProductAssistLogRow, "id" | "createdAt" | "exportedAt">;

/**
 * Data Access Layer for `product_assist_logs` — see that table's schema
 * comment for why this exists and its PERMANENCE design (2026-09: rows are
 * marked exported, never deleted). `create()` is called fire-and-forget from
 * server.ts's POST /api/product-assist/ask (never awaited by the response,
 * and gated behind PRODUCT_ASSIST_LOG_ENABLED) — a logging failure must
 * never affect an advisor's actual answer.
 */
export class ProductAssistLogsRepository {
  constructor(private readonly db: AnyDb) {}

  async create(entry: CreateProductAssistLogEntry): Promise<void> {
    await this.db.insert(productAssistLogs).values(entry);
  }

  /** Oldest first, so an export naturally processes rows in the order they
   * were asked. */
  async listAll(): Promise<ProductAssistLogRow[]> {
    return this.db.select().from(productAssistLogs).orderBy(asc(productAssistLogs.createdAt));
  }

  /** Rows never yet appended to the export Sheet — the export job's actual
   * work queue (2026-09: replaces the old listAll()+deleteByIds() move-and-
   * clear now that rows are kept permanently — see runProductAssistLogExport). */
  async listUnexported(): Promise<ProductAssistLogRow[]> {
    return this.db.select().from(productAssistLogs).where(isNull(productAssistLogs.exportedAt)).orderBy(asc(productAssistLogs.createdAt));
  }

  /** Stamps exportedAt = now() on exactly the rows the export job just
   * confirmed were appended to the Sheet — never a blanket update, so a row
   * logged by a live advisor question mid-export is never marked exported
   * before it was actually written to the Sheet. */
  async markExported(ids: number[]): Promise<void> {
    if (ids.length === 0) return;
    await this.db.update(productAssistLogs).set({ exportedAt: sql`now()` }).where(inArray(productAssistLogs.id, ids));
  }

  /** One row's full query detail for the Usage History admin tab's
   * expand-in-place view — looked up by the product_assist_usage_ledger id
   * the same /ask request wrote (2026-09). Null if this usage row predates
   * the usageLedgerId link, or PRODUCT_ASSIST_LOG_ENABLED was off for that
   * request, or logging failed silently (fire-and-forget) — the caller
   * should show a clear "no detail recorded" state rather than an error. */
  async findByUsageLedgerId(usageLedgerId: number): Promise<ProductAssistLogRow | null> {
    const [row] = await this.db.select().from(productAssistLogs).where(eq(productAssistLogs.usageLedgerId, usageLedgerId)).limit(1);
    return row ?? null;
  }

  /** Bulk usageLedgerId -> modelName lookup for the Usage History tab's
   * primary (collapsed) row list (2026-09) — lets that table show which
   * Gemini model answered each row without a per-row fetch. Rows with no
   * linked log, or a null modelName (e.g. the deterministic conflict-answer
   * path), simply don't appear in the returned map — callers should treat a
   * missing key the same as a null value. */
  async findModelNamesByUsageLedgerIds(usageLedgerIds: number[]): Promise<Record<number, string | null>> {
    if (usageLedgerIds.length === 0) return {};
    const rows = await this.db
      .select({ usageLedgerId: productAssistLogs.usageLedgerId, modelName: productAssistLogs.modelName })
      .from(productAssistLogs)
      .where(inArray(productAssistLogs.usageLedgerId, usageLedgerIds));
    const map: Record<number, string | null> = {};
    for (const row of rows) {
      if (row.usageLedgerId !== null) map[row.usageLedgerId] = row.modelName;
    }
    return map;
  }

  async count(): Promise<number> {
    const [row] = await this.db.select({ value: count() }).from(productAssistLogs);
    return row?.value ?? 0;
  }

  /** Retained for potential future admin cleanup (e.g. a manual GDPR-style
   * deletion request) — no longer called by the export job now that rows
   * are kept permanently; see markExported() above. */
  async deleteByIds(ids: number[]): Promise<void> {
    if (ids.length === 0) return;
    await this.db.delete(productAssistLogs).where(inArray(productAssistLogs.id, ids));
  }
}
