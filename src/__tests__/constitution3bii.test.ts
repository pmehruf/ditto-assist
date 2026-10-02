/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { STAGE_BANDS, MAX_MATCH_SHARE } from "../server/mappingAdmin";

/** Constitution v1.5 must describe the rule administration exactly as implemented. */

const constitution = readFileSync(new URL("../../MASTER_CONSTITUTION.md", import.meta.url), "utf8");

describe("Constitution v1.5 matches the implemented rule administration", () => {
  it("records the unified section, the validation rules and the v1.5 history entry", () => {
    expect(constitution).toMatch(/\*\*Version:\*\* 1\.[5-9]/);
    expect(constitution).toContain("Mapping Control — one admin section; rule and category administration");
    expect(constitution).toMatch(/v1\.5 {2}\(2026-10-02\)/);
  });

  it("the documented stage bands are the ones in code", () => {
    const text = constitution.replace(/\r/g, "");
    const documented: Record<string, string> = {
      firewall: "life-stage firewall 20–29",
      plan_rule: "plan rules 30–99",
      shield: "shields 100–199",
      wording: "exact wording 200–299",
      dictionary: "dictionary stage 300–399",
      plan_decision: "plan decision 400–499",
      family: "disease-family rules 500–999",
      generic: "generic shields 1000–1999",
      post_guard: "post-guards 10–99",
    };
    for (const [stage, phrase] of Object.entries(documented)) {
      const band = STAGE_BANDS.find((b) => b.stage === stage)!;
      expect(`${band.min}–${band.max}`, stage).toBe(phrase.slice(phrase.lastIndexOf(" ") + 1));
      expect(text, stage).toContain(phrase);
    }
  });

  it("the documented match-everything limit is the one in code", () => {
    expect(constitution).toContain(`more than ${Math.round(MAX_MATCH_SHARE * 100)}% of the dictionary`);
  });
});
