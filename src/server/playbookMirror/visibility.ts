/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * PRODUCT PLAYBOOK MIRROR — what may be DISPLAYED (decision 2026-10-30).
 *
 * The Google Sheet's own visibility decides: a row or column hidden in the
 * sheet (by the user or by a filter) is never displayed by the mirror — not in
 * the admin screen, not in the read API, not in difference reports or
 * structure messages. The raw snapshot still stores everything, with the
 * visibility metadata, for verification and audit; it is just never rendered.
 * There is deliberately NO override that could show hidden content.
 */

export interface VisibilityTab {
  hiddenRows: number[];
  hiddenCols: number[];
  rowsHiddenByFilter?: number[];
}

export interface Hidden {
  rows: Set<number>;
  cols: Set<number>;
  isHidden(row: number, col: number): boolean;
  isHiddenA1(a1: string): boolean;
}

const colNum = (letters: string) => [...letters].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);

export function hiddenOf(tab: VisibilityTab | undefined | null): Hidden {
  const rows = new Set<number>([...(tab?.hiddenRows ?? []), ...(tab?.rowsHiddenByFilter ?? [])]);
  const cols = new Set<number>(tab?.hiddenCols ?? []);
  const isHidden = (row: number, col: number) => rows.has(row) || cols.has(col);
  return {
    rows,
    cols,
    isHidden,
    isHiddenA1(a1: string) {
      const m = /^([A-Z]+)(\d+)$/.exec(a1);
      return m ? isHidden(Number(m[2]), colNum(m[1])) : false;
    },
  };
}

/**
 * Cells that may be displayed: hidden rows/columns removed entirely. A visible
 * cell covered by a merge whose anchor is hidden is returned blank (its
 * anchor's content is hidden and must not leak through the merge).
 */
export function displayableCells<T extends { rowNum: number; colNum: number; coveredBy: string | null }>(cells: T[], tab: VisibilityTab): T[] {
  const h = hiddenOf(tab);
  return cells
    .filter((c) => !h.isHidden(c.rowNum, c.colNum))
    .map((c) => (c.coveredBy && h.isHiddenA1(c.coveredBy) ? { ...c, coveredBy: null } : c));
}
