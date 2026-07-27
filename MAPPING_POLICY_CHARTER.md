# Declaration Mapping Policy Charter

**Purpose:** Capture, in explicit rules, the mapping principles that the current production engine (`src/engine.ts` + `TOP_PED_DICTIONARY` in `src/types.ts`) *appears* to follow, so that future condition integrations stay consistent instead of depending on undocumented, case-by-case judgment.

**Status:** Descriptive + prescriptive. Part A and B describe what the engine does today (inferred, not code changes). Part C is the policy list to adopt as the reference for all future mappings.

**Scope:** Routing only — how a declared condition is mapped to a plan declaration question. This charter does not assert medical correctness; it governs *internal consistency* and *determinism*.

---

## Part A — Inferred mapping principles (what the engine currently appears to follow)

These are reverse-engineered from the pipeline order and the handlers. They are implicit today; none is written down as a rule.

### A1. Fixed precedence pipeline
Routing is decided by the first stage that returns, in this order:

1. **Natural life-stage firewall** → `NON_AILMENT` (pregnancy, menopause, "healthy", "nil", vaccination, etc.).
2. **Plan-specific overrides** — per-insurer intercepts (e.g. AFP sleep-apnea → genetic; Care Supreme Crohn's → blood; Optima autoimmune-joint → musculoskeletal).
3. **Fast-path safety shields** — tests, acute infections, hypoglycaemia, DVT/PE, gangrene, hypotension, gestational/Type-2 diabetes, prediabetes, HPV.
4. **Exact plan-wording chunk match** → `P0` (the condition string is literally one of the `/`-separated fragments of a plan question).
5. **Dictionary exact-match routing** → a `categoryKey` → the plan's question for that category.
6. **Disease-family regex sections** (ordered, ~24 blocks).
7. **Generic shields** — benign growths, allergy, ambiguous symptoms, lab findings, diagnostics, procedures/trauma.
8. **No match** → `null` → AI fallback.

**Inferred principle:** *Safety/false-positive protection outranks specificity; exact wording outranks category inference; category inference outranks broad regex; everything outranks the AI fallback.*

### A2. "Question wording is law"
A condition is routed to the question whose wording covers it. The `categoryKey → question` map (`config.categoryMap`) is per-plan, so the same category can resolve to different questions (or none) across insurers. When a plan has no covering question, the condition goes to the Others/anyOther catch-all.

### A3. Specificity preference
Where multiple questions could apply, the most specific one is intended to win (e.g. a dedicated organ question over a general one; a named condition inside a question's text as `P0` over a category match as `P1`).

### A4. Conservative default (underwriting-first)
When a condition is a symptom, test, life stage, acute/transient event, or otherwise not a definitive chronic diagnosis, the engine routes to Others and defers to the umbrella (hospitalisation/surgery/medication) questions rather than forcing a disease category. "When unsure, disclose under Others + check umbrella."

### A5. Single-declaration default
Each condition resolves to exactly one question. There is no path today that emits two independent declarations; "no double declaration" is the de-facto rule.

### A6. Category as an abstraction layer
Conditions are mapped to a stable set of `categoryKey`s (heart, kidney, neuro, eye, diabetes, hypertension, autoimmune, neoplasm, benign_growth, respiratory, digestive, liver, blood, endocrine, skin, reproductive, eyeEnt, psychiatric, musculoskeletal, hiv, lipid, covid, hypotension, genetic, plus firewall pseudo-categories like acute_infection, ambiguous_symptom, lifestyle, natural_life_stage, vascular_fallback, eosinophilia_finding, gynecomastia, acute_trauma, sarcoidosis). The plan-level `categoryMap` then resolves each key to a question.

### A7. Firewalls intercept *classes* of non-diagnoses
Tests/investigations, acute infections, ambiguous symptoms, life stages, isolated procedures/trauma, allergies, and lab findings are each caught as a class and sent to Others, regardless of plan — protecting against false disease matches.

### A8. Plan overrides encode insurer question structure
Where an insurer's question text groups conditions unusually (e.g. Care Supreme putting Crohn's under a Blood/Immunity question), a plan-specific override front-runs the generic logic. This is the sanctioned mechanism for insurer-specific wording.

### A9. Complications *intend* organ-first-then-root (but see Part B)
The most recently authored handlers (hypertension complications; the diabetic-complication dictionary fallback) express the rule: *a manifestation routes to the organ question if the plan has one, otherwise to the root-disease question, never to generic Others.* This is the engine's stated direction of travel — it is simply not applied uniformly yet.

---

## Part B — Judgment gaps (where no single principle governs today)

These are the decisions that currently have **no deterministic rule**, so each new condition is resolved by whoever adds it, however they choose. These are the highest-risk areas for future inconsistency.

### B1. Manifestation routing: root-disease vs organ
No uniform rule. Diabetes complications route to the root (Diabetes); hypertension complications route organ-first; `sle nephritis` routes to root (autoimmune) while `lupus nephritis` routes to the organ (kidney); portal hypertension routes to the organ (liver); hepatic encephalopathy is unhandled. A new complication's routing depends entirely on which handler its author happens to touch.

### B2. Canonical term vs synonyms
No rule that all synonyms of one condition must resolve identically. Dictionary exact-match keys and regex sections frequently encode different answers for the canonical spelling vs a variant (`diabetic retinopathy` vs `severe diabetic retinopathy`; `sle nephritis` vs `lupus nephritis`; `psoriatic arthritis joint` vs `psoriatic arthritis`; `portal hypertension` vs `portal hypertension with varices`).

### B3. Global dictionary entry vs plan-specific override
No rule for which mechanism to use. Sleep apnea was added *both* as an AFP override *and* as a global dictionary entry (`→ genetic`), so it overrides other plans too. Future authors have no guidance on when a mapping should be global vs plan-scoped.

### B4. New `categoryKey` vs reuse
No rule for when a condition deserves its own category (e.g. `sarcoidosis` has a self-named key that only works because no plan defines it) vs being folded into an existing one. This risks orphan categories and hidden reachability dependencies.

### B5. Cross-category fallback chains
Fallback chains exist ad hoc and undocumented: reproductive → kidney; liver → digestive → findQuestion; eye → eyeEnt; autoimmune → musculoskeletal; benign_growth → neoplasm. There is no master list of which fallbacks are sanctioned, so a new condition's "second choice" question is guesswork.

### B6. Status / context modifiers
No rule. `history of / chronic / controlled / resolved / previous / status post` are effectively ignored (route by underlying condition), but `treatment / awaiting treatment / procedure / post-operative` collide with the procedure/trauma firewall and mis-route. There is no defined policy for stripping or interpreting modifiers before routing.

### B7. Investigation vs diagnosis precedence
No rule. Some investigations (MRI, scan, ultrasound) pre-empt any co-mentioned diagnosis via the early firewall; others (biopsy, endoscopy, ECG, colonoscopy) defer to the diagnosis because they live in a late section. Whether "test + diagnosis" resolves to the test or the disease is accidental.

### B8. Finding polarity (positive / negative / incidental)
No rule. The engine does not systematically distinguish a positive finding (implying disease) from a negative or incidental one. A future author adding "biopsy positive" vs "biopsy negative" has no policy to follow.

### B9. Multi-family conditions
No documented precedence for conditions belonging to two families (e.g. psoriatic arthritis = autoimmune + joint; diabetic nephropathy = diabetes + kidney; rheumatoid lung = autoimmune + respiratory). Section ordering silently decides, differently per condition.

### B10. Organ-containment for systemic diseases
The autoimmune post-guard pulls SLE/lupus/scleroderma/Sjögren back to the autoimmune question for *some* organ targets (eye, ENT, lung, stomach) but not others (kidney, heart, skin, liver, joint). Which organ manifestations are "contained" to the root disease is an incomplete, undocumented list.

---

## Part C — Explicit mapping policies to document (the charter)

Adopt these as the written reference for every future condition integration. Each is phrased as a deterministic rule so that two different authors reach the same routing for the same condition.

### C1. Precedence is fixed and canonical
Every condition is resolved by the pipeline in A1's order. No new handler may be inserted at a position that changes the resolution of an already-mapped condition without an explicit regression check.

### C2. One canonical term per condition; all synonyms resolve identically
Each condition has a single canonical name and a declared synonym set. **Every synonym, abbreviation, spelling variant, and qualified form must resolve to the same category and the same plan question as the canonical term.** A synonym that routes differently is a defect by definition, not a design choice.

### C3. Single manifestation-routing policy (pick one and apply everywhere)
Adopt the organ-first-with-root-fallback rule already expressed by the hypertension handler, for **all** complication families:

> A diagnosed complication/manifestation routes to the plan question whose wording covers the affected organ/system. If the plan has no such question, it routes to the root-disease question. It never routes to generic Others when either exists.

This rule must apply identically to diabetic, hypertensive, autoimmune, hepatic, and all future complications — regardless of spelling variant or which parent disease it derives from.

### C4. Category taxonomy is governed
The set of `categoryKey`s is a controlled vocabulary. A new key may be introduced only if (a) at least one plan maps it to a real question, and (b) it is added to the category-label table. Self-named categories that rely on "no plan maps this" are prohibited going forward.

### C5. Sanctioned fallback chains are explicit
Every allowed cross-category fallback (e.g. reproductive→kidney, liver→digestive, eye→eyeEnt, autoimmune→musculoskeletal, benign_growth→neoplasm) must be listed in a single documented table. A condition may only use a fallback that appears in that table. Unlisted fallbacks are not permitted.

### C6. Global vs plan-specific mapping decision rule
A mapping is **plan-specific** (an override) when it exists only because one insurer's question wording groups the condition unusually. It is **global** (dictionary/regex) only when it is true for every plan. A mapping added to satisfy one plan's wording must not be placed in the global dictionary.

### C7. Firewalls define non-diagnosis classes, exhaustively and in one place
Each firewall class (test/investigation, acute infection, ambiguous symptom, life stage, isolated procedure/trauma, allergy, lab finding) has one authoritative token list and one interception point. A token belongs to exactly one firewall. Investigations must be intercepted at a single, consistent precedence relative to diagnoses (see C8).

### C8. Investigation-vs-diagnosis precedence is uniform
Define one rule for "investigation + diagnosis" inputs and apply it to all investigations: either the named diagnosis always wins, or the investigation always wins. The same input pattern must not resolve to the test for one investigation and to the disease for another.

### C9. Status/context modifiers are normalized before routing
Declare a fixed modifier set (`history of, previous, old, chronic, acute, controlled, resolved, treated, follow-up, awaiting treatment, status post, post-operative`) and a single policy for it: modifiers are stripped/ignored and routing follows the underlying diagnosis. No modifier may independently trigger a disease or firewall category. If a modifier ever *should* change routing (e.g. "resolved" downgrades severity), that must be a documented exception, not an accident of token overlap.

### C10. Finding polarity policy
Define how positive, negative, and incidental findings are handled (e.g. a bare investigation with no diagnosis → Others; an investigation qualified by a named diagnosis → the diagnosis). Apply the same polarity rule to every investigation term.

### C11. Multi-family conditions declare an explicit primary family
Any condition belonging to two families records a documented primary family and the deterministic tie-break (e.g. "psoriatic arthritis → musculoskeletal primary; autoimmune secondary"). Section ordering must not be the de-facto arbiter.

### C12. Systemic-disease organ containment is a complete list
For each systemic disease that should be routed to its root question regardless of organ manifestation (e.g. SLE/lupus), the set of contained organ targets must be complete and documented — not a partial enumeration. Either all organ manifestations of the disease contain to the root, or the organ-first rule (C3) applies; no per-organ ad hoc gaps.

### C13. Single-declaration default; multiple declarations are an explicit, documented exception
One condition → one question is the default. If multiple independent declarations are ever required, the triggering rule (each question's wording independently and explicitly covers the condition, and underwriting requires separate disclosure) must be written down and applied uniformly.

### C14. Conservative default is explicit
Any condition that matches no diagnosis, category, or firewall resolves to Others + applicable umbrella questions — never to a guessed disease category. "Unknown → Others + umbrella" is the sanctioned terminal rule.

### C15. New-condition integration checklist (deterministic procedure)
Every new condition integration must, in order:

1. Assign the canonical name and enumerate all synonyms (C2).
2. Assign exactly one primary `categoryKey` from the controlled vocabulary (C4); declare a secondary family only if multi-family (C11).
3. If it is a complication/manifestation, apply C3 (organ-first-then-root).
4. Decide global vs plan-specific per C6.
5. Confirm the fallback (if any) is on the sanctioned list (C5).
6. Verify every synonym resolves identically across all plans (C2) — this is the consistency gate.
7. Add a regression test asserting the routing for the canonical term and at least one synonym on every plan.

### C16. Documentation requirement
No new `categoryKey`, override, fallback chain, or firewall token may be added without a corresponding entry in this charter's controlled-vocabulary and fallback tables. Undocumented mappings are treated as defects.

---

## How this closes the judgment gaps

| Judgment gap (Part B) | Closed by policy |
|---|---|
| B1 Manifestation root vs organ | C3 |
| B2 Canonical vs synonyms | C2, C15.6 |
| B3 Global vs plan-specific | C6 |
| B4 New category vs reuse | C4 |
| B5 Fallback chains | C5 |
| B6 Status modifiers | C9 |
| B7 Investigation precedence | C7, C8 |
| B8 Finding polarity | C10 |
| B9 Multi-family conditions | C11 |
| B10 Organ containment | C12 |

Once C1–C16 are adopted as the written reference, a new condition's routing is fully determined by the checklist (C15) rather than by which handler an author happens to edit — which is the root cause of every inconsistency surfaced in the two prior audits.
