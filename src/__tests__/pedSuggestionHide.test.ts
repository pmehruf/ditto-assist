/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createMappingTestEnv, fixtureDump, type MappingTestEnv } from "./helpers/mappingTestDb";
import { loadPlanTables } from "./helpers/planTables";
import { pedAliases, pedRepository } from "../server/db/schema";
import { applyHide, captureAnswers, checkPlan, makeBackup, rollbackHide, type HideItem, type HidePlan } from "../server/pedSuggestionHide";

/**
 * Rehearsal of the Declaration Assist suggestion cleanup on the production-shaped test data: the only change is is_visible = false
 * for the listed names; every answer on every plan is unchanged; the suggestion list loses exactly those names; rollback restores them.
 */

let env: MappingTestEnv;
let plan: HidePlan;
beforeAll(async () => {
  env = await createMappingTestEnv();
  await loadPlanTables(env, fixtureDump);
  const peds = await env.db.select().from(pedRepository);
  const all = await env.db.select().from(pedAliases);
  const items: HideItem[] = [];
  // Extra visible names on a condition (the main name stays visible).
  for (const p of peds) {
    const vis = all.filter((a) => a.pedId === p.id && a.isVisible);
    const keeper = vis.find((a) => a.isPrimary);
    if (vis.length < 2 || !keeper || items.length >= 25) continue;
    const extra = vis.find((a) => a.id !== keeper.id)!;
    items.push({ id: extra.id, text: extra.aliasText, normalized: extra.normalizedAlias, group: "A", pedId: p.id, category: null, keeperId: keeper.id, keeperText: keeper.aliasText });
  }
  // Names that belong to a non-medical category, and names whose condition no longer exists.
  for (const p of peds.filter((x) => x.categoryKey === "lifestyle" || x.categoryKey === "natural_life_stage").slice(0, 6)) {
    for (const a of all.filter((x) => x.pedId === p.id && x.isVisible)) items.push({ id: a.id, text: a.aliasText, normalized: a.normalizedAlias, group: "NON_MEDICAL", pedId: p.id, category: p.categoryKey, keeperId: null, keeperText: null });
  }
  for (const [i, text] of ["cigarette test", "beer test", "regular medication test"].entries()) {
    const [row] = await env.db.insert(pedAliases).values({ pedId: 9_000_000 + i, aliasText: text, normalizedAlias: text, isPrimary: true, isVisible: true, addedBy: "test" }).returning();
    items.push({ id: row.id, text, normalized: text, group: "NON_MEDICAL", pedId: null, category: null, keeperId: null, keeperText: null });
  }
  const visibleNow = (await env.db.select().from(pedAliases)).filter((a) => a.isVisible).length;
  plan = { version: 1, madeFrom: { environment: "test", capturedAt: "now" }, expectedVisibleBefore: visibleNow, expectedVisibleAfter: visibleNow - items.length, items };
}, 120_000);

const allTexts = async () => [...new Set((await env.db.select().from(pedAliases)).map((a) => a.aliasText))];

