/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { and, eq } from "drizzle-orm";
import type { AnyDb } from "../client.js";
import { qaFeedbackDiscussedMarks } from "../schema.js";

/**
 * Data Access Layer for `qa_feedback_discussed_marks` — see schema.ts's
 * table comment for the full "why" (QA Feedback rows come from an external
 * sheet with no id this app owns, so each "discussed" mark is its own row
 * here, keyed by tactId + a stable row identity string the client builds).
 * Presence of a row = discussed; there is no "status" column to flip, only
 * mark/unmark.
 */
export class QaFeedbackDiscussedMarksRepository {
  constructor(private readonly db: AnyDb) {}

  /** Every marked row identity for one advisor — the Advisor Insight
   * Page's QA Feedback section renders a checked box wherever a row's own
   * identity appears in this set. */
  async listForTactId(tactId: string): Promise<string[]> {
    const rows = await this.db.select({ rowIdentity: qaFeedbackDiscussedMarks.rowIdentity }).from(qaFeedbackDiscussedMarks).where(eq(qaFeedbackDiscussedMarks.tactId, tactId));
    return rows.map((r) => r.rowIdentity);
  }

  /** Insert-or-noop — marking an already-marked row is a harmless no-op
   * (ON CONFLICT DO NOTHING against the (tactId, rowIdentity) unique
   * index), not an error, since two people could tick the same row around
   * the same time. */
  async mark(tactId: string, rowIdentity: string, markedByEmail: string): Promise<void> {
    await this.db
      .insert(qaFeedbackDiscussedMarks)
      .values({ tactId, rowIdentity, markedByEmail: markedByEmail.toLowerCase() })
      .onConflictDoNothing({ target: [qaFeedbackDiscussedMarks.tactId, qaFeedbackDiscussedMarks.rowIdentity] });
  }

  async unmark(tactId: string, rowIdentity: string): Promise<void> {
    await this.db.delete(qaFeedbackDiscussedMarks).where(and(eq(qaFeedbackDiscussedMarks.tactId, tactId), eq(qaFeedbackDiscussedMarks.rowIdentity, rowIdentity)));
  }
}
