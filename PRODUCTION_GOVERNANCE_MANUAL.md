# Production Governance Manual
## Declaration Assistant — Mapping Engine

**Audience:** New contributors integrating conditions or plans into the mapping engine.
**Prerequisite knowledge:** None. This manual is self-contained.
**Golden rule:** This manual *documents* the engine as it exists. Where the engine does not define a single deterministic policy, the manual says so and marks it **Business Decision Required** — it does not invent a rule.

**How to read the classifications.** Every statement in this manual carries one of four tags:

- **[CURRENT]** — Documented production behavior. Backed by observable execution order or implementation.
- **[GOVERNANCE]** — A rule contributors must follow to protect the engine. Process, not runtime behavior.
- **[BUSINESS DECISION]** — An area where the engine has no single policy. Must be decided by the product/underwriting owner, not resolved here.
- **[PROCESS]** — A required workflow step.

If a statement would describe behavior but no production evidence supports it, it is deliberately downgraded to **[BUSINESS DECISION]** rather than presented as current behavior.

**Manual structure.** The chapters fall into two parts. This grouping is organizational only — chapter numbers are stable and unchanged.

- **Part I — Engine Behavior Reference** (what the engine does; do not change without a regression run): Chapters 1, 2, 3, 6, 12, 15, 18, plus the evidence portions of 4, 8, and 14.
- **Part II — Development Governance & Process** (how contributors and reviewers work; changing these does not change the engine): Chapters 5, 7, 9, 10, 11, 13, 16, 17, plus the governance/process portions of 4, 8, and 14.

When a chapter contains both (e.g. 4, 8, 14), each statement carries its own tag so the two parts never blur.

---

## Chapter 1 — Purpose

