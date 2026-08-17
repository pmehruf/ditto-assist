/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { and, asc, count, gte, lte } from "drizzle-orm";
import type { AnyDb } from "../client.js";
import { qaEvaluationHistory, type QaEvaluationHistoryRow, type NewQaEvaluationHistoryRow } from "../schema.js";

export type NewQaEvaluationHistoryEntry = Omit<NewQaEvaluationHistoryRow, "id" | "createdAt">;

/** What qaDataEngine.ts's getMergedFeedbackDumpRows() actually reads off
 * each archived row — `id` and `createdAt` are selected by neither
 * listAll() nor listInRange() below, since nothing downstream uses them
 * (verified 2026-08-17: only checkedDate/mistakeDate/tactId/advisorName/
 * chatId/domain/score are ever touched). Narrowing the SELECT to these 7
 * columns instead of `db.select()` (all 9) trims ~12 of ~77.6 average
 * bytes/row (pg_column_size-measured) off every fetch, on top of the much
 * bigger win from listInRange()'s row-count reduction. */
export type QaEvaluationHistoryColumns = Omit<QaEvaluationHistoryRow, "id" | "createdAt">;

const HISTORY_COLUMNS = {
  checkedDate: qaEvaluationHistory.checkedDate,
  mistakeDate: qaEvaluationHistory.mistakeDate,
  tactId: qaEvaluationHistory.tactId,
  advisorName: qaEvaluationHistory.advisorName,
  chatId: qaEvaluationHistory.chatId,
  domain: qaEvaluationHistory.domain,
  score: qaEvaluationHistory.score,
} as const;

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
   * loading the whole table is still fine when a caller genuinely needs
   * every row regardless of checked_date (getAdvisorReviews's all-time
   * dispute/escalation browse, which filters by a *different* date column —
   * see qaDataEngine.ts's comment on that function for why it can't use
   * listInRange below). Bounded callers should prefer listInRange().
   * qaDataEngine.ts caches the result for 5 minutes (same TTL as the live
   * Sheet read) rather than hitting this on every request. */
  async listAll(): Promise<QaEvaluationHistoryColumns[]> {
    return this.db.select(HISTORY_COLUMNS).from(qaEvaluationHistory).orderBy(asc(qaEvaluationHistory.checkedDate));
  }

  /** Same rows as listAll(), narrowed to a checked_date range — uses the
   * existing qa_evaluation_history_checked_date_idx (confirmed live via
   * pg_indexes 2026-08-17) instead of transferring all ~54k rows and
   * filtering in JS. checkedFrom/checkedTo must be "yyyy-MM-dd" strings
   * (same format as everywhere else in this file/DateFilters) — checked_date
   * is stored as zero-padded ISO text, so a plain string BETWEEN is a
   * correct range comparison. Only safe for callers that filter their OWN
   * output by checked_date (getAdvisorMetrics, getAdvisorsBatchMetrics) —
   * see qaDataEngine.ts. */
  async listInRange(checkedFrom: string, checkedTo: string): Promise<QaEvaluationHistoryColumns[]> {
    return this.db
      .select(HISTORY_COLUMNS)
      .from(qaEvaluationHistory)
      .where(and(gte(qaEvaluationHistory.checkedDate, checkedFrom), lte(qaEvaluationHistory.checkedDate, checkedTo)))
      .orderBy(asc(qaEvaluationHistory.checkedDate));
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
