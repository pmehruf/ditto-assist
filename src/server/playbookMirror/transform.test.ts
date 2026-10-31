/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-disable @typescript-eslint/no-explicit-any -- tests edit untyped synthetic Google JSON */
import { describe, expect, it } from "vitest";
import { colorOf, resolveRuns, transformSheet } from "./transform.js";
import { columnToNum, numToColumn } from "./a1.js";
import { syntheticGrid } from "./__fixtures__/syntheticSheet.js";
import { gridRanges, MIRROR_SPREADSHEET_ID, MIRROR_TABS, parseRange } from "./config.js";
import { PLAYBOOK_SPREADSHEET_ID } from "../knowledgeBase/playbookSheetsClient.js";

describe("mirror config", () => {
  it("mirrors the same spreadsheet the existing Playbook sync reads", () => {
    expect(MIRROR_SPREADSHEET_ID).toBe(PLAYBOOK_SPREADSHEET_ID);
  });
  it("uses exactly the fixed configured source ranges (decision 2026-10-30)", () => {
    expect(MIRROR_TABS).toEqual([
      { title: "Ditto's Recommended Policies", range: "B1:AF56" },
      { title: "Recommendation specifics", range: "A1:G33" },
    ]);
    expect(gridRanges()).toEqual(["'Ditto''s Recommended Policies'!B1:AF56", "'Recommendation specifics'!A1:G33"]);
    expect(parseRange("B1:AF56")).toEqual({ firstRow: 1, lastRow: 56, firstCol: 2, lastCol: 32 });
  });
  it("refuses a malformed range instead of guessing", () => {
    for (const bad of ["B1", "B1:AF", "AF56:B1", "B0:C2", "b1:af56 x"]) expect(() => parseRange(bad)).toThrow(/Invalid mirror range/);
  });
});

describe("A1 helpers", () => {
  it("convert column letters both ways", () => {
    expect([numToColumn(1), numToColumn(26), numToColumn(27), numToColumn(32), numToColumn(44)]).toEqual(["A", "Z", "AA", "AF", "AR"]);
    expect(columnToNum("AR")).toBe(44);
  });
});

describe("colorOf", () => {
  it("reads Google colours, including the empty-object black", () => {
    expect(colorOf({ rgbColor: { red: 0.21960784, green: 0.4627451, blue: 0.11372549 } })).toBe("#38761D");
    expect(colorOf({ rgbColor: {} })).toBe("#000000");
    expect(colorOf({ themeColor: "ACCENT1" })).toBe("theme:ACCENT1");
    expect(colorOf(undefined)).toBeNull();
  });
});

describe("resolveRuns", () => {
  it("applies Google's inheritance: a run without its own format takes the cell's", () => {
    const runs = resolveRuns("ab", [{ format: {} }, { startIndex: 1, format: { bold: false } }], { bold: true });
    expect(runs.map((r) => [r.text, r.bold])).toEqual([["a", true], ["b", false]]);
  });
  it("gives a plain text cell one run covering all of it", () => {
    expect(resolveRuns("x y", undefined, { italic: true })).toEqual([
      { start: 0, end: 3, text: "x y", bold: false, italic: true, underline: false, strikethrough: false, color: null, link: null },
    ]);
  });
});

describe("transformSheet (synthetic)", () => {
  const { tab, cells } = transformSheet(syntheticGrid().sheets[0]);
  const cell = (a1: string) => cells.find((c) => c.a1 === a1)!;

  it("keeps tab metadata, hidden flags and merges exactly", () => {
    expect(tab).toMatchObject({ sheetGid: 0, title: "Ditto's Recommended Policies", frozenRows: 1, frozenCols: 3, hiddenRows: [4], hiddenCols: [1], rowsHiddenByFilter: [] });
    expect(tab.mergesRaw).toHaveLength(2);
  });

  it("copies text exactly: leading/trailing spaces, whitespace-only, lone CR, '-' vs '- '", () => {
    expect(cell("D1").rawText).toBe(" Plan Alpha\r(Status note)");
    expect(cell("E1").rawText).toBe("Plan Beta ");
    expect(cell("B1").rawText).toBe("   ");
    expect(cell("E3").rawText).toBe("-");
    expect(cell("E4").rawText).toBe("- ");
  });

  it("keeps numbers and what the sheet displays side by side", () => {
    expect(cell("E2")).toMatchObject({ valueKind: "number", numberRaw: "1", numberValue: "1", formattedValue: "100%", rawText: null });
  });

  it("resolves formatting runs with colours, inheritance and links", () => {
    const runs = cell("D2").resolvedRuns!;
    expect(runs.map((r) => r.text).join("")).toBe(cell("D2").rawText);
    expect(runs[0]).toMatchObject({ text: "1) Heading\n", bold: true, color: "#38761D", link: null });
    expect(runs[1]).toMatchObject({ bold: false, color: "#000000" });
    expect(runs[2]).toMatchObject({ text: "link", underline: true, link: "https://example.com/doc" });
    expect(cell("D2").textFormatRuns).toHaveLength(3);
  });

  it("records merge anchors and the cells they cover", () => {
    expect(cell("B2")).toMatchObject({ mergeRange: "B2:B3", coveredBy: null });
    expect(cell("B3")).toMatchObject({ valueKind: "empty", coveredBy: "B2", mergeRange: null });
    expect(cell("D3")).toMatchObject({ valueKind: "empty", coveredBy: "D2" });
  });

  it("keeps notes, and cells that only carry formatting", () => {
    expect(cell("E1").note).toBe("Header note");
    expect(cell("D4")).toMatchObject({ valueKind: "empty", rawText: null });
    expect(cell("D4").userEnteredFormat).toEqual({ backgroundColorStyle: { rgbColor: { red: 1 } } });
  });

  it("skips cells Google returned with no properties at all", () => {
    expect(cells.find((c) => c.a1 === "C1")).toBeUndefined();
  });
});

describe("transformSheet with configured bounds", () => {
  it("keeps only cells inside the configured range and never creates merge fillers outside it", () => {
    const sheet = syntheticGrid().sheets[0] as any;
    sheet.merges = [...sheet.merges, { sheetId: 0, startRowIndex: 2, endRowIndex: 6, startColumnIndex: 4, endColumnIndex: 5 }]; // E3:E6
    const { cells } = transformSheet(sheet, undefined, { firstRow: 1, lastRow: 4, firstCol: 2, lastCol: 5 });
    expect(cells.some((c) => c.colNum < 2 || c.rowNum > 4)).toBe(false); // column A and rows 5+ excluded
    expect(cells.find((c) => c.a1 === "E4")).toMatchObject({ coveredBy: "E3" });
    expect(cells.find((c) => c.a1 === "E5")).toBeUndefined();
  });
});
