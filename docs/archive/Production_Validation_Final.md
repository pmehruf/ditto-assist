# Declaration Assistant Mapping Engine — Final Production Validation

Source of truth used: `src/engine.ts`, `src/types.ts` (`TOP_PED_DICTIONARY`, `getPlanConfig()`), `MASTER_CONSTITUTION.md`, `MAPPING_POLICY_CHARTER.md` (superseded, historical reference only per Constitution line 39). `regex_blocks.json` was confirmed not imported anywhere in `src/` and is excluded as non-production. No code, mappings, or documentation were changed. No improvements are suggested below — validation only, per the request.

---

## ENGINE HEALTH

**PASS WITH WARNINGS**

The engine is deterministic, structurally single-declaration, and plan-isolated where overrides exist. No evidence of non-determinism, crash risk, or double-declaration was found. The warnings are: a small, bounded set of confirmed routing bugs with narrow blast radius (listed below), two newly-identified dead/degraded code paths, and several items the Constitution itself reserves as unresolved Business Decisions rather than defects.

---

## Confirmed Production Bugs

1. **6 dictionary entries are curated but structurally unreachable, falling to the AI fallback**: `covid.19`, `h. pylori`, `c - section`, `e-cigarette`, `no pre-existing disease`, `c-section delivery`. Evidence: `types.ts` (their key spellings) vs. full pipeline trace in `engine.ts` (no regex or firewall anywhere matches any of the six). Confidence: High.
2. **`"pregnancy induced hypertension"`** is dictionary-categorized `hypertension` (`types.ts`) but is intercepted by the life-stage firewall (`engine.ts:137`, matches `pregnan(cy|t)`) at stage 0 — the very first stage — and returns `NON_AILMENT`, never reaching the hypertension question. Confidence: High.
3. **`"hypoglycemia episode"` / `"reactive hypoglycemia"`** are dictionary-categorized `diabetes` but are intercepted by the 0.5C hypoglycaemia shield (`engine.ts:495-505`) and returned as `FALLBACK`, because neither phrase itself contains a diabetes-qualifying word. Confidence: High.
4. **`"positive hiv test"`, `"std profile"`, `"lipid profile high"`** are dictionary-categorized `hiv`/`hiv`/`lipid` but are intercepted by the generic 0.5A test-firewall (`engine.ts:478-487`, matches `test`/`profile`) before the dictionary stage is reached, and are returned as a generic test-result `FALLBACK` instead of routing to the disease question. Confidence: High.
5. **`"sciatica"`** resolves correctly only as an exact dictionary match; any qualified phrasing ("sciatica pain," "left/chronic/lumbar sciatica") is shadowed by the mild/peripheral-neurological regex (`engine.ts:911-938`) before the musculoskeletal regex (`engine.ts:1098`, which does not itself list "sciatica") is ever reached. Same execution-order defect class as the already-fixed cervical-radiculopathy issue. Confidence: High.
6. **`"lipoma"`** (non-exact phrasings only, e.g. "lipoma on back") is shadowed by the skin regex (`engine.ts:1104`, lists "lipoma") ahead of the generic benign-growth regex (`engine.ts:1127`). The exact term alone still resolves correctly via the dictionary (`benign_growth`). Confidence: High.
7. **Sarcoidosis specificity inversion — Aspire and Reassure 2.0 only.** The three dictionary keys `"sarcoidosis"`, `"sarcoidosis systemic"`, `"sarcoidosis lungs and lymph"` (`types.ts`) carry categoryKey `sarcoidosis`. Aspire and Reassure 2.0 each define a `sarcoidosis` categoryMap key, but its value is their own generic catch-all sentence (`types.ts:1414`, `:1460` — identical text to each plan's `anyOther` field), not a real question. Because the dictionary stage (0.7) runs before regex and a truthy `targetQ` short-circuits, this sends all three exact phrasings straight to `FALLBACK`/Others for these two plans. Care Supreme, Activ One Max, and Activ Fit Preferred define **no** `sarcoidosis` key at all — for them the dictionary stage's `targetQ` is empty, so it silently falls through to regex section 17.5 (`engine.ts:1084-1095`), which correctly routes to each plan's real `respiratory` question (or `autoimmune`, for Activ One Max, whose autoimmune question literally names "Sarcoidosis" — `types.ts:1280`). Net effect: the two plans that bothered to define a `sarcoidosis` key get a **worse** outcome (generic Others) than the three plans that defined no key at all and are handled by the smarter regex fallback. Optima Secure also defines a `sarcoidosis` key, but with real lung-disease wording (`types.ts:1165`), so it is unaffected. Confidence: High.
8. **Two previously unidentified 100%-dead duplicate code blocks**, beyond the five already reported in an earlier pass this session:
   - Section `"6.5"` (hypotension) is a byte-identical, unconditional duplicate of shield 0.5F (`engine.ts:528-535`); 0.5F always intercepts first.
   - Section `"5.0"` (gestational/Type-2 diabetes) is a byte-identical duplicate of shield 0.5G (`engine.ts:537-545`), dead specifically for the plan(s) with `overrides.requiresInsulinForDiabetes` set (currently Care Supreme).
   Confidence: High.

---

## Business Decisions

Per `MASTER_CONSTITUTION.md` Part IX, these are documented as unresolved and are reported, not resolved, here.

1. **OSA / sleep apnea global dictionary routing.** `TOP_PED_DICTIONARY` routes `"sleep apnea"`/`"obstructive sleep apnea"`/`"osa"` to `genetic` for all plans (`types.ts:344-346`); this is correct only for Activ Fit Preferred, whose plan override (`engine.ts:418-430`) and genetic-question wording (`types.ts:1325`) explicitly name OSA. For the other 5 plans, this contradicts each plan's own psychiatric-question wording (which independently and correctly names sleep/mental illness — the regex at `engine.ts:941` would catch it if the dictionary didn't intercept first). Constitution Part IX item 7 ("global vs. plan-specific placement... not consistently applied") reserves this exact scenario as unresolved; `MAPPING_POLICY_CHARTER.md` (superseded) independently admits the same gap by name.
2. **`"bell's palsy"`** resolves to `psychiatric` or `neuro` depending on whether a plan's psychiatric question wording contains "nervous" (`engine.ts:922-927`) — for Optima Secure this yields `psychiatric`, contradicting the dictionary's unconditional `neuro` assignment (`types.ts`). Falls under Part IX item 6 (synonym-consistency enforcement).
3. **`"cystic fibrosis"`** is listed in both the respiratory regex (`engine.ts:968`, wins — runs first) and the genetic/congenital regex (`engine.ts:1015`, dead for this term). Not a dictionary key. Falls under Part IX item 2 (multi-family conditions, resolved only by section order); current respiratory-wins behavior is not flagged as wrong, only as a Part IX item.

