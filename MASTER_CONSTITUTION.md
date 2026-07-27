# MASTER_CONSTITUTION
## Declaration Assistant — Mapping Engine

---

## Quick Start (read this before changing any mapping)

Most changes are small. You do **not** need to read all 17 parts first. Do this:

1. Read **Part VII — Mapping Rules** (how to evaluate the change).
2. Check **Part IX — Business Decisions** (is your change in an unresolved area?).
3. Follow **Part XI — Integration Workflow** (the lifecycle).
4. Run **Part XIII — Review Process** (the reviewer checklist).
5. Pass **Part XII — Regression Philosophy** (snapshot + tests before release).

**If unsure: never guess. Escalate the Business Decision (Part IX) to its owner.**

Two rules that override convenience: do not change existing production behavior without a reviewed regression diff, and do not resolve a Business Decision yourself.

---

## AI Usage (read this first if you are an AI assistant)

When AI is used to review or integrate mappings:

- Read this Constitution first and treat it as the **highest authority**.
- **Do not invent governance.** If a rule is not in here, it does not exist — surface the gap, don't fill it.
- **Do not resolve Business Decisions** (Part IX / Appendix G). Flag them for a human owner.
- **Preserve existing production behavior.** Any change to an existing (condition, plan) output is a regression event (Part XII) and must be surfaced, never silent.
- Respect the four classifications (see "How to read classifications" under Version Information). Never mark something [CURRENT] unless it is provable from the engine.

---

## Version Information

- **Version:** 1.0
- **Status:** Authoritative — approved baseline. This is the single highest-authority governance document for the mapping engine.
- **Last Updated:** 2026-07-18
- **Authority:** This document supersedes and consolidates all prior governance material — the Mapping Policy Charter, the Production Governance Manual, and any Validation Framework, Integration Playbook, Change Control, Mapping Governance, or Integration Rules notes. Those documents become optional historical reference. Where any of them conflicts with this Constitution, **this Constitution governs.**
- **Purpose:** To let any future contributor or AI assistant safely maintain and extend the engine using this one document alone — preserving current production behavior, keeping governance and process distinct from behavior, and never silently resolving decisions that belong to the business.

### How to read classifications

Every normative statement in this document carries exactly one tag. They are never merged.

- **[CURRENT]** — Current Production Behavior. Provable from the engine's execution order or implementation.
- **[GOVERNANCE]** — Governance Rule. A rule contributors must follow; not runtime behavior.
- **[BUSINESS]** — Business Decision Required. An area where production defines no single policy. Documented, never resolved here.
- **[PROCESS]** — Process Requirement. A required workflow step.

**Classification integrity rule** — [GOVERNANCE]: If a statement cannot be proven from the production engine, it must not be tagged [CURRENT]. It is instead [GOVERNANCE], [BUSINESS], or [PROCESS].

### Document map

- **Behavior reference** (do not change without a regression run): Parts I–VI, XV, XVI; Appendices A, B, C, H.
- **Governance & process** (changing these does not change the engine): Parts VII, VIII, X, XI, XII, XIII, XIV; Appendices D, E, F, G.
- **Unresolved:** Part IX and Appendix G.

This map is a navigation aid only. A Part may contain statements of more than one classification (for example, Part VI includes both [CURRENT] and [GOVERNANCE] content). The classification tag on an individual statement always takes precedence over this section-level grouping.

---

# Part I — Mission

