-- PED Directory Cleanup and Standardization
--
-- Scope (per admin request): consolidate synonym/acronym coverage under
-- consistent categories, expand bare acronyms with their full medical name
-- as a sibling row, and add missing PEDs surfaced by cross-referencing
-- SCRIPT_DICTIONARY / COMMON_SMOKE_TEST_PEDS / MASTER_ILLNESSES against the
-- live ped_directory dump. Each row still maps 1 term -> 1 optional
-- category (this table has no alias/grouping column), so "grouping
-- synonyms" is implemented as: every synonym gets its own row, all sharing
-- the same category key. No rows are deleted:
--   - The apparent "typo" duplicates (e.g. "Apendicitis" alongside
--     "Appendicitis") are a deliberate, pre-existing pattern in the seed
--     data -- catching common misspellings advisors actually type -- not
--     accidental noise, so they're left intact.
--   - None of the exact noise phrases the admin named ("History of X",
--     "Treated", "Follow-up", "Resolved", etc.) exist anywhere in the live
--     1205-row dataset. A handful of borderline status-style rows
--     ("Dialysis patient", "HIV negative", "Routine general checkup", etc.)
--     were found and are being flagged to the admin for a manual call
--     rather than deleted unilaterally here.

-- 1. Category fixes: same medical concept already has a categorized
--    sibling row, but this row's category was left null at seed time.
UPDATE "ped_directory" SET "category" = 'neuro' WHERE "term" = 'Absence seizures' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_directory" SET "category" = 'neuro' WHERE "term" = 'Alzheimer''s' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_directory" SET "category" = 'psychiatric' WHERE "term" = 'Bipolar disorder' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_directory" SET "category" = 'digestive' WHERE "term" = 'Crohn''s disease' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_directory" SET "category" = 'diabetes' WHERE "term" = 'Diabetic foot' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_directory" SET "category" = 'endocrine' WHERE "term" = 'Hashimoto''s thyroiditis' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_directory" SET "category" = 'neuro' WHERE "term" = 'Hirayama disease' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_directory" SET "category" = 'neoplasm' WHERE "term" = 'Hodgkin''s lymphoma' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_directory" SET "category" = 'acute_infection' WHERE "term" = 'Hookworm infection' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_directory" SET "category" = 'psychiatric' WHERE "term" = 'Insomnia disorder' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_directory" SET "category" = 'respiratory' WHERE "term" = 'Lung disorder' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_directory" SET "category" = 'eyeEnt' WHERE "term" = 'Meniere''s disease' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_directory" SET "category" = 'eyeEnt' WHERE "term" = 'Nasal polyps' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_directory" SET "category" = 'digestive' WHERE "term" = 'Peptic ulcer disease' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_directory" SET "category" = 'vascular_fallback' WHERE "term" = 'Raynaud''s phenomenon' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_directory" SET "category" = 'neuro' WHERE "term" = 'Seizures' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_directory" SET "category" = 'autoimmune' WHERE "term" = 'Sjogren''s syndrome' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_directory" SET "category" = 'endocrine' WHERE "term" = 'Thyroid' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_directory" SET "category" = 'reproductive' WHERE "term" = 'Uterine fibroids' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_directory" SET "category" = 'acute_infection' WHERE "term" = 'Zika virus infection' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_directory" SET "category" = 'psychiatric' WHERE "term" = 'Generalised anxiety disorder' AND "category" IS NULL;
--> statement-breakpoint

