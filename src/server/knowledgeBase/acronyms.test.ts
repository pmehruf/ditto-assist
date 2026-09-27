/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from "vitest";
import { resolveMatchedAcronyms, acronymPlanNameMatches, buildAcronymReferenceBlock } from "./acronyms.js";
import type { Repositories } from "../db/repositories/index.js";
import type { KbAcronymRow } from "../db/schema.js";

function acronymRow(overrides: Partial<KbAcronymRow> = {}): KbAcronymRow {
  return {
    id: 1,
    acronym: "OS",
    expansion: "Optima Secure",
    notes: null,
    domain: "Health",
    isActive: true,
    createdBy: "test",
    updatedBy: "test",
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function reposWith(rows: KbAcronymRow[]): Repositories {
  return {
    kbAcronyms: { listActive: async (domain: KbAcronymRow["domain"]) => rows.filter(r => r.isActive && r.domain === domain) },
  } as unknown as Repositories;
}

describe("resolveMatchedAcronyms", () => {
  it("returns nothing when the table is empty", async () => {
    const matches = await resolveMatchedAcronyms(reposWith([]), "What is the bonus in OS?", "Health");
    expect(matches).toHaveLength(0);
  });

  it("matches a whole-word, case-insensitive acronym in the question", async () => {
    const matches = await resolveMatchedAcronyms(reposWith([acronymRow()]), "what's the bonus in os?", "Health");
    expect(matches).toHaveLength(1);
    expect(matches[0]).toEqual({ acronym: "OS", expansion: "Optima Secure", notes: null });
  });

  it("does not match a substring occurrence — word boundaries only", async () => {
    const matches = await resolveMatchedAcronyms(reposWith([acronymRow()]), "What does this COST, and how do OSes differ?", "Health");
    expect(matches).toHaveLength(0);
  });

  it("does not match when the acronym is absent from the question", async () => {
    const matches = await resolveMatchedAcronyms(reposWith([acronymRow()]), "What is the room rent limit?", "Health");
    expect(matches).toHaveLength(0);
  });

  it("skips inactive acronyms", async () => {
    const matches = await resolveMatchedAcronyms(reposWith([acronymRow({ isActive: false })]), "What is the bonus in OS?", "Health");
    expect(matches).toHaveLength(0);
  });

  it("matches multiple distinct acronyms in one question", async () => {
    const rows = [acronymRow(), acronymRow({ id: 2, acronym: "CBB", expansion: "Cumulative Bonus Super" })];
    const matches = await resolveMatchedAcronyms(reposWith(rows), "Does OS include CBB?", "Health");
    expect(matches.map(m => m.acronym).sort()).toEqual(["CBB", "OS"]);
  });

  it("carries the notes field through when present", async () => {
    const matches = await resolveMatchedAcronyms(
      reposWith([acronymRow({ notes: "HDFC ERGO only" })]),
      "What is the bonus in OS?",
      "Health"
    );
    expect(matches[0].notes).toBe("HDFC ERGO only");
  });

  it("does not match an acronym from a different domain", async () => {
    const matches = await resolveMatchedAcronyms(reposWith([acronymRow({ domain: "Term" })]), "What is the bonus in OS?", "Health");
    expect(matches).toHaveLength(0);
  });
});

describe("acronymPlanNameMatches", () => {
  it("returns the plan name when an acronym's expansion exactly matches a roster entry, case-insensitively", () => {
    const matched = [{ acronym: "OS", expansion: "optima secure", notes: null }];
    expect(acronymPlanNameMatches(matched, ["Optima Secure", "Optima Secure Plus"])).toEqual(["Optima Secure"]);
  });

  it("returns nothing when the expansion is a general term, not a plan name", () => {
    const matched = [{ acronym: "CBB", expansion: "Cumulative Bonus Super", notes: null }];
    expect(acronymPlanNameMatches(matched, ["Optima Secure", "Optima Secure Plus"])).toEqual([]);
  });

  it("returns nothing when there are no matched acronyms or no roster", () => {
    expect(acronymPlanNameMatches([], ["Optima Secure"])).toEqual([]);
    expect(acronymPlanNameMatches([{ acronym: "OS", expansion: "Optima Secure", notes: null }], [])).toEqual([]);
  });

  it("deduplicates when two acronyms expand to the same plan", () => {
    const matched = [
      { acronym: "OS", expansion: "Optima Secure", notes: null },
      { acronym: "OPTS", expansion: "Optima Secure", notes: null },
    ];
    expect(acronymPlanNameMatches(matched, ["Optima Secure"])).toEqual(["Optima Secure"]);
  });
});

describe("buildAcronymReferenceBlock", () => {
  it("returns empty string when nothing matched — byte-identical prompt for a question with no known acronym", () => {
    expect(buildAcronymReferenceBlock([])).toBe("");
  });

  it("renders one line per matched acronym, with notes in parentheses when present", () => {
    const block = buildAcronymReferenceBlock([
      { acronym: "OS", expansion: "Optima Secure", notes: null },
      { acronym: "CBB", expansion: "Cumulative Bonus Super", notes: "HDFC ERGO only" },
    ]);
    expect(block).toContain("ACRONYM REFERENCE");
    expect(block).toContain('- "OS" = Optima Secure');
    expect(block).toContain('- "CBB" = Cumulative Bonus Super (HDFC ERGO only)');
  });
});
