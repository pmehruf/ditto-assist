/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * PRODUCT PLAYBOOK MIRROR — exact transform from the Google Sheets API
 * response to snapshot rows (Phase 1, Step 3b). Pure functions, no I/O.
 *
 * Rules (no exceptions):
 *  - Text is copied exactly: no trimming, no case change, no line-break
 *    change (the live sheet contains lone CR characters — kept as is).
 *  - The raw Google objects are stored next to every convenience column.
 *  - A formatting run with no format of its own inherits the cell's format
 *    (Google's rule; seen in the sheet's H9/A30).
 *  - Links live inside text runs for this sheet; they are kept per run.
 *  - Every cell Google returns with any property is kept, plus every cell
 *    covered by a merge, so merged-cell lookups never need guessing.
 */

import { numToColumn } from "./a1.js";
import type { RangeBounds } from "./config.js";

/* eslint-disable @typescript-eslint/no-explicit-any -- the API response is untyped JSON, kept verbatim */
type Json = any;

export interface ResolvedRun {
  start: number;
  end: number;
  text: string;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strikethrough: boolean;
  /** "#RRGGBB" or "theme:NAME"; null when Google reports none. */
  color: string | null;
  link: string | null;
}

export interface TabRow {
  sheetGid: number;
  title: string;
  tabIndex: number | null;
  frozenRows: number | null;
  frozenCols: number | null;
  gridRows: number | null;
  gridCols: number | null;
  hiddenRows: number[];
  hiddenCols: number[];
  rowsHiddenByFilter: number[];
  mergesRaw: Json[];
}

export interface CellRow {
  sheetGid: number;
  rowNum: number;
  colNum: number;
  a1: string;
  valueKind: "empty" | "text" | "number" | "boolean" | "formula" | "error";
  rawText: string | null;
  numberRaw: string | null;
  numberValue: string | null;
  formattedValue: string | null;
  formula: string | null;
  userEnteredValue: Json | null;
  effectiveValue: Json | null;
  textFormatRuns: Json[] | null;
  resolvedRuns: ResolvedRun[] | null;
  userEnteredFormat: Json | null;
  effectiveFormat: Json | null;
  chipRuns: Json[] | null;
  note: string | null;
  hyperlink: string | null;
  mergeRange: string | null;
  coveredBy: string | null;
}

export function colorOf(style: Json): string | null {
  if (!style) return null;
  if (style.themeColor) return `theme:${style.themeColor}`;
  const rgb = style.rgbColor ?? style;
  if (rgb.red === undefined && rgb.green === undefined && rgb.blue === undefined) {
    // An empty rgbColor object is Google's way of writing black (all components 0).
    if (style.rgbColor && Object.keys(style.rgbColor).length === 0) return "#000000";
    return null;
  }
  const ch = (v: number | undefined) => Math.round((v ?? 0) * 255).toString(16).padStart(2, "0").toUpperCase();
  return `#${ch(rgb.red)}${ch(rgb.green)}${ch(rgb.blue)}`;
}

/** Splits a cell's text into runs with Google's inheritance rule applied. */
export function resolveRuns(text: string, runs: Json[] | undefined, cellTextFormat: Json | undefined): ResolvedRun[] {
  const base = cellTextFormat ?? {};
  const source = runs && runs.length > 0 ? runs : [{ startIndex: 0, format: {} }];
  return source.map((run: Json, i: number) => {
    const start = run.startIndex ?? 0;
    const end = i + 1 < source.length ? source[i + 1].startIndex ?? 0 : text.length;
    const own = run.format ?? {};
    const pick = <T>(key: string, fallback: T): T => (own[key] !== undefined ? own[key] : base[key] !== undefined ? base[key] : fallback);
    const ownColor = own.foregroundColorStyle ?? own.foregroundColor;
    const baseColor = base.foregroundColorStyle ?? base.foregroundColor;
    return {
      start,
      end,
      text: text.slice(start, end),
      bold: !!pick("bold", false),
      italic: !!pick("italic", false),
      underline: !!pick("underline", false),
      strikethrough: !!pick("strikethrough", false),
      color: colorOf(ownColor !== undefined ? ownColor : baseColor),
      link: own.link?.uri ?? (base.link?.uri ?? null),
    };
  });
}

function a1Range(m: Json): { anchor: string; range: string; cells: [number, number][] } {
  const r0 = (m.startRowIndex ?? 0) + 1;
  const c0 = (m.startColumnIndex ?? 0) + 1;
  const r1 = m.endRowIndex;
  const c1 = m.endColumnIndex;
  const cells: [number, number][] = [];
  for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) cells.push([r, c]);
  return { anchor: `${numToColumn(c0)}${r0}`, range: `${numToColumn(c0)}${r0}:${numToColumn(c1)}${r1}`, cells };
}

function hasAnyProperty(v: Json): boolean {
  return !!v && Object.keys(v).length > 0;
}

/** Converts one sheet of a spreadsheets.get response into tab + cell rows.
 * `allMerges` (from the whole-tab scan) replaces the ranged read's merges, which only include merges touching the read area. */
