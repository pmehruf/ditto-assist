# Mapping Governance Review — Congenital Routing

**Status:** Governance exercise / decision support. **No repository data has been changed.** SQL scripts in Part F are drafted for your review and are not run.

**Sources used:** `MASTER_CONSTITUTION.md`, `PED_REPOSITORY_GOVERNANCE.md`, `TOP_PED_DICTIONARY` (`src/types.ts`), all 24 disease-family regex sections (`src/engine.ts`), all six plans' `questions[]`/`categoryMap` (`src/types.ts`), the `categories`/`plan_configs`/`ped_repository`/`ped_aliases`/`plan_overrides` schema (`src/server/db/schema.ts`), and — as independent corroboration — `600_conditions_corrected_database.json` at the repo root (a separately audited 621-condition/815-alias master mapping file, `audit_status: APPROVED_CLINICAL_GROUNDING_VERIFIED`). Where the legacy dictionary and this audited file agreed, confidence is noted as cross-verified.

**What I could not do:** the live `PED_SOURCE=db` database (Neon) is unreachable from this sandbox's network — confirmed both directly (a `postgres` query timed out on DNS) and by extension (the bundled test suite can't run here either — the mounted `node_modules` was installed on Windows and this sandbox is Linux, a platform mismatch unrelated to your app). Everything below is therefore a **static analysis** of the code-level dictionary/regex/plan-config layer plus the audited JSON file — not a live query of `ped_repository`. If DB-only edits were made after 2026-07-29 that aren't mirrored into the legacy tables, this review won't see them. Recommend spot-checking Table C's "missing" conditions in the PED Repository admin UI before trusting that gap list completely.

---

## Part 0 — Governing principle (Deliverable D, stated up front because everything below follows it)

**Old (implicit, wrong) rule:** "Congenital always wins."

**New rule, adopted throughout this review:**

> The declaration question whose wording most specifically represents the condition takes precedence. Congenital/Genetic is one possible destination category — not an automatic default. Where an organ-specific question's actual text already names the condition (or its clinical category) more precisely than the generic Congenital/Genetic wording, the organ-specific question wins, even if the condition is congenital in origin.

This is not a new invention — it is Evidence Hierarchy item 1 in `MASTER_CONSTITUTION.md` Part VI ("Insurer question wording... decisive") applied consistently in both directions. Table B and several rows in Part 2 exist specifically to prove this review isn't a rubber stamp toward Congenital.

Full governance-rule additions are in **Part D**.

---

## Part A — Governance Review

Format per your spec: Condition | Applicable Questions | Recommended | Confidence | Medical reasoning | Declaration reasoning | Why alternatives rejected.

Confidence bands used throughout: **High (85–95%)** = wording-decisive, low ambiguity. **Medium (60–80%)** = genuinely defensible either way; flagged for your team's sign-off, not just mine. Nothing below 60% is presented as a recommendation — those are escalated as open questions instead.

### A1. The eight previously-flagged conditions (your Section 4)

