# Mapping Governance Review — Congenital Routing (v4)

**Status:** Governance exercise / decision support. **No repository data has been changed.** This version inverts the Optima Secure default/override direction per your feedback and adds one governance note. Everything else (Parts 0, 1–2, A1–A4, Items 2–4, D principles 1–4/8–11, E) is unchanged from v3 — only what changed is restated here.

---

## Optima Secure, inverted: Blood/Genetic stays default, structural conditions become the override list

Agreed — this is the more maintainable shape, and it also turns out cleaner mechanically, not just directionally: your version doesn't need any exception list at all (v3 needed Marfan/Ehlers-Danlos/Situs Inversus carved out as their own override; this version just leaves them alone).

**One technical detail worth flagging plainly rather than deciding silently:** with `genetic` staying put, the override needs a *different* existing categoryKey to route through — Optima Secure's `categoryMap` is a flat key→question map, one question per key, so the override target can't also be `genetic` (that would just resolve back to the same Blood/Genetic question, a no-op). I checked the full category vocabulary for one that's completely unused — not the default category for any existing PED, and not currently mapped to anything on Optima Secure or any other plan — and only one qualifies: **`ent`** (Ear, Nose & Throat). It's a pre-existing row in `categories` already (so this still adds zero new categories), but it's presently dormant everywhere: zero PEDs default to it, and no plan's `categoryMap` currently sets it.

Using it here means Optima Secure's `ent` entry (currently absent from its `categoryMap`) gets set to the disability/deformity question, and the structural-condition overrides route through it. The categoryKey string itself is never shown to advisors — only the resolved question text is — so there's no user-facing mismatch, but the internal label ("Ear, Nose & Throat") won't literally describe what it's being used for on this one plan. If that bothers you, the alternatives are: (a) leave it — it's an internal identifier with a slightly imprecise name, functionally harmless, or (b) I can draft a one-line SQL comment/doc note in the repo explaining the reuse so a future contributor isn't confused finding "ent" pointed at a congenital question. I've included that comment in the SQL below either way. Not blocking on this — proceeding with `ent` as the mechanism unless you say otherwise.

**Resulting shape:**

| | Optima Secure destination | Mechanism |
|---|---|---|
| Marfan Syndrome, Ehlers-Danlos Syndrome, Situs Inversus, every other genetic-categorized condition not listed below (Klinefelter, Turner, Noonan, Gaucher, Tay-Sachs, PKU, etc.) | Blood/Genetic question (unchanged) | Default `genetic` categoryMap — **untouched, zero rows added** |
| ASD, VSD, ToF, Congenital Heart Defect (generic), PDA, Coarctation of Aorta, TGA, Truncus Arteriosus, HLHS, TAPVR, Spina Bifida, Cleft Lip/Palate, Club Foot, Congenital Hydrocephalus, Microcephaly, Anencephaly, Arnold-Chiari, Dandy-Walker, Holoprosencephaly, Encephalocele, Craniosynostosis, Congenital Hip Dysplasia, Osteogenesis Imperfecta, Achondroplasia, Renal Agenesis, Congenital Solitary Kidney, Imperforate Anus, Choanal Atresia, Congenital Ptosis, DiGeorge Syndrome, Congenital Diaphragmatic Hernia, Gastroschisis, Omphalocele, Tracheoesophageal Fistula, Prune Belly Syndrome, Bladder Exstrophy | Disability/Deformity question | Explicit `plan_overrides` row, `category_key = 'ent'` |
| CAH, Congenital Hypothyroidism, Huntington's, Friedreich's, CMT, Spinocerebellar Ataxia, Congenital Glaucoma, Biliary Atresia | Their own established category (endocrine/neuro/eye/liver) | Unaffected by this change entirely |
| Ebstein's, Eisenmenger, Horseshoe Kidney, Duplex Kidney, Meckel's, Malrotation, Hirschsprung's | Held | Not touched until individually approved |

35 explicit override rows, zero default-path changes, zero new categories, zero schema changes, isolated to one plan.

---

## New governance principle (your addition, verbatim)

12. **[GOVERNANCE — new] The `genetic` category, when used for congenital structural anomalies, is an implementation compromise, not a medical claim.** The repository has no dedicated congenital-taxonomy category distinct from genetic/hereditary conditions. Using `genetic` for a structural malformation (e.g. Cleft Lip, Club Foot, Gastroschisis) reflects the absence of a better-fitting existing category, not an assertion that the condition is genetically inherited. Future contributors should not treat `categoryKey = 'genetic'` as medically exact for every PED that carries it — check `ped_repository.notes` or this review's history for conditions where the assignment is a placement-of-convenience rather than a clinical claim.

