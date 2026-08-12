/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { asc, count } from "drizzle-orm";
import type { AnyDb } from "../client.js";
import { qaEvaluationHistory, type QaEvaluationHistoryRow, type NewQaEvaluationHistoryRow } from "../schema.js";

export type NewQaEvaluationHistoryEntry = Omit<NewQaEvaluationHistoryRow, "id" | "createdAt">;

// Chunk size for bulkInsert — a single multi-row INSERT for tens of
// thousands of rows risks hitting Postgres/driver parameter limits; one
// INSERT per row would be needlessly slow. 500 rows * 7 columns stays well
// under any reasonable limit.
const INSERT_BATCH_SIZE = 500;

/**
 * Data Access Layer for `qa_evaluation_history` — the one-time archival
 * import of QA evaluation rows (see drizzle/0027_qa_evaluation_history.sql
 * and scripts/importQaEvaluationHistory.ts) that
 * src/server/qaDashboard/qaDataEngine.ts merges in alongside the live
 * Google Sheet's rows for date ranges the Sheet no longer covers.
 */
export class QaEvaluationHistoryRepository {
  constructor(private readonly db: AnyDb) {}

  /** Every archived row, unfiltered — tens of thousands, not millions, so
   * loading the whole table is fine; qaDataEngine.ts caches the result for
   * 5 minutes (same TTL as the live Sheet read) rather than hitting this on
   * every request. */
  async listAll(): Promise<QaEvaluationHistoryRow[]> {
    return this.db.select().from(qaEvaluationHistory).orderBy(asc(qaEvaluationHistory.checkedDate));
  }

  async count(): Promise<number> {
    const [row] = await this.db.select({ n: count() }).from(qaEvaluationHistory);
    return Number(row?.n ?? 0);
  }

  /** One-time-import helper (scripts/importQaEvaluationHistory.ts) — not
   * used by any live app code path. Inserts in fixed-size batches; see
   * INSERT_BATCH_SIZE above. */
  async bulkInsert(entries: NewQaEvaluationHistoryEntry[]): Promise<number> {
    let inserted = 0;
    for (let i = 0; i < entries.length; i += INSERT_BATCH_SIZE) {
      const chunk = entries.slice(i, i + INSERT_BATCH_SIZE);
      await this.db.insert(qaEvaluationHistory).values(chunk);
      inserted += chunk.length;
    }
    return inserted;
  }

  /** Wipes the table — backs the import script's --replace flag so
   * re-running after a corrected CSV doesn't duplicate rows. There's no
   * natural unique key across the source data to upsert against instead
   * (see scripts/importQaEvaluationHistory.ts header). */
  async deleteAll(): Promise<void> {
    await this.db.delete(qaEvaluationHistory);
  }
}
