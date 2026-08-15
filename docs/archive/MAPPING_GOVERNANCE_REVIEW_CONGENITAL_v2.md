# Mapping Governance Review — Congenital Routing (v2)

**Status:** Governance exercise / decision support, revised per your architectural feedback. **No repository data has been changed.** SQL scripts in Part F are for your review only.

**What changed since v1:** the `congenital_disability` category has been withdrawn entirely — categories now stay medical-classification-only, per your Part 1/2 directive. Item-3 recommendations are now marked **approved** rather than pending. Item-4 conditions are explicitly held out of all SQL. Two new governance principles are added verbatim (Part D, items 8–9). Thirteen newly-requested conditions are researched and added (Part A4). A re-verification pass is recorded (Part 8). The Optima Secure disability/deformity question is addressed honestly as a real architectural constraint rather than forced into a solution — see Part 3 below, this is the one place I'm asking you to make a call rather than presenting a finished recommendation.

---

## Part 0 — Governing principles (now three, all approved by you)

1. **Congenital is not a default.** The declaration question whose wording most specifically represents the condition wins — organ-specific wording beats generic congenital wording whenever it's the more precise match (unchanged from v1).
2. **[New — your item 5] Categories represent medical classification only, never insurer phrasing.** A category must describe the medical nature of a condition. If a plan phrases its question differently from other plans, that's a `plan_overrides` concern, never a reason to add or reshape a `categories` row. This is why `congenital_disability` is gone.
3. **[New — your item 6] Specificity, not congenital status, drives routing when multiple questions are medically applicable.** Congenital origin alone must never be the deciding factor — restated formally here alongside principle 1 because you asked for it as its own numbered rule, not just folded into principle 1's prose.

Full registration-ready wording for `MASTER_CONSTITUTION.md` Part IX/XV is in Part D.

---

## Part 1–2 — Architecture correction applied throughout

Every recommendation below now assumes exactly your diagram:

```
PED → Medical Category → Plan-specific Override (if any) → Category Mapping → Question
```

Concretely: `ped_repository.category_key` is always one of the existing, medically-meaningful keys (`genetic`, `heart`, `neuro`, `kidney`, `endocrine`, `liver`, `digestive`, `eye`, `ent`, `musculoskeletal`, etc.) — never a new plan-shaped key. Where a plan needs different routing for a specific PED, that's a `plan_overrides` row pointing at a **different existing category**, not a new one. No SQL in Part F creates a `categories` row.

---

## Part 3 — Optima Secure's disability/deformity question: a real constraint, not a finished recommendation

I want to be straightforward rather than quietly force a fix here: **your no-new-category rule and the "route some (not all) congenital PEDs to Optima Secure's disability/deformity question" goal are in genuine tension under the current schema, and I don't think it's mine to resolve unilaterally.**

