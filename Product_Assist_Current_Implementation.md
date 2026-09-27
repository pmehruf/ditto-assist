# Product Assist — Current Implementation

*How Product Assist works today. Based on `src/server/knowledgeBase/queryAssist.ts`, `server.ts`, `src/pages/QueryAssistPage.tsx`, `src/components/ProductAssistDailyWarning.tsx`, and `src/server/db/schema.ts`.*

---

## 1. What Product Assist is

Product Assist is a chat tool inside the app that lets an insurance advisor ask questions about specific insurance plans and get an answer grounded in the company's own policy documents and product knowledge — never from the AI's own general knowledge. It's open to every signed-in advisor at Editor tier and above.

## 2. Before an advisor can use it

The first time any advisor opens Product Assist, a full-screen gate appears — not the chat itself. It shows a 10-second countdown, the headline "AI CAN MAKE MISTAKES," two guidance lines ("Use it as a guide, not a replacement for your judgement" and "Always verify the references before relying on or communicating an answer"), and a checkbox ("I acknowledge that 'because AI said so' is not a policy clause") that stays locked until the countdown reaches zero. Only then does "Proceed" unlock. This acknowledgment is recorded server-side per advisor, so it survives a cleared browser cache or a new device. After that first time, a lighter 5-second reminder version reappears once per calendar day.

## 3. The end-to-end flow

1. **Advisor sets scope, then asks.** They pick an insurer category (or "General" for a cross-insurer question) and, optionally, one or more specific plans via chips. Picking a plan is optional — an advisor can skip it and just type a question.
2. **The question is sent to the server** along with the chosen scope and the last several turns of the conversation. Conversation history lives only in the advisor's own browser, not in a database — each request resends it as short-lived context.
3. **The server works out what's actually in scope.** If no plan chip was picked but a real plan name appears directly in the question text (e.g. "what's the bonus in Optima Secure?"), it's detected via a whole-word match against that insurer's known plan roster and treated as if it had been selected, for both retrieval and the next step.
4. **Two lookups happen for every question:**
   - A semantic search across the knowledge base (ingested PDFs and web pages) scoped to the chosen insurer/plan: the question is converted to a vector embedding and compared against every stored chunk of document text, and the 24 closest matches are pulled.
   - A lookup against the Product Playbook — a structured, always-current fact sheet the product team maintains in a Google Sheet — matched by an exact insurer + plan name. When it matches, it's injected in full and treated as the single most authoritative source, ahead of anything found in a PDF.
5. **Everything is assembled into one request to Gemini** (`gemini-2.5-flash`, temperature 0.1): the recent conversation history, a plain-language line stating the scope situation, the Playbook facts (if any), the retrieved document excerpts (ordered so Policy Wording ranks above Prospectus, which ranks above Brochure/Add-on material), and the question — plus one fixed system instruction (Section 4).
6. **Gemini returns a structured, two-part answer**: a verified "answer" (ending in a References list) and a "share" field — a simplified, customer-ready paraphrase — which is left empty whenever the model didn't reach a genuinely confident, sourced answer.
7. **The advisor sees**: an Answer block, a References list they can use to verify the answer against the real document, a green "Draft message" box only when "share" was actually returned, and a Sources list of the real documents used, each one clickable when it's a genuine URL.
8. **When nothing relevant is found**, the source content sent to the model is replaced with an explicit note that nothing matched, and the model is instructed to say plainly that the sources don't cover the question rather than guess.

## 4. The system instruction

Every request carries the same fixed instruction, in full, regardless of advisor, insurer, or question:

