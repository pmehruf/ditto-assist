# PED Repository entity cleanup plan

Review each item, then run `scripts/applyEntityCleanupPlan.ts --apply` once approved.

## Action-phrase cleanup (rule 1)

12 items — {"rename":6,"merge_into":6}

### PED-000591 — "c section history"
- hit: "c section history" (canonicalName)
- treatment: **rename** -> "C-section"
- No collision found. Proposal: rename canonical_name to "C-section"; keep "c section history" as a hidden (isVisible=false) normalization alias.

### PED-000659 — "childbirth history"
- hit: "childbirth history" (canonicalName)
- treatment: **rename** -> "Childbirth"
- No collision found. Proposal: rename canonical_name to "Childbirth"; keep "childbirth history" as a hidden (isVisible=false) normalization alias.

### PED-000718 — "dialysis patient"
- hit: "dialysis patient" (canonicalName)
- treatment: **merge_into** -> "Dialysis"
- merge target: PED-000410 ("Dialysis")
- "Dialysis" already exists as PED-000410 ("Dialysis"). Proposal: fold this PED's aliases into that one (as hidden normalization aliases where they're action-phrase text), mark this PED merged_into_id, never leave two PEDs for the same concept.

### PED-000741 — "dka history"
- hit: "dka history" (canonicalName)
- treatment: **rename** -> "DKA"
- No collision found. Proposal: rename canonical_name to "DKA"; keep "dka history" as a hidden (isVisible=false) normalization alias.

### PED-000589 — "hysterectomy history"
- hit: "hysterectomy history" (canonicalName)
- treatment: **merge_into** -> "Hysterectomy"
- merge target: PED-000590 ("hysterectomy")
- "Hysterectomy" already exists as PED-000590 ("hysterectomy"). Proposal: fold this PED's aliases into that one (as hidden normalization aliases where they're action-phrase text), mark this PED merged_into_id, never leave two PEDs for the same concept.

### PED-000656 — "menopause status"
- hit: "menopause status" (canonicalName)
- treatment: **rename** -> "Menopause"
- No collision found. Proposal: rename canonical_name to "Menopause"; keep "menopause status" as a hidden (isVisible=false) normalization alias.

### PED-000753 — "mi history"
- hit: "mi history" (canonicalName)
- treatment: **merge_into** -> "MI"
- merge target: PED-000315 ("MI")
- "MI" already exists as PED-000315 ("MI"). Proposal: fold this PED's aliases into that one (as hidden normalization aliases where they're action-phrase text), mark this PED merged_into_id, never leave two PEDs for the same concept.

### PED-000714 — "nephrectomy history"
- hit: "nephrectomy history" (canonicalName)
- treatment: **merge_into** -> "Nephrectomy"
- merge target: PED-000715 ("nephrectomy")
- "Nephrectomy" already exists as PED-000715 ("nephrectomy"). Proposal: fold this PED's aliases into that one (as hidden normalization aliases where they're action-phrase text), mark this PED merged_into_id, never leave two PEDs for the same concept.

### PED-000650 — "nil medical history"
- hit: "nil medical history" (canonicalName)
- treatment: **merge_into** -> "no pre-existing disease"
- merge target: PED-000651 ("no pre-existing disease")
- Retired per governance decision (2026-07-28): "Nil medical history" is a declaration status, not a medical entity. Merged into PED-000651 ("no pre-existing disease") — the app's existing no-pre-existing-disease flow — as a hidden search-only phrase, not a canonical PED.

### PED-000716 — "renal transplant history"
- hit: "renal transplant history" (canonicalName)
- treatment: **rename** -> "Renal transplant"
- No collision found. Proposal: rename canonical_name to "Renal transplant"; keep "renal transplant history" as a hidden (isVisible=false) normalization alias.

### PED-000630 — "smoker status"
- hit: "smoker status" (canonicalName)
- treatment: **merge_into** -> "Smoker"
- merge target: PED-000150 ("smoker")
- "Smoker" already exists as PED-000150 ("smoker"). Proposal: fold this PED's aliases into that one (as hidden normalization aliases where they're action-phrase text), mark this PED merged_into_id, never leave two PEDs for the same concept.

### PED-000662 — "vaccination done"
- hit: "vaccination done" (canonicalName)
- treatment: **rename** -> "Vaccination"
- No collision found. Proposal: rename canonical_name to "Vaccination"; keep "vaccination done" as a hidden (isVisible=false) normalization alias.

## Misspelling cleanup (rule 2)

19 items — {"rename":1,"merge_into":6,"hide_alias_only":12}

### PED-000109 — "Gullian Barre syndrome"
- hit: "Gullian Barre syndrome" (canonicalName)
- treatment: **rename** -> "Guillain-Barre syndrome"
- No collision found. Proposal: rename canonical_name to "Guillain-Barre syndrome"; keep "Gullian Barre syndrome" as a hidden (isVisible=false) normalization alias.

### PED-000139 — "Headcahe"
- hit: "Headcahe" (canonicalName)
- treatment: **merge_into** -> "Headache"
- merge target: PED-000577 ("Headache")
- Correctly-spelled "Headache" already exists as PED-000577. Proposal: fold this PED's aliases into that one as hidden normalization aliases, mark this PED merged_into_id.

