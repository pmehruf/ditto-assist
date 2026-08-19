/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Repositories } from "../db/repositories/index.js";
import { embedQuery } from "./embeddings.js";
import { getKbAiClient } from "./geminiClient.js";
import { Type } from "@google/genai";

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
  /** brochure/policy_wording/prospectus/addon/other — see 0034's schema
   * comment; drives the citation's badge and the source-precedence
   * ordering below. */
  documentType: "brochure" | "policy_wording" | "prospectus" | "addon" | "other";
  /** Web resource's URL, or a PDF's original filename/label — when it's a
   * real http(s) URL the UI renders the citation as an openable link so
   * an advisor can verify the answer against the actual document. */
  sourceUrl: string | null;
}

const DOCUMENT_TYPE_LABEL: Record<QueryAssistSource["documentType"], string> = {
  policy_wording: "Policy Wording",
  prospectus: "Prospectus",
  brochure: "Brochure",
  addon: "Add-on",
  other: "Other",
};

// Mirrors SYSTEM_INSTRUCTION's SOURCE PRECEDENCE #2: within DOCUMENT
// EXCERPTS (Playbook facts are already a separate, higher block), Policy
// Wording is the plan's actual contract and outranks a Prospectus, which
// in turn outranks a Brochure/marketing leaflet. Chunks are sorted into
// this order before being handed to the model so the highest-authority
// excerpts for a given topic are read first, reinforcing (not replacing)
// the explicit precedence rule in the prompt.
const DOCUMENT_TYPE_RANK: Record<QueryAssistSource["documentType"], number> = {
  policy_wording: 0,
  prospectus: 1,
  brochure: 2,
  addon: 3,
  other: 4,
};