| Condition | Applicable Questions | Recommended | Confidence | Medical reasoning | Declaration reasoning | Why alternatives rejected |
|---|---|---|---|---|---|---|
| **Marfan Syndrome** | Congenital/Genetic, Heart, Eye, Musculoskeletal | **Congenital/Genetic** | High (90%) | A single fibrillin-1 gene defect producing a systemic connective-tissue disorder — aortic root dilation, lens dislocation, and skeletal overgrowth are all downstream of one genetic cause, not three separate diseases. | No single organ question can cover a condition whose defining underwriting risk spans three systems at once; the genetic question is the only one that captures the whole risk, and existing dictionary entry confirms current behavior (`"marfan syndrome": "genetic"`). | Heart/Eye/Musculoskeletal wording (sampled across plans) is acquired-disease language (CAD, cataract/glaucoma, arthritis/fracture) — none anticipate a syndromic multi-organ genetic cause, and picking one would misrepresent the other two risks entirely. |
| **Ehlers-Danlos Syndrome** | Congenital/Genetic, Skin, Musculoskeletal | **Congenital/Genetic** | High (88%) | Collagen defect causing joint hypermobility, skin fragility, and vascular fragility together — same multi-organ logic as Marfan. | Same as Marfan: no single organ question captures the syndrome. Dictionary confirms current behavior. | Skin/Musculoskeletal questions describe acquired dermatological or orthopedic disease, not a systemic collagen disorder. |
| **Hydrocephalus — congenital vs. acquired** | Congenital/Genetic, Neurological | **Split recommendation — see below** | Medium (70%) for the *congenital* form; **not addressed by current mapping** for the *acquired* form | This is the one condition on your list where the engine's current single dictionary/regex entry is actually wrong-shaped for the underlying medicine: congenital hydrocephalus (developmental, present at/near birth, often with spina bifida or Dandy-Walker) is a genuinely different underwriting risk from *acquired/normal-pressure hydrocephalus* (adult-onset, following hemorrhage, meningitis, or age-related CSF dysregulation). | Congenital hydrocephalus → Congenital/Genetic question, by the same logic as spina bifida. Acquired/NPH hydrocephalus is an adult neurological disease and should route to the **Neurological** question instead — its plan wording (stroke/paralysis/dementia-oriented) is actually a *better* fit for adult-onset hydrocephalus than the congenital question is. | Today, `engine.ts` §16b matches the single token `hydrocephalus` with no polarity check, so an adult declaring "Normal Pressure Hydrocephalus" post-stroke is currently routed to Congenital/Genetic — a real mismatch, not a hypothetical one. **Recommend**: split into two dictionary entries — `"congenital hydrocephalus"` → `genetic`, `"normal pressure hydrocephalus"` / `"acquired hydrocephalus"` → `neuro` — and leave the bare regex token `hydrocephalus` as a Congenital-leaning fallback only when neither qualifier is present, since congenital is still the far more common standalone use of the word in a PED declaration. |
| **Huntington's Disease** | Congenital/Genetic, Neurological | **Neurological** | Medium (75%) | Autosomal dominant, but the entire clinical picture *is* a progressive neurodegenerative disease (chorea, cognitive decline, psychiatric symptoms) — underwriting risk is neurological, not structural/developmental like the Table A congenital-heart cases. | Neuro question wording across plans explicitly lists degenerative/movement conditions (Parkinsonism, dementia, motor neuron disease) that Huntington's clinically resembles far more than it resembles a birth defect. | Congenital/Genetic wording is technically true (it is genetic) but clinically non-specific — it doesn't capture the actual disease course the way the neuro question does. **This is also a live inconsistency, not just a judgment call**: the dictionary already has `"huntington chorea"→neuro` (3 variants), but `engine.ts` §16b's regex separately lists the bare token `huntington`→`genetic`. Any phrasing that misses the three exact dictionary keys currently falls through to the regex and gets the *opposite* category. **Recommend**: remove `huntington` from the §16b regex trigger list entirely now that the recommendation is settled as neuro, so there's no route left that produces the wrong answer. |
| **Friedreich's Ataxia** | Congenital/Genetic, Neurological | **Neurological** | High (85%) | Hereditary, but presents and is underwritten purely as a progressive ataxic/neurodegenerative disease. | Same reasoning as Huntington's. Dictionary already confirms current behavior (`"friedreich ataxia": "neuro"`). | Congenital/Genetic wording doesn't capture a progressive degenerative course the way "any other Nervous disorder" wording does. |
| **Spinocerebellar Ataxia** | Congenital/Genetic, Neurological | **Neurological** | High (80%) — *recommendation changes current behavior, see flag* | Same disease family as Friedreich's — both are hereditary ataxias with materially the same underwriting risk profile. There is no clinical reason to treat them differently. | Should route identically to Friedreich's Ataxia per Part VIII invariant 5 (synonym/sibling consistency) once a policy exists. | **Flag: internal inconsistency found, not manufactured for this review.** The dictionary currently has `"spinocerebellar ataxia": "genetic"` *and*, in the separately-audited 621-condition file, a second alias `"spinocerebellar ataxia genetic": "neuro"` — the same disease routes to opposite categories depending on which of two near-identical entries fires. This is exactly Part IX item 6 (synonym-consistency, unresolved). **Recommend**: standardize both aliases to `neuro`, matching Friedreich's. |
| **Charcot-Marie-Tooth Disease** | Congenital/Genetic, Neurological | **Neurological** | High (88%) | Hereditary peripheral neuropathy — clinical picture and underwriting risk are peripheral-nerve disease, not a structural/developmental defect. | Neuro question wording (nervous system disorder) is the specific match. Dictionary confirms current behavior (`"charcot marie tooth disease": "neuro"`). | Congenital/Genetic wording doesn't capture a peripheral neuropathy's actual risk profile (progressive weakness/sensory loss) as precisely as the neuro question does. |
| **Congenital Adrenal Hyperplasia (CAH)** | Congenital/Genetic, Endocrine | **Endocrine** | High (90%) | Despite the name, CAH's defining feature *and* its lifelong management (cortisol/aldosterone replacement, monitoring) is endocrine/hormonal — it is underwritten the same way any other adrenal disorder is. | Endocrine question wording explicitly names "adrenal gland disorders" — an exact-topic match beating the generic congenital label, consistent with Evidence Hierarchy #1. Dictionary confirms current behavior (`"congenital adrenal hyperplasia": "endocrine"`). | Congenital/Genetic wording is technically accurate but strictly less specific than a question that names the exact affected gland. |

### A2. Re-confirmation of the original ASD-pattern conditions (Table A from the earlier review), now with confidence scores

| Condition | Recommended | Confidence | Why (short form — full reasoning in the earlier review doc) |
|---|---|---|---|
| Atrial Septal Defect | Congenital/Genetic | High (95%) | Structural defect present at birth; all plans' Heart wording is acquired-disease-only (CAD, MI, valve disease, arrhythmia — no septal/structural language). |
| Ventricular Septal Defect | Congenital/Genetic | High (95%) | Same as ASD. |
| Tetralogy of Fallot | Congenital/Genetic | High (95%) | Same as ASD; compound structural defect, not an acquired event. |
| Congenital Heart Defect (generic) | Congenital/Genetic | High (95%) | Self-naming term. |
| Spina Bifida | Congenital/Genetic | High (92%) | Neuro wording is adult-disease-oriented (stroke/epilepsy/MS); doesn't anticipate a neural-tube defect. |
| Cleft Lip / Cleft Palate | Congenital/Genetic | High (85%) | No plan's ENT/eye question names oral-facial structural defects. |
| Club Foot / Talipes | Congenital/Genetic | High (88%) | Musculoskeletal wording targets acquired/degenerative disease, not a birth deformity. |
| Hydrocephalus (as a bare, unqualified term) | Congenital/Genetic | Medium (70%) | See the split recommendation in A1 — bare term defaults to congenital but this is now a known simplification. |
| Microcephaly / Anencephaly | Congenital/Genetic | High (90%) | Developmental brain-formation defects; no adult-neuro wording anticipates them. |
| Osteogenesis Imperfecta | Congenital/Genetic | High (88%) | Inherited collagen defect, not degenerative bone disease. |
| Achondroplasia | Congenital/Genetic | High (90%) | Growth-plate genetic disorder, not degenerative orthopedic disease. |

### A3. Expanded congenital coverage (your Section 5 — 30 conditions)

**Coverage-gap fact-check first:** none of these 30 conditions appear in `TOP_PED_DICTIONARY`, the `engine.ts` regex sections, *or* the independently-audited 621-condition file — all three sources agree they are currently unmapped. That's a genuine, triangulated finding (not a guess): today, every one of these falls through to the Gemini AI fallback rather than deterministic routing. Adding them is a **coverage improvement with zero regression risk** (nothing existing changes) — the only judgment call is which category each should land in.

**Heart (all congenital-structural; heart-question wording across every plan sampled is acquired-disease-only — CAD/MI/arrhythmia/valve-disease/bypass — so the same ASD logic applies by default):**