---

## Documentation Issues

1. `Master_PED_Dictionary.md` covers 476 of 949 production dictionary entries (50%) and omits the `genetic`, `hiv`, and `sarcoidosis` categories entirely, despite its own header claiming a full production merge plus additions.
2. `Master_PED_Dictionary.md` mis-files `psoriasis`, `lipoma`, `fibroadenoma`, `breast lump`, `breast cyst`, `vocal cord nodule`, and `sciatica` relative to their actual, deliberate `TOP_PED_DICTIONARY` category assignments.
3. `Categorymap Regex.md` omits 21 of 48 production `ailment_classification_regexes` categories (including `malignant_cancers`), which is within its own apparent scope. (Its earlier-reported omission of the four non-ailment blocks — firewalls/guards/life-stage/support-flags — was re-assessed and found **not** to be a real gap: those blocks resolve outside the category system entirely and fall outside what a "category map" document would reasonably cover.)
4. `MASTER_CONSTITUTION.md` Appendix H ("Known Exceptions") documents only the Activ Fit Preferred OSA override; it does not mention that the same global dictionary key also determines behavior for the other 5 plans.
5. `MAPPING_POLICY_CHARTER.md`'s stated rationale for the `sarcoidosis` categoryKey ("only works because no plan defines it" — item B4) is now factually stale: three of six plans (Optima Secure, Aspire, Reassure 2.0) currently define an explicit `sarcoidosis` categoryMap key.

---

## Needs Business Review

