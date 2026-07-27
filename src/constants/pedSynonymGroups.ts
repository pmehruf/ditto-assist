/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Display-only synonym groupings for the Lookup page's PED autocomplete
 * dropdown. Each inner array is a set of ped_directory terms that name the
 * same underlying medical entity — the dropdown shows these as one merged
 * "A Or B Or C" row instead of one row per synonym, so a search for any
 * alias returns exactly one visible result (1 medical entity = 1 result).
 *
 * These groups were produced by an exhaustive normalization pass over the
 * entire live PED directory (~1,243 unique terms). A term is only grouped
 * when it reduces to the SAME entity under safe transforms — spelling
 * variants (ae/oe/our), possessives, singular/plural, full-form vs
 * abbreviation/acronym, a diagnosis with its own procedure name, and a
 * curated set of unambiguous layman↔medical synonyms. Any candidate whose
 * members differ by a distinguishing token (type 1/2, left/right,
 * acute/chronic, benign/malignant, an organ/site name, hepatitis A/B/C,
 * etc.) is deliberately kept SEPARATE, as are genuinely ambiguous acronyms
 * (ASD, GBS, MI, MS, RA, VF, VT). When uncertain, terms are left ungrouped.
 *
 * Deliberately NOT stored in the database and NOT used anywhere in the
 * matching engine (engine.ts) — this is purely a presentation grouping for
 * dynamicSuggestions in App.tsx / LookupPage.tsx. It changes only what the
 * dropdown displays and which single term is inserted on click; it never
 * changes any declaration mapping, routing, or category. ped_directory
 * itself keeps one row per synonym (each independently searchable and
 * exact-match-able against TOP_PED_DICTIONARY), which is why entries here
 * are matched case-insensitively against whatever's actually in the live
 * suggestion list rather than assumed to always be present — a member that
 * isn't in the current directory is simply omitted from the joined label.
 *
 * Order within each group is the display order used when building the
 * joined "A Or B Or C" label — the most recognizable full name is placed
 * first, with acronyms last.
 */
