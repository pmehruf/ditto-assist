/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Baseline PED list for the Smoke Test page — 100 pre-existing diseases an
 * advisor is most likely to actually encounter day to day, spanning every
 * major TOP_PED_DICTIONARY/engine.ts category (diabetes, cardiac,
 * respiratory, endocrine, eye, kidney, digestive, autoimmune,
 * neuro/psychiatric, reproductive, musculoskeletal, blood, HIV/liver,
 * oncology, infectious, skin, and several of the named surgical procedures
 * that route to a specific category — e.g. Appendectomy/Hysterectomy/
 * Tonsillectomy/Cholecystectomy/Nephrectomy/Thyroidectomy/Tympanoplasty/
 * Cataract Surgery/Knee & Hip Replacement — rather than a generic fallback).
 * Also includes Covid-19 and Sarcoidosis, which surfaced as real
 * plan-categoryMap gaps during this app's own mapping audit (see
 * engine.ts/types.ts) — kept here as a standing regression check of that
 * fix.
 *
 * Deliberately a FIXED, hardcoded list (not admin-editable) — it's meant to
 * be a stable regression baseline, the same role getSmokeTestCases() plays
 * for the automated test suite (src/__tests__/engine.baseline.test.ts), but
 * curated down to realistic, common terms rather than that function's much
 * larger corpus of synthetic/typo/edge-case entries meant for automated
 * regression coverage, not a human-readable spot-check page. The full list
 * is also shown directly on the Smoke Test page (a collapsible "Baseline
 * PEDs" panel) so an Admin/Developer can see at a glance whether a PED they care
 * about is already covered here before deciding to add it as a custom
 * entry. Admins/Developers extend the baseline via the "smoke_test_peds" DB
 * table (see smokeTestPedsRepository.ts) instead of editing this file, so
 * custom additions survive independently of code deploys.
 */
export const COMMON_SMOKE_TEST_PEDS: string[] = [
  "Diabetes",
  "Hypertension",
  "Thyroid Disorder",
  "Hypothyroidism",
  "Hyperthyroidism",
  "High Cholesterol",
  "Asthma",
  "COPD",
  "Tuberculosis",
  "Coronary Artery Disease",
  "Heart Attack",
  "Cataract",
  "Glaucoma",
  "Kidney Stones",
  "Chronic Kidney Disease",
  "Dialysis",
  "Gallstones",
  "Fatty Liver",
  "Hepatitis B",
  "Hepatitis C",
  "Cirrhosis",
  "Pancreatitis",
  "Migraine",
  "Epilepsy",
  "Stroke",
  "Paralysis",
  "Parkinson's Disease",
  "Alzheimer's Disease",
  "Anxiety",
  "Depression",
  "PCOS",
  "Endometriosis",
  "Fibroid (Uterine)",
  "Hernia",
  "Piles (Hemorrhoids)",
  "Fissure",
  "Appendicitis",
  "Appendectomy",
  "GERD",
  "Peptic Ulcer",
  "Ulcerative Colitis",
  "Crohn's Disease",
  "Rheumatoid Arthritis",
  "Osteoarthritis",
  "Psoriasis",
  "Vitiligo",
  "Eczema",
  "Anaemia",
  "Thalassemia",
  "HIV",
  "Cancer",
  "Tumour",
  "Hysterectomy",
  "Tonsillectomy",
  "Cholecystectomy",
  "Knee Replacement",
  "Hip Replacement",
  "Varicose Veins",
  "Deep Vein Thrombosis",
  "Prostate Enlargement (BPH)",
  "Obstructive Sleep Apnea",
  "Covid-19",
  "Sarcoidosis",
  "Nephrectomy",
  "Thyroidectomy",
  "Tympanoplasty",
  "Cataract Surgery",
  "Total Knee Replacement",
  "Total Hip Replacement",
  "Angioplasty",
  "Cardiac Bypass Surgery (CABG)",
  "Pacemaker Implantation",
  "Arrhythmia",
  "Atrial Fibrillation",
  "Multiple Sclerosis",
  "Bipolar Disorder",
  "Schizophrenia",
  "Lupus (SLE)",
  "Ankylosing Spondylitis",
  "Gout",
  "Osteoporosis",
  "Slip Disc / Herniated Disc",
  "Sciatica",
  "Frozen Shoulder",
  "Spinal Fusion Surgery",
  "Retinal Detachment",
  "Diabetic Retinopathy",
  "Macular Degeneration",
  "Sinusitis",
  "Deviated Nasal Septum",
  "Hearing Loss",
  "Kidney Transplant",
  "Polycystic Kidney Disease",
  "Irritable Bowel Syndrome (IBS)",
  "Celiac Disease",
  "Diverticulitis",
  "Hiatal Hernia",
  "Ovarian Cyst",
  "Infertility",
  "Breast Cancer",
];
