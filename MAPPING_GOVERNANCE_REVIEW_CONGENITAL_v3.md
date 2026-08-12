# Mapping Governance Review — Congenital Routing (v3)

**Status:** Governance exercise / decision support. **No repository data has been changed.** This version resolves the four items from your last round of feedback. Everything else (Parts 0, 1–2, A1, A2, A3, D principles 1–4/8–9, E) is unchanged from v2 — this document only restates what changed.

---

## Item 1 (resolved) — Optima Secure CAN be solved with plan_overrides + zero new categories. I was wrong in v2.

**Where I went wrong in v2:** I was treating `categoryMap` as if repointing it were a global/shared change. It isn't — `plan_configs.category_map` is a JSONB column, **one independent row per plan**. Repointing what `genetic` resolves to on Optima Secure's own row touches nothing on Care Supreme, Activ One Max, or any other plan. That's not a new category and not a schema change — it's the exact per-plan configuration mechanism the Add/Edit Plan wizard already uses.

**The mechanism:**
1. Update Optima Secure's own `categoryMap.genetic` from *"Any Blood disorder... or any genetic disorder?"* to *"Are you having any disability / deformity including accidental or congenital?"* — a `plan_configs` UPDATE, zero `categories` table involvement.
2. For the small number of genetic-categorized conditions that don't actually read as a "disability/deformity" (systemic syndromes rather than structural defects — Marfan, Ehlers-Danlos, Situs Inversus), add explicit `plan_overrides` rows pointing them at Optima Secure's **existing** `blood` categoryKey instead — which already resolves to the exact same blood/genetic-combined question they correctly land on today. This is a normal, already-supported plan_overrides use (a documented, per-PED, per-plan, reversible redirect to a different *existing* category), exactly as your architecture diagram describes.

No new row in `categories`. No schema change. No new routing stage. Fully isolated to one plan (Part VIII invariant 2).

**Classification of every genetic-categorized PED (existing + newly proposed) into "fits the new default" vs "needs the blood override":**

| Group | Conditions | Optima Secure destination |
|---|---|---|
| Structural/developmental defects — fit "disability/deformity including congenital" as the new default, **no override row needed** | ASD, VSD, ToF, Congenital Heart Defect (generic), PDA, Coarctation of Aorta, TGA, Truncus Arteriosus, HLHS, TAPVR, Spina Bifida, Cleft Lip/Palate, Club Foot, Congenital Hydrocephalus, Microcephaly, Anencephaly, Arnold-Chiari, Dandy-Walker, Holoprosencephaly, Encephalocele, Craniosynostosis, Congenital Hip Dysplasia, Osteogenesis Imperfecta, Achondroplasia, Renal Agenesis, Congenital Solitary Kidney, Imperforate Anus, Choanal Atresia, Congenital Ptosis, DiGeorge Syndrome, Congenital Diaphragmatic Hernia, Gastroschisis, Omphalocele, Tracheoesophageal Fistula, Prune Belly Syndrome, Bladder Exstrophy | The new `genetic` default (disability/deformity question) |
| Systemic/syndromic — don't read as "deformity," **explicit `plan_overrides` row to `blood`** | Marfan Syndrome, Ehlers-Danlos Syndrome, Situs Inversus | Stays on the blood/genetic-combined question, via override |
| Already a different category, unaffected by this change | CAH, Congenital Hypothyroidism (endocrine); Huntington's, Friedreich's, CMT, Spinocerebellar Ataxia (neuro); Congenital Glaucoma (eye); Biliary Atresia (liver) | Unchanged |
| Held per your item 4, not touched by this mechanism | Ebstein's, Eisenmenger, Horseshoe Kidney, Duplex Kidney, Meckel's, Malrotation, **Hirschsprung's (moved here — see Item 3)** | Not applicable until individually approved |

This is now a real, ready-to-review recommendation, not an open question — SQL is in Part F.

---

## Item 2 (resolved) — Explicit organ-system comparison for the six structural anomalies

