/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * ACRONYM DICTIONARY — RETRIEVAL (plain word-boundary matching).
 *
 * Unlike Special Instructions/Ditto FAQ (embedding-similarity matched
 * against a whole topic/question), an acronym is a short, exact token — "OS"
 * either appears in the advisor's question or it doesn't. A word-boundary,
 * case-insensitive string match is both simpler and more precise here than
 * an embedding threshold would be, and needs no extra embedding call.
 *
 * Every active, admin-curated acronym is always a match candidate; the
 * matching itself is deterministic (no relevance score to tune).
 */

import type { Repositories } from "../db/repositories/index.js";
import type { KbAcronymRow } from "../db/schema.js";

type Domain = KbAcronymRow["domain"];

export interface MatchedAcronym {
  acronym: string;
  expansion: string;
  notes: string | null;
}

/** Escapes a string for safe use inside a RegExp — mirrors
 * productAssist.ts's detectMentionedPlanNames escaping convention. */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Returns every active acronym (scoped to the given Health/Term domain —
 * see kb_acronyms.domain's schema.ts comment) whose exact token appears in
 * `question` (word-boundary, case-insensitive — "OS" matches "the OS plan"
 * but not "COST" or "OSes"). Order matches the DB's default listing order;
 * callers needing determinism should not assume a particular order beyond
 * that.
 */
export async function resolveMatchedAcronyms(repos: Repositories, question: string, domain: Domain): Promise<MatchedAcronym[]> {
  const rows = await repos.kbAcronyms.listActive(domain);
  if (rows.length === 0) return [];
  return rows
    .filter((row: KbAcronymRow) => {
      const needle = row.acronym.trim();
      if (!needle) return false;
      return new RegExp(`\\b${escapeRegExp(needle)}\\b`, "i").test(question);
    })
    .map(row => ({ acronym: row.acronym, expansion: row.expansion, notes: row.notes }));
}

/**
 * Of the matched acronyms, which ones expand to a real plan name in
 * `rosterPlanNames` (case-insensitive exact match) — these should be
 * treated as if the advisor had named that plan directly (see
 * productAssist.ts's detectMentionedPlanNames, which this complements: that
 * function matches a plan's full name appearing literally in the question;
 * this one catches the same intent expressed as a habitual shorthand, e.g.
 * "OS" for "Optima Secure").
 */
export function acronymPlanNameMatches(matched: MatchedAcronym[], rosterPlanNames: string[]): string[] {
  if (matched.length === 0 || rosterPlanNames.length === 0) return [];
  const rosterByLower = new Map(rosterPlanNames.map(p => [p.trim().toLowerCase(), p]));
  const found: string[] = [];
  for (const { expansion } of matched) {
    const plan = rosterByLower.get(expansion.trim().toLowerCase());
    if (plan && !found.includes(plan)) found.push(plan);
  }
  return found;
}

/** Renders the ACRONYM REFERENCE block for the prompt — a short glossary of
 * only the acronyms actually present in this question, so the model
 * recognizes the advisor's own shorthand instead of treating it as an
 * unfamiliar or ambiguous term. Returns "" (nothing added) when nothing
 * matched, the normal case for a question that uses no known acronym. */
export function buildAcronymReferenceBlock(matched: MatchedAcronym[]): string {
  if (matched.length === 0) return "";
  const lines = matched.map(m => `- "${m.acronym}" = ${m.expansion}${m.notes ? ` (${m.notes})` : ""}`);
  return ["=== ACRONYM REFERENCE (shorthand the advisor may have used above — expand silently, never explain it back) ===", ...lines].join(
    "\n"
  );
}
