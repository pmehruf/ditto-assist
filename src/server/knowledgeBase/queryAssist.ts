/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Repositories } from "../db/repositories/index.js";
import { embedQuery } from "./embeddings.js";
import { getKbAiClient } from "./geminiClient.js";

const GENERATION_MODEL = "gemini-2.5-flash";
// Raised from 14 — insurance documents scatter the eligibility, monetary
// restrictions (e.g. Aggregate Deductible), and claim-process detail for a
// single benefit across multiple non-adjacent sections. A tighter top-k
// was under-recalling those secondary sections (they rank a bit further
// from the query embedding than the "obvious" match), producing answers
// that covered the first-found section but silently dropped restrictions
// that materially changed the answer.
const RETRIEVAL_LIMIT = 24;
// How many prior turns (user+assistant messages combined) from the client's
// local conversation history to fold into the prompt for multi-turn
// context. Kept small since assistant turns include the full dual-section
// output — this is about resolving pronouns/follow-ups ("what about the
// waiting period for that?"), not re-verifying old answers.
const MAX_HISTORY_TURNS = 4;

export interface QueryAssistScope {
  /** null = a "General" question, not tied to any one insurer. */
  categoryId: number | null;
  /** Plan names to scope to within the chosen insurer. Empty = the whole
   * insurer (every resource, regardless of its own plan tags). */
  planTags: string[];
}