### PED-000112 — "Hemmoroids"
- hit: "Hemmoroids" (canonicalName)
- treatment: **merge_into** -> "Hemorrhoids"
- merge target: PED-000049 ("Haemorrhoids")
- Correctly-spelled "Hemorrhoids" already exists as PED-000049. Proposal: fold this PED's aliases into that one as hidden normalization aliases, mark this PED merged_into_id.

### PED-000124 — "Pilodinal sinus"
- hit: "Pilodinal sinus" (canonicalName)
- treatment: **merge_into** -> "Pilonidal sinus"
- merge target: PED-000518 ("Pilonidal sinus")
- Correctly-spelled "Pilonidal sinus" already exists as PED-000518. Proposal: fold this PED's aliases into that one as hidden normalization aliases, mark this PED merged_into_id.

### PED-000131 — "Thalaseemia"
- hit: "Thalaseemia" (canonicalName)
- treatment: **merge_into** -> "Thalassemia"
- merge target: PED-000488 ("Thalassemia")
- Correctly-spelled "Thalassemia" already exists as PED-000488. Proposal: fold this PED's aliases into that one as hidden normalization aliases, mark this PED merged_into_id.

### PED-000129 — "Tymnoplasty"
- hit: "Tymnoplasty" (canonicalName)
- treatment: **merge_into** -> "Tympanoplasty"
- merge target: PED-000130 ("tympanoplasty")
- Correctly-spelled "Tympanoplasty" already exists as PED-000130. Proposal: fold this PED's aliases into that one as hidden normalization aliases, mark this PED merged_into_id.

### PED-000118 — "Weils disease"
- hit: "Weils disease" (canonicalName)
- treatment: **merge_into** -> "Leptospirosis"
- merge target: PED-001033 ("Leptospirosis")
- "Leptospirosis" already exists as PED-001033. Merging per governance decision (2026-07-28): "Weils disease" hidden, "Weil's disease" added as a visible clinical synonym on PED-001033.

### PED-000006 — "Absence seizure"
- hit: "Abscence seizure" (alias)
- treatment: **hide_alias_only**
- Already an alias of the correctly-named PED-000006 ("Absence seizure") — no rename needed, just set isVisible=false so it stops appearing in dropdowns/search suggestions while still matching search.

### PED-000016 — "Appendicitis"
- hit: "Apendicitis" (alias)
- treatment: **hide_alias_only**
- Already an alias of the correctly-named PED-000016 ("Appendicitis") — no rename needed, just set isVisible=false so it stops appearing in dropdowns/search suggestions while still matching search.

### PED-000041 — "Food poisoning"
- hit: "Foos poisoning" (alias)
- treatment: **hide_alias_only**
- Already an alias of the correctly-named PED-000041 ("Food poisoning") — no rename needed, just set isVisible=false so it stops appearing in dropdowns/search suggestions while still matching search.

### PED-000044 — "Gynecomastia"
- hit: "Gynocomastia" (alias)
- treatment: **hide_alias_only**
- Already an alias of the correctly-named PED-000044 ("Gynecomastia") — no rename needed, just set isVisible=false so it stops appearing in dropdowns/search suggestions while still matching search.

### PED-000044 — "Gynecomastia"
- hit: "Gyneacomastia" (alias)
- treatment: **hide_alias_only**
- Already an alias of the correctly-named PED-000044 ("Gynecomastia") — no rename needed, just set isVisible=false so it stops appearing in dropdowns/search suggestions while still matching search.

### PED-000051 — "High cholesterol"
- hit: "Cholestrerol" (alias)
- treatment: **hide_alias_only**
- Already an alias of the correctly-named PED-000051 ("High cholesterol") — no rename needed, just set isVisible=false so it stops appearing in dropdowns/search suggestions while still matching search.

### PED-000051 — "High cholesterol"
- hit: "Hyperlipidimia" (alias)
- treatment: **hide_alias_only**
- Already an alias of the correctly-named PED-000051 ("High cholesterol") — no rename needed, just set isVisible=false so it stops appearing in dropdowns/search suggestions while still matching search.

### PED-000051 — "High cholesterol"
- hit: "Hyperlipidmia" (alias)
- treatment: **hide_alias_only**
- Already an alias of the correctly-named PED-000051 ("High cholesterol") — no rename needed, just set isVisible=false so it stops appearing in dropdowns/search suggestions while still matching search.

### PED-000051 — "High cholesterol"
- hit: "Dyslipidimia" (alias)
- treatment: **hide_alias_only**
- Already an alias of the correctly-named PED-000051 ("High cholesterol") — no rename needed, just set isVisible=false so it stops appearing in dropdowns/search suggestions while still matching search.

### PED-000051 — "High cholesterol"
- hit: "Dyslipidmia" (alias)
- treatment: **hide_alias_only**
- Already an alias of the correctly-named PED-000051 ("High cholesterol") — no rename needed, just set isVisible=false so it stops appearing in dropdowns/search suggestions while still matching search.

### PED-000062 — "Infertility"
- hit: "Infertillity" (alias)
- treatment: **hide_alias_only**
- Already an alias of the correctly-named PED-000062 ("Infertility") — no rename needed, just set isVisible=false so it stops appearing in dropdowns/search suggestions while still matching search.

### PED-000092 — "Tonsillitis"
- hit: "Tonsilitis" (alias)
- treatment: **hide_alias_only**
- Already an alias of the correctly-named PED-000092 ("Tonsillitis") — no rename needed, just set isVisible=false so it stops appearing in dropdowns/search suggestions while still matching search.
