# Product Assist — Current Implementation Review
*Prepared for Product team approval meeting. Based on a direct read of the live code (`src/server/knowledgeBase/queryAssist.ts`, `server.ts`, `src/pages/QueryAssistPage.tsx`, `src/components/ProductAssistDailyWarning.tsx`, `src/server/db/schema.ts`) as of 2026-08-20. No code was changed to produce this review.*

---

## 1. How Product Assist works — the actual flow

**Before an advisor can ask anything, the very first time they open Product Assist, they hit a full-screen gate**, not a chat box. It shows a 10-second countdown, the headline "AI CAN MAKE MISTAKES," two guidance lines ("Use it as a guide, not a replacement for your judgement" / "Always verify the references before relying on or communicating an answer"), and a checkbox ("I acknowledge that 'because AI said so' is not a policy clause") that stays locked until the countdown hits zero. Only then does "Proceed" unlock. This is recorded server-side per advisor (not just in the browser), so it survives a cache clear or new device. After that first time, a lightweight 5-second reminder version reappears once per calendar day.

**Then the actual chat flow:**

1. **Advisor picks scope, then asks.** They choose an insurer category (or "General" for a cross-insurer question) and, optionally, one or more specific plans via chips. This is optional — they can skip picking a plan and just ask.
2. **Question goes to the server** along with the chosen scope and up to the last 8 turns of conversation (held only in the advisor's own browser — see below).
3. **The server decides what's "in scope."** If a plan wasn't picked via the chips but is named directly in the question text (e.g. "what's the bonus in Optima Secure?"), it's detected by matching against that insurer's known plan names, and treated as if it had been selected — for both retrieval and the next step.
4. **Two separate lookups happen in parallel:**
   - A **semantic search** over the knowledge base (PDFs/web pages) restricted to the chosen insurer and plan(s): the question is turned into a vector embedding and compared against every chunk of ingested document text, and the **24 closest matches** are pulled — no minimum "good enough" threshold is applied.
   - A lookup against the **Product Playbook** — a structured, always-current fact sheet the product team maintains, matched by an *exact* insurer + plan name (not similarity search). This is treated as the single most authoritative source.
5. **Everything is assembled into one request to Gemini**: prior conversation turns, a plain-language line stating the scope situation, the Playbook facts (if any, always in full), the 24 retrieved document excerpts (sorted so Policy Wording ranks above Prospectus, which ranks above Brochure/Add-on material), and the question itself — plus one long, fixed system instruction (Section 2).
6. **Gemini returns a structured, two-part JSON answer**: a full verified "answer" (with a References section), and a "share" field — a simplified customer-ready paraphrase — which is explicitly set to nothing at all whenever the model didn't reach a genuinely confident, sourced answer.
7. **The advisor sees:** an Answer block, a References list (so they can go verify), a green "Draft message" box *only* when "share" was actually returned, and a Sources list of the real documents used — each one clickable when it's a genuine URL.
8. **When nothing relevant is found**, the source content sent to Gemini is replaced with an explicit "no matching Playbook facts or document excerpts were found" line, and the model is instructed to say plainly that the sources don't cover the question rather than guess. *(One caveat worth knowing before the meeting: the backend also computes a `hadNoMatches` flag meant to trigger a softer "try broadening your search" UI hint — that flag is sent to the browser but the front-end doesn't currently do anything with it. In practice, the only signal an advisor sees today when nothing was found is whatever Gemini itself writes into the Answer.)*

**Important context point:** conversation history is **never stored server-side** — it lives only in the advisor's own browser (localStorage) and is resent with each new message purely as short-term context. No admin, and no database, has visibility into what advisors ask.

---

## 2. The actual Gemini API prompt

Model: **`gemini-2.5-flash`**, temperature **0.1** (deliberately low — favors consistency over creative variation), with a forced JSON response schema (two required fields: `answer`, `share`).

### How the request is assembled

The request sent to Gemini has two parts:

- **`systemInstruction`** — one long, fixed block of text (reproduced in full below). This never changes between requests.
- **The user message** — built fresh for every question from four dynamic pieces, concatenated in this exact order:

```
${historyBlock}${scopeLine}SOURCE CONTENT:
${sourceBlock}

ADVISOR'S QUESTION:
${question}
```

