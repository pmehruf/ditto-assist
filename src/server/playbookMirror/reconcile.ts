/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * PRODUCT PLAYBOOK MIRROR — independent reconciliation (Phase 1, Step 5).
 *
 * Proves a stored snapshot is an exact copy of what Google sent. It re-reads
 * the stored RAW response (the byte-exact evidence) and compares it with the
 * stored tab and cell rows, field by field.
 *
 * DELIBERATELY INDEPENDENT of transform.ts: it does not import it and
 * re-implements the few rules it needs (A1 names, run boundaries, format
 * inheritance, colours) in the simplest possible way, so a bug in the
 * transform cannot hide itself. Pass = zero differences.
 */

import { createHash } from "crypto";
import { gunzipSync } from "zlib";

/* eslint-disable @typescript-eslint/no-explicit-any -- walks untyped Google JSON on purpose */

export interface ReconSnapshot {
  rawResponseGzip: Uint8Array;
  rawResponseBytes: number;
  rawSha256: string;
}
export interface ReconTab {
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
  mergesRaw: unknown;
}
export interface ReconCell {
  sheetGid: number;
  rowNum: number;
  colNum: number;
  a1: string;
  valueKind: string;
  rawText: string | null;
  numberRaw: string | null;
  formattedValue: string | null;
  formula: string | null;
  userEnteredValue: unknown;
  effectiveValue: unknown;
  textFormatRuns: unknown;
  resolvedRuns: unknown;
  userEnteredFormat: unknown;
  effectiveFormat: unknown;
  chipRuns: unknown;
  note: string | null;
  hyperlink: string | null;
  mergeRange: string | null;
  coveredBy: string | null;
}

export interface ReconciliationReport {
  ok: boolean;
  checkedAt: string;
  method: string;
  raw: { sha256Matches: boolean; bytesMatch: boolean; envelopeFormat: string | null };
  totals: Record<string, { raw: number; stored: number }>;
  differenceCount: number;
  differences: string[];
}

const MAX_LISTED = 200;

function letters(n: number): string {
  let out = "";
  for (let x = n; x > 0; x = Math.floor((x - 1) / 26)) out = String.fromCharCode(65 + ((x - 1) % 26)) + out;
  return out;
}
/** Key-order-insensitive deep equality (PostgreSQL jsonb re-orders keys; values must still match exactly). */
function same(a: unknown, b: unknown): boolean {
  const norm = (x: any): any =>
    Array.isArray(x) ? x.map(norm) : x && typeof x === "object" ? Object.keys(x).sort().reduce((o: any, k) => ((o[k] = norm(x[k])), o), {}) : x;
  return JSON.stringify(norm(a ?? null)) === JSON.stringify(norm(b ?? null));
}
function hex(c: any): string | null {
  if (!c) return null;
  if (c.themeColor) return "theme:" + c.themeColor;
  const v = c.rgbColor !== undefined ? c.rgbColor : c;
  if (c.rgbColor === undefined && v.red === undefined && v.green === undefined && v.blue === undefined) return null;
  const two = (n: number | undefined) => Math.round((n || 0) * 255).toString(16).toUpperCase().padStart(2, "0");
  return "#" + two(v.red) + two(v.green) + two(v.blue);
}