Added to `MASTER_CONSTITUTION.md`/`PED_REPOSITORY_GOVERNANCE.md`-ready register alongside principles 1–4, 8–11.

---

## Part F — Revised SQL for Optima Secure (replaces v3's Item 1 SQL block entirely)

```sql
BEGIN;

-- ═══════════════════════════════════════════════════════════════════════
-- Optima Secure: Blood/Genetic (`genetic`) stays the default for ALL
-- genetic-categorized PEDs, unchanged. Structural congenital anomalies
-- get an explicit override instead, routed through the `ent` categoryKey
-- (pre-existing in `categories`, otherwise unused system-wide -- see the
-- write-up above for why this specific key). No new categories, no
-- change to any other plan, no change to Optima Secure's `genetic`
-- mapping at all.
-- ═══════════════════════════════════════════════════════════════════════

-- Wire Optima Secure's dormant `ent` slot to the disability/deformity
-- question. Purely additive: zero PEDs currently default to `ent`
-- anywhere in the repository, confirmed by search, so this cannot change
-- any existing routing outcome by itself -- only the explicit overrides
-- below actually redirect anything.
UPDATE plan_configs
SET category_map = category_map || jsonb_build_object(
  'ent',
  'Are you having any disability / deformity including accidental or congenital?'
)
WHERE plan_name = 'Optima Secure';

-- NOTE for future contributors: on Optima Secure only, the `ent`
-- categoryKey is repurposed to route structural congenital anomalies to
-- this plan's disability/deformity question -- it does not mean
-- Ear/Nose/Throat here. See MAPPING_GOVERNANCE_REVIEW_CONGENITAL_v4.md
-- for the reasoning. `ent` keeps its normal ENT meaning on every other
-- plan; this is a single-plan override target, not a redefinition of the
-- category itself.

INSERT INTO plan_overrides (plan_name, ped_id, category_key, reason, added_by)
SELECT 'Optima Secure', pr.id, 'ent',
       'Structural congenital anomaly -- Optima Secure''s disability/deformity wording is a more specific match than the default Blood/Genetic question (governance review v4). NOTE: category_key ''ent'' is repurposed as a routing target only on this plan; see governance doc.',
       'governance-review-2026-08-07-v4'
FROM ped_repository pr
WHERE pr.canonical_name IN (
  'Atrial Septal Defect', 'Ventricular Septal Defect', 'Tetralogy of Fallot',
  'Congenital Heart Defect', 'Patent Ductus Arteriosus', 'Coarctation of Aorta',
  'Transposition of Great Arteries', 'Truncus Arteriosus',
  'Hypoplastic Left Heart Syndrome', 'Total Anomalous Pulmonary Venous Return',
  'Spina Bifida', 'Cleft Lip Cleft Palate', 'Clubfoot Deformity',
  'Congenital Hydrocephalus', 'Microcephaly', 'Anencephaly',
  'Arnold-Chiari Malformation', 'Dandy-Walker Malformation', 'Holoprosencephaly',
  'Encephalocele', 'Craniosynostosis', 'Congenital Hip Dysplasia',
  'Osteogenesis Imperfecta', 'Achondroplasia', 'Renal Agenesis',
  'Congenital Solitary Kidney', 'Imperforate Anus', 'Choanal Atresia',
  'Congenital Ptosis', 'DiGeorge Syndrome', 'Congenital Diaphragmatic Hernia',
  'Gastroschisis', 'Omphalocele', 'Tracheoesophageal Fistula',
  'Prune Belly Syndrome', 'Bladder Exstrophy'
  -- NOTE: canonical_name spellings above match this review's proposed
  -- INSERTs (v2/v3 Part F) and the existing TOP_PED_DICTIONARY canonical
  -- forms (Clubfoot Deformity, Cleft Lip Cleft Palate). Confirm exact
  -- canonical_name in ped_repository before running in case any differ.
)
ON CONFLICT (plan_name, ped_id) DO UPDATE SET category_key = EXCLUDED.category_key, reason = EXCLUDED.reason;

-- Marfan Syndrome, Ehlers-Danlos Syndrome, Situs Inversus: no action --
-- they were never going to be overridden in this direction. They simply
-- stay on the untouched `genetic` default (Blood/Genetic question).

COMMIT;
```

This replaces v3's Item 1 SQL block (the `genetic` repoint + the Marfan/Ehlers-Danlos/Situs Inversus override-to-`blood` rows) entirely — don't run both, only this v4 version. Every other SQL block from v2/v3's Part F (the Tier 1 recategorizations, the coverage additions, the DiGeorge aliases, the Hirschsprung withdrawal) is unaffected and still stands as-is.

---

*Still nothing applied. This is now the complete, internally-consistent recommendation set across v2/v3/v4 — say the word when you want to sequence through applying it.*