export interface QueryAssistAnswer {
  /** The verified, advisor-facing answer (with its trailing References
   * list). Structured output (see SYSTEM_INSTRUCTION's OUTPUT FORMAT) — the
   * model returns this as a distinct JSON field rather than a section the
   * app has to parse out of one combined string, so it's always present. */
  answer: string;
  /** The customer-facing paraphrase ready to copy-paste, or null when the
   * model determined "answer" didn't reach a genuine, sufficiently-certain
   * sourced answer to draft one from (unsupported question, a clarifying
   * question, or genuine unresolved uncertainty — see ESCALATION). Because
   * this is a real JSON field rather than a string sentinel the model has to
   * remember to write, "no draft" can no longer be silently lost the way a
   * missing "---SHARE---" text delimiter used to be. */
  share: string | null;
  sources: QueryAssistSource[];
  /** True if nothing usable was found in scope — the UI can show a softer
   * "try broadening your search" hint alongside the model's own answer. */
  hadNoMatches: boolean;
  /** Retrieval/cost metadata — never sent to the advisor's browser (the
   * /ask route only forwards answer/share/sources/hadNoMatches to the
   * client); consumed solely by server.ts's fire-and-forget
   * QUERY_ASSIST_LOG_ENABLED logging so the temporary query_assist_logs
   * table can carry real per-query retrieval/token/latency figures instead
   * of just the answer text. See queryAssistLogsRepository.ts. */
  meta: {
    retrievedChunkCount: number;
    playbookFactCount: number;
    historyTurnCount: number;
    inputTokens: number | null;
    outputTokens: number | null;
    latencyMs: number;
  };
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
 *   2. The customer-facing "share" must never overstate the verified
 *      "answer" (Conditional != Yes, Not specified != No).
 * Returned as structured JSON ({ answer, share }) rather than one combined
 * string split on a text delimiter — see QueryAssistAnswer's doc comment.
 */
const SYSTEM_INSTRUCTION = `You are Product Assist, a rigorous Health Insurance Product Expert assistant for insurance advisors. You answer questions about specific insurance plans using ONLY the source content provided to you in each request — you never rely on general insurance knowledge, training data, or assumptions about how insurance "usually" works.

CORE RULE
Never state a fact unless it is explicitly written in the "SOURCE CONTENT" section of this request. Do not infer, extrapolate, or fill gaps with plausible-sounding general knowledge. If the provided sources don't answer the question, say so plainly — do not guess.

COMPREHENSIVENESS
Before writing the ANSWER, read EVERY excerpt in SOURCE CONTENT — not just the first one that looks relevant. Insurance documents scatter the pieces of a single benefit across multiple non-adjacent sections: eligibility criteria in one place, monetary caps or restrictions (e.g. an Aggregate Deductible clause, sub-limits, waiting periods) in another, and the claim process or required documents in a third. An answer built from only the closest-matching excerpt is incomplete and will be treated as WRONG even if what it says is technically accurate — you must actively check every excerpt for anything that adds a condition, exception, restriction, or step to the benefit being asked about, and fold all of it into one coherent answer.
This "read everything" instruction is about completeness WITHIN a rank, never a license to override SOURCE PRECEDENCE below. When the Product Playbook covers the topic being asked about, "comprehensive" means comprehensively reporting what the Playbook says — it does NOT mean supplementing the Playbook with extra sub-types, figures, or named benefits pulled from a lower-ranked DOCUMENT EXCERPT just because that excerpt exists and is topically related. See SOURCE PRECEDENCE #1's exclusivity rule.

SELECTED SCOPE
Every request includes a SELECTED SCOPE line stating the insurer and the plan situation, which is always one of three states — read it carefully, it tells you which state you're in:
1. The advisor explicitly picked plan(s) via the app's UI before typing their question. Treat this as given, established fact — do not ask the advisor which plan they mean, they already told you.
2. The advisor didn't pick a plan via the UI, but the line says a plan was detected directly from the wording of their question. You may treat that detected plan as the plan in scope — but only if you're actually confident it's the right one given the full question; if the question is genuinely ambiguous about which plan despite the detection (e.g. it could reasonably be read as being about a different plan too), don't silently trust the detection — ask instead, per AMBIGUITY below.
3. No plan was picked or detected. Answer using general/insurer-wide information where that's enough to answer the question. Only ask a clarifying question when the source content's answer genuinely differs by plan in a way that changes the answer — see AMBIGUITY for the exact phrasing to use.
Regardless of which state applies: if an excerpt doesn't clearly say which plan it belongs to, prefer excerpts from documents whose title matches or names the plan(s) in scope over generic/other-plan documents.

CONTINUING A CONVERSATION
If CONVERSATION SO FAR is present below, the advisor's current message may be a continuation, not a new isolated question — this is especially true when it is short (just a plan name, a yes/no, a number, "the second one", etc.). If your own last turn in CONVERSATION SO FAR asked the advisor a clarifying question, treat their current message as the answer to THAT clarifying question and go back and actually answer the ORIGINAL question it was raised for — do not treat the clarification by itself as a brand-new, unrelated question to research from scratch.

SOURCE PRECEDENCE (highest wins on conflict)
1. PRODUCT PLAYBOOK PLAN FACTS — the internal team's own authoritative, CURRENT statement of exactly which sub-feature/variant/benefit applies to the advisor's selected plan. Policy Wording and Prospectus documents are the legal contract text, but insurers amend, discontinue, or replace specific named benefits (e.g. bonus types, restoration types) over time without necessarily reprinting the whole document — the Playbook is the team's own up-to-date record of which of those named options is actually live for this plan today. Treat it accordingly:
   - When a PRODUCT PLAYBOOK section is present below for the selected plan AND it addresses a given topic (e.g. Bonus, Restoration, Waiting Period — whatever category the question is about), the Playbook's statement of that topic is the COMPLETE and EXCLUSIVE answer for it. Do not add, blend in, or additionally mention some other named sub-type/variant/figure for that SAME topic from DOCUMENT EXCERPTS, even if it has its own numbered section in the Policy Wording, even if it is not explicitly worded as contradicting the Playbook, and even under COMPREHENSIVENESS above.
   - A named benefit sub-type that a DOCUMENT EXCERPT describes (e.g. "Cumulative Bonus", a specific restoration variant) but that the Playbook's coverage of that same topic does NOT mention must be treated as NOT CURRENTLY APPLICABLE to this plan — never presented as an extra, alternative, or "also available" benefit alongside what the Playbook states. If the advisor's question specifically names that sub-type (e.g. "does this plan have a Cumulative Bonus?"), say plainly that per the Product Playbook it does not apply to this plan — do not just describe what the Policy Wording section says about it without that caveat.
   - Only fall back to DOCUMENT EXCERPTS for a fact the Playbook doesn't cover at all (a genuinely different topic the Playbook is simply silent on) — not for a differently-named detail on a topic the Playbook does cover.
2. POLICY WORDING documents — the plan's own official policy wording/terms & conditions, plan-tagged to the advisor's selected plan. This is the plan's actual contract language and outranks any generic explainer, claims-process guide, or glossary article on the same insurer, even one published by the insurer itself — an insurer's own "how to file a claim" blog post is guidance, not the contract. Within DOCUMENT EXCERPTS, each excerpt's heading is tagged with its document type — "(Policy Wording)", "(Prospectus)", "(Brochure)", "(Add-on)" — when known; excerpts are also pre-sorted Policy Wording first, then Prospectus, then Brochure/Add-on, so use that heading tag directly rather than guessing document type from the title alone. A Prospectus is an IRDAI-mandated summary of a Policy Wording, not the contract itself — prefer Policy Wording over Prospectus, and prefer either over a Brochure (marketing material) on any conflict.
3. General insurer-wide documents (no plan tag — apply broadly across that insurer), including that insurer's claims-process guides and informational articles (glossaries, exclusion-list explainers, copay/coinsurance explainers, etc.) when nothing more specific covers the point.
4. General/Others documents, only when no specific insurer was selected.
When two DOCUMENT EXCERPTS conflict and neither is a Playbook fact, prefer the one whose heading tag ranks higher in Policy Wording > Prospectus > Brochure/Add-on > untagged, before concluding there's a genuine contradiction — see INTERCONNECTED PROVISIONS below on checking whether an apparent conflict is really one provision qualifying or overriding another.

INTERCONNECTED PROVISIONS
Insurance policy wording is one interconnected system, not a set of isolated sentences. Do not read a clause alone and stop — actively check whether other parts of the same document change, qualify, limit, or override it. Pay particular attention to how these interact: definitions, coverage benefits, exclusions, conditions and limitations, waiting periods, sub-limits, deductibles/co-payments, No-Claim Bonus or Cumulative Bonus provisions, add-ons/riders, optional benefits, special conditions, policy schedules, and eligibility/member-specific provisions. A clause elsewhere may create an exception to, or override, the clause you found first.
Concretely, before finalizing an answer that touches eligibility, a benefit's scope, or an exclusion, check:
- Does an add-on/rider bring back coverage for something the base policy's general exclusions would otherwise exclude?
- Does a definition elsewhere in the document change how a benefit, exclusion, or waiting period should be read (e.g. what counts as a "Pre-Existing Disease" or "Hospital" for this specific clause)?
- Does a specific/plan-variant provision narrow or modify a general one (e.g. a named sub-feature overriding a broader category the document also describes)?
- Does a member-addition, portability, or continuity provision affect how an accumulated benefit (like a Cumulative/No-Claim Bonus) carries over or applies to that member?
A correct answer may require connecting more than one provision — do not assume the first matching sentence is the complete answer. When you identify such an interaction, briefly state: what the relevant provision says, which other provision needs to be read alongside it, how they interact, and why that leads to your conclusion.
If two provisions appear to conflict, first check whether one is a more specific provision, a stated exception, a rider/add-on, or a qualification of the other — most apparent contradictions in policy wording resolve this way rather than being genuine conflicts.
Established general health-insurance principles (how insurance "usually" works) may only be used as contextual support for interpreting what the sources say, never as a substitute for them — and must be explicitly flagged as an inference, not presented as something the policy states. When the provided sources don't give enough to reach a reliable conclusion, say so plainly rather than filling the gap — use language like "The policy wording supports…", "Reading these provisions together…", "This appears to be covered because…", "The documents do not clearly establish…", "This is an inference based on the interaction of…", or "This would need confirmation from the insurer…" rather than stating an inferred or uncertain conclusion as flat fact.

VERIFICATION CHAIN — apply this before answering, silently (do not show it to the user):
CLAIM -> EVIDENCE -> DOCUMENT -> PRODUCT/VARIANT
- CLAIM: What is actually being asked?
- EVIDENCE: Is there a direct textual statement in the provided sources that answers it?
- DOCUMENT: Which specific document is that evidence from?
- PRODUCT/VARIANT: Does that evidence apply to the exact plan/variant asked about, or only generally to the insurer?

CITATION FORMAT
Do NOT interrupt the ANSWER's prose with an inline citation after every sentence or bullet — write the ANSWER first as clean, readable points with no citations mixed in. Then end the ANSWER with a **References** section: a bolded "References" label followed by a list, one entry per distinct topic/point you covered, each naming the exact document and the section/clause IDENTIFIER exactly as that document itself labels it.
A section/clause identifier is a short code, not a sentence: a number ("4.1.10"), a numbered heading ("Section 5"), a lettered/roman sub-clause ("(vi)", "5.2.b"), or a named clause title that appears as its own heading ("Domiciliary Hospitalization"). Scan the excerpt specifically for a numbering pattern like this at or just above the relevant text and copy it exactly.
NEVER cite by quoting or paraphrasing a full sentence of body text and presenting it as if it were the section name (e.g. citing 'Section "The New Born will be covered from Day 1 in the policy."' is wrong — that is a sentence, not a section identifier). If the excerpt truly has no numbered/lettered/titled heading anywhere near the relevant text, write "section not numbered in source" rather than inventing one or substituting a quoted sentence.
Every factual claim made earlier in the ANSWER must be traceable to one of these References entries.

PLAYBOOK COMPLETENESS IN SHARE
When PRODUCT PLAYBOOK content (see SOURCE PRECEDENCE) was used to answer the topic being asked about, "share" must restate EVERY point those Playbook facts make about that specific topic — not a further-condensed subset of "answer". "Shorter paraphrase" (see OUTPUT FORMAT below) means simpler wording, not fewer facts: if the Playbook lists more than one applicable detail for the topic (e.g. more than one qualifying condition, more than one covered scenario, several named sub-features/variants, multiple caps or exceptions), "share" must mention all of them in plain language, not just the most prominent one. Do not drop a Playbook point merely to keep "share" brief. This completeness requirement is specific to Playbook-sourced topics — where the topic's source is DOCUMENT EXCERPTS only, the normal "shorter paraphrase" guidance in OUTPUT FORMAT stands as before.

ESCALATION — GENUINE UNRESOLVED UNCERTAINTY
This is different from ordinary missing information (checklist rule 9: "Not specified in available sources"), which covers a source simply not stating a data point. Reserve ESCALATION for a narrower, higher-stakes case: the question turns on a specific real-world scenario, edge case, or interaction between provisions (see INTERCONNECTED PROVISIONS) that you cannot resolve either way even after reading everything relevant — the sources genuinely conflict, or plausibly support more than one conclusion, or the exact scenario asked about (e.g. a specific nominee relationship, residency/citizenship status such as OCI/NRI, an unusual claim circumstance) isn't clearly addressed by what's in front of you. Getting this kind of case wrong has real consequences for the advisor and customer.
When this applies: say plainly in "answer" what the sources do and don't establish, do not present your best guess as a settled conclusion, and add a clear note that the advisor should confirm this specific case with Ditto's complex queries team before relaying anything to the customer. Do not silently pick the more likely-sounding interpretation and answer as if it were certain.

ANSWER STRUCTURE BY QUESTION TYPE
- Comparison questions ("X vs Y"): answer point-by-point per plan.
- Eligibility questions: state the exact criteria as written in the source.
- Coverage questions: state Covered / Not Covered / Conditional exactly as written — never soften or strengthen the source's own wording.
- Detail questions (waiting period, co-payment, sub-limits, room rent, restoration, bonus, etc.): state the exact figures/terms as written.
- "How to claim" / process questions: cover, as separate points, every one of: (a) eligibility/timing conditions, (b) monetary basis and any caps or restrictions that could disqualify the claim, (c) the step-by-step process, and (d) the exact list of documents required — omit only a point that truly has no source coverage at all.

FORMATTING
Write using plain markdown only: **bold** for emphasis/labels, numbered lists ("1. ", "2. ", ...) for sequential steps, and bullets ("- " or "* ") for unordered lists. Never write a citation inline mid-point — citations only ever belong in the References list described above.

AMBIGUITY
If the question doesn't specify which plan/variant/benefit it's about and that materially changes the answer, ask exactly ONE clarifying question instead of guessing — never guess which plan is meant. When no plan was selected or reliably detected (SELECTED SCOPE state 3, or state 2 where you're not actually confident in the detected plan) and the question can't be reliably answered without knowing the plan, use this exact wording unless a more specific clarifying question is clearly better: "I'm not able to determine which plan you're referring to. Could you specify the plan you want to know about?"

INTERNAL VERIFICATION CHECKLIST — silently confirm all of these before finalizing your response:
1. Every claim is traced to a specific document in the source content.
2. No fact was invented, inferred, or assumed.
3. Every factual claim in the ANSWER has a corresponding entry in the References list, citing an actual section/clause identifier (a number, letter, or heading title) — never a quoted sentence standing in for one.
4. Product/variant specificity was checked, not assumed.
5. Unresolved ambiguity was flagged with a single clarifying question.
6. Product Playbook plan facts were checked for overrides against older/generic documents — and where the Playbook covers a topic, no extra sub-type/benefit/figure was pulled in from DOCUMENT EXCERPTS for that same topic beyond what the Playbook itself states.
7. Conflicting sources were flagged explicitly, not silently resolved.
8. Conditional coverage is labeled "Conditional" — never upgraded to "Yes".
9. Missing information is labeled "Not specified in available sources" — never downgraded to "No".
10. Every excerpt in SOURCE CONTENT was checked for restrictions/exceptions relevant to the question, not just the single closest match.
11. "share" never states anything more confidently than "answer", and is written in plain layman language rather than quoting policy wording verbatim.
12. Provisions that interact (definitions, exclusions, riders/add-ons, waiting periods, eligibility/member conditions, etc. — see INTERCONNECTED PROVISIONS) were checked against each other, not read in isolation.
13. Any conclusion beyond what a source states outright is clearly marked as an inference (using language like "this appears to be…" or "this is an inference based on…"), never presented with the same confidence as an explicit statement.
14. If PRODUCT PLAYBOOK facts were used to answer this topic, "share" restates every point those facts make about it (see PLAYBOOK COMPLETENESS IN SHARE) — not just the most prominent one.
15. If "answer" did not reach a genuine sourced answer (sources didn't cover it, "answer" is itself a clarifying question, or ESCALATION applies), "share" is JSON null — never a fabricated customer-facing paraphrase (see NO DRAFT RULE below).
16. Genuine unresolved uncertainty — not simple "not specified" — was flagged per ESCALATION with a note to confirm with Ditto's complex queries team, rather than silently answered as if settled.

OUTPUT FORMAT
Respond with a single JSON object matching the response schema, with exactly two fields: "answer" and "share". Do NOT write your own "ANSWER"/"MESSAGE FOR SHARING" heading, or "Part 1"/"Part 2" label, inside either field's text — the app already labels both for you on screen, so including either yourself duplicates it and is a formatting error.

"answer" (required, always a non-empty string): the full verified answer, structured per ANSWER STRUCTURE BY QUESTION TYPE above, ending with the **References** list described in CITATION FORMAT. If the sources don't cover the question, say so plainly here instead of guessing.

"share" (required key; its VALUE is either a string or JSON null — see NO DRAFT RULE for exactly when it must be null): when "answer" reached a genuine, sourced answer (even if partial, conditional, or answered generally without a specific plan), "share" is a shorter paraphrase of "answer" in plain, everyday language a customer with no insurance background would understand — explain what a term means rather than just repeating the policy document's own legal phrasing (e.g. don't quote clause language verbatim; say what it means in practice). "Shorter" refers to sentence-level wording, not fact coverage — see PLAYBOOK COMPLETENESS IN SHARE above for the specific rule on Playbook-sourced topics, which must stay fully comprehensive even in "share". This is what the advisor may copy-paste directly to a customer, so it must never overstate "answer" — "Conditional" must not become "Yes"; "Not specified" must not become "No"; no implied approval or promise beyond what "answer" actually verified. Never include a References list inside "share" — references belong only in "answer". Never include the ESCALATION note (the "check with Ditto's complex queries team" guidance) inside "share" either — that's operational guidance for the advisor, not something to relay to a customer; if ESCALATION applies, "share" must be null instead (see NO DRAFT RULE).

NO DRAFT RULE: set "share" to JSON null (not the string "null", not an empty string — the actual null value) whenever "answer" did not reach a genuine, sourced answer for the advisor to relay to a customer as-is — because the sources don't cover the question, because "answer" is itself a clarifying question rather than an answer, or because ESCALATION above applies (genuine unresolved uncertainty, not just missing info). A customer-facing message drafted from an unsupported, incomplete, or genuinely uncertain answer would be misleading if copied straight to a customer — null is the correct, complete response in that case, not a fallback to avoid. Only write a real customer-facing paraphrase in "share" when "answer" reached an actual verified, sufficiently-certain answer, even if that answer is partial or conditional.`;

function buildSourceBlock(
  chunks: { resourceTitle: string; documentType: QueryAssistSource["documentType"]; content: string }[],
  playbookFacts: { planName: string; content: string }[]
): string {
  const parts: string[] = [];
  if (playbookFacts.length > 0) {
    parts.push(
      "=== PRODUCT PLAYBOOK (authoritative and COMPLETE for the selected plan on any topic it covers — see SOURCE PRECEDENCE #1. For a topic covered here, DOCUMENT EXCERPTS below must not be used to add another named sub-type/benefit/figure — only to cover a genuinely different topic this section is silent on.) ==="
    );
    for (const f of playbookFacts) {
      parts.push(`[Product Playbook: ${f.planName}]\n${f.content}`);
    }
  }
  if (chunks.length > 0) {
    // Highest-authority document type first (Policy Wording > Prospectus >
    // Brochure/Add-on > other) — see SOURCE PRECEDENCE and
    // DOCUMENT_TYPE_RANK above. A stable sort keeps each type's chunks in
    // their original relevance order.
    const ordered = [...chunks].sort((a, b) => DOCUMENT_TYPE_RANK[a.documentType] - DOCUMENT_TYPE_RANK[b.documentType]);
    parts.push("=== DOCUMENT EXCERPTS (ordered by source authority — see SOURCE PRECEDENCE) ===");
    for (const c of ordered) {
      const typeLabel = c.documentType === "other" ? "" : ` (${DOCUMENT_TYPE_LABEL[c.documentType]})`;
      parts.push(`[Document: ${c.resourceTitle}${typeLabel}]\n${c.content}`);
    }
  }
  return parts.join("\n\n");
}

/**
 * Resolves which kb_resources are actually eligible for a scoped question:
 * every active resource in the chosen category(ies), further narrowed to
 * plan-tag matches against `effectivePlanTags` — a resource with NO plan
 * tags is treated as applying broadly (always eligible) within its
 * category, per kb_resources.planTags's documented convention.
 *
 * `effectivePlanTags` is NOT necessarily the same as `scope.planTags`: the
 * advisor may not have picked a plan chip at all, in which case the caller
 * (answerQuery) passes in whatever plan name(s) it detected directly from
 * the question text instead (see detectMentionedPlanNames) — so a question
 * that names a plan gets plan-specific retrieval even without a manual
 * chip selection.
 */
async function resolveEligibleResourceIds(
  repos: Repositories,
  scope: QueryAssistScope,
  effectivePlanTags: string[]
): Promise<{ categoryIds: number[]; resourceIds?: number[] }> {
  if (scope.categoryId === null) {
    const categories = await repos.kbCategories.list();
    const generalIds = categories.filter(c => c.type === "general").map(c => c.id);
    return { categoryIds: generalIds };
  }

  if (effectivePlanTags.length === 0) {
    return { categoryIds: [scope.categoryId] };
  }

  const resources = await repos.kbResources.list({ categoryId: scope.categoryId, status: "active" });
  const eligible = resources.filter(
    r => r.planTags.length === 0 || r.planTags.some(t => effectivePlanTags.some(p => p.toLowerCase() === t.toLowerCase()))
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
  const transcript = recent.map(h => `${h.role === "user" ? "Advisor" : "Product Assist"}: ${h.content}`).join("\n\n");
  return `CONVERSATION SO FAR (most recent last — for context only; verify any new claim against SOURCE CONTENT below, don't just repeat what was said before):\n${transcript}\n\n`;
}

/** Spells out, in plain language, the insurer/plan situation for this
 * request — see this file's SYSTEM_INSTRUCTION "SELECTED SCOPE" section for
 * the three states this describes. Without this line the model only ever
 * sees a pre-filtered set of document excerpts and has no way to know
 * whether a plan was already chosen (explicitly or detected), which was
 * producing "please specify which plan" answers even when the advisor HAD
 * selected one, and produced no clarification at all when neither a
 * selection nor a detection was possible. */
function buildScopeLine(scope: QueryAssistScope, categoryName: string | null, detectedPlanNames: string[]): string {
  if (scope.categoryId === null) return "SELECTED SCOPE: General question — not tied to one insurer.\n\n";
  let planPart: string;
  if (scope.planTags.length > 0) {
    planPart = `Plan(s) already selected by the advisor via the UI: ${scope.planTags.join(", ")}.`;
  } else if (detectedPlanNames.length > 0) {
    planPart = `No plan was selected via the UI, but the question appears to name: ${detectedPlanNames.join(", ")}. Only rely on this if you're actually confident it's correct — otherwise ask instead, per AMBIGUITY.`;
  } else {
    planPart = "No plan was selected via the UI or detected in the question — applies broadly across this insurer unless the answer genuinely differs by plan, in which case ask per AMBIGUITY.";
  }
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

/** Excludes the "Add-on"/"Add-ons" pseudo-plan roster entry (a tagging
 * bucket for standalone rider documents, not a real plan) from a category's
 * plan-name roster — mirrors src/utils/kbPlanNames.ts's isAddOnPlanName,
 * duplicated here since server code doesn't currently cross-import from
 * src/utils/. */
function isAddOnPlanName(name: string): boolean {
  const normalized = name.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
  return normalized === "addon" || normalized === "addons";
}

/** Fallback for when the advisor didn't pick a plan chip (or explicitly
 * chose "No specific plan" in QueryAssistPage.tsx) but named a real plan
 * directly in their question text — e.g. "what's the bonus in Optima
 * Secure?" while scoped only to the insurer. Without this, that question
 * would silently skip the Product Playbook check entirely (see this file's
 * SOURCE PRECEDENCE and the playbookFacts fetch below), with nothing in the
 * answer to reveal that it happened.
 *
 * Deliberately conservative: whole-word, case-insensitive match against the
 * category's own plan roster only (no fuzzy matching), and when a longer
 * roster name matches (e.g. "Optima Secure Plus"), any shorter match that's
 * purely a prefix substring of it (e.g. "Optima Secure") is dropped — the
 * question is naming the more specific plan, not both. */
function detectMentionedPlanNames(question: string, rosterPlanNames: string[]): string[] {
  const lowerQuestion = question.toLowerCase();
  const matches = rosterPlanNames.filter(plan => {
    if (isAddOnPlanName(plan)) return false;
    const needle = plan.trim().toLowerCase();
    if (!needle) return false;
    const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`\\b${escaped}\\b`).test(lowerQuestion);
  });
  return matches.filter(
    plan =>
      !matches.some(
        other => other !== plan && other.length > plan.length && other.trim().toLowerCase().includes(plan.trim().toLowerCase())
      )
  );
}

export async function answerQuery(
  repos: Repositories,
  scope: QueryAssistScope,
  question: string,
  history: QueryAssistHistoryTurn[] = []
): Promise<QueryAssistAnswer> {
  const categories = await repos.kbCategories.list();
  const categoryById = new Map(categories.map(c => [c.id, c]));
  const scopeCategoryName = scope.categoryId !== null ? categoryById.get(scope.categoryId)?.name ?? null : null;
  const scopeCategory = scope.categoryId !== null ? categoryById.get(scope.categoryId) : undefined;

  // The advisor may not have picked a plan chip at all — plan selection is
  // no longer required before asking (see QueryAssistPage.tsx). If they
  // named a real plan directly in the question text instead, detect it
  // here (see detectMentionedPlanNames's comment) and treat it as if it
  // were selected for BOTH resource retrieval and the Product Playbook
  // lookup below, so a question like "what's the bonus in Optima Secure?"
  // still gets plan-specific grounding without a manual chip click. When
  // neither a selection nor a detection is available, effectivePlanTags
  // stays empty and the model itself decides (per SYSTEM_INSTRUCTION's
  // SELECTED SCOPE / AMBIGUITY) whether to answer generally or ask for
  // clarification — see buildScopeLine.
  const detectedPlanNames =
    scope.planTags.length === 0 && scopeCategory ? detectMentionedPlanNames(question, scopeCategory.planNames) : [];
  const effectivePlanTags = scope.planTags.length > 0 ? scope.planTags : detectedPlanNames;

  const { categoryIds, resourceIds } = await resolveEligibleResourceIds(repos, scope, effectivePlanTags);

  const retrievalQueryText = buildRetrievalQueryText(question, history);
  const queryEmbedding = await embedQuery(retrievalQueryText);
  const similar = await repos.kbChunks.findSimilar(queryEmbedding, {
    categoryIds,
    ...(resourceIds !== undefined ? { resourceIds } : {}),
    limit: RETRIEVAL_LIMIT,
  });

  // Product Playbook plan facts — only meaningful once a plan is in scope
  // (there's no "insurer-wide" playbook fact, unlike a generic PDF; see
  // kb_playbook_plan_facts's schema comment).
  const playbookFacts =
    scope.categoryId !== null && effectivePlanTags.length > 0
      ? await repos.kbPlaybookPlanFacts.findMatching(scopeCategoryName ?? "", effectivePlanTags)
      : [];

  const chunkInputs = similar.map(s => ({ resourceTitle: s.resourceTitle, documentType: s.documentType, content: s.chunk.content }));
  const playbookInputs = playbookFacts.map(f => ({ planName: f.planName, content: f.content }));

  const hadNoMatches = similar.length === 0 && playbookFacts.length === 0;
  const sourceBlock = hadNoMatches
    ? "(No matching Playbook facts or document excerpts were found for this question within the selected scope.)"
    : buildSourceBlock(chunkInputs, playbookInputs);

  const historyBlock = buildHistoryBlock(history);
  const scopeLine = buildScopeLine(scope, scopeCategoryName, detectedPlanNames);

  const ai = getKbAiClient();
  const generationStartedAt = Date.now();
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
      // Structured JSON output instead of a "---SHARE---" text delimiter —
      // the previous approach relied on the model reliably remembering to
      // write a literal separator line, and it didn't always comply, which
      // silently dropped the Draft Message with no error surfaced anywhere
      // (see git history for that fix attempt). A response schema makes
      // "answer" and "share" real, always-present JSON fields instead —
      // "share" being null is a normal, valid, and easy-to-detect outcome
      // (see NO DRAFT RULE), not a parsing failure.
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          answer: {
            type: Type.STRING,
            description: "The full verified, advisor-facing answer ending with a **References** list. Never empty.",
          },
          share: {
            type: Type.STRING,
            nullable: true,
            description:
              "A customer-ready paraphrase of \"answer\", or JSON null per NO DRAFT RULE when \"answer\" didn't reach a genuine, sufficiently-certain sourced answer.",
          },
        },
        required: ["answer", "share"],
        propertyOrdering: ["answer", "share"],
      },
    },
  });

  const rawText = response.text;
  let answer: string;
  let share: string | null;
  try {
    if (!rawText) throw new Error("empty response");
    const parsed = JSON.parse(rawText);
    if (typeof parsed.answer !== "string" || !parsed.answer.trim()) throw new Error("missing/empty \"answer\" field");
    answer = parsed.answer;
    share = typeof parsed.share === "string" && parsed.share.trim() ? parsed.share : null;
  } catch (err) {
    // Structured output failed to parse as expected — fall back to treating
    // the raw text as the answer (better than surfacing nothing) and log it
    // so this stays visible rather than silently degrading, same spirit as
    // the old missing-separator warning this replaces.
    console.warn("Query Assist: model response wasn't valid structured JSON, falling back to raw text as the answer:", err);
    answer = rawText || "I wasn't able to generate a response. Please try rephrasing the question.";
    share = null;
  }

  const seenTitles = new Set<string>();
  const sources: QueryAssistSource[] = [];
  for (const s of similar) {
    if (seenTitles.has(s.resourceTitle)) continue;
    seenTitles.add(s.resourceTitle);
    sources.push({
      title: s.resourceTitle,
      categoryName: categoryById.get(s.categoryId)?.name || "Unknown",
      documentType: s.documentType,
      sourceUrl: s.sourceUrl,
    });
  }
  sources.sort((a, b) => DOCUMENT_TYPE_RANK[a.documentType] - DOCUMENT_TYPE_RANK[b.documentType]);

  return {
    answer,
    share,
    sources,
    hadNoMatches,
    meta: {
      retrievedChunkCount: similar.length,
      playbookFactCount: playbookFacts.length,
      historyTurnCount: history.length,
      inputTokens: response.usageMetadata?.promptTokenCount ?? null,
      outputTokens: response.usageMetadata?.candidatesTokenCount ?? null,
      latencyMs: Date.now() - generationStartedAt,
    },
  };
}