Here's the mechanics of why. `plan_overrides` has exactly one column for the destination: `category_key`, which must be an existing `categories` row. Resolution always goes `categoryKey → that plan's own categoryMap[categoryKey] → one question`. That means **a single categoryKey can only ever resolve to one question per plan.** On Optima Secure, `genetic` already resolves to *"Any Blood disorder... or any genetic disorder?"* — and that's correct for some genetic PEDs (Marfan, Ehlers-Danlos, Klinefelter, etc., which have nothing to do with "disability/deformity"). But you specifically want a *subset* of genetic/congenital PEDs (Club Foot, Cleft Lip/Palate, Spina Bifida, Achondroplasia — the ones that are literally structural deformities) to land on the *other* question instead, while the rest of the genetic-categorized PEDs stay put.

That per-condition split, within one plan, for one shared category, is exactly what a single `categoryKey → single question` mapping can't express — not without either:
- **(a)** a second categoryKey to distinguish the two groups (the thing you've ruled out), or
- **(b)** extending `plan_overrides` with an optional literal question-text override column, bypassing the categoryKey→categoryMap indirection for just these rows (a schema change, and arguably a small architecture change even if it adds no new routing *stage* — I don't think I should propose implementing this without you weighing in, especially given your item 9).

**What I'm doing instead:** leaving Optima Secure's routing exactly as it is today (all genetic/congenital PEDs → the blood/genetic question, unchanged), and not including any SQL for this in Part F. If you want to pursue this further, it's genuinely your call between (a) revisiting the no-new-category rule specifically for this one case, (b) a small schema addition like (b) above, or (c) deciding the blood/genetic question is actually fine as the sole destination and dropping this goal. I'd rather hand you that decision cleanly than build something that only nominally satisfies the letter of "no new category."

---

## Part A — Governance Review (unchanged sections re-affirmed, new section added)

**A1 (previously-flagged 8 conditions) and A2 (original ASD-pattern 11 conditions) are unchanged from v1** — full tables are in `MAPPING_GOVERNANCE_REVIEW_CONGENITAL.md`. Status update only:

| Condition | v1 recommendation | Status now |
|---|---|---|
| Huntington's Disease → Neurological | Medium (75%) | **Approved by you (item 3) — Tier 1, ready SQL** |
| Friedreich's Ataxia → Neurological | High (85%) | **Approved by you (item 3) — Tier 1, ready SQL** |
| Charcot-Marie-Tooth → Neurological | High (88%) | **Approved by you (item 3) — Tier 1, ready SQL** (was already current behavior — no change needed, confirmed here) |
| Spinocerebellar Ataxia → Neurological (standardize) | High (80%) | **Approved by you (item 3) — Tier 1, ready SQL** |
| Hydrocephalus → split congenital/acquired | Medium (70%) | **Approved by you (item 3) — Tier 1, ready SQL** |
| Marfan / Ehlers-Danlos / CAH / all A2 conditions | as stated | Unchanged, already reflect the "most specific wording" principle |

**A3 (30-condition expansion from your original Section 5) is unchanged from v1** — all recommendations stand, tiered exactly as before (Ebstein's, Eisenmenger, Horseshoe/Duplex Kidney, Meckel's, Malrotation, Congenital Glaucoma remain Medium-confidence and are excluded from SQL per your item 4 — see the explicit list below).

### A4 — The 13 newly-requested conditions (your item 7)

**Duplicate check first:** none of these 13 appear in `TOP_PED_DICTIONARY`, any `engine.ts` regex section, or the independently-audited 621-condition file — confirmed by direct search of all three sources, not assumed. No renames or merges needed; these are genuinely new additions.

| Condition | Recommended Category | Confidence | Reasoning |
|---|---|---|---|
| DiGeorge Syndrome (22q11.2 deletion) | Congenital/Genetic | High (90%) | Multi-organ by nature (cardiac defects + immune deficiency + hypocalcemia + facial/developmental features) — same "no single organ question fits" logic as Marfan/Ehlers-Danlos. |
| Hirschsprung Disease | Congenital/Genetic | High (82%) | Developmental absence of colonic ganglion cells causing neonatal obstruction — a structural/developmental defect presenting in infancy, closer to Imperforate Anus than to an acquired digestive disease. |
| **Biliary Atresia** | **Liver** (not Congenital/Genetic) | Medium-High (78%) | **This is a "congenital should not win" case, parallel to CAH/Congenital Hypothyroidism.** Congenital in origin, but its entire clinical course and underwriting risk — progressive cholestasis, jaundice, cirrhosis, transplant risk — is a liver disease. Every sampled plan's Liver question wording ("Liver or Gall Bladder ailment / Jaundice...") names jaundice directly, an exact-symptom wording match beating the generic congenital label. Flagging this one specifically since it's a less obvious call than the others. |
| Congenital Diaphragmatic Hernia | Congenital/Genetic | High (88%) | Structural diaphragm defect present at birth; no plan's Respiratory wording (asthma/TB/COPD-oriented) anticipates it. |
| Gastroschisis | Congenital/Genetic | High (90%) | Abdominal wall defect present at birth, no covering sac — clearly structural, not a digestive disease. |
| Omphalocele | Congenital/Genetic | High (90%) | Same reasoning as Gastroschisis (with covering sac; often syndromic). |
| Tracheoesophageal Fistula | Congenital/Genetic | High (88%) | Structural malformation, not captured by Digestive or Respiratory disease wording. |
| Congenital Hip Dysplasia (DDH) | Congenital/Genetic | High (85%) | Developmental joint malformation, present at/near birth — Musculoskeletal wording (arthritis/fracture) is acquired-disease-only, same logic as Club Foot. |
| Craniosynostosis | Congenital/Genetic | High (85%) | Premature skull-suture fusion present at birth — Neuro wording (stroke/epilepsy/MS) doesn't anticipate a structural skull malformation, same logic as Arnold-Chiari/Dandy-Walker. |
| Encephalocele | Congenital/Genetic | High (92%) | Neural-tube defect, sibling condition to Spina Bifida/Anencephaly — same established family. |
| Situs Inversus | Congenital/Genetic | Medium-High (75%) | Structural mirror-image organ arrangement, often incidental/asymptomatic. Same "is it even declarable if asymptomatic" caveat as Horseshoe/Duplex Kidney — flagging, not resolving that business question. If declared, no single organ question fits since it isn't a disease of any one organ system. |
| Prune Belly Syndrome | Congenital/Genetic | High (88%) | Multi-organ triad (abdominal wall + urinary tract + reproductive) — another clean "no single organ question fits" case. |
| Bladder Exstrophy | Congenital/Genetic | High (85%) | Structural genitourinary defect present at birth — Kidney/urinary wording (stones, CKD, dialysis, UTI) is acquired-disease-only. |

---

## Part 8 — Re-verification pass (your item 8), findings

**Conditions where congenital should NOT win (complete list across both reviews):**
- Congenital Adrenal Hyperplasia → Endocrine
- Congenital Hypothyroidism → Endocrine
- Congenital Glaucoma → Eye (plan-dependent — verify each plan's wording names "glaucoma" before applying)
- **Biliary Atresia → Liver** (new finding, this pass)

No other candidates emerged on re-scan of the full condition set (A1–A4) against every plan's actual question wording — the four above remain the complete "organ-specific wins" list.

**Conditions where a plan-specific override is more appropriate than a category change:**
- Only one candidate found: **Optima Secure's disability/deformity question (Part 3 above)** — and as detailed there, it can't be expressed as a plan_override alone without either a new category or a schema change, so it's left as an open question for you rather than SQL.
- No other plan/condition combination in this review needs an override — every other recommendation is a category-level change that applies correctly across all plans by design (that's the point of category-level routing).

**Remaining dictionary/repository/regex inconsistencies found:**
- Huntington's: dictionary says `neuro`, `engine.ts` §16b regex trigger list separately includes the bare token `huntington` → `genetic`. Fix scripted in Part F (remove the token from the regex list).
- Spinocerebellar Ataxia: two alias variants disagree (`genetic` vs `neuro`) in the audited 621-condition file. Fix scripted in Part F (standardize to `neuro`).
- No further inconsistencies found among the A4 additions (they're new entries with no prior conflicting data) or among A1–A3 on this re-scan.

---

## Part 9 — Architecture preservation confirmation (your item 9)

Confirmed by re-reading every proposed change against `MASTER_CONSTITUTION.md` Part IV's 8-stage execution order:

- No new routing stage is introduced. Every change is data (`ped_repository.category_key`, `ped_aliases`, `plan_overrides.category_key`, one `engine.ts` regex-list edit removing a token) — stage 5 (dictionary/DB-alias lookup) and stage 2 (plan overrides) still resolve exactly as documented, just with more/corrected data behind them.
- No new categoryKey is added to the `categories` table (v1's `congenital_disability` is fully withdrawn).
- The flow stays exactly `Canonical PED → Medical Category → Plan Override (if any) → Category Mapping → Question`, falling through to Gemini review only when no stage matches, unchanged.
- The one item left unresolved (Optima Secure, Part 3) is left unresolved specifically *because* solving it would have required touching this architecture — consistent with your instruction not to.

---

## Part C — Missing conditions still worth considering (unchanged from v1, the 13 above have graduated out of this list into Part A4)

Held at the same "not exhaustively vetted, offered as candidates" status as v1 — nothing here has been researched to the Part A4 standard yet: Neonatal/Congenital Diabetes, Congenital Myasthenic Syndrome. (Every other v1 Part C item was formally researched and promoted into Part A4 this round.)

---

## Part D — Governance rules to formally register (updated)

1. **[GOVERNANCE] Congenital is not a default** *(unchanged from v1)*.
2. **[GOVERNANCE] Manifestation/complication conditions must be escalated, not defaulted** *(unchanged — Eisenmenger Syndrome example)*.
3. **[GOVERNANCE] Sibling/synonym consistency check required before adding related conditions** *(unchanged — Huntington's, Spinocerebellar Ataxia examples)*.
4. **[GOVERNANCE] Polarity-sensitive terms need qualified aliases, not one bare token** *(unchanged — Hydrocephalus example)*.
5. ~~Plan-specific "closer wording" questions require a dedicated categoryKey~~ **— superseded, withdrawn.** Replaced by rule 8 below.
6. **[BUSINESS — escalated] Eisenmenger Syndrome's category needs an owner decision.**
7. **[BUSINESS — escalated] Whether "often-incidental" congenital findings need declaring at all** (Horseshoe Kidney, Duplex Kidney, Situs Inversus) is separate from which category they'd fall under.
8. **[GOVERNANCE — your item 5, verbatim] Medical categories must always represent the medical condition itself — not the declaration question ultimately selected by a particular insurer. Plan-specific routing should be handled through `plan_overrides`, not by changing the underlying medical taxonomy.**
9. **[GOVERNANCE — your item 6, verbatim] If multiple declaration questions are medically applicable, the engine should choose the question whose wording most specifically represents the condition. Congenital status alone should never automatically determine routing.**
10. **[BUSINESS — new, escalated] Optima Secure's disability/deformity question (Part 3):** whether to revisit the no-new-category rule for this one case, extend `plan_overrides` with a literal-text-override column, or accept the status quo. Not resolved in this review.

---

## Part F — Repository changes: revised, ready-to-run SQL

**Everything from v1's Part F that touched `categories` or created an Optima Secure override is removed.** What remains:

```sql
BEGIN;

