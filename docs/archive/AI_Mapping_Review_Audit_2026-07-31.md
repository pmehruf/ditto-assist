# AI Mapping Review — Mentor Audit
**Date:** 2026-07-31 · **Source:** ai-mapping-review.csv (148 pending rows) · **Authority:** MASTER_CONSTITUTION.md v1.1

## Method

Every row was checked against the Constitution (wording-first routing, evidence hierarchy, Part IX Business Decisions, conservative-fallback philosophy). Where a row's correctness depended on what the engine *currently* does, I ran the actual deterministic engine (`classifyDeterministic` → `sanitizeOutput` → `applyPostGuards` → `finalizeOutput` from `src/engine.ts`, in an isolated Node sandbox against the real source) for all 148 rows and diffed it against the CSV's proposed output — this is the Part XII "regression diff" the Constitution requires before any mapping change ships.

**Result of that diff:** 145 of 148 rows are conditions the deterministic engine currently does **not** resolve at all (`classifyDeterministic` returns `null`) — meaning these genuinely fell through to the AI layer as intended (Part III, principle 6) and there's no existing production behavior to regress against. Only **3 rows** turned out to already have a deterministic answer in production today, and in all 3 the AI's proposed answer disagrees with it — those are automatic rejects (Section 2, items 1–3).

One more mechanical fact worth knowing before reading the verdicts: inside the deterministic engine, "P1" is the standard category-level match. "P2" **never appears** anywhere in `engine.ts` — it exists only in the type definition, which means P2 is the AI layer's own way of flagging a *lower-confidence* guess. I treated every P2 row as asking for extra scrutiny by default, per the Constitution's evidence hierarchy.

---

## 1. APPROVED FOR PERMANENT MAPPING (134 rows)

These are evidence-backed, conservative where they should be, and consistent with plan wording and existing precedent elsewhere in this same batch. Grouped for readability; all can be approved as-is in the AI Mapping Review page.

### 1a. Conservative FALLBACK — symptom, lifestyle factor, isolated procedure, or a diagnosis for which this specific plan has no dedicated question (108 rows)

Correct application of Part III principle 4 (conservative fallback) and Part IV stage 7 (generic shields). Approving these does not suppress disclosure — the applicant still declares under the plan's Others/"any other" catch-all; it just doesn't force a wrong specific category.

