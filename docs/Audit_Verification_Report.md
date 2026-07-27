# Verification of the Production Consistency Audit
### Independent re-derivation from source — engine.ts, types.ts, regex_blocks.json, plan configs, MASTER_CONSTITUTION.md

**Method:** every claim in the prior audit is treated as an unproven hypothesis. Each finding below was re-traced from the current file contents (line numbers cited), not from the audit's narrative. Where MASTER_CONSTITUTION.md (v1.0, 2026-07-18, "Authoritative — approved baseline... supersedes and consolidates all prior governance material") speaks to a finding, its classification governs over both the audit's and my own instinct. Per its own instruction, I did not resolve any Part IX Business Decision — I flagged them instead.

One governance fact changes several verdicts below: **the prior audit did not have MASTER_CONSTITUTION.md or the superseded MAPPING_POLICY_CHARTER.md in evidence.** The Charter turns out to already contain a verbatim admission of the OSA issue (see Issue 1) — but the current Constitution deliberately downgraded that admission from "defect" to an unresolved **[BUSINESS]** item. That reclassification is binding here.

---

## Issue 1 — OSA / Sleep Apnea routing

### Mechanical trace (fully confirmed from source)

- `TOP_PED_DICTIONARY` (`src/types.ts:344-346`): `"sleep apnea"`, `"obstructive sleep apnea"`, `"osa"` → categoryKey **`genetic`**. Global — one entry, no plan qualifier, applies to all 6 plans equally.
- `engine.ts:418-430` — a `planName === "Activ Fit Preferred"` override block, which runs at **Constitution Part IV stage 2** (plan-specific overrides), intercepts OSA input for AFP *before* the dictionary stage ever runs, and routes it to AFP's `genetic` question with the explanation text *"maps to the congenital/genetic/disability question in this plan (which explicitly names Obstructive Sleep Apnea)."* This means **the global dictionary entry is never actually reached for AFP** — the override always fires first and returns. The dictionary entry is redundant for AFP, not load-bearing.
- `engine.ts:941` — inside the psychiatric regex section (stage 6, disease-family regex), the pattern explicitly includes `obstructive sleep apnea|sleep apnea|osa\b|sleep disorder`. This section would independently and correctly catch OSA for every plan **if it were ever reached** — but stage 5 (dictionary) precedes stage 6 (regex), per Constitution Part V ("Dictionary beats regex... a condition present as a dictionary key routes by its category even when a later regex would match it differently" — this is stated as [CURRENT], i.e. provable, intended pipeline behavior, not itself a defect).
- Net effect for the 5 non-AFP plans: OSA is intercepted at stage 5 by the global dictionary and sent to each plan's `genetic` question, and the correctly-targeted `psychiatric` regex at line 941 never runs.

### Per-plan resolution (verified directly from `getPlanConfig()`, `src/types.ts`)

| Plan | `genetic` question (where OSA currently routes) | `psychiatric` question (where wording-first logic would send it) | Source lines |
|---|---|---|---|
| Optima Secure | *"Any Blood disorder (example Anaemia, Haemophilia, Thalassaemia) or any genetic disorder?"* | *"Nervous, Psychiatric or Mental or **Sleep disorder**?"* | 1152-1155 |
| Care Supreme | *"Congenital Disorder?"* | *"Any Neuromuscular... or Psychiatric disorders (...mental illness)"* | 1213, 1217 |
| Activ One Max | *"Any other disease / health adversity / injury / condition / treatment not mentioned above."* — **identical, verbatim, to this plan's own `anyOther` field (line 1261)**, i.e. `genetic` has literally collapsed to the generic catch-all for this plan | *"Stroke/Paralysis/TIA/Multiple Sclerosis/Epilepsy/**Mental-Psychiatric illness**/Parkinsonism/Alzheimer's/Depression/Dementia..."* | 1287, 1273 |
| Activ Fit Preferred | *"Congenital / Birth defect / Genetic Disease / Physical deformity / Disability / Polio / **Obstructive sleep apnea** / Peripheral vascular disease"* — names OSA explicitly | *"Mental illness, Psychiatric / Psychological disorder"* | 1325, 1339 |
| Aspire | *"...genetic / hereditary disorders or HIV / AIDS?"* | *"...any mental/ psychiatric disorders?"* | 1391, 1393 |
| Reassure 2.0 | *"...genetic / hereditary disorders or HIV / AIDS?"* | *"...any mental/ psychiatric disorders?"* | 1440, 1442 |