export function transformSheet(sheet: Json, allMerges?: Json[], bounds?: RangeBounds): { tab: TabRow; cells: CellRow[] } {
  /** Only cells inside the configured range are ever kept (bounds come from config.ts). */
  const inRange = (r: number, c: number) => !bounds || (r >= bounds.firstRow && r <= bounds.lastRow && c >= bounds.firstCol && c <= bounds.lastCol);
  const p = sheet.properties ?? {};
  const gid = Number(p.sheetId ?? 0);
  const data = (sheet.data ?? [])[0] ?? {};
  const startRow = data.startRow ?? 0;
  const startCol = data.startColumn ?? 0;
  const merges = allMerges ?? sheet.merges ?? [];

  const tab: TabRow = {
    sheetGid: gid,
    title: p.title,
    tabIndex: p.index ?? null,
    frozenRows: p.gridProperties?.frozenRowCount ?? null,
    frozenCols: p.gridProperties?.frozenColumnCount ?? null,
    gridRows: p.gridProperties?.rowCount ?? null,
    gridCols: p.gridProperties?.columnCount ?? null,
    hiddenRows: (data.rowMetadata ?? []).flatMap((m: Json, i: number) => (m?.hiddenByUser ? [startRow + i + 1] : [])),
    hiddenCols: (data.columnMetadata ?? []).flatMap((m: Json, i: number) => (m?.hiddenByUser ? [startCol + i + 1] : [])),
    rowsHiddenByFilter: (data.rowMetadata ?? []).flatMap((m: Json, i: number) => (m?.hiddenByFilter ? [startRow + i + 1] : [])),
    mergesRaw: merges,
  };

  const mergeAnchorOf = new Map<string, { range: string; anchor: string }>();
  for (const m of merges) {
    const { anchor, range, cells } = a1Range(m);
    for (const [r, c] of cells) mergeAnchorOf.set(`${r}:${c}`, { range, anchor });
  }

  const byKey = new Map<string, CellRow>();
  (data.rowData ?? []).forEach((row: Json, ri: number) => {
    (row?.values ?? []).forEach((v: Json, ci: number) => {
      if (!hasAnyProperty(v)) return;
      const rowNum = startRow + ri + 1;
      const colNum = startCol + ci + 1;
      if (!inRange(rowNum, colNum)) return;
      const uev = v.userEnteredValue ?? null;
      let valueKind: CellRow["valueKind"] = "empty";
      let rawText: string | null = null;
      let numberRaw: string | null = null;
      let formula: string | null = null;
      if (uev && uev.stringValue !== undefined) {
        valueKind = "text";
        rawText = uev.stringValue;
      } else if (uev && uev.numberValue !== undefined) {
        valueKind = "number";
        numberRaw = String(uev.numberValue);
      } else if (uev && uev.boolValue !== undefined) {
        valueKind = "boolean";
        rawText = String(uev.boolValue);
      } else if (uev && uev.formulaValue !== undefined) {
        valueKind = "formula";
        formula = uev.formulaValue;
      } else if (uev && uev.errorValue !== undefined) {
        valueKind = "error";
      }
      const runText = rawText ?? (valueKind === "formula" ? v.formattedValue ?? null : null);
      const merge = mergeAnchorOf.get(`${rowNum}:${colNum}`);
      const a1 = `${numToColumn(colNum)}${rowNum}`;
      byKey.set(`${rowNum}:${colNum}`, {
        sheetGid: gid,
        rowNum,
        colNum,
        a1,
        valueKind,
        rawText,
        numberRaw,
        numberValue: numberRaw,
        formattedValue: v.formattedValue ?? null,
        formula,
        userEnteredValue: uev,
        effectiveValue: v.effectiveValue ?? null,
        textFormatRuns: v.textFormatRuns ?? null,
        resolvedRuns: valueKind === "text" || (valueKind === "formula" && runText !== null)
          ? resolveRuns(runText as string, v.textFormatRuns, v.effectiveFormat?.textFormat)
          : null,
        userEnteredFormat: v.userEnteredFormat ?? null,
        effectiveFormat: v.effectiveFormat ?? null,
        chipRuns: v.chipRuns ?? null,
        note: v.note ?? null,
        hyperlink: v.hyperlink ?? null,
        mergeRange: merge && merge.anchor === a1 ? merge.range : null,
        coveredBy: merge && merge.anchor !== a1 ? merge.anchor : null,
      });
    });
  });

  // Every cell covered by a merge gets a row (usually empty), so lookups can follow covered_by.
  for (const [key, merge] of mergeAnchorOf) {
    if (byKey.has(key)) continue;
    const [rowNum, colNum] = key.split(":").map(Number);
    if (!inRange(rowNum, colNum)) continue; // never create rows outside the configured range
    const a1 = `${numToColumn(colNum)}${rowNum}`;
    byKey.set(key, {
      sheetGid: gid, rowNum, colNum, a1, valueKind: "empty", rawText: null, numberRaw: null, numberValue: null,
      formattedValue: null, formula: null, userEnteredValue: null, effectiveValue: null, textFormatRuns: null,
      resolvedRuns: null, userEnteredFormat: null, effectiveFormat: null, chipRuns: null, note: null, hyperlink: null,
      mergeRange: merge.anchor === a1 ? merge.range : null,
      coveredBy: merge.anchor === a1 ? null : merge.anchor,
    });
  }

  const cells = [...byKey.values()].sort((a, b) => a.rowNum - b.rowNum || a.colNum - b.colNum);
  return { tab, cells };
}
