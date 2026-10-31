/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * PRODUCT PLAYBOOK — faithful rendering of mirrored cells on the advisor
 * page. Text, bold/italic/underline/strikethrough,
 * colours, links, line breaks and notes are shown exactly as stored (line breaks
 * are only normalised for display). Rows and columns hidden in the source sheet
 * are never rendered — the server doesn't send them either.
 */

import { useMemo, type CSSProperties } from "react";

export interface Run { text: string; bold: boolean; italic: boolean; underline: boolean; strikethrough: boolean; color: string | null; link: string | null }
export interface GridCell {
  a1: string; rowNum: number; colNum: number; valueKind: string; rawText: string | null; numberRaw: string | null;
  formattedValue: string | null; resolvedRuns: Run[] | null; note: string | null; mergeRange: string | null; coveredBy: string | null;
  background: { rgbColor?: { red?: number; green?: number; blue?: number } } | null;
  /** Set when the sheet has something here the mirror can't show (e.g. a picture). */
  warning?: string | null;
}

/** Shown on a cell the mirror can't reproduce: points the reader to the Playbook itself. */
export function CheckPlaybook({ text }: { text: string }) {
  return (
    <div className="my-0.5 rounded border border-amber-400 bg-amber-50 px-1.5 py-1 text-[11px] font-semibold text-amber-900 dark:border-amber-500/60 dark:bg-amber-900/30 dark:text-amber-200 whitespace-pre-wrap">
      {text}
    </div>
  );
}

export interface PlaybookGridData {
  snapshotId: number;
  tabs: { sheetGid: number; title: string }[];
  tab: { sheetGid: number; title: string; hiddenRows: number[]; hiddenCols: number[] };
  cells: GridCell[];
}

const colLetters = (n: number) => { let s = ""; for (let x = n; x > 0; x = Math.floor((x - 1) / 26)) s = String.fromCharCode(65 + ((x - 1) % 26)) + s; return s; };
const display = (t: string) => t.replace(/\r\n|\r/g, "\n"); // display only; stored text is never changed
const rgb = (b: GridCell["background"]) => {
  const c = b?.rgbColor;
  if (!c) return undefined;
  const v = (x?: number) => Math.round((x ?? 0) * 255);
  const [r, g, bl] = [v(c.red), v(c.green), v(c.blue)];
  return r === 255 && g === 255 && bl === 255 ? undefined : `rgb(${r},${g},${bl})`;
};
// Advisor page only: a sheet background under white text (e.g. the light blue #3D85C6)
// is shown darker so the white text reads clearly. The stored colour is unchanged.
const DARKEN = 0.7;
const whiteText = (cell: GridCell) => !!cell.resolvedRuns?.length && cell.resolvedRuns.every((r) => (r.color ?? "").toUpperCase() === "#FFFFFF" || !r.text.trim());
const advisorBg = (cell: GridCell | undefined) => {
  const c = cell?.background?.rgbColor;
  if (!cell || !c || !whiteText(cell)) return rgb(cell?.background ?? null);
  const v = (x?: number) => Math.round((x ?? 0) * 255 * DARKEN);
  return `rgb(${v(c.red)},${v(c.green)},${v(c.blue)})`;
};

export function Runs({ cell }: { cell: GridCell }) {
  if (cell.resolvedRuns && cell.resolvedRuns.length) {
    return (
      <>
        {cell.resolvedRuns.map((r, i) => {
          const style: CSSProperties = {
            fontWeight: r.bold ? 700 : 400, fontStyle: r.italic ? "italic" : undefined, color: r.color && r.color !== "#000000" && !r.color.startsWith("theme:") ? r.color : undefined,
            textDecoration: [r.underline ? "underline" : "", r.strikethrough ? "line-through" : ""].filter(Boolean).join(" ") || undefined,
          };
          return r.link ? (
            <a key={i} href={r.link} target="_blank" rel="noopener noreferrer" style={style} className="text-sky-700 dark:text-sky-400">{display(r.text)}</a>
          ) : (
            <span key={i} style={style}>{display(r.text)}</span>
          );
        })}
      </>
    );
  }
  return <span>{cell.formattedValue ?? cell.rawText ?? cell.numberRaw ?? ""}</span>;
}

/**
 * Faithful grid of the stored range. Rows and columns hidden in the Google
 * Sheet are NOT displayed (the server doesn't even send their cells); only
 * their numbers are listed above the grid. There is no option to show them.
 */
// Explicit colours per theme for the advisor page (the app's global theme rules restyle stone-* utilities).
const THEMES = {
  light: { wrap: "border-[#B8C4D4] bg-white", gutter: "bg-[#D5DEEA] text-[#1E293B] border-[#B8C4D4]", cell: "border-[#B8C4D4] bg-white text-[#1E293B]" },
  dark: { wrap: "border-[#1e3e5c] bg-[#102236]", gutter: "bg-[#0B2A44] text-[#F5F7FA] border-[#1e3e5c]", cell: "border-[#1e3e5c] bg-[#102236] text-[#F5F7FA]" },
};