export const PED_SYNONYM_GROUPS: string[][] = [
  ["Absence seizure", "Absence seizures"],
  ["Acid peptic disease", "APD"],
  ["Acute kidney injury", "AKI"],
  ["Acute lymphocytic leukemia", "ALL"],
  ["Acute myeloid leukemia", "AML"],
  ["Addison disease", "Addison's disease"],
  ["Adenoid", "Adenoids"],
  ["Allergic", "Allergic condition"],
  ["Alzheimer's disease", "Alzheimer disease", "Alzheimer's"],
  ["Angioplasty", "Percutaneous Transluminal Coronary Angioplasty", "PTCA"],
  ["Anterior Cruciate Ligament", "Anterior Cruciate Ligament Tear", "ACL Reconstruction", "ACL"],
  ["Aplastic anaemia", "Aplastic anemia"],
  ["Appendicitis", "Appendix surgery", "Appendicitis surgery", "Appendectomy"],
  ["Asthma", "Bronchial asthma"],
  ["Autoimmune disease", "Autoimmune disorder"],
  ["Benign prostatic hyperplasia", "BPH surgery", "Prostatomegaly", "Prostataomegaly", "BPH"],
  ["Bipolar disorder", "Bipolar"],
  ["Breast lump", "Breast lump evaluation"],
  ["Carpal tunnel", "Carpal tunnel syndrome"],
  ["Celiac disease", "Coeliac disease"],
  ["Celiac enteropathy", "Coeliac enteropathy"],
  ["Cerebrovascular Accident", "Stroke", "CVA"],
  ["Charcot Marie Tooth disease", "Charcot-marie-tooth disease"],
  ["Cholelithiasis", "Gallstones", "Gallbladder stone", "Gall bladder stone", "Cholelithiasis surgery"],
  ["Chronic fatigue", "Chronic fatigue syndrome"],
  ["Chronic kidney disease", "CKD"],
  ["Chronic lymphocytic leukemia", "CLL"],
  ["Chronic myeloid leukemia", "CML"],
  ["Chronic obstructive pulmonary disease", "COPD"],
  ["Colon polyp", "Colon polyp removal"],
  ["Congenital adrenal hyperplasia", "CAH"],
  ["Congestive heart failure", "CHF"],
  ["Coronary artery bypass", "CABG"],
  ["Coronary artery disease", "CAD"],
  ["Crohn's disease", "Crohn disease"],
  ["Cushing syndrome", "Cushing's syndrome"],
  ["Cystoscopy done", "Cystoscopy"],
  ["Deep vein thrombosis", "DVT"],
  ["Deviated nasal septum", "DNS"],
  ["Ductal carcinoma in situ", "DCIS"],
  ["End stage renal disease", "End-stage renal disease", "ESRD"],
  ["Epstein barr virus", "Epstein-barr virus"],
  ["Fracture", "Fractures"],
  ["Gas", "Gas problem"],
  ["Gastric polyp", "Gastric polyp removal"],
  ["Gastroesophageal Reflux Disease", "Acid reflux", "GERD"],
  ["Generalised anxiety disorder", "Generalized anxiety disorder", "GAD"],
  ["Gestational diabetes mellitus", "Gestational diabetes", "GDM"],
  ["Graves disease", "Graves' disease"],
  ["Haemangioma", "Hemangioma"],
  ["Haemochromatosis", "Hemochromatosis"],
  ["Haemophilia", "Hemophilia"],
  ["Haemorrhoids", "Hemorrhoids", "Piles"],
  ["Hashimoto's thyroiditis", "Hashimoto thyroiditis"],
  ["HbA1c high", "High HbA1c"],
  ["Herniated Disc", "Slipped disc", "Disc prolapse"],
  ["High cholesterol", "High cholesterol level", "Hypercholesterolemia", "Hypercholesterolemia state", "Hypercholesterolaemia", "Hyperlipidemia", "Hyperlipidaemia", "Dyslipidemia", "Dyslipidaemia", "High triglycerides", "Hypertriglyceridemia", "Hypertriglyceridemia state", "Hypertriglyceridaemia", "High LDL", "Elevated Cholesterol", "Hyperlipoproteinemia", "Dyslipidemia check"],
  ["Hirayama disease", "Hirayama"],
  ["Hodgkin's lymphoma", "Hodgkin lymphoma"],
  ["Hookworm infection", "Hookworm"],
  ["Hypertension", "High blood pressure", "High bp", "Systemic Hypertension"],
  ["Hypogonadism", "Hypogonadism state"],
  ["Hypoparathyroidism", "Hypoparathyroidism state"],
  ["Hypopituitarism", "Hypopituitarism state"],
  ["Impaired fasting glucose", "IFG"],
  ["Impaired glucose tolerance", "IGT"],
  ["In Vitro Fertilization", "IVF"],
  ["Inflammatory Bowel Disease", "IBD"],
  ["Insomnia disorder", "Insomnia"],
  ["Interstitial lung disease", "ILD"],
  ["Iron deficiency anaemia", "Iron deficiency anemia"],
  ["Irritable bowel syndrome", "IBS"],
  ["Ischaemic heart disease", "IHD"],
  ["Kidney stone removal", "Kidney stones", "Renal calculus", "Renal calculi", "Nephrolithiasis"],
  ["Left Bundle Branch Block", "LBBB"],
  ["Lobular carcinoma in situ", "LCIS"],
  ["Meniere's disease", "Meniere disease"],
  ["Mitral valve prolapse", "MVP"],
  ["Motor neuron disease", "MND"],
  ["Myocardial infarction", "Heart attack"],
  ["Nasal polyps", "Nasal polyp"],
  ["Non Hodgkin lymphoma", "Non-hodgkin's lymphoma", "NHL"],
  ["Non small cell lung cancer", "NSCLC"],
  ["Obstructive sleep apnea", "Obstructive sleep apnoea", "Sleep apnea", "OSA"],
  ["Parkinson disease", "Parkinson's disease"],
  ["PCOS", "PCOD"],
  ["Peptic ulcer disease", "Peptic ulcer"],
  ["Phaeochromocytoma", "Pheochromocytoma"],
  ["Polycythaemia vera", "Polycythemia vera"],
  ["Pregnancy induced hypertension", "PIH"],
  ["Raynaud's phenomenon", "Raynaud phenomenon"],
  ["Renal cell carcinoma", "RCC"],
  ["Rheumatic heart disease", "RHD"],
  ["Right Bundle Branch Block", "RBBB"],
  ["Seizure disorder", "Seizures", "Fits"],
  ["Sexually transmitted disease", "STD"],
  ["Shortness of breath", "SOB"],
  ["Sick sinus syndrome", "SSS"],
  ["Sickle cell anaemia", "Sickle cell anemia"],
  ["Sjogren's syndrome", "Sjogren syndrome"],
  ["Strabismus", "Squint", "Squint surgery"],
  ["Thalassaemia", "Thalassemia"],
  ["Thyroid disease", "Thyroid disorder", "Thyroid"],
  ["Total hip replacement", "THR"],
  ["Total knee replacement", "TKR"],
  ["Transient ischaemic attack", "Transient ischemic attack", "TIA"],
  ["Type 1 diabetes mellitus", "Diabetes type 1", "Type 1 DM", "Insulin dependent diabetes", "Juvenile Diabetes", "IDDM"],
  ["Type 2 diabetes mellitus", "Diabetes type 2", "Diabetes mellitus type 2", "Type 2 DM", "Diabetes", "High blood sugar", "High blood sugar state", "Hyperglycemia", "High Glucose Levels"],
  ["Urinary tract infection", "UTI"],
  ["Uterine fibroids", "Uterine fibroid"],
  ["Varicose vein", "Varicose veins"],
  ["Ventricular septal defect", "VSD"],
  ["Zika virus infection", "Zika virus"],
];