**What the engine is** — [CURRENT]
The mapping engine (`src/engine.ts`, chiefly `classifyDeterministic`, supported by `TOP_PED_DICTIONARY` in `src/types.ts`) is a **deterministic router**. Given a declared pre-existing condition (PED) and a selected plan, it returns one outcome: a `match_type` (P0 / P1 / FALLBACK / NON_AILMENT / ESCALATE / INVALID) and the specific plan question under which the condition should be declared (or the plan's Others/Any-other catch-all). It is **wording-first and plan-aware**: it resolves a condition to a category, then resolves that category to *this plan's actual question text* via each plan's `categoryMap`.

**What the engine is not** — [CURRENT]
It is not a medical taxonomy, not a diagnosis tool, not a universal medical-routing authority, not a source of medical truth, not the sole decision-maker (unmatched inputs pass to an AI fallback outside the engine), and not a multi-declaration system. Its "disease family" groupings are matching conveniences, not clinical classifications. (Full non-goals: Part XVI.)

---

# Part II — Scope

**Responsibilities** — [CURRENT]
Accept a (condition, plan) pair; route it deterministically to a single declaration question or fallback; surface applicable umbrella (hospitalisation/surgery/medication) questions; return an advisory to cross-check the declaration framework before final disclosure.

**Limitations** — [CURRENT]
The engine routes by text and pattern matching against plan wording and category assignments. It performs no clinical inference, no risk scoring, and no report interpretation. When no deterministic stage matches, it returns `null` and defers to the AI layer.

**Intended use** — [GOVERNANCE]
The engine assists advisors in locating the correct declaration question. Its output is advisory and must be cross-checked by the human advisor; it does not replace underwriting judgment (Part XVI).

---

# Part III — Core Principles

Only principles provable from the implementation. Aspirational rules are excluded (see Part IX for what production leaves open).

1. **Wording-first routing** — [CURRENT]. Routing terminates at the question whose text covers the condition. Evidence: the exact plan-wording chunk-match stage returns `P0` when a condition equals a `/`-separated question fragment; `questionForCategory()` resolves each category to real plan question text. Exact wording outranks category inference.
2. **Plan-aware routing** — [CURRENT]. The same category resolves to different questions per plan because `categoryMap` is per-plan; plan overrides and `overrides` flags (`requiresInsulinForDiabetes`, `bypassBenignTumors`, `excludePrediabetes`) further alter routing for named plans. Evidence: `if (planName === "…")` blocks executed before generic logic.
3. **Deterministic routing** — [CURRENT]. Output is a pure function of (condition, plan). Evidence: baseline snapshot tests (`src/__tests__/engine.baseline.test.ts`, `specificIllnessEngine.baseline.test.ts`).
4. **Conservative fallback** — [CURRENT]. Symptoms, tests, life stages, acute/transient events, and non-diagnoses route to Others with umbrella questions surfaced. Evidence: life-stage firewall; test/acute-infection/ambiguous-symptom/lab shields; `finalizeOutput` attaching umbrella `secondary_recommendation` to FALLBACK outputs.
5. **Single-declaration routing** — [CURRENT]. Each condition resolves to exactly one `matched_question`. Evidence: no multi-question emission path exists.
6. **Unknown → AI handoff** — [CURRENT]. When no stage returns, `classifyDeterministic` returns `null` and the surrounding service defers to AI. Evidence: the terminal `return null`.

---

# Part IV — Runtime Architecture

**Execution order (the first stage that returns wins)** — [CURRENT]

1. **Natural life-stage firewall** → `NON_AILMENT` (pregnancy, menopause, puberty, lactation, "healthy/normal/nil/n-a", vaccination, routine checkup). Hard exception: inputs containing `ectopic` bypass it.
2. **Plan-specific overrides** — Activ Fit Preferred, Care Supreme, Optima Secure `planName ===` blocks.
3. **Fast-path safety shields (A–I)** — global test firewall; acute-infectious firewall; hypoglycaemia; DVT/PE; gangrene; hypotension; gestational/Type-2 diabetes; prediabetes; HPV/HIV-only coupling.
4. **Exact plan-wording chunk match** → `P0`.
5. **Dictionary exact-match routing** — `TOP_PED_DICTIONARY[cleanInput]` → `categoryKey`; pseudo-category keys short-circuit to fixed fallbacks (`vascular_fallback`, `acute_infection`, `ambiguous_symptom`, `lifestyle`, `natural_life_stage`, `acute_trauma`, `benign_growth`); otherwise `questionForCategory`.
6. **Disease-family regex sections** (~24 ordered blocks).
7. **Generic shields** — benign growths, allergy, gynecomastia, ambiguous symptoms, lab findings, diagnostics, isolated procedures/trauma.
8. **No match** → `null` → **AI fallback** (outside this engine).

**Post-processing (always after a route is chosen)** — [CURRENT]: `sanitizeOutput` → `applyPostGuards` (plan-aware corrections, e.g. Care Supreme diabetes Type-1 restriction; SLE/lupus organ-reroute) → `finalizeOutput` (resolves the question against the plan's real text, attaches umbrella recommendations, applies terminology and advisory-footer rules).

**AI fallback boundary** — [CURRENT]: The engine's responsibility ends at `return null`. The AI layer lives in the service, not this engine; it is invoked only when deterministic routing yields no match.

(Diagram: Appendix A.)

---

# Part V — Decision Hierarchy (runtime precedence and tie-breaking)

**Implemented precedence** — [CURRENT]
- **Plan override beats everything downstream.** `planName ===` blocks run before shields, dictionary, and regex.
- **Exact wording (P0) beats dictionary and regex.** The chunk-match stage precedes dictionary routing.
- **Dictionary beats regex.** Dictionary exact-match routing (stage 5) precedes the disease-family regex sections (stage 6). This is why a condition present as a dictionary key routes by its category even when a later regex would match it differently.
- **Among regex sections, earlier wins.** Sections are evaluated top-to-bottom; the first match returns. Section order is the de-facto tie-break for multi-family conditions.
- **Benign CNS override.** A specific check reassigns `categoryKey` to `benign_growth` for meningioma / acoustic neuroma / craniopharyngioma before category resolution.
- **Post-guards can override the chosen question** (`applyPostGuards`).

**Undocumented-but-real (behavior exists; no stated rule)** — [CURRENT behavior / [GOVERNANCE] gap]
- Two regex sections both matching is resolved only by source order; there is no named tie-break policy — contributors must read section order.
- A canonical term and a qualified variant (e.g. same words plus an adjective) can resolve at different stages; the engine does not guarantee a variant matches its canonical form.

**Not settled by production** — [BUSINESS]
- Whether all synonyms of one condition must route identically (Part IX, item 6).
- Precedence when a plan's `categoryMap` could resolve one condition to two different questions (Part IX, item 9).

(Decision tree: Appendix C.)

---

# Part VI — Evidence Hierarchy (how to justify a mapping)

Used to decide or defend where a condition routes. Higher evidence overrides lower. — [CURRENT] for 1–4; [GOVERNANCE] for 5–6.

1. **Insurer question wording** — [CURRENT]. Decisive where a plan's text names or encompasses the condition (encoded by P0 and `questionForCategory`).
2. **Plan-specific implementation** — [CURRENT]. An existing override or `overrides` flag for that plan.
3. **Existing production behavior** — [CURRENT]. The current baseline snapshot; changing it is a regression event (Part XII).
4. **Existing dictionary / synonym / category behavior** — [CURRENT]. How the canonical term and siblings already route.
5. **Clinical reasoning** — [GOVERNANCE]. Used only to *pick a category* where wording and precedent are silent — never to override plan wording. The engine encodes clinical reasoning only as far as its existing category assignments.
6. **Fallback** — [CURRENT]. If nothing above resolves: Others + umbrella, or AI handoff.

### Normative (authority) hierarchy for resolving conflicts — [GOVERNANCE]

Distinct from runtime order (Part V) and evidence-for-a-new-mapping (above). This is the authority order a reviewer uses when two sources disagree. Highest wins:

1. Plan declaration wording
2. Existing approved production behavior (a stability / no-regression authority)
3. Approved plan overrides
4. Approved dictionary behavior
5. Approved regex behavior
6. This Constitution
7. Contributor judgment (only where 1–6 are silent; always recorded)
8. Clinical reasoning (only to pick a category where all above are silent)

**Reconciliation note** — [GOVERNANCE]: Ranking "existing approved production behavior" above "approved plan overrides" is a no-regression principle, not a claim that generic behavior out-routes an override at run time. At run time, plan overrides still execute first for their plan (Part V) — an approved override *is* approved behavior for that plan, so they do not normally conflict. The one case where a *generic* approved behavior would genuinely contradict a *plan-specific* override for the same condition on the same plan is **not settled by production** and is recorded in Part IX (item 8).

(Evidence diagram: Appendix B.)

---

# Part VII — Mapping Rules (integration decision framework)

How a contributor evaluates a new condition. This framework deliberately does **not** prescribe one medical philosophy, because production implements none (Part IX). — [GOVERNANCE]

For each new condition, evaluate in order:

1. **Declaration wording.** Does any plan question already name or encompass it? If yes, that plan routes by wording; record it.
2. **Plan wording differences.** Expect and document that the condition may route to different questions on different plans. This is correct, not an inconsistency.
3. **Specificity.** Prefer the most specific covering question (consistent with `P0 > P1 > FALLBACK`).
4. **Overlap.** Enumerate every stage (override, dictionary, regex) that could match; the earliest in the Part IV order wins — verify it is the intended stage.
5. **Collision.** Check whether the condition's tokens also match an unrelated earlier regex or a firewall; decide whether the earlier capture is acceptable.
6. **Fallback.** Confirm terminal behavior when a plan has no covering question.

Where this cannot yield a single deterministic answer because production itself has competing behaviors (e.g. manifestation routing), stop and escalate to **Business Decision** (Part IX) — do not choose arbitrarily. — [GOVERNANCE]

---

# Part VIII — Mapping Invariants

Principles that must never be violated.

1. **Determinism** — [CURRENT]. Output must remain a pure function of (condition, plan). Evidence: baseline snapshots.
2. **Plan-override isolation** — [CURRENT]. A `planName ===` override affects only that plan. Evidence: overrides gated by exact plan-name check. Contributors must never place plan-specific logic in the global dictionary or a shared regex.
3. **No silent routing changes** — [GOVERNANCE]. Any change to an existing (condition, plan) outcome must be surfaced as a reviewed snapshot diff.
4. **No unrelated collateral change** — [GOVERNANCE]. Integrating one condition must not shift the routing of an unrelated one; because dictionary-before-regex and section-order are global, a broad new regex can capture unintended inputs — this must be checked.
5. **Synonym consistency where intentionally defined** — [GOVERNANCE]. Where a synonym set is declared to route identically, that must hold. (Not globally enforced by the engine — Part IX, item 6.)
6. **Firewall precedence preserved** — [CURRENT]. Non-diagnosis firewalls must continue to intercept before disease routing, preserving conservative fallback.
7. **Regression gate** — [GOVERNANCE]. No mapping change ships without a baseline snapshot comparison.

---

# Part IX — Business Decisions Required

Areas where production establishes no single deterministic policy. Documented as unresolved; **not** solved here. Each requires the product/underwriting owner to decide before it can move into Parts III–VII. — [BUSINESS]

1. **Manifestation routing (root disease vs affected organ).** Some complications route to the root disease, others to the affected organ; no single governing rule exists. Define one policy (organ-first, root-first, or a wording-dependent framework) and apply it uniformly.
2. **Multi-family conditions.** Resolved today only by regex section order. Decide whether a named primary family is required or whether "one deterministic route via ordering" is the accepted policy.
3. **Investigation vs diagnosis precedence.** Some investigations pre-empt a co-mentioned diagnosis (early test firewall); others defer to it (late diagnostics section). Define one precedence.
4. **Finding polarity.** No systematic handling of positive / negative / incidental findings. Define how each should route.
5. **Organ containment for systemic diseases.** The post-guard keeping SLE/lupus/scleroderma/Sjögren on the autoimmune question covers only some organ targets. Decide whether containment should be complete or the organ-first rule (item 1) applies.
6. **Synonym-consistency enforcement.** Whether all synonyms of a condition must route identically.
7. **Global vs plan-specific placement.** The rule for when a mapping belongs in the global dictionary vs a plan override is not consistently applied. Define a placement rule that preserves plan-override isolation (Part VIII, invariant 2).
8. **Generic approved behavior vs a plan-specific override, in genuine disagreement** for the same condition on the same plan (see Part VI reconciliation note). Which wins is not settled by production.
9. **Competing declaration questions within one plan.** Precedence when a plan's `categoryMap` could resolve one condition to two different questions is not settled by production (surfaced in Part V).

Until decided, contributors must not resolve these ad hoc; escalate to the owner and record the decision. (Register: Appendix G.)

---

# Part X — Governance (ownership and approvals)

Ownership assigns responsibility; the engine does not encode it, so every row is a [GOVERNANCE] rule to adopt. Role names are placeholders to be mapped to your team.

| Asset | Owner responsibility |
|---|---|
| Canonical conditions | Authoritative name; decision to add a new condition. |
| Synonyms | Synonym set per canonical condition; whether routing must stay consistent. |
| Regex sections | The ordered disease-family blocks; approves order-sensitive edits. |
| Shields / firewalls | The non-diagnosis token classes. |
| Category keys | The controlled `categoryKey` vocabulary and its meaning. |
| Plan overrides | Per-insurer `planName ===` blocks and `overrides` flags; ensures isolation. |
| Collision handling | Adjudicates new-condition collisions with existing stages. |
| Fallback logic | Sanctioned fallback chains and the Others/AI terminal behavior. |
| Regression approval | Signs off that a change's diff against baseline snapshots is intended. |

**Contributor expectations** — [GOVERNANCE]: Follow the integration workflow (Part XI), run the reviewer checklist (Part XIII), respect invariants (Part VIII), and escalate Business Decisions (Part IX) rather than resolving them. Until owners are named, changes in each area default to requiring regression approval.

---

# Part XI — Integration Workflow (adding a new condition)

The required lifecycle. — [PROCESS]

1. **Review.** Confirm canonical name and synonym set; confirm the target category exists in the controlled vocabulary.
2. **Collision analysis.** Enumerate every Part IV stage that could match the condition or synonyms; confirm the earliest matching stage is intended; check for accidental firewall/broad-regex capture.
3. **Placement.** Choose dictionary vs regex vs plan override, preserving plan-override isolation. Plan-specific mappings must not go in the global dictionary.
4. **Business-decision check.** If routing depends on any Part IX area, stop and obtain the owner's decision first.
5. **Regression analysis.** Run the baseline snapshot suite; inspect every diff (intended and unintended).
6. **Testing.** Add a test asserting the canonical term's routing (and, where a synonym set is declared consistent, at least one synonym) on every plan.
7. **Approval.** Obtain regression sign-off (Part X).
8. **Documentation.** Record the condition, category, synonyms, per-plan routing, and any owner decision; update Known Exceptions (Part XV) if applicable.

(Workflow: Appendix E.)

---

# Part XII — Regression Philosophy

**Definition** — [CURRENT / GOVERNANCE]: A regression is any change to the output (`match_type` or `matched_question`) for an existing (condition, plan) pair, measured against the baseline snapshots. A previously deterministic PED becoming AI-dependent (or vice-versa) is also a regression signal (snapshots record `resolved: true/false`).

**Regression types** — definitions [CURRENT]; review levels [PROCESS]:

| Type | Definition | Example | Review level |
|---|---|---|---|
| Behavioral | Output changes for an existing (condition, plan). | A condition's question flips P1→FALLBACK. | Full regression sign-off. |
| Structural | Pipeline structure changes (stage added/removed/reordered) that could alter resolution. | Inserting a regex before dictionary routing. | Architecture review + regression owner. |
| Coverage | A condition moves between deterministic and AI (`resolved` flips). | A removed token drops a condition to `null`. | Regression owner. |
| Plan isolation | A change intended for one plan alters another. | A global-dictionary entry meant for one plan shifts another. | Mandatory block; regression + plan-override owner. |
| Documentation | The Constitution no longer matches the engine. | An override added without updating Part XV. | Documentation owner. |
| Test | Snapshots/tests removed, weakened, or not updated. | A snapshot deleted to make a diff pass. | Regression owner; never self-approved. |

**Validation requirements** — [PROCESS]: Baseline snapshot comparison on every mapping change; targeted tests for the new condition on every plan; explicit review of the full diff.

**Release readiness** — [PROCESS]: Releasable only when the snapshot diff is fully explained, new tests pass, any Part IX dependency has an owner decision on record, and regression sign-off is obtained.

(Checklist: Appendix F.)

---

# Part XIII — Review Process

**Reviewer checklist** — [PROCESS] (answer each before approval):
- Does this alter an existing (condition, plan) output? → snapshot diff required.
- Does it affect any other plan? → plan-isolation check.
- Does it broaden regex matching? → scan for unintended captures.
- Does it collide with an earlier stage? → confirm the intended winner (dictionary-before-regex; section order — Part V).
- Does it change fallback / terminal behavior?
- Does it depend on a Part IX Business Decision? → escalate; do not decide it.
- Does it require regression testing? → any output change = yes.
- Is documentation updated (Part XV, category vocabulary, synonym set)?
- Is the correct owner's sign-off (Part X) recorded?

**Required validations** — [PROCESS]: baseline snapshot run; per-plan targeted tests; full diff review.
**Required approvals** — [PROCESS]: the owning role for the change category (Part XIV) plus regression sign-off.

(Checklist: Appendix D.)

---

# Part XIV — Change Categories

Standard change types and their review expectations. — [PROCESS]

| Category | Description | Review expectation |
|---|---|---|
| New synonym | Alias to an existing canonical condition. | Confirm identical routing to canonical where consistency is declared; targeted regression. |
| New canonical condition | New condition + category assignment. | Full Part XI lifecycle. |
| Dictionary update | Add/edit a `TOP_PED_DICTIONARY` entry. | Dictionary owner; regression — high blast radius (dictionary precedes regex). |
| Regex update | Edit a disease-family section. | Regex owner; broadening + collision check. |
| Shield update | Change a firewall token/class. | Shield owner; conservative fallback preserved. |
| New category | Introduce a `categoryKey`. | Category owner; must map to a real plan question; add to label vocabulary. |
| Plan override | Add/edit a `planName ===` block or `overrides` flag. | Plan-override owner; mandatory isolation check. |
| Fallback update | Change a fallback chain or terminal behavior. | Fallback owner; Business-Decision check. |
| Regression fix | Intentionally correct an existing output. | Regression owner; corrected diff tied to a documented decision. |
| Documentation update | Manual-only change, no code impact. | Documentation owner. |

---

# Part XV — Known Exceptions

Intentional exceptions already present in production. None invented; each exists in the engine, most because a specific insurer's wording places a condition differently from the generic engine (correct under "wording is law"). — [CURRENT]

**Plan-specific routing overrides:**
- **Activ Fit Preferred — sleep apnea / OSA → congenital-genetic question** (that plan's genetic question explicitly names OSA).
- **Activ Fit Preferred — DVT / PE / varicose veins → heart question** (that plan's heart question lists peripheral vascular disease).
- **Care Supreme — Crohn's / ulcerative colitis / IBD → Blood and/or Immunity question** (that question names them).
- **Optima Secure — autoimmune joint diseases (RA, ankylosing, psoriatic/reactive arthritis) → musculoskeletal question.**

**Plan `overrides` flags:**
- **`requiresInsulinForDiabetes` (Care Supreme)** — gestational/Type-2 non-insulin diabetes → Others; only Type-1/insulin/severe → diabetes question.
- **`bypassBenignTumors`** — benign growths → Others where the plan's neoplasm question targets only malignancy.
- **`excludePrediabetes`** — prediabetes → Others where the diabetes question requires a confirmed diagnosis.

**Global carve-outs:**
- **Benign CNS tumours** (meningioma, acoustic neuroma, craniopharyngioma) → `benign_growth`, not `neoplasm`.
- **Ectopic-pregnancy exception** — inputs containing "ectopic" bypass the life-stage firewall.
- **HPV vs HIV-only questions** — HPV → Others when the plan's question is HIV/AIDS-restricted.
- **Activ Fit Preferred — "ulcer" → tumour/ulcer question as an exact listing (P0).**

Any new exception must be recorded here as part of its change, or it constitutes a documentation regression (Part XII). (Register: Appendix H.)

---

# Part XVI — Non-Goals

What the engine intentionally does not attempt. Each is consistent with the implementation. — [CURRENT]

- **Does not diagnose disease** — text/pattern matching only; no clinical inference.
- **Does not provide medical advice** — every output ends with a cross-check advisory.
- **Does not medically classify diseases** — `categoryKey`s are routing tokens, not a taxonomy.
- **Does not estimate underwriting risk** — no scoring; output is a declaration location.
- **Does not replace insurer wording** — routes conditions *to* insurer questions; wording is the top authority.
- **Does not maximize disclosures** — single declaration; conservative fallback.
- **Does not minimize disclosures** — does not suppress; surfaces umbrella questions.
- **Does not interpret medical reports** — tests/reports → conservative fallback; asks for the diagnosis.
- **Does not replace underwriting judgment** — advisory footer on every output.

---

# Part XVII — Glossary

- **categoryKey** — [CURRENT] Internal routing token (e.g. `diabetes`, `kidney`, `neoplasm`, `benign_growth`, `vascular_fallback`). A declaration abstraction / implementation detail, not a medical taxonomy; the key used to look up a plan's question in `categoryMap`.
- **Declaration category** — [CURRENT] The conceptual grouping a `categoryKey` represents.
- **Declaration question** — [CURRENT] The actual plan question text a condition is declared under.
- **Canonical condition** — [GOVERNANCE] The single authoritative name for a condition.
- **Synonym** — [GOVERNANCE] An alternate name/abbreviation/spelling of a canonical condition. Not globally guaranteed to route identically.
- **Manifestation / complication** — [CURRENT term; [BUSINESS] routing] A downstream effect of another disease; routing not governed by a single rule (Part IX).
- **Override** — [CURRENT] A `planName ===` block or `overrides` flag that changes routing for one plan, run before generic logic and isolated to that plan.
- **Fallback** — [CURRENT] Terminal routing when no specific question covers a condition: Others/Any-other + umbrella, or the AI handoff.
- **Shield / firewall** — [CURRENT] A stage intercepting a class of non-diagnoses (tests, acute infections, symptoms, life stages, procedures, lab findings) and routing them conservatively. Used interchangeably in this document.
- **Routing** — [CURRENT] The act of resolving a condition to an outcome.
- **Mapping** — [CURRENT] The condition→question relationship the engine encodes.
- **Umbrella question** — [CURRENT] A plan's broad hospitalisation/surgery/medication question, surfaced as a `secondary_recommendation`.
- **Declaration route** — [CURRENT] The final `(match_type, matched_question)` result for a (condition, plan) pair.
- **P0 / P1 / FALLBACK / NON_AILMENT** — [CURRENT] Match types: exact-wording; category; Others/umbrella; explicitly-not-an-ailment.
- **ESCALATE** — [CURRENT] A `match_type` indicating the condition could not be resolved to a single declaration question and is flagged with competing/confused candidate questions for resolution in post-processing (`resolveConfusionAndEscalation` in `finalizeOutput`).
- **INVALID** — [CURRENT] A `match_type` marking an output that failed validation and is not a usable declaration route; preserved by `finalizeOutput` without further resolution.

---

# Appendices

## Appendix A — Runtime Execution Flow — [CURRENT]

```
Input (condition, plan)
  │
  ▼
1. Natural life-stage firewall ──► NON_AILMENT   (except "ectopic")
  │
  ▼
2. Plan-specific overrides (planName ===)  ──► route
  │
  ▼
3. Fast-path safety shields (A–I)  ──► FALLBACK / route
  │
  ▼
4. Exact plan-wording chunk match  ──► P0
  │
  ▼
5. Dictionary exact-match (TOP_PED_DICTIONARY) ──► categoryKey ──► questionForCategory ──► route
  │
  ▼
6. Disease-family regex sections (ordered) ──► route
  │
  ▼
7. Generic shields (benign, allergy, symptom, lab, diagnostics, procedure) ──► FALLBACK
  │
  ▼
8. No match ──► null ──► [AI fallback — outside engine]

Post-processing (after any route): sanitizeOutput → applyPostGuards → finalizeOutput
```

## Appendix B — Evidence Hierarchy (justifying a mapping) — [CURRENT 1–4 / GOVERNANCE 5–6]

```
Highest ┌─ 1. Insurer question wording
        │  2. Plan-specific implementation (override / flag)
        │  3. Existing production behavior (baseline snapshot)
        │  4. Existing dictionary / synonym / category behavior
        │  5. Clinical reasoning (category selection only)
Lowest  └─ 6. Fallback (Others + umbrella / AI)
```

## Appendix C — Decision Tree (which stage decides) — [CURRENT]

```
Is it a life stage / normal-health phrase (and not "ectopic")?  ─ yes ─► NON_AILMENT
  │ no
Is there a plan override for this planName + condition?          ─ yes ─► override route
  │ no
Does a safety shield class match (test/acute/DVT/…)?            ─ yes ─► shield fallback/route
  │ no
Does the condition equal a plan-question fragment?              ─ yes ─► P0
  │ no
Is it an exact TOP_PED_DICTIONARY key?                          ─ yes ─► category → plan question
  │ no
Does a disease-family regex match (first in order)?            ─ yes ─► category → plan question
  │ no
Does a generic shield match?                                   ─ yes ─► fallback
  │ no
                                                                └────► null → AI fallback
```

## Appendix D — Review Checklist — [PROCESS]
(Full text: Part XIII.) Alters existing output? · Affects another plan? · Broadens regex? · Introduces collision? · Changes fallback? · Depends on a Business Decision? · Requires regression tests? · Docs updated? · Owner sign-off recorded?

## Appendix E — Change Approval Workflow — [PROCESS]
Review → Collision analysis → Placement → Business-decision check → Regression analysis → Testing → Approval → Documentation. (Full text: Part XI.)

## Appendix F — Regression Checklist — [PROCESS]
Run baseline snapshots · Inspect every diff (intended + unintended) · Classify any regression by type (Part XII) · Confirm plan isolation · Confirm coverage (`resolved` flags) unchanged unless intended · Add/keep per-plan tests · Obtain regression sign-off.

## Appendix G — Business Decision Register — [BUSINESS]
1. Manifestation routing (root vs organ) · 2. Multi-family precedence · 3. Investigation vs diagnosis precedence · 4. Finding polarity · 5. Organ containment completeness · 6. Synonym-consistency enforcement · 7. Global vs plan-specific placement · 8. Generic behavior vs plan override in genuine disagreement · 9. Competing declaration questions within one plan. (Detail: Part IX. None resolved here.)

## Appendix H — Known Exceptions Register — [CURRENT]
AFP sleep apnea→genetic · AFP DVT/PE/varicose→heart · Care Supreme Crohn's/UC/IBD→blood · Optima autoimmune-joint→musculoskeletal · `requiresInsulinForDiabetes` · `bypassBenignTumors` · `excludePrediabetes` · benign CNS→benign_growth · ectopic firewall bypass · HPV→Others on HIV-only questions · AFP ulcer→tumour/ulcer P0. (Detail + reasons: Part XV.)

---

## Consolidation & Validation Statement

This Constitution consolidates the prior Mapping Policy Charter and Production Governance Manual (and any Validation Framework, Integration Playbook, Change Control, Mapping Governance, or Integration Rules notes) into one authority. Validation performed before finalizing:

- **No duplicated guidance:** overlapping rules were merged and cross-referenced (e.g. runtime precedence lives only in Parts IV–V; justification only in Part VI; regression only in Part XII).
- **No contradictory guidance:** the one genuine tension found during consolidation — generic approved behavior vs a plan-specific override in true disagreement — is preserved as **[BUSINESS]** (Part IX item 8), not resolved by assumption.
- **No conflicting terminology:** terms are used per Part XVII throughout; `shield`/`firewall` are declared interchangeable; `categoryKey` vs `declaration category` vs `declaration question` are kept distinct.
- **No missing cross-references:** each Part points to the appendix or Part that elaborates it.
- **No undocumented production behavior marked Current:** every [CURRENT] statement is tied to an execution stage or implementation construct; anything unprovable is [GOVERNANCE], [BUSINESS], or [PROCESS].
- **Nothing changed:** no mapping, no engine behavior, no business decision, and no governance intent was altered. Aspirational rules from the prior charter that the engine does not implement are represented here only as Business Decisions (Part IX), never as Current behavior.

---

## Change Impact Template

Every future change to this Constitution must record its impact using this block. Tick all that apply. A change that ticks "Runtime behavior change" or "Business decision" cannot merge without the corresponding owner sign-off (Part X) and, where applicable, a regression diff (Part XII).

```
Change Impact:

[ ] Documentation only        — wording/clarity; no governance or behavior change
[ ] Governance only           — a rule contributors follow; no engine change
[ ] Business decision         — resolves or opens a Part IX item; requires owner approval
[ ] Runtime behavior change    — alters an existing (condition, plan) output; regression review required
[ ] Regression expected        — a snapshot diff is anticipated and must be reviewed & explained

Owner sign-off (if Governance / Business / Runtime): __________
Regression diff reviewed (if Runtime / Regression):  __________
```

**Classification** — [PROCESS].

---

## Version History

```
v1.0  (2026-07-18)
- Initial consolidated Constitution. Supersedes the Mapping Policy Charter and the
  Production Governance Manual (and any Validation Framework, Integration Playbook,
  Change Control, Mapping Governance, or Integration Rules notes).
- 17 Parts + Appendices A–H. Four-way classification ([CURRENT] / [GOVERNANCE] /
  [BUSINESS] / [PROCESS]) established.
- Added: Quick Start, AI Usage, Change Impact Template, Version History.
- No mapping, engine behavior, or Business Decision changed.

v1.1  (unreleased)
- ...

v1.2  (unreleased)
- ...
```

Each future entry must summarize what changed and cite its Change Impact classification. A version that changes runtime behavior must reference the regression sign-off.

**Classification** — [PROCESS].