export function PlaybookGrid({ grid, theme }: { grid: PlaybookGridData; theme: "light" | "dark" }) {
  const t = THEMES[theme];
  const byA1 = useMemo(() => new Map(grid.cells.map((c) => [c.a1, c])), [grid]);
  // Columns whose values are all short (e.g. "Sl.no.") get a narrow width instead of the default.
  const narrowCols = useMemo(() => {
    const longest = new Map<number, number>();
    for (const c of grid.cells) {
      // Skip covered cells and merges across several columns (they don't decide one column's width).
      if (c.coveredBy || (c.mergeRange && c.mergeRange.split(":")[0].replace(/\d+/g, "") !== c.mergeRange.split(":")[1].replace(/\d+/g, ""))) continue;
      const len = Math.max(0, ...(c.formattedValue ?? c.rawText ?? c.numberRaw ?? "").split(/\r\n|\r|\n/).map((l) => l.length));
      longest.set(c.colNum, Math.max(longest.get(c.colNum) ?? 0, len));
    }
    return new Set([...longest].filter(([, n]) => n <= 8).map(([col]) => col));
  }, [grid]);
  const hiddenRows = new Set(grid.tab.hiddenRows);
  const hiddenCols = new Set(grid.tab.hiddenCols);
  const firstRow = Math.min(...grid.cells.map((c) => c.rowNum), ...[...hiddenRows]);
  const firstCol = Math.min(...grid.cells.map((c) => c.colNum), ...[...hiddenCols]);
  const maxRow = Math.max(1, ...grid.cells.map((c) => c.rowNum), ...[...hiddenRows]);
  const maxCol = Math.max(1, ...grid.cells.map((c) => c.colNum), ...[...hiddenCols]);
  const rows = Array.from({ length: maxRow - firstRow + 1 }, (_, i) => firstRow + i).filter((r) => !hiddenRows.has(r));
  const cols = Array.from({ length: maxCol - firstCol + 1 }, (_, i) => firstCol + i).filter((c) => !hiddenCols.has(c));
  const span = (range: string | null) => {
    if (!range) return { rowSpan: 1, colSpan: 1 };
    const [a, b] = range.split(":");
    const p = (x: string) => { const m = /^([A-Z]+)(\d+)$/.exec(x)!; return { c: [...m[1]].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0), r: Number(m[2]) }; };
    const A = p(a), B = p(b);
    // Only visible rows/columns inside the merge count towards its span.
    return { rowSpan: Math.max(1, rows.filter((r) => r >= A.r && r <= B.r).length), colSpan: Math.max(1, cols.filter((c) => c >= A.c && c <= B.c).length) };
  };
  const hiddenNote = [
    hiddenCols.size ? `columns ${[...hiddenCols].sort((x, y) => x - y).map(colLetters).join(", ")}` : "",
    hiddenRows.size ? `rows ${[...hiddenRows].sort((x, y) => x - y).join(", ")}` : "",
  ].filter(Boolean).join("; ");
  // Title rows stay frozen: the first visible row plus any rows its merged cells reach down into.
  const headerEnd = Math.max(rows[0] ?? 0, ...grid.cells.filter((c) => c.rowNum === rows[0] && c.mergeRange).map((c) => Number(/\d+$/.exec(c.mergeRange!.split(":")[1])![0])));
  const headRows = rows.filter((r) => r <= headerEnd);
  const bodyRows = rows.filter((r) => r > headerEnd);
  const renderRow = (r: number) => (
    <tr key={r}>
      <th className={`sticky left-0 z-10 border px-1 font-semibold ${t.gutter}`}>{r}</th>
      {cols.map((c) => {
        const a1 = colLetters(c) + r;
        const cell = byA1.get(a1);
        if (cell?.coveredBy) return null;
        const { rowSpan, colSpan } = span(cell?.mergeRange ?? null);
        return (
          <td key={a1} rowSpan={rowSpan} colSpan={colSpan} title={a1}
            className={`align-top text-left font-normal border px-1.5 py-1 ${narrowCols.has(c) && colSpan === 1 ? "w-[56px] min-w-[48px]" : "min-w-[140px] max-w-[320px]"} ${t.cell}`}
            style={{ backgroundColor: advisorBg(cell) }}>
            {cell?.warning && <CheckPlaybook text={cell.warning} />}
            <div className="whitespace-pre-wrap break-words max-h-64 overflow-auto">{cell && <Runs cell={cell} />}</div>
            {cell?.note && (
              <div className="mt-1 border-l-2 border-amber-500 pl-1.5 text-[10px] text-amber-900 dark:text-amber-200 whitespace-pre-wrap">
                <span className="font-bold">Note: </span>{display(cell.note)}
              </div>
            )}
          </td>
        );
      })}
    </tr>
  );
  return (
    <div className="space-y-2">
    {hiddenNote && <p className="text-[11px] text-content-muted">Hidden in the source sheet and not displayed: {hiddenNote}.</p>}
    <div className={`overflow-auto max-h-[70vh] border rounded-lg ${t.wrap}`}>
      <table className="border-collapse text-[11px] leading-snug">
        <thead className="sticky top-0 z-10">
          <tr>
            <th className={`sticky left-0 z-20 border px-1 ${t.gutter}`} />
            {cols.map((c) => (
              <th key={c} className={`border px-1 py-0.5 font-semibold ${t.gutter}`}>{colLetters(c)}</th>
            ))}
          </tr>
          {headRows.map(renderRow)}
        </thead>
        <tbody>{bodyRows.map(renderRow)}</tbody>
      </table>
    </div>
    </div>
  );
}