export interface QueryAssistHistoryTurn {
  role: "user" | "assistant";
  content: string;
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

COMPREHENSIVENESS
Before writing the ANSWER, read EVERY excerpt in SOURCE CONTENT — not just the first one that looks relevant. Insurance documents scatter the pieces of a single benefit across multiple non-adjacent sections: eligibility criteria in one place, monetary caps or restrictions (e.g. an Aggregate Deductible clause, sub-limits, waiting periods) in another, and the claim process or required documents in a third. An answer built from only the closest-matching excerpt is incomplete and will be treated as WRONG even if what it says is technically accurate — you must actively check every excerpt for anything that adds a condition, exception, restriction, or step to the benefit being asked about, and fold all of it into one coherent answer.

SELECTED SCOPE
Every request includes a SELECTED SCOPE line stating the insurer and, if the advisor already picked one, the specific plan(s) — chosen by the advisor through the app's UI BEFORE they typed their question. This is given, established context, not something to re-ask about:
- If SELECTED SCOPE names specific plan(s), and SOURCE CONTENT's excerpts cover multiple plans/variants of that insurer, restrict your ANSWER to only the named plan(s) — do not ask the advisor which plan they mean, they already told you via SELECTED SCOPE.
- Only ask a clarifying question about which plan is meant when SELECTED SCOPE itself says no specific plan was selected AND the source content's answer genuinely differs by plan in a way that changes the answer.
- If an excerpt doesn't clearly say which plan it belongs to, prefer excerpts from documents whose title matches or names the SELECTED SCOPE plan(s) over generic/other-plan documents.

CONTINUING A CONVERSATION
If CONVERSATION SO FAR is present below, the advisor's current message may be a continuation, not a new isolated question — this is especially true when it is short (just a plan name, a yes/no, a number, "the second one", etc.). If your own last turn in CONVERSATION SO FAR asked the advisor a clarifying question, treat their current message as the answer to THAT clarifying question and go back and actually answer the ORIGINAL question it was raised for — do not treat the clarification by itself as a brand-new, unrelated question to research from scratch.

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
Do NOT interrupt the ANSWER's prose with an inline citation after every sentence or bullet — write the ANSWER first as clean, readable points with no citations mixed in. Then end the ANSWER with a **References** section: a bolded "References" label followed by a list, one entry per distinct topic/point you covered, each naming the exact document and the section/clause IDENTIFIER exactly as that document itself labels it.
A section/clause identifier is a short code, not a sentence: a number ("4.1.10"), a numbered heading ("Section 5"), a lettered/roman sub-clause ("(vi)", "5.2.b"), or a named clause title that appears as its own heading ("Domiciliary Hospitalization"). Scan the excerpt specifically for a numbering pattern like this at or just above the relevant text and copy it exactly.
NEVER cite by quoting or paraphrasing a full sentence of body text and presenting it as if it were the section name (e.g. citing 'Section "The New Born will be covered from Day 1 in the policy."' is wrong — that is a sentence, not a section identifier). If the excerpt truly has no numbered/lettered/titled heading anywhere near the relevant text, write "section not numbered in source" rather than inventing one or substituting a quoted sentence.
Every factual claim made earlier in the ANSWER must be traceable to one of these References entries.

ANSWER STRUCTURE BY QUESTION TYPE
- Comparison questions ("X vs Y"): answer point-by-point per plan.
- Eligibility questions: state the exact criteria as written in the source.
- Coverage questions: state Covered / Not Covered / Conditional exactly as written — never soften or strengthen the source's own wording.
- Detail questions (waiting period, co-payment, sub-limits, room rent, restoration, bonus, etc.): state the exact figures/terms as written.
- "How to claim" / process questions: cover, as separate points, every one of: (a) eligibility/timing conditions, (b) monetary basis and any caps or restrictions that could disqualify the claim, (c) the step-by-step process, and (d) the exact list of documents required — omit only a point that truly has no source coverage at all.

FORMATTING
Write using plain markdown only: **bold** for emphasis/labels, numbered lists ("1. ", "2. ", ...) for sequential steps, and bullets ("- " or "* ") for unordered lists. Never write a citation inline mid-point — citations only ever belong in the References list described above.

AMBIGUITY
If the question doesn't specify which plan/variant/benefit it's about and that materially changes the answer, ask exactly ONE clarifying question instead of guessing.

INTERNAL VERIFICATION CHECKLIST — silently confirm all of these before finalizing your response:
1. Every claim is traced to a specific document or announcement in the source content.
2. No fact was invented, inferred, or assumed.
3. Every factual claim in the ANSWER has a corresponding entry in the References list, citing an actual section/clause identifier (a number, letter, or heading title) — never a quoted sentence standing in for one.
4. Product/variant specificity was checked, not assumed.
5. Unresolved ambiguity was flagged with a single clarifying question.
6. Announcements were checked for overrides against older documents.
7. Conflicting sources were flagged explicitly, not silently resolved.
8. Conditional coverage is labeled "Conditional" — never upgraded to "Yes".
9. Missing information is labeled "Not specified in available sources" — never downgraded to "No".
10. Every excerpt in SOURCE CONTENT was checked for restrictions/exceptions relevant to the question, not just the single closest match.
11. Part 2 (below) never states anything more confidently than Part 1, and is written in plain layman language rather than quoting policy wording verbatim.

OUTPUT FORMAT
Produce exactly two parts, separated by a line containing ONLY the text ---SHARE--- and nothing else on that line. Do NOT write your own "ANSWER" or "MESSAGE FOR SHARING" heading anywhere — the app already labels both parts for you, so including either heading yourself duplicates it on screen and is a formatting error.

Part 1 (before ---SHARE---): the full verified answer, structured per ANSWER STRUCTURE BY QUESTION TYPE above, ending with the **References** list described in CITATION FORMAT. If the sources don't cover the question, say so plainly here instead of guessing.

Part 2 (after ---SHARE---): a shorter paraphrase of Part 1 in plain, everyday language a customer with no insurance background would understand — explain what a term means rather than just repeating the policy document's own legal phrasing (e.g. don't quote clause language verbatim; say what it means in practice). This is what the advisor may copy-paste to a customer, so it must never overstate Part 1 — "Conditional" must not become "Yes"; "Not specified" must not become "No"; no implied approval or promise beyond what Part 1 actually verified. If Part 1 couldn't answer the question, this part should tell the advisor to confirm with the product team rather than answer the customer. Do not include a References list here — references belong only in Part 1.`;

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