-- Hypercholesterolemia/lipid synonym cluster (admin's own worked example) --
-- three British-spelling siblings were left uncategorized at seed time
-- even though their American-spelling / lay-term equivalents are tagged
-- 'lipid'.
UPDATE "ped_directory" SET "category" = 'lipid' WHERE "term" = 'Hypercholesterolaemia' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_directory" SET "category" = 'lipid' WHERE "term" = 'Hyperlipidaemia' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_directory" SET "category" = 'lipid' WHERE "term" = 'Hypertriglyceridaemia' AND "category" IS NULL;
--> statement-breakpoint

-- 2 & 3. Grouped synonym coverage for the admin's four worked examples, plus
-- acronym expansions and the explicitly-requested ACL addition. All
-- additive (ON CONFLICT DO NOTHING protects against any accidental
-- overlap with an existing row), each row categorized to match its
-- synonym siblings above.
INSERT INTO "ped_directory" ("term", "category", "added_by") VALUES
  -- PTCA / Angioplasty cluster
  ('Percutaneous Transluminal Coronary Angioplasty', 'heart', 'System (cleanup)'),
  -- Type 1 diabetes cluster
  ('Type 1 DM', 'diabetes', 'System (cleanup)'),
  ('Juvenile Diabetes', 'diabetes', 'System (cleanup)'),
  -- Type 2 diabetes cluster
  ('Type 2 DM', 'diabetes', 'System (cleanup)'),
  ('Hyperglycemia', 'diabetes', 'System (cleanup)'),
  ('High Glucose Levels', 'diabetes', 'System (cleanup)'),
  -- Hypertension cluster
  ('Systemic Hypertension', 'hypertension', 'System (cleanup)'),
  -- Hypercholesterolemia / lipid cluster
  ('Hypercholesterolemia', 'lipid', 'System (cleanup)'),
  ('Hypertriglyceridemia', 'lipid', 'System (cleanup)'),
  ('Dyslipidaemia', 'lipid', 'System (cleanup)'),
  ('High LDL', 'lipid', 'System (cleanup)'),
  ('Elevated Cholesterol', 'lipid', 'System (cleanup)'),
  ('Hyperlipoproteinemia', 'lipid', 'System (cleanup)'),
  -- Acronym expansions (full medical name added as sibling row)
  ('Attention-Deficit/Hyperactivity Disorder', 'psychiatric', 'System (cleanup)'),
  ('Acquired Immunodeficiency Syndrome', 'hiv', 'System (cleanup)'),
  ('Cerebrovascular Accident', 'neuro', 'System (cleanup)'),
  ('Gastroesophageal Reflux Disease', 'digestive', 'System (cleanup)'),
  ('Gastro-Oesophageal Reflux Disease', 'digestive', 'System (cleanup)'),
  ('Human Papillomavirus Infection', 'hiv', 'System (cleanup)'),
  ('Inflammatory Bowel Disease', 'digestive', 'System (cleanup)'),
  ('Implantable Cardioverter Defibrillator', 'heart', 'System (cleanup)'),
  ('In Vitro Fertilization', 'reproductive', 'System (cleanup)'),
  ('Left Bundle Branch Block', 'heart', 'System (cleanup)'),
  ('Right Bundle Branch Block', 'heart', 'System (cleanup)'),
  ('Obsessive-Compulsive Disorder', 'psychiatric', 'System (cleanup)'),
  ('Posterior Cruciate Ligament Tear', 'musculoskeletal', 'System (cleanup)'),
  ('Post-Traumatic Stress Disorder', 'psychiatric', 'System (cleanup)'),
  -- ACL — explicitly called out as missing by the admin
  ('ACL', 'musculoskeletal', 'System (cleanup)'),
  ('Anterior Cruciate Ligament', 'musculoskeletal', 'System (cleanup)'),
  ('Anterior Cruciate Ligament Tear', 'musculoskeletal', 'System (cleanup)'),
  ('ACL Reconstruction', 'musculoskeletal', 'System (cleanup)'),
  -- Additional common PEDs confirmed missing via cross-reference against
  -- SCRIPT_DICTIONARY / MASTER_ILLNESSES for better mapping coverage
  ('Rheumatism', 'musculoskeletal', 'System (cleanup)'),
  ('Rhinitis', 'eyeEnt', 'System (cleanup)'),
  ('Meniscus Tear', 'musculoskeletal', 'System (cleanup)'),
  ('Herniated Disc', 'musculoskeletal', 'System (cleanup)'),
  ('Rotator Cuff Tear', 'musculoskeletal', 'System (cleanup)'),
  ('Dysfunctional Uterine Bleeding', 'reproductive', 'System (cleanup)'),
  ('Enlarged Prostate', NULL, 'System (cleanup)')
ON CONFLICT ("term") DO NOTHING;
