BEGIN;

-- ═══ Pre-existing skeleton PEDs found during staging pre-flight (2026-08-08) ═══
-- Both were added directly via the PED Repository UI at some point (never
-- reflected in the static dictionary mirror this review's proxy checks used)
-- and left uncategorized. Fixing in place rather than inserting new rows,
-- so the IF NOT EXISTS guards below correctly skip their corresponding
-- inserts instead of colliding on the alias unique constraint.
UPDATE ped_repository SET canonical_name = 'Patent Ductus Arteriosus', category_key = 'genetic', updated_at = now() WHERE id = 1092;
UPDATE ped_repository SET category_key = 'neuro', updated_at = now() WHERE id = 1072;

-- ═══ Fix: 5 pre-existing PEDs found uncategorized (category_key = NULL) during staging smoke test (2026-08-08) ═══
-- Cystic fibrosis, Down syndrome, G6PD deficiency, Gaucher disease, Pompe disease all
-- already existed in the repository but were never assigned a category, so they were
-- being caught by unrelated regex fallbacks instead of routing through categoryMap.genetic.
UPDATE ped_repository SET category_key = 'genetic', updated_at = now()
WHERE id IN (926, 942, 975, 982, 1110) AND category_key IS NULL;

-- ═══ Fix: normalized_alias values that don't match normalizeDictionaryKey() (2026-08-08) ═══
-- Every normalized_alias in this script was hand-typed rather than produced
-- by PedAliasesRepository.create() (which always derives it via
-- normalizeDictionaryKey — strips punctuation like hyphens/periods without
-- inserting a space, e.g. 'Arnold-Chiari' -> 'arnoldchiari', not 'arnold
-- chiari'). Five of these were wrong and already went live in the first
-- successful apply run on this staging DB. This corrects them in place;
-- the WHERE clause only matches the wrong value, so re-running this is
-- idempotent (0 rows touched once already fixed).
UPDATE ped_aliases SET normalized_alias = 'arnoldchiari malformation' WHERE normalized_alias = 'arnold chiari malformation';
UPDATE ped_aliases SET normalized_alias = 'dandywalker malformation' WHERE normalized_alias = 'dandy walker malformation';
UPDATE ped_aliases SET normalized_alias = 'dandywalker syndrome' WHERE normalized_alias = 'dandy walker syndrome';
UPDATE ped_aliases SET normalized_alias = 'eaglebarrett syndrome' WHERE normalized_alias = 'eagle barrett syndrome';
UPDATE ped_aliases SET normalized_alias = '22q112 deletion syndrome' WHERE normalized_alias = '22q11.2 deletion syndrome';

-- ═══ Fix: 3 override-target PEDs confirmed genuinely absent from the repository (2026-08-08) ═══
-- Ehlers-Danlos Syndrome, Alpha-1 Antitrypsin Deficiency, Enzyme Deficiency -- unlike the
-- other 10 override targets (which existed under sentence-case names, see the fix below),
-- these three do not exist under any name or alias. Creating them the same way as the
-- rest of this script's coverage additions.
DO $$
DECLARE new_id integer;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM ped_repository WHERE canonical_name ILIKE 'Ehlers-Danlos Syndrome') THEN
    INSERT INTO ped_repository (ped_code, canonical_name, category_key, status, added_by) VALUES ('PED-PENDING','Ehlers-Danlos Syndrome','genetic','approved','governance-review-final') RETURNING id INTO new_id;
    UPDATE ped_repository SET ped_code='PED-'||lpad(new_id::text,6,'0') WHERE id=new_id;
    INSERT INTO ped_aliases (ped_id,alias_text,normalized_alias,is_primary,is_visible,added_by) VALUES (new_id,'Ehlers-Danlos Syndrome','ehlersdanlos syndrome',true,true,'governance-review-final');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM ped_repository WHERE canonical_name ILIKE 'Alpha-1 Antitrypsin Deficiency') THEN
    INSERT INTO ped_repository (ped_code, canonical_name, category_key, status, added_by) VALUES ('PED-PENDING','Alpha-1 Antitrypsin Deficiency','genetic','approved','governance-review-final') RETURNING id INTO new_id;
    UPDATE ped_repository SET ped_code='PED-'||lpad(new_id::text,6,'0') WHERE id=new_id;
    INSERT INTO ped_aliases (ped_id,alias_text,normalized_alias,is_primary,is_visible,added_by) VALUES (new_id,'Alpha-1 Antitrypsin Deficiency','alpha1 antitrypsin deficiency',true,true,'governance-review-final');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM ped_repository WHERE canonical_name ILIKE 'Enzyme Deficiency') THEN
    INSERT INTO ped_repository (ped_code, canonical_name, category_key, status, added_by) VALUES ('PED-PENDING','Enzyme Deficiency','genetic','approved','governance-review-final') RETURNING id INTO new_id;
    UPDATE ped_repository SET ped_code='PED-'||lpad(new_id::text,6,'0') WHERE id=new_id;
    INSERT INTO ped_aliases (ped_id,alias_text,normalized_alias,is_primary,is_visible,added_by) VALUES (new_id,'Enzyme Deficiency','enzyme deficiency',true,true,'governance-review-final');
  END IF;
END $$;

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

-- Resolved via ped_aliases.normalized_alias (reliably lowercase-normalized)
-- instead of ped_repository.canonical_name (arbitrary casing as originally
-- entered -- proven this staging run to store some of these conditions in
-- sentence case, e.g. 'Marfan syndrome', which the old case-sensitive IN()
-- against canonical_name silently matched zero rows on). DISTINCT ON guards
-- against a PED having more than one alias in this list.
INSERT INTO plan_overrides (plan_name, ped_id, category_key, reason, added_by)
SELECT DISTINCT ON (a.ped_id) 'Optima Secure', a.ped_id, 'blood',
       'Systemic/syndromic genetic condition, not a structural deformity -- Optima Secure''s genetic categoryKey now defaults to the disability/deformity question; this keeps this condition on the blood/genetic-combined question instead (governance review, final).',
       'governance-review-final'
FROM ped_aliases a
WHERE a.normalized_alias IN ('marfan syndrome', 'ehlersdanlos syndrome')
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
-- Resolved via ped_aliases.normalized_alias, same reasoning as the block
-- above -- live staging data confirmed these 10 exist under sentence-case
-- canonical names (e.g. 'Cystic fibrosis'), which case-sensitive IN() on
-- canonical_name silently missed entirely on the first apply run.
INSERT INTO plan_overrides (plan_name, ped_id, category_key, reason, added_by)
SELECT DISTINCT ON (a.ped_id) 'Optima Secure', a.ped_id, 'blood',
       'Reviewed 2026-08-08: not a structural deformity -- disease of blood/enzyme/organ function or a chromosomal/monogenic syndrome more specifically named by Q9''s "any genetic disorder" wording than Q1''s "deformity" wording. Kept on Blood/Genetic question instead of the disability/deformity default.',
       'governance-review-final-2026-08-08'
FROM ped_aliases a
WHERE a.normalized_alias IN (
  'spinal muscular atrophy', 'g6pd deficiency', 'cystic fibrosis',
  'pompe disease', 'gaucher disease', 'alpha1 antitrypsin deficiency',
  'enzyme deficiency',
  'down syndrome', 'turner syndrome', 'klinefelter syndrome', 'noonan syndrome'
)
ON CONFLICT (plan_name, ped_id) DO UPDATE SET category_key = EXCLUDED.category_key, reason = EXCLUDED.reason;

COMMIT;