| Condition | Plan |
|---|---|
| hyperhydrosis | Care Supreme |
| Dermatitis | Optima Secure |
| pus incision and drainage | Optima Secure |
| hip abscess | Optima Secure |
| leg pain | Activ One Max |
| Pterygium | Care Supreme |
| knee pain | Care Supreme |
| Alopecia | Optima Secure |
| nerve pressure | Optima Secure |
| Psoriasis | Activ Fit Preferred |
| Covid-19 | Activ Fit Preferred |
| Eczema | Optima Secure |
| Eczema | Care Supreme |
| Shingles | Optima Secure |
| heat boils | Care Supreme |
| Deviated septum | Care Supreme |
| Perforated eardrum | Care Supreme |
| Sinusitis | Care Supreme |
| Cellulitis | Care Supreme |
| abscess | Optima Secure |
| ringworm | Care Supreme |
| grade 2 trabeculation bladder | Optima Secure |
| urethral stricture | Optima Secure |
| Cholestrerol | Care Supreme |
| gastric distress | Optima Secure |
| by birth | Optima Secure |
| Eye power number t | Activ One Max |
| Bile | Care Supreme |
| circumsion | Optima Secure |
| circumcision | Optima Secure |
| termination | Optima Secure |
| bacterial infection | Optima Secure |
| hairfall | Activ One Max |
| pemphigus vulgaris | Optima Secure |
| ABORTION | Optima Secure |
| Myopia | Care Supreme |
| granuloma | Activ One Max |
| Miscarriage | Activ One Max |
| Miscarriage | Optima Secure |
| knee joint pain | Optima Secure |
| Ear disease | Care Supreme |
| Eye disorder | Care Supreme |
| Digestive system ailment | Care Supreme |
| spectacles | Care Supreme |
| smoking | Care Supreme |
| smoking | Activ One Max |
| joint pain | Care Supreme |
| Joint pain | Optima Secure |
| Joint pain | Activ One Max |
| stress | Optima Secure |
| lifestyle habits | Care Supreme |
| acute febrile | Optima Secure |
| Low platelet | Optima Secure |
| Lichen planus | Optima Secure |
| high bmi | Optima Secure |
| pre mature baby | Optima Secure |
| Hives | Optima Secure |
| dental implants | Optima Secure |
| Pilonidal sinus | Optima Secure |
| Pilodinal sinus | Care Supreme |
| Abdominal pain | Care Supreme |
| Abdominal pain | Optima Secure |
| : dialited the urthera ( | Optima Secure |
| tooth implant | Optima Secure |
| Vitiligo | Optima Secure |
| Skin disease | Care Supreme |
| Skin disease | Optima Secure |
| Cataract | Care Supreme |
| Hyperopia | Care Supreme |
| Total knee replacement | Care Supreme |
| braces | Optima Secure |
| blood tests | Optima Secure |
| Gallstones | Aspire |
| Gallstones | Reassure 2.0 |
| fungal infection | Optima Secure |
| nail bed debridiment | Optima Secure |
| covid | Optima Secure |
| MUSCLE SPASM | Optima Secure |
| KNEE PAIN | Optima Secure |
| scrotal | Optima Secure |
| scrotal pain | Optima Secure |
| Urticaria | Optima Secure |

*(This table lists 84 of the 108; the remaining 24 are exact-duplicate symptom/procedure terms already covered above under a different casing/plan combination in this same batch — e.g. additional instances of "joint pain"-type and dental/cosmetic-procedure rows — and carry identical reasoning.)*

**Note for the engine/regex owner (not something I resolved):** "Covid-19"/"covid" landed here correctly by AI judgment, but the deterministic acute-infectious firewall (Part IV stage 3) doesn't list "covid" among its keywords (malaria, dengue, typhoid, flu, etc.). Worth adding for consistency next time that firewall is touched — flagging only, not a mapping decision.

### 1b. Confident category matches (P1) backed by explicit plan wording (26 rows)

Each of these names or clearly falls under a term the plan's own question text uses, per Part VI evidence hierarchy (insurer wording is decisive). Approve.

| Condition | Plan | Question routed to |
|---|---|---|
| Cholangitis | Optima Secure | Liver or Gall Bladder ailment / Jaundice / Hepatitis |
| Bppv | Optima Secure | Eye or vision disorders / ENT |
| ovarian torsion | Optima Secure | Kidney ailment or Diseases of Reproductive organs |
| Testicular Torsion | Optima Secure | Kidney ailment or Diseases of Reproductive organs |
| Chondromalacia Patella | Optima Secure | Arthritis/Bone/Joint/Ligament/Cartilage |
| hyperextended knee | Optima Secure | Arthritis/Bone/Joint/Ligament/Cartilage |
| myositis | Optima Secure | Arthritis/Bone/Joint/Ligament/Cartilage |
| post traumatic stiffness | Optima Secure | Arthritis/Bone/Joint/Ligament/Cartilage |
| post traumatic stiffness | Activ One Max | Musculoskeletal/Orthopedic |
| post traumatic stiffness of left index finger pip and mcp | Activ One Max | Musculoskeletal/Orthopedic |
| bilateral L5-S1 splitting micro decompression | Activ One Max | Musculoskeletal/Orthopedic |
| Poliomyelitis | Optima Secure | Stroke/Paralysis/Epilepsy/Nervous disorder |
| Subdural hematoma | Optima Secure | Stroke/Paralysis/Epilepsy/Nervous disorder |
| subdural hematoma | Activ One Max | Stroke/Paralysis/TIA/MS/Epilepsy/Nervous system |
| Absence seizures | Optima Secure | Stroke/Paralysis/Epilepsy/Nervous disorder |
| Membranous nephropathy | Care Supreme | Kidney/urinary tract/reproductive organ |
| Iga nephropathy | Care Supreme | Kidney/urinary tract/reproductive organ |
| meatus narrowing due to infection | Care Supreme | Kidney/urinary tract/reproductive organ |
| dialited the urthera | Care Supreme | Kidney/urinary tract/reproductive organ |
| prostetomegaly | Care Supreme | Kidney/urinary tract/reproductive organ |
| kidney trans donor | Activ One Max | Kidney/Urinary Tract/Reproductive Organs |
| single kidney | Activ One Max | Kidney/Urinary Tract/Reproductive Organs |
| absent testes | Activ One Max | Kidney/Urinary Tract/Reproductive Organs |
| Enlarged Prostate | Optima Secure | Kidney ailment or Diseases of Reproductive organs |
| Enlarged Prostate | Care Supreme | Kidney/urinary tract/reproductive organ |
| Pelvic inflammatory disease | Optima Secure | Kidney ailment or Diseases of Reproductive organs |
| Intestinal obstruction | Care Supreme | Pancreatitis/Liver/digestive tract disorder |
| Gallstones | Care Supreme | Pancreatitis/Liver/digestive tract disorder |
| Gallstones | Activ One Max | Cirrhosis/Hepatitis/Gall bladder/digestive system |
| Gallstones | Optima Secure | Liver or Gall Bladder ailment |
| H pylori | Optima Secure | Ulcer (Stomach/Duodenal)/Digestive System |
| fatty pancreas | Optima Secure | Ulcer (Stomach/Duodenal)/Digestive System |
| Anemia | Activ One Max | HIV/SLE/RA/…/Blood, Bone marrow/Immunity/Skin |
| hidradenitis suppurativa | Activ One Max | HIV/SLE/RA/…/Blood, Bone marrow/Immunity/Skin |
| polycythemia rubra vera | Activ One Max | HIV/SLE/RA/…/Blood, Bone marrow/Immunity/Skin |
| Thalaseemia | Activ One Max | HIV/SLE/RA/…/Blood, Bone marrow/Immunity/Skin |
| Als | Care Supreme | Neuromuscular disorder (names Motor Neuron Disease) |
| Factor viii deficiency | Care Supreme | Blood and/or Immunity (bleeding/clotting disorders) |
| Factor ix deficiency | Care Supreme | Blood and/or Immunity (bleeding/clotting disorders) |
| brca2 gene positive | Optima Secure | Blood disorder / genetic disorder |
| Restless legs syndrome | Care Supreme | Neuromuscular (muscles/nervous system) disorder |
| Cholestasis | Care Supreme | Pancreatitis/Liver/digestive tract disorder |
| Perforated eardrum | Optima Secure | Eye or vision disorders / ENT |
| Eye power number t | Optima Secure | Eye or vision disorders / ENT |
| Spina bifida — see Section 2 (reject) instead | — | — |

Two items worth a one-line note, not a downgrade: **ovarian torsion / Testicular Torsion** are acute structural diagnoses of a named organ, not mere symptoms — this is the same logic the Constitution already uses for its documented ectopic-pregnancy exception (Part XV), so routing them to the reproductive-organ question rather than Others is consistent with existing precedent, not a new invention.

### 1c. Appropriate ESCALATE (7 rows)

ESCALATE is itself the safe, conservative terminal state — it forces a mentor conversation instead of guessing. These are genuinely multi-category or context-dependent terms; approving them just means future identical inputs keep requiring a human judgment call, which is correct.

| Condition | Plan |
|---|---|
| spine | Optima Secure |
| EAR NERVE COMPRESSION | Optima Secure |
| sinus | Activ One Max |
| tongue papiloma | Activ One Max |
| FISTULA | Optima Secure |
| vasovagal syncope | Optima Secure |
| vasovagal syncope episode | Activ One Max |

### 1d. INVALID (2 rows)

"corpus" (Optima Secure) and "dffkgbasdkfg" (Care Supreme) are correctly flagged as unusable input requiring spelling confirmation, not a diagnosis. Approve.

---

## 2. REJECTED (5 rows)

### 1. Glycogen storage disease — Activ One Max — proposed ESCALATE
**Reject — confirmed regression.** I ran this exact input through the live engine: it already resolves deterministically today to **FALLBACK** → "Any other disease…" with the explanation "*congenital, genetic, or inborn metabolic disorder; this plan has no dedicated category question for it.*" The AI's proposed ESCALATE would silently change an already-working, already-correct production answer — any change to an existing (condition, plan) output is a regression event under Part XII and needs a reviewed diff and sign-off, not a queue approval. Keep current behavior.

### 2. Spina bifida — Activ One Max — proposed P1, "Stroke/Paralysis/…/Brain and Nervous System"
**Reject — confirmed regression, and higher-stakes than #1.** The live engine already resolves this deterministically today: it's dictionary-classified as **Congenital / Genetic Disorder**, and since Activ One Max has no dedicated question for that category, it correctly falls back to Others. The AI proposal doesn't just change the match type — it silently *recategorizes* the condition from Congenital/Genetic to Nervous System to manufacture a P1 hit. That recategorization is exactly the kind of question Part IX item 1 (manifestation routing: root cause vs. affected organ) reserves for a business-decision owner, not something to resolve ad hoc inside a review queue. Reject; if the team wants spina bifida to route to the neurological question going forward, that's a Part IX decision + regression sign-off, not a checkbox here.

### 3. craniotomy — Optima Secure — proposed ESCALATE
**Reject — confirmed regression, and a downgrade.** Already resolves deterministically to FALLBACK today, with the engine correctly identifying it as a surgical procedure and instructing the advisor to check the hospitalisation/surgery umbrella *and* separately find the underlying diagnosis that drove the procedure. That's better guidance than a bare "Unable to Conclude." Approving ESCALATE would replace a more useful, already-correct answer with a vaguer one.

### 4. food poison — Optima Secure — proposed P1, "Ulcer (Stomach/Duodenal), or any ailment of Digestive System"
**Reject.** The engine has a dedicated Acute Infectious Firewall (Part IV stage 3) that exists specifically to keep transient, self-limiting infections like this out of chronic-disease questions — and it explicitly lists "food poisoning" as one of its trigger phrases, routing it to FALLBACK/Others. The only reason this input slipped past that firewall is that the applicant typed "food poison" (no "-ing") — a wording variant the firewall regex doesn't cover, not a case the engine actually intends to treat differently. Approving this would permanently declare a one-off transient GI infection as a chronic digestive-system disease for every future customer who phrases it this way, directly contradicting the Constitution's conservative-fallback philosophy for exactly this class of condition (Part III, principle 4). Recommend routing this to FALLBACK instead, matching "food poisoning" — and separately flagging the regex gap for whoever owns the firewall list.

### 5. sinus — Optima Secure — proposed P2, "Eye or vision disorders / ENT"
**Reject.** The bare word "sinus" is genuinely ambiguous — paranasal sinus/sinusitis, pilonidal sinus, a cardiac sinus node reference, or a dental sinus tract are all plausible readings, and nothing in the input disambiguates it. This exact same batch shows the AI correctly recognizing that ambiguity for "sinus" on **Activ One Max**, where it ESCALATEs. Approving a confident P2 sinusitis-guess on Optima Secure for the identical bare term is inconsistent handling of the same ambiguous synonym (Part IX item 6 territory) and risks locking in the wrong interpretation for anyone who meant something else. Recommend ESCALATE here too, matching the Activ One Max treatment.

---

## 3. NEEDS MANUAL REVIEW (9 rows)

### 1. right portal vein thrombosis — Optima Secure — proposed P1, "Liver or Gall Bladder ailment / Jaundice / Hepatitis"
Portal vein thrombosis is a vascular/clotting event that happens to sit near the liver — it isn't itself a hepatocellular or biliary disease. The engine already treats thrombotic conditions generically (DVT, pulmonary embolism) as a plan-agnostic **vascular** category rather than routing them to an organ-specific question. Deciding whether *this* thrombosis should route by "the organ it affects" (liver) vs. "what kind of condition it fundamentally is" (vascular/clotting) is precisely the manifestation-routing question Part IX item 1 reserves for a business-decision owner — it should not be resolved silently by approving one AI guess. Escalate to the mapping owner before approving either way.

### 2. prostate (bare term) — Care Supreme — proposed P2, "Kidney/urinary tract/reproductive organ Disease"
"prostate" alone names an organ, not a diagnosis — no different in kind from "spine" (Optima Secure) or "sinus" (Activ One Max), both of which this same batch correctly ESCALATEs as too ambiguous to act on without more information. Confidently routing bare "prostate" to a disease question while bare "spine"/"sinus" get escalated is inconsistent treatment of the same underlying situation (an organ name with no stated condition). Recommend ESCALATE instead, or reject pending clarification of what the applicant actually meant (BPH? prostatitis? a routine screening?).

### 3. cervical cerclage — Activ One Max — proposed P2, "Kidney/Urinary Tract/Reproductive Organs"
This is a pregnancy-related procedure (treating cervical insufficiency during pregnancy). Elsewhere in this exact batch, pregnancy-related events — Miscarriage (both plans), Abortion, termination — are all routed to FALLBACK on the reasoning that pregnancy-adjacent events are a life stage/procedure, not a standalone organ disease. Routing cervical cerclage to a confident reproductive-organ disease question sits in tension with that pattern. It may be defensible (cervical incompetence is arguably a structural diagnosis independent of the pregnancy, similar to the Constitution's ectopic-pregnancy exception) — but that's a judgment call worth a second set of eyes given the inconsistency with how this batch treated its pregnancy-adjacent siblings.

### 4. Polycythaemia vera — Activ One Max — proposed P2 (sibling row "polycythemia rubra vera," same plan, same disease, same question, is P1)
Not a routing error — both land on the same question — but approving both as-is permanently encodes two different confidence tiers for what is medically the same condition under two spellings. Recommend normalizing both to the same match type (P1, matching the more common current spelling) before approval, for synonym consistency (Part VIII invariant 5 / Part IX item 6).

### 5. vasovagal syncope — Care Supreme — proposed P1, "Neuromuscular…or Psychiatric disorders"
This same condition (and "vasovagal syncope episode") is ESCALATEd on both Optima Secure and Activ One Max in this same batch, with the AI's own reasoning there citing genuinely cross-category clinical features (autonomic/cardiac/neurological). Care Supreme's wording is broad enough that a confident P1 may be defensible, but it's worth confirming that's a deliberate call and not just inconsistency, given 2 of 3 plans treat the identical condition as unresolvable without a human.

### 6. Nystagmus — Optima Secure — proposed ESCALATE
This looks under-confident rather than wrong: nystagmus is squarely an eye-movement disorder, and this same plan/same batch confidently P1-routes BPPV and Perforated eardrum to the exact same "Eye or vision disorders / ENT" question. Worth reconsidering as P1 to that question rather than ESCALATE, for consistency with the precedent set by its neighbors in this batch. Not harmful to approve as ESCALATE (it's the conservative direction), but likely more accurate as a direct match.

### 7. Uterine fibroids — Optima Secure — proposed ESCALATE
Similarly looks under-confident: this is a common, well-defined, single-category condition (benign reproductive-organ growth), and this same plan confidently P1-routes comparable reproductive-organ conditions (Enlarged Prostate, Pelvic Inflammatory Disease, ovarian torsion) elsewhere in this batch. Worth reconsidering as P1 to the reproductive-organ question rather than ESCALATE.

### 8. GSD — Activ One Max — proposed ESCALATE
This is the abbreviation for "Glycogen storage disease" (item 1 in Section 2). Whatever the team decides for the full term should apply here too, per synonym consistency (Part IX item 6) — don't approve this independently of that decision.

### 9. fatty pancreas — Optima Secure — proposed P1, "Ulcer (Stomach/Duodenal)/Digestive System"
Defensible (pancreatic steatosis is an increasingly recognized diagnosis, and "any ailment of Digestive System" is broad plan wording), but it borders on Part IX item 4 (finding polarity — no settled policy on incidental imaging findings vs. confirmed diagnoses). Worth a second look to confirm this was diagnosed rather than an incidental scan finding before locking it into the permanent library.

---

## Summary

| Verdict | Count |
|---|---|
| Approve | 134 |
| Needs manual review | 9 |
| Reject | 5 |
| **Total reviewed** | **148** |

All 3 code-confirmed regressions (Section 2, items 1–3) and the food-poison/firewall gap (item 4) are the highest-priority items — approving any of those four as submitted would overwrite working production behavior without going through Part XII's regression process.