-- ═══════════════════════════════════════════════════════════════════════
-- TIER 1 — Recategorizations you explicitly approved (item 3). Existing
-- (condition, plan) outputs change for these — Behavioral regressions per
-- Constitution Part XII, but intentional and now approved.
-- ═══════════════════════════════════════════════════════════════════════

-- Huntington's Disease -> neuro (dictionary already correct; this just
-- removes the conflicting regex trigger so no phrasing can hit the wrong
-- category). Apply this as a one-line edit to engine.ts, not SQL:
--   Line ~1350: remove `huntington` from the §16b regex alternation list.
-- (Left as a code-edit note, not SQL, since it's an engine.ts regex list,
-- not repository data -- flagging so it isn't missed.)

UPDATE ped_repository SET category_key = 'neuro', updated_at = now()
WHERE canonical_name ILIKE 'Huntington%' AND category_key <> 'neuro';

-- Friedreich's Ataxia -> neuro (confirm/enforce; dictionary already says
-- this, included for completeness/idempotency)
UPDATE ped_repository SET category_key = 'neuro', updated_at = now()
WHERE canonical_name ILIKE 'Friedreich%Ataxia';

-- Charcot-Marie-Tooth -> neuro (confirm/enforce; already current behavior)
UPDATE ped_repository SET category_key = 'neuro', updated_at = now()
WHERE canonical_name ILIKE 'Charcot%Marie%Tooth%';

