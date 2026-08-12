# Optima Secure `genetic` Category Repoint — Impact Assessment (Revised, 2026-08-08)

**Status: read-only validation. No SQL executed, no repository or plan_config data modified.** This revises the initial assessment after adding 11 further `plan_overrides` rows (Part F of `MAPPING_GOVERNANCE_REVIEW_CONGENITAL_FINAL.md`) to close every gap the first pass found.

**Scope:** every PED currently assigned `categoryKey = 'genetic'` in the repository, and what happens to each one once Optima Secure's `genetic` → question mapping is repointed from Blood/Genetic to Disability/Deformity, with the now-complete set of overrides applied.

**Data source caveat, unchanged:** built from `TOP_PED_DICTIONARY` cross-checked against the independently audited `600_conditions_corrected_database.json` (identical 33-entry/23-canonical-PED set in both). Run this against the live DB before executing, same as before:

```sql
SELECT canonical_name, category_key, status FROM ped_repository WHERE category_key = 'genetic' ORDER BY canonical_name;
SELECT plan_name, ped_id, category_key, reason FROM plan_overrides WHERE plan_name = 'Optima Secure' ORDER BY ped_id;
```

---

## What changed since the first pass

The first assessment (2026-08-07) found 11 of 23 current `genetic` PEDs would move to Disability/Deformity unreviewed. Since then:

- 7 were reviewed and given explicit `blood` overrides for being diseases of blood/enzyme/organ function, not deformities: Spinal Muscular Atrophy, G6PD Deficiency, Cystic Fibrosis, Pompe Disease, Gaucher Disease, Alpha-1 Antitrypsin Deficiency, Enzyme Deficiency (generic).
- 4 were reviewed on wording grounds in a dedicated deep-dive (`OPTIMA_SECURE_SYNDROMIC_CONDITIONS_REVIEW.md`) and also given explicit `blood` overrides: Down Syndrome, Turner Syndrome, Klinefelter Syndrome, Noonan Syndrome. Noonan Syndrome was flagged there as the closest call of the four — worth a second look if you want to revisit it, but the recommendation stands unless you say otherwise.
- Situs Inversus was dropped from the override list — it isn't in the repository and isn't created anywhere in this script, so the original override would have silently matched 0 rows.

---

## Full current state, all 23 PEDs

| PED | Current Optima Secure Q | New Optima Secure Q after repoint | Status |
|---|---|---|---|
| Congenital Heart Defect (generic) | Blood/Genetic | Disability/Deformity | Reviewed & approved |
| Atrial Septal Defect (ASD) | Blood/Genetic | Disability/Deformity | Reviewed & approved |
| Ventricular Septal Defect (VSD) | Blood/Genetic | Disability/Deformity | Reviewed & approved |
| Tetralogy of Fallot | Blood/Genetic | Disability/Deformity | Reviewed & approved |
| Spina Bifida | Blood/Genetic | Disability/Deformity | Reviewed & approved |
| Cleft Lip / Cleft Palate | Blood/Genetic | Disability/Deformity | Reviewed & approved |
| Clubfoot Deformity | Blood/Genetic | Disability/Deformity | Reviewed & approved |
| Osteogenesis Imperfecta | Blood/Genetic | Disability/Deformity | Reviewed & approved |
| Achondroplasia | Blood/Genetic | Disability/Deformity | Reviewed & approved |
| Spinocerebellar Ataxia | Blood/Genetic | *N/A — reclassified to `neuro` earlier in the same script, no longer `genetic` when repoint runs* | Reviewed & approved (excluded, not repoint-affected) |
| Marfan Syndrome | Blood/Genetic | Blood/Genetic (override → `blood`) | Reviewed & protected by override |
| Ehlers-Danlos Syndrome | Blood/Genetic | Blood/Genetic (override → `blood`) | Reviewed & protected by override |
| Spinal Muscular Atrophy | Blood/Genetic | Blood/Genetic (override → `blood`) | **Reviewed 2026-08-08 & protected by override** |
| G6PD Deficiency | Blood/Genetic | Blood/Genetic (override → `blood`) | **Reviewed 2026-08-08 & protected by override** |
| Cystic Fibrosis | Blood/Genetic | Blood/Genetic (override → `blood`) | **Reviewed 2026-08-08 & protected by override** |
| Pompe Disease | Blood/Genetic | Blood/Genetic (override → `blood`) | **Reviewed 2026-08-08 & protected by override** |
| Gaucher Disease | Blood/Genetic | Blood/Genetic (override → `blood`) | **Reviewed 2026-08-08 & protected by override** |
| Alpha-1 Antitrypsin Deficiency | Blood/Genetic | Blood/Genetic (override → `blood`) | **Reviewed 2026-08-08 & protected by override** |
| Enzyme Deficiency (generic) | Blood/Genetic | Blood/Genetic (override → `blood`) | **Reviewed 2026-08-08 & protected by override** |
| Down Syndrome | Blood/Genetic | Blood/Genetic (override → `blood`) | **Reviewed 2026-08-08 & protected by override** |
| Turner Syndrome | Blood/Genetic | Blood/Genetic (override → `blood`) | **Reviewed 2026-08-08 & protected by override** |
| Klinefelter Syndrome | Blood/Genetic | Blood/Genetic (override → `blood`) | **Reviewed 2026-08-08 & protected by override** |
| Noonan Syndrome | Blood/Genetic | Blood/Genetic (override → `blood`) | **Reviewed 2026-08-08 & protected by override — closest call, flagged** |

---

## 3. PEDs not part of the governance review whose routing would still change

**None.** Every one of the 23 current `genetic` PEDs now falls into one of three fully-reviewed buckets: intentionally moved to Disability/Deformity (9), protected on Blood/Genetic by explicit override (13), or excluded from the repoint entirely by an earlier reclassification (1, Spinocerebellar Ataxia). Zero PEDs are left to change routing as an unreviewed side effect.

## 4. Conditions that deserve another look before applying

- **Noonan Syndrome** — the one recommendation in this batch that's a genuine judgment call rather than a clear-cut case (see `OPTIMA_SECURE_SYNDROMIC_CONDITIONS_REVIEW.md`). Confirm you're comfortable with Blood/Genetic before running, or say if you'd rather route it to Disability/Deformity given its structural features.
- **Situs Inversus** — confirmed out of scope; no action needed unless you want to add it as its own reviewed PED in a follow-up.
- Everything else: no open items.

---

## Summary

```
Total genetic PEDs: 23
Reviewed congenital structural anomalies: 9
Protected by explicit plan overrides: 13
Unaffected by routing change: 1
Changed only because of category repoint: 0

Potential manual review candidates:
- Noonan Syndrome (Blood/Genetic recommended, but flagged as the closest call of the 4 syndromic additions — confirm before running)
```

## Final recommendation

**Safe to Apply – No unexpected routing changes detected.**

Every genetic-categorized PED in the repository now has an explicit, reasoned routing outcome for the Optima Secure repoint — nothing moves as an unreviewed side effect. The one open item (Noonan Syndrome) is a documented judgment call, not an unexpected change; apply as-is or flip that one override first, your call.