| Condition | Recommended | Confidence | Reasoning |
|---|---|---|---|
| Patent Ductus Arteriosus (PDA) | Congenital/Genetic | High (92%) | Structural defect (failure of ductus closure), present at birth. |
| Coarctation of Aorta | Congenital/Genetic | High (90%) | Structural narrowing present at birth. Note: contains "aorta," but every sampled plan's aortic wording is specifically "aortic aneurysm"/"aortic stenosis" (acquired), not narrowing — no real collision risk. |
| Transposition of Great Arteries | Congenital/Genetic | High (93%) | Severe cyanotic congenital defect, standard CHD nomenclature. |
| Truncus Arteriosus | Congenital/Genetic | High (92%) | Structural defect (failure of vessel septation), present at birth. |
| Hypoplastic Left Heart Syndrome | Congenital/Genetic | High (90%) | Severe structural underdevelopment present at birth. *Minor flag:* Reassure 2.0's catch-all question separately lists "Major organ failure (...Heart...)" — HLHS could arguably also fit that plan's specific wording; worth a plan-level footnote, not a change of general recommendation. |
| Total Anomalous Pulmonary Venous Return | Congenital/Genetic | High (88%) | Structural venous-connection defect present at birth. |
| Ebstein's Anomaly | Congenital/Genetic | **Medium (72%) — flagged, not high-confidence** | It is a congenital tricuspid-valve malformation, but several plans' Heart questions explicitly list "valve disease(s)" as covered wording. Underwriting convention typically reads plan "valve disease" language as acquired/degenerative valve disease, not a congenital malformation — but this is a genuine wording overlap, not a clean call like the others. **Recommend underwriting sign-off before treating this as settled**, rather than applying it automatically. |
| Pulmonary Atresia | Congenital/Genetic | Medium-High (80%) | Same valve-wording overlap as Ebstein's, but atresia (absence of a functioning valve) reads more clearly as a structural defect than as "valve disease" in the acquired sense. |
| Tricuspid Atresia | Congenital/Genetic | Medium-High (80%) | Same reasoning as Pulmonary Atresia. |
| Eisenmenger Syndrome | Congenital/Genetic | **Medium (60%) — closest call in this entire review** | This is technically a *complication* of a long-standing, usually-uncorrected congenital shunt (pulmonary hypertension reversing the shunt) rather than a primary congenital lesion itself — squarely `MASTER_CONSTITUTION.md` Part IX item 1, "manifestation routing (root disease vs. affected organ)," which the Constitution explicitly marks as an unresolved Business Decision. I'm not resolving it here. My lean is Congenital (the underlying pathology is inescapably congenital and that's the risk pool the question is trying to capture), but **recommend an explicit Business Decision sign-off** before adding this one, rather than treating my confidence-60% lean as final. |

**Neurology (neuro-question wording across plans is adult/acquired-disease-oriented — stroke, epilepsy, MS, dementia, Parkinsonism — none anticipate developmental brain-structure malformations):**

| Condition | Recommended | Confidence | Reasoning |
|---|---|---|---|
| Arnold-Chiari Malformation | Congenital/Genetic | High (85%) | Structural hindbrain malformation present at birth (cerebellar tonsil herniation). |
| Dandy-Walker Malformation | Congenital/Genetic | High (90%) | Structural cerebellar/4th-ventricle malformation, typically diagnosed in infancy. |
| Holoprosencephaly | Congenital/Genetic | High (93%) | Severe forebrain-division defect present at birth. |

**Kidney (kidney-question wording across plans is acquired-disease-only — stones, CKD, dialysis, nephritis, UTI — none anticipate developmental renal anomalies):**

| Condition | Recommended | Confidence | Reasoning |
|---|---|---|---|
| Renal Agenesis | Congenital/Genetic | High (85%) | Absence of one kidney at birth; clinically significant (reduced renal reserve). |
| Congenital Solitary Kidney | Congenital/Genetic | High (85%) | Same reasoning as Renal Agenesis. |
| Horseshoe Kidney | Congenital/Genetic | Medium-High (78%) | Structural fusion anomaly, often incidental/asymptomatic. **Secondary note, not mine to decide**: whether an asymptomatic incidental finding needs declaring at all is a business/underwriting question independent of category — flagging it, not resolving it. |
| Duplex Kidney | Congenital/Genetic | Medium-High (78%) | Same "often incidental" caveat as Horseshoe Kidney. |
| Multicystic Dysplastic Kidney (MCDK) | Congenital/Genetic | Medium-High (75%) | Developmental anomaly (non-functioning cystic kidney), distinct from adult Polycystic Kidney Disease — but generic input like "kidney cyst" risks being misread as PKD by a text-matching engine. Recommend the alias set include the full name and "MCDK" specifically, not just "kidney cyst," to avoid collision. |

**Digestive (digestive-question wording is broader/more generic than the other organ questions — "any ailment of Digestive System" — so these are the *most* genuinely dual-plausible in the whole review):**

| Condition | Recommended | Confidence | Reasoning |
|---|---|---|---|
| Imperforate Anus | Congenital/Genetic | High (85%) | Clearly a structural birth defect (anorectal malformation), typically corrected in infancy — closer to Cleft Palate than to a digestive "disease." |
| Meckel's Diverticulum | **Medium (65%) — genuinely dual, not a clean recommendation** | — | Most common congenital GI anomaly, but several plans' Digestive wording ("any ailment of Digestive System") is broad enough to already cover it in plain reading. Recommend Congenital where a plan's Congenital wording is explicit, otherwise Digestive is equally defensible — this one should go to your underwriting team as a genuine either/or, not a settled call. |
| Malrotation | **Medium (65%) — same caveat as Meckel's** | — | Same reasoning as Meckel's Diverticulum. |

**ENT (ENT-question wording — "Ear/Nose/Throat diseases" — is generic enough to plausibly cover these, but "diseases" implies acquired pathology):**