export function reconcileSnapshot(snapshot: ReconSnapshot, tabs: ReconTab[], cells: ReconCell[], now: Date = new Date()): ReconciliationReport {
  const differences: string[] = [];
  const add = (d: string) => differences.push(d);

  // 1. Raw evidence.
  let envelope = "";
  let envelopeFormat: string | null = null;
  let grid: any = { sheets: [] };
  let scan: any = { sheets: [] };
  let ranges: string[] = [];
  try {
    envelope = gunzipSync(Buffer.from(snapshot.rawResponseGzip)).toString("utf8");
    const parsed = JSON.parse(envelope);
    envelopeFormat = parsed.format ?? null;
    grid = JSON.parse(parsed.grid);
    // v1 envelopes carried a whole-tab scan; v2 (fixed configured ranges) carries the ranges instead.
    if (parsed.scan) scan = JSON.parse(parsed.scan);
    if (Array.isArray(parsed.ranges)) ranges = parsed.ranges;
  } catch (e) {
    add(`raw: the stored response cannot be read (${e instanceof Error ? e.message : String(e)})`);
  }
  const sha256Matches = createHash("sha256").update(envelope, "utf8").digest("hex") === snapshot.rawSha256;
  const bytesMatch = Buffer.byteLength(envelope, "utf8") === snapshot.rawResponseBytes;
  if (!sha256Matches) add("raw: SHA-256 of the stored response does not match the recorded fingerprint");
  if (!bytesMatch) add("raw: size of the stored response does not match the recorded size");

  const storedTabs = new Map(tabs.map((t) => [Number(t.sheetGid), t]));
  const storedCells = new Map(cells.map((c) => [`${Number(c.sheetGid)}|${c.a1}`, c]));
  const seen = new Set<string>();
  const totals: ReconciliationReport["totals"] = {};
  const count = (k: string, side: "raw" | "stored", n = 1) => {
    totals[k] = totals[k] ?? { raw: 0, stored: 0 };
    totals[k][side] += n;
  };

  (grid.sheets ?? []).forEach((sheet: any, i: number) => {
    const p = sheet.properties ?? {};
    const gid = Number(p.sheetId ?? 0);
    const label = `"${p.title}"`;
    const d = (sheet.data ?? [])[0] ?? {};
    const r0 = d.startRow ?? 0;
    const c0 = d.startColumn ?? 0;
    const merges = (scan.sheets?.[i]?.merges ?? sheet.merges ?? []) as any[];
    // Bounds of the configured range for this tab (v2), parsed here independently of config.ts.
    const rm = /!([A-Z]+)(d+):([A-Z]+)(d+)$/.exec(ranges[i] ?? "");
    const toNum = (l: string) => [...l].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
    const inRange = (a1: string) => {
      if (!rm) return true;
      const p = /^([A-Z]+)(d+)$/.exec(a1)!;
      const c = toNum(p[1]);
      const r = Number(p[2]);
      return r >= Number(rm[2]) && r <= Number(rm[4]) && c >= toNum(rm[1]) && c <= toNum(rm[3]);
    };

    // 2. Tab metadata.
    const t = storedTabs.get(gid);
    if (!t) {
      add(`${label}: tab missing from storage`);
    } else {
      const want = {
        title: p.title,
        tabIndex: p.index ?? null,
        frozenRows: p.gridProperties?.frozenRowCount ?? null,
        frozenCols: p.gridProperties?.frozenColumnCount ?? null,
        gridRows: p.gridProperties?.rowCount ?? null,
        gridCols: p.gridProperties?.columnCount ?? null,
        hiddenRows: [] as number[],
        hiddenCols: [] as number[],
        rowsHiddenByFilter: [] as number[],
      };
      (d.rowMetadata ?? []).forEach((m: any, k: number) => {
        if (m?.hiddenByUser) want.hiddenRows.push(r0 + k + 1);
        if (m?.hiddenByFilter) want.rowsHiddenByFilter.push(r0 + k + 1);
      });
      (d.columnMetadata ?? []).forEach((m: any, k: number) => {
        if (m?.hiddenByUser) want.hiddenCols.push(c0 + k + 1);
      });
      for (const [k, v] of Object.entries(want)) {
        if (!same((t as any)[k], v)) add(`${label}: tab ${k} differs (stored ${JSON.stringify((t as any)[k])}, raw ${JSON.stringify(v)})`);
      }
      if (!same(t.mergesRaw, merges)) add(`${label}: merges differ`);
    }
    count("merges", "raw", merges.length);
    count("merges", "stored", Array.isArray(t?.mergesRaw) ? (t!.mergesRaw as unknown[]).length : 0);

    // 3. Merge membership expected for every cell.
    const anchorOf = new Map<string, { anchor: string; range: string }>();
    for (const m of merges) {
      const top = (m.startRowIndex ?? 0) + 1;
      const left = (m.startColumnIndex ?? 0) + 1;
      const anchor = letters(left) + top;
      const range = `${anchor}:${letters(m.endColumnIndex)}${m.endRowIndex}`;
      for (let r = top; r <= m.endRowIndex; r++) for (let c = left; c <= m.endColumnIndex; c++) anchorOf.set(letters(c) + r, { anchor, range });
    }
    const checkMerge = (a1: string, s: ReconCell) => {
      const m = anchorOf.get(a1);
      const wantRange = m && m.anchor === a1 ? m.range : null;
      const wantCovered = m && m.anchor !== a1 ? m.anchor : null;
      if ((s.mergeRange ?? null) !== wantRange) add(`${label}!${a1}: merge range differs (stored ${s.mergeRange}, raw ${wantRange})`);
      if ((s.coveredBy ?? null) !== wantCovered) add(`${label}!${a1}: covered-by differs (stored ${s.coveredBy}, raw ${wantCovered})`);
    };

    // 4. Every raw cell.
    (d.rowData ?? []).forEach((row: any, ri: number) => {
      (row?.values ?? []).forEach((v: any, ci: number) => {
        if (!v || Object.keys(v).length === 0) return;
        const r = r0 + ri + 1;
        const c = c0 + ci + 1;
        const a1 = letters(c) + r;
        const key = `${gid}|${a1}`;
        seen.add(key);
        const u = v.userEnteredValue ?? {};
        if (Object.keys(u).length) count("cells with a value", "raw");
        if (v.note) count("notes", "raw");
        const s = storedCells.get(key);
        if (!s) {
          add(`${label}!${a1}: in Google's response but missing from storage`);
          return;
        }
        if (s.rowNum !== r || s.colNum !== c) add(`${label}!${a1}: row/column numbers differ`);
        const wantText = u.stringValue !== undefined ? u.stringValue : u.boolValue !== undefined ? String(u.boolValue) : null;
        if ((s.rawText ?? null) !== wantText) add(`${label}!${a1}: text differs`);
        const wantNumber = u.numberValue !== undefined ? String(u.numberValue) : null;
        if ((s.numberRaw ?? null) !== wantNumber) add(`${label}!${a1}: number differs (stored ${s.numberRaw}, raw ${wantNumber})`);
        if ((s.formula ?? null) !== (u.formulaValue ?? null)) add(`${label}!${a1}: formula differs`);
        if ((s.formattedValue ?? null) !== (v.formattedValue ?? null)) add(`${label}!${a1}: displayed value differs`);
        if ((s.note ?? null) !== (v.note ?? null)) add(`${label}!${a1}: note differs`);
        if ((s.hyperlink ?? null) !== (v.hyperlink ?? null)) add(`${label}!${a1}: cell link differs`);
        const raws: [string, unknown, unknown][] = [
          ["raw value", s.userEnteredValue, v.userEnteredValue],
          ["raw effective value", s.effectiveValue, v.effectiveValue],
          ["raw formatting runs", s.textFormatRuns, v.textFormatRuns],
          ["raw format", s.userEnteredFormat, v.userEnteredFormat],
          ["raw effective format", s.effectiveFormat, v.effectiveFormat],
          ["raw chips", s.chipRuns, v.chipRuns],
        ];
        for (const [name, a, b] of raws) if (!same(a, b)) add(`${label}!${a1}: ${name} differs`);
        checkMerge(a1, s);

        // Processed runs: rebuilt here independently and compared.
        if (wantText !== null && u.stringValue !== undefined) {
          const base = v.effectiveFormat?.textFormat ?? {};
          const src: any[] = v.textFormatRuns?.length ? v.textFormatRuns : [{ startIndex: 0, format: {} }];
          const want = src.map((run, k) => {
            const start = run.startIndex ?? 0;
            const end = k + 1 < src.length ? src[k + 1].startIndex ?? 0 : wantText.length;
            const f = run.format ?? {};
            const flag = (name: string) => !!(f[name] !== undefined ? f[name] : base[name]);
            const own = f.foregroundColorStyle ?? f.foregroundColor;
            return {
              start,
              end,
              text: wantText.slice(start, end),
              bold: flag("bold"),
              italic: flag("italic"),
              underline: flag("underline"),
              strikethrough: flag("strikethrough"),
              color: hex(own !== undefined ? own : base.foregroundColorStyle ?? base.foregroundColor),
              link: f.link?.uri ?? base.link?.uri ?? null,
            };
          });
          if (!same(s.resolvedRuns, want)) add(`${label}!${a1}: processed formatting runs differ`);
          count("formatting runs", "raw", (v.textFormatRuns ?? []).length);
          count("links in text", "raw", want.filter((x) => x.link).length);
        }
      });
    });

    // 5. Stored rows Google didn't send must be merge-covered empties only.
    for (const s of cells) {
      if (Number(s.sheetGid) !== gid) continue;
      const key = `${gid}|${s.a1}`;
      if (s.valueKind !== "empty" || s.rawText !== null) count("cells with a value", "stored");
      if (s.note) count("notes", "stored");
      count("formatting runs", "stored", Array.isArray(s.textFormatRuns) ? (s.textFormatRuns as unknown[]).length : 0);
      count("links in text", "stored", Array.isArray(s.resolvedRuns) ? (s.resolvedRuns as any[]).filter((x) => x?.link).length : 0);
      if (seen.has(key)) continue;
      if (!inRange(s.a1)) {
        add(`${label}!${s.a1}: stored outside the configured range`);
        continue;
      }
      const isEmpty = s.valueKind === "empty" && s.rawText === null && s.numberRaw === null && s.note === null && s.formattedValue === null && s.textFormatRuns === null && s.userEnteredFormat === null && s.effectiveFormat === null;
      if (!anchorOf.has(s.a1)) add(`${label}!${s.a1}: stored but not in Google's response and not part of a merge`);
      else if (!isEmpty) add(`${label}!${s.a1}: stored merge-filler cell is not empty`);
      else checkMerge(s.a1, s);
    }
    for (const a1 of anchorOf.keys()) if (inRange(a1) && !storedCells.has(`${gid}|${a1}`)) add(`${label}!${a1}: merged cell has no stored row`);
  });

  for (const t of tabs) if (!(grid.sheets ?? []).some((s: any) => Number(s.properties?.sheetId) === Number(t.sheetGid))) add(`stored tab "${t.title}" is not in Google's response`);
  for (const [k, v] of Object.entries(totals)) if (v.raw !== v.stored) add(`totals: ${k} raw ${v.raw} vs stored ${v.stored}`);

  return {
    ok: differences.length === 0,
    checkedAt: now.toISOString(),
    method: "independent re-read of the stored raw response (reconcile.ts; does not use transform.ts)",
    raw: { sha256Matches, bytesMatch, envelopeFormat },
    totals,
    differenceCount: differences.length,
    differences: differences.slice(0, MAX_LISTED),
  };
}
