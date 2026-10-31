/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * PRODUCT PLAYBOOK MIRROR — structure: extract, propose, check (Phase 1, Step 4).
 *
 *  - extractMainTab(): reads the plan headers (row 1, from column D) and the
 *    category/sub-category rows (columns B/C, following merged cells) of the
 *    main tab EXACTLY as written. No trimming or interpretation.
 *  - proposeStructure(): suggests stable keys and PROVISIONAL statuses for a
 *    person to accept. A suggestion never becomes the approved structure on
 *    its own; nothing here is shown to advisors (show_to_advisors stays false
 *    until a named person confirms a status, enforced by the database).
 *  - checkStructure(): compares a snapshot with the ACCEPTED structure and
 *    fails closed on any difference (missing/renamed/new plan header,
 *    changed category labels or order, changed tab-2 layout). Hidden-flag
 *    changes pass but are marked "needs review".
 *
 * Plan columns are found by their exact header text, never by column letter.
 */

import { numToColumn } from "./a1.js";
import { hiddenOf } from "./visibility.js";

export interface StructCell {
  sheetGid: number;
  rowNum: number;
  colNum: number;
  a1: string;
  valueKind: string;
  rawText: string | null;
  numberRaw: string | null;
  coveredBy: string | null;
  mergeRange: string | null;
}

export interface StructTab {
  sheetGid: number;
  title: string;
  hiddenRows: number[];
  hiddenCols: number[];
  rowsHiddenByFilter?: number[];
}

export interface PlanHeader {
  col: string;
  colNum: number;
  header: string;
  hidden: boolean;
}

export interface FeatureEntry {
  /** Sheet rows this entry spans (more than one when its labels are merged, e.g. Add-ons 44–45). */
  rows: number[];
  label: string;
  subLabel: string | null;
  labelAnchor: string;
  subAnchor: string | null;
}

export interface MainTabStructure {
  plans: PlanHeader[];
  features: FeatureEntry[];
}

const MAIN_TAB_GID = 0;
const FIRST_PLAN_COL = 4; // D

function index(cells: StructCell[], gid: number) {
  const byA1 = new Map<string, StructCell>();
  for (const c of cells) if (c.sheetGid === gid) byA1.set(c.a1, c);
  const text = (a1: string): string | null => {
    const c = byA1.get(a1);
    if (!c) return null;
    if (c.rawText !== null) return c.rawText;
    if (c.numberRaw !== null) return c.numberRaw;
    return null;
  };
  /** Follows a merge to its anchor; returns [anchor A1, exact text]. */
  const resolved = (a1: string): [string, string | null] => {
    const anchor = byA1.get(a1)?.coveredBy ?? a1;
    return [anchor, text(anchor)];
  };
  return { byA1, text, resolved };
}

export function extractMainTab(tab: StructTab, cells: StructCell[]): MainTabStructure {
  const { byA1, text, resolved } = index(cells, tab.sheetGid);
  const maxCol = Math.max(0, ...[...byA1.values()].filter((c) => c.rowNum === 1).map((c) => c.colNum));
  const plans: PlanHeader[] = [];
  for (let c = FIRST_PLAN_COL; c <= maxCol; c++) {
    const header = text(`${numToColumn(c)}1`);
    if (header === null || header === "") continue;
    plans.push({ col: numToColumn(c), colNum: c, header, hidden: tab.hiddenCols.includes(c) });
  }

  const maxRow = Math.max(0, ...[...byA1.values()].filter((c) => c.colNum === 2 || c.colNum === 3).map((c) => c.rowNum));
  const features: FeatureEntry[] = [];
  for (let r = 2; r <= maxRow; r++) {
    const [labelAnchor, label] = resolved(`B${r}`);
    if (label === null || label === "") continue;
    const [subAnchorRaw, sub] = resolved(`C${r}`);
    const cCell = byA1.get(`C${r}`);
    const inMerge = !!(cCell?.coveredBy || cCell?.mergeRange);
    // An empty sub-category cell only has an identity when it is part of a merge (e.g. C44:C45 for Add-ons).
    const subAnchor = sub !== null && sub !== "" ? subAnchorRaw : inMerge ? subAnchorRaw : null;
    const last = features[features.length - 1];
    if (last && last.labelAnchor === labelAnchor && last.subAnchor !== null && last.subAnchor === subAnchor) {
      last.rows.push(r); // same merged label AND same merged sub-label: one entry spanning rows
      continue;
    }
    features.push({ rows: [r], label, subLabel: sub === "" ? null : sub, labelAnchor, subAnchor });
  }
  return { plans, features };
}

// ───────────────────────── proposal (for a person to accept) ─────────────────────────