/** Renders the client's local-memory conversation history (see
 * QueryAssistPage.tsx — nothing is persisted server-side) as a short
 * transcript prefix so follow-up questions ("what about the waiting
 * period for that?") resolve correctly, without re-verifying prior turns
 * against SOURCE CONTENT again. */
function buildHistoryBlock(history: QueryAssistHistoryTurn[]): string {
  const recent = history.slice(-MAX_HISTORY_TURNS);
  if (recent.length === 0) return "";
  const transcript = recent.map(h => `${h.role === "user" ? "Advisor" : "Query Assist"}: ${h.content}`).join("\n\n");
  return `CONVERSATION SO FAR (most recent last — for context only; verify any new claim against SOURCE CONTENT below, don't just repeat what was said before):\n${transcript}\n\n`;
}

/** Spells out, in plain language, the insurer/plan the advisor already
 * picked via the UI — see this file's SYSTEM_INSTRUCTION "SELECTED SCOPE"
 * section. Without this line the model only ever sees a pre-filtered set
 * of document excerpts and has no way to know a plan was already chosen,
 * which was producing "please specify which plan" answers even when the
 * advisor HAD selected one. */
function buildScopeLine(scope: QueryAssistScope, categoryName: string | null): string {
  if (scope.categoryId === null) return "SELECTED SCOPE: General question — not tied to one insurer.\n\n";
  const planPart =
    scope.planTags.length > 0
      ? `Plan(s) already selected by the advisor: ${scope.planTags.join(", ")}.`
      : "No specific plan selected — applies broadly across this insurer.";
  return `SELECTED SCOPE: Insurer: ${categoryName ?? "Unknown"}. ${planPart}\n\n`;
}

/** Prior USER turns only (never assistant turns, which are long and would
 * dilute the embedding) folded into the text that gets embedded for
 * retrieval. A short follow-up like "Care Supreme" answering the model's
 * own clarifying question would otherwise retrieve near-random chunks
 * about Care Supreme in general — prefixing the original question keeps
 * retrieval anchored to what's actually being asked (e.g. domiciliary
 * coverage restrictions), not just the latest short reply. */
function buildRetrievalQueryText(question: string, history: QueryAssistHistoryTurn[]): string {
  const priorUserTurns = history
    .filter(h => h.role === "user")
    .slice(-3)
    .map(h => h.content);
  return [...priorUserTurns, question].join("\n");
}

export async function answerQuery(
  repos: Repositories,
  scope: QueryAssistScope,
  question: string,
  history: QueryAssistHistoryTurn[] = []
): Promise<QueryAssistAnswer> {
  const { categoryIds, resourceIds } = await resolveEligibleResourceIds(repos, scope);

  const categories = await repos.kbCategories.list();
  const categoryById = new Map(categories.map(c => [c.id, c]));
  const scopeCategoryName = scope.categoryId !== null ? categoryById.get(scope.categoryId)?.name ?? null : null;

  const retrievalQueryText = buildRetrievalQueryText(question, history);
  const queryEmbedding = await embedQuery(retrievalQueryText);
  const similar = await repos.kbChunks.findSimilar(queryEmbedding, {
    categoryIds,
    ...(resourceIds !== undefined ? { resourceIds } : {}),
    limit: RETRIEVAL_LIMIT,
  });

  const announcementCategoryIds = scope.categoryId === null ? [] : [scope.categoryId];
  const announcements = await repos.kbAnnouncements.listActiveFor(announcementCategoryIds);

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

  const historyBlock = buildHistoryBlock(history);
  const scopeLine = buildScopeLine(scope, scopeCategoryName);

  const ai = getKbAiClient();
  const response = await ai.models.generateContent({
    model: GENERATION_MODEL,
    contents: [
      {
        role: "user",
        parts: [{ text: `${historyBlock}${scopeLine}SOURCE CONTENT:\n${sourceBlock}\n\nADVISOR'S QUESTION:\n${question}` }],
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