Only Activ Fit Preferred's `genetic` question actually names OSA. For the other five, `genetic` is a congenital/hereditary/HIV question with no textual connection to sleep, while `psychiatric` explicitly or closely names sleep/mental illness.

### Governance verdict

`MASTER_CONSTITUTION.md` Part XV / Appendix H ("Known Exceptions") **documents the AFP override as an intentional, approved exception** — that part of current behavior is settled and correct, not a bug.

It does **not** document the global dictionary entry at all — only the AFP-specific override is in the register. The superseded `MAPPING_POLICY_CHARTER.md` (Part B, item B3, "Global dictionary entry vs plan-specific override") independently admits, verbatim: *"Sleep apnea was added both as an AFP override and as a global dictionary entry (→ genetic), so it overrides other plans too. Future authors have no guidance on when a mapping should be global vs plan-scoped."* — i.e., this exact configuration was already a known, named gap before this audit.

The current, authoritative Constitution took that exact gap and classified it as **Part IX, item 7 — Business Decision: "Global vs plan-specific placement... not consistently applied... Define a placement rule."** It is explicitly listed as **[BUSINESS]**, meaning: *"An area where production defines no single policy. Documented, never resolved here."* The Constitution's own AI-usage instruction is direct: *"Do not resolve Business Decisions. If a rule is not in here, it does not exist — surface the gap, don't fill it."*

**Verdict: ⚠ Business Decision Required — Part IX, item 7.** Not "Confirmed Production Bug." The mechanical routing is exactly as described (fully provable, [CURRENT]), and it does contradict the Constitution's own Core Principle III.1 ("wording-first routing... exact wording outranks category inference") for 5 of 6 plans *in spirit* — but the Constitution itself withholds a verdict on whether that contradiction should be resolved by changing the dictionary, adding 5 more plan-specific overrides, or leaving it as-is, because the underlying policy question (when does a mapping belong in the global dictionary vs. a plan override) is explicitly unresolved. Recommending a specific fix here would be resolving a Business Decision myself, which I am not authorized to do.

**Separately — a real Documentation Issue, distinct from the routing question itself:** Appendix H's Known Exceptions register lists the AFP override but omits that the same global dictionary key also determines behavior for the other 5 plans. Per the Regression Types table (Part XII), this is a **"Documentation" type regression** ("The Constitution no longer matches the engine") — the register should at minimum name the global dictionary entry as a second, related exception so a future reader isn't surprised by it. This part is unambiguous and doesn't require business input to fix (it's a documentation completeness gap, not a routing change).

---

## Issue 2 — Sciatica routing

### Mechanical trace (confirmed from source)

- `TOP_PED_DICTIONARY["sciatica"]` (`src/types.ts:497`) → categoryKey **`musculoskeletal`**. Single, unqualified, canonical assignment — production's own explicit determination for this term.
- `engine.ts:911-938`, section "8b. MILD / PERIPHERAL NEUROLOGICAL": contains the guard added earlier this session for spine-qualified radiculopathy (`isSpineRadiculopathy = /\b(cervical|lumbar|thoracic|spinal)\s+radiculopathy\b/i`). The guard is scoped **only** to the word "radiculopathy" with a spine qualifier immediately before it — it does **not** apply to "sciatica" in any form. The line-921 regex `/\b(migraine|carpal tunnel|sciatica|radiculopathy|...)\b/i` still contains the bare word `sciatica` unconditionally.
- `engine.ts:1098`, section "18. MUSCULOSKELETAL": the regex list (osteoarthritis, spondylitis, ..., cervical radiculopathy, ..., bone disease) was checked term-by-term — **`sciatica` is not present anywhere in this block.** This differs from the radiculopathy case, where regex_blocks.json's musculoskeletal block *did* explicitly list "cervical radiculopathy" (a self-contained piece of evidence that the term was intended for that section but was being shadowed — the actual bug that was fixed). For sciatica there is no equivalent "trapped" listing in the musculoskeletal regex; the dictionary is the *only* place production expresses a musculoskeletal intent for this term.

