/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Repositories } from "../db/repositories/index.js";
import { embedQuery } from "./embeddings.js";
import { getKbAiClient } from "./geminiClient.js";

const GENERATION_MODEL = "gemini-2.5-flash";
const RETRIEVAL_LIMIT = 14;

export interface QueryAssistScope {
  /** null = a "General" question, not tied to any one insurer. */
  categoryId: number | null;
  /** Plan names to scope to within the chosen insurer. Empty = the whole
   * insurer (every resource, regardless of its own plan tags). */
  planTags: string[];
}

export interface QueryAssistSource {
  title: string;
  categoryName: string;
}

export interface QueryAssistAnswer {
  /** Full raw model output — contains both the "1. ANSWER" and "2. MESSAGE
   * FOR SHARING" sections; the UI splits on those headers to render them
   * as two blocks. */
  text: string;
  sources: QueryAssistSource[];
  /** True if nothing usable was found in scope — the UI can show a softer
   * "try broadening your search" hint alongside the model's own answer. */
  hadNoMatches: boolean;
}

/**
 * Query Assist's system instruction. Adapted from the detailed Health
 * Insurance Product Expert prompt the user already runs against NotebookLM
 * over the same 14 policy-wording PDFs — same verification discipline and
 * dual-output format, generalized for this app rather than referencing
 * NotebookLM. Two hard rules carried over unchanged:
 *   1. Never state a fact that isn't explicitly present in the provided
 *      source content below — no inference from general insurance
 *      knowledge, no filling gaps.
 *   2. The customer-facing "MESSAGE FOR SHARING" must never overstate the
 *      verified "ANSWER" (Conditional != Yes, Not specified != No).
 */
const SYSTEM_INSTRUCTION = `You are Query Assist, a rigorous Health Insurance Product Expert assistant for insurance advisors. You answer questions about specific insurance plans using ONLY the source content provided to you in each request — you never rely on general insurance knowledge, training data, or assumptions about how insurance "usually" works.

CORE RULE
Never state a fact unless it is explicitly written in the "SOURCE CONTENT" section of this request. Do not infer, extrapolate, or fill gaps with plausible-sounding general knowledge. If the provided sources don't answer the question, say so plainly — do not guess.

SOURCE PRECEDENCE (highest wins on conflict)
1. ANNOUNCEMENTS — dated product-team updates. These ALWAYS override older PDF/web content if they conflict on the same fact. If an announcement contradicts a document below it, the announcement is the source of truth.
2. Plan-tagged documents, when the advisor selected a specific plan.
3. General insurer-wide documents (no plan tag — apply broadly across that insurer).
4. General/Others documents, only when no specific insurer was selected.

VERIFICATION CHAIN — apply this before answering, silently (do not show it to the user):
CLAIM -> EVIDENCE -> DOCUMENT -> PRODUCT/VARIANT
- CLAIM: What is actually being asked?
- EVIDENCE: Is there a direct textual statement in the provided sources that answers it?
- DOCUMENT: Which specific document or announcement is that evidence from?
- PRODUCT/VARIANT: Does that evidence apply to the exact plan/variant asked about, or only generally to the insurer?

CITATION FORMAT
Every factual claim in the ANSWER must cite its source inline, in this exact format:
Primary Reference: [Exact document name] — [Section/Page if identifiable from the source content]

ANSWER STRUCTURE BY QUESTION TYPE
- Comparison questions ("X vs Y"): answer point-by-point per plan, each point individually cited.
- Eligibility questions: state the exact criteria as written in the source, cited.
- Coverage questions: state Covered / Not Covered / Conditional exactly as written, cited — never soften or strengthen the source's own wording.
- Detail questions (waiting period, co-payment, sub-limits, room rent, restoration, bonus, etc.): quote the exact figures/terms as written, cited.

AMBIGUITY
If the question doesn't specify which plan/variant/benefit it's about and that materially changes the answer, ask exactly ONE clarifying question instead of guessing.

INTERNAL VERIFICATION CHECKLIST — silently confirm all of these before finalizing your response:
1. Every claim is traced to a specific document or announcement in the source content.
2. No fact was invented, inferred, or assumed.
3. A Primary Reference citation is attached to every factual claim.
4. Product/variant specificity was checked, not assumed.
5. Unresolved ambiguity was flagged with a single clarifying question.
6. Announcements were checked for overrides against older documents.
7. Conflicting sources were flagged explicitly, not silently resolved.
8. Conditional coverage is labeled "Conditional" — never upgraded to "Yes".
9. Missing information is labeled "Not specified in available sources" — never downgraded to "No".
10. The MESSAGE FOR SHARING never states anything more confidently than the ANSWER.

OUTPUT FORMAT — always produce exactly these two sections, in this order:

1. ANSWER
[Your full verified answer, structured per the question type above, every claim with an inline Primary Reference citation. If the sources don't cover the question, say so directly here instead of guessing.]

2. MESSAGE FOR SHARING
[A shorter, customer-safe paraphrase of the ANSWER. This is what the advisor may copy-paste to a customer, so it must never overstate the ANSWER — "Conditional" must not become "Yes"; "Not specified" must not become "No"; no implied approval or promises beyond what the ANSWER actually verified. If the ANSWER couldn't answer the question, this section should tell the advisor to confirm with the product team rather than answer the customer.]`;

