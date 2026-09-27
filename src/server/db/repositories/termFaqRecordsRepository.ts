/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { and, asc, eq } from "drizzle-orm";
import type { AnyDb } from "../client.js";
import { termFaqRecords, type TermFaqRecordRow, type NewTermFaqRecordRow } from "../schema.js";

export type CreateTermFaqRecordEntry = Omit<NewTermFaqRecordRow, "id" | "createdAt" | "updatedAt">;

export interface TermFaqRecordFilter {
  resourceId?: number;
  category?: string;
  isActive?: boolean;
  /** Filters to records flagged as an unresolved duplicate-question/
   * different-answer conflict — used by the Connections page so "N flagged
   * for review" can link through to the actual records, not just a count. */
  hasConflict?: boolean;
}

/**
 * Data Access Layer for `term_faq_records` — see schema.ts's doc comment on
 * the table for the full design. Mirrors FaqRecordsRepository — including
 * `questionEmbedding` (added 2026-09) now that Term Product Assist retrieves
 * this table the same way faq_records already worked for Health, alongside
 * the original consumer, src/server/knowledgeBase/didYouKnow.ts.
 */
export class TermFaqRecordsRepository {
  constructor(private readonly db: AnyDb) {}

  /** Every record matching the given filter, sorted by category then
   * question — used by the admin review panel, which needs to see
   * incomplete/conflicting rows too, not just the answerable ones. */
  async list(filter: TermFaqRecordFilter = {}): Promise<TermFaqRecordRow[]> {
    const conditions = [];
    if (filter.resourceId !== undefined) conditions.push(eq(termFaqRecords.resourceId, filter.resourceId));
    if (filter.category !== undefined) conditions.push(eq(termFaqRecords.category, filter.category));
    if (filter.isActive !== undefined) conditions.push(eq(termFaqRecords.isActive, filter.isActive));
    if (filter.hasConflict !== undefined) conditions.push(eq(termFaqRecords.hasConflict, filter.hasConflict));
    const query = this.db.select().from(termFaqRecords);
    const rows = conditions.length > 0 ? await query.where(and(...conditions)) : await query;
    return [...rows].sort((a, b) => a.category.localeCompare(b.category) || a.question.localeCompare(b.question));
  }

  async get(id: number): Promise<TermFaqRecordRow | undefined> {
    const [row] = await this.db.select().from(termFaqRecords).where(eq(termFaqRecords.id, id));
    return row;
  }

  /** Every record eligible to be used as an authoritative answer: active,
   * answerable (Column B wasn't blank), not part of an unresolved
   * duplicate-answer conflict. Two callers: didYouKnow.ts (sorts this pool
   * by combined question+answer length before picking the day's rotation)
   * and, since 2026-09, src/server/knowledgeBase/faq.ts's
   * resolveApplicableFaqs (filters further to rows with a non-null
   * questionEmbedding — see that column's comment). */
  async listAnswerableActive(): Promise<TermFaqRecordRow[]> {
    return this.db
      .select()
      .from(termFaqRecords)
      .where(and(eq(termFaqRecords.isActive, true), eq(termFaqRecords.isAnswerable, true), eq(termFaqRecords.hasConflict, false)))
      .orderBy(asc(termFaqRecords.category), asc(termFaqRecords.question));
  }

  /**
   * Replaces every record belonging to this resource in one delete-then-
   * insert sequence — called on every (re)sync, same "Sheet is the
   * authoring source" convention as faqRecordsRepository.replaceForResource.
   * A manual isActive=false set by an admin between syncs is intentionally
   * NOT preserved across this call — same documented limitation as
   * faq_records.isActive.
   */
  async replaceForResource(resourceId: number, entries: CreateTermFaqRecordEntry[]): Promise<void> {
    await this.db.delete(termFaqRecords).where(eq(termFaqRecords.resourceId, resourceId));
    if (entries.length === 0) return;
    await this.db.insert(termFaqRecords).values(entries);
  }

  /** Admin-only toggle (see server.ts's PATCH /api/kb/term-faq/records/:id)
   * — the one write this table supports outside of a full resync, for
   * retiring a bad/outdated record without waiting on a sheet edit. */
  async setActive(id: number, isActive: boolean): Promise<TermFaqRecordRow | undefined> {
    const [row] = await this.db.update(termFaqRecords).set({ isActive, updatedAt: new Date() }).where(eq(termFaqRecords.id, id)).returning();
    return row;
  }
}
