# Product Assist — Quality-Preserving Optimization Review
*Read-only code review. No code was changed. Priority order followed throughout: (1) output quality/reliability, (2) cost — never the reverse. Based on `src/server/knowledgeBase/queryAssist.ts`, `embeddings.ts`, `chunking.ts`, `geminiClient.ts`, `kbChunksRepository.ts`, `kbPlaybookPlanFactsRepository.ts`, `playbookIngest.ts`, `server.ts`, and `QueryAssistPage.tsx` as of 2026-08-20.*

---

## 1. Baseline — what the current system does well, and must not be disturbed

| Dimension | Current mechanism | Why it's working / must be preserved |
|---|---|---|
| **Source grounding** | CORE RULE forbids stating anything not in SOURCE CONTENT; checklist item 2 ("No fact was invented, inferred, or assumed") and item 13 (inferences must be explicitly flagged, e.g. "this appears to be…") reinforce it twice more. | This is prompt-enforced, not code-enforced — its reliability comes entirely from this exact wording being present, repeated, and unambiguous. Any prompt edit near this language is high-risk. |
| **Retrieval quality** | `gemini-embedding-001`, correctly split into `RETRIEVAL_DOCUMENT` (indexing) vs `RETRIEVAL_QUERY` (question) task types — the model-recommended pairing. Top-24 chunks, no similarity floor. | The 24-chunk figure isn't an untested guess — the code comment records it was **raised from 14 after a real accuracy bug**: a tighter top-k was under-recalling secondary sections (e.g. an Aggregate Deductible clause), producing answers that silently dropped restrictions. This is direct historical evidence against cutting it back down. |
| **Product Playbook precedence** | A separate, non-similarity, exact-match, always-injected-in-full channel. Explicit prompt rule: when the Playbook covers a topic, it is the *exclusive* answer for it — nothing else may add detail, even if true. | This is the strongest, most deliberate design decision in the system. It exists specifically so a stale/superseded detail in a PDF can never leak into an answer once the Playbook has been corrected. Do not weaken. |
| **Plan/scope detection** | Three explicit states (picked via UI / detected from question text via conservative whole-word matching / neither), communicated to the model as its own labeled line so it knows how much to trust the detection. | Deliberately conservative (a longer roster match suppresses a shorter substring match of it) — avoids false-confident plan assumptions. |
| **Multi-document reasoning** | COMPREHENSIVENESS ("read EVERY excerpt... an answer built from only the closest-matching excerpt is incomplete and will be treated as WRONG") + INTERCONNECTED PROVISIONS (checks add-ons overriding exclusions, definitions changing clause meaning, etc.). | This is the single biggest reason the system needs a *wide* set of chunks, not a narrow one — it's explicitly designed to catch a qualifying clause sitting outside the top few matches. |
| **Citation behaviour** | Requires a real section/clause identifier, explicitly bans citing a paraphrased sentence as if it were a section name, with a worked bad-example in the prompt itself. | Precise and unambiguous already — nothing to gain from touching it. |
| **Handling of uncertainty** | Distinguishes ordinary "not specified" (checklist item 9) from genuine ESCALATION (ambiguous/conflicting/edge-case); "Conditional" can never become "Yes," "Not specified" can never become "No" (items 8–9). | This is the core of what keeps the tool from sounding more confident than its sources support. |
| **Escalation behaviour** | Specific instruction to tell the advisor to confirm the case with Ditto's complex queries team, explicitly kept *out* of the customer-facing "share" text. | High-stakes, working as designed. |
| **Draft Message protection** | `share` is a real JSON `null` (not a string) whenever "answer" wasn't a genuine, confident, sourced answer — enforced by a dedicated NO DRAFT RULE, and the UI only renders the green box when `share` is non-null. | Arguably the single highest-stakes guardrail in the system — it's what stands between an unconfident answer and something an advisor might paste straight to a customer. |
| **Conversation continuity** | Server caps the transcript sent to the model at the last 4 turns; the retrieval-embedding text separately folds in only the last 3 **user** turns (assistant turns deliberately excluded so a long prior answer doesn't dilute the embedding). A dedicated CONTINUING A CONVERSATION rule tells the model to resolve a short reply against its own last clarifying question. | Already a lean, purpose-built design — not a naive "send everything" implementation. See Section 2C for why this is close to the efficient frontier already. |
| **Overall completeness** | COMPREHENSIVENESS, the four-part "how to claim" structure requirement, and PLAYBOOK COMPLETENESS IN SHARE (list every applicable Playbook point, not just the most prominent) all deliberately bias toward more information over brevity. | Directly in tension with any "make it shorter/leaner" instinct — this is the part of the system a token-focused optimization would most likely damage first. |

---

## 2. Evaluation of the specific changes discussed

### A. Retrieval relevance filtering (currently top-24, no threshold)

Cutting the chunk count outright (e.g. 24 → 10) is **not recommended**. The code's own history is the strongest evidence here: a similar-sized limit (14) already caused a real, documented completeness bug before it was raised to 24. Reducing it again risks reproducing exactly that failure — and COMPREHENSIVENESS explicitly instructs the model to read *every* excerpt, so a smaller pool directly fights the prompt's own design intent.

Safer alternatives:

- **A conservative distance ceiling, not a chunk-count cut.** `findSimilar` already computes cosine `distance` per chunk — it's fetched but currently discarded before reaching Gemini. A very conservative floor that only drops chunks that are almost certainly noise (not "the 10th-best match," but "this clearly isn't about the topic at all") could reduce token volume without touching genuine completeness. This needs calibration against real data, not intuition — cosine distance doesn't translate linearly to "is this relevant."
- **De-duplication of near-identical chunks**, not relevance judgment — e.g. adjacent chunks from the same resource that overlap almost entirely (a byproduct of the 150-character chunk overlap, or a resource that was re-ingested). This removes redundancy, not information, so it's structurally low-risk — though because the overlap window is already small, the realistic savings may be modest, worth measuring before investing engineering time.
- **Raising, not lowering, the limit** is actually *more* aligned with the stated priority order than cutting it — worth knowing even though it's not what was asked.

### B. Prompt optimization

This prompt is not a first-draft-verbose prompt — several sections are visibly scar tissue from specific, previously observed failures (e.g. the SELECTED SCOPE section's own comment records it was added because the model was asking "please specify which plan" even when a plan *had* been selected; the structured JSON `answer`/`share` output replaced an earlier "---SHARE---" text delimiter that "didn't always comply, which silently dropped the Draft Message with no error surfaced anywhere"). That materially raises the risk of "simplifying" it.

There is real repetition (the Conditional≠Yes / Not-specified≠No rule appears in three places; "never invent/infer" appears in four), and the 16-point checklist restates many prose rules again at the end. Both are very likely **deliberate reinforcement, not accidental bloat** — restating a hard constraint near its point of operational use, and restating rules as a final checklist immediately before output, are both established ways to improve LLM instruction-following, not signs of a sloppy prompt.

A concrete, decisive finding: **the fixed system instruction is a small fraction of total tokens per request.** At roughly ~2,500 tokens for the whole instruction versus ~24 chunks × ~300 tokens ≈ 7,200+ tokens of retrieved source content (before Playbook facts or history are even added), the *source content*, not the instruction text, is the dominant cost driver. Shortening the prompt is therefore a low-leverage lever carrying real behavioral risk for comparatively little token savings — the two facts point the same direction: **leave the prompt text alone**, and if a token lever is wanted, look at retrieval/context instead.

### C. Conversation-history optimization

Already fairly lean: 4 turns to the model, 3 user-only turns folded into the retrieval embedding. There isn't much slack left to cut without directly risking the exact scenario you described (a clarifying question → "Yes, the 2025 version"), since CONTINUING A CONVERSATION depends on the model's own last turn still being visible.

- Cutting the 4-turn cap further: real risk of breaking that exact scenario.
- Summarizing history instead of sending it verbatim: requires an *extra* Gemini call (adds cost and latency, working against the stated goal) and introduces a new failure mode — a summarizer could itself drop the referent a follow-up depends on.
- Heuristic "only include load-bearing turns": no reliable, cheap way to classify "load-bearing" exists today; a wrong heuristic reproduces the same class of bug as an aggressive retrieval cut, just hidden behind different logic.

**No changes recommended.** Worth first measuring how many real conversations in production actually exceed 2–3 turns before treating this as a lever at all — if most conversations are short, there's nothing meaningful to optimize here regardless.

### D. Product Playbook optimization

Already close to optimal: it bypasses embedding/similarity search entirely (zero retrieval-quality risk), the content is compact structured "fact sheet" text rather than raw contract language, and it's scoped only to the plan(s) actually selected — not the whole catalog. If an advisor compares several plans at once, every one of those plans' Playbook content is included in full; that's correct, needed behavior for a comparison question, not something to trim.

**No changes recommended.**

### E. Context caching

What's genuinely reusable: the system instruction — 100% identical on every single request, ~2,500 tokens, the most cache-friendly content in the pipeline.

What changes every request: the history block, the scope line, and — critically — the entire source block (both retrieved chunks and Playbook facts), since retrieval is per-question and essentially never identical twice.

On your specific staleness concern: the system instruction never contains live product data (Playbook facts are always injected fresh, per-request, in the source block — never baked into the instruction), so caching *only* the system instruction would **not** create a Playbook-staleness risk. That is a clean, safe caching boundary. It would become risky the moment caching was extended to anything containing retrieved or Playbook content — that boundary should not be crossed.

Whether it's worth doing at all depends on real request volume and current per-cache-hour economics, which this review can't determine from the code alone — and it's worth checking whether Gemini's automatic/implicit prefix caching is already partially active on the account before building anything explicit.

### F. Model changes

No evidence in the codebase of any prior benchmarking against an alternate model for this task — no eval harness, no comparison script. The task itself (strict multi-document synthesis, citation-identifier discipline, distinguishing Conditional/Not-specified/genuine-escalation, reliable structured JSON) is exactly the kind of nuanced instruction-following work where a smaller/cheaper model is a real, unverified risk.

**No change recommended.** Keep Gemini 2.5 Flash unless the testing strategy in Section 6 produces hard evidence otherwise.

---

## 3. Other opportunities found by inspecting the implementation directly

- **Calls per question are already minimal** — exactly two Gemini calls per advisor question (one embedding call, one generation call); the Playbook staleness check is already fire-and-forget/non-blocking. No redundant calls found to remove.
- **The JSON-parse-failure fallback is sound as-is** (falls back to raw text as the answer, forces `share` to null, logs a warning) — this is the one deterministic backstop against a malformed model response silently failing; don't touch it.
- **No `maxOutputTokens` cap is currently set.** Worth *investigating* (not implementing without data) as a generous ceiling purely against a runaway/looping response — but any real number needs to be set well above the longest legitimate answer today, since the four-part "how to claim" structure and PLAYBOOK COMPLETENESS IN SHARE rule both deliberately produce long, multi-part answers. Note output tokens are a much smaller share of total cost here than input tokens (the 24-chunk source block dominates), so this is a low-priority safety net, not a real savings lever.
- **A deterministic, code-level citation sanity check** (e.g. confirming every document named in the References list actually appears somewhere in that request's source block) would be a genuine *quality* addition — not a cost saving — worth a future project on its own, separate from this cost-focused review.
- **Query expansion/rewriting before embedding** could improve retrieval recall, but costs an *extra* Gemini call — a quality idea that runs counter to a cost-focused review, flagged for a future initiative, not this one.
- **Dynamic context sizing by question complexity** was suggested as a direction worth investigating — but no reliable, cheap complexity classifier exists today, and a wrong one reproduces the same "missed exception" risk as a blind chunk-count cut, just hidden behind a heuristic instead of a flat number. Not recommended without strong evidence such a classifier can be built safely.

---

## 4. Every proposed change, with quality/cost trade-off

Legend: 🟢 Safe improvement · 🟡 Potential improvement (test first) · 🔴 Cost saving with quality risk · ⚪ Not worth changing

| # | Current behaviour | Proposed change | Quality impact | Cost impact | Risks | Regression risk | How to test |
|---|---|---|---|---|---|---|---|
| 1 | Top-24 chunks, no floor | Cut to a smaller fixed number (e.g. 10) | 🔴 Likely negative — matches the documented 14-chunk regression | Lower input tokens | Missed secondary clauses/exceptions, incomplete "how to claim" answers | High — same failure class already seen once | Full test set in Section 6, especially the "multiple document sections" and "exclusions/conditions" categories |
| 2 | No similarity floor | Add a conservative distance ceiling to drop only clearly-irrelevant chunks | 🟡 Neutral-to-positive if calibrated correctly | Modest token reduction | Wrong threshold silently drops a real match, same failure class as #1 | Medium — depends entirely on calibration | Compare retrieved-set overlap and downstream answer completeness against the uncapped baseline on the full test set before enabling |
| 3 | Chunks include near-duplicate overlap text | De-duplicate near-identical chunks only | 🟢 Removes redundancy, not information | Small, unmeasured reduction | Very low if implemented as exact/near-duplicate detection, not relevance judgment | Low | Measure how often true duplicates actually occur in real retrievals before building it |
| 4 | ~1,900-word fixed prompt, some repeated rules | Consolidate repeated instructions | 🔴 Repetition is likely deliberate reinforcement near point-of-use | Small — prompt is a minor fraction of total tokens vs. source content | Instruction-adherence regression on exactly the rules being consolidated | Medium-high, hard to detect except via the full test set | Full test set, focused on escalation/uncertainty and Draft Message correctness |
| 5 | 16-point internal checklist | Remove or shorten checklist | 🔴 Checklist-as-final-reinforcement is a known effective technique | Small | Same as #4 | Medium-high | Same as #4 |
| 6 | 4-turn history cap, 3-user-turn embedding context | Reduce further | 🔴 Direct risk to the "Yes, the 2025 version" scenario | Small — history is already capped tightly | Broken follow-up resolution | High for that specific scenario | Dedicated follow-up-question test cases (Section 6) |
| 7 | Full transcript sent within the cap | Summarize history instead of sending verbatim | 🟡 Unproven, adds a new failure surface | **Negative** — an extra Gemini call adds cost, not saves it | Summarizer drops the referent a follow-up needs | Medium | Same as #6, plus cost/latency measurement of the added call |
| 8 | Playbook facts always injected in full for matched plans | Truncate/summarize Playbook content | 🔴 Directly weakens the system's strongest guardrail | Small — Playbook content is already compact | Silent loss of the authoritative, current fact | High | Not recommended to test — no plausible upside found |
| 9 | No context caching | Cache only the fixed system instruction | 🟡 No quality impact expected (content never changes) | Depends on real request volume/cache economics | None to Playbook freshness if scope is respected exactly; risk appears only if caching scope creeps to source content | Low, contingent on strict scope | Verify current implicit-caching status first; if pursued, monitor for any staleness before/after |
| 10 | No context caching | Cache retrieved source content or Playbook facts | 🔴 Real staleness risk | Cost savings, but at the cost the user explicitly ruled out accepting | Serving outdated policy/Playbook content | High | Not recommended |
| 11 | `gemini-2.5-flash`, no eval history | Switch to a smaller/cheaper model | 🔴 No evidence it maintains quality on this task | Lower per-call cost | Accuracy, citation quality, and escalation behaviour all unverified on the new model | High, unverified | Full side-by-side eval per Section 6 before any consideration |
| 12 | No `maxOutputTokens` cap | Add a generous ceiling as a runaway-cost safety net | ⚪/🟡 No quality impact if set well above real answer lengths | Minimal — output tokens aren't the dominant cost here | Truncating a legitimate long multi-part answer if set too low | Low if set conservatively, based on measured real answer lengths first | Measure longest real answers today, then set a ceiling well above that, then test against the "how to claim" / multi-part-answer test cases |
| 13 | No deterministic citation check | Add a code-level check that citations reference real documents in scope | 🟢 Quality-improving, not cost-related | Roughly neutral | None identified | Low | Not part of this cost review — separate quality initiative |

---

## 5. The hard quality rule for this review

**No optimization should be accepted if it reduces answer quality, completeness, source fidelity, citation reliability, or safety merely to save Gemini API cost.** If a change saves a meaningful percentage of API cost but creates even a small, meaningful risk of missing an important policy condition, exception, limitation, or clause, it is flagged here rather than recommended. That standard has been applied throughout Sections 2–4 above — it's why almost every proposal here lands on 🔴, 🟡, or ⚪ rather than 🟢.

---

## 6. Safe testing strategy — current vs. optimized

**Important constraint found while designing this:** Query Assist deliberately keeps **no server-side record of advisor conversations** (an explicit product decision — see `server.ts`'s stateless `/api/query-assist/ask` route). That's good for advisor privacy, but it also means there is currently **no existing log of real advisor questions to mine a representative test set from.** The test set below has to be hand-authored by someone with real insurance-product knowledge (the same kind of manual cross-checking already used to verify Specific Illness Check entries against real policy PDFs), not pulled from usage data. Worth being upfront about that in the meeting — it's a real dependency, not a detail.

**Test set** — for each insurer/plan combination that matters, author real questions covering:
1. Simple product questions
2. Plan-specific questions
3. Questions requiring multiple document sections to answer completely
4. Questions involving exclusions/conditions
5. Questions where Playbook and documents interact (ideally a case where a document contains a sub-type the Playbook doesn't mention, to directly test SOURCE PRECEDENCE #1)
6. Ambiguous questions (no plan selected, answer genuinely differs by plan)
7. Questions with no available answer in the knowledge base at all
8. Edge cases that should trigger ESCALATION, not a confident answer
9. Follow-up questions that depend on conversation context (including the exact "Yes, the 2025 version" pattern)

**Method:** run every test question through the **current system unchanged (the control)** and through each proposed variant, side by side, on identical inputs — never replace-and-hope. For each pair of answers, a human with real product knowledge scores:

- Correctness, completeness, source fidelity, citation accuracy, plan accuracy
- Hallucination rate (any claim not traceable to a real cited source)
- Whether escalation happened when it should have (and didn't happen when it shouldn't have)
- Customer-draft safety — was `share` populated only when it genuinely should have been, and never overstated
- Latency, input tokens, output tokens, and cost per query — logged automatically per call for both variants

**Decision rule:** a variant only replaces any part of the current system if it matches or improves every quality metric above (not just the average) — a variant that improves cost but degrades even one quality metric, on even one test category, does not ship.

---

## 7. Actual recommendation

**No, I would not change anything in the current implementation right now.**

Every specific idea discussed — cutting retrieval chunk count, shortening the prompt, reducing conversation history, changing Playbook handling, or switching models — carries a real, identifiable quality or completeness risk, and in three cases (retrieval count, conversation history, prompt consolidation) there's direct historical or structural evidence in the code itself that a similar change already caused problems once before. Given the explicit priority order for this review, none of those clear that bar.

There are exactly **three ideas worth *testing*, never shipping without testing**, because they target genuine waste rather than genuine content:

1. **Cache only the fixed system instruction** (never retrieved content or Playbook facts) — the one piece of every request that is provably 100% identical every time.
2. **A conservative distance-based floor** on retrieval, calibrated to drop only obviously-irrelevant chunks, not to hit a target chunk count — kept separate in spirit from ever reducing the top-k target itself.
3. **A generous `maxOutputTokens` ceiling**, set only after measuring real answer lengths, purely as a runaway-cost safety net rather than a routine trim.

Expected quality impact of all three, if implemented exactly as scoped above: none (by design — none of them touch what Gemini actually sees as source content or instructions). Expected cost impact: unknown until measured against real request volume and real chunk-overlap frequency — this review deliberately doesn't estimate a percentage, because doing so without real production numbers would be exactly the kind of unverified assumption you asked me not to make. Risk if scope creeps beyond what's described above (e.g. caching source content, or letting the distance floor become a disguised chunk-count cut): real, and covered in the trade-off table.

None of the three should be adopted without first running the Section 6 test harness and confirming zero regression across every listed quality metric, not just the ones a given change happens to target.