> You are Product Assist, a rigorous Health Insurance Product Expert assistant for insurance advisors. You answer questions about specific insurance plans using ONLY the source content provided to you in each request — you never rely on general insurance knowledge, training data, or assumptions about how insurance "usually" works.
>
> **CORE RULE**
> Never state a fact unless it is explicitly written in the "SOURCE CONTENT" section of this request. Do not infer, extrapolate, or fill gaps with plausible-sounding general knowledge. If the provided sources don't answer the question, say so plainly — do not guess.
>
> **COMPREHENSIVENESS**
> Before writing the ANSWER, read EVERY excerpt in SOURCE CONTENT — not just the first one that looks relevant. Insurance documents scatter the pieces of a single benefit across multiple non-adjacent sections... An answer built from only the closest-matching excerpt is incomplete and will be treated as WRONG even if what it says is technically accurate...
>
> **SELECTED SCOPE**
> Every request includes a SELECTED SCOPE line stating the insurer and the plan situation, always one of three states: (1) the advisor explicitly picked a plan via the UI — treat it as given fact; (2) no plan was picked, but one was detected from the question text — trust it only if genuinely confident; (3) no plan picked or detected — answer generally where possible, ask only when the answer genuinely differs by plan.
>
> **CONTINUING A CONVERSATION**
> If CONVERSATION SO FAR is present, the advisor's current message may be a continuation, not a new isolated question — especially a short reply. If the model's own last turn asked a clarifying question, treat the current message as the answer to that question and go back and answer the original question it was raised for.
>
> **SOURCE PRECEDENCE (highest wins on conflict)**
> 1. PRODUCT PLAYBOOK PLAN FACTS — the product team's own current, authoritative record. When present for a topic, it is the complete and exclusive answer for that topic; nothing else may add an extra detail to it, even if true elsewhere.
> 2. POLICY WORDING — the plan's actual contract language, outranking any generic explainer or claims guide.
> 3. General insurer-wide documents (no plan tag).
> 4. General/Others documents, only when no specific insurer was selected.
>
> **INTERCONNECTED PROVISIONS**
> Policy wording is one interconnected system, not isolated sentences — check whether a definition, add-on/rider, or specific provision elsewhere changes how the first-found clause should be read. General insurance principles may only support interpretation of what the sources say, and must be explicitly flagged as an inference, never presented as a stated fact.
>
> **VERIFICATION CHAIN** — applied silently before answering: CLAIM → EVIDENCE → DOCUMENT → PRODUCT/VARIANT.
>
> **CITATION FORMAT**
> The ANSWER ends with a bolded **References** list, one entry per topic covered, naming the exact document and the section/clause identifier exactly as the source labels it — never a paraphrased sentence standing in for a citation.
>
> **ESCALATION — GENUINE UNRESOLVED UNCERTAINTY**
> Reserved for a narrower case than ordinary "not specified": a scenario, edge case, or interaction between provisions that can't be resolved either way even after reading everything relevant. When it applies, the model states plainly what the sources do and don't establish, never presents a guess as settled, and adds a note that the advisor should confirm the specific case with Ditto's complex queries team.
>
> **ANSWER STRUCTURE BY QUESTION TYPE**, **FORMATTING** (plain markdown, no inline citations), **AMBIGUITY** (ask exactly one clarifying question, scripted wording for the "no plan known" case), and a **16-point internal verification checklist** the model silently confirms before finalizing — covering things like "no fact was invented, inferred, or assumed," "Conditional coverage is never upgraded to Yes," "missing information is never downgraded to No."
>
> **OUTPUT FORMAT**
> A single JSON object with exactly two fields: "answer" (always a non-empty, fully verified answer) and "share" (a customer-ready paraphrase, or JSON null whenever "answer" didn't reach a genuine, sufficiently-certain sourced answer — because the sources don't cover the question, "answer" is itself a clarifying question, or ESCALATION applies). "share" must never overstate "answer": Conditional never becomes Yes, Not specified never becomes No, and it never carries the ESCALATION note — that's guidance for the advisor, not something to relay to a customer.

The request Gemini actually receives is this fixed instruction plus a per-question message built from four pieces, in order: the recent conversation history, the scope line, the source content (Playbook facts + retrieved document excerpts), and the advisor's question.

## 5. Rules that shape every answer

- Only answer from what's handed to it in that request — never general insurance knowledge, never assumption.
- Read every retrieved excerpt, not just the closest match, because a benefit's eligibility, caps, and process are often scattered across separate sections.
- Respect the source pecking order: Product Playbook beats Policy Wording, which beats Prospectus, which beats Brochure/marketing material, which beats general insurer-wide docs.
- Treat "which plan is this about" as three distinct situations (explicitly picked / detected from the question / neither) and never silently guess when it matters.
- Ask exactly one clarifying question, with specific scripted phrasing, when the plan genuinely can't be determined and the answer depends on it.
- Check for interactions between clauses (an add-on overriding a base exclusion, a definition changing how a clause reads) rather than reading one sentence in isolation.
- Cite every factual claim with a real section/clause identifier.
- Escalate genuinely unresolved edge cases to a "confirm with Ditto's complex queries team" note rather than picking the more likely-sounding interpretation.
- Never let the customer-facing paraphrase overstate the verified answer.

## 6. Guardrails in place

- **Factual discipline**: the model is told never to state anything not explicitly present in the supplied source content, and any inference must be flagged in plain language as an inference, never presented as fact.
- **Escalation path**: a specific instruction to direct the advisor to confirm a genuinely unresolved case with Ditto's complex queries team.
- **No fabricated customer message**: "share" is left empty whenever "answer" wasn't a genuine, confident, sourced answer, so nothing questionable is ever handed to an advisor as ready to send.
- **Low temperature (0.1)** and a forced JSON response schema, so responses are consistent and the two-field structure is always present.
- **Mandatory awareness gate**: the one-time, un-skippable 10-second warning plus daily reminder described in Section 2.
- **Access controls**: requires a signed-in session; the feature is gated to Editor tier and above; the ask endpoint is rate-limited to 30 requests per 15 minutes per caller.
- There is no minimum relevance/confidence threshold on retrieval — the system always sends the top 24 closest-matching chunks to the model, whatever their quality, and relies on the model's own instructions (not a code-level filter) to recognize and say when they aren't actually relevant.
- There is no independent citation verification and no separate code-level topic filter — the boundaries the model observes come entirely from the system instruction, not a rule enforced outside the model.