export interface ProposedPlan {
  planKey: string;
  insurer: string;
  displayName: string;
  expectedHeader: string;
  status: "active" | "discontinued_fresh_porting" | "brochure_only" | "hidden";
  sortOrder: number;
  /** Why this status was suggested — for the reviewer, never used to decide anything. */
  statusReason: string;
  column: string;
  keyFromMap: boolean;
}

export interface ProposedFeature {
  featureKey: string;
  subKey: string;
  expectedLabel: string;
  expectedSubLabel: string | null;
  sortOrder: number;
  rows: number[];
  keyFromMap: boolean;
}

/** Keys proposed in docs/PRODUCT_PLAYBOOK_PHASE1_DESIGN.md §5, keyed by EXACT header text. */
const PLAN_KEYS: Record<string, string> = {
  "HDFC Ergo Optima Secure": "hdfc_optima_secure",
  "HDFC Ergo Optima Super Secure": "hdfc_optima_super_secure",
  "HDFC Ergo Optima Secure+": "hdfc_optima_secure_plus",
  "HDFC Ergo Optima Restore \n(Discontinued for Fresh & Porting applications)": "hdfc_optima_restore",
  "HDFC Ergo Energy Silver": "hdfc_energy_silver",
  "HDFC Ergo Arogya Sanjeevani": "hdfc_arogya_sanjeevani",
  "Care Supreme": "care_supreme",
  "Ultimate Care": "care_ultimate_care",
  "Care Supreme Freedom": "care_supreme_freedom",
  "Care Supreme Heart": "care_supreme_heart",
  "Care Freedom": "care_freedom",
  " Care Heart": "care_heart",
  "Care Care\n(Discontinued for Fresh & Porting applications)": "care_care",
  "Care Advantage\n(Discontinued for Fresh & Porting applications)": "care_advantage",
  "Care Supreme Shine\n(Brochure)": "care_supreme_shine",
  "Care Senior Health Advantage": "care_senior_health_advantage",
  "Aditya Birla Activ Fit Plus/Preferred": "abhi_activ_fit_plus_preferred",
  "Aditya Birla Activ Yuva": "abhi_activ_yuva",
  "Aditya Birla Activ One Max": "abhi_activ_one_max",
  "Aditya Birla Activ One VYTL": "abhi_activ_one_vytl",
  "Aditya Birla Activ One NXT": "abhi_activ_one_nxt",
  "Niva Bupa ReAssure 2.0": "niva_reassure_2_0",
  "Niva Bupa ReAssure 3.0\n(Black Variant available with Ditto)": "niva_reassure_3_0",
  "Niva Bupa Aspire": "niva_aspire",
  "Niva Bupa Health Premia": "niva_health_premia",
  "HDFC Ergo Medisure": "hdfc_medisure",
  "Care Supreme Enhance": "care_supreme_enhance",
  "Niva Bupa Recharge": "niva_recharge",
  "Care Enhance ": "care_enhance",
};

const FEATURE_KEYS: Record<string, string> = {
  "Entry Age for Adults": "entry_age_adults",
  "Entry Age for Children": "entry_age_children",
  "FF Structure": "ff_structure",
  Variants: "variants",
  "Waiting periods": "waiting_periods",
  Loadings: "loadings",
  "Co- payment ": "co_payment",
  "Disease wise sub-limits": "disease_sublimits",
  "Room rent restrictions": "room_rent",
  "Pre and post hospitalization": "pre_post_hospitalisation",
  Domiciliary: "domiciliary",
  "Day Care": "day_care",
  AYUSH: "ayush",
  "Modern treatments": "modern_treatments",
  Restoration: "restoration",
  Consumables: "consumables",
  Bonus: "bonus",
  "Annual health Check-up": "annual_health_checkup",
  OPD: "opd",
  Maternity: "maternity",
  Ambulance: "ambulance",
  "Organ Donor": "organ_donor",
  "Special features": "special_features",
  "Add-ons": "add_ons",
  Cover: "cover",
  Premiums: "premiums",
  "Fitness & Wellness Benefits": "fitness_wellness",
  Porting: "porting",
  Migration: "migration",
};

const SUB_KEYS: Record<string, string> = {
  Min: "min",
  Max: "max",
  "Exit age": "exit_age",
  "Yes/No": "yes_no",
  "Limits if there are any": "limits",
  "% of SI": "pct_of_si",
  Exhaustion: "exhaustion",
  Illness: "illness",
  Frequency: "frequency",
  NCB: "ncb",
  Loyalty: "loyalty",
  "In- built / Add-on": "builtin_or_addon",
  "Can be used from ": "usable_from",
  "Cashless / Reimbursement": "cashless_or_reimbursement",
  Limits: "limits",
  Coverage: "coverage",
  Road: "road",
  Air: "air",
  "Zonal Premium": "zonal",
  "Age bands": "age_bands",
  "Other details": "other_details",
  "Benefit Overview": "benefit_overview",
  "Eligibility & Earning": "eligibility_earning",
  "Rewards & Calculation": "rewards_calculation",
  "Utilisation & Conditions": "utilisation_conditions",
};