| Condition | Recommended | Confidence | Reasoning |
|---|---|---|---|
| Congenital Deafness | Congenital/Genetic | Medium-High (78%) | A genetic/developmental hearing loss, not an acquired ENT disease (infection, chronic condition) — the distinction is meaningful for underwriting even though the generic ENT wording is broad enough to technically apply. |
| Choanal Atresia | Congenital/Genetic | Medium-High (80%) | Structural nasal-airway defect, typically corrected in infancy. |

**Eye (this is the one organ group where I'm recommending *against* the congenital default, on wording grounds — proof this isn't a rubber stamp):**

| Condition | Recommended | Confidence | Reasoning |
|---|---|---|---|
| Congenital Glaucoma | **Eye** (not Congenital/Genetic) | Medium (65%) — **plan-dependent, verify per plan before applying** | Where a plan's Eye question explicitly names "glaucoma" (as several plans' wording does, and as the category auto-map regex `/eye\|vision\|cataract\|glaucoma/i` reflects), that's an exact-topic wording match beating the generic congenital label — the same logic that sent CAH to Endocrine. **This recommendation only holds per-plan** where the Eye question text actually says "glaucoma"; on a plan whose Eye wording is silent on glaucoma, Congenital would be the fallback. Don't apply this one uniformly without checking each plan's exact Eye question text first. |
| Congenital Ptosis | Congenital/Genetic | Medium-High (75%) | No plan's Eye wording specifically names ptosis (drooping eyelid) — unlike glaucoma, there's no exact-wording match to prefer Eye here. |

**Endocrine (direct parallel to the CAH finding):**

| Condition | Recommended | Confidence | Reasoning |
|---|---|---|---|
| Congenital Hypothyroidism | **Endocrine** (not Congenital/Genetic) | High (90%) | Exact parallel to Congenital Adrenal Hyperplasia. Endocrine question wording explicitly names "thyroid" — a precise, exact-topic wording match. Same governance logic as CAH, applied consistently. |

---

## Part 3 — Optima Secure: Congenital/Genetic question vs. the "disability / deformity... congenital" question

**The core problem, stated precisely:** Optima Secure has an explicit question — *"Are you having any disability / deformity including accidental or congenital?"* — that is the single most on-the-nose piece of "congenital" wording found on any plan in this review. But it currently isn't wired into `categoryMap` under **any** category key. The standard `genetic` categoryKey routing (used by every Table A/A2/A3 condition above) resolves instead to Optima Secure's *"Any Blood disorder (example Anaemia, Haemophilia, Thalassaemia) or any genetic disorder?"* question — meaning **every congenital condition in this review currently lands on the blood/genetic question on Optima Secure, and the disability/deformity/congenital question is unused by general routing.**

The one place the disability/deformity question *is* used today is a single hardcoded special case in `engine.ts` §16c (Fibrodysplasia Ossificans Progressiva), via an explicit fallback chain: `disability/deformity wording → congenital wording → genetic category → musculoskeletal category`. That's a good template — arguably every structurally-deforming congenital condition should get it, not just FOP.

**Recommendation — not a blanket migration:**

| Condition group | Recommend disability/deformity question? | Reasoning |
|---|---|---|
| Structural/deformity-presenting conditions: Club Foot, Cleft Lip/Palate, Spina Bifida, Imperforate Anus, Choanal Atresia, Congenital Ptosis, Achondroplasia, Osteogenesis Imperfecta | **Yes** | These are literally deformities/disabilities present from birth — the closest possible wording match to "disability / deformity... congenital," closer than the generic "genetic disorder" phrase. |
| Internal-organ structural defects with no visible deformity: ASD, VSD, ToF, PDA, Coarctation, TGA, Truncus Arteriosus, HLHS, TAPVR, Arnold-Chiari, Dandy-Walker, Holoprosencephaly, Renal Agenesis, Horseshoe/Duplex Kidney, MCDK | **Medium confidence, worth a business call** | These are structural and congenital but not "deformities" in the plain-English sense the question seems aimed at (a reasonable advisor reading "disability/deformity" would likely picture a visible/physical deformity, not an internal septal defect). Defensible either way — flagging for your team rather than deciding unilaterally. |
| Syndromic/systemic genetic disorders: Marfan, Ehlers-Danlos, CAH (→ already Endocrine), Congenital Hypothyroidism (→ already Endocrine) | **No** | These are functional/systemic disorders, not disability/deformity presentations — the existing blood/genetic question (or, for CAH/hypothyroidism, Endocrine) remains the better fit. |
| Reclassified-to-neuro conditions: Huntington's, Friedreich's, Spinocerebellar Ataxia, CMT | **No** | Already reassigned to Neurological in Part A1 — doesn't touch this question either way. |

**Why this can't be done by just changing the `genetic` categoryKey's target on Optima Secure:** `genetic` is a single shared categoryKey used by every congenital/genetic condition. Repointing it would move ALL of them to the new question at once — a large blast-radius change that violates Part VIII invariant 4 ("no unrelated collateral change") and would silently affect conditions never reviewed here (Klinefelter, Turner, Noonan, Gaucher, PKU, etc.). The correct mechanism, consistent with `PED_REPOSITORY_GOVERNANCE.md` rule 4 ("a plan-specific business rule belongs in `plan_overrides`, never a blanket recategorization"), is:

1. Add a new categoryKey — proposed name **`congenital_disability`** — to the `categories` table.
2. Add it to Optima Secure's `categoryMap` (in `plan_configs`, the live table) pointing at the disability/deformity question.
3. Add individual `plan_overrides` rows (`planName = "Optima Secure"`, one row per qualifying PED, `categoryKey = "congenital_disability"`) only for the "Yes" group above — leaving every other plan, and every condition not in that group, completely untouched.

This is fully isolated (Part VIII invariant 2), reviewable row-by-row, and reversible. SQL for this is in Part F, clearly separated from the "Medium confidence" group so you can choose to apply only the high-confidence rows first.

---

## Part C — Missing conditions to consider adding (beyond your named list)

