/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { and, asc, eq, isNotNull } from "drizzle-orm";
import type { AnyDb } from "../client.js";
import { faqRecords, type FaqRecordRow, type NewFaqRecordRow } from "../schema.js";

export type CreateFaqRecordEntry = Omit<NewFaqRecordRow, "id" | "createdAt" | "updatedAt">;

export interface FaqRecordFilter {
  resourceId?: number;
  category?: "health_product" | "operations_health";
  isActive?: boolean;
}

/**
 * Data Access Layer for `faq_records` — see schema.ts's doc comment on the
 * table for the full design (why it's separate from kb_chunks, the
 * blank/duplicate/conflict handling).
 */
export class FaqRecordsRepository {
  constructor(private readonly db: AnyDb) {}

  /** Every record matching the given filter, newest-question-first within
   * category — used by the admin review panel (Knowledge Base Management),
   * which needs to see incomplete/conflicting rows too, not just the
   * answerable ones. */
  async list(filter: FaqRecordFilter = {}): Promise<FaqRecordRow[]> {
    const conditions = [];
    if (filter.resourceId !== undefined) conditions.push(eq(faqRecords.resourceId, filter.resourceId));
    if (filter.category !== undefined) conditions.push(eq(faqRecords.category, filter.category));
    if (filter.isActive !== undefined) conditions.push(eq(faqRecords.isActive, filter.isActive));
    const query = this.db.select().from(faqRecords);
    const rows = conditions.length > 0 ? await query.where(and(...conditions)) : await query;
    return [...rows].sort((a, b) => a.category.localeCompare(b.category) || a.question.localeCompare(b.question));
  }

  async get(id: number): Promise<FaqRecordRow | undefined> {
    const [row] = await this.db.select().from(faqRecords).where(eq(faqRecords.id, id));
    return row;
  }

  /**
   * Every record eligible to actually be used as a sourced answer: active,
   * answerable (Column B wasn't blank), not part of an unresolved
   * duplicate-answer conflict, and has a question embedding to match
   * against (the three states are meant to move together — see
   * faqIngest.ts — but this filters on all of them explicitly rather than
   * assuming that invariant always holds). Table is expected to stay in the
   * low hundreds of rows, so a full fetch + in-JS cosine similarity (see
   * faq.ts) is simpler and plenty fast, matching the same convention
   * specialInstructions.ts / kbPlaybookPlanFactsRepository already use.
   */
  async listAnswerableActive(): Promise<FaqRecordRow[]> {
    return this.db
      .select()
      .from(faqRecords)
      .where(and(eq(faqRecords.isActive, true), eq(faqRecords.isAnswerable, true), eq(faqRecords.hasConflict, false), isNotNull(faqRecords.questionEmbedding)))
      .orderBy(asc(faqRecords.category), asc(faqRecords.question));
  }

  /**
   * Replaces every record belonging to this resource in one delete-then-
   * insert sequence — called on every (re)sync, same "Sheet is the
   * authoring source" convention as kbPlaybookPlanFactsRepository.replaceForResource.
   * A manual isActive=false set by an admin between syncs is intentionally
   * NOT preserved across this call — see schema.ts's comment on
   * faqRecords.isActive for why that's an accepted, documented limitation.
   */
  async replaceForResource(resourceId: number, entries: CreateFaqRecordEntry[]): Promise<void> {
    await this.db.delete(faqRecords).where(eq(faqRecords.resourceId, resourceId));
    if (entries.length === 0) return;
    await this.db.insert(faqRecords).values(entries);
  }

  /** Admin-only toggle (see server.ts's PATCH /api/kb/faq/records/:id) — the
   * one write this table supports outside of a full resync, for retiring a
   * bad/outdated record without waiting on a sheet edit. */
  async setActive(id: number, isActive: boolean): Promise<FaqRecordRow | undefined> {
    const [row] = await this.db.update(faqRecords).set({ isActive, updatedAt: new Date() }).where(eq(faqRecords.id, id)).returning();
    return row;
  }
}
