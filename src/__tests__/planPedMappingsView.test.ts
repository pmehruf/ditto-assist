/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * Plan-Specific PED Mappings is its own view under Plans & Questions (next to Category Mapping), with a plan picker, instead
 * of a block inside the plan edit form. Plan-Specific Restrictions stays in the edit form. The data, routes and the
 * mapping change gate are unchanged: only where the editor is shown moved.
 */

const page = readFileSync(new URL("../../src/pages/PlanManagementPage.tsx", import.meta.url), "utf8");

describe("Plan-Specific PED Mappings view", () => {
  it("is a tab of the plan management page with its own plan picker", () => {
    expect(page).toMatch(/"ped-mappings"/);
    expect(page).toContain("Plan-Specific PED Mappings");
    expect(page).toMatch(/setPedMapPlan/);
  });

  it("renders the editor exactly once, in that view, with the picked plan's questions", () => {
    const uses = page.match(/<PlanPedOverridesEditor/g) ?? [];
    expect(uses.length).toBe(1);
    expect(page).toMatch(/planName=\{pedMapPlan\}/);
    expect(page).toMatch(/questions=\{pedMapQuestionTexts\}/);
  });

  it("keeps Plan-Specific Restrictions in the plan edit form", () => {
    const uses = page.match(/<PlanRestrictionsEditor/g) ?? [];
    expect(uses.length).toBe(1);
    expect(page).toMatch(/Restrictions are saved immediately/);
  });
});
