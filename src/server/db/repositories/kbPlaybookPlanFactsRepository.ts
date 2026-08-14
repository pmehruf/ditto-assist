/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { asc, eq } from "drizzle-orm";
import type { AnyDb } from "../client.js";
import { kbPlaybookPlanFacts, type KbPlaybookPlanFactRow, type NewKbPlaybookPlanFactRow } from "../schema.js";

export type CreateKbPlaybookPlanFactEntry = Omit<NewKbPlaybookPlanFactRow, "id" | "updatedAt">;

/** Data Access Layer for `kb_playbook_plan_facts` — see schema.ts's comment
 * on the table for why this is a separate, always-injected channel rather
 * than a normal similarity-retrieved kb_chunks source. */
export class KbPlaybookPlanFactsRepository {
  constructor(private readonly db: AnyDb) {}

  async listByResource(resourceId: number): Promise<KbPlaybookPlanFactRow[]> {
    return this.db
      .select()
      .from(kbPlaybookPlanFacts)
      .where(eq(kbPlaybookPlanFacts.resourceId, resourceId))
      .orderBy(asc(kbPlaybookPlanFacts.insurerName), asc(kbPlaybookPlanFacts.planName));
  }

  async listAll(): Promise<KbPlaybookPlanFactRow[]> {
    return this.db
      .select()
      .from(kbPlaybookPlanFacts)
      .orderBy(asc(kbPlaybookPlanFacts.insurerName), asc(kbPlaybookPlanFacts.planName));
  }

  /**
   * Replaces every fact row belonging to this resource in one transaction-
   * like sequence (delete then insert) — called on every (re)sync so a plan
   * removed from the sheet doesn't linger as stale authoritative content.
   */
  async replaceForResource(resourceId: number, entries: CreateKbPlaybookPlanFactEntry[]): Promise<void> {
    await this.db.delete(kbPlaybookPlanFacts).where(eq(kbPlaybookPlanFacts.resourceId, resourceId));
    if (entries.length === 0) return;
    await this.db.insert(kbPlaybookPlanFacts).values(entries);
  }

  async deleteByResource(resourceId: number): Promise<void> {
    await this.db.delete(kbPlaybookPlanFacts).where(eq(kbPlaybookPlanFacts.resourceId, resourceId));
  }

  /**
   * All fact rows in memory, filtered by JS (this table stays small — a few
   * dozen plans total — so a full table scan + JS filter is simpler and
   * plenty fast, matching the same "resolve eligibility in JS" convention
   * queryAssist.ts already uses for kb_resources.planTags matching).
   * Matches an insurer name loosely (either side contains the other,
   * case-insensitively) since the Playbook's own insurer labels don't
   * always match kb_categories.name verbatim (e.g. "HDFC Ergo" vs "HDFC
   * ERGO General Insurance"), and a plan name exactly (case-insensitive)
   * against the advisor's selected plan tag(s) — an exact plan name is a
   * precise, deliberate selection, unlike a free-text insurer label.
   */
  async findMatching(insurerName: string, planTags: string[]): Promise<KbPlaybookPlanFactRow[]> {
    if (planTags.length === 0) return [];
    const all = await this.listAll();
    const insurerNeedle = insurerName.trim().toLowerCase();
    const planNeedles = planTags.map(p => p.trim().toLowerCase());
    return all.filter(row => {
      const rowInsurer = row.insurerName.trim().toLowerCase();
      const insurerMatches = rowInsurer.includes(insurerNeedle) || insurerNeedle.includes(rowInsurer);
      const planMatches = planNeedles.some(p => row.planName.trim().toLowerCase() === p);
      return insurerMatches && planMatches;
    });
  }
}