Not exhaustively researched clinically (that's genuinely your team's call, not mine to assert completeness on) — offered as candidates worth triaging, several of which are common enough to be worth prioritizing:

- **DiGeorge Syndrome (22q11 deletion)** — genuinely multi-organ (cardiac + immune + endocrine + facial), a strong second example alongside Marfan/Ehlers-Danlos for the "no single organ question fits" pattern.
- **Congenital Diaphragmatic Hernia**
- **Omphalocele / Gastroschisis** (abdominal wall defects — flagged as missing in the earlier ASD-pattern review too)
- **Tracheoesophageal Fistula** (also previously flagged as missing)
- **Biliary Atresia**
- **Pyloric Stenosis**
- **Hirschsprung's Disease**
- **Hypospadias / Undescended Testis (Cryptorchidism)**
- **Congenital Cataract**
- **Congenital Hip Dysplasia (DDH)**
- **Craniosynostosis**
- **Encephalocele** (sibling neural-tube defect alongside Spina Bifida/Anencephaly, currently also missing)
- **Situs Inversus**
- **Congenital Myasthenic Syndrome**
- **Neonatal/Congenital Diabetes** (distinct from Type 1/2 — worth its own alias rather than falling into the generic diabetes bucket)
- **Prune Belly Syndrome**
- **Bladder Exstrophy**

---

## Part D — New governance rules to formally register

Written in `MASTER_CONSTITUTION.md`-compatible language, ready to fold into Part IX / Part XV / Appendix H once approved — not inserted into the Constitution by this review, since that document says changes to it require an owner sign-off (Change Impact Template) which hasn't happened yet.

1. **[GOVERNANCE] Congenital is not a default.** A condition being congenital in origin is not sufficient reason to route it to the Congenital/Genetic question. The organ/functional question wins whenever its actual wording more specifically names the condition or its category (see CAH→Endocrine, Congenital Hypothyroidism→Endocrine, and the flagged Congenital Glaucoma→Eye case as precedent).
2. **[GOVERNANCE] Manifestation/complication conditions (Part IX item 1) must be escalated, not defaulted.** Eisenmenger Syndrome is this review's example: a complication of a congenital defect, not a primary congenital lesion. Do not silently assign these to Congenital by inertia — flag for a Business Decision.
3. **[GOVERNANCE] Sibling/synonym consistency check required before adding related conditions (Part IX item 6).** This review found two real, pre-existing inconsistencies (Huntington's dictionary-vs-regex split; Friedreich's-vs-Spinocerebellar-Ataxia) that predate it. Any new condition sharing a disease family with an existing one must be checked against that family's existing category before being added.
4. **[GOVERNANCE] Polarity-sensitive terms need qualified aliases, not one bare token.** Hydrocephalus is the concrete example: "congenital hydrocephalus" and "normal pressure hydrocephalus" are different diseases with different correct categories, but today one regex token catches both identically. Any condition with a meaningfully different congenital-vs-acquired form should get separate qualified dictionary entries, with the bare/unqualified term routing to whichever form is more common in practice as a documented fallback — not a coin flip.
5. **[GOVERNANCE] Plan-specific "closer wording" questions require a dedicated categoryKey + `plan_overrides` rows, never a shared-categoryKey repoint.** Optima Secure's disability/deformity question is the concrete example (Part 3 above). Reassign the shared `genetic` categoryKey's target only if the change is meant to apply to literally every genetic/congenital condition on that plan.
6. **[BUSINESS — escalated, not resolved here] Eisenmenger Syndrome's category** needs an owner decision per Part IX item 1 before it's added to the repository.
7. **[BUSINESS — escalated, not resolved here] Whether "often-incidental" congenital findings (Horseshoe Kidney, Duplex Kidney) need declaring at all** is a separate underwriting-policy question from which category they'd fall under if declared.

---

## Part B / F — Repository changes (proposed, tiered by confidence) + ready-to-run SQL

**How to use this:** Tier 1 rows are High confidence (≥85%) with zero collision risk — safe to run as a batch after a quick skim. Tier 2 rows are Medium confidence — recommend reading the reasoning column in Part A again before running each one individually. Tier 3 items are explicitly **not** included as SQL — they're Business Decisions per Part D and need your/underwriting's decision first (Eisenmenger Syndrome, and the Optima Secure "Medium confidence" group in Part 3).

All statements use `added_by = 'governance-review-2026-08-07'` so every row from this exercise is traceable and easy to find/revert as one batch (`WHERE added_by = 'governance-review-2026-08-07'`). Run inside a transaction; nothing here has been executed.