**What the engine is** — [CURRENT]
The mapping engine (`src/engine.ts`, primarily the `classifyDeterministic` function, supported by `TOP_PED_DICTIONARY` in `src/types.ts`) is a **deterministic router**. Given a declared pre-existing condition (PED) string and a selected insurance plan, it returns exactly one declaration outcome: a `match_type` (P0 / P1 / FALLBACK / NON_AILMENT / ESCALATE / INVALID) and the specific plan question the condition should be declared under (or the plan's "Others/Any other" catch-all).

It is **wording-first and plan-aware**: it resolves a condition to a *category*, then resolves that category to *this plan's actual question text* via each plan's `categoryMap`. The same condition can therefore legitimately produce different declaration questions on different plans.

**What the engine is NOT** — [CURRENT]
- It is **not a medical taxonomy or diagnosis tool.** Its "disease family" groupings are matching conveniences, not clinical classifications.
- It is **not a universal medical-routing authority.** It does not encode one rule for where a disease "should" be declared; it encodes where *each plan's wording* places it.
- It is **not a source of medical truth.** Every output ends with an advisory instruction to cross-check the declaration framework before the final disclosure call.
- It is **not the only decision-maker.** When deterministic routing produces no match, control passes to an AI fallback layer outside this engine.
- It is **not a multi-declaration system.** It returns a single primary declaration route per condition.

---

## Chapter 2 — Core Principles

Only principles directly supported by the implementation are listed. Aspirational rules are excluded.

**2.1 Wording-first routing** — [CURRENT]
Routing terminates at the question whose text covers the condition. Evidence: `questionForCategory()` resolves a plan's `categoryMap[categoryKey]` to a real question string; the earliest routing stage is an **exact plan-wording chunk match** that splits each plan question on `/ , ( ) or` and returns `P0` when the condition equals a fragment. Exact wording outranks every category inference.

**2.2 Plan-aware routing** — [CURRENT]
The same category resolves to different questions (or to none) per plan, because `categoryMap` is per-plan. Plan-specific overrides and plan-specific `overrides` flags (`requiresInsulinForDiabetes`, `bypassBenignTumors`, `excludePrediabetes`) further alter routing for named plans. Evidence: dedicated `if (planName === "…")` blocks for Activ Fit Preferred, Care Supreme, and Optima Secure, executed before generic logic.

**2.3 Deterministic routing** — [CURRENT]
For a fixed (condition, plan) pair the output is stable — the function is pure over its inputs with no randomness or external state. Evidence: regression baseline snapshot tests (`src/__tests__/engine.baseline.test.ts`, `specificIllnessEngine.baseline.test.ts`) assert a stable classification for every smoke-test PED on every plan.

**2.4 Conservative fallback** — [CURRENT]
Conditions that are symptoms, tests, life stages, acute/transient events, or otherwise not a definitive chronic diagnosis are routed to the plan's Others question with the umbrella (hospitalisation/surgery/medication) questions surfaced. Evidence: the natural-life-stage firewall, the fast-path test/acute-infection/ambiguous-symptom/lab shields, and `finalizeOutput` attaching `secondary_recommendation` umbrella questions to FALLBACK outputs.

**2.5 Single-declaration default** — [CURRENT]
Each condition resolves to exactly one `matched_question`. No code path emits two independent declarations. Evidence: `makeOutput` returns a single question; there is no multi-question emission anywhere in the pipeline.

**2.6 Unknown → AI handoff** — [CURRENT]
When no deterministic stage returns, `classifyDeterministic` returns `null` and the surrounding service defers to an AI fallback. Evidence: the function's terminal `return null`.

---

## Chapter 3 — Decision Hierarchy (actual execution order)

This is the real order in which `classifyDeterministic` attempts to resolve a condition. The **first stage that returns wins.** — [CURRENT]

1. **Natural life-stage firewall** → `NON_AILMENT`. Catches pregnancy, menopause, puberty, lactation, "healthy/normal/nil/n/a", vaccination, routine checkup. Hard exception: inputs containing `ectopic` bypass this firewall.
2. **Plan-specific overrides.** `if (planName === …)` intercepts for Activ Fit Preferred (sleep apnea → genetic; DVT/PE/varicose → heart), Care Supreme (Crohn's/colitis/IBD → blood), Optima Secure (autoimmune joint disease → musculoskeletal).
3. **Fast-path safety shields (A–I).** Global diagnostics/test firewall; acute-infectious firewall; hypoglycaemia shield; DVT/PE shield; gangrene shield; hypotension shield; gestational/Type-2 diabetes intercept; prediabetes intercept; HPV/HIV-only coupling.
4. **Exact plan-wording chunk match** → `P0`. The condition equals a `/`-separated fragment of a plan question.
5. **Dictionary exact-match routing.** `TOP_PED_DICTIONARY[cleanInput]` yields a `categoryKey`; special pseudo-category keys short-circuit to fixed fallbacks (e.g. `vascular_fallback`, `acute_infection`, `ambiguous_symptom`, `lifestyle`, `natural_life_stage`, `acute_trauma`, `benign_growth`); otherwise `questionForCategory` resolves the plan question.
6. **Disease-family regex sections** (~24 ordered blocks: COVID, malignancy, STD, lipids, diabetes, heart, hypertension, neuro, psychiatric, extrapulmonary TB, respiratory, kidney, reproductive, digestive, liver, endocrine, blood, genetic, autoimmune, sarcoidosis, musculoskeletal, skin, eye, ENT).
7. **Generic shields.** Benign growths, allergy, gynecomastia, ambiguous symptoms, lab findings, diagnostics, isolated procedures/trauma.
8. **No match** → `null` → **AI fallback** (outside this engine).

**Post-processing (always runs after a route is chosen):** `sanitizeOutput` → `applyPostGuards` (plan-aware corrections, e.g. Care Supreme diabetes Type-1 restriction; SLE/lupus organ-reroute) → `finalizeOutput` (resolves the question against the plan's real text, attaches umbrella recommendations, applies terminology and advisory-footer rules). — [CURRENT]

**Governance note** — [GOVERNANCE]: No new stage may be inserted at a position that alters the resolution of an already-mapped condition without a regression run against the baseline snapshots (see Chapter 11).

---

## Chapter 4 — Evidence Hierarchy (how a mapping decision is justified)

When deciding or defending where a condition routes, use evidence in this precedence order. Higher evidence overrides lower. — [CURRENT for 1–4; GOVERNANCE for 5–6]

1. **Insurer question wording** — [CURRENT]. If a plan's question text literally names or clearly encompasses the condition, that is decisive (this is what `P0` exact-match and `questionForCategory` encode).
2. **Plan-specific implementation** — [CURRENT]. An existing `planName ===` override or an `overrides` flag for that plan.
3. **Existing production behavior** — [CURRENT]. The current baseline snapshot for that condition on that plan. Changing it is a regression event (Chapter 11).
4. **Existing dictionary / synonym / category behavior** — [CURRENT]. How the canonical term and its siblings already route.
5. **Clinical reasoning** — [GOVERNANCE]. Used only to *choose a category* where wording and precedent are silent — never to override plan wording. The engine encodes clinical reasoning only as far as its existing category assignments; contributors must not extend it into a universal medical rule (see Chapter 9).
6. **Fallback** — [CURRENT]. If nothing above resolves, Others + umbrella, or AI handoff.

---

## Chapter 5 — Decision Framework for New Conditions

This framework tells a contributor *how to evaluate* an integration. It deliberately does **not** prescribe a single medical philosophy, because the engine does not implement one (Chapter 9). — [GOVERNANCE]

For each new condition, evaluate in this order:

1. **Declaration wording.** Does any plan question's text already name or encompass the condition? If yes, that plan routes by wording (P0/category). Record it.
2. **Plan wording differences.** Because wording differs per plan, expect — and document — that the condition may route to different questions on different plans. This is correct behavior, not an inconsistency.
3. **Specificity.** Prefer the most specific covering question over a general one, consistent with existing `P0 > P1 > FALLBACK` behavior.
4. **Overlap.** Identify every stage (override, dictionary, regex section) that could match the condition. The earliest in the Chapter 3 order wins — verify that is the intended stage.
5. **Collision.** Check whether the condition's tokens also match an unrelated earlier regex or a firewall (e.g. a status word colliding with the procedure shield). If so, the earlier stage will capture it — decide whether that is acceptable.
6. **Fallback.** Confirm the terminal behavior when a plan has no covering question: does it use a documented fallback chain (Chapter 6) or Others?

Where this framework cannot yield a single deterministic answer because the engine itself has competing behaviors (e.g. manifestation routing), stop and escalate to **Business Decision** (Chapter 9) rather than choosing arbitrarily.

---

## Chapter 6 — Tie-Breaking Rules

### Implemented and observable — [CURRENT]
- **Plan override beats everything downstream.** `planName ===` blocks run before shields, dictionary, and regex.
- **Exact wording (P0) beats dictionary and regex.** The chunk-match stage precedes dictionary routing.
- **Dictionary beats regex.** `TOP_PED_DICTIONARY` exact-match routing (stage 5) runs before the disease-family regex sections (stage 6). This is why a condition present as a dictionary key resolves by its category even when a later regex section would have matched it differently.
- **Among regex sections, earlier section wins.** The ~24 blocks are evaluated top-to-bottom; the first match returns. Section order is therefore the de-facto tie-break for multi-family conditions.
- **Benign CNS override.** A specific `if` reassigns `categoryKey` to `benign_growth` for meningioma/acoustic neuroma/craniopharyngioma before category resolution.
- **Post-guards can override the chosen question.** `applyPostGuards` reroutes specific cases after routing (e.g. SLE/lupus away from certain organ questions; Care Supreme non-severe diabetes to Others).

### Undocumented / implicit (behavior exists but no stated rule) — [CURRENT behavior, GOVERNANCE gap]
- **Two regex sections both matching** is resolved only by source order. There is no explicit, named tie-break policy — contributors must read section order to predict the winner.
- **Canonical term vs a qualified variant** can resolve differently (an exact dictionary key vs the same words plus an adjective reaching a later regex). The engine does not guarantee a variant matches its canonical form.

### Business Decision Required — [BUSINESS DECISION]
- **Synonym vs canonical consistency.** The engine does not guarantee that all synonyms of one condition route identically. Whether to *require* that is a policy choice, because enforcing it would change existing outputs.
- **Competing declaration questions within one plan.** If a plan's `categoryMap` could resolve one condition to two different questions, there is no defined precedence.

---

## Chapter 7 — Ownership Model

This chapter is governance only. It assigns *responsibility*, not runtime behavior. The engine does not encode ownership; therefore every item here is **[GOVERNANCE]** (a rule to adopt), not current behavior. Role names are placeholders to be mapped to your team.

| Asset | Owner responsibility |
|---|---|
| **Canonical conditions** | Owns the authoritative name for each condition and the decision to add a new one. |
| **Synonyms** | Owns the synonym set per canonical condition and whether synonym routing must stay consistent. |
| **Regex sections** | Owns the ordered disease-family blocks; approves additions/edits given their order-sensitivity. |
| **Shields / firewalls** | Owns the non-diagnosis token classes (tests, acute infection, symptoms, life stages, procedures). |
| **Category keys** | Owns the controlled vocabulary of `categoryKey`s and their meaning. |
| **Plan overrides** | Owns per-insurer `planName ===` blocks and `overrides` flags; ensures isolation (Chapter 8). |
| **Collision handling** | Adjudicates when a new condition collides with an existing stage. |
| **Fallback logic** | Owns the sanctioned fallback chains and the Others/AI terminal behavior. |
| **Regression approval** | Signs off that a change's diff against baseline snapshots is intended (Chapter 11). |

Until these owners are named, changes in each area default to requiring regression approval.

---

## Chapter 8 — Mapping Invariants

Principles that must never be violated. Each is backed by production evidence or is a protective governance rule. — mixed tags shown per line.

1. **Determinism** — [CURRENT]. Output must remain a pure function of (condition, plan). Evidence: baseline snapshot tests.
2. **Plan-override isolation** — [CURRENT]. A `planName ===` override affects only that plan. Evidence: overrides are gated by an exact plan-name check. Contributors must never place plan-specific logic in the global dictionary or a shared regex.
3. **No silent routing changes** — [GOVERNANCE]. Any change that alters an existing (condition, plan) outcome must be surfaced as a reviewed snapshot diff, never merged unseen.
4. **No unrelated collateral change** — [GOVERNANCE]. Integrating one condition must not shift the routing of an unrelated condition. Because dictionary-before-regex and section-order tie-breaks are global, a broad new regex can capture unintended inputs — this must be checked.
5. **Synonym consistency where intentionally defined** — [GOVERNANCE]. Where a synonym set is declared to route identically, that must hold. (The engine does not enforce this globally — see Chapter 6 Business Decision.)
6. **Firewall precedence preserved** — [CURRENT]. Non-diagnosis firewalls (tests, life stages, acute infections) must continue to intercept before disease routing, to preserve conservative fallback.
7. **Regression gate** — [GOVERNANCE]. No mapping change ships without a baseline snapshot comparison.

---

## Chapter 9 — Business Decisions Required

These are areas where the production engine does **not** establish a single deterministic policy. They are documented here as *unresolved*. The manual does not invent a rule for any of them. Each requires the relevant product/underwriting owner to decide, after which it can move into Chapters 2–6. — [BUSINESS DECISION]

1. **Manifestation routing (root disease vs affected organ).** The engine currently routes some complications to the root disease and others to the affected organ, with no single governing rule. There is no production evidence of one universal policy. **Decision needed:** define whether a manifestation routes organ-first, root-first, or by a wording-dependent framework — and apply the choice uniformly.
2. **Multi-family conditions.** Conditions belonging to two families are resolved only by regex section order. **Decision needed:** whether a named primary family is required, or whether "one deterministic route via ordering" is the accepted policy.
3. **Investigation vs diagnosis precedence.** Some investigations pre-empt a co-mentioned diagnosis (caught by the early test firewall); others defer to it (caught only by a late diagnostics section). **Decision needed:** a single precedence for "test + diagnosis" inputs.
4. **Finding polarity.** The engine does not systematically distinguish positive, negative, or incidental findings. **Decision needed:** define how each polarity should route (there is nothing to document today).
5. **Organ containment for systemic diseases.** The post-guard that keeps SLE/lupus/scleroderma/Sjögren on the autoimmune question covers only some organ targets. **Decision needed:** whether containment should be complete or the organ-first rule (item 1) should apply.
6. **Synonym-consistency enforcement.** Whether all synonyms of a condition must route identically (Chapter 6).
7. **Global vs plan-specific placement.** The rule for when a mapping belongs in the global dictionary versus a plan override is not consistently applied today. **Decision needed:** a placement rule that preserves plan-override isolation (Chapter 8, invariant 2).

Until decided, contributors must not resolve these ad hoc; they escalate to the owner and record the decision.

---

## Chapter 10 — Safe Change Process (adding a new condition)

The required lifecycle. — [PROCESS]

1. **Review.** Confirm the canonical name and synonym set. Confirm the target category exists in the controlled vocabulary.
2. **Collision analysis.** Enumerate every Chapter-3 stage that could match the condition or its synonyms. Confirm the earliest matching stage is the intended one. Check for accidental capture by firewalls or broad regexes.
3. **Placement decision.** Decide dictionary vs regex vs plan override, preserving plan-override isolation. If the mapping is plan-specific, it must not go in the global dictionary.
4. **Business-decision check.** If routing depends on any Chapter-9 area, stop and obtain the owner's decision before proceeding.
5. **Regression analysis.** Run the baseline snapshot suite. Inspect every diff — intended and unintended.
6. **Testing.** Add a test asserting the routing of the canonical term (and, where a synonym set is declared consistent, at least one synonym) on every plan.
7. **Approval.** Obtain regression sign-off (Chapter 7).
8. **Documentation.** Record the condition, its category, its synonyms, its per-plan routing, and any owner decision.

---

## Chapter 11 — Regression Philosophy

**What constitutes a regression** — [CURRENT / GOVERNANCE]
Any change to the output (`match_type` or `matched_question`) for an existing (condition, plan) pair, as measured against the baseline snapshots (`engine.baseline.test.ts`, `specificIllnessEngine.baseline.test.ts`). A previously deterministic PED becoming AI-dependent (or vice-versa) is also a regression signal, because the snapshot records `resolved: true/false`.

**Acceptable change** — [GOVERNANCE]
A diff that is intended, reviewed, tied to a documented decision (a fix, a new mapping, or a resolved Business Decision), and approved by the regression owner.

**Unacceptable change** — [GOVERNANCE]
Any unreviewed diff; any collateral change to an unrelated condition; any change that violates a Chapter-8 invariant (especially plan-override isolation or determinism).

**Required validation** — [PROCESS]
Baseline snapshot comparison on every mapping change; targeted tests for the new condition on every plan; explicit review of the full diff.

**Release readiness** — [PROCESS]
A change is releasable only when: the snapshot diff is fully explained, new tests pass, any Chapter-9 dependency has an owner decision on record, and regression sign-off is obtained.

---

## Chapter 12 — Glossary

- **categoryKey** — [CURRENT] An internal routing token (e.g. `diabetes`, `kidney`, `neoplasm`, `benign_growth`, `vascular_fallback`). A **declaration abstraction / implementation detail**, not a medical taxonomy. It is the key used to look up a plan's question in `categoryMap`.
- **Declaration category** — [CURRENT] The conceptual grouping a `categoryKey` represents, used to connect a condition to a plan question.
- **Plan override** — [CURRENT] A `planName ===` block or `overrides` flag that changes routing for one named insurer/plan, run before generic logic and isolated to that plan.
- **Canonical condition** — [GOVERNANCE] The single authoritative name chosen for a condition.
- **Synonym** — [GOVERNANCE] An alternate name/abbreviation/spelling of a canonical condition. The engine does not globally guarantee synonyms route identically.
- **Shield / firewall** — [CURRENT] A stage that intercepts a *class* of non-diagnoses (tests, acute infections, symptoms, life stages, procedures, lab findings) and routes them conservatively to Others, protecting against false disease matches.
- **Fallback** — [CURRENT] The terminal routing when no specific question covers a condition: the plan's Others/Any-other question plus applicable umbrella questions, or — when nothing matches at all — the AI handoff.
- **Manifestation / complication** — [CURRENT term; BUSINESS DECISION routing] A condition that is a downstream effect of another disease (e.g. an organ complication). How these route is not governed by a single rule (Chapter 9).
- **Umbrella question** — [CURRENT] A plan's broad hospitalisation/surgery/medication question, surfaced as a `secondary_recommendation` alongside the primary route.
- **Declaration route** — [CURRENT] The final `(match_type, matched_question)` result for a (condition, plan) pair.
- **P0 / P1 / FALLBACK / NON_AILMENT** — [CURRENT] Match types: exact-wording match; category match; Others/umbrella fallback; explicitly-not-an-ailment (life stages, normal health).

---

## Chapter 13 — Normative Hierarchy (authority for resolving conflicts)

This chapter defines the **authority order** a contributor or reviewer uses when two sources disagree about where a condition should route. — [GOVERNANCE]

It is distinct from two chapters it must not be confused with:
- **Chapter 3 (Decision Hierarchy)** is the engine's *runtime execution order* — which stage fires first at run time.
- **Chapter 4 (Evidence Hierarchy)** is how to *justify a new mapping* with evidence.
- **Chapter 13 (this chapter)** is the *authority order for settling a disagreement* between existing sources during review.

**Authority order (highest wins):**

1. **Plan declaration wording** — the insurer's actual question text. If a plan question names or clearly encompasses the condition, it is decisive for that plan. Wording is law.
2. **Existing approved production behavior** — the current, shipped, snapshot-approved outcome for that (condition, plan). This is a *stability* authority: do not silently regress what is approved and live. (It does not lower the runtime supremacy of plan overrides for their own plan; see the reconciliation note below.)
3. **Approved plan overrides** — an approved `planName ===` block or `overrides` flag, for the plan it targets.
4. **Approved dictionary behavior** — an approved `TOP_PED_DICTIONARY` category assignment.
5. **Approved regex behavior** — an approved disease-family regex section.
6. **Governance Manual** — this document, where the sources above are silent.
7. **Contributor judgment** — a reasoned choice by the integrating contributor, used only where 1–6 are silent, and always recorded.
8. **Clinical reasoning** — used only to *pick a category* where everything above is silent; never to override plan wording or approved behavior.

**Which source wins when two disagree:**
- Plan wording vs any lower source → **plan wording wins** (e.g. a regex would send a condition to category X, but the plan's question text explicitly lists it under Y → Y).
- Approved production behavior vs a proposed dictionary/regex/contributor change → **approved behavior wins** unless the change is an approved regression fix (Chapter 14) with sign-off.
- Dictionary vs regex → **dictionary wins**, mirroring runtime (Chapter 6): the dictionary stage executes before regex sections.
- Contributor judgment vs clinical reasoning → **contributor judgment wins**, but only within the space left open by sources 1–6.

**Reconciliation note (no governance change).** Ranking "existing approved production behavior" (2) above "approved plan overrides" (3) is a *no-regression* principle, not a claim that generic behavior out-routes an override at run time. At run time, plan overrides still execute first for their plan (Chapter 3) — an approved override *is* approved production behavior for that plan, so 2 and 3 do not actually conflict. The only case where they could genuinely disagree — a *generic* approved behavior contradicting a *plan-specific* override for the same condition on the same plan — is **not settled by the engine** and is listed under "Requires Business Approval" in the accompanying refinement log.

---

## Chapter 14 — Regression Taxonomy

This chapter refines Chapter 11 by naming regression *types*. It does not change the regression philosophy in Chapter 11 — a regression is still any unintended change to an approved outcome, measured against the baseline snapshots. — definitions are [CURRENT]; required review levels are [PROCESS].

| Type | Definition | Example | Required review level |
|---|---|---|---|
| **Behavioral regression** | The output (`match_type` or `matched_question`) changes for an existing (condition, plan) pair. | "Diabetic retinopathy" on a plan previously returned P1→Diabetes; now returns FALLBACK→Others. | Full regression sign-off (Chapter 7 regression owner). |
| **Structural regression** | A change to pipeline structure (a stage added, removed, or reordered) that could alter resolution even if today's snapshots happen to be unchanged. | Inserting a new regex section before dictionary routing. | Architecture review **and** regression owner. |
| **Coverage regression** | A condition that previously resolved deterministically now falls to AI (snapshot `resolved: true → false`), or vice versa. | Removing a token drops a condition to `null`. | Regression owner. |
| **Plan isolation regression** | A change intended for one plan alters another plan's routing. | A mapping meant for Activ Fit Preferred placed in the global dictionary shifts Optima Secure. | Mandatory block until resolved; regression owner + plan-override owner. |
| **Documentation regression** | The manual no longer matches the engine — a shipped behavior change without a doc update, or a doc edit that misstates behavior. | A new plan override added but Chapter 18 (Known Exceptions) not updated. | Documentation owner. |
| **Test regression** | Baseline snapshots or targeted tests are removed, weakened, or not updated to cover a change. | A snapshot deleted so a diff passes silently. | Regression owner; never self-approved. |

---

## Chapter 15 — Non-Goals

What the engine intentionally does not attempt. Each is consistent with the current implementation. — [CURRENT]

- **It does not diagnose disease.** It matches declared text to plan question wording; it performs no clinical inference. Evidence: routing is string/pattern matching against `categoryMap` and question text.
- **It does not medically classify diseases.** `categoryKey`s are routing tokens, not a clinical taxonomy (Chapter 12).
- **It does not estimate underwriting risk.** There is no scoring or risk output — only a declaration location (`match_type` + question).
- **It does not replace insurer wording.** It routes conditions *to* insurer questions; plan wording is the top authority (Chapters 4, 13).
- **It does not maximize disclosures.** It returns a single primary declaration (Chapter 2.5) and defers ambiguous inputs conservatively.
- **It does not minimize disclosures.** It does not suppress applicable declarations; it surfaces umbrella questions alongside fallbacks (Chapter 2.4).
- **It does not interpret medical reports.** Tests, scans, and reports are routed conservatively to Others and the advisor is asked for the underlying diagnosis. Evidence: the test/diagnostics firewalls.
- **It does not replace underwriting judgment.** Every output ends with an instruction to cross-check the declaration framework before the final disclosure call. Evidence: the advisory footer appended in `finalizeOutput`.

---

## Chapter 16 — Change Categories

Standard categories for future changes, with the review each expects. — [PROCESS]

| Change category | Description | Review expectation |
|---|---|---|
| **New synonym** | Add an alias to an existing canonical condition. | Confirm it routes identically to the canonical term where synonym consistency is declared; targeted regression on affected plans. |
| **New canonical condition** | A new condition with a category assignment. | Full Chapter 10 lifecycle. |
| **Dictionary update** | Add/edit a `TOP_PED_DICTIONARY` entry. | Dictionary owner; regression run — high blast radius because dictionary routing precedes regex (Chapter 6). |
| **Regex update** | Edit a disease-family section. | Regex owner; broadening check and collision scan (does it now capture unintended inputs?). |
| **Shield update** | Change a firewall's token or class. | Shield owner; confirm conservative fallback (Chapter 2.4) is preserved. |
| **Plan override** | Add/edit a `planName ===` block or `overrides` flag. | Plan-override owner; mandatory plan-isolation check (Chapter 8, invariant 2). |
| **New category** | Introduce a new `categoryKey`. | Category owner; it must map to a real plan question and be added to the label vocabulary (Chapter 12). |
| **Fallback update** | Change a fallback chain or terminal behavior. | Fallback owner; Business-Decision check (Chapter 9). |
| **Regression fix** | Intentionally correct an existing output. | Regression owner; the corrected diff must be tied to a documented decision. |
| **Documentation update** | Manual-only change, no code impact. | Documentation owner. |

---

## Chapter 17 — Reviewer Checklist

Run this on every mapping change. Answer each before approval. — [PROCESS]

- Does this alter an existing (condition, plan) output? → a baseline snapshot diff is required.
- Does it affect any other plan? → run the plan-isolation check.
- Does it broaden regex matching? → scan for unintended captures of unrelated inputs.
- Does it collide with an earlier pipeline stage? → confirm the intended stage wins (dictionary-before-regex; section order — Chapter 6).
- Does it change fallback or terminal behavior?
- Does it depend on a Chapter 9 Business Decision? → escalate to the owner; do not decide it in the change.
- Does it require regression testing? → any output change means yes.
- Is documentation updated (Chapter 18 exceptions, category vocabulary, synonym set)?
- Is the correct owner's sign-off (Chapter 7) recorded?

---

## Chapter 18 — Known Exceptions

Intentional exceptions already present in production. None are invented here; each exists in the engine and is documented with its reason. Most exist because a specific insurer's question wording places a condition differently from the generic engine — which is correct behavior under "wording is law." — [CURRENT]

**Plan-specific routing overrides (differ from the generic engine because of insurer wording):**
- **Activ Fit Preferred — sleep apnea / OSA → congenital-genetic question.** That plan's genetic question explicitly names Obstructive Sleep Apnea.
- **Activ Fit Preferred — DVT / pulmonary embolism / varicose veins → heart question.** That plan's heart question explicitly lists peripheral vascular disease.
- **Care Supreme — Crohn's / ulcerative colitis / IBD → Blood and/or Immunity question.** That plan's question explicitly names Crohn's and Ulcerative Colitis.
- **Optima Secure — autoimmune joint diseases (rheumatoid arthritis, ankylosing spondylitis, psoriatic/reactive arthritis) → musculoskeletal question.** Routed to the plan's arthritis/musculoskeletal question rather than a systemic-immunity question.

**Plan `overrides` flags:**
- **`requiresInsulinForDiabetes` (Care Supreme).** Gestational and Type-2 (non-insulin) diabetes route to Others; only Type-1 / insulin-dependent / severe diabetes reaches the diabetes question — because that plan's diabetes question is scoped to those severe forms.
- **`bypassBenignTumors`.** Benign growths route to Others on plans whose neoplasm question targets only malignant disease.
- **`excludePrediabetes`.** Prediabetes routes to Others on plans whose diabetes question requires a confirmed diagnosis.

**Global (non-plan) carve-outs:**
- **Benign CNS tumours.** Meningioma, acoustic neuroma, and craniopharyngioma are reassigned to `benign_growth` (not `neoplasm`) so they are not treated as malignant.
- **Ectopic-pregnancy exception.** Inputs containing "ectopic" bypass the natural-life-stage firewall, because ectopic pregnancy is a medical emergency, not a normal life stage.
- **HPV vs HIV-only questions.** HPV routes to Others (not the HIV question) when a plan's relevant question is restricted to HIV/AIDS.
- **Activ Fit Preferred — "ulcer" → tumour/ulcer question as an exact listing (P0).** The plan's question text lists ulcer explicitly.

Any new exception added in future must be recorded here as part of the change (Chapter 16, plan-override / dictionary categories), or it constitutes a documentation regression (Chapter 14).

---

## Final Review — Chapter Classifications

Each chapter is classified by its dominant content type. Mixed chapters note their split. No chapter blends classifications within a single statement — tags are applied per statement above.

| Chapter | Classification |
|---|---|
| 1. Purpose | **Current Production Behavior** |
| 2. Core Principles | **Current Production Behavior** |
| 3. Decision Hierarchy | **Current Production Behavior** (with one Governance note) |
| 4. Evidence Hierarchy | **Current Production Behavior** (items 1–4) + **Governance Rule** (items 5–6) |
| 5. Decision Framework | **Governance Rule** |
| 6. Tie-Breaking Rules | **Current Production Behavior** (implemented) + **Governance Rule** (implicit gaps) + **Business Decision** (synonym/competing-question) |
| 7. Ownership Model | **Governance Rule** |
| 8. Mapping Invariants | **Current Production Behavior** (1, 2, 6) + **Governance Rule** (3, 4, 5, 7) |
| 9. Business Decisions | **Business Decision** |
| 10. Safe Change Process | **Process Requirement** |
| 11. Regression Philosophy | **Current Production Behavior** (definition) + **Process Requirement** (validation/release) |
| 12. Glossary | **Current Production Behavior** (engine terms) + **Governance Rule** (contributor terms) |
| 13. Normative Hierarchy | **Governance Rule** |
| 14. Regression Taxonomy | **Current Production Behavior** (type definitions) + **Process Requirement** (review levels) |
| 15. Non-Goals | **Current Production Behavior** |
| 16. Change Categories | **Process Requirement** |
| 17. Reviewer Checklist | **Process Requirement** |
| 18. Known Exceptions | **Current Production Behavior** |

**Manual integrity statement.** Every [CURRENT] claim is tied to an observable execution order or implementation construct (pipeline stages, `questionForCategory`, `categoryMap`, `planName ===` overrides, `applyPostGuards`, baseline snapshot tests). Every area lacking a single deterministic production policy is classified **Business Decision Required** (Chapter 9) rather than documented as behavior or resolved by invention. Governance and process content is labeled as such and is not presented as engine behavior.
