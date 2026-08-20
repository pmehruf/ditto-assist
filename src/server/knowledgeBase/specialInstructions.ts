/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Repositories } from "../db/repositories/index.js";
import type { SpecialInstructionRow } from "../db/schema.js";
import type { QueryAssistScope } from "./queryAssist.js";

// Cosine-similarity cutoff for "is this question actually about this
// instruction's Topic" — deliberately lower than a document-chunk
// retrieval threshold would be, since a Topic is a short phrase ("Free
// Period") being compared against a full question's embedding rather than
// two passages of similar length/register. Tunable: raise it if an
// instruction is firing on questions that are only loosely related to its
// Topic; lower it if a genuinely on-topic question is being missed. See
// resolveApplicableInstructions's doc comment for why this (embedding
// similarity) was chosen over an extra LLM classification call.
const TOPIC_RELEVANCE_THRESHOLD = 0.55;

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/** Which of the two optional scope fields an instruction has set — higher
 * number = more specific. Mirrors the spec's 4-level ladder:
 *   Product + Insurer + Topic (4) > Product + Topic (3) > Insurer + Topic (2) > Topic only (1)
 * NOTE: an instruction with only insurerCategoryId set outranks one with
 * only productPlanName set per the spec's own ordering (section 9 lists
 * "Product + Topic" above "Insurer + Topic"), so productPlanName-only is
 * rank 3 and insurerCategoryId-only is rank 2 — matching that list exactly. */
function specificityRank(row: SpecialInstructionRow): 1 | 2 | 3 | 4 {
  const hasInsurer = row.insurerCategoryId !== null;
  const hasProduct = !!row.productPlanName;
  if (hasInsurer && hasProduct) return 4;
  if (hasProduct) return 3;
  if (hasInsurer) return 2;
  return 1;
}

/** Deterministic scope check — does this instruction's own Insurer/Product
 * (if set) match the advisor's resolved query scope? Independent of topic
 * relevance, which is checked separately via embedding similarity. */
function scopeMatches(row: SpecialInstructionRow, scope: QueryAssistScope, effectivePlanTags: string[]): boolean {
  if (row.insurerCategoryId !== null && row.insurerCategoryId !== scope.categoryId) return false;
  if (row.productPlanName) {
    const needle = row.productPlanName.trim().toLowerCase();
    const matches = effectivePlanTags.some(p => p.trim().toLowerCase() === needle);
    if (!matches) return false;
  }
  return true;
}

export interface SpecialInstructionConflict {
  topic: string;
  instructions: SpecialInstructionRow[];
}

export interface ApplicableSpecialInstructions {
  /** Highest-authority instructions to apply, one per distinct topic —
   * SOURCE PRECEDENCE #0, above the Product Playbook. Empty when nothing
   * applies (the normal, unaffected case for every query while this table
   * is empty or scope/topic simply don't match). */
  overrideRules: SpecialInstructionRow[];
  /** Additional Information + General Instruction rows to inject as
   * supplementary, non-authoritative guidance alongside normal retrieval. */
  advisory: SpecialInstructionRow[];
  /** Topics where 2+ active Override Rules matched at the same effective
   * scope with genuinely different instruction text — must NOT be silently
   * resolved (see spec section 9). Callers should hard-stop on any of
   * these rather than proceeding to normal generation for that query. */
  conflicts: SpecialInstructionConflict[];
}

/**
 * Resolves which active Special Instructions apply to the advisor's current
 * question, per SOURCE PRECEDENCE #0 / spec sections 8-9 & 12:
 *   1. Scope-filter deterministically (Insurer/Product match against the
 *      resolved query scope) — never fuzzy, never AI-judged.
 *   2. Topic-filter by embedding similarity between `queryEmbedding` (the
 *      SAME query embedding queryAssist.ts already computed for kbChunks
 *      retrieval — no extra embedding call) and each candidate's stored
 *      `topicEmbedding`. This is what stops a "Free Period" instruction
 *      from firing on an unrelated "Organ Donor Expenses" question for the
 *      same insurer/product (spec section 8's own example) — scope alone
 *      is never sufficient, per section 12's explicit warning against
 *      keyword-only matching.
 *   3. Group survivors by topic (case-insensitive) and keep only the
 *      highest specificity level present per topic (spec section 9).
 *   4. Within each topic's top-specificity set, multiple Override Rules
 *      with genuinely different instruction text are a conflict — reported
 *      separately, never auto-resolved. A single Override Rule (or several
 *      with identical text) applies normally; Additional Information/
 *      General Instruction rows never conflict with each other since they
 *      carry no override authority.
 */
export async function resolveApplicableInstructions(
  repos: Repositories,
  scope: QueryAssistScope,
  effectivePlanTags: string[],
  queryEmbedding: number[]
): Promise<ApplicableSpecialInstructions> {
  const active = await repos.specialInstructions.listActive();
  if (active.length === 0) {
    return { overrideRules: [], advisory: [], conflicts: [] };
  }

  const candidates = active
    .filter(row => scopeMatches(row, scope, effectivePlanTags))
    .filter(row => cosineSimilarity(queryEmbedding, row.topicEmbedding) >= TOPIC_RELEVANCE_THRESHOLD);

  const byTopic = new Map<string, SpecialInstructionRow[]>();
  for (const row of candidates) {
    const key = row.topic.trim().toLowerCase();
    const list = byTopic.get(key);
    if (list) list.push(row);
    else byTopic.set(key, [row]);
  }

  const overrideRules: SpecialInstructionRow[] = [];
  const advisory: SpecialInstructionRow[] = [];
  const conflicts: SpecialInstructionConflict[] = [];

  for (const rows of byTopic.values()) {
    const maxRank = Math.max(...rows.map(specificityRank));
    const topRows = rows.filter(r => specificityRank(r) === maxRank);

    const overridesHere = topRows.filter(r => r.instructionType === "override_rule");
    const advisoryHere = topRows.filter(r => r.instructionType !== "override_rule");

    const distinctOverrideTexts = new Set(overridesHere.map(r => r.instructionText.trim()));
    if (distinctOverrideTexts.size > 1) {
      // Two+ active Override Rules at the same effective scope disagree —
      // flag, don't apply either (spec section 9's hard requirement).
      conflicts.push({ topic: overridesHere[0].topic, instructions: overridesHere });
    } else if (overridesHere.length > 0) {
      overrideRules.push(overridesHere[0]);
    }

    advisory.push(...advisoryHere);
  }

  return { overrideRules, advisory, conflicts };
}
