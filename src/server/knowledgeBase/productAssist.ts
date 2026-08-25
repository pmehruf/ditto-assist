/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Repositories } from "../db/repositories/index.js";
import type { SimilarKbChunk } from "../db/repositories/kbChunksRepository.js";
import { embedQuery } from "./embeddings.js";
import { getKbAiClient } from "./geminiClient.js";
import { Type } from "@google/genai";
import { resolveApplicableInstructions, type SpecialInstructionConflict } from "./specialInstructions.js";
import { resolveApplicableFaqs, type MatchedFaq } from "./faq.js";
import { resolveMatchedAcronyms, acronymPlanNameMatches, buildAcronymReferenceBlock } from "./acronyms.js";
import type { SpecialInstructionRow } from "../db/schema.js";

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

// ─── Progressive source-priority retrieval (2026-08) ───────────────────────
// Rather than one flat top-RETRIEVAL_LIMIT query across every document type
// at once, retrieveDocumentChunks() below runs Policy Wording -> Prospectus
// -> Brochure/other as separate, escalating stages, stopping as soon as a
// stage (or the FAQ gate before it) already provides enough strong evidence
// — see SOURCE PRECEDENCE #2 in SYSTEM_INSTRUCTION for why that's also the
// correct authority ordering, not just a cost optimization. Total chunks
// retrieved across all stages combined is still capped at RETRIEVAL_LIMIT —
// same worst-case token ceiling as before this existed, just skipped/reduced
// whenever evidence is found early instead of always paying for the full 24.

// Cosine-similarity floor for counting one retrieved chunk as strong
// evidence — reuses the exact bar faq.ts's FAQ_RELEVANCE_THRESHOLD already
// established in this codebase for "is this genuinely relevant", expressed
// here as a distance ceiling since kbChunks.findSimilar returns cosine
// DISTANCE (lower = closer; distance = 1 - similarity for the pgvector
// `<=>` operator — see SimilarKbChunk's own doc comment: "0 = identical
// direction").
const CHUNK_SUFFICIENCY_DISTANCE = 0.5;
// A single close match isn't enough to call a document-type stage
// "sufficient" and skip the next one — RETRIEVAL_LIMIT's own history
// (raised from 14 after under-recall dropped scattered restrictions) shows
// one close match can miss a waiting period, exclusion, or eligibility
// condition stated elsewhere in the same plan's documents. Require a small
// cluster of strong matches before short-circuiting to the next source.
const MIN_SUFFICIENT_CHUNK_MATCHES = 3;
// Deliberately far stricter than FAQ_RELEVANCE_THRESHOLD (0.5 — "is this
// FAQ worth including in the prompt at all"): this gates skipping Policy
// Wording/Prospectus/Brochure retrieval ENTIRELY, so it's reserved for a
// near-exact match to a curated Ditto FAQ question, not merely a
// topically-related one. Product Playbook is deliberately NOT part of this
// gate: unlike the FAQ (scored per-question via questionEmbedding), Playbook
// facts are intentionally NOT topic-scored — see kbPlaybookPlanFacts's
// schema.ts comment: they're always injected in full once a plan matches,
// specifically so a partial-relevance check can't silently drop the one
// line that actually answers the question. There is no existing signal
// that safely says "Playbook already covers this exact topic", so Playbook
// presence alone never skips document-chunk retrieval.
const FAQ_SUFFICIENCY_THRESHOLD = 0.85;

function isSufficientEvidence(chunks: SimilarKbChunk[]): boolean {
  return chunks.filter(c => c.distance <= CHUNK_SUFFICIENCY_DISTANCE).length >= MIN_SUFFICIENT_CHUNK_MATCHES;
}

/**
 * Progressive, document-type-scoped chunk retrieval — see the module
 * comment above for the full rationale. Never queries a lower-priority
 * document type once a higher-priority one (or the FAQ gate) already
 * provides sufficient evidence per isSufficientEvidence(), and never
 * returns more than RETRIEVAL_LIMIT chunks combined across every stage.
 */
async function retrieveDocumentChunks(
  repos: Repositories,
  queryEmbedding: number[],
  categoryIds: number[],
  resourceIds: number[] | undefined,
  faqMatches: MatchedFaq[]
): Promise<SimilarKbChunk[]> {
  const baseOptions = { categoryIds, ...(resourceIds !== undefined ? { resourceIds } : {}) };

  // FAQ SUFFICIENCY GATE — spec's "FAQ/Playbook sufficient -> STOP", applied
  // via the FAQ half only (see FAQ_SUFFICIENCY_THRESHOLD's comment for why
  // Playbook can't safely participate). A near-exact match to a curated
  // Ditto FAQ question is trusted enough to skip document-chunk retrieval
  // entirely for this question.
  if (faqMatches.some(f => f.score >= FAQ_SUFFICIENCY_THRESHOLD)) {
    return [];
  }

  let accumulated: SimilarKbChunk[] = await repos.kbChunks.findSimilar(queryEmbedding, {
    ...baseOptions,
    documentTypes: ["policy_wording"],
    limit: RETRIEVAL_LIMIT,
  });
  if (isSufficientEvidence(accumulated)) return accumulated;

  // Prospectus: searched next whenever Policy Wording didn't already settle
  // it — whether because no Policy Wording resource exists in scope
  // (accumulated came back empty) or because what came back wasn't enough
  // (spec section 5's two OR conditions).
  const prospectusLimit = RETRIEVAL_LIMIT - accumulated.length;
  if (prospectusLimit > 0) {
    const prospectus = await repos.kbChunks.findSimilar(queryEmbedding, {
      ...baseOptions,
      documentTypes: ["prospectus"],
      limit: prospectusLimit,
    });
    accumulated = [...accumulated, ...prospectus];
    if (isSufficientEvidence(accumulated)) return accumulated;
  }

  // Brochure/addon/other — the final, lowest-priority fallback tier, only
  // ever reached once both higher tiers were checked and insufficient.
  const remainingLimit = RETRIEVAL_LIMIT - accumulated.length;
  if (remainingLimit > 0) {
    const brochureAndOther = await repos.kbChunks.findSimilar(queryEmbedding, {
      ...baseOptions,
      documentTypes: ["brochure", "addon", "other"],
      limit: remainingLimit,
    });
    accumulated = [...accumulated, ...brochureAndOther];
  }
  return accumulated;
}