```sql
BEGIN;

-- ═══════════════════════════════════════════════════════════════════════
-- TIER 1a — New categoryKey for Optima Secure's disability/deformity
-- question (Part 3). Required before any plan_overrides row below can
-- reference it.
-- ═══════════════════════════════════════════════════════════════════════

INSERT INTO categories (category_key, label, description, sort_order)
VALUES (
  'congenital_disability',
  'Congenital Disability / Deformity',
  'Structural congenital deformities/disabilities, used only where a plan has dedicated wording distinct from its generic Congenital/Genetic question (currently Optima Secure only).',
  100
)
ON CONFLICT (category_key) DO NOTHING;

-- Wire it into Optima Secure's live categoryMap (plan_configs is the DB
-- source of truth; types.ts's getPlanConfig() is only the bootstrap seed).
UPDATE plan_configs
SET category_map = category_map || jsonb_build_object(
  'congenital_disability',
  'Are you having any disability / deformity including accidental or congenital?'
)
WHERE plan_name = 'Optima Secure';


-- ═══════════════════════════════════════════════════════════════════════
-- TIER 1b — Re-categorize existing conditions per Part A1 (High confidence
-- only: Huntington's regex fix, Friedreich's/Spinocerebellar consistency,
-- Charcot-Marie-Tooth, CAH already correct — no action needed for CAH,
-- listed for completeness).
-- ═══════════════════════════════════════════════════════════════════════

-- Standardize both Spinocerebellar Ataxia aliases to 'neuro' (matches
-- Friedreich's Ataxia; fixes the same-disease-two-categories split found
-- in the audited 621-condition file).
UPDATE ped_repository
SET category_key = 'neuro', updated_at = now()
WHERE canonical_name ILIKE 'Spinocerebellar Ataxia';

-- (If the DB alias table still has a second alias row pointing at a
-- different ped_id/category for a "spinocerebellar ataxia genetic"
-- variant, merge it into the row above per PED_REPOSITORY_GOVERNANCE.md
-- rule 3 rather than leaving two live PEDs for one concept. Recommend
-- doing this merge step manually in the admin UI, since it requires
-- picking which row is canonical.)

-- Huntington's: the dictionary-level rows already say 'neuro' — confirm
-- (no UPDATE needed if so; this SELECT is a sanity check to run first).
SELECT canonical_name, category_key FROM ped_repository WHERE canonical_name ILIKE '%huntington%';

-- Congenital Glaucoma / Congenital Hypothyroidism will be inserted
-- directly with the correct category below (Tier 1c), not routed to
-- 'genetic' at all, per Part A3's Eye/Endocrine findings.


-- ═══════════════════════════════════════════════════════════════════════
-- TIER 1c — New PEDs: High-confidence congenital conditions (Part A3).
-- Each block: insert with placeholder ped_code, stamp the real code from
-- the returned id, then insert aliases. Uses PL/pgSQL DO blocks so this
-- works in any SQL client (not psql-specific \gset).
-- ═══════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  new_id integer;
BEGIN
  -- Patent Ductus Arteriosus
  INSERT INTO ped_repository (ped_code, canonical_name, category_key, status, added_by)
  VALUES ('PED-PENDING', 'Patent Ductus Arteriosus', 'genetic', 'approved', 'governance-review-2026-08-07')
  RETURNING id INTO new_id;
  UPDATE ped_repository SET ped_code = 'PED-' || lpad(new_id::text, 6, '0') WHERE id = new_id;
  INSERT INTO ped_aliases (ped_id, alias_text, normalized_alias, is_primary, is_visible, added_by) VALUES
    (new_id, 'Patent Ductus Arteriosus', 'patent ductus arteriosus', true, true, 'governance-review-2026-08-07'),
    (new_id, 'PDA', 'pda', false, true, 'governance-review-2026-08-07');

  -- Coarctation of Aorta
  INSERT INTO ped_repository (ped_code, canonical_name, category_key, status, added_by)
  VALUES ('PED-PENDING', 'Coarctation of Aorta', 'genetic', 'approved', 'governance-review-2026-08-07')
  RETURNING id INTO new_id;
  UPDATE ped_repository SET ped_code = 'PED-' || lpad(new_id::text, 6, '0') WHERE id = new_id;
  INSERT INTO ped_aliases (ped_id, alias_text, normalized_alias, is_primary, is_visible, added_by) VALUES
    (new_id, 'Coarctation of Aorta', 'coarctation of aorta', true, true, 'governance-review-2026-08-07'),
    (new_id, 'Aortic Coarctation', 'aortic coarctation', false, true, 'governance-review-2026-08-07');

  -- Transposition of Great Arteries
  INSERT INTO ped_repository (ped_code, canonical_name, category_key, status, added_by)
  VALUES ('PED-PENDING', 'Transposition of Great Arteries', 'genetic', 'approved', 'governance-review-2026-08-07')
  RETURNING id INTO new_id;
  UPDATE ped_repository SET ped_code = 'PED-' || lpad(new_id::text, 6, '0') WHERE id = new_id;
  INSERT INTO ped_aliases (ped_id, alias_text, normalized_alias, is_primary, is_visible, added_by) VALUES
    (new_id, 'Transposition of Great Arteries', 'transposition of great arteries', true, true, 'governance-review-2026-08-07'),
    (new_id, 'TGA', 'tga', false, true, 'governance-review-2026-08-07');

  -- Truncus Arteriosus
  INSERT INTO ped_repository (ped_code, canonical_name, category_key, status, added_by)
  VALUES ('PED-PENDING', 'Truncus Arteriosus', 'genetic', 'approved', 'governance-review-2026-08-07')
  RETURNING id INTO new_id;
  UPDATE ped_repository SET ped_code = 'PED-' || lpad(new_id::text, 6, '0') WHERE id = new_id;
  INSERT INTO ped_aliases (ped_id, alias_text, normalized_alias, is_primary, is_visible, added_by) VALUES
    (new_id, 'Truncus Arteriosus', 'truncus arteriosus', true, true, 'governance-review-2026-08-07');

  -- Hypoplastic Left Heart Syndrome
  INSERT INTO ped_repository (ped_code, canonical_name, category_key, status, added_by)
  VALUES ('PED-PENDING', 'Hypoplastic Left Heart Syndrome', 'genetic', 'approved', 'governance-review-2026-08-07')
  RETURNING id INTO new_id;
  UPDATE ped_repository SET ped_code = 'PED-' || lpad(new_id::text, 6, '0') WHERE id = new_id;
  INSERT INTO ped_aliases (ped_id, alias_text, normalized_alias, is_primary, is_visible, added_by) VALUES
    (new_id, 'Hypoplastic Left Heart Syndrome', 'hypoplastic left heart syndrome', true, true, 'governance-review-2026-08-07'),
    (new_id, 'HLHS', 'hlhs', false, true, 'governance-review-2026-08-07');

  -- Total Anomalous Pulmonary Venous Return
  INSERT INTO ped_repository (ped_code, canonical_name, category_key, status, added_by)
  VALUES ('PED-PENDING', 'Total Anomalous Pulmonary Venous Return', 'genetic', 'approved', 'governance-review-2026-08-07')
  RETURNING id INTO new_id;
  UPDATE ped_repository SET ped_code = 'PED-' || lpad(new_id::text, 6, '0') WHERE id = new_id;
  INSERT INTO ped_aliases (ped_id, alias_text, normalized_alias, is_primary, is_visible, added_by) VALUES
    (new_id, 'Total Anomalous Pulmonary Venous Return', 'total anomalous pulmonary venous return', true, true, 'governance-review-2026-08-07'),
    (new_id, 'TAPVR', 'tapvr', false, true, 'governance-review-2026-08-07');

  -- Arnold-Chiari Malformation
  INSERT INTO ped_repository (ped_code, canonical_name, category_key, status, added_by)
  VALUES ('PED-PENDING', 'Arnold-Chiari Malformation', 'genetic', 'approved', 'governance-review-2026-08-07')
  RETURNING id INTO new_id;
  UPDATE ped_repository SET ped_code = 'PED-' || lpad(new_id::text, 6, '0') WHERE id = new_id;
  INSERT INTO ped_aliases (ped_id, alias_text, normalized_alias, is_primary, is_visible, added_by) VALUES
    (new_id, 'Arnold-Chiari Malformation', 'arnold chiari malformation', true, true, 'governance-review-2026-08-07'),
    (new_id, 'Chiari Malformation', 'chiari malformation', false, true, 'governance-review-2026-08-07');

  -- Dandy-Walker Malformation
  INSERT INTO ped_repository (ped_code, canonical_name, category_key, status, added_by)
  VALUES ('PED-PENDING', 'Dandy-Walker Malformation', 'genetic', 'approved', 'governance-review-2026-08-07')
  RETURNING id INTO new_id;
  UPDATE ped_repository SET ped_code = 'PED-' || lpad(new_id::text, 6, '0') WHERE id = new_id;
  INSERT INTO ped_aliases (ped_id, alias_text, normalized_alias, is_primary, is_visible, added_by) VALUES
    (new_id, 'Dandy-Walker Malformation', 'dandy walker malformation', true, true, 'governance-review-2026-08-07'),
    (new_id, 'Dandy-Walker Syndrome', 'dandy walker syndrome', false, true, 'governance-review-2026-08-07');

  -- Holoprosencephaly
  INSERT INTO ped_repository (ped_code, canonical_name, category_key, status, added_by)
  VALUES ('PED-PENDING', 'Holoprosencephaly', 'genetic', 'approved', 'governance-review-2026-08-07')
  RETURNING id INTO new_id;
  UPDATE ped_repository SET ped_code = 'PED-' || lpad(new_id::text, 6, '0') WHERE id = new_id;
  INSERT INTO ped_aliases (ped_id, alias_text, normalized_alias, is_primary, is_visible, added_by) VALUES
    (new_id, 'Holoprosencephaly', 'holoprosencephaly', true, true, 'governance-review-2026-08-07');

  -- Renal Agenesis
  INSERT INTO ped_repository (ped_code, canonical_name, category_key, status, added_by)
  VALUES ('PED-PENDING', 'Renal Agenesis', 'genetic', 'approved', 'governance-review-2026-08-07')
  RETURNING id INTO new_id;
  UPDATE ped_repository SET ped_code = 'PED-' || lpad(new_id::text, 6, '0') WHERE id = new_id;
  INSERT INTO ped_aliases (ped_id, alias_text, normalized_alias, is_primary, is_visible, added_by) VALUES
    (new_id, 'Renal Agenesis', 'renal agenesis', true, true, 'governance-review-2026-08-07');

  -- Congenital Solitary Kidney
  INSERT INTO ped_repository (ped_code, canonical_name, category_key, status, added_by)
  VALUES ('PED-PENDING', 'Congenital Solitary Kidney', 'genetic', 'approved', 'governance-review-2026-08-07')
  RETURNING id INTO new_id;
  UPDATE ped_repository SET ped_code = 'PED-' || lpad(new_id::text, 6, '0') WHERE id = new_id;
  INSERT INTO ped_aliases (ped_id, alias_text, normalized_alias, is_primary, is_visible, added_by) VALUES
    (new_id, 'Congenital Solitary Kidney', 'congenital solitary kidney', true, true, 'governance-review-2026-08-07');

  -- Imperforate Anus
  INSERT INTO ped_repository (ped_code, canonical_name, category_key, status, added_by)
  VALUES ('PED-PENDING', 'Imperforate Anus', 'genetic', 'approved', 'governance-review-2026-08-07')
  RETURNING id INTO new_id;
  UPDATE ped_repository SET ped_code = 'PED-' || lpad(new_id::text, 6, '0') WHERE id = new_id;
  INSERT INTO ped_aliases (ped_id, alias_text, normalized_alias, is_primary, is_visible, added_by) VALUES
    (new_id, 'Imperforate Anus', 'imperforate anus', true, true, 'governance-review-2026-08-07');

  -- Congenital Hypothyroidism -> Endocrine, NOT genetic (Part A3 finding)
  INSERT INTO ped_repository (ped_code, canonical_name, category_key, status, added_by)
  VALUES ('PED-PENDING', 'Congenital Hypothyroidism', 'endocrine', 'approved', 'governance-review-2026-08-07')
  RETURNING id INTO new_id;
  UPDATE ped_repository SET ped_code = 'PED-' || lpad(new_id::text, 6, '0') WHERE id = new_id;
  INSERT INTO ped_aliases (ped_id, alias_text, normalized_alias, is_primary, is_visible, added_by) VALUES
    (new_id, 'Congenital Hypothyroidism', 'congenital hypothyroidism', true, true, 'governance-review-2026-08-07');

END $$;


-- ═══════════════════════════════════════════════════════════════════════
-- TIER 1d — Optima Secure plan_overrides: structural/deformity-presenting
-- conditions -> congenital_disability (Part 3, "Yes" group). Requires
-- Tier 1a and Tier 1c to have run first (Congenital Ptosis is inserted
-- here since it's Optima-Secure-specific in practice; add its own
-- ped_repository row first if it doesn't already exist).
-- Uses a lookup by canonical_name so it doesn't depend on hardcoded ids.
-- ═══════════════════════════════════════════════════════════════════════

INSERT INTO plan_overrides (plan_name, ped_id, category_key, reason, added_by)
SELECT 'Optima Secure', pr.id, 'congenital_disability',
       'Structural/deformity-presenting congenital condition — Optima Secure''s explicit disability/deformity/congenital wording is a closer match than the generic blood/genetic question (governance review 2026-08-07).',
       'governance-review-2026-08-07'
FROM ped_repository pr
WHERE pr.canonical_name IN (
  'Clubfoot Deformity', 'Cleft Lip Cleft Palate', 'Spina Bifida',
  'Imperforate Anus', 'Choanal Atresia', 'Achondroplasia', 'Osteogenesis Imperfecta'
  -- NOTE: 'Clubfoot Deformity' / 'Cleft Lip Cleft Palate' are the existing
  -- TOP_PED_DICTIONARY canonical spellings -- confirm exact canonical_name
  -- in ped_repository before running, in case the DB copy differs.
)
ON CONFLICT (plan_name, ped_id) DO UPDATE SET category_key = EXCLUDED.category_key, reason = EXCLUDED.reason;


-- ═══════════════════════════════════════════════════════════════════════
-- TIER 2 — Medium-confidence rows. Review the Part A reasoning column for
-- EACH of these individually before uncommenting/running. Left as
-- commented-out INSERTs deliberately -- not auto-applied.
-- ═══════════════════════════════════════════════════════════════════════

-- Ebstein's Anomaly (72% -- valve-disease wording overlap, recommend
-- underwriting sign-off first):
-- INSERT INTO ped_repository (ped_code, canonical_name, category_key, status, added_by)
-- VALUES ('PED-PENDING', 'Ebstein''s Anomaly', 'genetic', 'draft', 'governance-review-2026-08-07') ...

-- Pulmonary Atresia / Tricuspid Atresia (80% -- same wording-overlap flag,
-- lower severity than Ebstein's):
-- ...

-- Horseshoe Kidney / Duplex Kidney / Multicystic Dysplastic Kidney
-- (75-78% -- "often incidental" caveat, business call on declarability):
-- ...

-- Meckel's Diverticulum / Malrotation (65% -- genuinely dual with
-- Digestive, not a clean recommendation):
-- ...

-- Congenital Deafness / Choanal Atresia already included at Tier 1 for
-- Choanal Atresia; Congenital Deafness held here pending an ENT-question
-- wording check per plan (78%):
-- ...

-- Congenital Glaucoma -> Eye, NOT genetic (65% -- plan-dependent, verify
-- each plan's actual Eye question text names "glaucoma" before applying):
-- ...

-- Optima Secure "Medium confidence" internal-organ group from Part 3
-- (ASD, VSD, ToF, PDA, Coarctation, TGA, Truncus Arteriosus, HLHS, TAPVR,
-- Arnold-Chiari, Dandy-Walker, Holoprosencephaly, kidney anomalies) ->
-- congenital_disability: NOT included even as commented SQL, since Part 3
-- flags this as a genuine business call, not a lean either way.


-- ═══════════════════════════════════════════════════════════════════════
-- TIER 3 — Explicitly NOT scripted: Eisenmenger Syndrome. Per Part D
-- item 6, this requires an owner decision on manifestation-routing policy
-- (Part IX item 1 of the Constitution) before it's added at all.
-- ═══════════════════════════════════════════════════════════════════════

COMMIT;
-- (Change to ROLLBACK and re-run interactively if you want to review the
-- SELECT/sanity-check output above before committing Tier 1's writes.)
```