## 7. Knowledge and source behaviour

Product Assist draws from two kinds of sources per insurer:

- **Ingested PDFs and web pages** — brochures, policy wording, prospectuses, add-on documents, claims guides — split into chunks and turned into searchable embeddings.
- **The Product Playbook**, a Google Sheet the product team maintains. Its narrative tabs are ingested and searched like normal documents; its per-plan feature-comparison tabs are reshaped into a separate table matched by exact plan name and always injected in full when relevant, rather than searched.

Relevance for documents is decided by vector similarity between the question (plus recent conversation context) and each stored chunk — the top 24 matches, always, from whatever's eligible for the selected insurer/plan. Relevance for Playbook facts is an exact match on insurer + plan name, not similarity.

The model answers only from these sources, by explicit instruction — general insurance knowledge may only be used as clearly-labeled interpretive support, never as a stand-in fact. When there's no relevant information for a question, the model is told to say so plainly rather than guess.

When the Playbook has an entry for the exact topic being asked, it's treated as complete and exclusive for that topic — the model does not supplement it with an extra detail pulled from a Policy Wording excerpt, even if that detail is real and on-topic, because the Playbook is the product team's live record of what's actually true for that plan today.

## 8. What the advisor experiences — examples

**A plan is explicitly picked, and a clean answer is available.** An advisor selects an insurer and a specific plan chip, then asks a detail question (e.g. a waiting period). The model is told the plan was explicitly chosen, reads the retrieved chunks and any matching Playbook fact, and writes an Answer ending in a References list. Because the answer is genuinely confident, a Draft Message paraphrase is generated too. The advisor sees the Answer, References, Draft Message, and a Sources list.

**No plan is picked, but one is named in the question.** An advisor selects only an insurer and asks about a specific plan by name. The server detects that plan name in the question text and treats it as the effective plan for retrieval and the Playbook lookup, but tells the model this was detected rather than explicitly chosen. If the Playbook's coverage of that topic doesn't mention something a document elsewhere describes, the model says plainly that it doesn't currently apply to this plan, rather than presenting it as available.

**The system can't confidently answer.** An advisor asks about a specific scenario the retrieved material doesn't clearly address. The model states plainly what the sources do and don't establish, does not present a guess as settled, and adds a note to confirm the case with Ditto's complex queries team. No Draft Message is generated for this response — nothing goes into the advisor's copy-paste-to-customer workflow for an unresolved case.

## 9. Boundaries

Product Assist is designed to take a specific, sourced insurance-product question from an advisor, retrieve the matching policy documents and Product Playbook facts for the plan in scope, and produce a source-grounded answer with verifiable citations, plus — only when genuinely confident — a simplified paraphrase safe to forward to a customer. Every advisor passes through a mandatory "verify before you rely on this" acknowledgment before they can use it at all.

It is not designed to give a guaranteed, independently fact-checked, or complete answer on its own. There is no confidence threshold on what gets retrieved, no automated citation verification, and no hard topic boundary outside the system instruction itself — the model's own instructions, plus the advisor's own verification against the linked source, are what stand between a question and a wrong or out-of-scope answer, not a separate enforcement layer in the code.

- **Providing information** — its core job: synthesizing matched excerpts and Playbook facts into a structured, cited answer.
- **Making assumptions** — never presented as fact; only permitted as clearly-labeled interpretive language, never with the same confidence as a stated fact.
- **Giving a definitive answer** — only when the sources genuinely and unambiguously support it; "Conditional" and "Not specified" can never be upgraded to "Yes"/"No," and genuine uncertainty triggers an escalation note instead.
- **Handling information that isn't available** — the model says so plainly rather than guessing, and the customer-facing paraphrase is left empty so nothing unverified reaches a customer.

## 10. Data handling

Conversation content itself is held only in the advisor's own browser between turns — each request resends the recent history as short-lived context for that one call. The server does not use a conversation to answer anyone else's question, and nothing about a conversation is visible inside the app to another advisor.

For internal review of how Product Assist is performing, a record of each interaction is temporarily retained. This includes the advisor's question and the answer (and customer-facing paraphrase, when one was generated); the scope the question was asked in, such as the insurer and plan context; the sources and retrieved content supplied to the model for the answer; and usage metadata — figures like how much was retrieved, response timing, and token/cost-related counts — that support quality and cost analysis of the tool.

This record exists solely for internal analysis of Product Assist's accuracy, completeness, and performance — not for monitoring individual advisors. It is periodically exported to a private, access-controlled Google Sheet and then cleared from the application's database, so it does not accumulate indefinitely. This logging can be turned off entirely via an existing configuration switch.