You asked me to justify these against the actual organ question wording, not assume. Doing that: the common thread that survives scrutiny is **structural/anatomical defect vs. disease-of-a-functioning-organ** — every organ question sampled across all six plans is phrased as *disease* wording (an ailment, a disorder, a diagnosis), not *anatomy-is-missing-or-malformed* wording. That distinction is what actually decides each of these, not congenital origin by itself.

| Condition | Organ-system candidate | Organ question wording (sampled) | Why organ wording doesn't cover it | Verdict |
|---|---|---|---|---|
| Gastroschisis | Digestive | *"Ulcer (Stomach/Duodenal), or any ailment of Digestive System"* | The bowel itself is usually structurally normal — the defect is the abdominal *wall*, not a digestive-tract disease. "Ailment of Digestive System" describes pathology of the tract, not an absent wall. | **Genetic/Congenital** (88%) |
| Omphalocele | Digestive | Same as above | Same reasoning — abdominal wall defect, not a GI-tract disease. | **Genetic/Congenital** (88%) |
| Congenital Diaphragmatic Hernia | Respiratory *or* Digestive | *"Tuberculosis/Asthma or any other Lung disorder"*; digestive wording as above | Respiratory wording is chronic acquired lung disease (asthma/TB/COPD) — doesn't anticipate a structural diaphragm defect or resulting pulmonary hypoplasia. Digestive wording doesn't fit either, since it's not a GI-tract disease. Spans two systems at once with neither fitting — same "no single organ question fits" logic as Marfan. | **Genetic/Congenital** (85%) |
| Tracheoesophageal Fistula | Respiratory *or* Digestive | Same as CDH | Same two-system-straddle reasoning as CDH — it's an abnormal *connection* between trachea and esophagus, not a disease of either organ alone. | **Genetic/Congenital** (85%) |
| Imperforate Anus | Digestive | *"any ailment of Digestive System"* | Genuinely closer than Gastroschisis (the digestive wording is broad), but this is the **absence of a normal anatomical opening**, not a disease of a functioning tract — distinguishable from Meckel's/Malrotation/Hirschsprung's, which really are functional/pathological problems *of* the tract (see Item 3). | **Genetic/Congenital** (82%) |
| Bladder Exstrophy | Kidney/Urinary | *"Kidney Stones/Renal Failure/Dialysis/CKD/Prostate Disease... or any other disease of Kidney"* | Entirely acquired-urological-disease wording (stones, failure, dialysis) — doesn't anticipate an external structural malformation. | **Genetic/Congenital** (85%) |

All six confirmed unchanged from v2 — but now for a stated, checkable reason (structural absence/malformation vs. organ disease) rather than "it's congenital so it's genetic."

---

## Item 3 (resolved) — Four explicit category comparisons

