-- Backfill mapping categories for the PED Directory (ped_suggestions)
-- rows that were seeded before the `category` column existed (migration
-- 0008). Categories are derived from TOP_PED_DICTIONARY (src/types.ts) —
-- the same categoryKey set the live matching engine already resolves PEDs
-- to — matched against each directory term's original raw dictionary key.
-- 376 of 1223 seeded terms have no direct dictionary match (they came from
-- SCRIPT_DICTIONARY or a small hardcoded extras list with no category
-- source) and are intentionally left uncategorized here; an admin can
-- assign those from the PED Directory page.
--
-- `AND "category" IS NULL` makes this safe to run more than once and
-- guarantees it never overwrites a category an admin has since assigned
-- by hand.
UPDATE "ped_suggestions" SET "category" = 'psychiatric' WHERE "term" = 'ADHD' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'heart' WHERE "term" = 'AFib' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'hiv' WHERE "term" = 'AIDS' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'kidney' WHERE "term" = 'AKI' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'neoplasm' WHERE "term" = 'ALL' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'neoplasm' WHERE "term" = 'ALL cancer' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'neoplasm' WHERE "term" = 'AML' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'digestive' WHERE "term" = 'APD' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'genetic' WHERE "term" = 'ASD' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'heart' WHERE "term" = 'AV block' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'musculoskeletal' WHERE "term" = 'AVN' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'digestive' WHERE "term" = 'Abdominal tuberculosis' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'endocrine' WHERE "term" = 'Abnormal thyroid' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'neuro' WHERE "term" = 'Abscence seizure' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'neuro' WHERE "term" = 'Absence seizure' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'acute_trauma' WHERE "term" = 'Accident' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'acute_trauma' WHERE "term" = 'Accidental injury' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'genetic' WHERE "term" = 'Achondroplasia' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'genetic' WHERE "term" = 'Achondroplasia dwarfism' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'digestive' WHERE "term" = 'Acid peptic disease' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'digestive' WHERE "term" = 'Acid reflux' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'ambiguous_symptom' WHERE "term" = 'Acidity' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'ambiguous_symptom' WHERE "term" = 'Acne' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'benign_growth' WHERE "term" = 'Acoustic neuroma' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'benign_growth' WHERE "term" = 'Acoustic neuroma ear' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'endocrine' WHERE "term" = 'Acromegaly' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'endocrine' WHERE "term" = 'Acromegaly hormone' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'kidney' WHERE "term" = 'Acute kidney injury' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'neoplasm' WHERE "term" = 'Acute lymphocytic leukemia' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'neoplasm' WHERE "term" = 'Acute myeloid leukemia' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'digestive' WHERE "term" = 'Acute pancreatitis' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'endocrine' WHERE "term" = 'Addison disease' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'endocrine' WHERE "term" = 'Addison''s disease' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'neoplasm' WHERE "term" = 'Adenocarcinoma colon' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'benign_growth' WHERE "term" = 'Adenofibroma' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'benign_growth' WHERE "term" = 'Adenofibroma breast' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'eyeEnt' WHERE "term" = 'Adenoid' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'eyeEnt' WHERE "term" = 'Adenoid hypertrophy' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'eyeEnt' WHERE "term" = 'Adenoids' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'endocrine' WHERE "term" = 'Adenoma adrenal' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'endocrine' WHERE "term" = 'Adenoma parathyroid' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'endocrine' WHERE "term" = 'Adenoma thyroid' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'reproductive' WHERE "term" = 'Adenomyosis' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'endocrine' WHERE "term" = 'Adrenal insufficiency' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'allergy' WHERE "term" = 'Allergic' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'ambiguous_symptom' WHERE "term" = 'Allergic condition' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'eye' WHERE "term" = 'Allergic conjunctivitis' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'eyeEnt' WHERE "term" = 'Allergic rhinitis' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'allergy' WHERE "term" = 'Allergy' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'skin' WHERE "term" = 'Alopecia' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'skin' WHERE "term" = 'Alopecia areata' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'genetic' WHERE "term" = 'Alpha-1 antitrypsin deficiency' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'neuro' WHERE "term" = 'Alzheimer disease' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'neuro' WHERE "term" = 'Alzheimer''s disease' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'acute_infection' WHERE "term" = 'Amoebiasis' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'autoimmune' WHERE "term" = 'Amyloidosis' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'autoimmune' WHERE "term" = 'Amyloidosis systemic' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'digestive' WHERE "term" = 'Anal fissure' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'digestive' WHERE "term" = 'Anal fistula' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'neoplasm' WHERE "term" = 'Anaplastic thyroid cancer' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'blood' WHERE "term" = 'Anemia' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'heart' WHERE "term" = 'Angina' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'heart' WHERE "term" = 'Angina pectoris' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'heart' WHERE "term" = 'Angioplasty' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'autoimmune' WHERE "term" = 'Ankylosing spondylitis' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'psychiatric' WHERE "term" = 'Anorexia' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'psychiatric' WHERE "term" = 'Anxiety' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'heart' WHERE "term" = 'Aortic aneurysm' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'heart' WHERE "term" = 'Aortic regurgitation' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'heart' WHERE "term" = 'Aortic stenosis' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'digestive' WHERE "term" = 'Apendicitis' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'blood' WHERE "term" = 'Aplastic anemia' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'blood' WHERE "term" = 'Aplastic anemia critical' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'digestive' WHERE "term" = 'Appendicitis' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'digestive' WHERE "term" = 'Appendicitis surgery' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'digestive' WHERE "term" = 'Appendix surgery' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'acute_infection' WHERE "term" = 'Ascariasis' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'liver' WHERE "term" = 'Ascites' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'acute_infection' WHERE "term" = 'Aspergillosis' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'respiratory' WHERE "term" = 'Asthma' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'eye' WHERE "term" = 'Astigmatism' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'neoplasm' WHERE "term" = 'Astrocytoma' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'neoplasm' WHERE "term" = 'Astrocytoma brain' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'skin' WHERE "term" = 'Atopic dermatitis' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'heart' WHERE "term" = 'Atrial fibrillation' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'heart' WHERE "term" = 'Atrial flutter' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'heart' WHERE "term" = 'Atrial myxoma' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'genetic' WHERE "term" = 'Atrial septal defect' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'psychiatric' WHERE "term" = 'Autism' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'autoimmune' WHERE "term" = 'Autoimmune disease' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'autoimmune' WHERE "term" = 'Autoimmune disorder' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'musculoskeletal' WHERE "term" = 'Avascular necrosis' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'reproductive' WHERE "term" = 'BPH' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'reproductive' WHERE "term" = 'BPH surgery' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'reproductive' WHERE "term" = 'Bartholin cyst' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'neoplasm' WHERE "term" = 'Basal cell carcinoma' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'neoplasm' WHERE "term" = 'Basal cell carcinoma bcc' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'autoimmune' WHERE "term" = 'Behcet disease' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'neuro' WHERE "term" = 'Bell''s palsy' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'benign_growth' WHERE "term" = 'Benign brain tumor' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'benign_growth' WHERE "term" = 'Benign growth' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'reproductive' WHERE "term" = 'Benign prostatic hyperplasia' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'psychiatric' WHERE "term" = 'Bipolar' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'neoplasm' WHERE "term" = 'Bladder cancer' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'kidney' WHERE "term" = 'Bladder stone' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'neoplasm' WHERE "term" = 'Bladder tumor neoplasm' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'blood' WHERE "term" = 'Bleeding disorder' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'eye' WHERE "term" = 'Blepharitis' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'ambiguous_symptom' WHERE "term" = 'Body pain' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'blood' WHERE "term" = 'Bone marrow hypoplasia' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'diabetes' WHERE "term" = 'Borderline diabetic' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'neuro' WHERE "term" = 'Brain abscess' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'neuro' WHERE "term" = 'Brain hemorrhage' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'benign_growth' WHERE "term" = 'Breast calcification' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'neoplasm' WHERE "term" = 'Breast cancer' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'benign_growth' WHERE "term" = 'Breast clinic evaluation' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'benign_growth' WHERE "term" = 'Breast cyst' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'benign_growth' WHERE "term" = 'Breast cyst benign' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'benign_growth' WHERE "term" = 'Breast lump' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'benign_growth' WHERE "term" = 'Breast lump evaluation' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'ambiguous_symptom' WHERE "term" = 'Breathlessness' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'respiratory' WHERE "term" = 'Bronchial asthma' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'respiratory' WHERE "term" = 'Bronchiectasis' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'neoplasm' WHERE "term" = 'Bronchogenic carcinoma' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'acute_infection' WHERE "term" = 'Brucellosis' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'psychiatric' WHERE "term" = 'Bulimia' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'heart' WHERE "term" = 'Bundle branch block' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'heart' WHERE "term" = 'CABG' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'heart' WHERE "term" = 'CAD' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'endocrine' WHERE "term" = 'CAH' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'heart' WHERE "term" = 'CHF' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'kidney' WHERE "term" = 'CKD' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'neoplasm' WHERE "term" = 'CLL' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'neoplasm' WHERE "term" = 'CML' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'acute_infection' WHERE "term" = 'CMV' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'respiratory' WHERE "term" = 'COPD' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'neuro' WHERE "term" = 'CVA' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'ambiguous_symptom' WHERE "term" = 'Calcium' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'ambiguous_symptom' WHERE "term" = 'Calcium deficiency' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'acute_infection' WHERE "term" = 'Candidiasis' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'eye' WHERE "term" = 'Cataract' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'digestive' WHERE "term" = 'Celiac disease' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'digestive' WHERE "term" = 'Celiac enteropathy' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'skin' WHERE "term" = 'Cellulitis' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'neuro' WHERE "term" = 'Cerebral palsy' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'neoplasm' WHERE "term" = 'Cervical cancer' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'musculoskeletal' WHERE "term" = 'Cervical spondylosis' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'eye' WHERE "term" = 'Chalazion' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'neuro' WHERE "term" = 'Charcot Marie Tooth disease' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'ambiguous_symptom' WHERE "term" = 'Chest pain' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'acute_infection' WHERE "term" = 'Chickenpox' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'acute_infection' WHERE "term" = 'Chikungunya' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'hiv' WHERE "term" = 'Chlamydia infection' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'digestive' WHERE "term" = 'Cholecystectomy' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'digestive' WHERE "term" = 'Cholelithiasis surgery' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'lipid' WHERE "term" = 'Cholesterol' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'lipid' WHERE "term" = 'Cholestrerol' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'neoplasm' WHERE "term" = 'Chondrosarcoma' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'neoplasm' WHERE "term" = 'Chondrosarcoma joints' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'respiratory' WHERE "term" = 'Chronic bronchitis' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'psychiatric' WHERE "term" = 'Chronic fatigue' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'psychiatric' WHERE "term" = 'Chronic fatigue syndrome' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'kidney' WHERE "term" = 'Chronic kidney disease' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'neoplasm' WHERE "term" = 'Chronic lymphocytic leukemia' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'neoplasm' WHERE "term" = 'Chronic myeloid leukemia' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'respiratory' WHERE "term" = 'Chronic obstructive pulmonary disease' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'musculoskeletal' WHERE "term" = 'Chronic pain syndrome' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'digestive' WHERE "term" = 'Chronic pancreatitis' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'eyeEnt' WHERE "term" = 'Chronic sinusitis' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'vascular_fallback' WHERE "term" = 'Chronic venous insufficiency' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'genetic' WHERE "term" = 'Cleft lip cleft palate' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'blood' WHERE "term" = 'Clotting disorder' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'blood' WHERE "term" = 'Clotting factor deficiency' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'genetic' WHERE "term" = 'Clubfoot deformity' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'blood' WHERE "term" = 'Coagulation disorder' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'blood' WHERE "term" = 'Coagulation pathway defect' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'digestive' WHERE "term" = 'Coeliac disease' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'digestive' WHERE "term" = 'Coeliac enteropathy' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'acute_infection' WHERE "term" = 'Cold' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'skin' WHERE "term" = 'Cold sores' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'neoplasm' WHERE "term" = 'Colon cancer' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'digestive' WHERE "term" = 'Colon polyp' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'digestive' WHERE "term" = 'Colon polyp removal' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'neoplasm' WHERE "term" = 'Colorectal cancer' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'neoplasm' WHERE "term" = 'Colorectal cancer neoplasm' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'acute_infection' WHERE "term" = 'Common cold' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'endocrine' WHERE "term" = 'Congenital adrenal hyperplasia' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'genetic' WHERE "term" = 'Congenital heart defect' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'ambiguous_symptom' WHERE "term" = 'Congestion' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'heart' WHERE "term" = 'Congestive heart failure' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'ambiguous_symptom' WHERE "term" = 'Constipation' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'skin' WHERE "term" = 'Contact dermatitis' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'heart' WHERE "term" = 'Coronary artery bypass' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'heart' WHERE "term" = 'Coronary artery disease' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'heart' WHERE "term" = 'Coronary artery spasm' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'heart' WHERE "term" = 'Coronary stent' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'ambiguous_symptom' WHERE "term" = 'Cough' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'benign_growth' WHERE "term" = 'Craniopharyngioma' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'benign_growth' WHERE "term" = 'Craniopharyngioma brain' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'ambiguous_symptom' WHERE "term" = 'Creatinine' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'digestive' WHERE "term" = 'Crohn disease' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'acute_infection' WHERE "term" = 'Cryptococcosis' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'endocrine' WHERE "term" = 'Cushing syndrome' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'endocrine' WHERE "term" = 'Cushing''s syndrome' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'genetic' WHERE "term" = 'Cystic fibrosis lungs' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'kidney' WHERE "term" = 'Cystitis' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'kidney' WHERE "term" = 'Cystoscopy done' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'acute_infection' WHERE "term" = 'Cytomegalovirus' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'neoplasm' WHERE "term" = 'DCIS' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'neoplasm' WHERE "term" = 'DCIS breast' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'diabetes' WHERE "term" = 'DKA history' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'eyeEnt' WHERE "term" = 'DNS' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'vascular_fallback' WHERE "term" = 'DVT' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'vascular_fallback' WHERE "term" = 'Deep vein thrombosis' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'heart' WHERE "term" = 'Defibrillator' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'ambiguous_symptom' WHERE "term" = 'Deficiency' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'neuro' WHERE "term" = 'Dementia' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'neuro' WHERE "term" = 'Demyelinating disease' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'acute_infection' WHERE "term" = 'Dengue' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'psychiatric' WHERE "term" = 'Depression' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'psychiatric' WHERE "term" = 'Depressive disorder' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'skin' WHERE "term" = 'Dermatitis' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'autoimmune' WHERE "term" = 'Dermatomyositis' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'eyeEnt' WHERE "term" = 'Deviated nasal septum' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'diabetes' WHERE "term" = 'Diabetes' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'endocrine' WHERE "term" = 'Diabetes insipidus' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'diabetes' WHERE "term" = 'Diabetes mellitus type 2' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'diabetes' WHERE "term" = 'Diabetes type 1' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'diabetes' WHERE "term" = 'Diabetes type 2' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'diabetes' WHERE "term" = 'Diabetic foot infection' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'diabetes' WHERE "term" = 'Diabetic foot ulcer' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'diabetes' WHERE "term" = 'Diabetic ketoacidosis' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'kidney' WHERE "term" = 'Diabetic nephropathy kidney' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'neuro' WHERE "term" = 'Diabetic neuropathy nerve' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'eye' WHERE "term" = 'Diabetic retinopathy' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'eye' WHERE "term" = 'Diabetic retinopathy eye' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'kidney' WHERE "term" = 'Dialysis' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'kidney' WHERE "term" = 'Dialysis patient' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'ambiguous_symptom' WHERE "term" = 'Diarrhea' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'heart' WHERE "term" = 'Dilated cardiomyopathy' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'acute_infection' WHERE "term" = 'Diphtheria' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'musculoskeletal' WHERE "term" = 'Disc bulge' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'digestive' WHERE "term" = 'Diverticulitis' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'genetic' WHERE "term" = 'Down syndrome genetic' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'allergy' WHERE "term" = 'Drug allergy' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'eye' WHERE "term" = 'Dry eye syndrome' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'neoplasm' WHERE "term" = 'Ductal carcinoma in situ' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'digestive' WHERE "term" = 'Duodenal ulcer' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'allergy' WHERE "term" = 'Dust allergy' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'lipid' WHERE "term" = 'Dyslipidemia' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'lipid' WHERE "term" = 'Dyslipidemia check' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'lipid' WHERE "term" = 'Dyslipidimia' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'lipid' WHERE "term" = 'Dyslipidmia' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'reproductive' WHERE "term" = 'Dysmenorrhea' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'kidney' WHERE "term" = 'ESRD' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'acute_infection' WHERE "term" = 'Ebola' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'hypertension' WHERE "term" = 'Eclampsia' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'skin' WHERE "term" = 'Eczema' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'genetic' WHERE "term" = 'Ehlers Danlos syndrome' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'genetic' WHERE "term" = 'Ehlers Danlos syndrome joints' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'respiratory' WHERE "term" = 'Emphysema' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'neuro' WHERE "term" = 'Encephalitis' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'kidney' WHERE "term" = 'End stage renal disease' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'heart' WHERE "term" = 'Endocarditis' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'neoplasm' WHERE "term" = 'Endometrial cancer' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'reproductive' WHERE "term" = 'Endometriosis' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'genetic' WHERE "term" = 'Enzyme deficiency metabolic' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'eosinophilia_finding' WHERE "term" = 'Eosinophilia' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'neoplasm' WHERE "term" = 'Ependymoma brain' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'reproductive' WHERE "term" = 'Epididymitis' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'neuro' WHERE "term" = 'Epilepsy' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'acute_infection' WHERE "term" = 'Epstein barr virus' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'hypertension' WHERE "term" = 'Essential hypertension htn' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'blood' WHERE "term" = 'Essential thrombocythemia' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'neuro' WHERE "term" = 'Essential tremor' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'neoplasm' WHERE "term" = 'Ewing sarcoma' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'neoplasm' WHERE "term" = 'Ewing sarcoma bones' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'neuro' WHERE "term" = 'Facial paralysis' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'blood' WHERE "term" = 'Factor ix deficiency' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'blood' WHERE "term" = 'Factor viii deficiency' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'ambiguous_symptom' WHERE "term" = 'Fatigue' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'reproductive' WHERE "term" = 'Female infertility' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'digestive' WHERE "term" = 'Femoral hernia' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'acute_infection' WHERE "term" = 'Fever' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'benign_growth' WHERE "term" = 'Fibroadenoma' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'benign_growth' WHERE "term" = 'Fibroadenoma breast' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'benign_growth' WHERE "term" = 'Fibrocystic breast disease' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'musculoskeletal' WHERE "term" = 'Fibromyalgia' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'musculoskeletal' WHERE "term" = 'Fibrositis tissue' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'acute_infection' WHERE "term" = 'Filariasis' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'digestive' WHERE "term" = 'Fissurectomy' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'digestive' WHERE "term" = 'Fistulectomy' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'neoplasm' WHERE "term" = 'Follicular thyroid cancer' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'allergy' WHERE "term" = 'Food allergy' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'acute_infection' WHERE "term" = 'Food poisoning' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'acute_infection' WHERE "term" = 'Foos poisoning' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'musculoskeletal' WHERE "term" = 'Fracture healing with implant' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'neuro' WHERE "term" = 'Friedreich ataxia' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'neuro' WHERE "term" = 'Friedreich ataxia genetic' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'genetic' WHERE "term" = 'G6PD deficiency metabolic' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'psychiatric' WHERE "term" = 'GAD' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'neoplasm' WHERE "term" = 'GBM' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'neuro' WHERE "term" = 'GBS' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'diabetes' WHERE "term" = 'GDM' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'digestive' WHERE "term" = 'GERD' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'digestive' WHERE "term" = 'GORD' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'digestive' WHERE "term" = 'Gall bladder removal' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'digestive' WHERE "term" = 'Gall bladder stone' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'digestive' WHERE "term" = 'Gallbladder disease' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'digestive' WHERE "term" = 'Gallbladder stone' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'neoplasm' WHERE "term" = 'Ganglioma' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'ambiguous_symptom' WHERE "term" = 'Gas' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'ambiguous_symptom' WHERE "term" = 'Gas problem' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'neoplasm' WHERE "term" = 'Gastric cancer' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'digestive' WHERE "term" = 'Gastric erosion' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'digestive' WHERE "term" = 'Gastric polyp' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'digestive' WHERE "term" = 'Gastric polyp removal' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'digestive' WHERE "term" = 'Gastric problem' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'digestive' WHERE "term" = 'Gastric ulcer' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'digestive' WHERE "term" = 'Gastritis' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'acute_infection' WHERE "term" = 'Gastroenteritis' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'genetic' WHERE "term" = 'Gaucher disease genetic' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'hiv' WHERE "term" = 'General paresis' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'psychiatric' WHERE "term" = 'Generalized anxiety disorder' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'hiv' WHERE "term" = 'Genital herpes' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'kidney' WHERE "term" = 'Genitourinary tuberculosis' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'diabetes' WHERE "term" = 'Gestational diabetes' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'hypertension' WHERE "term" = 'Gestational hypertension' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'autoimmune' WHERE "term" = 'Giant cell arteritis' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'acute_infection' WHERE "term" = 'Giardiasis' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'endocrine' WHERE "term" = 'Gigantism' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'endocrine' WHERE "term" = 'Gigantism hormone' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'eye' WHERE "term" = 'Glaucoma' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'neoplasm' WHERE "term" = 'Glioblastoma' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'neoplasm' WHERE "term" = 'Glioblastoma multiforme' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'kidney' WHERE "term" = 'Glomerulonephritis' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'endocrine' WHERE "term" = 'Goiter' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'endocrine' WHERE "term" = 'Goitre' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'hiv' WHERE "term" = 'Gonorrhea infection' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'musculoskeletal' WHERE "term" = 'Gout' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'endocrine' WHERE "term" = 'Graves disease' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'endocrine' WHERE "term" = 'Graves'' disease' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'neuro' WHERE "term" = 'Guillain Barre syndrome' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'neuro' WHERE "term" = 'Gullian Barre syndrome' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'gynecomastia' WHERE "term" = 'Gynecomastia' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'digestive' WHERE "term" = 'H. pylori' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'neoplasm' WHERE "term" = 'HCC' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'neoplasm' WHERE "term" = 'HCC liver' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'heart' WHERE "term" = 'HCM' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'hiv' WHERE "term" = 'HIV negative' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'hiv' WHERE "term" = 'HIV positive' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'hiv' WHERE "term" = 'HPV infection' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'benign_growth' WHERE "term" = 'Haemangioma' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'digestive' WHERE "term" = 'Haemorrhoidectomy' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'digestive' WHERE "term" = 'Haemorrhoids' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'endocrine' WHERE "term" = 'Hashimoto thyroiditis' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'endocrine' WHERE "term" = 'Hasimoto thyroiditis' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'allergy' WHERE "term" = 'Hay fever' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'blood' WHERE "term" = 'Hb low' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'diabetes' WHERE "term" = 'HbA1c high' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'acute_trauma' WHERE "term" = 'Head injury' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'ambiguous_symptom' WHERE "term" = 'Headache' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'ambiguous_symptom' WHERE "term" = 'Headcahe' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'eyeEnt' WHERE "term" = 'Hearing loss' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'heart' WHERE "term" = 'Heart attack' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'heart' WHERE "term" = 'Heart block' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'heart' WHERE "term" = 'Heart failure' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'heart' WHERE "term" = 'Heart murmur systolic' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'heart' WHERE "term" = 'Heart transplant' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'ambiguous_symptom' WHERE "term" = 'Heartburn' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'benign_growth' WHERE "term" = 'Hemangioma' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'digestive' WHERE "term" = 'Hemmoroids' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'blood' WHERE "term" = 'Hemochromatosis' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'blood' WHERE "term" = 'Hemochromatosis blood' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'blood' WHERE "term" = 'Hemophilia' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'neuro' WHERE "term" = 'Hemorrhagic stroke' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'digestive' WHERE "term" = 'Hemorrhoids' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'liver' WHERE "term" = 'Hepatitis' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'acute_infection' WHERE "term" = 'Hepatitis a' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'neoplasm' WHERE "term" = 'Hepatocellular carcinoma' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'liver' WHERE "term" = 'Hepatomegaly' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'neuro' WHERE "term" = 'Hereditary spastic paraplegia' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'digestive' WHERE "term" = 'Hernioplasty' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'digestive' WHERE "term" = 'Herniorrhaphy' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'skin' WHERE "term" = 'Herpes zoster' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'digestive' WHERE "term" = 'Hiatal hernia' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'endocrine' WHERE "term" = 'High TSH' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'hypertension' WHERE "term" = 'High blood pressure' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'diabetes' WHERE "term" = 'High blood sugar' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'diabetes' WHERE "term" = 'High blood sugar state' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'hypertension' WHERE "term" = 'High bp' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'lipid' WHERE "term" = 'High cholesterol' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'lipid' WHERE "term" = 'High cholesterol level' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'ambiguous_symptom' WHERE "term" = 'High creatinine' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'eosinophilia_finding' WHERE "term" = 'High eosinophils' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'lipid' WHERE "term" = 'High triglycerides' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'ambiguous_symptom' WHERE "term" = 'High uric acid' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'neuro' WHERE "term" = 'Hirayama' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'skin' WHERE "term" = 'Hives' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'neoplasm' WHERE "term" = 'Hodgkin lymphoma' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'acute_infection' WHERE "term" = 'Hookworm' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'neuro' WHERE "term" = 'Huntington chorea' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'neuro' WHERE "term" = 'Huntington chorea neuro' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'neuro' WHERE "term" = 'Huntington disease neuro' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'reproductive' WHERE "term" = 'Hydrocele' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'endocrine' WHERE "term" = 'Hyperaldosteronism' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'endocrine' WHERE "term" = 'Hyperaldosteronism adrenal' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'lipid' WHERE "term" = 'Hypercholesterolemia state' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'diabetes' WHERE "term" = 'Hyperglycemia episode' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'lipid' WHERE "term" = 'Hyperlipidemia' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'lipid' WHERE "term" = 'Hyperlipidemia treated' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'lipid' WHERE "term" = 'Hyperlipidemia untreated' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'lipid' WHERE "term" = 'Hyperlipidimia' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'lipid' WHERE "term" = 'Hyperlipidmia' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'eye' WHERE "term" = 'Hyperopia' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'endocrine' WHERE "term" = 'Hyperparathyroidism' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'hypertension' WHERE "term" = 'Hypertension' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'hypertension' WHERE "term" = 'Hypertension treated' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'hypertension' WHERE "term" = 'Hypertension untreated' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'endocrine' WHERE "term" = 'Hyperthyroidism' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'lipid' WHERE "term" = 'Hypertriglyceridemia state' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'heart' WHERE "term" = 'Hypertrophic cardiomyopathy' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'diabetes' WHERE "term" = 'Hypoglycemia episode' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'reproductive' WHERE "term" = 'Hypogonadism' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'reproductive' WHERE "term" = 'Hypogonadism state' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'endocrine' WHERE "term" = 'Hypoparathyroidism' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'endocrine' WHERE "term" = 'Hypoparathyroidism state' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'endocrine' WHERE "term" = 'Hypopituitarism' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'endocrine' WHERE "term" = 'Hypopituitarism state' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'endocrine' WHERE "term" = 'Hypothyroidism' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'reproductive' WHERE "term" = 'Hysterectomy history' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'digestive' WHERE "term" = 'IBD' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'digestive' WHERE "term" = 'IBS' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'heart' WHERE "term" = 'ICD implantation' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'diabetes' WHERE "term" = 'IDDM' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'diabetes' WHERE "term" = 'IFG' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'diabetes' WHERE "term" = 'IGT' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'heart' WHERE "term" = 'IHD' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'respiratory' WHERE "term" = 'ILD' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'reproductive' WHERE "term" = 'IVF' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'diabetes' WHERE "term" = 'Impaired fasting glucose' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'diabetes' WHERE "term" = 'Impaired glucose tolerance' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'digestive' WHERE "term" = 'Incisional hernia' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'ambiguous_symptom' WHERE "term" = 'Indigestion' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'acute_infection' WHERE "term" = 'Infectious mononucleosis' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'reproductive' WHERE "term" = 'Infertility' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'reproductive' WHERE "term" = 'Infertillity' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'digestive' WHERE "term" = 'Inguinal hernia' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'psychiatric' WHERE "term" = 'Insomnia' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'diabetes' WHERE "term" = 'Insulin dependent diabetes' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'psychiatric' WHERE "term" = 'Intellectual disability' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'respiratory' WHERE "term" = 'Interstitial lung disease' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'digestive' WHERE "term" = 'Intestinal tuberculosis' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'ambiguous_symptom' WHERE "term" = 'Iron deficiency' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'blood' WHERE "term" = 'Iron deficiency anemia' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'digestive' WHERE "term" = 'Irritable bowel syndrome' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'heart' WHERE "term" = 'Ischaemic heart disease' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'neuro' WHERE "term" = 'Ischemic stroke' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'acute_infection' WHERE "term" = 'Japanese encephalitis' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'liver' WHERE "term" = 'Jaundice' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'neoplasm' WHERE "term" = 'Kaposi sarcoma' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'skin' WHERE "term" = 'Keloid' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'eye' WHERE "term" = 'Keratoconus' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'neoplasm' WHERE "term" = 'Kidney cancer' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'kidney' WHERE "term" = 'Kidney donor' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'kidney' WHERE "term" = 'Kidney failure' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'kidney' WHERE "term" = 'Kidney stone removal' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'kidney' WHERE "term" = 'Kidney stones' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'kidney' WHERE "term" = 'Kidney transplant' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'kidney' WHERE "term" = 'Kidneystone' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'genetic' WHERE "term" = 'Klinefelter syndrome' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'genetic' WHERE "term" = 'Klinefelter syndrome genetic' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'musculoskeletal' WHERE "term" = 'Kyphosis' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'heart' WHERE "term" = 'LBBB' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'neoplasm' WHERE "term" = 'LCIS' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'neoplasm' WHERE "term" = 'LCIS breast' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'eyeEnt' WHERE "term" = 'Labyrinthitis' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'respiratory' WHERE "term" = 'Laryngeal tuberculosis' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'eyeEnt' WHERE "term" = 'Laryngitis' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'allergy' WHERE "term" = 'Latex allergy' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'musculoskeletal' WHERE "term" = 'Leg fracture with implant' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'reproductive' WHERE "term" = 'Leiomyoma' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'neoplasm' WHERE "term" = 'Leiomyosarcoma' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'neoplasm' WHERE "term" = 'Leiomyosarcoma uterus' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'acute_infection' WHERE "term" = 'Leishmaniasis' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'skin' WHERE "term" = 'Leprosy' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'blood' WHERE "term" = 'Leukocytosis' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'blood' WHERE "term" = 'Leukopenia' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'lipid' WHERE "term" = 'Lipid profile high' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'benign_growth' WHERE "term" = 'Lipoma' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'neoplasm' WHERE "term" = 'Liposarcoma' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'neoplasm' WHERE "term" = 'Liposarcoma tissue' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'acute_infection' WHERE "term" = 'Listeriosis' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'liver' WHERE "term" = 'Liver abscess' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'neoplasm' WHERE "term" = 'Liver cancer' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'liver' WHERE "term" = 'Liver cyst' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'neoplasm' WHERE "term" = 'Lobular carcinoma in situ' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'ambiguous_symptom' WHERE "term" = 'Low blood level' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'diabetes' WHERE "term" = 'Low blood sugar finding' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'blood' WHERE "term" = 'Low hemoglobin' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'musculoskeletal' WHERE "term" = 'Lumbar spondylosis' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'neoplasm' WHERE "term" = 'Lung cancer' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'respiratory' WHERE "term" = 'Lung collapse' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'respiratory' WHERE "term" = 'Lung infection' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'respiratory' WHERE "term" = 'Lung tb' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'autoimmune' WHERE "term" = 'Lupus diagnosis' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'respiratory' WHERE "term" = 'Lymph node tuberculosis' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'benign_growth' WHERE "term" = 'Lymphangioma' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'vascular_fallback' WHERE "term" = 'Lymphedema' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'autoimmune' WHERE "term" = 'MCTD diagnosis' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'heart' WHERE "term" = 'MI' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'heart' WHERE "term" = 'MI history' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'neuro' WHERE "term" = 'MND' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'neuro' WHERE "term" = 'MS' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'heart' WHERE "term" = 'MVP' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'eye' WHERE "term" = 'Macular degeneration' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'acute_infection' WHERE "term" = 'Malaria' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'reproductive' WHERE "term" = 'Male infertility' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'neoplasm' WHERE "term" = 'Malignant melanoma skin' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'genetic' WHERE "term" = 'Marfan syndrome' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'genetic' WHERE "term" = 'Marfan syndrome aorta' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'blood' WHERE "term" = 'Mds diagnosis' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'neoplasm' WHERE "term" = 'Medullary thyroid cancer' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'neoplasm' WHERE "term" = 'Melanoma' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'eyeEnt' WHERE "term" = 'Meniere disease' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'benign_growth' WHERE "term" = 'Meningioma' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'benign_growth' WHERE "term" = 'Meningioma tumor' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'neuro' WHERE "term" = 'Meningitis' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'neuro' WHERE "term" = 'Meningococcal meningitis' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'reproductive' WHERE "term" = 'Menorrhagia' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'ambiguous_symptom' WHERE "term" = 'Microalbuminuria' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'neuro' WHERE "term" = 'Migraine' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'respiratory' WHERE "term" = 'Miliary tuberculosis' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'heart' WHERE "term" = 'Mitral regurgitation' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'heart' WHERE "term" = 'Mitral stenosis' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'heart' WHERE "term" = 'Mitral valve prolapse' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'autoimmune' WHERE "term" = 'Mixed connective tissue disease' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'psychiatric' WHERE "term" = 'Moderate intellectual disability' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'ambiguous_symptom' WHERE "term" = 'Morbid obesity' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'neuro' WHERE "term" = 'Motor neuron disease' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'neoplasm' WHERE "term" = 'Multiple myeloma' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'neuro' WHERE "term" = 'Multiple sclerosis' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'neuro' WHERE "term" = 'Muscular dystrophy' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'psychiatric' WHERE "term" = 'Myalgic encephalomyelitis' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'neuro' WHERE "term" = 'Myasthenia gravis' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'neuro' WHERE "term" = 'Myelitis' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'blood' WHERE "term" = 'Myelodysplastic syndrome' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'blood' WHERE "term" = 'Myelofibrosis disease' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'neoplasm' WHERE "term" = 'Myeloma diagnosis' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'heart' WHERE "term" = 'Myocardial infarction' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'heart' WHERE "term" = 'Myocarditis' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'eye' WHERE "term" = 'Myopia' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'benign_growth' WHERE "term" = 'Myxoma' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'neoplasm' WHERE "term" = 'NHL' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'diabetes' WHERE "term" = 'NIDDM' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'neoplasm' WHERE "term" = 'NSCLC' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'psychiatric' WHERE "term" = 'Narcolepsy' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'eyeEnt' WHERE "term" = 'Nasal polyp' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'ambiguous_symptom' WHERE "term" = 'Nausea' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'kidney' WHERE "term" = 'Nephrectomy history' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'kidney' WHERE "term" = 'Nephrolithiasis' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'kidney' WHERE "term" = 'Nephrotic syndrome' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'hiv' WHERE "term" = 'Neurosyphilis' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'neoplasm' WHERE "term" = 'Non Hodgkin lymphoma' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'diabetes' WHERE "term" = 'Non insulin dependent diabetes' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'neoplasm' WHERE "term" = 'Non small cell lung cancer' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'genetic' WHERE "term" = 'Noonan syndrome' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'genetic' WHERE "term" = 'Noonan syndrome genetic' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'psychiatric' WHERE "term" = 'OCD' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'genetic' WHERE "term" = 'OSA' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'ambiguous_symptom' WHERE "term" = 'Obesity' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'genetic' WHERE "term" = 'Obstructive sleep apnea' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'neoplasm' WHERE "term" = 'Oligodendroglioma brain' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'eye' WHERE "term" = 'Optic neuritis' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'musculoskeletal' WHERE "term" = 'Osteitis fibrosa cystica' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'musculoskeletal' WHERE "term" = 'Osteoarthritis' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'genetic' WHERE "term" = 'Osteogenesis imperfecta' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'genetic' WHERE "term" = 'Osteogenesis imperfecta bones' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'musculoskeletal' WHERE "term" = 'Osteomyelitis' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'musculoskeletal' WHERE "term" = 'Osteopenia' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'musculoskeletal' WHERE "term" = 'Osteoporosis' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'neoplasm' WHERE "term" = 'Osteosarcoma' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'neoplasm' WHERE "term" = 'Osteosarcoma bones' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'eyeEnt' WHERE "term" = 'Otitis externa' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'eyeEnt' WHERE "term" = 'Otitis media' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'neoplasm' WHERE "term" = 'Ovarian cancer' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'reproductive' WHERE "term" = 'Ovarian cyst' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'ambiguous_symptom' WHERE "term" = 'Overweight' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'musculoskeletal' WHERE "term" = 'PCL tear' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'reproductive' WHERE "term" = 'PCOD' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'reproductive' WHERE "term" = 'PCOS' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'hypertension' WHERE "term" = 'PIH' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'heart' WHERE "term" = 'PTCA' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'psychiatric' WHERE "term" = 'PTSD' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'heart' WHERE "term" = 'Pacemaker' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'ambiguous_symptom' WHERE "term" = 'Palpitations' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'neoplasm' WHERE "term" = 'Pancreatic cancer' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'digestive' WHERE "term" = 'Pancreatitis' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'blood' WHERE "term" = 'Pancytopenia state' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'endocrine' WHERE "term" = 'Panhypopituitarism' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'psychiatric' WHERE "term" = 'Panic disorder' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'neoplasm' WHERE "term" = 'Papillary thyroid cancer' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'endocrine' WHERE "term" = 'Paraganglioma tumor' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'neuro' WHERE "term" = 'Parkinson disease' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'neuro' WHERE "term" = 'Parkinson''s disease' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'neuro' WHERE "term" = 'Parkinsonism' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'allergy' WHERE "term" = 'Peanut allergy' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'allergy' WHERE "term" = 'Penicillin allergy' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'digestive' WHERE "term" = 'Peptic ulcer' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'heart' WHERE "term" = 'Pericardial effusion' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'heart' WHERE "term" = 'Pericarditis' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'neuro' WHERE "term" = 'Peripheral neuropathy' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'acute_infection' WHERE "term" = 'Pertussis' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'eyeEnt' WHERE "term" = 'Pharyngitis' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'endocrine' WHERE "term" = 'Pheochromocytoma' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'endocrine' WHERE "term" = 'Pheochromocytoma tumor' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'reproductive' WHERE "term" = 'Phimosis' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'digestive' WHERE "term" = 'Piles' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'skin' WHERE "term" = 'Pilodinal sinus' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'skin' WHERE "term" = 'Pilonidal sinus' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'endocrine' WHERE "term" = 'Pituitary adenoma' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'endocrine' WHERE "term" = 'Pituitary adenoma gland' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'musculoskeletal' WHERE "term" = 'Plantar fasciitis' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'neoplasm' WHERE "term" = 'Plasmacytoma' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'blood' WHERE "term" = 'Platelet low' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'respiratory' WHERE "term" = 'Pleural effusion' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'respiratory' WHERE "term" = 'Pleural tuberculosis' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'respiratory' WHERE "term" = 'Pleurisy' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'respiratory' WHERE "term" = 'Pneumothorax' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'allergy' WHERE "term" = 'Pollen allergy' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'reproductive' WHERE "term" = 'Polycystic ovarian syndrome' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'reproductive' WHERE "term" = 'Polycystic ovary disease' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'blood' WHERE "term" = 'Polycythemia' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'blood' WHERE "term" = 'Polycythemia vera' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'autoimmune' WHERE "term" = 'Polymyalgia rheumatica' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'autoimmune' WHERE "term" = 'Polymyositis' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'neuro' WHERE "term" = 'Polyneuropathy' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'genetic' WHERE "term" = 'Pompe disease genetic' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'blood' WHERE "term" = 'Porphyria' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'blood' WHERE "term" = 'Porphyria metabolic' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'liver' WHERE "term" = 'Portal hypertension' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'hiv' WHERE "term" = 'Positive HIV test' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'musculoskeletal' WHERE "term" = 'Pott''s disease' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'musculoskeletal' WHERE "term" = 'Potts disease spine tb' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'diabetes' WHERE "term" = 'Pre-diabetic condition' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'hypertension' WHERE "term" = 'Pre-eclampsia' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'hypertension' WHERE "term" = 'Preeclampsia' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'hypertension' WHERE "term" = 'Pregnancy induced hypertension' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'ambiguous_symptom' WHERE "term" = 'Premature baby' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'eye' WHERE "term" = 'Presbyopia' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'endocrine' WHERE "term" = 'Prolactinoma' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'endocrine' WHERE "term" = 'Prolactinoma pituitary' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'neoplasm' WHERE "term" = 'Prostate cancer' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'neoplasm' WHERE "term" = 'Prostate cancer neoplasm' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'reproductive' WHERE "term" = 'Prostate disease' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'reproductive' WHERE "term" = 'Prostatectomy' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'reproductive' WHERE "term" = 'Prostatitis' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'reproductive' WHERE "term" = 'Prostatomegaly' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'ambiguous_symptom' WHERE "term" = 'Proteinuria' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'endocrine' WHERE "term" = 'Pseudohypoparathyroidism' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'autoimmune' WHERE "term" = 'Psoriasis' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'autoimmune' WHERE "term" = 'Psoriatic arthritis joint' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'psychiatric' WHERE "term" = 'Psychosis' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'eye' WHERE "term" = 'Pterygium' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'kidney' WHERE "term" = 'Puj obstruction' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'vascular_fallback' WHERE "term" = 'Pulmonary embolism' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'respiratory' WHERE "term" = 'Pulmonary fibrosis' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'heart' WHERE "term" = 'Pulmonary regurgitation' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'heart' WHERE "term" = 'Pulmonary stenosis' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'respiratory' WHERE "term" = 'Pulmonary tuberculosis' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'digestive' WHERE "term" = 'Pylori' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'autoimmune' WHERE "term" = 'RA' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'heart' WHERE "term" = 'RBBB' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'neoplasm' WHERE "term" = 'RCC' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'neoplasm' WHERE "term" = 'RCC kidney' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'heart' WHERE "term" = 'RHD' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'acute_infection' WHERE "term" = 'Rabies' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'vascular_fallback' WHERE "term" = 'Raynaud disease' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'vascular_fallback' WHERE "term" = 'Raynaud phenomenon' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'autoimmune' WHERE "term" = 'Reactive arthritis joint' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'diabetes' WHERE "term" = 'Reactive hypoglycemia' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'neoplasm' WHERE "term" = 'Rectal cancer' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'autoimmune' WHERE "term" = 'Reiter syndrome' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'kidney' WHERE "term" = 'Renal calculi' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'kidney' WHERE "term" = 'Renal calculus' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'neoplasm' WHERE "term" = 'Renal cancer' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'neoplasm' WHERE "term" = 'Renal cell carcinoma' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'kidney' WHERE "term" = 'Renal failure' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'kidney' WHERE "term" = 'Renal transplant history' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'kidney' WHERE "term" = 'Renal tuberculosis' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'respiratory' WHERE "term" = 'Respiratory failure' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'heart' WHERE "term" = 'Restrictive cardiomyopathy' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'eye' WHERE "term" = 'Retinal detachment' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'eye' WHERE "term" = 'Retinopathy' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'neoplasm' WHERE "term" = 'Rhabdomyosarcoma' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'neoplasm' WHERE "term" = 'Rhabdomyosarcoma muscle' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'autoimmune' WHERE "term" = 'Rheumatic fever' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'heart' WHERE "term" = 'Rheumatic heart disease' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'autoimmune' WHERE "term" = 'Rheumatoid arthritis' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'skin' WHERE "term" = 'Ringworm' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'endocrine' WHERE "term" = 'SIADH' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'ambiguous_symptom' WHERE "term" = 'SOB' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'heart' WHERE "term" = 'SSS' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'hiv' WHERE "term" = 'STD profile' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'acute_infection' WHERE "term" = 'Salmonellosis' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'sarcoidosis' WHERE "term" = 'Sarcoidosis' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'sarcoidosis' WHERE "term" = 'Sarcoidosis lungs and lymph' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'respiratory' WHERE "term" = 'Sarcoidosis of lung' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'sarcoidosis' WHERE "term" = 'Sarcoidosis systemic' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'neoplasm' WHERE "term" = 'Sarcoma' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'neoplasm' WHERE "term" = 'Sarcoma bones' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'skin' WHERE "term" = 'Scabies' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'acute_infection' WHERE "term" = 'Scarlet fever' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'acute_infection' WHERE "term" = 'Schistosomiasis' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'psychiatric' WHERE "term" = 'Schizophrenia' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'benign_growth' WHERE "term" = 'Schwannoma' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'benign_growth' WHERE "term" = 'Schwanoma' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'musculoskeletal' WHERE "term" = 'Sciatica' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'autoimmune' WHERE "term" = 'Scleroderma skin' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'musculoskeletal' WHERE "term" = 'Scoliosis' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'skin' WHERE "term" = 'Sebaceous cyst' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'hypertension' WHERE "term" = 'Secondary hypertension htn' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'neuro' WHERE "term" = 'Seizure disorder' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'eyeEnt' WHERE "term" = 'Sensorineural hearing loss' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'skin' WHERE "term" = 'Shingles' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'ambiguous_symptom' WHERE "term" = 'Shortness of breath' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'musculoskeletal' WHERE "term" = 'Shoulder dislocation' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'heart' WHERE "term" = 'Sick sinus syndrome' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'blood' WHERE "term" = 'Sickle cell anemia' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'eyeEnt' WHERE "term" = 'Sinus surgery' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'eyeEnt' WHERE "term" = 'Sinusitis' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'autoimmune' WHERE "term" = 'Sjogren syndrome' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'musculoskeletal' WHERE "term" = 'Skeletal tuberculosis' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'autoimmune' WHERE "term" = 'Sle nephritis' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'genetic' WHERE "term" = 'Sleep apnea' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'psychiatric' WHERE "term" = 'Sleep disorder' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'musculoskeletal' WHERE "term" = 'Slipped disc' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'neoplasm' WHERE "term" = 'Small cell lung cancer' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'psychiatric' WHERE "term" = 'Somatoform pain' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'vascular_fallback' WHERE "term" = 'Spider veins' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'genetic' WHERE "term" = 'Spina bifida' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'neuro' WHERE "term" = 'Spinal cord injury' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'neoplasm' WHERE "term" = 'Spinal cord tumor' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'genetic' WHERE "term" = 'Spinal muscular atrophy' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'genetic' WHERE "term" = 'Spinal muscular atrophy SMA' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'musculoskeletal' WHERE "term" = 'Spinal stenosis' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'musculoskeletal' WHERE "term" = 'Spinal tuberculosis' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'musculoskeletal' WHERE "term" = 'Spine deformity' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'genetic' WHERE "term" = 'Spinocerebellar ataxia' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'neuro' WHERE "term" = 'Spinocerebellar ataxia genetic' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'liver' WHERE "term" = 'Splenomegaly' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'neoplasm' WHERE "term" = 'Squamous cell carcinoma' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'neoplasm' WHERE "term" = 'Squamous cell carcinoma scc' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'eye' WHERE "term" = 'Squint' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'eye' WHERE "term" = 'Squint surgery' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'heart' WHERE "term" = 'Stable angina' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'acute_trauma' WHERE "term" = 'Stitches' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'neoplasm' WHERE "term" = 'Stomach cancer' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'eye' WHERE "term" = 'Strabismus' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'heart' WHERE "term" = 'Stress test abnormal' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'neuro' WHERE "term" = 'Stroke' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'eye' WHERE "term" = 'Stye' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'neuro' WHERE "term" = 'Subdural empyema' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'vascular_fallback' WHERE "term" = 'Superficial thrombophlebitis' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'endocrine' WHERE "term" = 'Syndrome of inappropriate adh' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'hiv' WHERE "term" = 'Syphilis infection' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'autoimmune' WHERE "term" = 'Systemic lupus erythematosus' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'autoimmune' WHERE "term" = 'Systemic vasculitis' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'musculoskeletal' WHERE "term" = 'THR' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'neuro' WHERE "term" = 'TIA' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'musculoskeletal' WHERE "term" = 'TKR' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'heart' WHERE "term" = 'TMT test positive' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'ambiguous_symptom' WHERE "term" = 'TSH' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'hiv' WHERE "term" = 'Tabes dorsalis' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'acute_infection' WHERE "term" = 'Taeniasis' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'benign_growth' WHERE "term" = 'Teratoma' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'reproductive' WHERE "term" = 'Testicular cyst' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'genetic' WHERE "term" = 'Tetralogy of fallot' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'blood' WHERE "term" = 'Thalaseemia' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'blood' WHERE "term" = 'Thalassemia' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'blood' WHERE "term" = 'Thrombocytopenia' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'blood' WHERE "term" = 'Thrombocytosis' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'neoplasm' WHERE "term" = 'Thyroid cancer' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'endocrine' WHERE "term" = 'Thyroid disease' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'endocrine' WHERE "term" = 'Thyroid disorder' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'endocrine' WHERE "term" = 'Thyrotoxicosis' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'eyeEnt' WHERE "term" = 'Tinnitus' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'eyeEnt' WHERE "term" = 'Tonsilitis' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'eyeEnt' WHERE "term" = 'Tonsillectomy' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'eyeEnt' WHERE "term" = 'Tonsillitis' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'acute_infection' WHERE "term" = 'Toxoplasmosis' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'neuro' WHERE "term" = 'Transient ischemic attack' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'heart' WHERE "term" = 'Tricuspid regurgitation' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'heart' WHERE "term" = 'Tricuspid stenosis' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'neuro' WHERE "term" = 'Trigeminal neuralgia' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'respiratory' WHERE "term" = 'Tuberculous lymphadenitis' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'neuro' WHERE "term" = 'Tuberculous meningitis' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'digestive' WHERE "term" = 'Tuberculous peritonitis' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'genetic' WHERE "term" = 'Turner syndrome' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'genetic' WHERE "term" = 'Turner syndrome genetic' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'eyeEnt' WHERE "term" = 'Tymnoplasty' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'diabetes' WHERE "term" = 'Type 1 diabetes mellitus' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'diabetes' WHERE "term" = 'Type 2 diabetes mellitus' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'acute_infection' WHERE "term" = 'Typhoid' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'kidney' WHERE "term" = 'UTI' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'digestive' WHERE "term" = 'Ulcerative colitis' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'digestive' WHERE "term" = 'Umbilical hernia' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'heart' WHERE "term" = 'Unstable angina' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'kidney' WHERE "term" = 'Ureteric stone' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'ambiguous_symptom' WHERE "term" = 'Uric acid' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'kidney' WHERE "term" = 'Urinary tract infection' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'neoplasm' WHERE "term" = 'Uropithelial carcinoma' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'skin' WHERE "term" = 'Urticaria' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'neoplasm' WHERE "term" = 'Uterine cancer' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'reproductive' WHERE "term" = 'Uterine fibroid' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'reproductive' WHERE "term" = 'Uterus removal' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'eye' WHERE "term" = 'Uveitis' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'heart' WHERE "term" = 'VF' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'genetic' WHERE "term" = 'VSD' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'heart' WHERE "term" = 'VT' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'reproductive' WHERE "term" = 'Varicocele' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'vascular_fallback' WHERE "term" = 'Varicose vein' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'vascular_fallback' WHERE "term" = 'Varicose veins' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'vascular_fallback' WHERE "term" = 'Varicosity' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'hiv' WHERE "term" = 'Venereal disease' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'vascular_fallback' WHERE "term" = 'Venous insufficiency' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'heart' WHERE "term" = 'Ventricular fibrillation' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'genetic' WHERE "term" = 'Ventricular septal defect' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'heart' WHERE "term" = 'Ventricular tachycardia' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'eyeEnt' WHERE "term" = 'Vertigo' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'acute_infection' WHERE "term" = 'Viral fever' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'ambiguous_symptom' WHERE "term" = 'Vitamin b12 deficiency' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'ambiguous_symptom' WHERE "term" = 'Vitamin d def' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'ambiguous_symptom' WHERE "term" = 'Vitamin d deficiency' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'ambiguous_symptom' WHERE "term" = 'Vitamin d low' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'ambiguous_symptom' WHERE "term" = 'Vitamin defeciency' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'skin' WHERE "term" = 'Vitiligo' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'benign_growth' WHERE "term" = 'Vocal cord nodule' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'benign_growth' WHERE "term" = 'Vocal cord polyp' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'ambiguous_symptom' WHERE "term" = 'Vomiting' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'blood' WHERE "term" = 'Von Willebrand disease' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'acute_infection' WHERE "term" = 'Weils disease' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'ambiguous_symptom' WHERE "term" = 'Wheezing' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'acute_infection' WHERE "term" = 'Whooping cough' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'liver' WHERE "term" = 'Wilson disease liver' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'skin' WHERE "term" = 'Xanthelasma' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "ped_suggestions" SET "category" = 'acute_infection' WHERE "term" = 'Zika virus' AND "category" IS NULL;