-- Spinocerebellar Ataxia -> standardize to neuro (fixes the two-alias
-- disagreement found in the audited file)
UPDATE ped_repository SET category_key = 'neuro', updated_at = now()
WHERE canonical_name ILIKE 'Spinocerebellar Ataxia';
-- If a second live ped_repository row exists for a
-- "Spinocerebellar Ataxia (genetic)" style duplicate, merge it into this
-- one per PED_REPOSITORY_GOVERNANCE.md rule 3 (aliases re-pointed, duplicate
-- marked status='deprecated' + merged_into_id) rather than leaving two rows.
-- Recommend doing that merge step in the admin UI so you can pick which
-- row is canonical.

-- Hydrocephalus: split into congenital vs acquired/NPH variants.
DO $$
DECLARE
  new_id integer;
BEGIN
  -- Ensure a "Congenital Hydrocephalus" PED exists, explicitly genetic.
  IF NOT EXISTS (SELECT 1 FROM ped_repository WHERE canonical_name ILIKE 'Congenital Hydrocephalus') THEN
    INSERT INTO ped_repository (ped_code, canonical_name, category_key, status, added_by)
    VALUES ('PED-PENDING', 'Congenital Hydrocephalus', 'genetic', 'approved', 'governance-review-2026-08-07-v2')
    RETURNING id INTO new_id;
    UPDATE ped_repository SET ped_code = 'PED-' || lpad(new_id::text, 6, '0') WHERE id = new_id;
    INSERT INTO ped_aliases (ped_id, alias_text, normalized_alias, is_primary, is_visible, added_by) VALUES
      (new_id, 'Congenital Hydrocephalus', 'congenital hydrocephalus', true, true, 'governance-review-2026-08-07-v2');
  END IF;

  -- Ensure a distinct "Normal Pressure Hydrocephalus" PED exists, routed neuro.
  IF NOT EXISTS (SELECT 1 FROM ped_repository WHERE canonical_name ILIKE 'Normal Pressure Hydrocephalus') THEN
    INSERT INTO ped_repository (ped_code, canonical_name, category_key, status, added_by)
    VALUES ('PED-PENDING', 'Normal Pressure Hydrocephalus', 'neuro', 'approved', 'governance-review-2026-08-07-v2')
    RETURNING id INTO new_id;
    UPDATE ped_repository SET ped_code = 'PED-' || lpad(new_id::text, 6, '0') WHERE id = new_id;
    INSERT INTO ped_aliases (ped_id, alias_text, normalized_alias, is_primary, is_visible, added_by) VALUES
      (new_id, 'Normal Pressure Hydrocephalus', 'normal pressure hydrocephalus', true, true, 'governance-review-2026-08-07-v2'),
      (new_id, 'Acquired Hydrocephalus', 'acquired hydrocephalus', false, true, 'governance-review-2026-08-07-v2');
  END IF;
END $$;
-- Bare "hydrocephalus" (no qualifier) is left on its existing engine.ts
-- §16b regex default (genetic) as the documented fallback for
-- unqualified input, per Part D rule 4 -- no change needed there.


