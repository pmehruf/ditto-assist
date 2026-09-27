/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { and, asc, eq, ne } from "drizzle-orm";
import type { AnyDb } from "../client.js";
import { kbPlaybookPlanFacts, type KbPlaybookPlanFactRow, type NewKbPlaybookPlanFactRow } from "../schema.js";

export type CreateKbPlaybookPlanFactEntry = Omit<NewKbPlaybookPlanFactRow, "id" | "updatedAt">;

/**
 * Normalizes a plan name for comparison in findMatching below — case,
 * whitespace, and purely-cosmetic-punctuation insensitive.
 *
 * This exists because `row.planName` (derived from the Playbook Google
 * Sheet's own plan-column header text — see playbookIngest.ts's
 * splitInsurerAndPlan) and the advisor-facing plan tag it's compared
 * against (kb_categories.planNames, a SEPARATE admin-typed roster used for
 * kb_resources.planTags/the advisor's Plan picker — see that column's
 * schema.ts comment) are two independently-maintained free-text strings for
 * the same real-world plan, with nothing anywhere reconciling them. Before
 * this normalization, findMatching required them to be byte-identical
 * (after only trim+lowercase) — a trailing space, a doubled internal space,
 * a curly vs straight apostrophe, or a stray period in either string was
 * enough to silently return zero Playbook facts for a plan whose Playbook
 * row genuinely exists, with no error surfaced anywhere: the topic then
 * fell through to DOCUMENT EXCERPTS exactly as if the Playbook were simply
 * silent on it (see SOURCE PRECEDENCE #1a in productAssist.ts), even though
 * it wasn't.
 *
 * Deliberately NOT the "strip every non-alphanumeric character" convention
 * src/utils/kbPlanNames.ts's isAddOnPlanName uses — that would strip "+"
 * too, and this table's own real data distinguishes plans exactly that way
 * ("Optima Secure" vs "Optima Secure+" are two different rows). Only
 * genuinely cosmetic punctuation (straight/curly quotes, commas, periods)
 * is stripped; "+", "-", "&", and similar plan-name-distinguishing
 * characters are preserved. Still a full-string comparison, never a
 * substring one (unlike the insurer-name check below) — normalizing away
 * formatting noise must never make "Optima Secure" start matching "Optima
 * Secure Plus".
 */