| Condition | Comparison | Wording-based verdict |
|---|---|---|
| **Hirschsprung Disease** | Digestive vs. Genetic | **Reassessed — moving to held/Tier 2, alongside Meckel's and Malrotation.** Unlike Gastroschisis/Imperforate Anus (structural absence), Hirschsprung's pathology — absent ganglion cells causing functional bowel obstruction, chronic constipation, megacolon — genuinely *is* a digestive-tract disease process, and "any ailment of Digestive System" reads as a reasonable direct match, not just a technically-broad catch-all. This is a real dual-plausible case, not a settled one — **withdrawing my earlier default-to-genetic call and holding it for your manual decision**, same treatment as Meckel's/Malrotation. |
| **Congenital Hip Dysplasia (DDH)** | Musculoskeletal vs. Genetic | **Genetic/Congenital, but flagged as the closest call in this pairing (72%, down from 85%).** Musculoskeletal wording ("disorder of Muscle/Bone/**Joint**...") is more specific to this condition than most organ wording is to its congenital counterpart — DDH literally is a joint disorder. What keeps it on Genetic is sibling consistency with Club Foot (an already-established, structurally near-identical precedent — both are congenital joint/limb malformations present at birth) per Part VIII invariant 5, not a clean wording win the way Gastroschisis is. If you'd rather route DDH to Musculoskeletal, Club Foot should probably move with it for the same reason — flagging that dependency rather than deciding it. |
| **Craniosynostosis** | Neurological vs. Genetic | **Genetic/Congenital, confirmed, reasoning sharpened.** This is a cranial-*bone*-suture disorder, not primarily a brain-tissue condition (secondary neuro complications like raised ICP can occur, but aren't the primary pathology). Neuro wording (stroke/epilepsy/dementia-oriented) doesn't anticipate a skeletal cranial condition at all — actually a *weaker* case for Neuro than Arnold-Chiari/Dandy-Walker were, since those are genuine brain-tissue malformations. (85%) |
| **Encephalocele** | Neurological vs. Genetic | **Genetic/Congenital, confirmed.** True neural tube defect with brain tissue itself protruding through a skull defect — the closest sibling is Spina Bifida/Anencephaly (same neural-tube-defect family, already established as Genetic since Neuro wording is acquired-disease-oriented and doesn't anticipate a developmental defect). Consistency with that established family, not just wording, is doing real work here. (90%) |

---

## Item 4 (resolved) — DiGeorge Syndrome duplicate check

Searched `TOP_PED_DICTIONARY`, all `engine.ts` regex sections, and the independently-audited 621-condition file for **"DiGeorge," "22q11," "22q11.2," "velocardiofacial," "Shprintzen," and "Di George"** (space variant) — zero matches across all three sources for any of them. Confirmed genuinely new, not a duplicate under another name. Adding it with all four as aliases (DiGeorge Syndrome as canonical, plus 22q11.2 Deletion Syndrome, Velocardiofacial Syndrome, and Shprintzen Syndrome as aliases) so future lookups under any of those names resolve to the same PED instead of risking a future duplicate entry.

---

## Part A — Updated recommendation table (only the rows that changed this round)

| Condition | v2 status | v3 status |
|---|---|---|
| Hirschsprung Disease | Genetic/Congenital, High (82%), Tier 1 | **Digestive vs. Genetic — genuinely dual, moved to held/Tier 2, not in SQL** |
| Congenital Hip Dysplasia (DDH) | Genetic/Congenital, High (85%) | Genetic/Congenital, **72%** — flagged as closest call, sibling-tied to Club Foot |
| Gastroschisis / Omphalocele / CDH / TEF / Imperforate Anus / Bladder Exstrophy | Genetic/Congenital (various) | **Unchanged verdicts, reasoning replaced with explicit organ-wording comparison (Item 2 table above)** |
| Craniosynostosis / Encephalocele | Genetic/Congenital (various) | **Unchanged verdicts, reasoning sharpened (Item 3 table above)** |
| DiGeorge Syndrome | Genetic/Congenital, High (90%), no dedupe check shown | **Unchanged verdict — dedupe check now explicit (Item 4), 3 additional aliases added** |
| Marfan Syndrome, Ehlers-Danlos Syndrome, Situs Inversus | Genetic/Congenital (unchanged categoryKey) | **Unchanged categoryKey — but now get an explicit Optima Secure `plan_overrides` row to `blood` (Item 1)** |
| Every other structural condition in A1–A4 | Genetic/Congenital | **Unchanged categoryKey — now also the implicit Optima Secure default via the `genetic` repoint (Item 1), no override row needed** |

---

## Part D — Governance principles (one addition)

Principles 1–4 and 8–9 unchanged from v2. Adding:

10. **[GOVERNANCE — new this round] "Structural/anatomical absence or malformation" is distinct from "disease of a functioning organ," and this distinction — not congenital origin — is what decides organ-vs-congenital routing for structural anomalies.** Gastroschisis/Omphalocele/Imperforate Anus/Bladder Exstrophy (wall/opening defects) vs. Meckel's/Malrotation/Hirschsprung's (functional GI pathology, genuinely dual with Digestive) is the concrete precedent for applying this test to future conditions.
11. **[GOVERNANCE — new this round] Sibling consistency can outrank a marginal wording edge.** DDH's Musculoskeletal wording match is real but not decisive on its own — Club Foot precedent is what keeps it on Genetic. Document this kind of dependency explicitly (as done here) rather than deciding siblings independently and risking drift.

`plan_overrides` note formalized: repointing a **single plan's own** `categoryMap` entry for an existing categoryKey is not a taxonomy change and doesn't require a new category — only cross-plan or shared defaults are taxonomy concerns. Worth stating this explicitly alongside principle 8 so the Optima Secure resolution isn't read as a one-off exception to it.

---

## Part F — SQL additions/changes for this round (append to v2's Part F; nothing from v2 is being re-run here, only what's new)

```sql
BEGIN;

-- ═══════════════════════════════════════════════════════════════════════
-- Item 1 — Optima Secure: repoint genetic -> disability/deformity
-- (plan_configs is per-plan JSONB; this touches ONLY Optima Secure's row).
-- ═══════════════════════════════════════════════════════════════════════

UPDATE plan_configs
SET category_map = category_map || jsonb_build_object(
  'genetic',
  'Are you having any disability / deformity including accidental or congenital?'
)
WHERE plan_name = 'Optima Secure';

-- Explicit overrides for the conditions that don't fit "deformity" wording
-- -- they keep landing on the same blood/genetic question they use today,
-- just via a documented override instead of the (now-repointed) default.
INSERT INTO plan_overrides (plan_name, ped_id, category_key, reason, added_by)
SELECT 'Optima Secure', pr.id, 'blood',
       'Systemic/syndromic genetic condition, not a structural deformity -- Optima Secure''s disability/deformity wording (now the genetic-category default on this plan) is not a good fit; keeps this on the blood/genetic-combined question instead (governance review v3).',
       'governance-review-2026-08-07-v3'
FROM ped_repository pr
WHERE pr.canonical_name IN ('Marfan Syndrome', 'Ehlers-Danlos Syndrome', 'Situs Inversus')
ON CONFLICT (plan_name, ped_id) DO UPDATE SET category_key = EXCLUDED.category_key, reason = EXCLUDED.reason;


-- ═══════════════════════════════════════════════════════════════════════
-- Item 4 — DiGeorge Syndrome: add remaining aliases (assumes the base
-- v2 INSERT for DiGeorge Syndrome -> genetic has already run; if not,
-- run v2's Part F first, then this).
-- ═══════════════════════════════════════════════════════════════════════

INSERT INTO ped_aliases (ped_id, alias_text, normalized_alias, is_primary, is_visible, added_by)
SELECT pr.id, v.alias_text, v.normalized_alias, false, true, 'governance-review-2026-08-07-v3'
FROM ped_repository pr,
     (VALUES
       ('Velocardiofacial Syndrome', 'velocardiofacial syndrome'),
       ('Shprintzen Syndrome', 'shprintzen syndrome')
     ) AS v(alias_text, normalized_alias)
WHERE pr.canonical_name = 'DiGeorge Syndrome'
ON CONFLICT (normalized_alias) DO NOTHING;


-- ═══════════════════════════════════════════════════════════════════════
-- Item 3 — Hirschsprung Disease: withdrawn from Tier 1. If v2's Part F
-- already ran and inserted it as 'genetic', this reverts it to held
-- status by removing it rather than leaving a live-but-reconsidered row.
-- Only run this if you already applied v2's Hirschsprung insert; skip
-- otherwise (nothing to undo).
-- ═══════════════════════════════════════════════════════════════════════

-- DELETE FROM ped_aliases WHERE ped_id = (SELECT id FROM ped_repository WHERE canonical_name = 'Hirschsprung Disease');
-- DELETE FROM ped_repository WHERE canonical_name = 'Hirschsprung Disease';
-- (Left commented -- only uncomment if v2 SQL was already run before this review landed.)

COMMIT;
```

---

*Still nothing applied. Item 1 is now a concrete recommendation rather than an open question — everything in this document and v2's Part F is ready whenever you give the go-ahead.*