### Per-phrase resolution, traced through `classifyDeterministic`'s actual normalization (`cleanInput = text.replace(/[^\w\s]/g, "").trim()` then exact dictionary lookup, `engine.ts:598-600`)

| Input | Exact dictionary key? | Resolution |
|---|---|---|
| `Sciatica` | Yes — `cleanInputLower` = `"sciatica"`, exact match | Dictionary hit → **musculoskeletal** (correct) |
| `Sciatica pain` | No | Falls through to regex stage 6 → line 921 matches (`\bsciatica\b`) → routes to **psychiatric/neuro** |
| `Left sciatica` | No | Same as above → **psychiatric/neuro** |
| `Chronic sciatica` | No | Same as above → **psychiatric/neuro** |
| `Lumbar sciatica` | No | `isSpineRadiculopathy` test requires the literal word "radiculopathy" immediately after the spine qualifier — "lumbar sciatica" does not contain "radiculopathy," so the guard does not apply; line 921 still matches on `\bsciatica\b` → **psychiatric/neuro** |

Only the bare exact term resolves as production's own dictionary says it should; every tested qualified variant is shadowed by the earlier, broader neurological regex — the identical failure mode already fixed for radiculopathy, on the same clinical family (lumbosacral nerve-root compression), via the same execution-order mechanism (dictionary-only category assignment, contradicted by an earlier unqualified regex section that runs first on any non-exact phrasing).

### Governance verdict

Constitution Part V ("Undocumented-but-real") explicitly acknowledges this class of behavior exists: *"A canonical term and a qualified variant... can resolve at different stages; the engine does not guarantee a variant matches its canonical form."* And Part IX, item 6 ("Synonym-consistency enforcement... whether all synonyms of a condition must route identically") is listed as an unresolved [BUSINESS] item in general.

However, item 6 governs the *general policy question* (should the engine guarantee synonym consistency everywhere). It does not retroactively bless every individual instance of the pattern as intentional — and this specific instance has a direct, already-accepted precedent: the radiculopathy fix, approved this session, corrected the exact same mechanism for a clinically near-identical condition, on the strength of the dictionary's own category assignment plus the fact that no clinical/business rationale supports psychiatric/neuro routing for a nerve-root-compression diagnosis of spinal origin. Sciatica meets the same bar: `TOP_PED_DICTIONARY` (Evidence Hierarchy tier 4 — "existing dictionary/synonym/category behavior," Part VI) unambiguously says musculoskeletal, with nothing anywhere in the codebase contradicting that assignment for the canonical or qualified forms.

**Verdict: ✅ Confirmed Production Bug** — same class and same confidence tier as the already-fixed cervical radiculopathy issue. Four of five tested phrasings mis-route.
Caveat for the record: the *general* policy question of whether ALL synonym/qualifier consistency should be enforced engine-wide remains Business Decision #6 and is not resolved by this specific fix, exactly as the radiculopathy fix did not resolve it either — both are narrow, evidence-backed corrections, not a blanket policy adoption.

---

## Issue 3 — H. pylori

### Trace through the actual normalization and lookup code (`engine.ts:598-600`)

```
cleanInput = text.replace(/[^\w\s]/g, "").trim()   // strips periods, hyphens, etc. from USER INPUT
cleanInputLower = cleanInput.toLowerCase()
categoryKey = TOP_PED_DICTIONARY[cleanInputLower]   // exact-key lookup against UN-stripped keys
```

`TOP_PED_DICTIONARY` keys found by direct grep of `src/types.ts`: line 75 `"h. pylori": "digestive"` (retains the period), line 76 `"pylori": "digestive"`. No `"h pylori"` (no period) key exists anywhere in the dictionary. Grep of `regex_blocks.json` and every regex block in `engine.ts` (13. DIGESTIVE, `engine.ts:986`) confirms `pylori`/`helicobacter` appears in **no regex pattern anywhere** in the engine — the digestive regex covers gerd/ulcer/gastritis/ibs/etc. but never pylori.

