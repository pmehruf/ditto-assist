/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from "vitest";
import { parseGlobalLogTimestamp, formatDisplayTimestamp } from "../utils/timestamps";

describe("parseGlobalLogTimestamp", () => {
  it("returns null for an empty string", () => {
    expect(parseGlobalLogTimestamp("")).toBeNull();
  });

  it("parses a standard ISO timestamp directly", () => {
    const result = parseGlobalLogTimestamp("2026-06-06T23:45:00.000Z");
    expect(result).not.toBeNull();
    expect(result?.toISOString()).toBe("2026-06-06T23:45:00.000Z");
  });

  it("parses the comma-separated 'time, date' custom format", () => {
    // e.g. "11:45 PM, 06/06/2026" — the code takes the part after the comma
    // (the date) and lets Date.parse resolve it.
    const result = parseGlobalLogTimestamp("11:45 PM, 06/06/2026");
    expect(result).not.toBeNull();
    expect(result?.getFullYear()).toBe(2026);
  });

  it("falls back to manual DD/MM/YYYY parsing when Date.parse can't resolve the date part", () => {
    // "13" can't be a month, so this must be interpreted as day=13, month=02.
    const result = parseGlobalLogTimestamp("13/02/2026");
    expect(result).not.toBeNull();
    expect(result?.getFullYear()).toBe(2026);
    expect(result?.getMonth()).toBe(1); // February (0-indexed)
    expect(result?.getDate()).toBe(13);
  });

  it("falls back to manual YYYY-MM-DD parsing when the first segment is the year", () => {
    const result = parseGlobalLogTimestamp("2026-03-05");
    expect(result).not.toBeNull();
    expect(result?.getFullYear()).toBe(2026);
  });

  it("returns null for genuinely unparseable input", () => {
    expect(parseGlobalLogTimestamp("not a date at all")).toBeNull();
  });
});

describe("formatDisplayTimestamp", () => {
  it("returns an empty string for an empty input", () => {
    expect(formatDisplayTimestamp("")).toBe("");
  });

  it("returns the original string unchanged if it cannot be parsed", () => {
    expect(formatDisplayTimestamp("not a date at all")).toBe("not a date at all");
  });

  it("formats a valid ISO timestamp into a locale date + time string", () => {
    const formatted = formatDisplayTimestamp("2026-06-06T23:45:00.000Z");
    // Don't assert on the exact locale-dependent string (varies by CI
    // machine's ICU locale data) — just confirm it produced a non-trivial,
    // differently-shaped string rather than echoing the ISO input back.
    expect(formatted).not.toBe("");
    expect(formatted).not.toBe("2026-06-06T23:45:00.000Z");
  });
});