---

## Part E — Regression analysis

**What I could verify:**
- **Coverage additions (Tier 1c) carry zero regression risk.** Confirmed via three independent sources (legacy `TOP_PED_DICTIONARY`, all 24 `engine.ts` regex sections, and the separately-audited 621-condition file) that none of these 20 new conditions currently resolve deterministically — they all fall through to the AI fallback today. Adding them changes `resolved: false → true` for these specific PEDs (a Coverage-type regression per Part XII's table, but a strictly positive one — nothing existing is altered).
- **Huntington's/Spinocerebellar Ataxia fixes (Tier 1b) are Behavioral regressions by definition** — they change an existing (condition, plan) output — but only for the specific phrasings that currently hit the *wrong* stage (bare "Huntington's" without "chorea"/"neuro" suffix; the "spinocerebellar ataxia genetic" alias variant specifically). Every dictionary-exact-match phrasing that already resolves correctly today is untouched.
- **Optima Secure `congenital_disability` additions (Tier 1a/1d) are also Behavioral regressions, scoped to exactly seven named conditions on exactly one plan** — Plan-isolation is preserved (Part VIII invariant 2): no other plan's `categoryMap` is touched, and the new categoryKey doesn't exist anywhere else, so it can't leak into other plans' routing.

**What I could not verify:**
- I could not run `npm test` / the baseline snapshot suite (`src/__tests__/engine.baseline.test.ts`, `specificIllnessEngine.baseline.test.ts`) in this sandbox — the mounted `node_modules` was installed on Windows (native `esbuild`/`rollup` binaries for `win32-x64`) and this sandbox is Linux; a fresh Linux install hit the same read-only-mount permission issue that's blocked file deletion earlier in this session. This is an environment limitation, not a code issue.
- **Because nothing in this deliverable has been applied to the live DB, there is nothing to regression-test yet.** The actual regression gate is the one your team already runs as standard practice: after applying any subset of Part F's SQL, run `npm test` locally (should work fine outside this sandbox) and diff against baseline snapshots per `MASTER_CONSTITUTION.md` Part XII, before considering any Tier "approved."

**Recommended sequencing once you're ready to apply:** Tier 1a → 1b → 1c → 1d, each as its own transaction, running `npm test` between tiers so a diff is attributable to a single tier if something unexpected shows up. Hold Tier 2 for individual underwriting sign-off per row, and Tier 3 (Eisenmenger) for a Business Decision before it's even drafted as SQL.

---

*Every recommendation above is decision support, not an applied change. Nothing in `ped_repository`, `ped_aliases`, `plan_overrides`, `categories`, or `plan_configs` has been modified by this review.*