export interface GroupedSuggestionItem {
  /** Legacy single-line label — every present group member joined with
   * " Or " (or the bare term when ungrouped). Retained for backward
   * compatibility with any consumer that still reads a flat string; the
   * dropdown UI now prefers the structured `displayName` / `aliases`
   * fields below. */
  label: string;
  /** Line-1 canonical title for the row — the group's primary term, with an
   * acronym appended in parentheses when the group has one (e.g. "Anterior
   * Cruciate Ligament (ACL)"). For an ungrouped term this is just the term. */
  displayName: string;
  /** Line-2 secondary aliases — the remaining present group members, shown
   * muted and separated by "•". Empty when the row has no extra aliases (a
   * standalone term, or a group with only one member currently present), in
   * which case the UI hides the second line entirely. */
  aliases: string[];
  /** The literal term to insert into the lookup field when this row is
   * selected — always a single real ped_directory term, never the joined
   * label or displayName, so the exact-match dictionary lookup in engine.ts
   * is unaffected by this display-only grouping. Unchanged behaviour. */
  insertValue: string;
}

// Presentation helper: split a group's present members into a canonical
// line-1 title and the line-2 alias list. Purely cosmetic — it never
// affects search, grouping membership, or insertValue.
const ACRONYM_RE = /^[A-Z0-9]{2,6}$/;
function splitDisplay(membersPresent: string[]): { displayName: string; aliases: string[] } {
  if (membersPresent.length <= 1) {
    return { displayName: membersPresent[0], aliases: [] };
  }
  const canonical = membersPresent[0];
  const canonicalIsAcronym = ACRONYM_RE.test(canonical.replace(/\s+/g, ""));
  // If the group carries a short all-caps acronym that isn't already the
  // canonical term, surface it in parentheses on line 1 and drop it from
  // the alias line, e.g. "Anterior Cruciate Ligament (ACL)".
  const acronym = canonicalIsAcronym
    ? undefined
    : membersPresent.slice(1).find((m) => ACRONYM_RE.test(m.replace(/\s+/g, "")));
  const displayName = acronym ? `${canonical} (${acronym})` : canonical;
  const aliases = membersPresent.slice(1).filter((m) => m !== acronym);
  return { displayName, aliases };
}

let cachedGroupIndexByTermLower: Map<string, number> | null = null;
function groupIndexByTermLower(): Map<string, number> {
  if (!cachedGroupIndexByTermLower) {
    const map = new Map<string, number>();
    PED_SYNONYM_GROUPS.forEach((group, idx) => {
      group.forEach((term) => map.set(term.toLowerCase(), idx));
    });
    cachedGroupIndexByTermLower = map;
  }
  return cachedGroupIndexByTermLower;
}

/**
 * Filters `rawSuggestions` (the flat ped_directory-backed term list) down
 * to the items matching `query`, excludes anything already in `excluded`,
 * and collapses every matched synonym-group member into a single row —
 * satisfying "1 grouped PED = 1 dropdown result" without changing what
 * gets inserted on click/Enter. Sort/cap behavior (shortest label first,
 * then alphabetical, capped by the caller) is unchanged from the
 * pre-grouping implementation; this only changes what counts as "one
 * result".
 */
export function buildGroupedSuggestions(
  rawSuggestions: string[],
  query: string,
  excluded: string[]
): GroupedSuggestionItem[] {
  const lowerQuery = query.toLowerCase();
  const excludedSet = new Set(excluded);
  const groupIdxByTerm = groupIndexByTermLower();

  // Exact-cased lookup so a group's display label reflects the real
  // casing/wording currently in ped_directory, and so a synonym that
  // hasn't been added yet (e.g. a pending migration not yet run in this
  // environment) is simply omitted from the label instead of appearing as
  // a phantom entry.
  const exactCaseByTermLower = new Map<string, string>();
  rawSuggestions.forEach((s) => {
    if (!exactCaseByTermLower.has(s.toLowerCase())) exactCaseByTermLower.set(s.toLowerCase(), s);
  });

  const seenGroupIdx = new Set<number>();
  const results: GroupedSuggestionItem[] = [];

  for (const item of rawSuggestions) {
    if (excludedSet.has(item)) continue;
    if (!item.toLowerCase().includes(lowerQuery)) continue;

    const groupIdx = groupIdxByTerm.get(item.toLowerCase());
    if (groupIdx === undefined) {
      // No defined group — one row per term, same as before this feature.
      results.push({ label: item, displayName: item, aliases: [], insertValue: item });
      continue;
    }
    if (seenGroupIdx.has(groupIdx)) continue; // this group already emitted a row
    seenGroupIdx.add(groupIdx);

    const membersPresent = PED_SYNONYM_GROUPS[groupIdx]
      .map((term) => exactCaseByTermLower.get(term.toLowerCase()))
      .filter((s): s is string => Boolean(s));
    const label = membersPresent.length > 1 ? membersPresent.join(" Or ") : item;
    // Structured two-line display model derived from the same present
    // members — purely how the row is rendered; search, grouping, and the
    // inserted value are unchanged.
    const { displayName, aliases } = splitDisplay(membersPresent.length ? membersPresent : [item]);
    // Insert the specific synonym that actually matched the search text,
    // not the joined label — the field's value stays a real, exact-match
    // dictionary term either way.
    results.push({ label, displayName, aliases, insertValue: item });
  }

  return results;
}
