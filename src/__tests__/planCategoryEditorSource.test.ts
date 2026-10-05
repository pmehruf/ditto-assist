/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createMappingTestEnv, fixtureDump, type MappingTestEnv } from "./helpers/mappingTestDb";
import { CATEGORY_LABELS } from "../types";
import { categoryLabelsFromEntries, fillUnmappedCategories } from "../utils/categoryLabels";

/**
 * 3B-ii defect fix: Mapping Control > Plans & Questions > Category Mapping listed a compiled-in set of 34 categories
 * while the live category list had 37, so a category created in Mapping Control (e.g. Sleep Disorder) could never be
 * mapped to a plan question. The editor now uses the live category list — the same source as the rest of Mapping Control.
 */

let env: MappingTestEnv;
beforeAll(async () => {
  env = await createMappingTestEnv();
}, 60_000);

const page = readFileSync(new URL("../../src/pages/PlanManagementPage.tsx", import.meta.url), "utf8");

describe("the Category Mapping editor reads the live category list", () => {
  it("no longer relies on the compiled-in category list", () => {
    expect(page).not.toContain("CATEGORY_LABELS");
    expect(page).toContain("useLiveCategories()");
    expect(page).not.toMatch(/import\s*\{[^}]*CATEGORY_LABELS/);
  });

  it("every category shown, counted and filled comes from the live list", () => {
    expect(page).toContain("Object.entries(categoryLabels)");
    expect(page).toContain("Object.keys(categoryLabels).length");
    expect(page).toContain("Object.keys(categoryLabels)"); // passed to fillUnmappedCategories
  });

  it("every active live category is available — including Sleep Disorder and any category created later", async () => {
    await env.repos.categories.upsert({ categoryKey: "sleep", label: "Sleep Disorder", description: null, sortOrder: 990 });
    const live = categoryLabelsFromEntries(await env.repos.categories.list());
    const dbKeys = (await env.repos.categories.list()).map((c) => c.categoryKey);
    expect(Object.keys(live).sort()).toEqual([...dbKeys].sort());
    expect(live.sleep).toBe("Sleep Disorder");
    await env.repos.categories.upsert({ categoryKey: "zz_new_category", label: "ZZ New", description: null, sortOrder: 991 });
    expect(categoryLabelsFromEntries(await env.repos.categories.list()).zz_new_category).toBe("ZZ New");
    await env.repos.categories.delete("zz_new_category");
  });

  it("every category that was available before (the compiled list) is still available, with the same label", async () => {
    const live = categoryLabelsFromEntries(await env.repos.categories.list());
    const missing = Object.keys(CATEGORY_LABELS).filter((k) => !(k in live));
    expect(missing, "compiled categories absent from the live list").toEqual([]);
    for (const [k, label] of Object.entries(CATEGORY_LABELS)) expect(live[k], k).toBe(label);
    expect(Object.keys(CATEGORY_LABELS).length).toBe(34); // the old list the editor used
    expect(Object.keys(live).length).toBeGreaterThan(Object.keys(CATEGORY_LABELS).length - 1);
  });

  it("an unavailable list is empty and says so rather than silently falling back to the old list", () => {
    expect(categoryLabelsFromEntries(null)).toEqual({});
    expect(page).toContain("The category list could not be loaded");
  });
});

describe("the change does not alter any saved plan / category mapping", () => {
  it("filling unmapped categories never touches a pair that already has a mapping, for every plan", () => {
    const live = Object.keys(CATEGORY_LABELS);
    for (const row of fixtureDump.planConfigs as any[]) {
      const saved: Record<string, string> = {};
      for (const [k, v] of Object.entries(row.categoryMap ?? {})) saved[k] = typeof v === "number" ? row.questions[v]?.text ?? row.questions[v] : (v as string);
      const filled = fillUnmappedCategories(saved, row.anyOther, live);
      for (const [k, v] of Object.entries(saved)) expect(filled[k], `${row.planName}/${k}`).toBe(v);
    }
  });

  it("with the live list equal to the old list the result is identical to the old behaviour; extra live categories only add new keys", () => {
    const old = Object.keys(CATEGORY_LABELS);
    const saved = { diabetes: "Q1" };
    const same = fillUnmappedCategories(saved, "OTHER", old);
    expect(Object.keys(same).sort()).toEqual([...old].sort());
    const more = fillUnmappedCategories(saved, "OTHER", [...old, "sleep"]);
    expect(more.diabetes).toBe("Q1");
    expect(more.sleep).toBe("OTHER");
    for (const k of old) expect(more[k]).toBe(same[k]);
    expect(fillUnmappedCategories(saved, "", [...old, "sleep"])).toBe(saved); // no catch-all: unchanged, as before
  });

  it("the editor never writes: loading the list is a read of /api/ped-repository/categories only", () => {
    const util = readFileSync(new URL("../../src/utils/categoryLabels.ts", import.meta.url), "utf8");
    expect(util).toContain('fetch("/api/ped-repository/categories")');
    expect(util).not.toMatch(/method:\s*["'](POST|PUT|PATCH|DELETE)/);
  });
});

describe("every plan editor reads the live category list (Phase 6)", () => {
  for (const file of ["src/components/PlanRestrictionsEditor.tsx", "src/components/PlanPedOverridesEditor.tsx"]) {
    it(`${file} no longer uses the compiled category list`, () => {
      const src = readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");
      expect(src).not.toContain("CATEGORY_LABELS");
      expect(src).toMatch(/useCategoryLabels|useLiveCategories/);
    });
  }
});
