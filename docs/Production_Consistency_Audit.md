# Production Consistency Audit
### `docs/Categorymap Regex.md` and `docs/Master_PED_Dictionary.md` vs. the live Declaration Assistant engine

**Audit date:** 2026-07-21
**Baseline (source of truth):** `src/types.ts` (`TOP_PED_DICTIONARY`, `getPlanConfig()`), `src/engine.ts` (`classifyDeterministic` and all routing/guard logic), `regex_blocks.json`, and the live `/api/plan-configs` response (confirmed byte-identical to `types.ts` for all 6 plans — see Methodology).
**Method:** every category/term/plan in both documents was diffed programmatically against the parsed production source (not eyeballed), and the two highest-impact findings were additionally confirmed by running real lookups through the live app.

---

## Methodology note

`docs/Master_PED_Dictionary.md` groups terms by category. Production has **two** different "dictionaries," and only one of them matches that shape:

- `SCRIPT_DICTIONARY` (`src/constants/scriptDictionary.ts`) — a flat list of ~500 autocomplete strings with **no category assignment at all**.
- `TOP_PED_DICTIONARY` (`src/types.ts`, 949 entries, 33 categories) — the actual `term → categoryKey` map the deterministic engine looks up first, before any regex ever runs.

The doc's structure (terms nested under category headers) only makes sense as a comparison against `TOP_PED_DICTIONARY`, so that is what Part 1 below is diffed against. `SCRIPT_DICTIONARY` is out of scope for this audit (it has no category to be right or wrong about).