const INSURER_PREFIXES: [string, string][] = [
  ["HDFC Ergo", "HDFC Ergo"],
  ["Aditya Birla", "Aditya Birla"],
  ["Niva Bupa", "Niva Bupa"],
  ["Care", "Care"],
  [" Care", "Care"],
  ["Ultimate Care", "Care"],
];

export const slug = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "unnamed";

/** Normalises line breaks for MATCHING the proposal map only (the stored text is never changed). */
const lineKey = (s: string) => s.replace(/\r\n|\r/g, "\n");

export function proposeStructure(main: MainTabStructure): { plans: ProposedPlan[]; features: ProposedFeature[] } {
  const plans = main.plans.map((p, i): ProposedPlan => {
    const mapped = PLAN_KEYS[lineKey(p.header)];
    const firstLine = lineKey(p.header).split("\n")[0].trim();
    const insurer = INSURER_PREFIXES.find(([prefix]) => p.header.startsWith(prefix))?.[1] ?? "Unknown — set by reviewer";
    let status: ProposedPlan["status"] = "active";
    let statusReason = "No status note in the header (proposal only)";
    if (p.hidden) {
      status = "hidden";
      statusReason = "Column is hidden in the sheet (proposal only; visibility is never inferred)";
    } else if (/Discontinued for Fresh & Porting/i.test(p.header)) {
      status = "discontinued_fresh_porting";
      statusReason = "Header text says discontinued for fresh & porting (proposal only)";
    } else if (/\(Brochure\)/i.test(p.header)) {
      status = "brochure_only";
      statusReason = "Header text says (Brochure) (proposal only)";
    }
    return {
      planKey: mapped ?? `new_${slug(firstLine)}`,
      insurer,
      displayName: firstLine,
      expectedHeader: p.header,
      status,
      sortOrder: i,
      statusReason,
      column: p.col,
      keyFromMap: !!mapped,
    };
  });

  const features = main.features.map((f, i): ProposedFeature => {
    const firstLine = lineKey(f.label).split("\n")[0];
    const mapped = FEATURE_KEYS[f.label] ?? (firstLine === "Other Points" ? "other_points" : undefined);
    const subMapped = f.subLabel === null ? "" : SUB_KEYS[f.subLabel];
    return {
      featureKey: mapped ?? `new_${slug(firstLine)}`,
      subKey: subMapped ?? slug(f.subLabel ?? ""),
      expectedLabel: f.label,
      expectedSubLabel: f.subLabel,
      sortOrder: i,
      rows: f.rows,
      keyFromMap: !!mapped && subMapped !== undefined,
    };
  });
  return { plans, features };
}

// ───────────────────────── check against the ACCEPTED structure ─────────────────────────

export interface AcceptedPlan {
  planKey: string;
  expectedHeader: string;
}
export interface AcceptedFeature {
  featureKey: string;
  subKey: string;
  expectedLabel: string;
  expectedSubLabel: string | null;
  sortOrder: number;
}

/** Tab 2 ("Recommendation specifics") layout, exactly as in the live sheet on 2026-10-29. */
export const TAB2_EXPECTED_HEADERS: Record<string, string> = {
  A1: "SNo.",
  B1: "Specific Use cases",
  D1: "Recommendation",
  G1: "Customer wants more options",
};

export interface StructureReport {
  ok: boolean;
  state: "passed" | "failed" | "no_accepted_structure";
  checkedAt: string;
  problems: string[];
  needsReview: string[];
  planColumns: Record<string, string>;
  featureRows: Record<string, number[]>;
  hidden: { mainCols: string[]; tab2Rows: number[] };
}