| Input | `cleanInputLower` | Dictionary key exists? | Regex fallback? | Result |
|---|---|---|---|---|
| `H. pylori` | `"h pylori"` (period stripped) | No — actual key has a period, `"h. pylori"` ≠ `"h pylori"` | None | **No deterministic match → `null` → Gemini AI fallback** |
| `H pylori` | `"h pylori"` | No | None | **Same — AI fallback** |
| `Helicobacter pylori` | `"helicobacter pylori"` | No | None | **Same — AI fallback** |
| `Pylori` | `"pylori"` | **Yes** — exact match | — | Dictionary hit → **digestive** (works) |

Confirmed exactly: 3 of the 4 tested phrasings never reach a deterministic route, because the punctuation-stripping step is applied only to user input, never to the dictionary's own keys, so any key containing a period can only ever be matched by input that still contains that exact period in that exact position — which the normalization step itself prevents. The bare `"pylori"` entry does not rescue two-word input because dictionary lookup requires the full cleaned string to equal a key, not a substring/token match.

(The string `"h pylori"` visible in `engine.ts:1233` and `:1307` is not a dictionary key — it lives inside `getSmokeTestCases()`, a test-fixture generator, confirmed by reading the enclosing function signature at `engine.ts:1204`. It has no effect on runtime routing.)

### Governance verdict

No Part IX item touches dictionary-key reachability or input normalization — this isn't a competing-policy question, it's a mechanical defect: an entry that structurally can never be matched by any input that would normalize to trigger it, with zero downstream safety net. There's no framing under which this is "working as intended."

**Verdict: ✅ Confirmed Production Bug.** High confidence, narrow blast radius (affects only "H. pylori"/"H pylori"/"Helicobacter pylori" phrasing; bare "Pylori" already works).

---

## Issue 4 — Documentation category mismatches

Each term traced directly against `TOP_PED_DICTIONARY` and the relevant regex section, independent of the prior audit's narrative:

| Term | `TOP_PED_DICTIONARY` entry (types.ts) | Regex / special-case evidence | Verdict |
|---|---|---|---|
| Psoriasis | line 571: `"psoriasis": "autoimmune"` | `engine.ts:1104-1107` — inside the Skin regex section itself, an explicit special-case: `if (/\bpsoriasis\b/i.test(text))` routes to the autoimmune question ahead of the generic skin question, with reasoning text *"is a skin condition with autoimmune classification."* Two independent, agreeing signals (dictionary + a dedicated in-section carve-out) — this is deliberate, not accidental. Note: since psoriasis is also an exact dictionary key, the dictionary resolves it first in practice; the regex carve-out is a secondary/redundant safeguard for phrases that aren't exact dictionary matches (e.g. "psoriasis vulgaris"). | **Documentation Issue** — `Master_PED_Dictionary.md` files it under Skin; production is deliberately autoimmune-first. Doc should change. |
| Lipoma | line 224: `"lipoma": "benign_growth"` | Also appears in the Skin regex (`engine.ts:1104`) and the generic benign-growth shield (`engine.ts:1127`), but dictionary resolves first (stage 5 beats stage 6) | **Documentation Issue.** Doc should change. |
| Fibroadenoma | line 597: `"fibroadenoma": "benign_growth"` | No contradicting regex found | **Documentation Issue.** Doc should change. |
| Breast lump | line 595: `"breast lump": "benign_growth"` | — | **Documentation Issue.** Doc should change. |
| Breast cyst | line 594: `"breast cyst": "benign_growth"` | — | **Documentation Issue.** Doc should change. |
| Vocal cord nodule | line 232: `"vocal cord nodule": "benign_growth"` | ENT regex (`engine.ts:1120`) matches generic "vocal cord" but dictionary's exact multi-word key intercepts first | **Documentation Issue**, lower confidence — clinically this one is genuinely closer to a toss-up between ENT and benign-growth than the others, but production's assignment is deliberate (a specific 3-word dictionary key, not an accident of a broader pattern), so the doc should still be the one to change. |

