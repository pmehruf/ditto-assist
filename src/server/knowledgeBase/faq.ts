/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * DITTO FAQ — RETRIEVAL (question-weighted relevance matching).
 *
 * Mirrors specialInstructions.ts's cosine-similarity-against-a-reused-query-
 * embedding approach: rather than a second embedding call, the SAME query
 * embedding queryAssist.ts already computed for kb_chunks retrieval is
 * compared against each FAQ record's questionEmbedding (which, per
 * schema.ts's comment, is computed from the QUESTION text alone — never the
 * answer). That alone is what gives "FAQ question receives the strongest
 * retrieval weight" (spec §9) by construction: there is nothing else to
 * match against.
 *
 * Deliberately NOT scoped by insurer/plan the way Special Instructions are —
 * the Ditto FAQ covers Ditto's own operational process/capability, which per
 * spec §10 is orthogonal to which insurer's documents happen to also be in
 * scope for a given question (e.g. "can we do mid-term inclusion through
 * Ditto?" is relevant regardless of which insurer category the advisor has
 * selected). Every active, answerable, non-conflicting FAQ record is always
 * a retrieval candidate; relevance is decided purely by question-embedding
 * similarity.
 */

import type { Repositories } from "../db/repositories/index.js";
import type { FaqRecordRow } from "../db/schema.js";

// Was 0.6 ("slightly stricter than Special Instructions' 0.55"), on the
// assumption that full-sentence FAQ-question embeddings cluster tightly
// enough for a higher bar to still catch genuine matches. In practice this
// silently dropped the FAQ for exactly the queries that most need it: a
// plan/insurer-specific question (e.g. "What is the chronic care coverage
// in Activ One Max?") embeds close to the plan name and document-style
// phrasing, which pulls its cosine similarity against a generically-worded
// Ditto-process FAQ question below 0.6 even when that FAQ is genuinely the
// right baseline answer — the DITTO FAQ + PRODUCT PLAYBOOK are supposed to
// always be considered as the baseline source, not skipped because the
// wording didn't line up closely enough. Lowered to sit at Special
// Instructions' own 0.55 floor: still a real relevance bar (MAX_FAQ_MATCHES
// below keeps this from ever becoming "dump the whole FAQ in"), just no
// longer stricter than necessary for plan-specific phrasing to still clear it.
export const FAQ_RELEVANCE_THRESHOLD = 0.5;

// Caps how many FAQ entries get folded into one answer's source content —
// a handful of the most relevant matches is enough for even a "mixed"
// question (spec §12); dumping in a dozen loosely-related FAQ answers would
// just dilute the prompt.
const MAX_FAQ_MATCHES = 3;

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

export interface MatchedFaq {
  id: number;
  category: FaqRecordRow["category"];
  question: string;
  answer: string;
  score: number;
}

/**
 * Returns the FAQ records (if any) relevant enough to this question to
 * participate in the answer, sorted by relevance (highest first), capped at
 * MAX_FAQ_MATCHES. Empty array = nothing crossed the relevance bar, which is
 * the normal case for a question the FAQ has nothing to do with — see
 * queryAssist.ts's buildDittoConstitutionBlock, which renders "" (adds
 * nothing to the prompt) when this returns empty, keeping behavior
 * byte-identical to before this feature existed for every question it
 * doesn't apply to.
 */
export async function resolveApplicableFaqs(repos: Repositories, queryEmbedding: number[]): Promise<MatchedFaq[]> {
  const rows = await repos.faqRecords.listAnswerableActive();
  const scored = rows
    .filter(row => row.questionEmbedding !== null)
    .map(row => ({ row, score: cosineSimilarity(queryEmbedding, row.questionEmbedding as unknown as number[]) }))
    .filter(({ score }) => score >= FAQ_RELEVANCE_THRESHOLD)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_FAQ_MATCHES);

  return scored.map(({ row, score }) => ({
    id: row.id,
    category: row.category,
    question: row.question,
    answer: row.answer,
    score,
  }));
}