function buildSourceBlock(chunks: { resourceTitle: string; content: string }[], announcements: { title: string; body: string; effectiveDate: string }[]): string {
  const parts: string[] = [];
  if (announcements.length > 0) {
    parts.push("=== ANNOUNCEMENTS (always override older documents on conflict) ===");
    for (const a of announcements) {
      parts.push(`[Announcement: ${a.title} — effective ${a.effectiveDate}]\n${a.body}`);
    }
  }
  if (chunks.length > 0) {
    parts.push("=== DOCUMENT EXCERPTS ===");
    for (const c of chunks) {
      parts.push(`[Document: ${c.resourceTitle}]\n${c.content}`);
    }
  }
  return parts.join("\n\n");
}

/**
 * Resolves which kb_resources are actually eligible for a scoped question:
 * every active resource in the chosen category(ies), further narrowed to
 * plan-tag matches when the advisor picked specific plan(s) — a resource
 * with NO plan tags is treated as applying broadly (always eligible)
 * within its category, per kb_resources.planTags's documented convention.
 */
async function resolveEligibleResourceIds(
  repos: Repositories,
  scope: QueryAssistScope
): Promise<{ categoryIds: number[]; resourceIds?: number[] }> {
  if (scope.categoryId === null) {
    const categories = await repos.kbCategories.list();
    const generalIds = categories.filter(c => c.type === "general").map(c => c.id);
    return { categoryIds: generalIds };
  }

  if (scope.planTags.length === 0) {
    return { categoryIds: [scope.categoryId] };
  }

  const resources = await repos.kbResources.list({ categoryId: scope.categoryId, status: "active" });
  const eligible = resources.filter(
    r => r.planTags.length === 0 || r.planTags.some(t => scope.planTags.some(p => p.toLowerCase() === t.toLowerCase()))
  );
  return { categoryIds: [scope.categoryId], resourceIds: eligible.map(r => r.id) };
}

export async function answerQuery(repos: Repositories, scope: QueryAssistScope, question: string): Promise<QueryAssistAnswer> {
  const { categoryIds, resourceIds } = await resolveEligibleResourceIds(repos, scope);

  const queryEmbedding = await embedQuery(question);
  const similar = await repos.kbChunks.findSimilar(queryEmbedding, {
    categoryIds,
    ...(resourceIds !== undefined ? { resourceIds } : {}),
    limit: RETRIEVAL_LIMIT,
  });

  const announcementCategoryIds = scope.categoryId === null ? [] : [scope.categoryId];
  const announcements = await repos.kbAnnouncements.listActiveFor(announcementCategoryIds);

  const categories = await repos.kbCategories.list();
  const categoryById = new Map(categories.map(c => [c.id, c]));

  const chunkInputs = similar.map(s => ({ resourceTitle: s.resourceTitle, content: s.chunk.content }));
  const announcementInputs = announcements.map(a => ({
    title: a.title,
    body: a.body,
    effectiveDate: typeof a.effectiveDate === "string" ? a.effectiveDate : String(a.effectiveDate),
  }));

  const hadNoMatches = similar.length === 0 && announcements.length === 0;
  const sourceBlock = hadNoMatches
    ? "(No matching announcements or document excerpts were found for this question within the selected scope.)"
    : buildSourceBlock(chunkInputs, announcementInputs);

  const ai = getKbAiClient();
  const response = await ai.models.generateContent({
    model: GENERATION_MODEL,
    contents: [
      {
        role: "user",
        parts: [{ text: `SOURCE CONTENT:\n${sourceBlock}\n\nADVISOR'S QUESTION:\n${question}` }],
      },
    ],
    config: {
      systemInstruction: SYSTEM_INSTRUCTION,
      temperature: 0.1,
    },
  });

  const text = response.text ?? "I wasn't able to generate a response. Please try rephrasing the question.";

  const seenTitles = new Set<string>();
  const sources: QueryAssistSource[] = [];
  for (const s of similar) {
    if (seenTitles.has(s.resourceTitle)) continue;
    seenTitles.add(s.resourceTitle);
    sources.push({ title: s.resourceTitle, categoryName: categoryById.get(s.categoryId)?.name || "Unknown" });
  }

  return { text, sources, hadNoMatches };
}