-- ═══════════════════════════════════════════════════════════════════════
-- TIER 1 continued — Coverage-only additions from v1 (Part A3), unchanged,
-- zero regression risk (nothing existing changes; these PEDs currently
-- fall to AI fallback). High-confidence rows only.
-- ═══════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  new_id integer;
BEGIN
  INSERT INTO ped_repository (ped_code, canonical_name, category_key, status, added_by)
  VALUES ('PED-PENDING', 'Patent Ductus Arteriosus', 'genetic', 'approved', 'governance-review-2026-08-07-v2')
  RETURNING id INTO new_id;
  UPDATE ped_repository SET ped_code = 'PED-' || lpad(new_id::text, 6, '0') WHERE id = new_id;
  INSERT INTO ped_aliases (ped_id, alias_text, normalized_alias, is_primary, is_visible, added_by) VALUES
    (new_id, 'Patent Ductus Arteriosus', 'patent ductus arteriosus', true, true, 'governance-review-2026-08-07-v2'),
    (new_id, 'PDA', 'pda', false, true, 'governance-review-2026-08-07-v2');

  INSERT INTO ped_repository (ped_code, canonical_name, category_key, status, added_by)
  VALUES ('PED-PENDING', 'Coarctation of Aorta', 'genetic', 'approved', 'governance-review-2026-08-07-v2')
  RETURNING id INTO new_id;
  UPDATE ped_repository SET ped_code = 'PED-' || lpad(new_id::text, 6, '0') WHERE id = new_id;
  INSERT INTO ped_aliases (ped_id, alias_text, normalized_alias, is_primary, is_visible, added_by) VALUES
    (new_id, 'Coarctation of Aorta', 'coarctation of aorta', true, true, 'governance-review-2026-08-07-v2');

  INSERT INTO ped_repository (ped_code, canonical_name, category_key, status, added_by)
  VALUES ('PED-PENDING', 'Transposition of Great Arteries', 'genetic', 'approved', 'governance-review-2026-08-07-v2')
  RETURNING id INTO new_id;
  UPDATE ped_repository SET ped_code = 'PED-' || lpad(new_id::text, 6, '0') WHERE id = new_id;
  INSERT INTO ped_aliases (ped_id, alias_text, normalized_alias, is_primary, is_visible, added_by) VALUES
    (new_id, 'Transposition of Great Arteries', 'transposition of great arteries', true, true, 'governance-review-2026-08-07-v2'),
    (new_id, 'TGA', 'tga', false, true, 'governance-review-2026-08-07-v2');

  INSERT INTO ped_repository (ped_code, canonical_name, category_key, status, added_by)
  VALUES ('PED-PENDING', 'Truncus Arteriosus', 'genetic', 'approved', 'governance-review-2026-08-07-v2')
  RETURNING id INTO new_id;
  UPDATE ped_repository SET ped_code = 'PED-' || lpad(new_id::text, 6, '0') WHERE id = new_id;
  INSERT INTO ped_aliases (ped_id, alias_text, normalized_alias, is_primary, is_visible, added_by) VALUES
    (new_id, 'Truncus Arteriosus', 'truncus arteriosus', true, true, 'governance-review-2026-08-07-v2');

  INSERT INTO ped_repository (ped_code, canonical_name, category_key, status, added_by)
  VALUES ('PED-PENDING', 'Hypoplastic Left Heart Syndrome', 'genetic', 'approved', 'governance-review-2026-08-07-v2')
  RETURNING id INTO new_id;
  UPDATE ped_repository SET ped_code = 'PED-' || lpad(new_id::text, 6, '0') WHERE id = new_id;
  INSERT INTO ped_aliases (ped_id, alias_text, normalized_alias, is_primary, is_visible, added_by) VALUES
    (new_id, 'Hypoplastic Left Heart Syndrome', 'hypoplastic left heart syndrome', true, true, 'governance-review-2026-08-07-v2'),
    (new_id, 'HLHS', 'hlhs', false, true, 'governance-review-2026-08-07-v2');

  INSERT INTO ped_repository (ped_code, canonical_name, category_key, status, added_by)
  VALUES ('PED-PENDING', 'Total Anomalous Pulmonary Venous Return', 'genetic', 'approved', 'governance-review-2026-08-07-v2')
  RETURNING id INTO new_id;
  UPDATE ped_repository SET ped_code = 'PED-' || lpad(new_id::text, 6, '0') WHERE id = new_id;
  INSERT INTO ped_aliases (ped_id, alias_text, normalized_alias, is_primary, is_visible, added_by) VALUES
    (new_id, 'Total Anomalous Pulmonary Venous Return', 'total anomalous pulmonary venous return', true, true, 'governance-review-2026-08-07-v2'),
    (new_id, 'TAPVR', 'tapvr', false, true, 'governance-review-2026-08-07-v2');

  INSERT INTO ped_repository (ped_code, canonical_name, category_key, status, added_by)
  VALUES ('PED-PENDING', 'Arnold-Chiari Malformation', 'genetic', 'approved', 'governance-review-2026-08-07-v2')
  RETURNING id INTO new_id;
  UPDATE ped_repository SET ped_code = 'PED-' || lpad(new_id::text, 6, '0') WHERE id = new_id;
  INSERT INTO ped_aliases (ped_id, alias_text, normalized_alias, is_primary, is_visible, added_by) VALUES
    (new_id, 'Arnold-Chiari Malformation', 'arnold chiari malformation', true, true, 'governance-review-2026-08-07-v2'),
    (new_id, 'Chiari Malformation', 'chiari malformation', false, true, 'governance-review-2026-08-07-v2');

  INSERT INTO ped_repository (ped_code, canonical_name, category_key, status, added_by)
  VALUES ('PED-PENDING', 'Dandy-Walker Malformation', 'genetic', 'approved', 'governance-review-2026-08-07-v2')
  RETURNING id INTO new_id;
  UPDATE ped_repository SET ped_code = 'PED-' || lpad(new_id::text, 6, '0') WHERE id = new_id;
  INSERT INTO ped_aliases (ped_id, alias_text, normalized_alias, is_primary, is_visible, added_by) VALUES
    (new_id, 'Dandy-Walker Malformation', 'dandy walker malformation', true, true, 'governance-review-2026-08-07-v2'),
    (new_id, 'Dandy-Walker Syndrome', 'dandy walker syndrome', false, true, 'governance-review-2026-08-07-v2');

  INSERT INTO ped_repository (ped_code, canonical_name, category_key, status, added_by)
  VALUES ('PED-PENDING', 'Holoprosencephaly', 'genetic', 'approved', 'governance-review-2026-08-07-v2')
  RETURNING id INTO new_id;
  UPDATE ped_repository SET ped_code = 'PED-' || lpad(new_id::text, 6, '0') WHERE id = new_id;
  INSERT INTO ped_aliases (ped_id, alias_text, normalized_alias, is_primary, is_visible, added_by) VALUES
    (new_id, 'Holoprosencephaly', 'holoprosencephaly', true, true, 'governance-review-2026-08-07-v2');

  INSERT INTO ped_repository (ped_code, canonical_name, category_key, status, added_by)
  VALUES ('PED-PENDING', 'Renal Agenesis', 'genetic', 'approved', 'governance-review-2026-08-07-v2')
  RETURNING id INTO new_id;
  UPDATE ped_repository SET ped_code = 'PED-' || lpad(new_id::text, 6, '0') WHERE id = new_id;
  INSERT INTO ped_aliases (ped_id, alias_text, normalized_alias, is_primary, is_visible, added_by) VALUES
    (new_id, 'Renal Agenesis', 'renal agenesis', true, true, 'governance-review-2026-08-07-v2');

  INSERT INTO ped_repository (ped_code, canonical_name, category_key, status, added_by)
  VALUES ('PED-PENDING', 'Congenital Solitary Kidney', 'genetic', 'approved', 'governance-review-2026-08-07-v2')
  RETURNING id INTO new_id;
  UPDATE ped_repository SET ped_code = 'PED-' || lpad(new_id::text, 6, '0') WHERE id = new_id;
  INSERT INTO ped_aliases (ped_id, alias_text, normalized_alias, is_primary, is_visible, added_by) VALUES
    (new_id, 'Congenital Solitary Kidney', 'congenital solitary kidney', true, true, 'governance-review-2026-08-07-v2');

  INSERT INTO ped_repository (ped_code, canonical_name, category_key, status, added_by)
  VALUES ('PED-PENDING', 'Imperforate Anus', 'genetic', 'approved', 'governance-review-2026-08-07-v2')
  RETURNING id INTO new_id;
  UPDATE ped_repository SET ped_code = 'PED-' || lpad(new_id::text, 6, '0') WHERE id = new_id;
  INSERT INTO ped_aliases (ped_id, alias_text, normalized_alias, is_primary, is_visible, added_by) VALUES
    (new_id, 'Imperforate Anus', 'imperforate anus', true, true, 'governance-review-2026-08-07-v2');

  INSERT INTO ped_repository (ped_code, canonical_name, category_key, status, added_by)
  VALUES ('PED-PENDING', 'Congenital Hypothyroidism', 'endocrine', 'approved', 'governance-review-2026-08-07-v2')
  RETURNING id INTO new_id;
  UPDATE ped_repository SET ped_code = 'PED-' || lpad(new_id::text, 6, '0') WHERE id = new_id;
  INSERT INTO ped_aliases (ped_id, alias_text, normalized_alias, is_primary, is_visible, added_by) VALUES
    (new_id, 'Congenital Hypothyroidism', 'congenital hypothyroidism', true, true, 'governance-review-2026-08-07-v2');
