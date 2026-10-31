/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// SYNTHETIC fixture (D7: no real Playbook content). It copies the SHAPES seen in the
// live sheet's API response — runs that inherit the cell format, links inside runs,
// lone carriage returns, leading spaces, "-" vs blank, numbers shown as percentages,
// notes, merges inside label and plan columns, hidden columns/rows — with made-up text.

export const SYN_TAB_1 = "Ditto's Recommended Policies";
export const SYN_TAB_2 = "Recommendation specifics";

const black = { foregroundColorStyle: { rgbColor: {} } };

export function syntheticGrid() {
  return {
    properties: { title: "Synthetic Playbook" },
    sheets: [
      {
        properties: { sheetId: 0, title: SYN_TAB_1, index: 0, gridProperties: { rowCount: 1000, columnCount: 44, frozenRowCount: 1, frozenColumnCount: 3 } },
        merges: [
          { sheetId: 0, startRowIndex: 1, endRowIndex: 3, startColumnIndex: 1, endColumnIndex: 2 }, // B2:B3 label merge
          { sheetId: 0, startRowIndex: 1, endRowIndex: 3, startColumnIndex: 3, endColumnIndex: 4 }, // D2:D3 plan-column merge
        ],
        data: [
          {
            rowMetadata: [{}, {}, {}, { hiddenByUser: true }],
            columnMetadata: [{ hiddenByUser: true }, {}, {}, {}, {}],
            rowData: [
              {
                values: [
                  { userEnteredValue: { stringValue: "Rating" }, formattedValue: "Rating" },
                  { userEnteredValue: { stringValue: "   " }, formattedValue: "   " },
                  {},
                  { userEnteredValue: { stringValue: " Plan Alpha\r(Status note)" }, formattedValue: " Plan Alpha\r(Status note)", effectiveFormat: { textFormat: { bold: true, ...black } } },
                  { userEnteredValue: { stringValue: "Plan Beta " }, formattedValue: "Plan Beta ", note: "Header note" },
                ],
              },
              {
                values: [
                  {},
                  { userEnteredValue: { stringValue: "Feature One" }, formattedValue: "Feature One" },
                  { userEnteredValue: { stringValue: "Sub A" }, formattedValue: "Sub A" },
                  {
                    userEnteredValue: { stringValue: "1) Heading\nDetail text and link" },
                    formattedValue: "1) Heading\nDetail text and link",
                    effectiveFormat: { textFormat: { bold: true, ...black } },
                    textFormatRuns: [
                      { format: { foregroundColorStyle: { rgbColor: { red: 0.21960784, green: 0.4627451, blue: 0.11372549 } } } },
                      { startIndex: 11, format: { bold: false } },
                      { startIndex: 27, format: { link: { uri: "https://example.com/doc" }, underline: true } },
                    ],
                  },
                  { userEnteredValue: { numberValue: 1 }, formattedValue: "100%", effectiveValue: { numberValue: 1 } },
                ],
              },
              {
                values: [
                  {},
                  {},
                  { userEnteredValue: { stringValue: "Sub B" }, formattedValue: "Sub B" },
                  {},
                  { userEnteredValue: { stringValue: "-" }, formattedValue: "-" },
                ],
              },
              {
                values: [{}, { userEnteredValue: { stringValue: "Feature Two" } }, {}, { userEnteredFormat: { backgroundColorStyle: { rgbColor: { red: 1 } } } }, { userEnteredValue: { stringValue: "- " } }],
              },
            ],
          },
        ],
      },
      {
        properties: { sheetId: 213, title: SYN_TAB_2, index: 1, gridProperties: { rowCount: 1000, columnCount: 29, frozenRowCount: 2, frozenColumnCount: 3 } },
        merges: [],
        data: [
          {
            rowMetadata: [{}, { hiddenByUser: true }],
            columnMetadata: [{}],
            rowData: [{"values":[{"userEnteredValue":{"stringValue":"SNo."},"formattedValue":"SNo."},{"userEnteredValue":{"stringValue":"Specific Use cases"},"formattedValue":"Specific Use cases"},{},{"userEnteredValue":{"stringValue":"Recommendation"},"formattedValue":"Recommendation"},{},{},{"userEnteredValue":{"stringValue":"Customer wants more options"},"formattedValue":"Customer wants more options"}]},{"values":[]},{"values":[{"userEnteredValue":{"numberValue":2},"formattedValue":"2"},{"userEnteredValue":{"stringValue":"Synthetic use case"},"formattedValue":"Synthetic use case"},{"userEnteredValue":{"stringValue":"Policy"},"formattedValue":"Policy"},{"userEnteredValue":{"stringValue":"Plan Alpha"},"formattedValue":"Plan Alpha"}]},{"values":[{},{},{"userEnteredValue":{"stringValue":"Add-ons"},"formattedValue":"Add-ons"},{"userEnteredValue":{"stringValue":"Recommended: Synthetic add-on"},"formattedValue":"Recommended: Synthetic add-on"}]}],
          },
        ],
      },
    ],
  };
}

export function syntheticScan(extra?: { tab: 0 | 1; row: number; col: number }) {
  const grid = syntheticGrid();
  const scan = {
    sheets: grid.sheets.map((s) => ({
      properties: { sheetId: s.properties.sheetId, title: s.properties.title },
      data: [{ rowData: (s.data[0].rowData as { values: Record<string, unknown>[] }[]).map((r) => ({ values: r.values.map((v) => (v.userEnteredValue || v.note ? { userEnteredValue: v.userEnteredValue, note: v.note } : {})) })) }],
    })),
  };
  if (extra) {
    const rows = scan.sheets[extra.tab].data[0].rowData as { values: Record<string, unknown>[] }[];
    while (rows.length < extra.row) rows.push({ values: [] });
    const values = rows[extra.row - 1].values;
    while (values.length < extra.col) values.push({});
    values[extra.col - 1] = { userEnteredValue: { stringValue: "stray" } };
  }
  return scan;
}

/** Ranges matching the synthetic sheet (tests pass these instead of the real configured ranges in config.ts). */
export const SYNTHETIC_TABS = [
  { title: SYN_TAB_1, range: "A1:E10" },
  { title: SYN_TAB_2, range: "A1:G10" },
];
