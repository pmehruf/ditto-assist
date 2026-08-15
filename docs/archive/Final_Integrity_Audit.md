# Final Integrity Audit — Declaration Assistant Production Engine
### Dictionary reachability, regex reachability, dictionary/regex consistency, deterministic coverage

**Scope constraint honored:** this is a verification-only pass. No improvements, no optimizations, and no recommendations are made anywhere in this document — findings are reported as evidence only, per the request.

**Source of truth:** `src/engine.ts` (the `classifyDeterministic` pipeline, read in full, line-cited) and `src/types.ts` (`TOP_PED_DICTIONARY`, all 949 entries, parsed programmatically from the live file — not from memory or the prior audit's data). `regex_blocks.json` was checked and confirmed **not imported or executed anywhere in `src/`** (`grep` for `regex_blocks` in `src/` returns only a single code comment at `engine.ts:914`) — it is a reference/mirror document, not live production code. Per "source of truth is ONLY the current production implementation," this audit uses `engine.ts`'s actual hardcoded regex patterns throughout, not `regex_blocks.json`.

**Method:** every dictionary entry and every regex block's execution path was traced programmatically by replicating `classifyDeterministic`'s exact pipeline order and normalization rules (`normalizeText` — lowercase/trim/collapse-whitespace only — vs. the additional punctuation-stripping applied *only* at the chunk-match and dictionary stages) against the literal file contents, not simplified from a summary. Plan-specific gates (the three `planName ===` overrides; the `requiresInsulinForDiabetes`/`excludePrediabetes` override flags; the HPV/HIV-only coupling, which depends on a plan's actual `hiv` question wording) are noted as annotations where relevant rather than fully re-run per plan — the core reachability question ("does this ever resolve deterministically, for at least the common case") does not change based on that scope decision; where a plan-specific gate changes the answer materially, it is called out explicitly.

---

# PART 1 — Dictionary Reachability Audit

## Summary (949 entries)

| Status | Count |
|---|---|
| Reachable — exact self-match at the dictionary stage (0.7) | 892 |
| Reachable — punctuated key rescued by a normalization-identical sibling key or by an earlier regex/firewall term | 10 |
| Shadowed — an earlier firewall (life-stage, test, acute-infectious, DVT/PE, hypoglycaemia) intercepts before the dictionary stage is ever reached | 42 |
| Shadowed — an earlier regex section (severe-neuro, endocrine, TB-bone, prediabetes, genetic) resolves it before the dictionary stage | 7 |
| **Dead — no dictionary self-match and no regex/firewall net; falls through to the Gemini AI fallback** | **6** |
| Duplicate alias — a second dictionary key that normalizes identically to another key already in the dictionary | 3 pairs (6 keys, already counted in the rows above) |

Correction to my own prior work: an earlier pass on this project estimated roughly 14 dictionary entries as unreachable due to punctuation-stripping. That estimate did not account for the fact that regex sections test against `text` (lowercased, but **not** punctuation-stripped) rather than the further-stripped `cleanInput` used only by the dictionary stage — so most punctuated dictionary keys (`"cushing's syndrome"`, `"addison's disease"`, `"parkinson's disease"`, `"alzheimer's disease"`, `"bell's palsy"`, `"pott's disease"`, `"pre-diabetic condition"`, `"alpha-1 antitrypsin deficiency"`) are in fact rescued by a bare-word regex match one or more stages later, and two more (`"graves' disease"`, `"pre-eclampsia"`) are rescued because their punctuation-free normalized form happens to equal a second, separately-listed dictionary key. Re-derived programmatically against the live pipeline, the true dead-entry count is **6**, not ~14.

## Dead entries (confirmed — no deterministic path exists)

| Dictionary Key | Dictionary Category | Reason no path exists |
|---|---|---|
| `covid.19` | covid | `normalizeText` does not strip the period, so `text` = `"covid.19"`. The COVID regex `\b(covid[\s-]?19?\|...)\b` requires "covid" to be followed by an *optional single whitespace-or-hyphen* then a digit — a period is neither, so the alternative fails to match at the "covid" boundary; no other alternative in the pattern matches either. `cleanInput` (period stripped) = `"covid19"`, which does not equal the literal key `"covid.19"`. No other regex section mentions "covid" in any form. |
| `h. pylori` | digestive | Confirmed no regex section, and no other regex block anywhere in `engine.ts`, contains "pylori" or "helicobacter" in any form (only the digestive section was checked at first; the full 48-block cascade was re-checked here and confirms this). `cleanInput` strips the period → `"h pylori"`, which does not equal the literal key. |
| `c - section` | natural_life_stage | The life-stage firewall regex (`engine.ts:137`) has no c-section/cesarean term at all. No other regex section mentions it. `cleanInput` strips the hyphen → `"c section"`, which does not equal the literal key (which has spaces around the hyphen). |
| `e-cigarette` | lifestyle | "lifestyle" is a dictionary-only pseudo-category (`engine.ts:647-649`) with no regex or firewall counterpart anywhere in the cascade — there is no vaping/tobacco regex section at all. `cleanInput` strips the hyphen → `"ecigarette"`, which does not equal the literal key. |
| `no pre-existing disease` | natural_life_stage | Does not match any alternative in the life-stage firewall regex (no "pre-existing" or bare "no" term there). No other section catches it. |
| `c-section delivery` | natural_life_stage | Same as `c - section` above — no regex or firewall anywhere names c-sections; `cleanInput` strips the hyphen and still does not match the literal key. |

All 6 currently fall through `classifyDeterministic`'s `return null` and are handled by the Gemini AI fallback, despite each having been deliberately, explicitly assigned a category in `TOP_PED_DICTIONARY`.

## Duplicate-alias pairs (structural — one member of each pair is unreachable in its own right, though the *concept* still resolves correctly)

| Pair | Category (both) | Mechanics |
|---|---|---|
| `"Acne"` / `"acne"` | ambiguous_symptom | `normalizeText` lowercases all input before any lookup, so a real user's input can never literally probe the capitalized key `"Acne"` — the direct property lookup on `dict["acne"]` always succeeds first (both keys exist as literal, distinct JS object properties). `"Acne"` is 100% dead weight; `"acne"` is the only one ever actually hit. Outcome is identical either way (same category), so this is harmless redundancy, not a behavioral bug. |
| `"graves' disease"` / `"graves disease"` | endocrine | `cleanInput` strips the apostrophe from any input, producing `"graves disease"` — which is a literal key in its own right. The punctuated key is never the one actually matched (its sibling is), but both map to the same category, so the outcome is identical either way. |
| `"pre-eclampsia"` / `"preeclampsia"` | hypertension | Same mechanism — the hyphen is stripped, landing on the unhyphenated sibling key. Same category both ways; harmless redundancy. |

## All other anomalies (punctuated keys, plan-gated shields, and dictionary-vs-runtime category divergence) — see Part 3 for the subset of these that represent genuine category *inconsistencies* rather than harmless redundancy.

Plan-gated terms (annotated, not counted as separate statuses): 3 entries overlap the Activ Fit Preferred OSA→genetic override; 8 overlap its DVT/PE/varicose→heart override; 3 overlap the Care Supreme Crohn's/UC/IBD→blood override; 6 overlap the Optima Secure RA/ankylosing/psoriatic/reactive-arthritis→musculoskeletal override; 7 overlap the gestational/Type-2 diabetes shield (active only for plans with `requiresInsulinForDiabetes`); 3 overlap the prediabetes-exclude shield; 1 (`"hpv infection"`) overlaps the HPV/HIV-only-question coupling. All of these are Constitution-documented, plan-specific mechanisms (Part XV/Appendix H) that run before the dictionary stage for the named plans only — noted here as a factual overlap, not evaluated as right or wrong.

**Full 949-row table (every dictionary entry, its execution path, status, and reason) is in the Appendix at the end of this document.**


---

# PART 2 — Regex Reachability Audit

Every block that participates in `classifyDeterministic`'s stage-6+ cascade (the ~24 numbered disease-family sections, their sub-sections, the generic shields, diagnostics, and procedure/trauma catch-alls), plus the pre-dictionary fast-path shields it duplicates. "Reachable?" asks whether the block can ever be the stage that actually returns a result for *some* input. "Dead?" means it can never independently produce an outcome, for any input, on any plan. "Partially shadowed?" means it is reachable for most of its terms but one or more specific terms inside it can never fire because an earlier stage always intercepts those specific words first.

| Regex Block | Reachable? | Dead? | Partially Shadowed? | Reason |
|---|---|---|---|---|
| 0.5A test/scan firewall | Yes | No | No | Runs at stage 0.5, before everything except the life-stage firewall and plan overrides. Always live. |
| **0.6 duplicate test firewall** | No | **Yes — 100%** | — | Byte-identical regex to 0.5A, evaluated after the dictionary stage. 0.5A always intercepts first (no escape condition), so 0.6 can never return a different verdict than 0.5A already would have. |
| 0.5B acute-infectious firewall | Yes | No | No | Always live at stage 0.5. |
| **"1." duplicate acute-infectious firewall** | No | **Yes — 100%** | — | Identical regex to 0.5B, evaluated later. 0.5B has no escape condition; always intercepts first. |
| 0.5C hypoglycaemia shield | Yes | No | No | Live at stage 0.5; has a pass-through condition (diabetes/insulin context present → doesn't return, continues). |
| **4.5 duplicate hypoglycaemia shield** | No | **Yes — functionally** | — | Identical regex *and identical pass-through condition* to 0.5C, evaluated later on the same unmutated `text`. Whatever 0.5C decided (return, or pass through), 4.5 evaluating the same test on the same input can never produce a different decision — it is a no-op every time it is reached. |
| 0.5D DVT/PE shield | Yes | No | No | Live at stage 0.5, unconditional return. |
| **5.6 duplicate DVT/PE shield** | No | **Yes — 100%** | — | Identical regex, no escape condition, always shadowed by 0.5D. |
| 0.5E gangrene shield | Yes | No | No | Live at stage 0.5; has a pass-through condition (diabetes/foot/vascular context present). |
| **5.7 duplicate gangrene shield** | No | **Yes — functionally** | — | Same mechanism as 4.5/0.5C — identical regex and identical pass-through condition, always reaches the identical verdict 0.5E already reached. |
| 0.5F hypotension shield | Yes | No | No | Live at stage 0.5, unconditional return. |
| **6.5 duplicate hypotension shield** | No | **Yes — 100%** | — | Identical regex, no escape condition. **Not identified in the prior session's audit** — confirmed newly in this pass by tracing the full pipeline rather than spot-checking. |
| 0.5G gestational/Type-2 diabetes intercept | Yes (plan-gated) | No | — | Only active for plans with `overrides.requiresInsulinForDiabetes` set (Care Supreme, per current plan configs). |
| **"5.0" duplicate gestational/Type-2 intercept** (inside section 5) | Conditionally dead | **Yes, for plans with the override flag** | For plans without the flag, both 0.5G and "5.0" are simply inactive (their outer condition is never true) — not dead exactly, just dormant. | Identical regex and identical override-flag condition to 0.5G. For a plan where the flag is set, 0.5G always intercepts first, making "5.0" unreachable for that plan. **Also not identified in the prior session's audit.** |
| 0.5H prediabetes-exclude shield | Yes (plan-gated) | No | Partially — only covers the "exclude" branch | Only returns when `excludePrediabetes`/`requiresInsulinForDiabetes` is set (Optima Secure, Care Supreme). When not set, it tests but does not return, falling through silently. |
| 5a prediabetes | Yes | No | Yes, for plans with the exclude flag | For plans *without* the exclude flag, this is the only place prediabetes phrasing actually resolves (to the diabetes category) — 0.5H never returns for them. For plans *with* the flag, 0.5H already returned FALLBACK before 5a is ever reached, making 5a's own exclude-branch redundant for those plans (its success branch was never reachable for them either way). |
| 0.5I HPV/HIV-only coupling | Yes (plan/wording-gated) | No | Only overlaps one narrow case | Only returns when the plan's `hiv` question text exists and does *not* mention "std"/"sexually transmitted" — a plan-wording-dependent condition, not a flag. |
| 3. STD/HPV | Yes | No | Slightly, for the specific HPV-restricted case 0.5I already covers | Section 3 independently re-implements the same HPV-restriction check *and* additionally handles syphilis/gonorrhea/chlamydia/herpes and the general (non-restricted) STD/HPV case, none of which 0.5I touches at all. Not a duplicate — a superset. |
| 1.5 COVID | Yes | No | No | Reachable; phrasing-dependent (see dictionary Part 1 — `"covid.19"` specifically does not match this pattern; `"covid 19"`/`"covid-19"` would). |
| 2. malignant_cancers | Yes | No | No | Live. |
| 4. lipids | Yes | No | No | Live. |
| 5b. diabetes | Yes | No | No | Live. |
| 6. heart | Yes | No | Yes — shadows `"angioplasty"` in 24a (see below), but is not itself shadowed by anything earlier | Live; runs before section 24a and before the dictionary key `"angioplasty"` is even needed (dictionary also assigns heart to it — consistent). |
| 7. hypertension | Yes | No | No | Live. |
| 8a. severe_neuro | Yes | No | No | Live; catches `"parkinson's disease"`/`"alzheimer's disease"` (rescuing those punctuated dictionary keys — see Part 1). |
| 8b. mild/peripheral neuro | Yes | No | Yes — the already-fixed cervical-radiculopathy guard covers only spine-qualified radiculopathy; `"sciatica"` has no equivalent guard (already reported in the prior verification pass this session) | Live for its other terms. |
| 9. psychiatric | Yes | No | No | Live; catches `"bell's palsy"` (rescuing that punctuated key, though see Part 3 for the plan-dependent category note on section 8b vs. 9). |
| 9.5a–e TB sub-blocks (bone/spine, brain, digestive, kidney, lymph) | Yes (all 5) | No | No | All five are live and mutually exclusive by term set — no overlap found between them or with any other section. |
| 10. respiratory | Yes | No | Yes — its own `"pneumonia"` alternative is 100% dead (0.5B always intercepts "pneumonia" first, since 0.5B runs at stage 0.5 and respiratory runs at stage 6); its `"cystic fibrosis"` alternative is live and itself shadows a duplicate `"cystic fibrosis"` listing inside 16b (genetic) | Reachable for its other ~18 terms. |
| 11. kidney | Yes | No | No | Live. |
| 12. reproductive | Yes | No | No | Live. |
| 13. digestive | Yes | No | No | Live. |
| 14. liver | Yes | No | No | Live. |
| 15. endocrine | Yes | No | No | Live; catches `"cushing's syndrome"`/`"addison's disease"` (rescuing those punctuated keys). |
| 16a. blood | Yes | No | No | Live. |
| 16b. genetic/congenital/metabolic (4 OR'd sub-patterns) | Yes | No | Yes — its `"cystic fibrosis"` term is 100% dead (shadowed by section 10, which runs earlier); its own two sub-patterns internally duplicate `"tay-sachs"` and `"neimann-pick"` (harmless — same block, same outcome either way) | Reachable for its other ~58 terms; catches `"alpha-1 antitrypsin deficiency"` (rescuing that punctuated dictionary key). |
| 16c. FOP | Yes | No | No | Live. |
| 17a. autoimmune joint/spine | Yes | No | Yes, for Optima Secure specifically | Optima Secure's plan override (stage 0.4) intercepts rheumatoid arthritis/ankylosing spondylitis/psoriatic arthritis/reactive arthritis before this section ever runs, for that plan only — a documented, intentional plan-specific mechanism (Constitution Part XV), not a defect. |
| 17b. autoimmune systemic | Yes | No | No | Live. |
| 17.5 sarcoidosis | Yes | No | No | Live. |
| 18. musculoskeletal | Yes | No | Incomplete relative to the dictionary's own `"sciatica"` → musculoskeletal assignment (already reported) | Otherwise live for its ~44 other terms. |
| 19. skin | Yes | No | Yes — shadows `"lipoma"` and `"papilloma"` in 22A (see below); this section itself runs before 22A | Live for its other ~25 terms. |
| 20. eye | Yes | No | No | Live. |
| 21. ENT | Yes | No | No | Live. |
| 22A. generic benign growths | Yes | No | Yes — its `"lipoma"` and `"papilloma"` terms are 100% dead (skin, section 19, always intercepts those two words first) | Live for its other 8 terms (tumour, neoplasm, polyp, cyst, lump, growth, adenoma, benign). |
| 22B. generic allergy shield | Yes | No | Shadowed for *exact* dictionary matches only | The dictionary's own `"allergy"` pseudo-category (stage 0.7) catches any input that is an *exact* dictionary key first; 22B only matters for non-exact allergy phrasings, which is presumably its purpose. |
| 22C. gynecomastia | Yes | No | Shadowed for *exact* dictionary matches only | Same pattern as 22B — the dictionary's own `"gynecomastia"` pseudo-category (stage 0.7) wins for exact keys; 22C is reachable only for non-exact phrasings. |
| 22D. ambiguous symptoms shield | Yes | No | Shadowed for *exact* dictionary matches only | Same pattern — the dictionary's `"ambiguous_symptom"` pseudo-category wins for exact keys. |
| 22E. lab findings shield | Yes | No | No — no equivalent dictionary pseudo-category exists for this one | Live. |
| 23. diagnostics | Yes | No | Yes — 5 of its ~40 terms (`scan`, `x-ray`, `mri`, `ultrasound`, `usg`) are 100% dead, shadowed by 0.5A which runs far earlier and has a much shorter term list | Reachable and necessary for its other ~35 terms (biopsy, pap smear, holter, eeg, emg, bronchoscopy, blood test, lft/kft, etc. — none of which 0.5A's shorter list covers), and for giving a more specific message on tmt/treadmill/stress-test/angiography/echo/endoscopy/colonoscopy (which 0.5A explicitly excludes via its own negative lookahead). |
| 24a. surgical procedures | Yes | No | Yes — its `"angioplasty"` term is 100% dead (section 6, heart, always intercepts it first, and produces a more specific/consistent outcome) | Live for its other ~12 terms. |
| 24b. acute trauma | Yes | No | No | Live. |

---

# PART 3 — Dictionary vs. Regex Consistency

Flagging only genuine inconsistencies — cases where a dictionary-assigned category and the category actually reached at runtime (via a firewall or regex section that intercepts before, or in place of, the dictionary) **disagree**. Redundant/harmless overlaps (same outcome either way — e.g. `"acute_infection"` dictionary entries vs. the identical firewall B outcome, or `"vascular_fallback"` entries vs. the identical DVT/PE shield outcome) are not listed here; they were already noted as consistent in Part 1.

| Condition | Dictionary says | Actual runtime resolution | Nature of the inconsistency |
|---|---|---|---|
| `"pregnancy induced hypertension"` | `hypertension` | Life-stage firewall (stage 0) matches on `"pregnan(cy\|t)"` as a substring and returns `NON_AILMENT` — this is the very first stage in the entire pipeline, running before plan overrides, before every shield, and long before the dictionary stage. | The dictionary explicitly, deliberately categorizes this as a hypertensive disorder. At runtime it is instead classified as a natural physiological life event and never reaches the hypertension question at all. |
| `"hypoglycemia episode"` | `diabetes` | 0.5C hypoglycaemia shield returns `FALLBACK`, because this specific phrase contains no diabetes-qualifying word (`diabet*`/insulin/dm/t1d/t2d/hba1c) for the shield's own pass-through condition to recognize. | Dictionary says diabetes; runtime sends it to the generic Others section instead. |
| `"reactive hypoglycemia"` | `diabetes` | Same mechanism and same outcome as above. | Same inconsistency. |
| `"positive hiv test"` | `hiv` | 0.5A test/scan firewall matches on `"test"` and returns a generic `FALLBACK` ("declare under tests and investigations"), before the dictionary's `hiv` category — which would route to the plan's actual HIV/AIDS question — is ever reached. | Dictionary says hiv; runtime routes to a generic test-result message instead of the disease question. |
| `"std profile"` | `hiv` | Same mechanism (0.5A matches `"profile"`) and same outcome. | Same inconsistency. |
| `"lipid profile high"` | `lipid` | Same mechanism (0.5A matches `"profile"`); the plan's actual lipid/cholesterol question is never reached. | Same inconsistency. |
| `"bell's palsy"` | `neuro` | Regex section 8b resolves it to `psychiatric` **or** `neuro` depending on whether the current plan's psychiatric question wording contains "nervous" (`engine.ts:922-927`) — for a plan like Optima Secure, whose psychiatric question is *"Nervous, Psychiatric or Mental or Sleep disorder?"*, the outcome is `psychiatric`, not `neuro`. | Dictionary says neuro unconditionally; actual runtime is plan-dependent and disagrees with the dictionary for at least one plan. |
| `"lipoma"` (non-exact phrasings only, e.g. "lipoma on back", "multiple lipomas") | `benign_growth` | The exact term `"lipoma"` alone resolves correctly via the dictionary (benign_growth). Any phrasing that isn't an exact dictionary key falls through to regex, where section 19 (skin) lists `"lipoma"` and intercepts it before section 22A (benign growths) ever runs. | Dictionary says benign_growth for the exact term; non-exact phrasings of the same condition resolve to skin instead — the same execution-order pattern already reported for `"sciatica"` in the prior verification pass this session. |

No other dictionary-vs-regex disagreements were found among the 949 entries. Every other shadowed or firewall-intercepted dictionary entry resolves to a runtime outcome that matches (or is a harmless synonym of) its own dictionary category.

---

# PART 4 — Deterministic Coverage Gaps

Per the instruction, this list is restricted to conditions that **already have an explicit `TOP_PED_DICTIONARY` entry** — i.e., production's own logic has already, deliberately decided each of these should resolve deterministically — but which the current pipeline cannot actually reach, so they fall to the Gemini AI fallback instead. This is the identical list as Part 1's "Dead entries" table, restated here as the direct answer to Part 4's question:

| Condition (as curated in the dictionary) | Curated category | Why it currently falls to AI instead |
|---|---|---|
| `covid.19` | covid | Punctuation form not matched by the COVID regex; no dictionary self-match. |
| `h. pylori` | digestive | No regex anywhere in the engine references "pylori"/"helicobacter"; no dictionary self-match. |
| `c - section` | natural_life_stage | No firewall or regex references c-sections/cesarean in any form; no dictionary self-match. |
| `e-cigarette` | lifestyle | No regex or firewall exists for lifestyle/habit terms at all; no dictionary self-match. |
| `no pre-existing disease` | natural_life_stage | Does not match the life-stage firewall's term list; no dictionary self-match. |
| `c-section delivery` | natural_life_stage | Same as `c - section`. |

No other conditions meet the Part 4 criterion (dictionary-curated + zero deterministic path). Every other dictionary entry either resolves directly, resolves via a firewall/regex net, or resolves via a normalization-identical sibling key.

---

# PART 5 — Final Verdict

Evidence only; no recommendations.

**Confirmed Bugs**
- 6 dictionary entries (`covid.19`, `h. pylori`, `c - section`, `e-cigarette`, `no pre-existing disease`, `c-section delivery`) are curated but structurally unreachable, falling to the AI fallback despite production's own explicit categorization of each.
- `"pregnancy induced hypertension"` is dictionary-categorized as hypertension but is intercepted by the life-stage firewall and classified `NON_AILMENT`.
- `"hypoglycemia episode"` and `"reactive hypoglycemia"` are dictionary-categorized as diabetes but are intercepted by the 0.5C shield and routed to `FALLBACK`.
- `"positive hiv test"`, `"std profile"`, `"lipid profile high"` are dictionary-categorized as hiv/hiv/lipid respectively but are intercepted by the generic 0.5A test firewall and routed to a generic test-result `FALLBACK` message instead of their disease question.
- The `"sciatica"` non-exact-phrasing mis-route and the `"lipoma"` non-exact-phrasing mis-route (both shadowed by an earlier, less-specific regex section for any input that isn't the bare exact dictionary term) — same execution-order defect class, independently reconfirmed this pass.
- Two previously-unidentified 100%-dead duplicate code blocks: section "6.5" (hypotension, duplicate of shield 0.5F) and section "5.0" (gestational/Type-2 diabetes, duplicate of shield 0.5G, dead specifically for plans with `requiresInsulinForDiabetes` set).

**Documentation Issues**
- None newly identified in this pass beyond what the prior two audits already reported (this pass was a code-only trace, not a documentation comparison).

**Business Decisions**
- `"bell's palsy"` resolving to `psychiatric` vs. `neuro` depending on a plan's specific question wording is a direct instance of the "canonical term vs. plan-dependent variant" pattern the Constitution's Part IX, item 6 (synonym-consistency enforcement) already reserves as unresolved — noted, not resolved, here.

**Dead Code (confirmed, zero behavioral impact either way)**
- Sections `0.6`, `"1."`, `"4.5"`, `"5.6"`, `"5.7"`, `"6.5"` — fully dead duplicates of shields 0.5A–0.5F respectively, for every plan and every input.
- Section `"5.0"` — dead duplicate of shield 0.5G, specifically for plans with `overrides.requiresInsulinForDiabetes` set (currently Care Supreme); simply dormant (never activates either copy) for other plans.
- The `"Acne"` (capitalized) dictionary key — permanently unreachable, shadowed by its own lowercase sibling `"acne"`.
- The `"graves' disease"` and `"pre-eclampsia"` dictionary keys — never the literal entry actually matched (their unpunctuated siblings are), though the resulting category is identical either way.
- The regex term `"pneumonia"` inside section 10 (respiratory) — always intercepted earlier by shield 0.5B.
- The regex term `"cystic fibrosis"` inside section 16b (genetic) — always intercepted earlier by section 10 (respiratory).
- The regex terms `"lipoma"` and `"papilloma"` inside section 22A (generic benign growths) — always intercepted earlier by section 19 (skin).
- The regex term `"angioplasty"` inside section 24a (surgical procedures) — always intercepted earlier by section 6 (heart).

**No Issues**
- 892 of 949 dictionary entries (94%) resolve via a direct, unambiguous exact match at the dictionary stage with no shadowing of any kind.
- All 24 primary disease-family regex sections (and their TB/genetic sub-blocks) are reachable and functioning; none of the "primary" (non-duplicate) sections is fully dead.
- The three plan-specific overrides (Activ Fit Preferred, Care Supreme, Optima Secure) execute correctly at their documented pipeline stage (0.4), before any shield, dictionary, or regex section, exactly as the Constitution's Appendix A describes.
- No case exists anywhere in the 949-entry dictionary where a key's normalized form resolves — whether directly or via a sibling/regex rescue — to a *different* category than the one the dictionary itself assigned to that key (i.e., zero "true collisions" in that specific sense; the 3 duplicate-alias pairs found all agree with themselves on category).
---

# Appendix — Full Dictionary Reachability Table (all 949 entries)

| Dictionary Key | Execution Path (first stage that resolves it) | Status | Reason |
|---|---|---|---|
| `abdominal tuberculosis` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `abnormal thyroid` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `abscence seizure` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `absence seizure` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `accident` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `accidental injury` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `achondroplasia` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `achondroplasia dwarfism` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `acid peptic disease` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `acid reflux` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `acidity` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `acne` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `Acne` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `acoustic neuroma` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `acoustic neuroma ear` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `acromegaly` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `acromegaly hormone` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `acute kidney injury` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `acute lymphocytic leukemia` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `acute myeloid leukemia` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `acute pancreatitis` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `addison disease` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `addison's disease` | 15. endocrine | Shadowed (regex) | Intercepted at 15. endocrine before the dictionary stage (0.7) is ever reached; resolves to endocrine |
| `adenocarcinoma colon` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `adenofibroma` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `adenofibroma breast` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `adenoid` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `adenoid hypertrophy` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `adenoids` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `adenoma adrenal` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `adenoma parathyroid` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `adenoma thyroid` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `adenomyosis` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `adhd` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `adrenal insufficiency` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `afib` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `aids` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `aki` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `alcohol consumption` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `alcohol intake` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `all` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `all cancer` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `allergic` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `allergic condition` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `allergic conjunctivitis` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `allergic rhinitis` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `allergy` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `alopecia` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `alopecia areata` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `alpha-1 antitrypsin deficiency` | 16b genetic/congenital/metabolic | Shadowed (regex) | Intercepted at 16b genetic/congenital/metabolic before the dictionary stage (0.7) is ever reached; resolves to genetic |
| `alzheimer disease` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `alzheimer's disease` | 8a severe neuro | Shadowed (regex) | Intercepted at 8a severe neuro before the dictionary stage (0.7) is ever reached; resolves to neuro |
| `aml` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `amoebiasis` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `amyloidosis` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `amyloidosis systemic` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `anal fissure` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `anal fistula` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `anaplastic thyroid cancer` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `anemia` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `angina` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `angina pectoris` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `angioplasty` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `ankylosing spondylitis` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `annual health checkup` | 0.5A test firewall | Shadowed (firewall) | Intercepted at 0.5A test firewall before the dictionary stage (0.7) is ever reached; resolves to FALLBACK (0.5A test firewall) |
| `anorexia` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `anxiety` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `aortic aneurysm` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `aortic regurgitation` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `aortic stenosis` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `apd` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `apendicitis` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `aplastic anemia` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `aplastic anemia critical` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `appendectomy` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `appendicectomy` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `appendicitis` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `appendicitis surgery` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `appendix surgery` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `ascariasis` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `ascites` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `asd` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `aspergillosis` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `asthma` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `astigmatism` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `astrocytoma` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `astrocytoma brain` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `atopic dermatitis` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `atrial fibrillation` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `atrial flutter` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `atrial myxoma` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `atrial septal defect` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `autism` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `autoimmune disease` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `autoimmune disorder` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `av block` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `avascular necrosis` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `avn` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `bartholin cyst` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `basal cell carcinoma` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `basal cell carcinoma bcc` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `beedi` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `beer` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `behcet disease` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `bell's palsy` | 8b mild/peripheral neuro | Shadowed (regex) | Intercepted at 8b mild/peripheral neuro before the dictionary stage (0.7) is ever reached; resolves to psychiatric-or-neuro |
| `benign brain tumor` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `benign growth` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `benign prostatic hyperplasia` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `betel nut` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `bipolar` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `bladder cancer` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `bladder stone` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `bladder tumor neoplasm` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `bleeding disorder` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `blepharitis` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `blood donor` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `body pain` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `bone marrow hypoplasia` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `borderline diabetic` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `bph` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `bph surgery` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `brain abscess` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `brain hemorrhage` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `breast calcification` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `breast cancer` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `breast clinic evaluation` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `breast cyst` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `breast cyst benign` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `breast lump` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `breast lump evaluation` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `breastfeeding mother` | 0. life-stage firewall | Shadowed (firewall) | Intercepted at 0. life-stage firewall before the dictionary stage (0.7) is ever reached; resolves to NON_AILMENT (life-stage firewall) |
| `breathlessness` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `bronchial asthma` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `bronchiectasis` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `bronchogenic carcinoma` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `brucellosis` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `bulimia` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `bundle branch block` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `c - section` | no stage matched | Dead entry | No dictionary self-match (normalization strips required punctuation) and no regex/firewall term catches it -> falls to AI |
| `c section history` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `c-section delivery` | no stage matched | Dead entry | No dictionary self-match (normalization strips required punctuation) and no regex/firewall term catches it -> falls to AI |
| `cabg` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `cad` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `cah` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `calcium` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `calcium deficiency` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `candidiasis` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `cataract` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `cataract operation` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `cataract surgery` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `celiac disease` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `celiac enteropathy` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `cellulitis` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `cerebral palsy` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `cervical cancer` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `cervical spondylosis` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `chain smoker` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `chalazion` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `charcot marie tooth disease` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `chest pain` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `chf` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `chickenpox` | 0.5B acute infectious | Shadowed (firewall) | Intercepted at 0.5B acute infectious before the dictionary stage (0.7) is ever reached; resolves to FALLBACK (0.5B acute infectious firewall) |
| `chikungunya` | 0.5B acute infectious | Shadowed (firewall) | Intercepted at 0.5B acute infectious before the dictionary stage (0.7) is ever reached; resolves to FALLBACK (0.5B acute infectious firewall) |
| `childbirth history` | 0. life-stage firewall | Shadowed (firewall) | Intercepted at 0. life-stage firewall before the dictionary stage (0.7) is ever reached; resolves to NON_AILMENT (life-stage firewall) |
| `chlamydia infection` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `cholecystectomy` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `cholelithiasis surgery` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `cholesterol` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `cholestrerol` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `chondrosarcoma` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `chondrosarcoma joints` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `chronic bronchitis` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `chronic fatigue` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `chronic fatigue syndrome` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `chronic kidney disease` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `chronic lymphocytic leukemia` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `chronic myeloid leukemia` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `chronic obstructive pulmonary disease` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `chronic pain syndrome` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `chronic pancreatitis` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `chronic sinusitis` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `chronic venous insufficiency` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `cigar` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `cigarette` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `cigarettes` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `ckd` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `cleft lip cleft palate` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `cll` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `clotting disorder` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `clotting factor deficiency` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `clubfoot deformity` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `cml` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `cmv` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `coagulation disorder` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `coagulation pathway defect` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `coeliac disease` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `coeliac enteropathy` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `cold` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `cold sores` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `colon cancer` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `colon polyp` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `colon polyp removal` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `colorectal cancer` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `colorectal cancer neoplasm` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `common cold` | 0.5B acute infectious | Shadowed (firewall) | Intercepted at 0.5B acute infectious before the dictionary stage (0.7) is ever reached; resolves to FALLBACK (0.5B acute infectious firewall) |
| `congenital adrenal hyperplasia` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `congenital heart defect` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `congestion` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `congestive heart failure` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `constipation` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `contact dermatitis` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `copd` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `coronary artery bypass` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `coronary artery disease` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `coronary artery spasm` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `coronary stent` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `cough` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `covid.19` | no stage matched | Dead entry | No dictionary self-match (normalization strips required punctuation) and no regex/firewall term catches it -> falls to AI |
| `craniopharyngioma` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `craniopharyngioma brain` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `creatinine` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `crohn disease` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `cryptococcosis` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `cushing syndrome` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `cushing's syndrome` | 15. endocrine | Shadowed (regex) | Intercepted at 15. endocrine before the dictionary stage (0.7) is ever reached; resolves to endocrine |
| `cva` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `cystic fibrosis lungs` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `cystitis` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `cystoscopy done` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `cytomegalovirus` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `daily tablets` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `dcis` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `dcis breast` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `deep vein thrombosis` | 0.5D DVT/PE | Shadowed (firewall) | Intercepted at 0.5D DVT/PE before the dictionary stage (0.7) is ever reached; resolves to FALLBACK (0.5D DVT/PE shield) |
| `defibrillator` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `deficiency` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `dementia` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `demyelinating disease` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `dengue` | 0.5B acute infectious | Shadowed (firewall) | Intercepted at 0.5B acute infectious before the dictionary stage (0.7) is ever reached; resolves to FALLBACK (0.5B acute infectious firewall) |
| `depression` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `depressive disorder` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `dermatitis` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `dermatomyositis` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `deviated nasal septum` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `diabetes` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `diabetes insipidus` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `diabetes mellitus type 2` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `diabetes type 1` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `diabetes type 2` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `diabetic foot infection` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `diabetic foot ulcer` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `diabetic ketoacidosis` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `diabetic nephropathy kidney` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `diabetic neuropathy nerve` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `diabetic retinopathy` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `diabetic retinopathy eye` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `dialysis` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `dialysis patient` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `diarrhea` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `dilated cardiomyopathy` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `diphtheria` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `disc bulge` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `diverticulitis` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `dka history` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `dns` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `down syndrome genetic` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `drinker` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `drinking` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `drug abuse` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `drug allergy` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `dry eye syndrome` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `ductal carcinoma in situ` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `duodenal ulcer` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `dust allergy` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `dvt` | 0.5D DVT/PE | Shadowed (firewall) | Intercepted at 0.5D DVT/PE before the dictionary stage (0.7) is ever reached; resolves to FALLBACK (0.5D DVT/PE shield) |
| `dyslipidemia` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `dyslipidemia check` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `dyslipidimia` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `dyslipidmia` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `dysmenorrhea` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `e-cigarette` | no stage matched | Dead entry | No dictionary self-match (normalization strips required punctuation) and no regex/firewall term catches it -> falls to AI |
| `ebola` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `eclampsia` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `eczema` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `ehlers danlos syndrome` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `ehlers danlos syndrome joints` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `emphysema` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `encephalitis` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `end stage renal disease` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `endocarditis` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `endometrial cancer` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `endometriosis` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `enzyme deficiency metabolic` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `eosinophilia` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `ependymoma brain` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `epididymitis` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `epilepsy` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `epstein barr virus` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `esrd` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `essential hypertension htn` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `essential thrombocythemia` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `essential tremor` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `ewing sarcoma` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `ewing sarcoma bones` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `executive health check` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `exercise daily` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `facial paralysis` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `factor ix deficiency` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `factor viii deficiency` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `fatigue` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `female infertility` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `femoral hernia` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `fever` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `fibroadenoma` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `fibroadenoma breast` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `fibrocystic breast disease` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `fibromyalgia` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `fibrositis tissue` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `filariasis` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `fissurectomy` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `fistulectomy` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `fit and fine` | 0. life-stage firewall | Shadowed (firewall) | Intercepted at 0. life-stage firewall before the dictionary stage (0.7) is ever reached; resolves to NON_AILMENT (life-stage firewall) |
| `fitness center member` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `follicular thyroid cancer` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `food allergy` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `food poisoning` | 0.5B acute infectious | Shadowed (firewall) | Intercepted at 0.5B acute infectious before the dictionary stage (0.7) is ever reached; resolves to FALLBACK (0.5B acute infectious firewall) |
| `foos poisoning` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `fracture healing with implant` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `friedreich ataxia` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `friedreich ataxia genetic` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `full body check` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `fully vaccinated` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `g6pd deficiency metabolic` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `gad` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `gall bladder removal` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `gall bladder stone` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `gallbladder disease` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `gallbladder stone` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `ganglioma` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `gas` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `gas problem` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `gastric cancer` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `gastric erosion` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `gastric polyp` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `gastric polyp removal` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `gastric problem` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `gastric ulcer` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `gastritis` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `gastroenteritis` | 0.5B acute infectious | Shadowed (firewall) | Intercepted at 0.5B acute infectious before the dictionary stage (0.7) is ever reached; resolves to FALLBACK (0.5B acute infectious firewall) |
| `gaucher disease genetic` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `gbm` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `gbs` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `gdm` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `general paresis` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `generalized anxiety disorder` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `genital herpes` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `genitourinary tuberculosis` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `gerd` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `gestational diabetes` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `gestational hypertension` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `giant cell arteritis` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `giardiasis` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `gigantism` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `gigantism hormone` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `glaucoma` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `glioblastoma` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `glioblastoma multiforme` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `glomerulonephritis` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `goiter` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `goitre` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `gonorrhea infection` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `gord` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `gout` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `graves disease` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `graves' disease` | 0.7 dictionary | Reachable (via sibling/normalization) | Punctuation stripped from input never re-matches this literal key; resolves instead via a normalization-identical sibling key, landing on category "endocrine" |
| `guillain barre syndrome` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `gullian barre syndrome` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `gutka` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `gutkha` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `gynaecomastia` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `gyneacomastia` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `gynecomastia` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `gynocomastia` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `h. pylori` | no stage matched | Dead entry | No dictionary self-match (normalization strips required punctuation) and no regex/firewall term catches it -> falls to AI |
| `haemangioma` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `haemorrhoidectomy` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `haemorrhoids` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `hashimoto thyroiditis` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `hasimoto thyroiditis` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `hay fever` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `hb low` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `hba1c high` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `hcc` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `hcc liver` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `hcm` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `head injury` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `headache` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `headcahe` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `healthy lifestyle` | 0. life-stage firewall | Shadowed (firewall) | Intercepted at 0. life-stage firewall before the dictionary stage (0.7) is ever reached; resolves to NON_AILMENT (life-stage firewall) |
| `healthy normal` | 0. life-stage firewall | Shadowed (firewall) | Intercepted at 0. life-stage firewall before the dictionary stage (0.7) is ever reached; resolves to NON_AILMENT (life-stage firewall) |
| `hearing loss` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `heart attack` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `heart block` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `heart failure` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `heart murmur systolic` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `heart transplant` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `heartburn` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `heavy drinker` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `hemangioma` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `hemmoroids` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `hemochromatosis` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `hemochromatosis blood` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `hemophilia` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `hemorrhagic stroke` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `hemorrhoids` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `hepatitis` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `hepatitis a` | 0.5B acute infectious | Shadowed (firewall) | Intercepted at 0.5B acute infectious before the dictionary stage (0.7) is ever reached; resolves to FALLBACK (0.5B acute infectious firewall) |
| `hepatocellular carcinoma` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `hepatomegaly` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `hereditary spastic paraplegia` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `hernioplasty` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `herniorrhaphy` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `herpes zoster` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `hiatal hernia` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `high blood pressure` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `high blood sugar` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `high blood sugar state` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `high bp` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `high cholesterol` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `high cholesterol level` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `high creatinine` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `high eosinophils` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `high triglycerides` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `high tsh` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `high uric acid` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `hip replacement` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `hirayama` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `hiv negative` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `hiv positive` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `hives` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `hodgkin lymphoma` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `hookworm` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `hpv infection` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `huntington chorea` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `huntington chorea neuro` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `huntington disease neuro` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `hydrocele` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `hyperaldosteronism` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `hyperaldosteronism adrenal` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `hypercholesterolemia state` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `hyperglycemia episode` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `hyperlipidemia` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `hyperlipidemia treated` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `hyperlipidemia untreated` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `hyperlipidimia` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `hyperlipidmia` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `hyperopia` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `hyperparathyroidism` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `hypertension` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `hypertension treated` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `hypertension untreated` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `hyperthyroidism` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `hypertriglyceridemia state` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `hypertrophic cardiomyopathy` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `hypoglycemia episode` | 0.5C hypoglycaemia | Shadowed (firewall) | Intercepted at 0.5C hypoglycaemia before the dictionary stage (0.7) is ever reached; resolves to FALLBACK (0.5C hypoglycaemia shield) |
| `hypogonadism` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `hypogonadism state` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `hypoparathyroidism` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `hypoparathyroidism state` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `hypopituitarism` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `hypopituitarism state` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `hypothyroidism` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `hysterectomy` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `hysterectomy history` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `ibd` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `ibs` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `icd implantation` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `iddm` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `ifg` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `igt` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `ihd` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `ild` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `impaired fasting glucose` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `impaired glucose tolerance` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `incisional hernia` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `indigestion` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `infectious mononucleosis` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `infertility` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `infertillity` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `inguinal hernia` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `insomnia` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `insulin dependent diabetes` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `intellectual disability` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `interstitial lung disease` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `intestinal tuberculosis` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `iron deficiency` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `iron deficiency anemia` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `irritable bowel syndrome` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `ischaemic heart disease` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `ischemic stroke` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `ivf` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `japanese encephalitis` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `jaundice` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `kaposi sarcoma` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `keloid` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `keratoconus` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `khaini` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `kidney cancer` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `kidney donor` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `kidney failure` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `kidney stone removal` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `kidney stones` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `kidney transplant` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `kidneystone` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `klinefelter syndrome` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `klinefelter syndrome genetic` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `knee replacement` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `kyphosis` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `labyrinthitis` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `lactation stage` | 0. life-stage firewall | Shadowed (firewall) | Intercepted at 0. life-stage firewall before the dictionary stage (0.7) is ever reached; resolves to NON_AILMENT (life-stage firewall) |
| `laryngeal tuberculosis` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `laryngitis` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `latex allergy` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `lbbb` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `lcis` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `lcis breast` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `leg fracture with implant` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `leiomyoma` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `leiomyosarcoma` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `leiomyosarcoma uterus` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `leishmaniasis` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `leprosy` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `leukocytosis` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `leukopenia` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `lipid profile high` | 0.5A test firewall | Shadowed (firewall) | Intercepted at 0.5A test firewall before the dictionary stage (0.7) is ever reached; resolves to FALLBACK (0.5A test firewall) |
| `lipoma` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `liposarcoma` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `liposarcoma tissue` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `liquor` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `listeriosis` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `liver abscess` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `liver cancer` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `liver cyst` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `lobular carcinoma in situ` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `low blood level` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `low blood sugar finding` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `low hemoglobin` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `lscs` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `lscs delivery` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `lumbar spondylosis` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `lung cancer` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `lung collapse` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `lung infection` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `lung tb` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `lupus diagnosis` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `lymph node tuberculosis` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `lymphangioma` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `lymphedema` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `macular degeneration` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `malaria` | 0.5B acute infectious | Shadowed (firewall) | Intercepted at 0.5B acute infectious before the dictionary stage (0.7) is ever reached; resolves to FALLBACK (0.5B acute infectious firewall) |
| `male infertility` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `malignant melanoma skin` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `marfan syndrome` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `marfan syndrome aorta` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `marijuana` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `mawa` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `mctd diagnosis` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `mds diagnosis` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `medullary thyroid cancer` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `melanoma` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `meniere disease` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `meningioma` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `meningioma tumor` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `meningitis` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `meningococcal meningitis` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `menopause status` | 0. life-stage firewall | Shadowed (firewall) | Intercepted at 0. life-stage firewall before the dictionary stage (0.7) is ever reached; resolves to NON_AILMENT (life-stage firewall) |
| `menorrhagia` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `mi` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `mi history` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `microalbuminuria` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `migraine` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `miliary tuberculosis` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `mitral regurgitation` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `mitral stenosis` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `mitral valve prolapse` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `mixed connective tissue disease` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `mnd` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `moderate intellectual disability` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `morbid obesity` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `motor neuron disease` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `ms` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `multiple myeloma` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `multiple sclerosis` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `muscular dystrophy` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `mvp` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `myalgic encephalomyelitis` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `myasthenia gravis` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `myelitis` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `myelodysplastic syndrome` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `myelofibrosis disease` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `myeloma diagnosis` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `myocardial infarction` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `myocarditis` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `myopia` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `myxoma` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `narcolepsy` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `nasal polyp` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `nausea` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `nephrectomy` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `nephrectomy history` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `nephrolithiasis` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `nephrotic syndrome` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `neurosyphilis` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `nhl` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `nicotine` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `niddm` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `nil medical history` | 0. life-stage firewall | Shadowed (firewall) | Intercepted at 0. life-stage firewall before the dictionary stage (0.7) is ever reached; resolves to NON_AILMENT (life-stage firewall) |
| `no pre-existing disease` | no stage matched | Dead entry | No dictionary self-match (normalization strips required punctuation) and no regex/firewall term catches it -> falls to AI |
| `non hodgkin lymphoma` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `non insulin dependent diabetes` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `non small cell lung cancer` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `none` | 0. life-stage firewall | Shadowed (firewall) | Intercepted at 0. life-stage firewall before the dictionary stage (0.7) is ever reached; resolves to NON_AILMENT (life-stage firewall) |
| `noonan syndrome` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `noonan syndrome genetic` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `normal height weight` | 0. life-stage firewall | Shadowed (firewall) | Intercepted at 0. life-stage firewall before the dictionary stage (0.7) is ever reached; resolves to NON_AILMENT (life-stage firewall) |
| `normal menstruation` | 0. life-stage firewall | Shadowed (firewall) | Intercepted at 0. life-stage firewall before the dictionary stage (0.7) is ever reached; resolves to NON_AILMENT (life-stage firewall) |
| `normal profile` | 0. life-stage firewall | Shadowed (firewall) | Intercepted at 0. life-stage firewall before the dictionary stage (0.7) is ever reached; resolves to NON_AILMENT (life-stage firewall) |
| `not applicable` | 0. life-stage firewall | Shadowed (firewall) | Intercepted at 0. life-stage firewall before the dictionary stage (0.7) is ever reached; resolves to NON_AILMENT (life-stage firewall) |
| `nsclc` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `obesity` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `obstructive sleep apnea` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `occasional drinker` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `ocd` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `oligodendroglioma brain` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `optic neuritis` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `osa` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `osteitis fibrosa cystica` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `osteoarthritis` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `osteogenesis imperfecta` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `osteogenesis imperfecta bones` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `osteomyelitis` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `osteopenia` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `osteoporosis` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `osteosarcoma` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `osteosarcoma bones` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `otitis externa` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `otitis media` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `ovarian cancer` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `ovarian cyst` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `overweight` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `paan` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `pacemaker` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `palpitations` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `pan` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `pan masala` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `pancreatic cancer` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `pancreatitis` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `pancytopenia state` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `panhypopituitarism` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `panic disorder` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `papillary thyroid cancer` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `paraganglioma tumor` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `parkinson disease` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `parkinson's disease` | 8a severe neuro | Shadowed (regex) | Intercepted at 8a severe neuro before the dictionary stage (0.7) is ever reached; resolves to neuro |
| `parkinsonism` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `pcl tear` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `pcod` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `pcos` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `peanut allergy` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `penicillin allergy` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `peptic ulcer` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `perfect health` | 0. life-stage firewall | Shadowed (firewall) | Intercepted at 0. life-stage firewall before the dictionary stage (0.7) is ever reached; resolves to NON_AILMENT (life-stage firewall) |
| `pericardial effusion` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `pericarditis` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `peripheral neuropathy` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `pertussis` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `pharyngitis` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `pheochromocytoma` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `pheochromocytoma tumor` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `phimosis` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `pih` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `piles` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `pilodinal sinus` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `pilonidal sinus` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `pituitary adenoma` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `pituitary adenoma gland` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `plantar fasciitis` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `plasmacytoma` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `platelet low` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `pleural effusion` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `pleural tuberculosis` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `pleurisy` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `pneumothorax` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `pollen allergy` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `polycystic ovarian syndrome` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `polycystic ovary disease` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `polycythemia` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `polycythemia vera` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `polymyalgia rheumatica` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `polymyositis` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `polyneuropathy` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `pompe disease genetic` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `porphyria` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `porphyria metabolic` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `portal hypertension` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `positive hiv test` | 0.5A test firewall | Shadowed (firewall) | Intercepted at 0.5A test firewall before the dictionary stage (0.7) is ever reached; resolves to FALLBACK (0.5A test firewall) |
| `post menopause` | 0. life-stage firewall | Shadowed (firewall) | Intercepted at 0. life-stage firewall before the dictionary stage (0.7) is ever reached; resolves to NON_AILMENT (life-stage firewall) |
| `postpartum recovery` | 0. life-stage firewall | Shadowed (firewall) | Intercepted at 0. life-stage firewall before the dictionary stage (0.7) is ever reached; resolves to NON_AILMENT (life-stage firewall) |
| `pott's disease` | 9.5a TB bone/spine | Shadowed (regex) | Intercepted at 9.5a TB bone/spine before the dictionary stage (0.7) is ever reached; resolves to musculoskeletal |
| `potts disease spine tb` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `pre-diabetic condition` | 5a prediabetes | Shadowed (regex) | Intercepted at 5a prediabetes before the dictionary stage (0.7) is ever reached; resolves to diabetes |
| `pre-eclampsia` | 0.7 dictionary | Reachable (via sibling/normalization) | Punctuation stripped from input never re-matches this literal key; resolves instead via a normalization-identical sibling key, landing on category "hypertension" |
| `preeclampsia` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `pregnancy induced hypertension` | 0. life-stage firewall | Shadowed (firewall) | Intercepted at 0. life-stage firewall before the dictionary stage (0.7) is ever reached; resolves to NON_AILMENT (life-stage firewall) |
| `pregnancy normal` | 0. life-stage firewall | Shadowed (firewall) | Intercepted at 0. life-stage firewall before the dictionary stage (0.7) is ever reached; resolves to NON_AILMENT (life-stage firewall) |
| `premature baby` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `presbyopia` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `preventative screening` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `prolactinoma` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `prolactinoma pituitary` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `prostate cancer` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `prostate cancer neoplasm` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `prostate disease` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `prostatectomy` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `prostatitis` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `prostatomegaly` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `proteinuria` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `pseudohypoparathyroidism` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `psoriasis` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `psoriatic arthritis joint` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `psychosis` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `ptca` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `pterygium` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `ptsd` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `puj obstruction` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `pulmonary embolism` | 0.5D DVT/PE | Shadowed (firewall) | Intercepted at 0.5D DVT/PE before the dictionary stage (0.7) is ever reached; resolves to FALLBACK (0.5D DVT/PE shield) |
| `pulmonary fibrosis` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `pulmonary regurgitation` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `pulmonary stenosis` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `pulmonary tuberculosis` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `pylori` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `ra` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `rabies` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `raynaud disease` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `raynaud phenomenon` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `rbbb` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `rcc` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `rcc kidney` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `reactive arthritis joint` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `reactive hypoglycemia` | 0.5C hypoglycaemia | Shadowed (firewall) | Intercepted at 0.5C hypoglycaemia before the dictionary stage (0.7) is ever reached; resolves to FALLBACK (0.5C hypoglycaemia shield) |
| `recreational drugs` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `rectal cancer` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `regular drinking` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `regular medication` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `regular period` | 0. life-stage firewall | Shadowed (firewall) | Intercepted at 0. life-stage firewall before the dictionary stage (0.7) is ever reached; resolves to NON_AILMENT (life-stage firewall) |
| `regular walking` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `reiter syndrome` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `renal calculi` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `renal calculus` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `renal cancer` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `renal cell carcinoma` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `renal failure` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `renal transplant history` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `renal tuberculosis` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `respiratory failure` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `restrictive cardiomyopathy` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `retinal detachment` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `retinopathy` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `rhabdomyosarcoma` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `rhabdomyosarcoma muscle` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `rhd` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `rheumatic fever` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `rheumatic heart disease` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `rheumatoid arthritis` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `ringworm` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `routine checkup` | 0. life-stage firewall | Shadowed (firewall) | Intercepted at 0. life-stage firewall before the dictionary stage (0.7) is ever reached; resolves to NON_AILMENT (life-stage firewall) |
| `routine mammogram` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `routine pap smear` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `routine physical` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `routine ultrasound` | 0.5A test firewall | Shadowed (firewall) | Intercepted at 0.5A test firewall before the dictionary stage (0.7) is ever reached; resolves to FALLBACK (0.5A test firewall) |
| `rum` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `salmonellosis` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `sarcoidosis` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `sarcoidosis lungs and lymph` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `sarcoidosis of lung` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `sarcoidosis systemic` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `sarcoma` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `sarcoma bones` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `scabies` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `scarlet fever` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `schistosomiasis` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `schizophrenia` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `schwannoma` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `schwanoma` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `sciatica` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `scleroderma skin` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `scoliosis` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `sebaceous cyst` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `secondary hypertension htn` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `seizure disorder` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `sensorineural hearing loss` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `shingles` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `shortness of breath` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `shoulder dislocation` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `siadh` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `sick sinus syndrome` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `sickle cell anemia` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `sinus surgery` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `sinusitis` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `sjogren syndrome` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `skeletal tuberculosis` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `sle nephritis` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `sleep apnea` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `sleep disorder` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `slipped disc` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `small cell lung cancer` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `smoker` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `smoker status` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `smoking tobacco` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `sob` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `social drinker` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `somatoform pain` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `spider veins` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `spina bifida` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `spinal cord injury` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `spinal cord tumor` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `spinal muscular atrophy` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `spinal muscular atrophy sma` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `spinal stenosis` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `spinal tuberculosis` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `spine deformity` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `spinocerebellar ataxia` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `spinocerebellar ataxia genetic` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `splenomegaly` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `squamous cell carcinoma` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `squamous cell carcinoma scc` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `squint` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `squint surgery` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `sss` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `stable angina` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `std profile` | 0.5A test firewall | Shadowed (firewall) | Intercepted at 0.5A test firewall before the dictionary stage (0.7) is ever reached; resolves to FALLBACK (0.5A test firewall) |
| `stitches` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `stomach cancer` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `strabismus` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `stress test abnormal` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `stroke` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `stye` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `subdural empyema` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `substance use` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `superficial thrombophlebitis` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `syndrome of inappropriate adh` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `syphilis infection` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `systemic lupus erythematosus` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `systemic vasculitis` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `tabes dorsalis` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `taeniasis` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `teratoma` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `testicular cyst` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `tetralogy of fallot` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `thalaseemia` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `thalassemia` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `thr` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `thrombocytopenia` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `thrombocytosis` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `thyroid cancer` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `thyroid disease` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `thyroid disorder` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `thyroidectomy` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `thyrotoxicosis` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `tia` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `tinnitus` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `tkr` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `tmt test positive` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `tobacco chewing` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `toddy` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `tonsilitis` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `tonsillectomy` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `tonsillitis` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `total hip replacement` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `total knee replacement` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `toxoplasmosis` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `transient ischemic attack` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `tricuspid regurgitation` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `tricuspid stenosis` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `trigeminal neuralgia` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `tsh` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `tuberculous lymphadenitis` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `tuberculous meningitis` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `tuberculous peritonitis` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `turner syndrome` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `turner syndrome genetic` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `tymnoplasty` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `tympanoplasty` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `type 1 diabetes mellitus` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `type 2 diabetes mellitus` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `typhoid` | 0.5B acute infectious | Shadowed (firewall) | Intercepted at 0.5B acute infectious before the dictionary stage (0.7) is ever reached; resolves to FALLBACK (0.5B acute infectious firewall) |
| `ulcerative colitis` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `umbilical hernia` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `unstable angina` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `ureteric stone` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `uric acid` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `urinary tract infection` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `uropithelial carcinoma` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `urticaria` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `uterine cancer` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `uterine fibroid` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `uterus removal` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `uti` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `uveitis` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `vaccination done` | 0. life-stage firewall | Shadowed (firewall) | Intercepted at 0. life-stage firewall before the dictionary stage (0.7) is ever reached; resolves to NON_AILMENT (life-stage firewall) |
| `vaping` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `varicocele` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `varicose vein` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `varicose veins` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `varicosity` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `vegetarian diet` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `venereal disease` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `venous insufficiency` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `ventricular fibrillation` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `ventricular septal defect` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `ventricular tachycardia` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `vertigo` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `vf` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `viral fever` | 0.5B acute infectious | Shadowed (firewall) | Intercepted at 0.5B acute infectious before the dictionary stage (0.7) is ever reached; resolves to FALLBACK (0.5B acute infectious firewall) |
| `vitamin b12 deficiency` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `vitamin d def` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `vitamin d deficiency` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `vitamin d low` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `vitamin defeciency` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `vitiligo` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `vocal cord nodule` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `vocal cord polyp` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `vodka` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `vomiting` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `von willebrand disease` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `vsd` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `vt` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `weed` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `weils disease` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `well balanced diet` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `wheezing` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `whiskey` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `whooping cough` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `wilson disease liver` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `wine` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `xanthelasma` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `yoga practitioner` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `zarda` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
| `zika virus` | 0.7 dictionary | Reachable | Exact normalized match against its own dictionary key (stage 5 / 0.7) |