(Sciatica is covered separately under Issue 2 as a routing bug, not a simple doc-vs-production category disagreement, since the *dictionary* already agrees with the doc's implied "should be a distinct/specific category" instinct — the actual problem is that non-exact phrasings don't reach it.)

**Verdict for all six: 📄 Documentation Issue.** In every case, production's assignment is backed by an explicit, findable dictionary entry (and in psoriasis's case, an additional dedicated code branch) — not a shadowing artifact or an accident of regex ordering. There is no execution-order defect here the way there is in Issues 2 and 3. The audit's original conclusion (doc should change, not production) holds up under independent re-verification.

---

## Issue 5 — Master_PED_Dictionary.md: what does it actually claim to be?

Its own header (lines 1-5): *"This document merges the current production dictionary with recommended additive entries. Existing entries are preserved. Improvements are additive only."*

This is an explicit self-description as **a full merge of the production dictionary, plus additions** — not a curated subset, not a "some examples" reference. Measured against that stated purpose, the doc covers 476 of 949 production entries (50%) across 30 of 33 categories, with `genetic` (36 entries), `hiv` (14), and `sarcoidosis` (3) entirely absent as headings.

**Verdict: 📄 Documentation Issue — confirmed, audit's criticism was not based on an incorrect assumption.** The document's own stated purpose is the full production dictionary plus extras; it does not deliver the "full production dictionary" half of that claim. If the intended purpose is actually narrower (a curated/expanded subset, not a full merge), the header itself needs to be corrected to say so — as written, it over-promises relative to what's inside.

---

## Issue 6 — Categorymap Regex.md: what was it actually meant to document?

Unlike the dictionary doc, `Categorymap Regex.md` carries **no header or scope statement at all** — it opens directly at "1. Diabetes" with no preamble. Its title and structure (27 numbered blocks, each named after a disease family: Diabetes, Hypertension, Musculoskeletal, Skin, Eye, ENT, etc.) map one-to-one against `regex_blocks.json`'s `ailment_classification_regexes` array — the block whose members each resolve to a `categoryKey` and then a plan question.

`regex_blocks.json`'s other four top-level blocks — `detect_supporting_flags_regexes`, `natural_life_stages_regexes`, `plan_overrides_guards`, `test_and_imaging_firewalls` — are structurally different in kind, not just in coverage: per Constitution Part IV, the life-stage firewall and safety shields resolve directly to `NON_AILMENT`/`FALLBACK` and **never touch the category system at all** (`categoryMap`/`categoryKey`). They are pre-category-resolution interceptors, not members of the "category map."

Given the document's own name — "**Categorymap** Regex" — and the fact that firewalls/guards conceptually sit outside the category-mapping mechanism entirely (they exist specifically to *avoid* categorization), it's a reasonable and arguably more natural reading that this document was always scoped to just the 48 `ailment_classification_regexes` blocks, not all five top-level blocks in `regex_blocks.json`.

**Verdict: the prior audit's criticism that this doc is "missing" the 4 non-ailment regex blocks (`detect_supporting_flags_regexes`, `natural_life_stages_regexes`, `plan_overrides_guards`, `test_and_imaging_firewalls`) is ❌ Audit Incorrect** — it assumed a broader intended scope than the document's own name and structure support. Firewalls/guards are a different conceptual layer and their omission is defensible, not a gap.

The other half of the original Part 2 finding stands independently: within its own scope (ailment-classification regex), the document still only covers 27 of the 48 actual `ailment_classification_regexes` categories in `regex_blocks.json` — missing `malignant_cancers`, `std_hpv_syphilis`, `dvt_pulmonary_embolism`, `gangrene`, and 17 others that unambiguously *are* ailment-classification categories, squarely inside whatever scope the document claims for itself. That portion remains a genuine **📄 Documentation Issue**, unaffected by the scope correction above.

---

## Issue 7 — Business Decision Review

Applying `MASTER_CONSTITUTION.md` Part IX directly to every production-facing recommendation surfaced by the original audit and by this re-verification:

