/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { TOP_PED_DICTIONARY } from "../../types";

/**
 * The shared smoke-test condition list used by the specific-illness engine baseline test (moved here unchanged from the
 * removed legacy engine; only the conditions are used, never the plan).
 */
export function getSmokeTestCases(selectedPlans?: string[]): { plan: string; ped: string }[] {
  const customPeds = [
    // 1. AMBIGUOUS SYMPTOMS & LIFESTYLE
    "chest pain", "body pain", "weakness", "fever", "heavy bleeding", "palpitations", "shortness of breath",
    "loss of appetite", "dizziness", "fatigue", "nausea", "vomiting", "chills", "malaise", "swelling",
    "smoking", "alcholic", "tobacco chewing", "drinking", "obesity", "headache",

    // 2. SPECIFIC TB VS GENERIC TB
    "spine tb", "bone tb", "skeletal tb", "pott's disease", "spinal tuberculosis",
    "brain tb", "meningeal tb", "tb meningitis", "neurological tb",
    "intestinal tb", "abdominal tb", "gastrointestinal tb",
    "renal tb", "kidney tb", "urinary tb", "genitourinary tb",
    "lymph node tb", "lymph gland tb", "tb lymphadenitis",
    "tuberculosis", "pulmonary tuberculosis", "lung tb",

    // 3. CYST/POLYP SHADOWING
    "ovarian cyst", "sebaceous cyst", "breast cyst", "kidney cyst", "liver cyst",
    "gastric polyp", "stomach polyp", "colon polyp", "rectal polyp", "vocal cord polyp",
    "nasal polyp", "endometrial polyp", "cervical polyp",

    // 4. BENIGN VS MALIGNANT
    "carcinoma", "melanoma", "sarcoma", "lymphoma", "leukemia", "leukaemia",
    "malignancy", "metastasis", "oncology", "adenocarcinoma", "squamous cell carcinoma",
    "lipoma", "adenoma", "papilloma", "fibroid", "fibroadenoma", "myoma", "fibromyoma",
    "hemangioma", "leiomyoma", "meningioma", "neuroma", "schwannoma",

    // 5. P0 EXACT MATCH & ABBREVIATION DICTIONARY
    "htn", "diabeties", "cabg", "pcos", "sugar", "bp high", "ptca", "lscs", "t2dm",
    "hyper cholesterol", "pre diabeties", "esrd", "ckd", "cva", "tia", "bph", "gerd",
    "tkr", "thr", "ms", "hba1c 6.5", "tmt positive", "h pylori", "dm",

    // 6. AUTOIMMUNE & SYSTEMIC
    "rheumatoid arthritis", "sle", "lupus", "scleroderma", "sjogren syndrome",
    "ankylosing spondylitis", "vasculitis", "psoriatic arthritis", "myasthenia gravis",
    "sarcoidosis", "raynaud's phenomenon", "pilonidal sinus", "varicose veins",

    // 7. NATURAL LIFE STAGES & PROCEDURES
    "c-section", "routine master health checkup", "pregnant", "lactating mother",
    "post-menopausal", "n/a", "nil", "healthy", "vaccination", "immunization",
    "dog bite", "cat scratch", "food allergy", "gynecomastia", "appendectomy",
    "cholecystectomy", "hysterectomy", "tonsillectomy", "tympanoplasty",
    "stitches on forehead", "laceration on leg", "burns", "cast on arm", "splint",

    // 8. NEUROLOGICAL & PSYCHIATRIC
    "alzheimer", "dementia", "parkinson", "epilepsy", "fits", "seizures", "migraine",
    "depression", "anxiety", "ocd", "adhd", "autism", "bipolar disorder",
    "schizophrenia", "ptsd", "panic attack", "bulimia", "anorexia", "insomnia",
    "obstructive sleep apnea", "head injury", "brain haemorrhage", "cerebral palsy",

    // 9. RARE & COMPLEX
    "guillain barre syndrome", "huntington's", "avascular necrosis", "crohn's disease",
    "ulcerative colitis", "puj obstruction", "thalassemia", "hemochromatosis",
    "sickle cell anemia", "von willebrand disease", "bone marrow failure",
    "hirayama disease", "trigeminal neuralgia", "carpal tunnel", "plantar fasciitis",

    // 10. TYPO & OCR ADVERSARIAL
    "hipertension", "hypetension", "diabtes", "dialisis", "cholecystitis",
    "apendicitis", "gullian barre", "hemorrhoids", "fistula", "fissure",
    "psorasis", "eczem", "vitiligo", "alopeci", "thyriod", "hypothyrodism",
    "endometriosis", "infertillity", "prostatitis", "varicocele", "hydrocele"
  ];

  // Merge with TOP_PED_DICTIONARY keys dynamically and deduplicate
  const dictKeys = Object.keys(TOP_PED_DICTIONARY || {});
  const deduplicatedPeds = Array.from(new Set([
    ...customPeds.map(p => p.toLowerCase().trim()),
    ...dictKeys.map(k => k.toLowerCase().trim())
  ])).filter(Boolean);

  const plans = selectedPlans && selectedPlans.length > 0 
    ? selectedPlans 
    : ["Optima Secure", "Care Supreme", "Activ One Max", "Activ Fit Preferred"];
  const cases: { plan: string; ped: string }[] = [];

  plans.forEach(plan => {
    deduplicatedPeds.forEach(ped => {
      cases.push({ plan, ped });
    });
  });

  return cases;
}