END $$;


-- ═══════════════════════════════════════════════════════════════════════
-- TIER 1 continued — The 13 newly-requested conditions (Part A4).
-- Biliary Atresia is called out separately below since it's the one
-- non-obvious call in this batch (Liver, not genetic).
-- ═══════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  new_id integer;
BEGIN
  INSERT INTO ped_repository (ped_code, canonical_name, category_key, status, added_by)
  VALUES ('PED-PENDING', 'DiGeorge Syndrome', 'genetic', 'approved', 'governance-review-2026-08-07-v2')
  RETURNING id INTO new_id;
  UPDATE ped_repository SET ped_code = 'PED-' || lpad(new_id::text, 6, '0') WHERE id = new_id;
  INSERT INTO ped_aliases (ped_id, alias_text, normalized_alias, is_primary, is_visible, added_by) VALUES
    (new_id, 'DiGeorge Syndrome', 'digeorge syndrome', true, true, 'governance-review-2026-08-07-v2'),
    (new_id, '22q11.2 Deletion Syndrome', '22q11.2 deletion syndrome', false, true, 'governance-review-2026-08-07-v2');

  INSERT INTO ped_repository (ped_code, canonical_name, category_key, status, added_by)
  VALUES ('PED-PENDING', 'Hirschsprung Disease', 'genetic', 'approved', 'governance-review-2026-08-07-v2')
  RETURNING id INTO new_id;
  UPDATE ped_repository SET ped_code = 'PED-' || lpad(new_id::text, 6, '0') WHERE id = new_id;
  INSERT INTO ped_aliases (ped_id, alias_text, normalized_alias, is_primary, is_visible, added_by) VALUES
    (new_id, 'Hirschsprung Disease', 'hirschsprung disease', true, true, 'governance-review-2026-08-07-v2');

  INSERT INTO ped_repository (ped_code, canonical_name, category_key, status, added_by)
  VALUES ('PED-PENDING', 'Congenital Diaphragmatic Hernia', 'genetic', 'approved', 'governance-review-2026-08-07-v2')
  RETURNING id INTO new_id;
  UPDATE ped_repository SET ped_code = 'PED-' || lpad(new_id::text, 6, '0') WHERE id = new_id;
  INSERT INTO ped_aliases (ped_id, alias_text, normalized_alias, is_primary, is_visible, added_by) VALUES
    (new_id, 'Congenital Diaphragmatic Hernia', 'congenital diaphragmatic hernia', true, true, 'governance-review-2026-08-07-v2'),
    (new_id, 'CDH', 'cdh', false, true, 'governance-review-2026-08-07-v2');

  INSERT INTO ped_repository (ped_code, canonical_name, category_key, status, added_by)
  VALUES ('PED-PENDING', 'Gastroschisis', 'genetic', 'approved', 'governance-review-2026-08-07-v2')
  RETURNING id INTO new_id;
  UPDATE ped_repository SET ped_code = 'PED-' || lpad(new_id::text, 6, '0') WHERE id = new_id;
  INSERT INTO ped_aliases (ped_id, alias_text, normalized_alias, is_primary, is_visible, added_by) VALUES
    (new_id, 'Gastroschisis', 'gastroschisis', true, true, 'governance-review-2026-08-07-v2');

  INSERT INTO ped_repository (ped_code, canonical_name, category_key, status, added_by)
  VALUES ('PED-PENDING', 'Omphalocele', 'genetic', 'approved', 'governance-review-2026-08-07-v2')
  RETURNING id INTO new_id;
  UPDATE ped_repository SET ped_code = 'PED-' || lpad(new_id::text, 6, '0') WHERE id = new_id;
  INSERT INTO ped_aliases (ped_id, alias_text, normalized_alias, is_primary, is_visible, added_by) VALUES
    (new_id, 'Omphalocele', 'omphalocele', true, true, 'governance-review-2026-08-07-v2');

  INSERT INTO ped_repository (ped_code, canonical_name, category_key, status, added_by)
  VALUES ('PED-PENDING', 'Tracheoesophageal Fistula', 'genetic', 'approved', 'governance-review-2026-08-07-v2')
  RETURNING id INTO new_id;
  UPDATE ped_repository SET ped_code = 'PED-' || lpad(new_id::text, 6, '0') WHERE id = new_id;
  INSERT INTO ped_aliases (ped_id, alias_text, normalized_alias, is_primary, is_visible, added_by) VALUES
    (new_id, 'Tracheoesophageal Fistula', 'tracheoesophageal fistula', true, true, 'governance-review-2026-08-07-v2'),
    (new_id, 'TEF', 'tef', false, true, 'governance-review-2026-08-07-v2');

  INSERT INTO ped_repository (ped_code, canonical_name, category_key, status, added_by)
  VALUES ('PED-PENDING', 'Congenital Hip Dysplasia', 'genetic', 'approved', 'governance-review-2026-08-07-v2')
  RETURNING id INTO new_id;
  UPDATE ped_repository SET ped_code = 'PED-' || lpad(new_id::text, 6, '0') WHERE id = new_id;
  INSERT INTO ped_aliases (ped_id, alias_text, normalized_alias, is_primary, is_visible, added_by) VALUES
    (new_id, 'Congenital Hip Dysplasia', 'congenital hip dysplasia', true, true, 'governance-review-2026-08-07-v2'),
    (new_id, 'Developmental Dysplasia of the Hip', 'developmental dysplasia of the hip', false, true, 'governance-review-2026-08-07-v2'),
    (new_id, 'DDH', 'ddh', false, true, 'governance-review-2026-08-07-v2');

  INSERT INTO ped_repository (ped_code, canonical_name, category_key, status, added_by)
  VALUES ('PED-PENDING', 'Craniosynostosis', 'genetic', 'approved', 'governance-review-2026-08-07-v2')
  RETURNING id INTO new_id;
  UPDATE ped_repository SET ped_code = 'PED-' || lpad(new_id::text, 6, '0') WHERE id = new_id;
  INSERT INTO ped_aliases (ped_id, alias_text, normalized_alias, is_primary, is_visible, added_by) VALUES
    (new_id, 'Craniosynostosis', 'craniosynostosis', true, true, 'governance-review-2026-08-07-v2');

  INSERT INTO ped_repository (ped_code, canonical_name, category_key, status, added_by)
  VALUES ('PED-PENDING', 'Encephalocele', 'genetic', 'approved', 'governance-review-2026-08-07-v2')
  RETURNING id INTO new_id;
  UPDATE ped_repository SET ped_code = 'PED-' || lpad(new_id::text, 6, '0') WHERE id = new_id;
  INSERT INTO ped_aliases (ped_id, alias_text, normalized_alias, is_primary, is_visible, added_by) VALUES
    (new_id, 'Encephalocele', 'encephalocele', true, true, 'governance-review-2026-08-07-v2');

  INSERT INTO ped_repository (ped_code, canonical_name, category_key, status, added_by)
  VALUES ('PED-PENDING', 'Situs Inversus', 'genetic', 'approved', 'governance-review-2026-08-07-v2')
  RETURNING id INTO new_id;
  UPDATE ped_repository SET ped_code = 'PED-' || lpad(new_id::text, 6, '0') WHERE id = new_id;
  INSERT INTO ped_aliases (ped_id, alias_text, normalized_alias, is_primary, is_visible, added_by) VALUES
    (new_id, 'Situs Inversus', 'situs inversus', true, true, 'governance-review-2026-08-07-v2');

  INSERT INTO ped_repository (ped_code, canonical_name, category_key, status, added_by)
  VALUES ('PED-PENDING', 'Prune Belly Syndrome', 'genetic', 'approved', 'governance-review-2026-08-07-v2')
  RETURNING id INTO new_id;
  UPDATE ped_repository SET ped_code = 'PED-' || lpad(new_id::text, 6, '0') WHERE id = new_id;
  INSERT INTO ped_aliases (ped_id, alias_text, normalized_alias, is_primary, is_visible, added_by) VALUES
    (new_id, 'Prune Belly Syndrome', 'prune belly syndrome', true, true, 'governance-review-2026-08-07-v2'),
    (new_id, 'Eagle-Barrett Syndrome', 'eagle barrett syndrome', false, true, 'governance-review-2026-08-07-v2');

  INSERT INTO ped_repository (ped_code, canonical_name, category_key, status, added_by)
  VALUES ('PED-PENDING', 'Bladder Exstrophy', 'genetic', 'approved', 'governance-review-2026-08-07-v2')
  RETURNING id INTO new_id;
  UPDATE ped_repository SET ped_code = 'PED-' || lpad(new_id::text, 6, '0') WHERE id = new_id;
  INSERT INTO ped_aliases (ped_id, alias_text, normalized_alias, is_primary, is_visible, added_by) VALUES
    (new_id, 'Bladder Exstrophy', 'bladder exstrophy', true, true, 'governance-review-2026-08-07-v2');

  -- Biliary Atresia -> LIVER, not genetic. Called out separately per Part A4.
  INSERT INTO ped_repository (ped_code, canonical_name, category_key, status, added_by)
  VALUES ('PED-PENDING', 'Biliary Atresia', 'liver', 'approved', 'governance-review-2026-08-07-v2')
  RETURNING id INTO new_id;
  UPDATE ped_repository SET ped_code = 'PED-' || lpad(new_id::text, 6, '0') WHERE id = new_id;
  INSERT INTO ped_aliases (ped_id, alias_text, normalized_alias, is_primary, is_visible, added_by) VALUES
    (new_id, 'Biliary Atresia', 'biliary atresia', true, true, 'governance-review-2026-08-07-v2');