export function checkStructure(input: {
  mainTab: StructTab;
  tab2: StructTab | undefined;
  cells: StructCell[];
  accepted: { plans: AcceptedPlan[]; features: AcceptedFeature[] };
  previousHidden?: { mainCols: string[]; tab2Rows: number[] };
  now?: Date;
}): StructureReport {
  const main = extractMainTab(input.mainTab, input.cells);
  // Messages are shown on the admin screen: never quote text from hidden rows/columns (decision 2026-10-30).
  const mainHidden = hiddenOf(input.mainTab);
  const rowHidden = (rows: number[]) => rows.some((r) => mainHidden.rows.has(r));
  const problems: string[] = [];
  const needsReview: string[] = [];
  const planColumns: Record<string, string> = {};
  const featureRows: Record<string, number[]> = {};
  const hidden = {
    mainCols: input.mainTab.hiddenCols.map(numToColumn),
    tab2Rows: input.tab2?.hiddenRows ?? [],
  };
  const base = { checkedAt: (input.now ?? new Date()).toISOString(), planColumns, featureRows, hidden };

  if (input.accepted.plans.length === 0 || input.accepted.features.length === 0) {
    return { ok: false, state: "no_accepted_structure", problems: ["No accepted structure yet — a person must accept the proposed plan and feature lists first."], needsReview, ...base };
  }

  // Plans: every accepted header exactly once; no unknown headers.
  const accepted = new Set(input.accepted.plans.map((p) => p.expectedHeader));
  for (const p of input.accepted.plans) {
    const found = main.plans.filter((h) => h.header === p.expectedHeader);
    if (found.length === 0) problems.push(`Plan "${p.planKey}": its accepted header was not found in row 1 (renamed or removed?).`);
    else if (found.length > 1) problems.push(`Plan "${p.planKey}": header appears ${found.length} times (${found.map((f) => f.col).join(", ")}).`);
    else planColumns[p.planKey] = found[0].col;
  }
  for (const h of main.plans) {
    if (!accepted.has(h.header)) problems.push(`New plan column ${h.col}: ${h.hidden ? "(column hidden in the sheet; header not shown)" : JSON.stringify(h.header)} is not in the accepted plan list.`);
  }

  // Features: same labels, same order (rows may move).
  const expected = [...input.accepted.features].sort((a, b) => a.sortOrder - b.sortOrder);
  if (expected.length !== main.features.length) {
    problems.push(`Category rows: expected ${expected.length} entries, found ${main.features.length}.`);
  }
  expected.forEach((f, i) => {
    const got = main.features[i];
    const key = `${f.featureKey}${f.subKey ? "." + f.subKey : ""}`;
    if (!got) return;
    if (got.label !== f.expectedLabel || (got.subLabel ?? null) !== (f.expectedSubLabel ?? null)) {
      problems.push(
        rowHidden(got.rows)
          ? `Category entry ${i + 1} (${key}): labels differ at row ${got.rows.join("–")} (row hidden in the sheet; text not shown).`
          : `Category entry ${i + 1} (${key}): expected ${JSON.stringify([f.expectedLabel, f.expectedSubLabel])}, found ${JSON.stringify([got.label, got.subLabel])} at row ${got.rows.join("–")}.`
      );
    } else {
      featureRows[key] = got.rows;
    }
  });

  // Tab 2 layout.
  if (!input.tab2) {
    problems.push("Tab 2 (Recommendation specifics) is missing.");
  } else {
    const t2 = index(input.cells, input.tab2.sheetGid);
    for (const [a1, text] of Object.entries(TAB2_EXPECTED_HEADERS)) {
      if (t2.text(a1) !== text) problems.push(`Tab 2 ${a1}: expected ${JSON.stringify(text)}, found ${hiddenOf(input.tab2).isHiddenA1(a1) ? "(hidden in the sheet; not shown)" : JSON.stringify(t2.text(a1))}.`);
    }
    for (let r = 3; ; r += 2) {
      const policy = t2.text(`C${r}`);
      if (policy === null) break;
      if (policy !== "Policy" || t2.text(`C${r + 1}`) !== "Add-ons") {
        problems.push(`Tab 2 rows ${r}–${r + 1}: expected the pair "Policy"/"Add-ons" in column C, found ${hiddenOf(input.tab2).rows.has(r) || hiddenOf(input.tab2).rows.has(r + 1) ? "(rows hidden in the sheet; text not shown)" : JSON.stringify([policy, t2.text(`C${r + 1}`)])}.`);
        break;
      }
    }
  }

  // Hidden flags: allowed to change, but never silently.
  if (input.previousHidden) {
    if (JSON.stringify(input.previousHidden.mainCols) !== JSON.stringify(hidden.mainCols)) needsReview.push(`Hidden columns on the main tab changed: ${input.previousHidden.mainCols.join(",") || "none"} → ${hidden.mainCols.join(",") || "none"}.`);
    if (JSON.stringify(input.previousHidden.tab2Rows) !== JSON.stringify(hidden.tab2Rows)) needsReview.push(`Hidden rows on tab 2 changed: ${input.previousHidden.tab2Rows.join(",") || "none"} → ${hidden.tab2Rows.join(",") || "none"}.`);
  }

  const ok = problems.length === 0;
  return { ok, state: ok ? "passed" : "failed", problems, needsReview, ...base };
}

export const MAIN_TAB_SHEET_GID = MAIN_TAB_GID;