| Piece | What it is | Example |
|---|---|---|
| `historyBlock` | Last 4 prior turns (if any), formatted as a mini transcript | `CONVERSATION SO FAR (most recent last...): \nAdvisor: ...\n\nProduct Assist: ...` |
| `scopeLine` | One plain-language sentence telling Gemini which of 3 scope states applies (explicitly picked / detected from the question / neither) | `SELECTED SCOPE: Insurer: HDFC Ergo. Plan(s) already selected by the advisor via the UI: Optima Secure.` |
| `sourceBlock` | The Playbook facts (if matched) + the 24 retrieved document excerpts, each labeled with its document type | `=== PRODUCT PLAYBOOK ... ===` then `=== DOCUMENT EXCERPTS (ordered by source authority) ===` |
| `question` | The advisor's literal question text | `What's the waiting period for pre-existing conditions?` |

### The fixed system instruction, verbatim

> You are Product Assist, a rigorous Health Insurance Product Expert assistant for insurance advisors. You answer questions about specific insurance plans using ONLY the source content provided to you in each request — you never rely on general insurance knowledge, training data, or assumptions about how insurance "usually" works.
>
> **CORE RULE**
> Never state a fact unless it is explicitly written in the "SOURCE CONTENT" section of this request. Do not infer, extrapolate, or fill gaps with plausible-sounding general knowledge. If the provided sources don't answer the question, say so plainly — do not guess.
>
> **COMPREHENSIVENESS**
> Before writing the ANSWER, read EVERY excerpt in SOURCE CONTENT — not just the first one that looks relevant. Insurance documents scatter the pieces of a single benefit across multiple non-adjacent sections... An answer built from only the closest-matching excerpt is incomplete and will be treated as WRONG even if what it says is technically accurate...
> This "read everything" instruction is about completeness WITHIN a rank, never a license to override SOURCE PRECEDENCE below...
>
> **SELECTED SCOPE**
> Every request includes a SELECTED SCOPE line stating the insurer and the plan situation, which is always one of three states — read it carefully, it tells you which state you're in:
> 1. The advisor explicitly picked plan(s) via the app's UI before typing their question. Treat this as given, established fact — do not ask the advisor which plan they mean, they already told you.
> 2. The advisor didn't pick a plan via the UI, but the line says a plan was detected directly from the wording of their question. You may treat that detected plan as the plan in scope — but only if you're actually confident it's the right one...
> 3. No plan was picked or detected. Answer using general/insurer-wide information where that's enough to answer the question. Only ask a clarifying question when the source content's answer genuinely differs by plan in a way that changes the answer...
>
> **CONTINUING A CONVERSATION**
> If CONVERSATION SO FAR is present below, the advisor's current message may be a continuation, not a new isolated question... If your own last turn... asked the advisor a clarifying question, treat their current message as the answer to THAT clarifying question and go back and actually answer the ORIGINAL question...
>
> **SOURCE PRECEDENCE (highest wins on conflict)**
> 1. PRODUCT PLAYBOOK PLAN FACTS — the internal team's own authoritative, CURRENT statement of exactly which sub-feature/variant/benefit applies to the advisor's selected plan... When a PRODUCT PLAYBOOK section is present below for the selected plan AND it addresses a given topic, the Playbook's statement of that topic is the COMPLETE and EXCLUSIVE answer for it. Do not add, blend in, or additionally mention some other named sub-type/variant/figure for that SAME topic from DOCUMENT EXCERPTS...
> 2. POLICY WORDING documents — the plan's own official policy wording/terms & conditions... the plan's actual contract language and outranks any generic explainer, claims-process guide, or glossary article...
> 3. General insurer-wide documents (no plan tag)...
> 4. General/Others documents, only when no specific insurer was selected.
>
> **INTERCONNECTED PROVISIONS**
> Insurance policy wording is one interconnected system, not a set of isolated sentences. Do not read a clause alone and stop... Established general health-insurance principles... may only be used as contextual support for interpreting what the sources say, never as a substitute for them — and must be explicitly flagged as an inference, not presented as something the policy states.
>
> **VERIFICATION CHAIN** — apply this before answering, silently: CLAIM → EVIDENCE → DOCUMENT → PRODUCT/VARIANT.
>
> **CITATION FORMAT**
> ...end the ANSWER with a **References** section: a bolded "References" label followed by a list, one entry per distinct topic/point you covered, each naming the exact document and the section/clause IDENTIFIER exactly as that document itself labels it. ... NEVER cite by quoting or paraphrasing a full sentence of body text and presenting it as if it were the section name...
>
> **PLAYBOOK COMPLETENESS IN SHARE** / **ESCALATION — GENUINE UNRESOLVED UNCERTAINTY**
> Reserve ESCALATION for a narrower, higher-stakes case: the question turns on a specific real-world scenario, edge case, or interaction between provisions that you cannot resolve either way even after reading everything relevant... Getting this kind of case wrong has real consequences for the advisor and customer. When this applies: say plainly in "answer" what the sources do and don't establish, do not present your best guess as a settled conclusion, and add a clear note that the advisor should confirm this specific case with Ditto's complex queries team...
>
> **ANSWER STRUCTURE BY QUESTION TYPE**, **FORMATTING**, **AMBIGUITY** (ask exactly ONE clarifying question, exact wording specified for the "no plan known" case), and a **16-point INTERNAL VERIFICATION CHECKLIST** the model is told to silently confirm before finalizing (e.g. "No fact was invented, inferred, or assumed," "Conditional coverage is labeled 'Conditional' — never upgraded to 'Yes'," "Missing information is labeled 'Not specified in available sources' — never downgraded to 'No.'").
>
> **OUTPUT FORMAT**
> Respond with a single JSON object matching the response schema, with exactly two fields: "answer" and "share"... **NO DRAFT RULE**: set "share" to JSON null... whenever "answer" did not reach a genuine, sourced answer for the advisor to relay to a customer as-is — because the sources don't cover the question, because "answer" is itself a clarifying question, or because ESCALATION applies... A customer-facing message drafted from an unsupported, incomplete, or genuinely uncertain answer would be misleading if copied straight to a customer — null is the correct, complete response in that case.

*(This is the real prompt, condensed only by trimming repeated/illustrative sentences marked with "..." — nothing was reworded. The full unabridged text is ~1,900 words in `src/server/knowledgeBase/queryAssist.ts`, lines 110–208.)*

---

## 3. What Product Assist has been specifically instructed to do

In plain terms, the system prompt tells Gemini to:

- **Only answer from what's handed to it in that request** — never its own general insurance knowledge, and never assumption.
- **Read every retrieved excerpt**, not just the first close match, because insurance benefits are often split across multiple sections (eligibility in one place, caps/exceptions in another, process in a third).
- **Respect a strict pecking order** when sources disagree: Product Playbook (product team's own current record) beats Policy Wording, which beats Prospectus, which beats Brochure/marketing material, which beats general insurer-wide docs.
- **Treat the advisor's plan selection as three distinct situations** (explicitly picked / detected from the question / neither) and handle each differently — never silently guess which plan is meant when it matters.
- **Ask exactly one clarifying question**, with a specific scripted phrasing, rather than guessing, when the plan genuinely can't be determined and matters.
- **Look for interactions between clauses** (add-ons overriding base exclusions, definitions changing how a clause reads, etc.) rather than reading one sentence in isolation.
- **Cite everything** — every factual claim needs a real section/clause identifier in a References list; a paraphrased sentence standing in for a citation is explicitly disallowed.
- **Escalate genuinely unresolved edge cases** (not just "not specified") to a "confirm with Ditto's complex queries team" note, instead of picking the more likely-sounding answer.
- **Never let the customer-facing paraphrase overstate the verified answer** — "Conditional" can't become "Yes"; "Not specified" can't become "No."

---

## 4. Guardrails — what's actually in place today

**Confirmed, implemented:**

- **Prompt-level factual discipline**: the model is told never to state anything not explicitly present in the supplied source content, and to flag any inference as an inference, in plain language, rather than presenting it as fact.
- **Escalation path for genuine uncertainty**: a specific instruction to tell the advisor to confirm with Ditto's complex queries team rather than resolve an ambiguous edge case on its own.
- **No fabricated customer message**: the "share" field (the copy-paste-ready customer text) is forced to be empty/null whenever the answer wasn't a genuine, confident, sourced one — so nothing questionable is ever handed to an advisor as "ready to send."
- **Low temperature (0.1)** + a **forced JSON response schema** — reduces response variability and guarantees the two-field structure is always present (this is a consistency/format guardrail, not a fact-accuracy one).
- **Mandatory awareness gate**: a one-time, un-skippable 10-second "AI can make mistakes, verify before relying on it" acknowledgment per advisor (persisted server-side), plus a daily reminder.
- **Access controls**: requires a signed-in session; the feature itself is gated to "Editor" tier and above in the nav (Viewer-tier accounts don't see it); the ask endpoint is rate-limited to 30 requests per 15 minutes per caller.
- **No server-side conversation storage**: nothing an advisor asks is retained in the database — reduces the surface area for any of it being reviewed or repurposed later.

**Explicitly NOT implemented today** *(flagging per your instruction not to assume a guardrail exists just because it'd be good practice)*:

- **No minimum relevance/confidence threshold on retrieval.** The system always pulls the top 24 closest-matching chunks and hands them to Gemini, even if none of them are actually a good match — there's no code-level cutoff that says "these aren't similar enough, don't use them." The only thing standing between a weak match and a fabricated-sounding answer is the model following its own instructions.
- **No independent citation/fact verification.** Whatever section or clause the model cites is not checked against the source text by any code — it's exactly what Gemini wrote.
- **No separate topic/scope filter.** There's no code-level check that blocks off-topic questions (e.g. non-insurance questions) — the boundary exists only inside the prompt's own instructions, not as a hard rule outside the model.
- **The "nothing found" signal isn't surfaced in the UI.** As noted in Section 1, the backend computes it but the front-end doesn't currently act on it.

---

## 5. Knowledge and source behaviour

**Sources Product Assist actually draws from**, per insurer category:
- Ingested **PDFs and web pages** — brochures, policy wording, prospectuses, add-on documents, claims guides — chunked and turned into searchable embeddings.
- The **Product Playbook** — a Google Sheet the product team maintains. Its narrative tabs are ingested like normal documents; its per-plan feature-comparison tabs are reshaped into a separate, structured "plan facts" table that's matched by exact plan name and always injected in full (not similarity search) whenever it matches — because a partial similarity match could silently drop the one line that actually answers the question.

**How relevance is decided:**
- For PDFs/web pages: **vector similarity** between the question (plus recent conversation context) and each stored chunk — top 24 matches, always, from whatever's eligible for the selected insurer/plan.
- For Playbook facts: an **exact match** on insurer name + plan name, not similarity.

**Does it answer only from those sources?** Yes, by explicit instruction — general insurance knowledge may only be used as labeled interpretive support, never as a stand-in fact.

**When there's no relevant information**, the model is told to say so plainly rather than guess (see Section 4 for the caveat on how that currently surfaces to the advisor).

**Prioritization rule that materially changes answers:** when the Playbook has an entry for the exact topic being asked, that entry is treated as complete and exclusive for that topic — the model is told *not* to supplement it with an extra detail pulled from a Policy Wording excerpt, even if that detail is real and on-topic, because the Playbook is the product team's live record of what's actually still true for that plan.

---

## 6. What the advisor experiences — 3 realistic walkthroughs

**A. Plan explicitly picked, clean answer available**
Advisor selects HDFC Ergo → Optima Secure chip → asks *"What's the waiting period for pre-existing diseases?"* → SELECTED SCOPE tells Gemini a plan was explicitly chosen → retrieval pulls the top 24 chunks tagged for Optima Secure (or untagged HDFC Ergo-wide docs) and checks the Playbook for a matching Waiting Period fact → Gemini reads everything, follows the source pecking order, writes an Answer ending in a References list (e.g. "Policy Wording, Section 4.2") → because it reached a genuinely confident answer, a Draft Message paraphrase is also generated → advisor sees Answer, References, Draft Message, and a Sources list (clickable where a real document URL exists).

**B. No plan picked, but named in the question**
Advisor selects only Care Health (no plan chip) → asks *"Does Care Supreme have a Cumulative Bonus?"* → the server detects "Care Supreme" directly in the question text against Care Health's known plan roster and treats it as the effective plan for both retrieval and the Playbook lookup, but tells Gemini this was *detected*, not explicitly chosen → if the Playbook's Bonus entry for Care Supreme doesn't mention a Cumulative Bonus, the model is instructed to say plainly it doesn't currently apply to this plan, rather than just quoting an isolated Policy Wording clause about it out of context.

**C. Cannot confidently answer**
Advisor asks something like *"Is an OCI cardholder's newborn covered under this plan?"* and the retrieved material doesn't clearly address that specific scenario → the ESCALATION rule applies: the model states plainly what the sources do and don't establish, does not present a guess as settled, and adds a note to confirm the specific case with Ditto's complex queries team → advisor sees that explanation in the Answer box, but **no Draft Message box at all** (share is null) — nothing goes into their copy-paste-to-customer workflow for an unresolved case.

---

## 7. Boundaries of Product Assist

**Product Assist is designed to** take a specific, sourced insurance-product question from an advisor, retrieve the matching policy documents and Product Playbook facts for the exact plan in scope, and have Gemini compose a source-grounded answer with verifiable citations, plus (only when genuinely confident) a simplified paraphrase safe to forward to a customer — behind a mandatory "verify before you rely on this" acknowledgment every advisor has to pass through.

**It is not designed to** give a guaranteed, independently fact-checked, or complete answer on its own. There is no confidence threshold on what gets retrieved, no automated citation verification, and no hard topic boundary outside the prompt itself — its only real defense against a wrong or out-of-scope answer is the strength of its own written instructions plus the advisor's own verification against the linked source, not a separate enforcement layer in the code.

Specifically:
- **Providing information** — yes, this is its core job: synthesizing matched excerpts and Playbook facts into a structured, cited answer.
- **Making assumptions** — explicitly disallowed as fact; only permitted as clearly-labeled interpretive language ("this appears to be…", "this is an inference based on…"), never with the same confidence as a stated fact.
- **Giving a definitive answer** — only when sources genuinely and unambiguously support it; "Conditional" and "Not specified" are explicitly barred from being upgraded to "Yes"/"No," and genuine uncertainty triggers an escalation note rather than a manufactured definitive answer.
- **Handling information that isn't available** — told to say so plainly rather than guess, and the customer-facing paraphrase is forced empty so nothing unverified reaches a customer.