describe("hiding the approved suggestion names", () => {
  it("dry run reports exactly what would change and changes nothing", async () => {
    const before = (await env.db.select().from(pedAliases)).filter((a) => a.isVisible).length;
    const check = await checkPlan(env.db, plan);
    expect(check.problems).toEqual([]);
    expect(check.toHide.length).toBe(plan.items.length);
    expect(check.visibleNow).toBe(plan.expectedVisibleBefore);
    expect(check.expectedVisibleAfter).toBe(plan.expectedVisibleAfter);
    expect((await env.db.select().from(pedAliases)).filter((a) => a.isVisible).length).toBe(before);
  });

  it("stops on a mismatch instead of guessing", async () => {
    const item = plan.items.find((i) => i.group === "A")!;
    const tampered: HidePlan = { ...plan, items: plan.items.map((i) => (i === item ? { ...i, text: "something else" } : i)) };
    expect((await checkPlan(env.db, tampered)).problems.map((p) => p.item.id)).toContain(item.id);
    const lostKeeper: HidePlan = { ...plan, items: plan.items.map((i) => (i === item ? { ...i, keeperId: 99_999_999 } : i)) };
    expect((await checkPlan(env.db, lostKeeper)).problems.length).toBe(1);
  });

  it("hides exactly the listed names, changes no answer on any plan, and only flips is_visible", async () => {
    const texts = await allTexts();
    const answersBefore = await captureAnswers(env.db, texts);
    expect(Object.keys(answersBefore).length).toBeGreaterThan(texts.length * 5); // every name on every plan was really computed
    const rowsBefore = await env.db.select().from(pedAliases);
    const pedsBefore = JSON.stringify((await env.db.select().from(pedRepository)).sort((a, b) => a.id - b.id));
    const check = await checkPlan(env.db, plan);
    const backup = await makeBackup(env.db, check.toHide);
    const versionBefore = await env.repos.mappingState.getVersion();

    const result = await applyHide(env.db, check.toHide);
    expect(result.hidden).toBe(plan.items.length);
    expect(result.visibleAfter).toBe(plan.expectedVisibleAfter);
    expect(await env.repos.mappingState.getVersion()).toBeGreaterThan(versionBefore);

    // Every answer on every plan, for every name, is identical.
    expect(await captureAnswers(env.db, texts)).toEqual(answersBefore);
    // Nothing but is_visible changed on any name, and the conditions are untouched.
    const rowsAfter = await env.db.select().from(pedAliases);
    const strip = (r: Record<string, unknown>) => { const { isVisible: _v, ...rest } = r; return rest; };
    const changedColumns = new Set<string>();
    for (const r of rowsAfter) { const b = rowsBefore.find((x) => x.id === r.id)!; for (const k of Object.keys(r) as Array<keyof typeof r>) if (JSON.stringify(r[k]) !== JSON.stringify(b[k])) changedColumns.add(String(k)); }
    expect([...changedColumns]).toEqual(["isVisible"]);
    const byId = (a: { id: number }, b: { id: number }) => a.id - b.id;
    expect([...rowsAfter].sort(byId).map(strip)).toEqual([...rowsBefore].sort(byId).map(strip));
    expect(JSON.stringify((await env.db.select().from(pedRepository)).sort((a, b) => a.id - b.id))).toBe(pedsBefore);
    // The suggestion list (visible names) lost exactly the listed names.
    const hidden = new Set(plan.items.map((i) => i.id));
    for (const r of rowsAfter) expect(r.isVisible, r.aliasText).toBe(hidden.has(r.id) ? false : rowsBefore.find((x) => x.id === r.id)!.isVisible);
    expect(backup.rows.length).toBe(plan.items.length);

    // A second dry run now reports them as already hidden.
    expect((await checkPlan(env.db, plan)).alreadyHidden.length).toBe(plan.items.length);

    // Rollback puts back exactly those names.
    const back = await rollbackHide(env.db, backup);
    expect(back.visibleAfter).toBe(plan.expectedVisibleBefore);
    expect(await captureAnswers(env.db, texts)).toEqual(answersBefore);
    const restored = await env.db.select().from(pedAliases).where(eq(pedAliases.isVisible, true));
    expect(restored.length).toBe(plan.expectedVisibleBefore);
  }, 300_000);

  it("rolls the whole change back if the transaction fails part-way", async () => {
    const bad = [...plan.items.slice(0, 3), { ...plan.items[3], id: 88_888_888 }];
    const visibleBefore = (await env.db.select().from(pedAliases)).filter((a) => a.isVisible).length;
    await expect(applyHide(env.db, bad)).rejects.toThrow(/rolled back/);
    expect((await env.db.select().from(pedAliases)).filter((a) => a.isVisible).length).toBe(visibleBefore);
  });
});
