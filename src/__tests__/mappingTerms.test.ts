/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { CHANGE_CATEGORIES } from "../server/mappingChange";
import { CHANGE_TYPES, CHANGE_STATUS_PLAIN, OUTCOME_PLAIN, QUESTION_TAG_PLAIN, STAGE_PLAIN, changeTypeLabel } from "../utils/mappingTerms";

/**
 * Mapping Control uses plain-language names on screen while every stored / internal value stays exactly as it was:
 * the server still validates and saves the original change categories, plan question tags and step groups.
 */

const JARGON = /\b(regex|regular expression|dictionary|shield|post-?guard|primitive|regression|canonical|synonym|alias|pipeline|snapshot|json)\b/i;

describe("plain-language names for Mapping Control", () => {
  it("covers exactly the change categories the server accepts, with unchanged stored values", () => {
    expect(CHANGE_TYPES.map((c) => c.value).sort()).toEqual([...CHANGE_CATEGORIES].sort());
  });

  it("shows no implementation jargon in any label or hint an admin reads", () => {
    const text = [
      ...CHANGE_TYPES.flatMap((c) => [c.label, c.hint]),
      ...Object.values(OUTCOME_PLAIN),
      ...Object.values(CHANGE_STATUS_PLAIN),
      ...Object.values(QUESTION_TAG_PLAIN),
      ...Object.values(STAGE_PLAIN).flatMap((s) => [s.label, s.help]),
    ];
    for (const t of text) expect(t, t).not.toMatch(JARGON);
  });

  it("falls back to the stored text for anything it does not know", () => {
    expect(changeTypeLabel("Something new")).toBe("Something new");
    expect(changeTypeLabel("Regression fix")).toBe("Correct a wrong answer");
  });

  it("the review window sends the stored change category, not the friendly label", () => {
    const dialog = readFileSync(new URL("../../src/components/MappingChangeDialog.tsx", import.meta.url), "utf8");
    expect(dialog).toMatch(/value=\{c\}>\{changeTypeLabel\(c\)\}/);
    expect(dialog).toMatch(/changeCategory: category/);
  });
});
