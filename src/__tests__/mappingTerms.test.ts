/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { CHANGE_CATEGORIES } from "../server/mappingChange";
import { CHANGE_TYPES, CHANGE_STATUS_PLAIN, OUTCOME_PLAIN, QUESTION_TAG_PLAIN, STAGE_PLAIN, changeTypeLabel } from "../utils/mappingTerms";
import { parseChangeControl } from "../server/mappingChange";

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

describe("round two: restored names, result labels and no approval question", () => {
  const dialog = readFileSync(new URL("../../src/components/MappingChangeDialog.tsx", import.meta.url), "utf8");
  const plans = readFileSync(new URL("../../src/pages/PlanManagementPage.tsx", import.meta.url), "utf8");
  const control = readFileSync(new URL("../../src/pages/MappingControlPage.tsx", import.meta.url), "utf8");

  it("names the plan page, question tags and suggest button the way they were", () => {
    expect(plans).toContain("<span>DA Mapping Config</span>");
    expect(QUESTION_TAG_PLAIN).toEqual({ Specific: "Specific", Umbrella: "Umbrella", "Catch-all": "Others" });
    expect(plans).not.toMatch(/Suggest mapping/);
  });

  it("uses Direct match / Category match / Fallback / AI generated for results", () => {
    expect(OUTCOME_PLAIN).toMatchObject({ P0: "Direct match", P1: "Category match", P3: "Fallback", UNRESOLVED: "AI generated" });
  });

  it("has PED Library and AI Mapping Review as the first two top tabs", () => {
    expect(control).toContain('label: "PED Library"');
    expect(control).toContain('label: "AI Mapping Review"');
    expect(control.indexOf('label: "PED Library"')).toBeLessThan(control.indexOf('label: "AI Mapping Review"'));
    expect(control.indexOf('label: "AI Mapping Review"')).toBeLessThan(control.indexOf('label: "Plans & Questions"'));
    for (const old of ["Conditions & AI Review", "Condition List", "AI Suggestions to Review", "PedSuggestionsPage"]) expect(control).not.toContain(old);
  });

  it("no longer asks for an owner approval; a change saves with just a reason and a kind of change", () => {
    expect(dialog).not.toMatch(/approval|businessDecision|approver/i);
    const raw = encodeURIComponent(JSON.stringify({ reason: "Fixing a wrong answer", changeCategory: "Regression fix" }));
    const parsed = parseChangeControl(raw);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.value.businessDecision).toBe("none");
  });

  it("ignores an approval value if an older client still sends one", () => {
    const raw = encodeURIComponent(JSON.stringify({ reason: "Fixing a wrong answer", changeCategory: "Regression fix", businessDecision: "approved: Someone" }));
    const parsed = parseChangeControl(raw);
    expect(parsed.ok && parsed.value.businessDecision).toBe("none");
  });
});