| Original audit recommendation | Touches a Part IX item? | Verdict |
|---|---|---|
| Fix OSA global dictionary routing | Yes — item 7 (global vs plan-specific placement) | **⚠ Business Decision Required.** Do not implement without an owner decision on placement policy. |
| Fix sciatica non-exact-phrase routing | Arguably touches item 6 (synonym consistency) as a *general policy*, but this specific instance is resolvable on the same narrow evidentiary basis as the already-approved radiculopathy fix, without adopting a blanket synonym-consistency policy | **✅ Confirmed Production Bug** — narrow, evidence-backed fix; does not require resolving item 6 in general (see Issue 2 caveat). |
| Fix "H. pylori" dictionary/normalization gap | No Part IX item touches input normalization or key reachability | **✅ Confirmed Production Bug** — no business decision required. |
| Re-file psoriasis/lipoma/fibroadenoma/breast lump/breast cyst/vocal cord nodule in the docs | Documentation-only; doesn't touch production | **📄 Documentation Issue** — no business decision required (nothing in production changes). |
| Remove duplicate dead guard blocks in `engine.ts` (0.5A/0.6 etc., from the original audit's Part 2.5) | No Part IX item; Part VIII invariant 3 ("no silent routing changes") requires a regression diff even for no-op cleanup | **✅ Confirmed (cosmetic) — low priority**, regression diff still required per Part VIII before merging, but not a business decision. |
| Treat `cystic fibrosis` respiratory/genetic collision as something to fix | Touches item 2 (multi-family conditions, resolved by section order) | **⚠ Business Decision Required** if a change is proposed; current behavior (respiratory wins) is defensible as-is and this audit does not recommend changing it. |

---

## Regression Analysis (Zero Regression Audit) — confirmed bugs only

### Sciatica (Issue 2)

- **Existing behavior:** exact "Sciatica" → musculoskeletal (correct). Any qualified phrasing ("sciatica pain," "left/chronic/lumbar sciatica," and by the same mechanism any other modifier) → psychiatric or neuro, depending on whether the plan's psychiatric question wording contains "nervous" (`engine.ts:925`).
- **Reason it exists:** `TOP_PED_DICTIONARY` only performs exact whole-string matches; the mild/peripheral-neurological regex (`engine.ts:921`) runs before the musculoskeletal regex (`engine.ts:1098`) in section order, and was never given a spine-qualifier-style exclusion for "sciatica" the way "radiculopathy" was.
- **Possible collisions:** none identified — "sciatica" does not appear in any other regex section, firewall, or plan override.
- **Possible regressions:** none for the exact-match case (untouched by any fix scoped to qualified phrasings only). A fix narrowly scoped the same way as the radiculopathy guard (exclude qualified "sciatica" phrasings from section 8b, let them fall through to section 18) would not change the exact-match path at all.
- **Plans affected:** all 6 (this is a global regex/dictionary issue, not plan-specific).
- **Questions affected:** psychiatric/neuro question (currently over-receiving) vs. musculoskeletal question (under-receiving) on every plan.
- **Dictionary impact:** none — the dictionary entry is already correct and untouched by a fix.
- **Regex impact:** requires either adding "sciatica" to the musculoskeletal regex block (`engine.ts:1098` / `regex_blocks.json`) or extending the existing spine-qualifier-style guard in section 8b to also exclude sciatica phrasings.
- **Confidence:** High.

### H. pylori (Issue 3)

- **Existing behavior:** "Pylori" alone resolves deterministically (digestive); "H. pylori," "H pylori," and "Helicobacter pylori" all fall through to the Gemini AI fallback (`classifyDeterministic` returns `null`).
- **Reason it exists:** user-input normalization strips punctuation before dictionary lookup; the dictionary key `"h. pylori"` retains its period and is therefore unreachable by any normalized input.
- **Possible collisions:** none — no other dictionary key or regex touches "pylori"/"helicobacter" in any form.
- **Possible regressions:** none identified for a fix that either (a) adds a punctuation-free key `"h pylori"` to the dictionary, or (b) adds a `pylori` regex fallback to the digestive section — both are additive and don't touch any existing key or match.
- **Plans affected:** all 6 (global dictionary issue).
- **Questions affected:** digestive question (currently under-receiving for 3 of 4 phrasings; those cases go to AI fallback instead).
- **Dictionary impact:** would add one new key (or normalize the existing one).
- **Regex impact:** optional additional safety net in the digestive regex block.
- **Confidence:** High on the defect; Medium on priority (real-world frequency of the "H. pylori"-with-punctuation phrasing versus bare "Pylori" was not available to this audit).

---

## Final Report

| Finding | Status | Evidence | Confidence |
|---|---|---|---|
| Issue 1 — OSA/sleep apnea globally routes to `genetic` instead of `psychiatric` for 5 of 6 plans | **Business Decision Required** | `types.ts:344-346` (global dictionary entry) vs. `engine.ts:941` (psychiatric regex, never reached due to dictionary precedence, Part V); AFP override at `engine.ts:418-430` is separately confirmed correct and already documented in Constitution Part XV/Appendix H; the global-entry question is Constitution Part IX item 7, and `MAPPING_POLICY_CHARTER.md` B3 independently admits the exact gap | High (mechanism); N/A (resolution requires owner decision) |
| Issue 1b — Known Exceptions register omits the global dictionary entry's effect on 5 plans | **Documentation Issue** | Constitution Appendix H lists only the AFP override, not the global key's cross-plan effect; Part XII "Documentation" regression type | High |
| Issue 2 — Sciatica mis-routes to psychiatric/neuro for all non-exact phrasings | **Confirmed Production Bug** | `types.ts:497` (dictionary → musculoskeletal) vs. `engine.ts:911-938` (unguarded bare-word regex match) vs. `engine.ts:1098` (musculoskeletal regex, never reached); same execution-order class as the already-fixed cervical radiculopathy defect | High |
| Issue 3 — "H. pylori"/"H pylori"/"Helicobacter pylori" never resolve deterministically | **Confirmed Production Bug** | `engine.ts:598-600` (punctuation stripped from input only) vs. `types.ts:75` (key retains punctuation); confirmed no regex fallback anywhere in `engine.ts` or `regex_blocks.json` | High |
| Issue 4 — Psoriasis/lipoma/fibroadenoma/breast lump/breast cyst/vocal cord nodule doc-vs-production category mismatch | **Documentation Issue** (all six) | Each traced to an explicit, deliberate `TOP_PED_DICTIONARY` entry, with psoriasis additionally backed by a dedicated code branch at `engine.ts:1104-1107` | High (first five); Medium (vocal cord nodule — closer clinical call) |
| Issue 5 — Master_PED_Dictionary.md incompleteness relative to its stated purpose | **Documentation Issue** | Doc's own header claims a full production merge; measured coverage is 50% of entries, 3 categories entirely absent | High |
| Issue 6a — Categorymap Regex.md "missing" 4 non-ailment regex blocks (firewalls/guards) | **Audit Incorrect** | These blocks resolve outside the category system entirely (`NON_AILMENT`/`FALLBACK`, no `categoryKey`); document's name and structure indicate it was scoped to ailment-classification regex only | Medium-High |
| Issue 6b — Categorymap Regex.md missing 21 of 48 *ailment-classification* categories (within its own scope) | **Documentation Issue** | `malignant_cancers`, `std_hpv_syphilis`, `dvt_pulmonary_embolism`, `gangrene`, and 17 others are unambiguously ailment-classification categories absent from the doc | High |
| Issue 7 — Removing duplicate dead guard blocks in `engine.ts` | **Needs Further Review** | Zero behavioral impact confirmed, but Constitution Part VIII invariant 3 requires a regression diff for any change, even a no-op cleanup — not evaluated against the current baseline snapshot suite in this audit | Medium |
| `cystic fibrosis` respiratory-vs-genetic regex collision | **Business Decision Required** (only if a change is proposed) | Constitution Part IX item 2 (multi-family conditions, resolved by section order only); current behavior is defensible and not recommended for change here | N/A |

No files were changed. No documentation was changed. This report is evidence only, per the request.
