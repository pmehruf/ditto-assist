/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import { rowDedupeKey } from "./qaDataEngine.js";

// getMergedFeedbackDumpRows() itself sits behind a live Google Sheets fetch
// plus the DB, so it isn't unit tested directly here — these tests cover
// rowDedupeKey(), the exact-match rule that function relies on to decide
// whether an archive row (e.g. the 2026-06 manual backfill batch) is already
// present in the live Sheet and should be dropped rather than double-counted.
// See qaDataEngine.ts's "OVERLAP / DE-DUPE" comment above
// getMergedFeedbackDumpRows for the full reasoning.
describe("rowDedupeKey", () => {
  it("produces the same key for identical field values regardless of source", () => {
    // A live Sheet row's cells (checked date as a Sheets serial number) vs.
    // an archive row's fields converted to the same serial — these must
    // collide so the archive row gets dropped as a duplicate.
    const liveKey = rowDedupeKey(46000, "TACT1534", "CH404512", "FIRST_CALL", 5);
    const archiveKey = rowDedupeKey(46000, "TACT1534", "CH404512", "FIRST_CALL", 5);
    expect(liveKey).toBe(archiveKey);
  });

  it("differs when the score differs — a second, genuinely different evaluation of the same chat/date is not treated as a duplicate", () => {
    const first = rowDedupeKey(46000, "TACT1534", "CH404512", "FIRST_CALL", 5);
    const second = rowDedupeKey(46000, "TACT1534", "CH404512", "FIRST_CALL", 3);
    expect(first).not.toBe(second);
  });

  it("differs when the checked date differs", () => {
    const day1 = rowDedupeKey(46000, "TACT1534", "CH404512", "FIRST_CALL", 5);
    const day2 = rowDedupeKey(46001, "TACT1534", "CH404512", "FIRST_CALL", 5);
    expect(day1).not.toBe(day2);
  });

  it("differs when the domain differs", () => {
    const call = rowDedupeKey(46000, "TACT1534", "CH404512", "FIRST_CALL", 5);
    const payment = rowDedupeKey(46000, "TACT1534", "CH404512", "PAYMENT_CALL", 5);
    expect(call).not.toBe(payment);
  });

  it("differs when the chat/lead ID differs", () => {
    const a = rowDedupeKey(46000, "TACT1534", "CH404512", "FIRST_CALL", 5);
    const b = rowDedupeKey(46000, "TACT1534", "CH999999", "FIRST_CALL", 5);
    expect(a).not.toBe(b);
  });

  it("differs when the TACT ID differs", () => {
    const a = rowDedupeKey(46000, "TACT1534", "CH404512", "FIRST_CALL", 5);
    const b = rowDedupeKey(46000, "TACT9999", "CH404512", "FIRST_CALL", 5);
    expect(a).not.toBe(b);
  });

  it("treats a null score consistently (blank Severity in the source CSV) rather than colliding with score 0 or an unrelated value", () => {
    const nullScore = rowDedupeKey(46000, "TACT1534", "CH404512", "FIRST_CALL", null);
    const zeroScore = rowDedupeKey(46000, "TACT1534", "CH404512", "FIRST_CALL", 0);
    expect(nullScore).not.toBe(zeroScore);
    // Two rows that both have no recorded score still collide with each
    // other, same as any other identical tuple.
    expect(rowDedupeKey(46000, "TACT1534", "CH404512", "FIRST_CALL", null)).toBe(nullScore);
  });

  it("trims incidental whitespace on string fields so a Sheet cell's stray padding doesn't defeat the match", () => {
    const clean = rowDedupeKey(46000, "TACT1534", "CH404512", "FIRST_CALL", 5);
    const padded = rowDedupeKey(46000, " TACT1534 ", " CH404512 ", " FIRST_CALL ", 5);
    expect(clean).toBe(padded);
  });
});
