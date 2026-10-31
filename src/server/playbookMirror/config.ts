/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * PRODUCT PLAYBOOK MIRROR — what is read from Google.
 * Only the two in-scope tabs are ever requested, and ONLY within the fixed
 * ranges configured below. Everything here is read-only.
 */

/** The live Product Playbook - Health spreadsheet (same sheet the existing
 * Product Assist sync reads; a test asserts the two stay equal). */
export const MIRROR_SPREADSHEET_ID = "1BT5ugkkfxUDIlaPkM5G2IW6Kuxt-eHsrXkZk_GruIOk";

export interface MirrorTabConfig {
  /** Exact tab title in the sheet. A renamed tab makes Google refuse the request, so the fetch fails closed. */
  title: string;
  /** Fixed A1 range read from this tab. Nothing outside it is ever requested. */
  range: string;
}

// ─────────────────────────────────────────────────────────────────────────
// SOURCE RANGES — the one place to change what the mirror reads.
// Fixed and explicit (decision 2026-10-30): no automatic used-range detection
// and no expansion based on populated cells. Update these by hand when the
// source content grows, then bump MIRROR_PARSER_VERSION below.
// ─────────────────────────────────────────────────────────────────────────
export const MIRROR_TABS: MirrorTabConfig[] = [
  { title: "Ditto's Recommended Policies", range: "B1:AF56" },
  { title: "Recommendation specifics", range: "A1:G33" },
];

/** Bump whenever the transform's OUTPUT changes for the same raw input (including a range change). */
export const MIRROR_PARSER_VERSION = "mirror-2026-10-30.3"; // .3: fixed configured ranges (B1:AF56, A1:G33); no whole-tab scan

/** Full-fidelity read of the configured ranges (field list proven in the Step 1 spike). */
export const MIRROR_GRID_FIELDS =
  "properties.title," +
  "sheets(properties(sheetId,title,index,hidden,gridProperties(rowCount,columnCount,frozenRowCount,frozenColumnCount))," +
  "merges," +
  "data(startRow,startColumn,rowMetadata(hiddenByUser,hiddenByFilter),columnMetadata(hiddenByUser,hiddenByFilter)," +
  "rowData(values(userEnteredValue,effectiveValue,formattedValue,textFormatRuns,note,hyperlink,chipRuns," +
  "userEnteredFormat(backgroundColorStyle,textFormat,numberFormat,wrapStrategy),effectiveFormat(textFormat,numberFormat)))))";

export interface RangeBounds {
  firstRow: number;
  lastRow: number;
  firstCol: number;
  lastCol: number;
}

const colNum = (letters: string) => [...letters.toUpperCase()].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);

/** Parses a configured "B1:AF56" range into 1-based bounds. Throws on anything else (fail closed). */
export function parseRange(range: string): RangeBounds {
  const m = /^([A-Z]+)(\d+):([A-Z]+)(\d+)$/.exec(range.trim());
  if (!m) throw new Error(`Invalid mirror range "${range}". Use the form B1:AF56.`);
  const b = { firstCol: colNum(m[1]), firstRow: Number(m[2]), lastCol: colNum(m[3]), lastRow: Number(m[4]) };
  if (b.firstRow < 1 || b.lastRow < b.firstRow || b.lastCol < b.firstCol) throw new Error(`Invalid mirror range "${range}".`);
  return b;
}

const quoteTitle = (title: string) => `'${title.replace(/'/g, "''")}'`;

export function gridRanges(tabs: MirrorTabConfig[] = MIRROR_TABS): string[] {
  return tabs.map((t) => {
    parseRange(t.range);
    return `${quoteTitle(t.title)}!${t.range}`;
  });
}

export function sheetsGetUrl(spreadsheetId: string, ranges: string[], fields: string): string {
  const r = ranges.map((x) => `ranges=${encodeURIComponent(x)}`).join("&");
  return `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?${r}&fields=${encodeURIComponent(fields)}`;
}
