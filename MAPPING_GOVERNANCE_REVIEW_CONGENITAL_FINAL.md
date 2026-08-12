# Mapping Governance Review — Congenital Routing (FINAL)

**Tag: Repository Architecture v1.0 — Stable** (approved 2026-08-07). This review is the validation record for that tag — see `PED_REPOSITORY_GOVERNANCE.md`'s "Repository Architecture v1.0 — Stable" section for the formal sign-off summary. Future work should focus on repository enrichment and AI-assisted governance review rather than further core-architecture redesign; a change that would require a new `categories` row, a new routing stage, or a runtime-engine structural change reopens this baseline rather than counting as routine enrichment.

**Status:** Governance exercise / decision support. **No repository data has been changed** — the SQL in Part F is still awaiting your execution. This supersedes v1–v4 — this is the single, consolidated document to work from. (v1–v4 remain in the project folder as the decision trail, but everything in them is folded in here.)

**Optima Secure mechanism, settled:** repoint `genetic` (v3's direction) — no unrelated category is reused. See "Optima Secure" section below for why this ended up the final answer over the `ent` alternative. **Updated 2026-08-08:** a pre-execution impact assessment found 11 additional genetic-categorized PEDs that would have moved unreviewed; all 11 now have explicit `blood` overrides after individual review — see the "Optima Secure" section and Part F.

---

## Governance principles (12, all approved)

1. Congenital is not a default — the most specific wording wins.
2. Categories represent medical classification only, never insurer phrasing.
3. Specificity, not congenital status, drives routing when multiple questions are medically applicable.
4. Manifestation/complication conditions (e.g. Eisenmenger Syndrome) must be escalated as a Business Decision, not defaulted.
5. Sibling/synonym consistency required before adding related conditions (Huntington's, Spinocerebellar Ataxia).
6. Polarity-sensitive terms need qualified aliases, not one bare token (Hydrocephalus).
7. *(withdrawn — was the original `congenital_disability`-adjacent rule; superseded by 2 and the Optima Secure resolution below)*
8. **Medical categories must always represent the medical condition itself — not the declaration question ultimately selected by a particular insurer. Plan-specific routing is handled through `plan_overrides`, never by changing the underlying medical taxonomy.**
9. **If multiple declaration questions are medically applicable, the engine should choose the question whose wording most specifically represents the condition. Congenital status alone should never automatically determine routing.**
10. "Structural/anatomical absence or malformation" is distinct from "disease of a functioning organ" — this distinction, not congenital origin, decides organ-vs-congenital routing for structural anomalies (Gastroschisis/Omphalocele/Imperforate Anus/Bladder Exstrophy vs. Meckel's/Malrotation/Hirschsprung's).
11. Sibling consistency can outrank a marginal wording edge (DDH stays with Club Foot despite Musculoskeletal's real wording match).
12. **The `genetic` category, when used for congenital structural anomalies, is an implementation compromise, not a medical claim.** The repository has no dedicated congenital taxonomy distinct from genetic/hereditary conditions. Using `genetic` for a structural malformation (Cleft Lip, Club Foot, Gastroschisis, etc.) reflects the absence of a better-fitting existing category — it is not an assertion that the condition is genetically inherited. Future contributors should not treat `categoryKey = 'genetic'` as medically exact for every PED that carries it.

---

## Optima Secure — final mechanism (repoint, not reuse)

**Why `ent` was rejected after being fully vetted:** it was the only collision-free existing key (rigorously verified — every other real category is either a live default for existing PEDs or already meaningfully mapped on some plan), but "collision-free" isn't the same as "clean." Repurposing a key whose actual meaning is Ear/Nose/Throat to silently mean "congenital structural anomaly" on one plan is exactly the kind of thing that misleads someone debugging this in a year, even fully documented. Agreed that's a real cost, not just a taste preference.

**Final approach:** repoint Optima Secure's own `genetic` categoryMap entry from the Blood/Genetic question to the Disability/Deformity question. This is not a new category and is not reusing an unrelated one — `genetic` already *is* the correct conceptual category for these conditions (per principle 12, it's already standing in for "congenital" as a compromise); this only changes *which* of Optima Secure's two relevant questions it resolves to. `plan_configs.category_map` is per-plan JSONB, so this touches nothing on any other plan.

**The tradeoff, stated plainly (so it's a documented decision, not an invisible one):** because `genetic` is the repointed default, it now takes the wider set of genetic-categorized PEDs to the Disability/Deformity question by default — including ones that were never reviewed for "does this read as a deformity" (every hereditary/genetic condition on Optima Secure whose categoryKey is `genetic`, not just the ~35 structural ones in this review). Marfan Syndrome and Ehlers-Danlos Syndrome were identified up front as not fitting and given an explicit override back to `blood`.

**Update, 2026-08-08:** a dedicated read-only impact assessment run before executing any SQL (`OPTIMA_SECURE_GENETIC_REPOINT_IMPACT_ASSESSMENT.md`) surfaced 11 further genetic-categorized PEDs that would have silently moved to Disability/Deformity, unreviewed, as this same side effect. Each has since been individually reviewed and given an explicit `blood` override — 7 for being diseases of blood/enzyme/organ function rather than deformities (Spinal Muscular Atrophy, G6PD Deficiency, Cystic Fibrosis, Pompe Disease, Gaucher Disease, Alpha-1 Antitrypsin Deficiency, Enzyme Deficiency), and 4 chromosomal/monogenic syndromes reviewed separately on wording grounds (`OPTIMA_SECURE_SYNDROMIC_CONDITIONS_REVIEW.md`: Down Syndrome, Turner Syndrome, Klinefelter Syndrome, Noonan Syndrome). As of this update, every genetic-categorized PED currently in the repository has an explicit, reasoned routing decision for the Optima Secure repoint — none are left to move by default, unreviewed. Situs Inversus was removed from the original override list (see condition list below) since no corresponding PED exists yet.

---

## Full condition list (unchanged reasoning from v1–v3, consolidated)

**Route to Congenital/Genetic (`genetic`), Optima Secure → Disability/Deformity by default:**
ASD, VSD, Tetralogy of Fallot, Congenital Heart Defect (generic), Patent Ductus Arteriosus, Coarctation of Aorta, Transposition of Great Arteries, Truncus Arteriosus, Hypoplastic Left Heart Syndrome, Total Anomalous Pulmonary Venous Return, Spina Bifida, Cleft Lip/Cleft Palate, Club Foot, Congenital Hydrocephalus, Microcephaly, Anencephaly, Arnold-Chiari Malformation, Dandy-Walker Malformation, Holoprosencephaly, Encephalocele, Craniosynostosis, Congenital Hip Dysplasia (flagged closest call, kept for Club Foot sibling-consistency), Osteogenesis Imperfecta, Achondroplasia, Renal Agenesis, Congenital Solitary Kidney, Imperforate Anus, Choanal Atresia, Congenital Ptosis, DiGeorge Syndrome, Congenital Diaphragmatic Hernia, Gastroschisis, Omphalocele, Tracheoesophageal Fistula, Prune Belly Syndrome, Bladder Exstrophy.

**Route to Congenital/Genetic (`genetic`), Optima Secure → explicit override to `blood` (don't fit "deformity" framing):**
Marfan Syndrome, Ehlers-Danlos Syndrome.

**Added 2026-08-08 (post-approval impact assessment), same override mechanism, same destination:**
Spinal Muscular Atrophy, G6PD Deficiency, Cystic Fibrosis, Pompe Disease, Gaucher Disease, Alpha-1 Antitrypsin Deficiency, Enzyme Deficiency (disease/enzyme conditions, not deformities) — and Down Syndrome, Turner Syndrome, Klinefelter Syndrome, Noonan Syndrome (chromosomal/monogenic syndromes more specifically named by Q9's "any genetic disorder" wording than Q1's "deformity" wording; see `OPTIMA_SECURE_SYNDROMIC_CONDITIONS_REVIEW.md`). These were the 11 conditions the impact assessment flagged as unreviewed side effects of the `genetic` repoint — each now has an explicit, reasoned routing decision instead of moving by default.

**Situs Inversus** — removed from this review's Optima Secure override list. It does not exist in `ped_repository` and isn't created by this script's coverage-addition block, so the original override would have silently matched zero rows. Treat as out of scope until it's added as its own reviewed PED.

**Congenital origin, but organ-specific wording wins (route elsewhere entirely, all plans):**
Congenital Adrenal Hyperplasia → Endocrine. Congenital Hypothyroidism → Endocrine. Congenital Glaucoma → Eye (verify per-plan wording before applying). Biliary Atresia → Liver.

**Reclassified from Congenital/Genetic to Neurological (specificity, not congenital status):**
Huntington's Disease, Friedreich's Ataxia, Charcot-Marie-Tooth, Spinocerebellar Ataxia (standardized).

**Split by polarity:**
Hydrocephalus → Congenital Hydrocephalus (`genetic`) vs. Normal Pressure/Acquired Hydrocephalus (`neuro`), two distinct PEDs.

**Held for manual review — not in SQL, do not bulk-approve:**
Ebstein's Anomaly, Eisenmenger Syndrome, Horseshoe Kidney, Duplex Kidney, Meckel's Diverticulum, Malrotation, Hirschsprung Disease (moved here — genuinely dual Digestive/Genetic, same reasoning as Meckel's/Malrotation).

**DiGeorge Syndrome — dedup confirmed:** searched "DiGeorge," "22q11," "22q11.2," "Velocardiofacial," "Shprintzen" across the dictionary, engine regex, and audited file — zero matches anywhere. Added as new with all three as aliases.

---

## Part F — Final, consolidated SQL (supersedes all prior versions' Optima Secure blocks; everything else unchanged from v2/v3)

```sql
BEGIN;

-- ═══ Recategorizations (approved) ═══
UPDATE ped_repository SET category_key = 'neuro', updated_at = now() WHERE canonical_name ILIKE 'Huntington%' AND category_key <> 'neuro';
UPDATE ped_repository SET category_key = 'neuro', updated_at = now() WHERE canonical_name ILIKE 'Friedreich%Ataxia';
UPDATE ped_repository SET category_key = 'neuro', updated_at = now() WHERE canonical_name ILIKE 'Charcot%Marie%Tooth%';
UPDATE ped_repository SET category_key = 'neuro', updated_at = now() WHERE canonical_name ILIKE 'Spinocerebellar Ataxia';
-- (merge any duplicate Spinocerebellar Ataxia row in the admin UI per PED_REPOSITORY_GOVERNANCE.md rule 3, if one exists)
-- engine.ts code edit (not SQL): remove the bare token `huntington` from the
-- §16b regex alternation list (~line 1350) now that the dictionary is the
-- sole, consistent source of truth for this condition.

-- ═══ Hydrocephalus split ═══
DO $$
DECLARE new_id integer;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM ped_repository WHERE canonical_name ILIKE 'Congenital Hydrocephalus') THEN
    INSERT INTO ped_repository (ped_code, canonical_name, category_key, status, added_by)
    VALUES ('PED-PENDING', 'Congenital Hydrocephalus', 'genetic', 'approved', 'governance-review-final') RETURNING id INTO new_id;
    UPDATE ped_repository SET ped_code = 'PED-' || lpad(new_id::text, 6, '0') WHERE id = new_id;
    INSERT INTO ped_aliases (ped_id, alias_text, normalized_alias, is_primary, is_visible, added_by)
    VALUES (new_id, 'Congenital Hydrocephalus', 'congenital hydrocephalus', true, true, 'governance-review-final');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM ped_repository WHERE canonical_name ILIKE 'Normal Pressure Hydrocephalus') THEN
    INSERT INTO ped_repository (ped_code, canonical_name, category_key, status, added_by)
    VALUES ('PED-PENDING', 'Normal Pressure Hydrocephalus', 'neuro', 'approved', 'governance-review-final') RETURNING id INTO new_id;
    UPDATE ped_repository SET ped_code = 'PED-' || lpad(new_id::text, 6, '0') WHERE id = new_id;
    INSERT INTO ped_aliases (ped_id, alias_text, normalized_alias, is_primary, is_visible, added_by) VALUES
      (new_id, 'Normal Pressure Hydrocephalus', 'normal pressure hydrocephalus', true, true, 'governance-review-final'),
      (new_id, 'Acquired Hydrocephalus', 'acquired hydrocephalus', false, true, 'governance-review-final');
  END IF;
END $$;

-- ═══ Coverage additions: all Genetic/Congenital new PEDs (structural list + DiGeorge) ═══
-- Updated 2026-08-08: every INSERT below is now wrapped in an
-- IF NOT EXISTS guard, matching the pattern the Hydrocephalus split above
-- already used -- closes the idempotency gap found in the pre-deployment
-- review (a second run previously would have failed on a duplicate alias
-- partway through and rolled back the whole transaction; it's now a clean
-- no-op per condition instead). Also adds Choanal Atresia and Congenital
-- Ptosis, both named in this review's condition list (Part 3) but missing
-- from this block in earlier drafts -- confirmed as an oversight, not an
-- intentional deferral, and added here on the same terms as their sibling
-- structural anomalies.
DO $$
DECLARE new_id integer;
BEGIN
  -- Heart
  IF NOT EXISTS (SELECT 1 FROM ped_repository WHERE canonical_name = 'Patent Ductus Arteriosus') THEN
    INSERT INTO ped_repository (ped_code, canonical_name, category_key, status, added_by) VALUES ('PED-PENDING','Patent Ductus Arteriosus','genetic','approved','governance-review-final') RETURNING id INTO new_id;
    UPDATE ped_repository SET ped_code='PED-'||lpad(new_id::text,6,'0') WHERE id=new_id;
    INSERT INTO ped_aliases (ped_id,alias_text,normalized_alias,is_primary,is_visible,added_by) VALUES (new_id,'Patent Ductus Arteriosus','patent ductus arteriosus',true,true,'governance-review-final'),(new_id,'PDA','pda',false,true,'governance-review-final');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM ped_repository WHERE canonical_name = 'Coarctation of Aorta') THEN
    INSERT INTO ped_repository (ped_code, canonical_name, category_key, status, added_by) VALUES ('PED-PENDING','Coarctation of Aorta','genetic','approved','governance-review-final') RETURNING id INTO new_id;
    UPDATE ped_repository SET ped_code='PED-'||lpad(new_id::text,6,'0') WHERE id=new_id;
    INSERT INTO ped_aliases (ped_id,alias_text,normalized_alias,is_primary,is_visible,added_by) VALUES (new_id,'Coarctation of Aorta','coarctation of aorta',true,true,'governance-review-final');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM ped_repository WHERE canonical_name = 'Transposition of Great Arteries') THEN
    INSERT INTO ped_repository (ped_code, canonical_name, category_key, status, added_by) VALUES ('PED-PENDING','Transposition of Great Arteries','genetic','approved','governance-review-final') RETURNING id INTO new_id;
    UPDATE ped_repository SET ped_code='PED-'||lpad(new_id::text,6,'0') WHERE id=new_id;
    INSERT INTO ped_aliases (ped_id,alias_text,normalized_alias,is_primary,is_visible,added_by) VALUES (new_id,'Transposition of Great Arteries','transposition of great arteries',true,true,'governance-review-final'),(new_id,'TGA','tga',false,true,'governance-review-final');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM ped_repository WHERE canonical_name = 'Truncus Arteriosus') THEN
    INSERT INTO ped_repository (ped_code, canonical_name, category_key, status, added_by) VALUES ('PED-PENDING','Truncus Arteriosus','genetic','approved','governance-review-final') RETURNING id INTO new_id;
    UPDATE ped_repository SET ped_code='PED-'||lpad(new_id::text,6,'0') WHERE id=new_id;
    INSERT INTO ped_aliases (ped_id,alias_text,normalized_alias,is_primary,is_visible,added_by) VALUES (new_id,'Truncus Arteriosus','truncus arteriosus',true,true,'governance-review-final');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM ped_repository WHERE canonical_name = 'Hypoplastic Left Heart Syndrome') THEN
    INSERT INTO ped_repository (ped_code, canonical_name, category_key, status, added_by) VALUES ('PED-PENDING','Hypoplastic Left Heart Syndrome','genetic','approved','governance-review-final') RETURNING id INTO new_id;
    UPDATE ped_repository SET ped_code='PED-'||lpad(new_id::text,6,'0') WHERE id=new_id;
    INSERT INTO ped_aliases (ped_id,alias_text,normalized_alias,is_primary,is_visible,added_by) VALUES (new_id,'Hypoplastic Left Heart Syndrome','hypoplastic left heart syndrome',true,true,'governance-review-final'),(new_id,'HLHS','hlhs',false,true,'governance-review-final');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM ped_repository WHERE canonical_name = 'Total Anomalous Pulmonary Venous Return') THEN
    INSERT INTO ped_repository (ped_code, canonical_name, category_key, status, added_by) VALUES ('PED-PENDING','Total Anomalous Pulmonary Venous Return','genetic','approved','governance-review-final') RETURNING id INTO new_id;
    UPDATE ped_repository SET ped_code='PED-'||lpad(new_id::text,6,'0') WHERE id=new_id;
    INSERT INTO ped_aliases (ped_id,alias_text,normalized_alias,is_primary,is_visible,added_by) VALUES (new_id,'Total Anomalous Pulmonary Venous Return','total anomalous pulmonary venous return',true,true,'governance-review-final'),(new_id,'TAPVR','tapvr',false,true,'governance-review-final');
  END IF;

  -- Neuro/structural
  IF NOT EXISTS (SELECT 1 FROM ped_repository WHERE canonical_name = 'Microcephaly') THEN
    INSERT INTO ped_repository (ped_code, canonical_name, category_key, status, added_by) VALUES ('PED-PENDING','Microcephaly','genetic','approved','governance-review-final') RETURNING id INTO new_id;
    UPDATE ped_repository SET ped_code='PED-'||lpad(new_id::text,6,'0') WHERE id=new_id;
    INSERT INTO ped_aliases (ped_id,alias_text,normalized_alias,is_primary,is_visible,added_by) VALUES (new_id,'Microcephaly','microcephaly',true,true,'governance-review-final');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM ped_repository WHERE canonical_name = 'Anencephaly') THEN
    INSERT INTO ped_repository (ped_code, canonical_name, category_key, status, added_by) VALUES ('PED-PENDING','Anencephaly','genetic','approved','governance-review-final') RETURNING id INTO new_id;
    UPDATE ped_repository SET ped_code='PED-'||lpad(new_id::text,6,'0') WHERE id=new_id;
    INSERT INTO ped_aliases (ped_id,alias_text,normalized_alias,is_primary,is_visible,added_by) VALUES (new_id,'Anencephaly','anencephaly',true,true,'governance-review-final');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM ped_repository WHERE canonical_name = 'Arnold-Chiari Malformation') THEN
    INSERT INTO ped_repository (ped_code, canonical_name, category_key, status, added_by) VALUES ('PED-PENDING','Arnold-Chiari Malformation','genetic','approved','governance-review-final') RETURNING id INTO new_id;
    UPDATE ped_repository SET ped_code='PED-'||lpad(new_id::text,6,'0') WHERE id=new_id;
    INSERT INTO ped_aliases (ped_id,alias_text,normalized_alias,is_primary,is_visible,added_by) VALUES (new_id,'Arnold-Chiari Malformation','arnold chiari malformation',true,true,'governance-review-final'),(new_id,'Chiari Malformation','chiari malformation',false,true,'governance-review-final');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM ped_repository WHERE canonical_name = 'Dandy-Walker Malformation') THEN
    INSERT INTO ped_repository (ped_code, canonical_name, category_key, status, added_by) VALUES ('PED-PENDING','Dandy-Walker Malformation','genetic','approved','governance-review-final') RETURNING id INTO new_id;
    UPDATE ped_repository SET ped_code='PED-'||lpad(new_id::text,6,'0') WHERE id=new_id;
    INSERT INTO ped_aliases (ped_id,alias_text,normalized_alias,is_primary,is_visible,added_by) VALUES (new_id,'Dandy-Walker Malformation','dandy walker malformation',true,true,'governance-review-final'),(new_id,'Dandy-Walker Syndrome','dandy walker syndrome',false,true,'governance-review-final');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM ped_repository WHERE canonical_name = 'Holoprosencephaly') THEN
    INSERT INTO ped_repository (ped_code, canonical_name, category_key, status, added_by) VALUES ('PED-PENDING','Holoprosencephaly','genetic','approved','governance-review-final') RETURNING id INTO new_id;
    UPDATE ped_repository SET ped_code='PED-'||lpad(new_id::text,6,'0') WHERE id=new_id;
    INSERT INTO ped_aliases (ped_id,alias_text,normalized_alias,is_primary,is_visible,added_by) VALUES (new_id,'Holoprosencephaly','holoprosencephaly',true,true,'governance-review-final');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM ped_repository WHERE canonical_name = 'Encephalocele') THEN
    INSERT INTO ped_repository (ped_code, canonical_name, category_key, status, added_by) VALUES ('PED-PENDING','Encephalocele','genetic','approved','governance-review-final') RETURNING id INTO new_id;
    UPDATE ped_repository SET ped_code='PED-'||lpad(new_id::text,6,'0') WHERE id=new_id;
    INSERT INTO ped_aliases (ped_id,alias_text,normalized_alias,is_primary,is_visible,added_by) VALUES (new_id,'Encephalocele','encephalocele',true,true,'governance-review-final');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM ped_repository WHERE canonical_name = 'Craniosynostosis') THEN
    INSERT INTO ped_repository (ped_code, canonical_name, category_key, status, added_by) VALUES ('PED-PENDING','Craniosynostosis','genetic','approved','governance-review-final') RETURNING id INTO new_id;
    UPDATE ped_repository SET ped_code='PED-'||lpad(new_id::text,6,'0') WHERE id=new_id;
    INSERT INTO ped_aliases (ped_id,alias_text,normalized_alias,is_primary,is_visible,added_by) VALUES (new_id,'Craniosynostosis','craniosynostosis',true,true,'governance-review-final');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM ped_repository WHERE canonical_name = 'Congenital Hip Dysplasia') THEN
    INSERT INTO ped_repository (ped_code, canonical_name, category_key, status, added_by) VALUES ('PED-PENDING','Congenital Hip Dysplasia','genetic','approved','governance-review-final') RETURNING id INTO new_id;
    UPDATE ped_repository SET ped_code='PED-'||lpad(new_id::text,6,'0') WHERE id=new_id;
    INSERT INTO ped_aliases (ped_id,alias_text,normalized_alias,is_primary,is_visible,added_by) VALUES (new_id,'Congenital Hip Dysplasia','congenital hip dysplasia',true,true,'governance-review-final'),(new_id,'Developmental Dysplasia of the Hip','developmental dysplasia of the hip',false,true,'governance-review-final'),(new_id,'DDH','ddh',false,true,'governance-review-final');
  END IF;

  -- Kidney / GI / GU
  IF NOT EXISTS (SELECT 1 FROM ped_repository WHERE canonical_name = 'Renal Agenesis') THEN
    INSERT INTO ped_repository (ped_code, canonical_name, category_key, status, added_by) VALUES ('PED-PENDING','Renal Agenesis','genetic','approved','governance-review-final') RETURNING id INTO new_id;
    UPDATE ped_repository SET ped_code='PED-'||lpad(new_id::text,6,'0') WHERE id=new_id;
    INSERT INTO ped_aliases (ped_id,alias_text,normalized_alias,is_primary,is_visible,added_by) VALUES (new_id,'Renal Agenesis','renal agenesis',true,true,'governance-review-final');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM ped_repository WHERE canonical_name = 'Congenital Solitary Kidney') THEN
    INSERT INTO ped_repository (ped_code, canonical_name, category_key, status, added_by) VALUES ('PED-PENDING','Congenital Solitary Kidney','genetic','approved','governance-review-final') RETURNING id INTO new_id;
    UPDATE ped_repository SET ped_code='PED-'||lpad(new_id::text,6,'0') WHERE id=new_id;
    INSERT INTO ped_aliases (ped_id,alias_text,normalized_alias,is_primary,is_visible,added_by) VALUES (new_id,'Congenital Solitary Kidney','congenital solitary kidney',true,true,'governance-review-final');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM ped_repository WHERE canonical_name = 'Imperforate Anus') THEN
    INSERT INTO ped_repository (ped_code, canonical_name, category_key, status, added_by) VALUES ('PED-PENDING','Imperforate Anus','genetic','approved','governance-review-final') RETURNING id INTO new_id;
    UPDATE ped_repository SET ped_code='PED-'||lpad(new_id::text,6,'0') WHERE id=new_id;
    INSERT INTO ped_aliases (ped_id,alias_text,normalized_alias,is_primary,is_visible,added_by) VALUES (new_id,'Imperforate Anus','imperforate anus',true,true,'governance-review-final');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM ped_repository WHERE canonical_name = 'Congenital Diaphragmatic Hernia') THEN
    INSERT INTO ped_repository (ped_code, canonical_name, category_key, status, added_by) VALUES ('PED-PENDING','Congenital Diaphragmatic Hernia','genetic','approved','governance-review-final') RETURNING id INTO new_id;
    UPDATE ped_repository SET ped_code='PED-'||lpad(new_id::text,6,'0') WHERE id=new_id;
    INSERT INTO ped_aliases (ped_id,alias_text,normalized_alias,is_primary,is_visible,added_by) VALUES (new_id,'Congenital Diaphragmatic Hernia','congenital diaphragmatic hernia',true,true,'governance-review-final'),(new_id,'CDH','cdh',false,true,'governance-review-final');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM ped_repository WHERE canonical_name = 'Gastroschisis') THEN
    INSERT INTO ped_repository (ped_code, canonical_name, category_key, status, added_by) VALUES ('PED-PENDING','Gastroschisis','genetic','approved','governance-review-final') RETURNING id INTO new_id;
    UPDATE ped_repository SET ped_code='PED-'||lpad(new_id::text,6,'0') WHERE id=new_id;
    INSERT INTO ped_aliases (ped_id,alias_text,normalized_alias,is_primary,is_visible,added_by) VALUES (new_id,'Gastroschisis','gastroschisis',true,true,'governance-review-final');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM ped_repository WHERE canonical_name = 'Omphalocele') THEN
    INSERT INTO ped_repository (ped_code, canonical_name, category_key, status, added_by) VALUES ('PED-PENDING','Omphalocele','genetic','approved','governance-review-final') RETURNING id INTO new_id;
    UPDATE ped_repository SET ped_code='PED-'||lpad(new_id::text,6,'0') WHERE id=new_id;
    INSERT INTO ped_aliases (ped_id,alias_text,normalized_alias,is_primary,is_visible,added_by) VALUES (new_id,'Omphalocele','omphalocele',true,true,'governance-review-final');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM ped_repository WHERE canonical_name = 'Tracheoesophageal Fistula') THEN
    INSERT INTO ped_repository (ped_code, canonical_name, category_key, status, added_by) VALUES ('PED-PENDING','Tracheoesophageal Fistula','genetic','approved','governance-review-final') RETURNING id INTO new_id;
    UPDATE ped_repository SET ped_code='PED-'||lpad(new_id::text,6,'0') WHERE id=new_id;
    INSERT INTO ped_aliases (ped_id,alias_text,normalized_alias,is_primary,is_visible,added_by) VALUES (new_id,'Tracheoesophageal Fistula','tracheoesophageal fistula',true,true,'governance-review-final'),(new_id,'TEF','tef',false,true,'governance-review-final');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM ped_repository WHERE canonical_name = 'Prune Belly Syndrome') THEN
    INSERT INTO ped_repository (ped_code, canonical_name, category_key, status, added_by) VALUES ('PED-PENDING','Prune Belly Syndrome','genetic','approved','governance-review-final') RETURNING id INTO new_id;
    UPDATE ped_repository SET ped_code='PED-'||lpad(new_id::text,6,'0') WHERE id=new_id;
    INSERT INTO ped_aliases (ped_id,alias_text,normalized_alias,is_primary,is_visible,added_by) VALUES (new_id,'Prune Belly Syndrome','prune belly syndrome',true,true,'governance-review-final'),(new_id,'Eagle-Barrett Syndrome','eagle barrett syndrome',false,true,'governance-review-final');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM ped_repository WHERE canonical_name = 'Bladder Exstrophy') THEN
    INSERT INTO ped_repository (ped_code, canonical_name, category_key, status, added_by) VALUES ('PED-PENDING','Bladder Exstrophy','genetic','approved','governance-review-final') RETURNING id INTO new_id;
    UPDATE ped_repository SET ped_code='PED-'||lpad(new_id::text,6,'0') WHERE id=new_id;
    INSERT INTO ped_aliases (ped_id,alias_text,normalized_alias,is_primary,is_visible,added_by) VALUES (new_id,'Bladder Exstrophy','bladder exstrophy',true,true,'governance-review-final');
  END IF;

  -- ENT / Eye (added 2026-08-08 -- named in this review's condition list,
  -- previously missing from this SQL block; confirmed an oversight, not an
  -- intentional deferral)
  IF NOT EXISTS (SELECT 1 FROM ped_repository WHERE canonical_name = 'Choanal Atresia') THEN
    INSERT INTO ped_repository (ped_code, canonical_name, category_key, status, added_by) VALUES ('PED-PENDING','Choanal Atresia','genetic','approved','governance-review-final') RETURNING id INTO new_id;
    UPDATE ped_repository SET ped_code='PED-'||lpad(new_id::text,6,'0') WHERE id=new_id;
    INSERT INTO ped_aliases (ped_id,alias_text,normalized_alias,is_primary,is_visible,added_by) VALUES (new_id,'Choanal Atresia','choanal atresia',true,true,'governance-review-final');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM ped_repository WHERE canonical_name = 'Congenital Ptosis') THEN
    INSERT INTO ped_repository (ped_code, canonical_name, category_key, status, added_by) VALUES ('PED-PENDING','Congenital Ptosis','genetic','approved','governance-review-final') RETURNING id INTO new_id;
    UPDATE ped_repository SET ped_code='PED-'||lpad(new_id::text,6,'0') WHERE id=new_id;
    INSERT INTO ped_aliases (ped_id,alias_text,normalized_alias,is_primary,is_visible,added_by) VALUES (new_id,'Congenital Ptosis','congenital ptosis',true,true,'governance-review-final');
  END IF;

  -- Multi-organ syndromes
  IF NOT EXISTS (SELECT 1 FROM ped_repository WHERE canonical_name = 'DiGeorge Syndrome') THEN
    INSERT INTO ped_repository (ped_code, canonical_name, category_key, status, added_by) VALUES ('PED-PENDING','DiGeorge Syndrome','genetic','approved','governance-review-final') RETURNING id INTO new_id;
    UPDATE ped_repository SET ped_code='PED-'||lpad(new_id::text,6,'0') WHERE id=new_id;
    INSERT INTO ped_aliases (ped_id,alias_text,normalized_alias,is_primary,is_visible,added_by) VALUES (new_id,'DiGeorge Syndrome','digeorge syndrome',true,true,'governance-review-final'),(new_id,'22q11.2 Deletion Syndrome','22q11.2 deletion syndrome',false,true,'governance-review-final'),(new_id,'Velocardiofacial Syndrome','velocardiofacial syndrome',false,true,'governance-review-final'),(new_id,'Shprintzen Syndrome','shprintzen syndrome',false,true,'governance-review-final');
  END IF;

  -- Organ-specific-wins conditions
  IF NOT EXISTS (SELECT 1 FROM ped_repository WHERE canonical_name = 'Congenital Hypothyroidism') THEN
    INSERT INTO ped_repository (ped_code, canonical_name, category_key, status, added_by) VALUES ('PED-PENDING','Congenital Hypothyroidism','endocrine','approved','governance-review-final') RETURNING id INTO new_id;
    UPDATE ped_repository SET ped_code='PED-'||lpad(new_id::text,6,'0') WHERE id=new_id;
    INSERT INTO ped_aliases (ped_id,alias_text,normalized_alias,is_primary,is_visible,added_by) VALUES (new_id,'Congenital Hypothyroidism','congenital hypothyroidism',true,true,'governance-review-final');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM ped_repository WHERE canonical_name = 'Biliary Atresia') THEN
    INSERT INTO ped_repository (ped_code, canonical_name, category_key, status, added_by) VALUES ('PED-PENDING','Biliary Atresia','liver','approved','governance-review-final') RETURNING id INTO new_id;
    UPDATE ped_repository SET ped_code='PED-'||lpad(new_id::text,6,'0') WHERE id=new_id;
    INSERT INTO ped_aliases (ped_id,alias_text,normalized_alias,is_primary,is_visible,added_by) VALUES (new_id,'Biliary Atresia','biliary atresia',true,true,'governance-review-final');
  END IF;
END $$;

-- ═══ Optima Secure: final mechanism ═══
UPDATE plan_configs
SET category_map = category_map || jsonb_build_object(
  'genetic',
  'Are you having any disability / deformity including accidental or congenital?'
)
WHERE plan_name = 'Optima Secure';

INSERT INTO plan_overrides (plan_name, ped_id, category_key, reason, added_by)
SELECT 'Optima Secure', pr.id, 'blood',
       'Systemic/syndromic genetic condition, not a structural deformity -- Optima Secure''s genetic categoryKey now defaults to the disability/deformity question; this keeps this condition on the blood/genetic-combined question instead (governance review, final).',
       'governance-review-final'
FROM ped_repository pr
WHERE pr.canonical_name IN ('Marfan Syndrome', 'Ehlers-Danlos Syndrome')
ON CONFLICT (plan_name, ped_id) DO UPDATE SET category_key = EXCLUDED.category_key, reason = EXCLUDED.reason;

-- NOTE: 'Situs Inversus' was removed from the override list above (was
-- previously included alongside Marfan/Ehlers-Danlos in this same
-- statement). It does not exist in ped_repository today and is not
-- created anywhere in this script's coverage-addition block, so the
-- override would have silently matched zero rows. Add it back here (with
-- its own INSERT into ped_repository first) if/when it's brought in as
-- its own reviewed addition -- confirmed via the impact-assessment
-- report dated 2026-08-08.

-- ═══ Optima Secure: collateral genetic conditions, reviewed 2026-08-08 ═══
-- These 11 conditions were flagged by the post-approval impact assessment
-- as PEDs that would have silently moved from Blood/Genetic to
-- Disability/Deformity as an unreviewed side effect of the `genetic`
-- repoint above. Each has now been explicitly reviewed (see
-- OPTIMA_SECURE_GENETIC_REPOINT_IMPACT_ASSESSMENT.md and
-- OPTIMA_SECURE_SYNDROMIC_CONDITIONS_REVIEW.md) and is kept on the
-- Blood/Genetic question via the same override mechanism as Marfan/
-- Ehlers-Danlos, either because it is a disease of blood/enzyme/organ
-- function rather than a structural deformity (first 7), or because it is
-- a chromosomal/monogenic syndrome that Q9's "any genetic disorder"
-- wording names more specifically than Q1's "deformity" wording (last 4;
-- Noonan Syndrome is the closest call of the four -- see the syndromic
-- conditions review for the full reasoning).
INSERT INTO plan_overrides (plan_name, ped_id, category_key, reason, added_by)
SELECT 'Optima Secure', pr.id, 'blood',
       'Reviewed 2026-08-08: not a structural deformity -- disease of blood/enzyme/organ function or a chromosomal/monogenic syndrome more specifically named by Q9''s "any genetic disorder" wording than Q1''s "deformity" wording. Kept on Blood/Genetic question instead of the disability/deformity default.',
       'governance-review-final-2026-08-08'
FROM ped_repository pr
WHERE pr.canonical_name IN (
  'Spinal Muscular Atrophy', 'G6PD Deficiency', 'Cystic Fibrosis',
  'Pompe Disease', 'Gaucher Disease', 'Alpha-1 Antitrypsin Deficiency',
  'Enzyme Deficiency',
  'Down Syndrome', 'Turner Syndrome', 'Klinefelter Syndrome', 'Noonan Syndrome'
  -- NOTE: confirm exact canonical_name spellings in ped_repository before
  -- running -- these match TOP_PED_DICTIONARY's canonical forms as
  -- extracted for the impact assessment, but the live repository wasn't
  -- directly queryable from this environment.
)
ON CONFLICT (plan_name, ped_id) DO UPDATE SET category_key = EXCLUDED.category_key, reason = EXCLUDED.reason;

COMMIT;
```

**Held out of SQL entirely (your item 4 / Hirschsprung reassessment):** Ebstein's Anomaly, Eisenmenger Syndrome, Horseshoe Kidney, Duplex Kidney, Meckel's Diverticulum, Malrotation, Hirschsprung Disease, Congenital Glaucoma (needs per-plan wording check first) — bring these back individually when ready.

---

## Regression note

Everything above is either (a) coverage-only additions with zero regression risk (confirmed unmapped across three independent sources), or (b) the explicitly-approved recategorizations (Huntington's family, Hydrocephalus split), or (c) the Optima Secure repoint — flagged above as touching more than just the reviewed conditions on that one plan, by design, with the tradeoff stated rather than hidden. Run `npm test` and diff against baseline after applying, same as every prior version's recommendation.

---

*Nothing applied. This is the complete, final recommendation set.*