END $$;


-- ═══════════════════════════════════════════════════════════════════════
-- TIER 2 — Held per your item 4. NOT included even as commented SQL this
-- round (v1 had them commented-out; removing entirely now since you were
-- explicit that these need manual review, not a "ready when you are"
-- script sitting in the file): Ebstein's Anomaly, Eisenmenger Syndrome,
-- Horseshoe Kidney, Duplex Kidney, Meckel's Diverticulum, Malrotation,
-- Congenital Glaucoma (plan-specific). See Part A3/A4 reasoning above for
-- each -- bring back to me individually when you're ready to decide.
-- ═══════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════════
-- TIER 3 — Optima Secure disability/deformity routing: NOT scripted.
-- See Part 3 -- this needs your decision on the architecture question
-- before anything is drafted, not just your approval of a draft.
-- ═══════════════════════════════════════════════════════════════════════

COMMIT;
```

---

## Part E — Regression analysis (updated)

Unchanged from v1 for the coverage-only additions (zero regression risk, confirmed via three independent sources that all new conditions are currently unmapped). **Newly behavioral this round:** the four Tier-1 recategorizations (Huntington's, Friedreich's, CMT, Spinocerebellar Ataxia) and the Hydrocephalus split are Behavioral-type regressions per Part XII — but every one is now explicitly approved by you (item 3), and Huntington's/Friedreich's/CMT bring the dictionary in line with what the code was already documented as intending (Friedreich's/CMT were already `neuro` — the SQL for them is idempotent confirmation, not a live change). Only the Huntington's regex-token removal and the Spinocerebellar Ataxia standardization, plus the Hydrocephalus split, produce a real diff against the current baseline. Same sequencing recommendation as v1: apply, then run `npm test` and diff before treating any tier as done.

---

*Every recommendation above is decision support. Nothing in `ped_repository`, `ped_aliases`, `plan_overrides`, `categories`, or `plan_configs` has been modified. Part 3 (Optima Secure) is the one open decision — everything else in Part F Tier 1 is ready whenever you give the go-ahead to run it.*