function normalizePlanNameForMatch(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[’‘'"“”,.]/g, "")
    .replace(/\s+/g, " ");
}

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

  /** Every plan fact for one domain (Health or Term) — used by
   * productAssist.ts's broad General-scope fallback (2026-09-07): a
   * General question that names no plan at all (so there's nothing for
   * findMatching's insurer/plan-tag narrowing to key off) still gets every
   * plan's Playbook facts for that domain, rather than relying solely on
   * document-chunk retrieval, which has no reliable way to surface a
   * structured fact (e.g. a "Discounts offered" row) that isn't phrased
   * the way the advisor's question was. Simple JS filter over listAll(),
   * same "this table stays small" reasoning as findMatching above. */
  async listAllForDomain(domain: KbPlaybookPlanFactRow["domain"]): Promise<KbPlaybookPlanFactRow[]> {
    const all = await this.listAll();
    return all.filter(row => row.domain === domain);
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
   * Deletes every row for this domain whose resourceId ISN'T
   * canonicalResourceId — the real fix for a 2026-09 live data-integrity
   * bug found via a production DB query: 8 Health rows (e.g. Care Health's
   * "Advantage"/"Care"/"Supreme" etc., stored with the old, un-fixed plan
   * names) were sitting under resourceId 110 — which turned out to be the
   * ACTIVE, legitimate Health FAQ resource (512 real FAQ chunks), not a
   * duplicate Playbook resource. The likely history: before syncPlaybook's
   * resource lookup matched on title (not just type==="sheet" — see that
   * comment), an earlier sync could grab ANY sheet-type resource it found
   * first and write Playbook facts under its resourceId — here, the FAQ's.
   * Once the title-guard was added, every subsequent sync correctly found/
   * reused the real Playbook resource (27), but the old mistagged rows
   * under 110 were never touched by anything since — findMatching/
   * findAllForInsurer scan the whole table with no resourceId filter, so
   * they kept surfacing alongside the correct rows forever.
   *
   * Deliberately NOT "delete resourceId 110" (or whatever the offending id
   * turns out to be) — that resource may be a real, unrelated, actively-used
   * resource (as the FAQ is here) and must not be touched. Only the rows
   * that don't belong under this domain's canonical Playbook resource are
   * removed. Domain-scoped so running Health's cleanup can never touch a
   * legitimately-different-resourceId Term row (Term has its own canonical
   * resource entirely).
   */
  async deleteOrphanedForDomain(domain: KbPlaybookPlanFactRow["domain"], canonicalResourceId: number): Promise<void> {
    await this.db
      .delete(kbPlaybookPlanFacts)
      .where(and(eq(kbPlaybookPlanFacts.domain, domain), ne(kbPlaybookPlanFacts.resourceId, canonicalResourceId)));
  }

  /**
   * All fact rows in memory, filtered by JS (this table stays small — a few
   * dozen plans total — so a full table scan + JS filter is simpler and
   * plenty fast, matching the same "resolve eligibility in JS" convention
   * productAssist.ts already uses for kb_resources.planTags matching).
   * Matches an insurer name loosely (either side contains the other,
   * case-insensitively) since the Playbook's own insurer labels don't
   * always match kb_categories.name verbatim (e.g. "HDFC Ergo" vs "HDFC
   * ERGO General Insurance"), and a plan name exactly (case-insensitive)
   * against the advisor's selected plan tag(s) — an exact plan name is a
   * precise, deliberate selection, unlike a free-text insurer label.
   */
  async findMatching(insurerName: string, planTags: string[], domain: KbPlaybookPlanFactRow["domain"]): Promise<KbPlaybookPlanFactRow[]> {
    if (planTags.length === 0) return [];
    const all = await this.listAll();
    const insurerNeedle = insurerName.trim().toLowerCase();
    const planNeedles = planTags.map(p => normalizePlanNameForMatch(p));
    return all.filter(row => {
      if (row.domain !== domain) return false;
      const rowInsurer = row.insurerName.trim().toLowerCase();
      const insurerMatches = rowInsurer.includes(insurerNeedle) || insurerNeedle.includes(rowInsurer);
      const planMatches = planNeedles.some(p => normalizePlanNameForMatch(row.planName) === p);
      return insurerMatches && planMatches;
    });
  }

  /**
   * Every plan fact belonging to one insurer (loose, case-insensitive,
   * either-side-contains match — same convention as findMatching's insurer
   * check above), regardless of plan.
   *
   * 2026-09 regression fix: productAssist.ts's three playbookFacts branches
   * covered (a) an insurer + a plan both in scope, (b) General scope with a
   * plan detected, and (c) General scope with no plan detected at all — but
   * NOT (d) an insurer selected via the UI with NO plan selected or
   * detected (e.g. "How does the restoration benefit work?" asked while
   * scoped only to "Care Health", no specific plan). findMatching(insurer,
   * [], domain) short-circuits to [] the moment planTags is empty (by
   * design — see its own comment), so case (d) silently fell all the way
   * through to Prospectus-only document-chunk retrieval with zero Playbook
   * facts, even though the insurer itself was known. This method is what
   * productAssist.ts's new fourth branch calls for that case, mirroring
   * listAllForDomain's "the table stays small, full scan is fine" reasoning
   * but narrowed to just the one insurer in scope.
   */
  async findAllForInsurer(insurerName: string, domain: KbPlaybookPlanFactRow["domain"]): Promise<KbPlaybookPlanFactRow[]> {
    const all = await this.listAll();
    const insurerNeedle = insurerName.trim().toLowerCase();
    if (!insurerNeedle) return [];
    return all.filter(row => {
      if (row.domain !== domain) return false;
      const rowInsurer = row.insurerName.trim().toLowerCase();
      return rowInsurer.includes(insurerNeedle) || insurerNeedle.includes(rowInsurer);
    });
  }
}