export interface ProductAssistScope {
  /** null = a "General" question, not tied to any one insurer. */
  categoryId: number | null;
  /** Plan names to scope to within the chosen insurer. Empty = the whole
   * insurer (every resource, regardless of its own plan tags). */
  planTags: string[];
}

export interface ProductAssistHistoryTurn {
  role: "user" | "assistant";
  content: string;
}

export interface ProductAssistSource {
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

const DOCUMENT_TYPE_LABEL: Record<ProductAssistSource["documentType"], string> = {
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
const DOCUMENT_TYPE_RANK: Record<ProductAssistSource["documentType"], number> = {
  policy_wording: 0,
  prospectus: 1,
  brochure: 2,
  addon: 3,
  other: 4,
};

export interface ProductAssistAnswer {
  /** The verified, advisor-facing answer (with its trailing References
   * list). Structured output (see SYSTEM_INSTRUCTION's OUTPUT FORMAT) — the
   * model returns this as a distinct JSON field rather than a section the
   * app has to parse out of one combined string, so it's always present. */
  answer: string;
  /** The customer-facing paraphrase ready to copy-paste. Present whenever
   * "answer" reached a real conclusion grounded in retrieved evidence (see
   * NO DRAFT RULE) — including a conclusion reached by interpreting the
   * advisor's plain-language terms against a source's precise wording, and
   * one that carries a qualifying condition or exclusion. Null only when
   * there's genuinely no source coverage for the question, "answer" is
   * itself a clarifying question, or genuine unresolved uncertainty applies
   * (see ESCALATION) — not merely because the answer required judgment.
   * Because this is a real JSON field rather than a string sentinel the
   * model has to remember to write, "no draft" can no longer be silently
   * lost the way a missing "---SHARE---" text delimiter used to be. */
  share: string | null;
  sources: ProductAssistSource[];
  /** True if nothing usable was found in scope — the UI can show a softer
   * "try broadening your search" hint alongside the model's own answer. */
  hadNoMatches: boolean;
  /** Retrieval/cost metadata — never sent to the advisor's browser (the
   * /ask route only forwards answer/share/sources/hadNoMatches to the
   * client); consumed solely by server.ts's fire-and-forget
   * PRODUCT_ASSIST_LOG_ENABLED logging so the temporary product_assist_logs
   * table can carry real per-query retrieval/token/latency figures instead
   * of just the answer text. See productAssistLogsRepository.ts. */
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
 * Product Assist's system instruction. Adapted from the detailed Health
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
 * string split on a text delimiter — see ProductAssistAnswer's doc comment.
 */
export const SYSTEM_INSTRUCTION = `You are Product Assist, a rigorous Health Insurance Product Expert assistant for insurance advisors. You answer questions about specific insurance plans using ONLY the source content provided to you in each request — you never rely on general insurance knowledge, training data, or assumptions about how insurance "usually" works.

CORE RULE
Never state a fact unless it is explicitly written in the "SOURCE CONTENT" section of this request. Do not infer, extrapolate, or fill gaps with plausible-sounding general knowledge. If the provided sources don't answer the question, say so plainly — do not guess.

ACRONYM REFERENCE
An ACRONYM REFERENCE block, when present above SOURCE CONTENT, is Ditto's own admin-curated glossary of shorthand this specific advisor's question used (e.g. "OS" = "Optima Secure", "CBB" = "Cumulative Bonus Super") — authoritative reference data, not general knowledge, so using it does not violate CORE RULE. Read the advisor's question as if every listed acronym were written out in full, and answer accordingly — never call out, define, or explain the acronym back to the advisor (they already know what their own shorthand means), and never treat an acronym you don't recognize and that isn't listed there as a typo or error — if it's genuinely unclear what an unlisted acronym refers to, ask per AMBIGUITY rather than guessing.

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
0. SPECIAL INSTRUCTIONS — a small set of controlled instructions an authorised Developer/Platform Admin has entered for specific topics, checked BEFORE everything below. When a SPECIAL INSTRUCTIONS section is present, it contains up to two kinds of content, already pre-filtered for topic and scope relevance to this exact question — never present just because a keyword matches:
   - OVERRIDE RULE entries (marked "[Override Rule]"): the single highest authority in this entire prompt. For the topic it names, its statement is the COMPLETE and EXCLUSIVE answer — treat it exactly like PRODUCT PLAYBOOK's exclusivity rule below (rule #1), one rung higher: do not blend in, soften, or add to it from the Playbook or any DOCUMENT EXCERPT for that same topic, even if they appear to add relevant detail.
   - ADDITIONAL INFORMATION / GENERAL INSTRUCTION entries (marked accordingly): supplementary context or handling guidance ONLY — never a source of facts. Use these to shape how you explain a topic (e.g. what to be careful to distinguish, common confusions to avoid), but the actual product/policy facts still come from PRODUCT PLAYBOOK / DOCUMENT EXCERPTS below exactly as they would without this entry. Never let one of these entries substitute for, override, or contradict an actual sourced fact.
1. ORG CONSTITUTION — the internal team's own authoritative, Ditto-owned sources, consisting of TWO EQUAL-AUTHORITY peers: PRODUCT PLAYBOOK PLAN FACTS and DITTO FAQ. Neither automatically outranks the other — which one (or both) actually answers a given question depends on the question's INTENT, per the sub-rules below. Both together outrank everything in DOCUMENT EXCERPTS/tiers 2-4.
   1a. PRODUCT PLAYBOOK PLAN FACTS — the team's authoritative, CURRENT statement of exactly which sub-feature/variant/benefit applies to the advisor's selected plan. Policy Wording and Prospectus documents are the legal contract text, but insurers amend, discontinue, or replace specific named benefits (e.g. bonus types, restoration types) over time without necessarily reprinting the whole document — the Playbook is the team's own up-to-date record of which of those named options is actually live for this plan today. Relevant to RECOMMENDATION / product-positioning / which-variant-is-live questions. Treat it accordingly:
      - When a PRODUCT PLAYBOOK section is present below for the selected plan AND it addresses a given topic (e.g. Bonus, Restoration, Waiting Period — whatever category the question is about), the Playbook's statement of that topic is the COMPLETE and EXCLUSIVE answer for it. Do not add, blend in, or additionally mention some other named sub-type/variant/figure for that SAME topic from DOCUMENT EXCERPTS, even if it has its own numbered section in the Policy Wording, even if it is not explicitly worded as contradicting the Playbook, and even under COMPREHENSIVENESS above.
      - A named benefit sub-type that a DOCUMENT EXCERPT describes (e.g. "Cumulative Bonus", a specific restoration variant) but that the Playbook's coverage of that same topic does NOT mention must be treated as NOT CURRENTLY APPLICABLE to this plan — never presented as an extra, alternative, or "also available" benefit alongside what the Playbook states. If the advisor's question specifically names that sub-type (e.g. "does this plan have a Cumulative Bonus?"), say plainly that per the Product Playbook it does not apply to this plan — do not just describe what the Policy Wording section says about it without that caveat.
      - Only fall back to DOCUMENT EXCERPTS for a fact the Playbook doesn't cover at all (a genuinely different topic the Playbook is simply silent on) — not for a differently-named detail on a topic the Playbook does cover.
   1b. DITTO FAQ — Ditto's own official position on DITTO'S OWN process, capability, availability, or operational handling: whether something is possible/available THROUGH DITTO, whether Ditto facilitates a given action, how Ditto handles a particular situation, or an insurer-wise difference in how something works through Ditto specifically. Relevant to Ditto-operational/process/capability questions ("can we do this through Ditto?", "does Ditto support this?", "what's the Ditto process for X?", "can an advisor offer/process this?") — see SELECTED SCOPE-independent: a DITTO FAQ entry may be relevant regardless of which insurer's documents are also in scope, since it describes Ditto's own stance, not the insurer's. Treat it accordingly:
      - A DITTO FAQ entry present below is Ditto's authoritative, exclusive statement of DITTO'S OWN position/process/capability for the topic it names — do not soften, contradict, or second-guess it based on what a DOCUMENT EXCERPT says an insurer itself allows.
      - CRITICAL — INSURER FACT vs DITTO POSITION are two DIFFERENT questions and must never be collapsed into one: a DOCUMENT EXCERPT or the PRODUCT PLAYBOOK states what the INSURER/PRODUCT itself permits; a DITTO FAQ entry states what DITTO ITSELF facilitates/does. If both are present and they diverge (e.g. the insurer's policy wording permits mid-term inclusion, but the Ditto FAQ says Ditto does not currently facilitate it), state BOTH facts distinctly and clearly — never let one silently override or replace the other in the answer, and never present only one as if it were the complete picture. Equally, if Ditto's FAQ says something CAN be facilitated but no DOCUMENT EXCERPT/Playbook content confirms the insurer/product itself permits it, do not tell the advisor the product allows it — state only what's actually established for each side of the question.
      - A question that is PURELY about Ditto's own process/capability (no insurer-permission dimension to it) is fully answered by the DITTO FAQ entry alone when one applies — do not go hunting in DOCUMENT EXCERPTS for an insurer-side answer to a question that was never about the insurer.
   1c. MIXED / BOTH-NEEDED questions (e.g. "does the insurer allow this, and can Ditto facilitate it?", "should we recommend this plan, and can we process this request through Ditto?") — when the question's intent spans both what a product/plan supports (Playbook/DOCUMENT EXCERPTS territory) and what Ditto itself facilitates (DITTO FAQ territory), use BOTH sources together and cover both parts distinctly in the answer. Never force one source to answer a part of the question that actually belongs to the other, and never apply a blanket "FAQ always wins" or "Playbook always wins" rule — the selection is intent-based per question, as described above.
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

EVIDENCE → RULE → CONDITION → CONCLUSION (mandatory reasoning step — fill in the "synthesis" JSON fields before writing "answer")
Retrieved source content is evidence, not the answer — your job is to interpret it into a conclusion, not to hand the advisor a summary of what the sources say and leave them to work out what it means. Whenever the question turns on whether a stated fact, procedure, condition, or circumstance satisfies a rule/requirement/eligibility criterion in the sources, work through this explicitly via the "synthesis" fields before writing "answer":
1. requirement — What exact rule/condition/requirement do the applicable sources state, per SOURCE PRECEDENCE (checking Special Instructions, then ORG CONSTITUTION, then DOCUMENT EXCERPTS in that order)? Preserve the source's own specific terms — do not loosely re-describe a named procedure, condition, or figure into a broader category (e.g. keep "PTCA/angioplasty performed at least 1 year prior" intact; do not flatten it to "a heart procedure").
2. userFacts — What exact fact(s) did the advisor's question state about the customer's situation, in the advisor's own terms? Do not read in a fact the question doesn't actually state.
3. comparison — Compare userFacts against requirement on their real, specific terms: is userFacts the SAME thing the requirement names, a DIFFERENT-BUT-RELATED procedure/condition/term, a SUPERSET/SUBSET of it, or genuinely UNCLEAR relative to it? A related-but-different medical/procedural/product term is NOT automatically equivalent to the term the requirement names (e.g. a diagnostic angiogram is a different procedure from PTCA/angioplasty — the presence of one does not establish the other) — treat two terms as equivalent ONLY when a source explicitly says so, never by assumption or by general medical/product knowledge.
4. resolution — Based purely on that comparison, pick exactly one: SATISFIED (userFacts clearly meet requirement), NOT_SATISFIED (userFacts clearly fail requirement, or are explicitly excluded by it), INSUFFICIENT_INFORMATION (the sources or the advisor's stated facts genuinely don't give enough to decide either way), or NO_REQUIREMENT_FOUND (no source states an applicable rule for this specific question at all).

APPLY YOUR INSURANCE-EXPERT KNOWLEDGE TO STEP 3 (comparison) — do not reduce it to literal string-matching. You are a Health Insurance Product Expert: read the advisor's plain-language description the way an experienced advisor would, and match it against the source's own precise terms using standard medical/insurance terminology and the source's own definitions. This is interpreting what the advisor's own stated words mean, not inventing a new fact about the customer, so it does not violate CORE RULE or checklist rule 2. For example: if the advisor's question states only "an angiogram" with no mention of angioplasty or stenting, and the source's requirement is "PTCA/angioplasty" while explicitly excluding "diagnostic angiography without angioplasty/stent insertion," recognize that a plain, unqualified "angiogram" is the diagnostic-only procedure the source excludes — angioplasty and stent insertion are distinct, more invasive procedures an advisor would ordinarily name if they had occurred. Do NOT default to INSUFFICIENT_INFORMATION merely because the advisor didn't repeat the source's exact technical wording. Reserve INSUFFICIENT_INFORMATION for when, even after applying that expertise, the advisor's description could genuinely fall on either side of the requirement with no reasonable way to tell which, or the uploaded resources themselves are simply silent on the deciding detail.

"answer" must then be written FROM that resolution — see ANSWER STRUCTURE BY QUESTION TYPE and HEDGING DISCIPLINE below for exactly how each resolution should read. Never perform this reasoning and then still hand the advisor an "it says X, it says Y" restatement — the entire point of this step is to reach, and actually state, the conclusion those facts produce.

CITATION FORMAT
Do NOT interrupt the ANSWER's prose with an inline citation after every sentence or bullet — write the ANSWER first as clean, readable points with no citations mixed in, and no bolded FAQ question or any other citation-like marker inside that prose either (see DITTO FAQ CITATION below — a Ditto FAQ citation is a References entry too, never inline). Then end the ANSWER with a **References** section: a bolded "References" label followed by a list, one entry per distinct topic/point you covered, each naming the exact document and the section/clause IDENTIFIER exactly as that document itself labels it — except a Ditto FAQ entry, which follows DITTO FAQ CITATION's own different format instead.
A section/clause identifier is a short code, not a sentence: a number ("4.1.10"), a numbered heading ("Section 5"), a lettered/roman sub-clause ("(vi)", "5.2.b"), or a named clause title that appears as its own heading ("Domiciliary Hospitalization"). Scan the excerpt specifically for a numbering pattern like this at or just above the relevant text and copy it exactly.
NEVER cite by quoting or paraphrasing a full sentence of body text and presenting it as if it were the section name (e.g. citing 'Section "The New Born will be covered from Day 1 in the policy."' is wrong — that is a sentence, not a section identifier). If the excerpt truly has no numbered/lettered/titled heading anywhere near the relevant text, write "section not numbered in source" rather than inventing one or substituting a quoted sentence.
Every factual claim made earlier in the ANSWER must be traceable to one of these References entries.

DITTO FAQ CITATION — NON-NEGOTIABLE
The Ditto FAQ is internal team knowledge, never an external citable source, and must never be exposed to the advisor as one. When a DITTO FAQ entry materially supported your answer:
- Write the ANSWER's prose naturally, stating the fact/position the FAQ supports — do NOT interrupt the prose with the FAQ question, a bolded reference to it, or any inline citation for it (this differs from before — the FAQ question no longer appears inline in the prose).
- Instead, add it as its own entry in the **References** list (the same list CITATION FORMAT describes) — the matched FAQ QUESTION verbatim, prefixed "FAQ- ", in **bold markdown** (i.e. "- **FAQ- <the exact matched question>**"). Never a section/clause identifier for this entry — it isn't from a document.
- Never write "According to the Ditto FAQ", "Source: Ditto FAQ", "the FAQ says", or any similar attribution phrase anywhere in "answer" or "share". The bolded FAQ question in References is the advisor's recognizable reference point — advisors already have their own FAQ search in the CRM and will recognize the exact question.
- NEVER mention, name, link to, or otherwise reveal the Google Sheet, a spreadsheet/tab/file name, a source URL, or any internal resource metadata for the Ditto FAQ, under any circumstance, even if asked directly what the source is.
- This rule applies ONLY to where/how the Ditto FAQ itself is cited. DOCUMENT EXCERPTS/Playbook citations still follow CITATION FORMAT above exactly as before — nothing about that changes.

PLAYBOOK COMPLETENESS IN SHARE
When PRODUCT PLAYBOOK content (see SOURCE PRECEDENCE) was used to answer the topic being asked about, "share" must restate EVERY point those Playbook facts make about that specific topic — not a further-condensed subset of "answer". "Shorter paraphrase" (see OUTPUT FORMAT below) means simpler wording, not fewer facts: if the Playbook lists more than one applicable detail for the topic (e.g. more than one qualifying condition, more than one covered scenario, several named sub-features/variants, multiple caps or exceptions), "share" must mention all of them in plain language, not just the most prominent one. Do not drop a Playbook point merely to keep "share" brief. This completeness requirement is specific to Playbook-sourced topics — where the topic's source is DOCUMENT EXCERPTS only, the normal "shorter paraphrase" guidance in OUTPUT FORMAT stands as before.

ESCALATION — GENUINE UNRESOLVED UNCERTAINTY
This is different from ordinary missing information (checklist rule 9: "Not specified in available sources"), which covers a source simply not stating a data point. Reserve ESCALATION for a narrower, higher-stakes case: the question turns on a specific real-world scenario, edge case, or interaction between provisions (see INTERCONNECTED PROVISIONS) that you cannot resolve either way even after reading everything relevant — the sources genuinely conflict, or plausibly support more than one conclusion, or the exact scenario asked about (e.g. a specific nominee relationship, residency/citizenship status such as OCI/NRI, an unusual claim circumstance) isn't clearly addressed by what's in front of you. Getting this kind of case wrong has real consequences for the advisor and customer.
When this applies: say plainly in "answer" what the sources do and don't establish, do not present your best guess as a settled conclusion, and add a clear note that the advisor should raise a task in the Complex Cases Desk (CCD) space before relaying anything to the customer. Do not silently pick the more likely-sounding interpretation and answer as if it were certain.

HEDGING DISCIPLINE
Only use conditional/uncertain language ("it depends", "may", "could", "please check", "you may want to confirm") when synthesis.resolution is INSUFFICIENT_INFORMATION or NO_REQUIREMENT_FOUND, or when ESCALATION above genuinely applies. Never hedge merely because more than one document was retrieved, because the topic has several sub-conditions, or as a generic safety cushion — if synthesis.resolution is SATISFIED or NOT_SATISFIED, state that conclusion plainly and directly per ANSWER STRUCTURE below; a qualifying condition gets stated as the REASON/QUALIFYING CONDITION part of that structure, not used as a reason to avoid answering.

ANSWER STRUCTURE BY QUESTION TYPE
When synthesis.resolution is SATISFIED or NOT_SATISFIED, lead "answer" with the direct conclusion, in this order — CONCLUSION → REASON → QUALIFYING CONDITION/EXCEPTION (if any): state Yes/No/Covered/Not Covered/Eligible/Not Eligible first, in one direct sentence, then the decisive reason (the requirement from synthesis, compared against the stated facts), then a qualifying condition or exception only if one actually changes or nuances the conclusion. Do not open by restating what the source says and leave the advisor to work out the conclusion themselves — state the conclusion, then support it. Do not over-explain once the conclusion is clear; a short, direct answer is correct when the evidence is clear-cut.

DECISIVE vs SECONDARY QUALIFYING CONDITIONS — this distinction changes how the OPENING sentence itself must read, not just what comes after it:
- A condition is DECISIVE when it is the actual thing determining whether the conclusion applies to the specific scenario the advisor described — i.e. the question can't really be answered without that condition holding true for their facts. Fold it directly into the opening conclusion sentence itself ("Yes, provided [the decisive condition] — ...", "Yes, as long as [condition]...", "No, unless [condition]..."), never as a bare unconditional "Yes"/"No" with the real determining condition surfacing only several sentences later. A flat "Yes" followed eventually by the condition that actually decides it reads as more certain than the sources support, and makes the crux of the answer look like a minor afterthought — this is the failure mode to avoid.
- A condition is SECONDARY when the conclusion already holds cleanly on the facts given, and the condition is a genuine exception/edge-case that would not change the answer for the advisor's actual situation. State the plain conclusion first, then the condition, per the base structure above.
- When genuinely unsure which of the two applies, treat the condition as DECISIVE — folding it into the opening sentence never makes an answer worse, only more honest about what's actually established for this specific scenario.
- Yes/No, eligibility, and "does X qualify for Y" questions: apply the CONCLUSION → REASON → QUALIFYING CONDITION structure above, folding any DECISIVE condition into the opening conclusion sentence itself per DECISIVE vs SECONDARY QUALIFYING CONDITIONS.
- Comparison questions ("X vs Y"): answer point-by-point per plan, applying the same direct-conclusion-first structure within each point where synthesis.resolution supports one.
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
15. "share" is JSON null only per NO DRAFT RULE's specific cases (genuinely no source coverage, "answer" is itself a clarifying question, or ESCALATION applies) — never nulled merely because reaching the conclusion required interpreting the advisor's plain-language terms or the conclusion carries a qualifying condition/exclusion; a SATISFIED/NOT_SATISFIED conclusion always gets a real "share" paraphrase.
16. Genuine unresolved uncertainty — not simple "not specified" — was flagged per ESCALATION with a note to raise a task in the Complex Cases Desk (CCD) space, rather than silently answered as if settled.
17. Any SPECIAL INSTRUCTIONS section was checked first (SOURCE PRECEDENCE #0): an Override Rule entry for this topic was treated as complete and exclusive, never blended with lower-ranked sources; Additional Information/General Instruction entries were used only to shape explanation, never as a substitute for an actual sourced fact.
18. If a DITTO FAQ entry was present (SOURCE PRECEDENCE #1b): source selection between it and PRODUCT PLAYBOOK was based on the question's actual intent, never a blanket "FAQ always wins"/"Playbook always wins" rule; if both an insurer/product fact and a Ditto FAQ position were relevant, both were stated distinctly (what the insurer/product allows vs. what Ditto itself facilitates) rather than one silently overriding the other; if the FAQ materially supported the answer, its matched question appears in **bold**, prefixed "FAQ- ", as its own entry in the References list per DITTO FAQ CITATION — never inline in the answer's prose — with no source/spreadsheet ever named.
19. The synthesis step explicitly compared the advisor's stated facts against the applicable requirement on their actual, specific terms — a related-but-different medical/procedural/product term was never treated as equivalent to what the requirement names unless a source itself equates them.
20. Where synthesis.resolution was SATISFIED or NOT_SATISFIED, "answer" opened with the direct conclusion per ANSWER STRUCTURE's CONCLUSION → REASON → QUALIFYING CONDITION, not a bare restatement of source text left for the advisor to interpret; any DECISIVE qualifying condition (per DECISIVE vs SECONDARY QUALIFYING CONDITIONS) was folded into that opening sentence itself, never left as an unconditional "Yes"/"No" with the real determining condition surfacing only later; hedging language was used only where HEDGING DISCIPLINE actually permits it.

OUTPUT FORMAT
Respond with a single JSON object matching the response schema, with exactly three fields: "synthesis", "answer", and "share". Fill them in that order — "synthesis" is your internal reasoning workspace (see EVIDENCE → RULE → CONDITION → CONCLUSION above) and is never shown to the advisor, so it has no formatting requirements beyond its own field descriptions; "answer" and "share" are advisor/customer-facing text. Do NOT write your own "ANSWER"/"MESSAGE FOR SHARING" heading, or "Part 1"/"Part 2" label, inside either field's text — the app already labels both for you on screen, so including either yourself duplicates it and is a formatting error.

"synthesis" (required object): your evidence → rule → condition → conclusion reasoning, per EVIDENCE → RULE → CONDITION → CONCLUSION above — requirement, userFacts, comparison, resolution.

"answer" (required, always a non-empty string): the full verified answer, structured per ANSWER STRUCTURE BY QUESTION TYPE above (built from "synthesis"), ending with the **References** list described in CITATION FORMAT. If the sources don't cover the question, say so plainly here instead of guessing.

"share" (required key; its VALUE is either a string or JSON null — see NO DRAFT RULE for exactly when it must be null): when "answer" reached a genuine, sourced answer (even if conditional, came with a qualifying exception, or was reached by interpreting the advisor's plain-language terms against the source's precise ones per EVIDENCE -> RULE -> CONDITION -> CONCLUSION), "share" is a shorter paraphrase of "answer" in plain, everyday language a customer with no insurance background would understand — explain what a term means rather than just repeating the policy document's own legal phrasing (e.g. don't quote clause language verbatim; say what it means in practice). "Shorter" refers to sentence-level wording, not fact coverage — see PLAYBOOK COMPLETENESS IN SHARE above for the specific rule on Playbook-sourced topics, which must stay fully comprehensive even in "share". This is what the advisor may copy-paste directly to a customer, so it must never overstate "answer" — "Conditional" must not become "Yes"; "Not specified" must not become "No"; no implied approval or promise beyond what "answer" actually verified. Never include a References list inside "share" — references belong only in "answer". Never include the ESCALATION note (the "check with Ditto's complex queries team" guidance) inside "share" either — that's operational guidance for the advisor, not something to relay to a customer; if ESCALATION applies, "share" must be null instead (see NO DRAFT RULE).

NO DRAFT RULE: set "share" to JSON null (not the string "null", not an empty string — the actual null value) ONLY in these cases: (1) the uploaded/connected resources genuinely have nothing addressing this question's topic at all (synthesis.resolution is NO_REQUIREMENT_FOUND, or hadNoMatches-equivalent); (2) synthesis.resolution is INSUFFICIENT_INFORMATION because the uploaded resources themselves are genuinely silent or incomplete on the deciding detail — NOT because the advisor's plain-language description merely required domain judgment to interpret (that is SATISFIED/NOT_SATISFIED territory — see the insurance-expert-interpretation guidance in EVIDENCE -> RULE -> CONDITION -> CONCLUSION); (3) "answer" is itself a clarifying question rather than an answer; or (4) ESCALATION above genuinely applies (a real, unresolved conflict or edge case — not ordinary missing info). Whenever synthesis.resolution is SATISFIED or NOT_SATISFIED — including a conclusion reached by interpreting the advisor's terms against the source's precise wording, and including one that comes with a qualifying condition, exception, or exclusion — that IS a genuine, sourced answer, grounded in the References the ANSWER cites, and "share" MUST contain a real customer-facing paraphrase of it. Do not null "share" out of caution merely because the answer required judgment, turned on an exclusion, or came with a caveat — a customer-facing message drafted from a genuinely unsupported or unresolved answer would be misleading, but one drafted from a properly reasoned conclusion is exactly what "share" exists for.`;

/** Renders the SOURCE PRECEDENCE #0 block — see this file's SYSTEM_INSTRUCTION
 * for the exact authority rules the model is told to apply to each kind of
 * entry. Placed ahead of PRODUCT PLAYBOOK in the source text so the
 * highest-authority content is also physically first. Returns "" (nothing
 * added) when both lists are empty — the normal case whenever no Special
 * Instruction matched this question, keeping the prompt byte-identical to
 * before this feature existed. */
function buildSpecialInstructionsBlock(overrideRules: SpecialInstructionRow[], advisory: SpecialInstructionRow[]): string {
  if (overrideRules.length === 0 && advisory.length === 0) return "";
  const parts: string[] = [
    "=== SPECIAL INSTRUCTIONS (authoritative per SOURCE PRECEDENCE #0 — read before everything else below) ===",
  ];
  for (const row of overrideRules) {
    parts.push(`[Override Rule: ${row.topic}]\n${row.instructionText}`);
  }
  for (const row of advisory) {
    const label = row.instructionType === "additional_information" ? "Additional Information" : "General Instruction";
    parts.push(`[${label}: ${row.topic}]\n${row.instructionText}`);
  }
  return parts.join("\n\n");
}

/** Deterministic hard-stop answer for a detected Override Rule conflict
 * (spec section 9: "do NOT allow the AI to arbitrarily choose one... flag
 * the conflict for an authorised user"). No AI call is made — the
 * conflicting instruction text is never shown to the model at all, so
 * there's no risk of it leaning toward either side despite being told not
 * to. `share` is null per NO DRAFT RULE (nothing here is a sourced answer
 * an advisor could relay to a customer). */
function buildConflictAnswer(conflicts: SpecialInstructionConflict[], historyTurnCount: number, latencyMs: number): ProductAssistAnswer {
  const lines = conflicts.map(
    c => `- **${c.topic}**: ${c.instructions.length} conflicting active Override Rules (IDs: ${c.instructions.map(i => i.id).join(", ")}).`
  );
  const answer = [
    "I can't answer this yet — Product Assist found more than one active Special Instruction (Override Rule) for the same topic and scope that disagree with each other, and I'm not able to silently pick one:",
    ...lines,
    "",
    "Please ask a Developer or Platform Admin to review and resolve the conflicting Special Instruction(s) in the Knowledge Hub before this question can be answered.",
  ].join("\n");
  return {
    answer,
    share: null,
    sources: [],
    hadNoMatches: false,
    meta: {
      retrievedChunkCount: 0,
      playbookFactCount: 0,
      historyTurnCount,
      inputTokens: null,
      outputTokens: null,
      latencyMs,
    },
  };
}

/** Renders matched Ditto FAQ entries for the ORG CONSTITUTION block —
 * "Q:"/"A:" pairs, no internal metadata (id, category, score, sheet
 * identity) ever included, since none of that belongs in a prompt whose
 * content the model may end up echoing. See DITTO FAQ CITATION in
 * SYSTEM_INSTRUCTION for how the model is told to present these (bold
 * question inline, never "Source: Ditto FAQ"). */
function buildDittoFaqEntries(faqs: MatchedFaq[]): string[] {
  return faqs.map(f => `[Ditto FAQ Q: ${f.question}]\nA: ${f.answer}`);
}

function buildSourceBlock(
  chunks: { resourceTitle: string; documentType: ProductAssistSource["documentType"]; content: string }[],
  playbookFacts: { planName: string; content: string }[],
  faqs: MatchedFaq[],
  specialInstructionsBlock: string
): string {
  const parts: string[] = [];
  if (specialInstructionsBlock) {
    parts.push(specialInstructionsBlock);
  }
  if (playbookFacts.length > 0 || faqs.length > 0) {
    // Both sub-sections share ONE parent header so the model reads them as
    // the equal-authority peer pair SOURCE PRECEDENCE #1 describes, rather
    // than two independently-ranked sources — see spec's Org Constitution
    // hierarchy. Either sub-section is simply omitted when that source
    // didn't apply to this question (e.g. a purely operational question has
    // no Playbook facts to show, and that's fine — the model isn't told a
    // sub-section exists when it doesn't).
    parts.push(
      "=== ORG CONSTITUTION (Ditto's own authoritative, EQUAL-AUTHORITY sources — see SOURCE PRECEDENCE #1. Outranks DOCUMENT EXCERPTS below on any topic either sub-section covers; select Product Playbook and/or Ditto FAQ based on the question's actual intent, per #1a/#1b/#1c — never a blanket priority between them.) ==="
    );
    if (playbookFacts.length > 0) {
      parts.push(
        "--- Product Playbook (recommendation/product-positioning — SOURCE PRECEDENCE #1a. For a topic covered here, DOCUMENT EXCERPTS below must not be used to add another named sub-type/benefit/figure — only to cover a genuinely different topic this section is silent on.) ---"
      );
      for (const f of playbookFacts) {
        parts.push(`[Product Playbook: ${f.planName}]\n${f.content}`);
      }
    }
    if (faqs.length > 0) {
      parts.push(
        "--- Ditto FAQ (Ditto's own operational process/capability/position — SOURCE PRECEDENCE #1b. Governs what DITTO facilitates, never what the insurer/product itself allows — see the INSURER FACT vs DITTO POSITION rule. Cite per DITTO FAQ CITATION — never name this source to the advisor.) ---"
      );
      parts.push(...buildDittoFaqEntries(faqs));
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
  scope: ProductAssistScope,
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
 * ProductAssistPage.tsx — nothing is persisted server-side) as a short
 * transcript prefix so follow-up questions ("what about the waiting
 * period for that?") resolve correctly, without re-verifying prior turns
 * against SOURCE CONTENT again. */
function buildHistoryBlock(history: ProductAssistHistoryTurn[]): string {
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
function buildScopeLine(scope: ProductAssistScope, categoryName: string | null, detectedPlanNames: string[]): string {
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
function buildRetrievalQueryText(question: string, history: ProductAssistHistoryTurn[]): string {
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
 * chose "No specific plan" in ProductAssistPage.tsx) but named a real plan
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
  scope: ProductAssistScope,
  question: string,
  history: ProductAssistHistoryTurn[] = []
): Promise<ProductAssistAnswer> {
  const categories = await repos.kbCategories.list();
  const categoryById = new Map(categories.map(c => [c.id, c]));
  const scopeCategoryName = scope.categoryId !== null ? categoryById.get(scope.categoryId)?.name ?? null : null;
  const scopeCategory = scope.categoryId !== null ? categoryById.get(scope.categoryId) : undefined;

  // Acronym Dictionary — resolved once, up front, since it feeds three
  // separate things below: plan detection (a plan-name acronym like "OS"
  // should be treated the same as the advisor typing "Optima Secure" in
  // full), retrieval (expansions folded into the embedded query text so a
  // habitual acronym doesn't under-retrieve), and the prompt itself (a
  // small reference block so the model recognizes the advisor's own
  // shorthand instead of treating it as unfamiliar). See acronyms.ts.
  const matchedAcronyms = await resolveMatchedAcronyms(repos, question);

  // The advisor may not have picked a plan chip at all — plan selection is
  // no longer required before asking (see ProductAssistPage.tsx). If they
  // named a real plan directly in the question text instead, detect it
  // here (see detectMentionedPlanNames's comment) and treat it as if it
  // were selected for BOTH resource retrieval and the Product Playbook
  // lookup below, so a question like "what's the bonus in Optima Secure?"
  // (or its acronym, e.g. "what's the bonus in OS?" — see
  // acronymPlanNameMatches) still gets plan-specific grounding without a
  // manual chip click. When neither a selection nor a detection is
  // available, effectivePlanTags stays empty and the model itself decides
  // (per SYSTEM_INSTRUCTION's SELECTED SCOPE / AMBIGUITY) whether to answer
  // generally or ask for clarification — see buildScopeLine.
  const detectedPlanNames =
    scope.planTags.length === 0 && scopeCategory
      ? Array.from(
          new Set([
            ...detectMentionedPlanNames(question, scopeCategory.planNames),
            ...acronymPlanNameMatches(matchedAcronyms, scopeCategory.planNames),
          ])
        )
      : [];
  const effectivePlanTags = scope.planTags.length > 0 ? scope.planTags : detectedPlanNames;

  const { categoryIds, resourceIds } = await resolveEligibleResourceIds(repos, scope, effectivePlanTags);

  // Fold matched acronym expansions into the text that gets embedded, so
  // e.g. "CBB" retrieves what "Cumulative Bonus Super" would — the original
  // question is kept first (still the dominant signal), expansions appended
  // as extra context rather than replacing the advisor's own wording.
  const retrievalQueryText = [
    buildRetrievalQueryText(question, history),
    ...matchedAcronyms.map(m => m.expansion),
  ].join("\n");
  const queryEmbedding = await embedQuery(retrievalQueryText);

  // SOURCE PRECEDENCE #0 — checked before any normal retrieval below, per
  // Special Instructions' additive precedence layer. Reuses queryEmbedding
  // (already computed above) for topic-relevance matching — zero extra
  // embedding calls. See specialInstructions.ts for the full algorithm.
  const generationStartedAtForConflict = Date.now();
  const { overrideRules, advisory, conflicts } = await resolveApplicableInstructions(
    repos,
    scope,
    effectivePlanTags,
    queryEmbedding
  );
  if (conflicts.length > 0) {
    // Hard stop, per product decision: never let the model see conflicting
    // Override Rule text at all (not even to be told "don't pick one") —
    // short-circuit deterministically instead of risking it leaning toward
    // either instruction. Applies to the whole answer, not just the
    // conflicting topic's portion, since a partial answer here could still
    // read as implicitly endorsing one side.
    return buildConflictAnswer(conflicts, history.length, Date.now() - generationStartedAtForConflict);
  }
  const specialInstructionsBlock = buildSpecialInstructionsBlock(overrideRules, advisory);

  // Ditto FAQ — the Org Constitution's other equal-authority peer (see
  // SOURCE PRECEDENCE #1b). Deliberately NOT gated by scope.categoryId or
  // effectivePlanTags the way playbookFacts is below: Ditto's own
  // operational/process position is orthogonal to which insurer happens to
  // also be in scope (spec §10), so every question checks the FAQ, reusing
  // the same queryEmbedding already computed for Special Instructions above
  // — zero extra embedding calls. Computed BEFORE document-chunk retrieval
  // (moved up from its old position after `similar`) because
  // retrieveDocumentChunks() needs it for the FAQ sufficiency gate — see
  // that function's comment.
  const faqMatches = await resolveApplicableFaqs(repos, queryEmbedding);

  const similar = await retrieveDocumentChunks(repos, queryEmbedding, categoryIds, resourceIds, faqMatches);

  // Product Playbook plan facts — only meaningful once a plan is in scope
  // (there's no "insurer-wide" playbook fact, unlike a generic PDF; see
  // kb_playbook_plan_facts's schema comment).
  const playbookFacts =
    scope.categoryId !== null && effectivePlanTags.length > 0
      ? await repos.kbPlaybookPlanFacts.findMatching(scopeCategoryName ?? "", effectivePlanTags)
      : [];

  const chunkInputs = similar.map(s => ({ resourceTitle: s.resourceTitle, documentType: s.documentType, content: s.chunk.content }));
  const playbookInputs = playbookFacts.map(f => ({ planName: f.planName, content: f.content }));

  const hadNoMatches =
    similar.length === 0 && playbookFacts.length === 0 && faqMatches.length === 0 && overrideRules.length === 0 && advisory.length === 0;
  const sourceBlock = hadNoMatches
    ? "(No matching Playbook facts, Ditto FAQ entries, or document excerpts were found for this question within the selected scope.)"
    : buildSourceBlock(chunkInputs, playbookInputs, faqMatches, specialInstructionsBlock);

  const historyBlock = buildHistoryBlock(history);
  const scopeLine = buildScopeLine(scope, scopeCategoryName, detectedPlanNames);
  const acronymBlock = buildAcronymReferenceBlock(matchedAcronyms);

  const ai = getKbAiClient();
  const generationStartedAt = Date.now();
  const response = await ai.models.generateContent({
    model: GENERATION_MODEL,
    contents: [
      {
        role: "user",
        parts: [
          {
            text: `${historyBlock}${scopeLine}${acronymBlock ? `${acronymBlock}\n\n` : ""}SOURCE CONTENT:\n${sourceBlock}\n\nADVISOR'S QUESTION:\n${question}`,
          },
        ],
      },
    ],
    config: {
      systemInstruction: SYSTEM_INSTRUCTION,
      // Was 0.1. Lowered to 0 (2026-08) after a user-reported case of the
      // exact same sourced question getting genuinely contradictory answers
      // across two separate chats — a lingering source of sampling variance
      // on ambiguous source wording that serves no purpose here: this isn't
      // a creative-writing task, it's a "read the provided evidence and
      // report what it says" task, where the most reproducible reading is
      // also the correct target. Note this reduces but does not eliminate
      // answer-to-answer variance — Gemini's own infra-level nondeterminism
      // at temperature 0 is a known, separate residual factor, and a
      // genuinely ambiguous/inconsistent underlying source document (Policy
      // Wording or a Product Playbook entry) will still produce inconsistent
      // answers regardless of temperature, since that's a data problem, not
      // a sampling problem.
      temperature: 0,
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
          // Required, generated FIRST (see propertyOrdering below) — an
          // internal reasoning workspace, never forwarded to the client
          // (see the parsing code below this call, which reads only
          // "answer"/"share" off the parsed JSON). This is what turns
          // retrieved evidence into an actual conclusion instead of a
          // restated summary: forcing the model to commit to an explicit
          // requirement/userFacts/comparison/resolution BEFORE it writes
          // "answer" means "answer" is built from a real synthesis step
          // rather than free-associated prose — see EVIDENCE -> RULE ->
          // CONDITION -> CONCLUSION in SYSTEM_INSTRUCTION.
          synthesis: {
            type: Type.OBJECT,
            description:
              "Required internal reasoning step, completed BEFORE writing \"answer\" — never shown to the advisor, discarded after generation. Forces interpretation of the retrieved evidence into a conclusion instead of restating it.",
            properties: {
              requirement: {
                type: Type.STRING,
                description:
                  "The exact rule/condition/requirement the applicable sources state for this question (per SOURCE PRECEDENCE), in the source's own specific terms. Empty string if no source states an applicable requirement.",
              },
              userFacts: {
                type: Type.STRING,
                description:
                  "The specific fact(s) the advisor's question states about the customer's situation, in the advisor's own terms. Empty string if the question states none.",
              },
              comparison: {
                type: Type.STRING,
                description:
                  "Explicit term-by-term comparison of userFacts against requirement: the SAME thing, a DIFFERENT-BUT-RELATED term, a SUPERSET/SUBSET, or genuinely UNCLEAR. Never assume two related medical/procedural/product terms are equivalent unless a source explicitly equates them.",
              },
              resolution: {
                type: Type.STRING,
                enum: ["SATISFIED", "NOT_SATISFIED", "INSUFFICIENT_INFORMATION", "NO_REQUIREMENT_FOUND"],
                description:
                  "SATISFIED: userFacts clearly meet requirement. NOT_SATISFIED: userFacts clearly fail it or are explicitly excluded by it. INSUFFICIENT_INFORMATION: the sources or the advisor's stated facts genuinely don't give enough to decide. NO_REQUIREMENT_FOUND: no source states an applicable rule for this question.",
              },
            },
            required: ["requirement", "userFacts", "comparison", "resolution"],
            propertyOrdering: ["requirement", "userFacts", "comparison", "resolution"],
          },
          answer: {
            type: Type.STRING,
            description:
              "The full verified, advisor-facing answer ending with a **References** list. When synthesis.resolution is SATISFIED or NOT_SATISFIED, open with the direct conclusion per ANSWER STRUCTURE's CONCLUSION -> REASON -> QUALIFYING CONDITION — never a bare restatement of source text left for the advisor to interpret. Never empty.",
          },
          share: {
            type: Type.STRING,
            nullable: true,
            description:
              "A customer-ready paraphrase of \"answer\". Required (never null) whenever synthesis.resolution is SATISFIED or NOT_SATISFIED, even if reaching that conclusion required interpreting the advisor's plain-language terms or the conclusion carries a qualifying condition/exclusion. JSON null ONLY per NO DRAFT RULE's specific cases: genuinely no source coverage, \"answer\" is itself a clarifying question, or ESCALATION applies.",
          },
        },
        required: ["synthesis", "answer", "share"],
        propertyOrdering: ["synthesis", "answer", "share"],
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
    console.warn("Product Assist: model response wasn't valid structured JSON, falling back to raw text as the answer:", err);
    answer = rawText || "I wasn't able to generate a response. Please try rephrasing the question.";
    share = null;
  }

  const seenTitles = new Set<string>();
  const sources: ProductAssistSource[] = [];
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
