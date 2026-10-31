/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * PRODUCT PLAYBOOK MIRROR — read API logic (Phase 1, Step 6).
 *
 * This is the data path future advisor screens will use. Its safety rules
 * are enforced HERE, in one place, not left to the screen:
 *   - only the PUBLISHED snapshot is ever read (never a verified/unpublished one);
 *   - every accepted plan whose column is visible in the sheet is returned,
 *     with its header exactly as written (decision 2026-10-30: no separate
 *     review or status gate; the verified snapshot IS what users see);
 *   - a plan whose column is hidden in the published snapshot is never returned;
 *   - category rows hidden in the sheet are never returned;
 *   - only the accepted plan columns are read, so column A (QA rating guide),
 *     column B/C labels and anything else outside them can never be returned;
 *   - cells are located by the accepted structure (plan key -> column, category
 *     key -> rows) recorded when the snapshot passed its structure check; no
 *     searching, no approximate matching, no inference from formatting;
 *   - merged cells are followed to their anchor; text is returned exactly.
 * The routes using this are gated on the all-user product_playbook feature.
 */

export const MAX_PLANS_PER_REQUEST = 4;

export interface ReadPlan {
  planKey: string;
  insurer: string;
  displayName: string;
  expectedHeader: string;
  status: string;
  statusConfirmedBy: string | null;
  statusConfirmedAt: Date | string | null;
  showToAdvisors: boolean;
  sortOrder: number;
}
export interface ReadFeature {
  featureKey: string;
  subKey: string;
  expectedLabel: string;
  expectedSubLabel: string | null;
  sortOrder: number;
}
export interface ReadCellRow {
  sheetGid: number;
  a1: string;
  rowNum: number;
  colNum: number;
  valueKind: string;
  rawText: string | null;
  numberRaw: string | null;
  formattedValue: string | null;
  resolvedRuns: unknown;
  note: string | null;
  coveredBy: string | null;
}
export interface PublishedContext {
  snapshotId: number;
  publishedAt: Date | string | null;
  fetchedAt: Date | string;
  mainSheetGid: number;
  hiddenCols: number[];
  hiddenRows: number[];
  planColumns: Record<string, string>;
  featureRows: Record<string, number[]>;
}

export interface ReadCell {
  planKey: string;
  featureKey: string;
  subKey: string;
  a1: string;
  readFrom: string;
  isEmpty: boolean;
  valueKind: string;
  rawText: string | null;
  numberRaw: string | null;
  formattedValue: string | null;
  resolvedRuns: unknown;
  note: string | null;
  /** Set when the sheet has something here the mirror can't show (e.g. a picture). */
  warning: string | null;
}

/** What advisors see on a cell with a recorded source gap (e.g. a picture over AD46). */
export const CHECK_PLAYBOOK_DIRECTLY = "This part of the Playbook can't be shown here (it's a picture in the sheet). Please check the Playbook directly.";

const colToNum = (col: string) => [...col].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
const FIRST_PLAN_COLUMN = 4; // D. Columns A–C (rating guide, category labels) are never plan data.

/** Plans an advisor would be allowed to see right now. */
export function visiblePlans(plans: ReadPlan[], ctx: PublishedContext | null): ReadPlan[] {
  if (!ctx) return [];
  return plans
    .filter((p) => {
      const col = ctx.planColumns[p.planKey];
      if (!col) return false;
      const n = colToNum(col);
      return n >= FIRST_PLAN_COLUMN && !ctx.hiddenCols.includes(n);
    })
    .sort((a, b) => a.sortOrder - b.sortOrder);
}

export function readCells(input: {
  ctx: PublishedContext | null;
  plans: ReadPlan[];
  features: ReadFeature[];
  cells: ReadCellRow[];
  planKeys: string[];
  featureKeys: string[];
  /** A1 addresses on the main tab with an open source gap (see playbook_source_issues). */
  gapCells?: string[];
}): { ok: true; cells: ReadCell[] } | { ok: false; error: string } {
  const gaps = new Set(input.gapCells ?? []);
  const { ctx } = input;
  if (!ctx) return { ok: false, error: "Nothing has been published yet." };
  const planKeys = [...new Set(input.planKeys)];
  if (planKeys.length === 0) return { ok: false, error: "Choose at least one plan." };
  if (planKeys.length > MAX_PLANS_PER_REQUEST) return { ok: false, error: `At most ${MAX_PLANS_PER_REQUEST} plans at a time.` };
  const allowed = new Map(visiblePlans(input.plans, ctx).map((p) => [p.planKey, p]));
  const notAllowed = planKeys.filter((k) => !allowed.has(k));
  if (notAllowed.length) return { ok: false, error: `Not available: ${notAllowed.join(", ")}.` };
  const featureKeys = [...new Set(input.featureKeys)];
  const features = featureKeys.length === 0 ? input.features : input.features.filter((f) => featureKeys.includes(f.featureKey));
  const unknown = featureKeys.filter((k) => !input.features.some((f) => f.featureKey === k));
  if (unknown.length) return { ok: false, error: `Unknown categories: ${unknown.join(", ")}.` };

  const byA1 = new Map(input.cells.filter((c) => c.sheetGid === ctx.mainSheetGid).map((c) => [c.a1, c]));
  const out: ReadCell[] = [];
  for (const planKey of planKeys) {
    const col = ctx.planColumns[planKey];
    for (const f of [...features].sort((a, b) => a.sortOrder - b.sortOrder)) {
      const rows = ctx.featureRows[f.subKey ? `${f.featureKey}.${f.subKey}` : f.featureKey] ?? [];
      for (const row of rows) {
        if (ctx.hiddenRows.includes(row)) continue;
        const a1 = `${col}${row}`;
        const own = byA1.get(a1);
        const anchor = own?.coveredBy ? byA1.get(own.coveredBy) : own;
        // A merge may only be followed within plan columns (never into A–C).
        const src = anchor && anchor.colNum >= FIRST_PLAN_COLUMN ? anchor : own;
        const isEmpty = !src || (src.rawText === null && src.numberRaw === null);
        out.push({
          planKey,
          featureKey: f.featureKey,
          subKey: f.subKey,
          a1,
          readFrom: src?.a1 ?? a1,
          isEmpty,
          valueKind: src?.valueKind ?? "empty",
          rawText: src?.rawText ?? null,
          numberRaw: src?.numberRaw ?? null,
          formattedValue: src?.formattedValue ?? null,
          resolvedRuns: src?.resolvedRuns ?? null,
          note: src?.note ?? null,
          warning: gaps.has(a1) || gaps.has(src?.a1 ?? a1) ? CHECK_PLAYBOOK_DIRECTLY : null,
        });
      }
    }
  }
  return { ok: true, cells: out };
}