1. Whether the `hypotension` categoryKey should ever be given a real question by any plan, or whether always-`FALLBACK` is the accepted permanent behavior (see Category Mapping Issues below).
2. Whether Aspire's and Reassure 2.0's generic `sarcoidosis` categoryMap key should exist at all, given it currently produces a worse outcome than having no key (see Confirmed Bugs #7) — reported as a finding, not a recommended removal.
3. Whether `cystic fibrosis`'s respiratory-vs-genetic dual listing should remain resolved by section order.

---

## Dead Dictionary Entries

`covid.19`, `h. pylori`, `c - section`, `e-cigarette`, `no pre-existing disease`, `c-section delivery` — all fall to the AI fallback; none has any deterministic path. (See Confirmed Production Bugs #1 for evidence per entry.)

---

## Dead Regex

- Section `"0.6"` (duplicate of shield 0.5A, test/scan firewall) — 100% dead, all plans.
- Section `"1."` (duplicate of shield 0.5B, acute-infectious firewall) — 100% dead, all plans.
- Section `"4.5"` (duplicate of shield 0.5C, hypoglycaemia) — functionally dead, all plans.
- Section `"5.6"` (duplicate of shield 0.5D, DVT/PE) — 100% dead, all plans.
- Section `"5.7"` (duplicate of shield 0.5E, gangrene) — functionally dead, all plans.
- Section `"6.5"` (duplicate of shield 0.5F, hypotension) — 100% dead, all plans. Newly identified this pass.
- Section `"5.0"` (duplicate of shield 0.5G, gestational/Type-2 diabetes) — dead for plans with `requiresInsulinForDiabetes` set; dormant (never activates either copy) otherwise. Newly identified this pass.
- The `"pneumonia"` term inside the respiratory regex (`engine.ts:968`) — always intercepted earlier by shield 0.5B.
- The `"cystic fibrosis"` term inside the genetic regex (`engine.ts:1015`) — always intercepted earlier by the respiratory regex.
- The `"lipoma"` and `"papilloma"` terms inside the generic benign-growth regex (`engine.ts:1127`) — always intercepted earlier by the skin regex.
- The `"angioplasty"` term inside the surgical-procedures regex (`engine.ts:1193`) — always intercepted earlier by the heart regex.
- The `"hypotension"` P1-return branch inside shields 0.5F and (dead) `"6.5"` (`engine.ts:531-533`, `:863-865`) — unreachable given current configuration, since no plan defines a `hypotension` categoryMap key (confirmed via direct search across all 6 plans); the shield always falls through to its own `FALLBACK` branch instead.

---

## Unreachable Dictionary Entries

Same six as "Dead Dictionary Entries" above (unreachable = falls to AI). Separately, three **duplicate-alias** entries are structurally unreachable as their own distinct object property but are functionally harmless because a normalization-identical sibling key exists with the same category: `"Acne"` (shadowed by `"acne"`), `"graves' disease"` (shadowed by `"graves disease"`), `"pre-eclampsia"` (shadowed by `"preeclampsia"`). These do not fall to AI — the concept still resolves correctly via the sibling key.

---

## Category Mapping Issues

1. **`hypotension`** — zero of 6 plans define this categoryMap key. The P1 branch that depends on it is dead code for every plan; the shield's `FALLBACK` branch is the only one that ever executes. Classification: **Verified** (deterministic, consistent across all plans) but flagged since the dependent P1 code is unreachable given current data.
2. **`sarcoidosis`** — inconsistently defined across plans (Optima Secure: real wording, correct; Aspire/Reassure 2.0: generic anyOther-duplicate wording, produces a worse outcome than no key at all; Care Supreme/Activ One Max/Activ Fit Preferred: no key, handled correctly by regex fallback). Classification: **Confirmed Bug** for Aspire/Reassure 2.0 (see above), **Verified** for the other four plans.
3. **`ent`** — defined as a categoryMap key on all 6 plans but never referenced anywhere in `engine.ts` (only `eye`/`eyeEnt` are ever looked up via `questionForCategory`). Classification: orphan/dead configuration, harmless. **Needs Review** classification (not itself a routing bug, since nothing ever reads it, but its presence with no consumer is unexplained).
4. **`neuroPsych`** — defined as a categoryMap key on 4 of 6 plans (Optima Secure, Care Supreme, Activ One Max, Activ Fit Preferred) but, like `ent`, is never referenced anywhere in `engine.ts`. Same classification as above.

All other categoryKeys referenced by `questionForCategory`/`findQuestion` calls in `engine.ts` (autoimmune, blood, covid, diabetes, digestive, endocrine, eye, eyeEnt, genetic, heart, hiv, hypertension, kidney, liver, musculoskeletal, neoplasm, neuro, psychiatric, reproductive, respiratory, skin, plus lipid via `findQuestion`) were confirmed present and mapped to real, plan-specific question text on every plan that uses them, or intentionally intercepted earlier by a plan override/pseudo-category before the lookup would matter (e.g. `autoimmune` for Optima Secure). Classification: **Verified**.

---

## Plan Mapping Issues

- No plan is missing a categoryMap entry for any categoryKey its own routing logic can produce, except the `hypotension` and `sarcoidosis` gaps already reported above.
- The four documented plan-specific overrides (Activ Fit Preferred ×2, Care Supreme, Optima Secure — `engine.ts:418-474`) match `MASTER_CONSTITUTION.md` Part XV / Appendix H exactly, including the three `overrides` flags (`requiresInsulinForDiabetes`, `bypassBenignTumors`, `excludePrediabetes`) and their plan assignments. Classification: **Verified**.

---

## Question Mapping Issues

No issues found beyond those already listed under Category Mapping Issues. Each plan's `categoryMap` values were confirmed to resolve to real, present entries in that plan's own `questions` array via `resolvePlanQuestion` (spot-checked against the live `/api/plan-configs` response for Optima Secure earlier this session — exact match, field-for-field). Classification: **Verified**.

---

## Constitution Violations

- **Declaration Hierarchy (P0 → P1 → P2 → P3):** No `P3` tier exists anywhere in the codebase or in `MASTER_CONSTITUTION.md` itself (the Constitution's own glossary, Part XVII, defines only P0/P1/P2/FALLBACK/NON_AILMENT/ESCALATE/INVALID, with P2 explicitly reserved for the AI layer, not `engine.ts`). This is not a violation — the Constitution never asserts a P3 exists. **Verified**.
- **No Double Declaration:** Structurally guaranteed — `classifyDeterministic` is a strict early-return waterfall producing exactly one result per call; no code path emits two declarations. **Verified**.
- **Plan-Aware Routing / plan-override isolation (Invariant 2):** Verified for all four documented overrides. The one place a plan-specific need leaked into global scope is the OSA dictionary entry, already reported as a Business Decision (Part IX item 7), not re-reported here as a fresh violation.
- **Question Wording Is Law / Specificity Override:** Verified as correctly implemented in the hypertension-complication table, the diabetes secondary-manifestation table, the mild-neuro plan-wording check, and the psoriasis autoimmune-preference branch. The sarcoidosis (Aspire/Reassure) and sciatica/lipoma findings above are the confirmed exceptions.
- **Zero Regression:** Not independently verifiable in this pass — no baseline snapshot suite was executed against the current source (Part XII requires running `engine.baseline.test.ts`/`specificIllnessEngine.baseline.test.ts`, which is outside a static source-reading validation). Reported as an open scope limitation, not a pass/fail finding.

---

## Regression Risks

Framed as exposure, not as recommendations — nothing below should be read as an instruction to change anything.

- Removing any of the 7 dead/duplicate regex blocks carries a documentation/structural regression classification (Part XII) requiring a reviewed snapshot diff even though current behavior is provably unaffected either way.
- Any change to the `sarcoidosis` categoryMap key on Aspire or Reassure 2.0 would alter that plan's existing `(condition, plan)` output for 3 dictionary-listed terms — a Behavioral regression event per Part XII, requiring sign-off regardless of whether the new behavior is "better."
- Any change to the global OSA dictionary entry would alter output for 5 plans simultaneously (Plan-isolation-class regression per Part XII's table — the highest review tier) given it is currently a single shared entry.
- The `hypotension` categoryKey's dead P1 branch would become live the moment any plan adds a `hypotension` categoryMap key — worth knowing before any such addition, since it has never been exercised in current production.

---

## Coverage Gaps

The 6 dictionary-curated conditions that currently fall to AI despite being deliberately, explicitly assigned a category in production (`covid.19`, `h. pylori`, `c - section`, `e-cigarette`, `no pre-existing disease`, `c-section delivery`) are the only conditions meeting the "should deterministically route per current production logic, but doesn't" criterion. No other genuine deterministic gaps were found; all other dictionary entries and regex terms either resolve directly or resolve via a firewall/regex/sibling-key net.

---

## Overall Confidence (%)

**90%**

High confidence on all line-cited, programmatically-traced findings (dictionary reachability, regex reachability, category-map completeness, the sarcoidosis and hypotension findings). The 10% reserve reflects three explicit scope limits: (1) the exact plan-wording chunk-match stage (P0) was not independently re-simulated per plan for every dictionary/regex finding, though it was established that it cannot rescue any of the punctuation-related findings; (2) no live baseline snapshot test run was executed as part of this pass (Zero Regression validation is therefore reported, not proven); (3) the three Business Decision items are, by the Constitution's own design, not resolvable to a pass/fail verdict from source alone.