I confirmed the live plan-config API (`/api/plan-configs`) returns data identical to the hardcoded `getPlanConfig()` defaults in `types.ts` for all 6 plans (spot-checked Optima Secure's full `categoryMap`, `overrides`, `anyOther`, and question tag counts field-by-field) — so `types.ts` is a valid stand-in for "current production" for Part 3, without needing to dump the full DB payload for every plan.

---

## PART 1 — Master PED Dictionary Audit

### 1.1 Scale mismatch

| | Categories | Terms |
|---|---|---|
| `Master_PED_Dictionary.md` | 30 | 476 |
| `TOP_PED_DICTIONARY` (production) | 33 | 949 |

The doc represents **50% of production's term count** and is missing **3 whole categories outright**: `genetic` (36 entries), `hiv` (14 entries), `sarcoidosis` (3 entries) appear nowhere in the document — not mis-filed, simply absent as headings.

Per-category coverage is extremely uneven — some categories are close to complete, others are token gestures:

| Category | Doc terms | Prod terms | Undocumented (in prod, not in doc) |
|---|---|---|---|
| Natural Life Stage | 2 | 42 | 40 |
| Neoplasm | 11 | 88 | 86 |
| Endocrine | 13 | 47 | 39 |
| Ambiguous Symptom | 14 | 45 | 31 |
| Benign Growth | 3 | 29 | 28 |
| Acute Infection | 18 | 41 | 30 |
| Digestive | 31 | 61 | 37 |
| Heart / Cardiovascular | 24 | 64 | 49 |
| Blood | 13 | 35 | 26 |
| Autoimmune | 9 | 25 | 20 |

(Full per-category counts for all 30 documented categories were computed; the table above shows the ten widest gaps. Every one of the 30 documented categories is missing production entries — none is complete.)

**Verdict:** documentation issue. The doc's own header states: *"This document merges the current production dictionary with recommended additive entries... Improvements are additive only."* Read literally, this promises full production coverage plus proposed extras. It does not deliver the first half of that promise — for most categories it is a curated subset, not a merge. This is a completeness failure, not a correctness failure (see 1.3).

### 1.2 Miscategorized entries (doc places a term in category X; production has that exact term filed under category Y)

These are the most actionable findings — real term-level disagreements, not just gaps:

| Term | Doc says | Production says | Assessment |
|---|---|---|---|
| `sciatica` | Neurological | `musculoskeletal` | **Production is correct.** Sciatica is nerve-root compression of spinal origin, same clinical logic as the `cervical radiculopathy` case fixed earlier this session. Doc should be corrected. |
| `obstructive sleep apnea`, `osa` | Psychiatric | `genetic` | **Production is wrong — see 1.4, this is the audit's flagship finding.** |
| `psoriasis` | Skin | `autoimmune` | Production is intentional and self-consistent — `engine.ts` section 19 explicitly special-cases psoriasis to prefer the autoimmune question over skin ("is a skin condition with autoimmune classification"). Doc should be corrected, ideally noting the dual nature. |
| `lipoma` | Skin | `benign_growth` | Production is more clinically precise (a lipoma is a fatty tumour, not a dermatological disease) and routes through the same neoplasm-question bridge as other growth terms. Doc should be corrected. |
| `fibroadenoma`, `breast lump`, `breast cyst` | Reproductive | `benign_growth` | Same reasoning — these are growth/cyst declarations, and several plans (e.g. Activ Fit Preferred's own neoplasm question literally says "Cancer, tumor, lump, cyst, ulcer") have a dedicated, more specific tumour question. Doc should be corrected. |
| `vocal cord nodule` | ENT | `benign_growth` | Defensible either way clinically; production's explicit categorization is intentional (dedicated categoryKey with its own routing branch), not accidental. Low-severity — doc should be corrected for consistency but this one is genuinely close. |

### 1.3 What the doc gets right

For the ~30–40% of terms it does carry per category, cross-checking found **no spelling errors, no case-key duplicates beyond the two harmless ones below, and no category mismatches other than the six listed in 1.2.** The doc is accurate where it has coverage — its problem is completeness, not correctness.

### 1.4 Flagship finding: Obstructive Sleep Apnea routes to the wrong question on 5 of 6 plans (production bug, not a doc bug)

`TOP_PED_DICTIONARY` maps `"obstructive sleep apnea"`, `"sleep apnea"`, and `"osa"` to categoryKey `genetic` — globally, for every plan. This traces to a real but over-generalized origin: `engine.ts` has a plan-specific override (section 0.4, "Activ Fit Preferred") that correctly routes OSA to the genetic/congenital question **for that one plan**, because Activ Fit Preferred's actual question text is *"Congenital / Birth defect / Genetic Disease / Physical deformity / Disability / Polio / **Obstructive sleep apnea** / Peripheral vascular disease"* — it explicitly names OSA. The global dictionary entry appears to have generalized that one plan's correct behavior into a rule for all plans.

For the other five plans, `categoryMap.genetic` points somewhere clinically unrelated:

| Plan | Where OSA actually routes (via `genetic`) | Where it should route (via `psychiatric`, which names "sleep") |
|---|---|---|
| Optima Secure | *"Any Blood disorder (example Anaemia, Haemophilia, Thalassaemia) or any genetic disorder?"* | *"Nervous, Psychiatric or Mental or **Sleep disorder**?"* |
| Care Supreme | *"Congenital Disorder?"* | *"...Psychiatric disorders (including...mental illness)"* |
| Activ One Max | `categoryMap.genetic` equals `anyOther` verbatim — routes straight to the generic catch-all | *"...Mental-Psychiatric illness...Depression...Dementia..."* |
| Aspire | *"...genetic / hereditary disorders or HIV / AIDS?"* | *"...mental/ psychiatric disorders?"* |
| Reassure 2.0 | *"...genetic / hereditary disorders or HIV / AIDS?"* | *"...mental/ psychiatric disorders?"* |

**Live-verified:** searched "Obstructive sleep apnea" against Optima Secure in the running app. Result: matched to *"Any Blood disorder (example Anaemia, Haemophilia, Thalassaemia) or any genetic disorder?"* with the engine's own explanation text: *"'Obstructive sleep apnea' falls under the Congenital / Genetic Disorder category and is a category-level match to this plan's declaration question above."* Optima Secure's actual Nervous/Psychiatric/Sleep question was never reached.

This is a **Specificity Override violation** in the audit's own sense of the term: the plan's own more specific, on-point wording ("Sleep disorder") loses to a globally-applied categoryKey that only makes sense for one specific plan's wording.

Neither document currently in `/docs` mentions this at all (the Master PED Dictionary doc puts OSA under "Psychiatric" — which is coincidentally the *correct* answer for 5 of 6 plans, even though the doc doesn't know why, and is simply wrong for Activ Fit Preferred).

### 1.5 Dead/unreachable dictionary entries (production issue)

`engine.ts`'s O(1) dictionary lookup always strips punctuation from user input before comparing it against `TOP_PED_DICTIONARY` keys (`cleanInput = text.replace(/[^\w\s]/g, "").trim()`), but the dictionary keys themselves are never punctuation-stripped. Any key containing an apostrophe, period, or hyphen that isn't also duplicated in a punctuation-free form is therefore **permanently unreachable** — no user input can ever produce a `cleanInputLower` that equals it verbatim.

Programmatic scan of all 949 keys found **16 such entries**; 14 have no punctuation-free duplicate rescuing them:

```
covid.19, h. pylori, c - section, e-cigarette, cushing's syndrome, addison's disease,
pott's disease, parkinson's disease, alzheimer's disease, bell's palsy,
no pre-existing disease, c-section delivery, pre-diabetic condition,
alpha-1 antitrypsin deficiency
```
(`graves' disease` and `pre-eclampsia` *are* rescued — a punctuation-free duplicate of each already exists, so those two are harmless redundancy rather than dead weight.)

For most of the 14, this is low-severity: the term still gets caught later by a regex block covering the same condition (e.g. `parkinson's disease` still matches the `severe_neurological` regex, which explicitly includes `parkinson's`), so the advisor still gets a correct answer via a different code path — just not the O(1) dictionary path the entry was written for.

**One entry is a real functional bug: `"h. pylori"`.** There is no regex block anywhere in `engine.ts` covering "pylori" in any form (checked `digestive_ulcer_hernia` and every other block). A bare `"pylori"` dictionary entry exists separately, but dictionary lookup requires an exact whole-string match, so it does not rescue two-word input. An advisor typing "H. pylori" or "H pylori" gets **no deterministic match at all** — `classifyDeterministic` returns `null` and the system falls through to the Gemini AI fallback, which is exactly the failure mode `TOP_PED_DICTIONARY` exists to prevent.

Neither document discusses dictionary-key reachability; this is purely a code-level finding, included because the audit explicitly asked for "dictionary entries that are never used."

### 1.6 Duplicates

Zero duplicate keys exist in `TOP_PED_DICTIONARY` (programmatically confirmed — 949 raw key/value pairs parsed from source, 949 unique keys). Two near-duplicates exist that differ only in case or punctuation (`"Acne"`/`acne`, `"graves' disease"`/`"graves disease"`) — both map to the same category in both forms, so they are redundant but harmless.

---

## PART 2 — Category Map & Regex Audit

### 2.1 What `Categorymap Regex.md` gets right

For **25 of its 27 documented categories**, the doc is a **byte-for-byte, term-for-term verbatim copy** of the corresponding block in `regex_blocks.json` — same terms, same order, same spelling, zero drift. (Diffed programmatically; zero differences printed for Diabetes, Prediabetes, Heart/Cardiovascular, Hypertension, Severe Neurological, Mild/Peripheral Neurological, Psychiatric, all five Tuberculosis sub-blocks, Respiratory, Kidney/Renal, Reproductive, Digestive, Liver, Endocrine, Blood Disorders, both Autoimmune sub-blocks, Sarcoidosis, Musculoskeletal, Skin, Eye, and ENT.) Where this document has coverage, treat it as reliable.

### 2.2 Genetic Disorders — the one real content gap

The doc's "20. Genetic Disorders" (5 terms: `down syndrome`, `genetic disorder`, `chromosomal abnormality`, `cystic fibrosis`, `turner syndrome`) is a hand-written stub. Production actually implements this as **four separate regex blocks that `engine.ts` OR's together into one compound check** (section 16b):

- `genetic_and_metabolic` (18 terms — doc has 5 of these)
- `genetic_and_congenital_birth_defects` (14 terms — 0 in doc)
- `congenital_heart_spina_bifida` (11 terms — 0 in doc)
- `metabolic_enzymes_deficiencies` (18 terms — 0 in doc)

61 production terms total; the doc represents 5 of them (8%). **Documentation issue** — this category needs a full rewrite, not a patch, and should probably be presented as the four separate production blocks it actually is, since `engine.ts` treats them as one compound condition but with different downstream special-case logic (e.g. the metabolic-enzyme sub-branch has its own G6PD/RPI explanation text).

### 2.3 Whole production categories absent from the document

**21 of production's 48 `ailment_classification_regexes` blocks (44%) have zero representation** in `Categorymap Regex.md`:

```
acute_infections, malignant_cancers, std_hpv_syphilis, std_filtering,
lipids_cholesterol, hypoglycaemia, hypoglycaemia_with_diabetes,
dvt_pulmonary_embolism, gangrene, gangrene_qualifiers, hypotension_low_bp,
genetic_and_congenital_birth_defects, congenital_heart_spina_bifida,
metabolic_enzymes_deficiencies, fibrodysplasia_ossificans,
generic_benign_growths_cysts, generic_allergy_hypersensitivity, gynecomastia,
ambiguous_symptoms, laboratory_test_findings, isolated_procedures_acute_trauma
```

This is not a minor omission — `malignant_cancers` (cancer/carcinoma/leukemia/lymphoma) is arguably the single highest-stakes category in a medical PED tool, and it is entirely absent from the document. So are the DVT/gangrene/hypotension "shield" categories that exist specifically to *prevent* dangerous miscategorization.

Beyond `ailment_classification_regexes`, the document also does not mention **any** of `regex_blocks.json`'s other four top-level blocks at all: `detect_supporting_flags_regexes`, `natural_life_stages_regexes`, `plan_overrides_guards`, `test_and_imaging_firewalls`. The last of these (`plan_overrides_guards`) directly corresponds to the `rheumatoid_organ_confusion` and `sjogren_sle_organ_confusion` post-guards implemented in `engine.ts`'s `applyPostGuards()` — real, active production logic with no documentation footprint anywhere.

**Verdict:** documentation issue, severity high (completeness), not a production defect — production's actual regex coverage is fine; the document just doesn't describe most of it.

### 2.4 Collision: `cystic fibrosis` is claimed by two categories, and the doc doesn't disclose it

`cystic fibrosis` appears verbatim in both `respiratory_pulmonary` and `genetic_and_metabolic`. In `engine.ts` execution order, the respiratory check (section 10) runs before the genetic check (section 16b), so `respiratory_pulmonary` always wins — the genetic copy of the term is **dead code**, permanently shadowed. This isn't necessarily wrong (cystic fibrosis's primary clinical manifestation is pulmonary, and every plan checked has a respiratory question), but it is a real collision the audit was asked to find, and it exists silently in production with no comment explaining the duplication is intentional.

### 2.5 Regex that can never execute (production code-quality finding, not a doc issue)

`engine.ts` contains **duplicate guard blocks with byte-identical regex**, evaluated once early (section "0.5 Fast-Path Safety Firewalls") and then again later in the same function under a different section number. Because the earlier copy already tests the same `text` variable and returns on a match, the later copy can only ever be reached when its own condition is false — i.e., never fires differently from the first check. Confirmed duplicate pairs:

| Early copy | Late, unreachable copy |
|---|---|
| `0.5.A` test/scan firewall | `0.6` |
| `0.5.B` acute infectious firewall | section `1.` |
| `0.5.C` hypoglycaemia shield | `4.5` |
| `0.5.D` DVT/PE shield | `5.6` |
| `0.5.E` gangrene shield | `5.7` |

This is harmless (no incorrect output results — the dead copy is a no-op) but is a direct answer to the audit's explicit "regex that can never execute" question, so it's included. Low priority; a cleanup, not a fix.

### 2.6 Dictionary entries bypassing intended regex — this is the radiculopathy pattern, and it recurs

The dictionary lookup (`engine.ts` section 0.7) runs **before every regex section**, including the "mild neurological" block that was the root cause of the `cervical radiculopathy` mis-routing already fixed this session. That fix added a guard specifically for spine-qualified radiculopathy. It does not cover the structurally identical case for **`sciatica`**:

- `TOP_PED_DICTIONARY["sciatica"]` → `musculoskeletal` (correct, and reachable — an exact "Sciatica" search resolves correctly via the O(1) dictionary path, confirmed by inspection).
- But `mild_neurological` (`regex_blocks.json`, matches on the bare word `sciatica`) still runs **before** `musculoskeletal_arthritis_fracture`, and `musculoskeletal_arthritis_fracture` does not itself list `sciatica` anywhere.
- Any phrasing that isn't an exact dictionary hit — "sciatica pain," "chronic sciatica," "left leg sciatica" — will fall through the dictionary stage (no exact match) and be caught by the earlier `mild_neurological` regex instead, routing to the Nervous/Psychiatric/Sleep question instead of the Musculoskeletal one. This is the same bug class as the radiculopathy issue, on the same term family, not yet reported or fixed.

---

## PART 3 — Plan Validation

**Headline finding: neither document contains any plan-level content at all.** No declaration questions, no `categoryMap`, no plan-specific overrides, no umbrella-question logic, no plan names, appear anywhere in `Categorymap Regex.md` or `Master_PED_Dictionary.md`. Both documents are purely global (dictionary/regex), so there is nothing in them to validate plan-by-plan — Part 3 of this audit is necessarily a review of production alone, cross-referenced against the audit's requested violation types.

### 3.1 P0/P1/P2 tiers

Production uses `P0` (exact wording match), `P1` (category match), `P2` (reserved), `FALLBACK`, `NON_AILMENT`, `ESCALATE`, `INVALID` — there is no `P3` anywhere in the codebase; the prompt's "P0/P1/P2/P3" framing doesn't match implementation, worth flagging only so nobody goes looking for a P3. Initially this looked like `P2` might be dead (never assigned anywhere in `engine.ts`), but checking `server.ts` confirmed it's intentionally reserved for the Gemini AI fallback path only (the AI prompt explicitly instructs the model to return `P2` for AI-resolved category matches; `matchTier.ts` documents this explicitly: *"Level 2 — Category Match: ...whether resolved by the deterministic dictionary (P1) or by the AI successfully finding a question (P2)"*). **Not a bug** — correctly scoped, just easy to misread as dead code without checking the AI path too.

### 3.2 Specificity Override — implemented correctly in most places, violated in one (already covered in 1.4/2.6)

`engine.ts` has several well-built, explicit specificity-override mechanisms that prefer a plan's own specific wording over a generic category default:
- Hypertension-complication routing (`HYPERTENSION_COMPLICATION_ORGANS`) — checks whether the plan has a *dedicated* eye/kidney/neuro/heart question before defaulting a complication like "diabetic retinopathy" to the generic hypertension question.
- `SECONDARY_MANIFESTATION_ROOT_CATEGORY` — same pattern for diabetes complications.
- Mild-neurological routing checks whether the plan's psychiatric question wording actually contains "nervous" before deciding where to send peripheral-nerve conditions.
- Psoriasis explicitly prefers the autoimmune question over skin when available.

The Obstructive Sleep Apnea bug (1.4) is the one clear counter-example: a global dictionary entry overrides what should be plan-wording-driven routing, in the opposite direction from all the examples above (it *ignores* a plan's specific "Sleep disorder" wording in favor of a generic genetic-disorder bucket). Worth fixing using the same pattern already used for mild-neurological routing (check whether the plan's psychiatric question wording actually names sleep/OSA before routing there; fall back to genetic only when it doesn't) — this is a recommendation, not a code change made here.

### 3.3 No Double Declaration

Structurally guaranteed by the engine's design: `classifyDeterministic` is a strict waterfall of early returns — the function returns on the first section that matches and never continues past that point in the same call, so a given lookup can never resolve to two different questions simultaneously. No violation found, and none is architecturally possible under the current control flow.

### 3.4 Plan configs — spot findings outside the two documents' scope

- **"Care Ultimate"** is referenced in a live QA Announcement in the Announcement Manager ("Care Ultimate is now available for recommendation...") but does not exist anywhere in `src/` — it has no `PlanConfig`, no `categoryMap`, and doesn't appear in the plan dropdown. It is a business-process plan not yet wired into the Declaration Assistant engine. Outside this audit's two documents, but worth flagging since "current plan mappings" was in scope for Part 3.
- All 6 wired plans (`Optima Secure`, `Care Supreme`, `Activ One Max`, `Activ Fit Preferred`, `Aspire`, `Reassure 2.0`) have every category key their own engine-routing logic can produce mapped to *something* (confirmed by cross-referencing every `categoryKey` used in `engine.ts` against each plan's `categoryMap` keys) — no plan silently falls through to the AI fallback for a whole category due to a missing key.

---

## PART 4 — Regression Analysis

Per the standing instruction to prefer documentation fixes over production changes unless production is demonstrably wrong, findings split cleanly:

### Documentation should be corrected (no production risk either way)
- `sciatica`, `psoriasis`, `lipoma`, `fibroadenoma`, `breast lump`, `breast cyst`, `vocal cord nodule` — re-file to match production's actual (defensible) categorization. **Confidence: high** for the first five, **medium** for `vocal cord nodule` (genuinely a closer call).
- Rewrite "Genetic Disorders" in `Categorymap Regex.md` to reflect all four production blocks (61 terms), not 5.
- Add the 21 missing regex categories and the 3 missing dictionary categories (`genetic`, `hiv`, `sarcoidosis`) to bring both documents to actual completeness, or explicitly re-scope the documents' stated purpose if full coverage isn't the goal.
- Add the 4 non-`ailment_classification_regexes` blocks (`detect_supporting_flags_regexes`, `natural_life_stages_regexes`, `plan_overrides_guards`, `test_and_imaging_firewalls`) to `Categorymap Regex.md`, since it otherwise silently implies `ailment_classification_regexes` is the whole of `regex_blocks.json`.

### Production should be fixed (documentation is not the driver here — these are real behavioral bugs)
1. **Obstructive Sleep Apnea global-dictionary mis-route (1.4).** Reason: `TOP_PED_DICTIONARY`'s `genetic` categoryKey for OSA/sleep-apnea terms was generalized from one plan's specific override to a global default, which is wrong for 5 of 6 plans and demonstrably contradicts each of those plans' own more specific psychiatric/sleep wording. **Collision analysis:** the existing Activ Fit Preferred plan-specific override (`engine.ts` section 0.4) already achieves the correct AFP outcome independently of the dictionary entry, so narrowing/removing the global dictionary mapping would not change AFP's behavior — it's redundant there, not load-bearing. The five other plans would newly route through the `psychiatric_mental` regex (section 9), which already correctly catches "obstructive sleep apnea|sleep apnea|osa\b|sleep disorder." **Regression risk:** low; the change is narrowing a currently-wrong global default, and the correct-for-one-plan behavior is independently preserved by existing plan-specific logic. **Confidence: high.**
2. **`sciatica` non-exact-match mis-route (2.6).** Same root cause and same class of fix as the already-shipped `cervical radiculopathy` guard. **Collision analysis:** adding `sciatica` to the spine-qualified-radiculopathy-style guard (or adding `sciatica` to the `musculoskeletal_arthritis_fracture` regex block directly) would only change behavior for non-exact-dictionary phrasings of sciatica, which currently mis-route; the exact-match case ("Sciatica" alone) already works correctly via the dictionary and would be unaffected either way. **Regression risk:** low. **Confidence: high.**
3. **`"h. pylori"` dead-end (1.5).** Reason: no regex fallback exists, so this specific phrasing produces zero deterministic match today. **Collision analysis:** adding a `pylori` term to the `digestive_ulcer_hernia` regex (or a punctuation-tolerant lookup) would only affect currently-unmatched input. **Regression risk:** low. **Confidence: medium** — worth confirming "H. pylori" is actually a term advisors search for before spending effort on it (real-world query frequency wasn't available for this audit).

### Should NOT be fixed — production is intentionally correct as-is
- Psoriasis → autoimmune preference, lipoma/fibroadenoma/breast-lump/breast-cyst/vocal-cord-nodule → benign_growth routing: all backed by explicit, reasoned engine logic (either dedicated special-case code or a deliberate categoryKey with its own routing branch). Do not change production to match the two documents here — correct the documents instead.
- `cystic fibrosis` collision (2.4): current behavior (routes to respiratory) is clinically reasonable and every checked plan has a respiratory question; not worth adding cross-category disambiguation logic for a case where both possible answers are defensible and one already consistently wins.
- Duplicate/dead guard blocks (2.5): harmless, zero behavioral impact, pure code hygiene — a cleanup candidate, not a fix, and not urgent.
- `P2` tier "unused in engine.ts" (3.1): false alarm on first pass — it's correctly reserved for the AI path. No change needed.

---

## PART 5 — Document Quality

- **Internal contradiction in `Master_PED_Dictionary.md`:** the header promises a "merge" of production plus "recommended additive entries," but nothing in the document distinguishes which bullet under any category is existing-production vs. proposed-new. This makes the stated methodology unverifiable line-by-line — a reader (or this audit) cannot tell, without cross-referencing production directly, whether e.g. "type 2 diabets" (a misspelling variant, category 1) is a real production entry or a proposed addition. Recommend either tagging additions distinctly (e.g. a trailing marker) or splitting into two sections per category.
- **Missing sections:** `Master_PED_Dictionary.md` has no Genetic, HIV, or Sarcoidosis sections at all (1.1). `Categorymap Regex.md` has no sections for 21 production regex categories (2.3) and omits all 4 non-ailment regex blocks entirely.
- **Categories present in one document but not clearly cross-referenced in the other:** `Categorymap Regex.md`'s "Genetic Disorders" (category 20) and `Master_PED_Dictionary.md`'s implicit genetic content don't fully agree with each other either — worth reconciling both against production together rather than independently, since production's actual genetic/congenital logic spans what would need to be 4 dictionary-side categories and 4 regex-side categories to be structurally faithful. Categories that exist only in `Master_PED_Dictionary.md` with no counterpart section in `Categorymap Regex.md` at all: COVID, Allergy, Neoplasm, Benign Growth, Vascular Fallback, Acute Trauma, Eosinophilia Finding, Gynecomastia, Natural Life Stage, Lifestyle.
- **Outdated/misleading implied ordering:** `Categorymap Regex.md`'s categories are numbered 1-27 in a way that could be read as execution order. It is not — actual `engine.ts` execution order interleaves plan-specific overrides, seven lettered fast-path shields, an exact-wording chunk check, and the O(1) dictionary lookup **before** any of the numbered regex categories run at all, and even the regex categories are numbered differently in `engine.ts` (0.4, 0.5A-I, 1, 1.5, 2, 3, 4, 4.5, 5-5.7, 8a, 8b, 9-24) than in the doc's clean 1-27. If the numbering is meant only as a table-of-contents index (not execution order), that should be stated explicitly to avoid a reader inferring the wrong thing.
- **No broken links or naming inconsistencies found** — category names used consistently within each document.
- **No duplicate information within either document** found (each term appears once per document, aside from the two harmless production-side near-duplicates noted in 1.6, which are a production characteristic, not a doc-authoring issue).

---

## PART 6 — Final Verdict

**1. Documentation issues to fix**
- Both documents: bring category coverage up to production's actual scope (30→33 categories for the dictionary doc, 27→48 for the regex doc, plus the 4 non-ailment regex blocks) or explicitly narrow the documents' stated scope/purpose so partial coverage isn't misread as complete.
- `Master_PED_Dictionary.md`: re-file `sciatica`, `psoriasis`, `lipoma`, `fibroadenoma`, `breast lump`, `breast cyst`, `vocal cord nodule` to match production; add the missing Genetic/HIV/Sarcoidosis categories; distinguish "existing production" bullets from "recommended additive" bullets per the doc's own stated methodology.
- `Categorymap Regex.md`: rewrite "Genetic Disorders" (61 real terms vs. 5 documented); add the 21 missing ailment categories and the 4 missing non-ailment regex blocks; either drop the 1-27 numbering or state explicitly it isn't execution order.

**2. Production issues to fix**
- Obstructive Sleep Apnea / sleep apnea / OSA global dictionary mis-route (high confidence, high impact — 5 of 6 plans affected).
- `sciatica` non-exact-phrasing mis-route, same class as the already-fixed radiculopathy bug (high confidence).
- `"h. pylori"` dead-end with no regex fallback (medium confidence, worth a quick check against real search-history frequency before prioritizing).

**3. Issues that should NOT be fixed — production is intentionally correct**
- Psoriasis/lipoma/fibroadenoma/breast-lump/breast-cyst/vocal-cord-nodule categorization (documents should follow production, not the reverse).
- `cystic fibrosis` respiratory-vs-genetic collision (current winner is clinically reasonable).
- Duplicate dead guard blocks in `engine.ts` (harmless, cosmetic-only cleanup).
- `P2` match-tier "unused" concern (false alarm — correctly reserved for the AI fallback path).

**4. Recommended documentation updates** — see item 1 above; treat as a rewrite of both documents' coverage, not a patch, given the scale of the gaps (roughly half of production's dictionary and regex content is simply not represented).

**5. Recommended production updates** — the three items in section 2, in that priority order (OSA highest impact, sciatica same-day-effort given the radiculopathy precedent already exists, H. pylori worth a frequency check first).

**6. Overall confidence:** **High** for every finding above a stated "medium," since each was verified against parsed production source (not read-through impression) and the two highest-impact findings were additionally confirmed against the live running application. The main residual uncertainty is real-world query frequency for the lower-priority items (e.g., how often advisors actually type "H. pylori" verbatim) — that data wasn't available to this audit and would sharpen prioritization within Part 4's "should fix" list.
