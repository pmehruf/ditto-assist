/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from "vitest";
import { dedupeAndDetectConflicts } from "./faqIngest.js";

function row(overrides: Partial<{ category: "health_product" | "operations_health"; question: string; answer: string; sourceRowNumber: number }> = {}) {
  return {
    category: "health_product" as const,
    question: "Can we do mid-term inclusion through Ditto?",
    answer: "No, Ditto does not currently facilitate mid-term inclusion.",
    sourceRowNumber: 2,
    ...overrides,
  };
}

describe("dedupeAndDetectConflicts", () => {
  it("keeps a single unique question as one answerable record", () => {
    const result = dedupeAndDetectConflicts([row()]);
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].isAnswerable).toBe(true);
    expect(result.entries[0].hasConflict).toBe(false);
    expect(result.answerable).toBe(1);
    expect(result.incomplete).toBe(0);
    expect(result.conflicting).toBe(0);
  });

  it("marks a blank-answer row as incomplete, never answerable", () => {
    const result = dedupeAndDetectConflicts([row({ answer: "" })]);
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].isAnswerable).toBe(false);
    expect(result.entries[0].hasConflict).toBe(false);
    expect(result.incomplete).toBe(1);
    expect(result.answerable).toBe(0);
  });

  it("marks a whitespace-only answer as incomplete", () => {
    const result = dedupeAndDetectConflicts([row({ answer: "   " })]);
    expect(result.entries[0].isAnswerable).toBe(false);
  });

  it("collapses duplicate questions with materially identical answers into one canonical record", () => {
    const rows = [
      row({ sourceRowNumber: 2, answer: "No, Ditto does not facilitate this." }),
      row({ sourceRowNumber: 15, answer: "No,  Ditto does not facilitate this.  " }), // whitespace-only diff
    ];
    const result = dedupeAndDetectConflicts(rows);
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].hasConflict).toBe(false);
    expect(result.entries[0].isAnswerable).toBe(true);
    expect(result.entries[0].sourceRowNumber).toBe(2); // first occurrence wins as canonical
    expect(result.duplicatesCollapsed).toBe(1);
  });

  it("preserves the canonical record's exact original wording (never rewrites/merges)", () => {
    const rows = [row({ answer: "Original wording, exactly as written." }), row({ sourceRowNumber: 9, answer: "Original wording, exactly as written." })];
    const result = dedupeAndDetectConflicts(rows);
    expect(result.entries[0].answer).toBe("Original wording, exactly as written.");
  });

  it("flags a genuine duplicate-question conflict (different answers) and does NOT silently pick one", () => {
    const rows = [
      row({ sourceRowNumber: 2, answer: "Yes, Ditto facilitates this." }),
      row({ sourceRowNumber: 40, answer: "No, Ditto does not facilitate this." }),
    ];
    const result = dedupeAndDetectConflicts(rows);
    expect(result.entries).toHaveLength(2); // both kept, neither dropped
    expect(result.entries.every(e => e.hasConflict)).toBe(true);
    expect(result.entries.every(e => e.isAnswerable === false)).toBe(true);
    expect(result.entries[0].conflictGroupKey).toBe(result.entries[1].conflictGroupKey);
    expect(result.conflicting).toBe(2);
    expect(result.answerable).toBe(0);
  });

  it("flags a conflict between a real answer and a blank duplicate (conservative — never silently prefers the non-blank one)", () => {
    const rows = [row({ sourceRowNumber: 2, answer: "Yes, this is possible." }), row({ sourceRowNumber: 3, answer: "" })];
    const result = dedupeAndDetectConflicts(rows);
    expect(result.entries).toHaveLength(2);
    expect(result.entries.every(e => e.hasConflict)).toBe(true);
    expect(result.entries.every(e => e.isAnswerable === false)).toBe(true);
  });

  it("keeps duplicate detection scoped per category — same question text in different categories does not collide", () => {
    const rows = [
      row({ category: "health_product", answer: "Health answer." }),
      row({ category: "operations_health", answer: "Ops answer." }),
    ];
    const result = dedupeAndDetectConflicts(rows);
    expect(result.entries).toHaveLength(2);
    expect(result.entries.every(e => e.hasConflict)).toBe(false);
  });

  it("treats question matching case/whitespace-insensitively for duplicate detection", () => {
    const rows = [row({ question: "Can we do mid-term inclusion through Ditto?" }), row({ question: "can we do   mid-term inclusion through ditto?  " })];
    const result = dedupeAndDetectConflicts(rows);
    expect(result.entries).toHaveLength(1); // identical answers -> collapsed, not flagged
  });

  it("returns an empty result for no rows", () => {
    const result = dedupeAndDetectConflicts([]);
    expect(result.entries).toHaveLength(0);
    expect(result.totalParsed).toBe(0);
  });

  it("every entry starts with resourceId 0 and questionEmbedding null (filled in by the caller)", () => {
    const result = dedupeAndDetectConflicts([row()]);
    expect(result.entries[0].resourceId).toBe(0);
    expect(result.entries[0].questionEmbedding).toBeNull();
  });
});
