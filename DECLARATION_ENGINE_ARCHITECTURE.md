# Declaration Engine — Runtime Architecture (as implemented)

Status: **implemented and merged**, 2026-07-29; corrected 2026-07-29 following user review. This document is the permanent record of what the runtime actually does. Update it directly if the runtime changes again — don't leave it to drift.

## Umbrella questions vs. the Plan Decision Engine — read this first

This distinction is fundamental and was gotten wrong in this document's first draft, so it's called out on its own before anything else.

**Umbrella questions are advisor-assisted guidance surfaced within the existing fallback response. They are not an automated routing stage, and nothing in this codebase — before or after this pass — classifies investigations, surgeries, medications, or treatments to select one automatically.**

The plan configuration model itself proves this: every DB-authored plan question is tagged exactly one of `"Specific"`, `"Umbrella"`, or `"Catch-all"` (`server.ts`'s `validatePlanQuestions`/`deriveQuestionFields`). These are three distinct things:

- **Specific** — a question naming a particular condition/category (e.g. "Hypertension / High blood pressure?"). Resolved via the deterministic engine or the Plan Decision Engine below.
- **Umbrella** — the tests/investigations/medications/surgeries/hospitalisations/treatments questions (`config.umbrellaQuestions`). `detectSupportingFlags` and `getApplicableUmbrellaQuestions` (`engine.ts`) scan the input for keyword signals (tests, medication, hospitalisation/surgery) and attach the *applicable-looking* umbrella questions — or, if none look applicable, the plan's full umbrella list — to a FALLBACK/P0/P1 response's `secondary_recommendation` field (`finalizeOutput`, `engine.ts`). This is advisory: the advisor reviews the list and decides whether any apply. **Nothing selects one automatically or treats a match as authoritative.**
- **Catch-all** — the plan's single generic disclosure question (`config.anyOther`, e.g. "Any other disease/condition not mentioned above?"). This is the true last-resort destination.

This pass's Plan Decision Engine (`resolvePlanDecision`) only concerns **Specific vs. Catch-all** — it decides whether a resolved category has a real, specific declaration question, or whether the plan deliberately routes that category straight to the **Catch-all** question (not to Umbrella). Its outcome originally named this `explicit_umbrella`, which was a naming mistake — it has been renamed to **`explicit_catchall`** throughout the code, tests, and this document. The Umbrella-question advisory mechanism (`detectSupportingFlags`, `getApplicableUmbrellaQuestions`, `secondary_recommendation`) is completely separate, was never touched by this pass, and remains exactly as it was.

## Runtime decision hierarchy

```
Normalize
   │
   ▼
Resolve Alias                                  [PED Repository Lookup — a single
   │                                             architectural component; internal
   ▼                                             normalization stays encapsulated here]
Canonical PED
   │
   ▼
PED Found? ──No──► AI Memory (L2 cache) ──Found?──Yes──► Continue below with cached answer
   │                      │
  Yes                    No
   │                      │
   │                      ▼
   │              Ask Gemini to identify the PED     [Rule 4 — repo knowledge insufficient]
   │              (temporary classification only —
   │               never written to ped_repository /
   │               ped_aliases / categories)
   │                      │
   │              ┌───────┴───────┐
   │          Identified      Not identified
   │              │                 │
   │              ▼                 ▼
   │      (continue below)   Existing Fallback Response       [Rule 6]
   │
   ▼
PED-level Plan Override?                       [Rule 1 — highest priority]
(plan_overrides: (planName, pedId) -> category, checked
 BEFORE category resolution — engine.ts stage 0.4)
   │
  Yes ──► Return override's question. STOP.
   │
  No
   │
   ▼
Category Mapping
(~13 governed universal category behaviors —
 vascular_fallback, acute_infection, allergy,
 neuro_mild, investigation_procedure, etc. — that
 always resolve the same way regardless of plan;
 plan-agnostic by design, pre-empt everything below
 when they match)
   │
   ▼  (falls through if none match, or PED has no category)
PLAN DECISION ENGINE   (resolvePlanDecision, engine.ts)     [Rule 2/3]
For this (plan, category), exactly one of:
   │
   ├─ direct_question ─────► Return that Specific question. STOP.            [Rule 2]
   ├─ explicit_catchall ───► Return plan's Catch-all question. STOP.         [Rule 3 — no Gemini]
   └─ no_mapping ──────────► Keep evaluating shared regex/shield sections
                             (plan-independent keyword matching, unchanged)
                                  │
                                  ▼ (nothing matched)
                             AI Memory ──Found?──Yes──► Continue with cached answer
                                  │
                                 No
                                  │
                                  ▼
                             Ask Gemini                    [Rule 4 — category missing]
                             (question_number selection unchanged;
                              ALSO returns identified_category + confidence,
                              cross-checked against the same Plan Decision
                              Engine above for logging only — never
                              overrides Gemini's own question pick)
                                  │
                         ┌────────┴────────┐
                    Resolved            Cannot resolve
                         │                    │
                         ▼                    ▼
              Return question       Existing Fallback Response       [Rule 6]
                                     • Show Umbrella guidance (advisory)
                                     • Advisor checks Umbrella questions manually
                                     • Otherwise disclose under Catch-all
```

## What changed this pass, and why

An architecture review (2026-07-28/29) proposed a cleaner runtime shape and flagged specific rule violations in a draft diagram. Auditing the actual implementation against that review turned up a mix of findings — some already correct, two requiring an explicit scope decision from the user before any code changed, and one naming mistake caught by the user after implementation (see "Umbrella questions" above).

### Already correct — no change needed

- **Rule 1 ordering.** `plan_overrides` (PED-specific, per-plan category override) is already checked before category/dictionary resolution — `engine.ts` stage 0.4 runs, and returns immediately, before stage 0.7.
- **AI Memory before Gemini.** `/api/match` was already L1 (deterministic) -> L2 (AI Memory cache) -> L3 (Gemini), matching the approved diagram exactly.
- **Gemini never automatically writes governed data.** Even a human-approved AI Mapping Review entry writes into the legacy `ped_mapping_overrides` table, never `ped_repository`/`ped_aliases`/`categories`. (Those two override systems still aren't unified — a separate, already-documented gap from Phase 5, not something this pass touched.)
- **Gemini is never invoked for "category has no plan question" or "category intentionally routes to the catch-all."** `classifyDeterministic` already always returns a result once a category resolves — real question or FALLBACK to `anyOther` — so it never fell through to Gemini for those cases. Confirmed against real data: `covid`, `lipid`, and `skin` are explicitly wired in `types.ts` straight to `config.anyOther` (the Catch-all question), with an existing code comment stating this is deliberate, specifically to keep those categories out of the Gemini path.
- **Umbrella-question advisory guidance.** Entirely untouched by this pass — see the clarification section above.

### Implemented this pass

**Plan Decision Engine** (`resolvePlanDecision`, `src/engine.ts`). Extracts the one part of `classifyDeterministic` that is genuinely "insurer-specific routing for an already-resolved category" into an explicitly named, reusable function with three outcomes — `direct_question`, `explicit_catchall`, `no_mapping`. All three outcomes already existed in the data (confirmed via the `covid`/`lipid`/`skin` examples above); this makes the distinction explicit and testable instead of leaving it implicit inside one long inline `if`/`else`. It concerns **only Specific-vs-Catch-all routing** — it has no awareness of, and does not touch, Umbrella questions at all. Behavior is byte-for-byte unchanged — verified by the full existing regression suite passing unmodified (`engine.baseline.test.ts`, `specificIllnessEngine.baseline.test.ts`, 192/192 tests project-wide) plus new dedicated unit tests for all three outcomes and the "secondary manifestation root-category rescue" edge case (`engine.utils.test.ts`).

**Gemini's temporary classification** (`server.ts`, the `/api/match` Level 3 block). Gemini's response schema now additionally returns `identified_category` (constrained to the live `categories` table — Postgres stays authoritative even for what a valid category *is*) and `confidence` (`HIGH`/`MEDIUM`/`LOW`), alongside its existing `question_number` selection. That classification is run through the same `resolvePlanDecision` a repository-resolved category would use, purely as a cross-check — logged when it disagrees with Gemini's own question pick, and recorded into `ai_memory`'s pre-existing (previously unpopulated) `confidence`/`suggestedCategoryKey` columns for AI Mapping Review visibility. **It never overrides the question actually returned to the advisor**, and it plays no role in Umbrella-question guidance.

### Explicit scope decisions (made by the user, not assumed)

1. **Gemini's prompt/routing logic was deliberately NOT rewritten.** The architecturally "pure" version of this design has Gemini return only classification (PED + category + confidence), with all routing happening in the Plan Decision Engine. Today's Gemini call instead fuses classification and insurer-specific routing into one call, with ten tuned clinical firewalls written in terms of each plan's actual question wording. Rewriting those ten rules around category-only reasoning was judged too high-risk against the explicit "preserve all existing functionality and underwriting behavior" requirement. The additive fix above satisfies the architecture's data shape and Governance Rule 2 without touching any tuned firewall. **If a full rewrite is wanted later, treat it as its own initiative** with its own validation pass.

2. **Umbrella questions are not, and will not be, an automated routing layer.** Corrected in this revision — see the clarification section above. The Plan Decision Engine's Catch-all outcome was initially misnamed `explicit_umbrella`, which incorrectly implied it had something to do with Umbrella questions. It does not. Renamed to `explicit_catchall`.

## Scope boundaries (deliberately not touched)

- **Umbrella question selection** (`detectSupportingFlags`, `getApplicableUmbrellaQuestions`, `secondary_recommendation`). Advisor-assisted guidance, unchanged, and explicitly out of scope for any future "second decision engine" — see clarification above.
- **The ~13 hardcoded universal categoryKey behaviors** (`vascular_fallback`, `autoimmune`-on-Optima-Secure, `acute_infection`, `allergy`, `gynecomastia`, `ambiguous_symptom`, `eosinophilia_finding`, `lifestyle`, `natural_life_stage`, `acute_trauma`, `neuro_mild`, `investigation_procedure`, `benign_growth`) sit before the Plan Decision Engine and pre-empt it entirely when they match. These are plan-*agnostic* category behaviors, not plan-specific routing, so they don't belong inside `resolvePlanDecision` — they're a separate, legitimate layer that happens to run first.
- **The diabetes insulin-qualifier check** (Care Supreme / Activ One Max's `requiresInsulinForDiabetes` override) remains a post-check applied *after* the Plan Decision Engine returns `direct_question` for the `diabetes` category — it's a per-condition qualifier, not a routing-existence question, so it doesn't belong inside `resolvePlanDecision` either.
- **`ped_mapping_overrides` vs. the new governed tables.** Human-approved AI Mapping Review entries still promote into the legacy override table, not `ped_repository`/`ped_aliases`. Unifying these remains open technical debt from Phase 5, unchanged by this pass.
- **AI Mapping Review's UI** does not yet have a dedicated display for the newly-populated `confidence`/`suggestedCategoryKey` columns — they're captured in the raw JSON detail view today. A follow-up UI pass could surface them more prominently.

## Verification

- Full regression suite: 172/172 non-DB tests + 5 `resolvePlanDecision` unit tests, all passing unchanged after both the initial extraction and the `explicit_catchall` rename. DB-touching repository tests (20/20) previously confirmed passing against production Postgres this same session (192/192 total project-wide).
- Full-project `tsc --noEmit`: clean.
- No behavior change to any existing (alias, plan) pair, and no change whatsoever to Umbrella-question guidance — the Plan Decision Engine extraction is a structural rename/reorganization of the Specific-vs-Catch-all logic only.
