/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { createMappingTestEnv, fixtureDump, type MappingTestEnv } from "./helpers/mappingTestDb";
import { createMappingGate, captureTables, undoAdminChange, resetUsageCache } from "../server/mappingChange";
import { getDb } from "../server/db/client";
import { createRepositories } from "../server/db/repositories";
import { planConfigs, planOverrides, planRestrictions } from "../server/db/schema";
import { bandFor, checkPosition, findRefLoop, movePosition, validateDefinition, checkRegexSafety, STAGE_BANDS } from "../server/mappingAdmin";
import { createCategory, createRule, deleteCategory, deleteRule, listCategories, moveRule, patchCategory, patchRule, traceLookup } from "../server/mappingAdminOps";
import type { RoutingRuleRow } from "../mapping/ruleTypes";

/**
 * Phase 3B-ii — routing-rule and category administration: validation of dangerous / invalid edits, the stage bands,
 * impact preview + confirmation + undo through the gate, and "the next lookup uses it" on a fresh instance.
 */

const PLAN = "Optima Secure";
let env: MappingTestEnv;
let server: Server;
let base: string;

const ctl = (extra: Record<string, unknown> = {}) => encodeURIComponent(JSON.stringify({ reason: "3B-ii admin test", changeCategory: "Regex update", businessDecision: "none", ...extra }));
async function call(method: string, path: string, opts: { body?: unknown; preview?: boolean; confirm?: string; terms?: string[]; noControl?: boolean } = {}) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (opts.preview) headers["x-mapping-preview"] = "1";
  if (!opts.preview && !opts.noControl) headers["x-mapping-change"] = ctl({ confirmHash: opts.confirm });
  if (opts.terms) headers["x-mapping-test-terms"] = encodeURIComponent(JSON.stringify(opts.terms));
  const res = await fetch(base + path, { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) });
  return { status: res.status, body: (await res.json()) as any };
}
/** preview, then apply with the previewed confirmation. */
async function applyConfirmed(method: string, path: string, body?: unknown, terms?: string[]) {
  const pv = await call(method, path, { body, preview: true, terms });
  if (pv.status !== 200) return { pv, ap: pv };
  const ap = await call(method, path, { body, confirm: pv.body.impactHash, terms });
  return { pv, ap };
}

const shieldRule = (re: string, category = "heart") => ({
  when: [{ t: "text", re, flags: "i" }],
  clauses: [{ then: { a: "route", type: "P1", chain: [category], msg: "Matched by a custom rule for {ped}." } }],
});

beforeAll(async () => {
  env = await createMappingTestEnv();
  await env.db.insert(planConfigs).values(fixtureDump.planConfigs.map((p: any) => ({ planName: p.planName, insurerName: p.insurerName, questions: p.questions, categoryMap: p.categoryMap, anyOther: p.anyOther, hasUmbrella: p.hasUmbrella, umbrellaQuestions: p.umbrellaQuestions, overrides: p.overrides, removed: p.removed, addedBy: "fixture" })));
  if (fixtureDump.planRestrictions.length) await env.db.insert(planRestrictions).values(fixtureDump.planRestrictions.map((r: any) => ({ planName: r.planName, categoryKey: r.categoryKey, mode: r.mode, keywords: r.keywords, explanation: r.explanation, isActive: r.isActive, createdBy: "fixture", updatedBy: "fixture" })) as any);
  if (fixtureDump.planOverrides.length) await env.db.insert(planOverrides).values(fixtureDump.planOverrides.map((o: any) => ({ planName: o.planName, pedId: o.pedId, categoryKey: o.categoryKey, targetQuestion: o.targetQuestion, reason: o.reason, addedBy: "fixture" })) as any);

  const gate = createMappingGate({ enabled: () => true, rootDb: () => env.db as never, engineVersion: "test-ev", performer: async () => "Tester (Admin)" });
  const wrap = (run: (repos: ReturnType<typeof createRepositories>, req: any) => Promise<{ status: number; body: Record<string, unknown> }>) => async (req: any, res: any) => {
    const repos = createRepositories(getDb());
    const op = await run(repos, req);
    if (op.status < 400) await repos.mappingState.bump();
    res.status(op.status).json(op.body);
  };
  const app = express();
  app.use(express.json());
  app.post("/rules", gate("Added a routing rule"), wrap((r, q) => createRule(r, q.body)));
  app.patch("/rules/:k", gate("Edited a routing rule"), wrap((r, q) => patchRule(r, q.params.k, q.body)));
  app.post("/rules/:k/move", gate("Reordered a routing rule"), wrap((r, q) => moveRule(r, q.params.k, q.body?.direction)));
  app.delete("/rules/:k", gate("Deleted a routing rule"), wrap((r, q) => deleteRule(r, q.params.k)));
  app.post("/cats", gate("Added a category"), wrap((r, q) => createCategory(r, q.body)));
  app.patch("/cats/:k", gate("Edited a category"), wrap((r, q) => patchCategory(r, q.params.k, q.body)));
  app.delete("/cats/:k", gate("Deleted a category"), wrap((r, q) => deleteCategory(getDb(), r, q.params.k)));
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  resetUsageCache();
}, 120_000);

afterAll(async () => {
  if (server) await new Promise((r) => server.close(r));
});

const ruleCtx = async () => {
  const repos = env.repos;
  return {
    categories: new Set((await repos.categories.list()).map((c) => c.categoryKey)),
    plans: new Set(fixtureDump.planConfigs.map((p: any) => p.planName as string)),
    rules: new Map((await repos.routingRules.listAll()).map((r) => [r.ruleKey, r] as const)),
  };
};

describe("validation refuses invalid and dangerous rule edits", () => {
  it("rejects unknown shapes, categories, plans, result types and placeholders", async () => {
    const ctx = await ruleCtx();
    const bad = (def: unknown, stage: any = "shield") => validateDefinition(def, stage, ctx).errors;
    expect(bad(null)).not.toHaveLength(0);
    expect(bad({ clauses: [] })).not.toHaveLength(0);
    expect(bad({ clauses: [{ then: { a: "explode" } }] })[0]).toMatch(/unknown action/);
    expect(bad({ when: [{ t: "bogus" }], clauses: [{ then: { a: "setCategory", to: "heart" } }] })[0]).toMatch(/unknown condition/);
    expect(bad({ clauses: [{ then: { a: "route", type: "P1", chain: ["no_such_category"], msg: "x" } }] })[0]).toMatch(/unknown category/);
    expect(bad({ when: [{ t: "plan", is: "Nope Plan" }], clauses: [{ then: { a: "setCategory", to: "heart" } }] })[0]).toMatch(/unknown plan/);
    expect(bad({ clauses: [{ then: { a: "route", type: "P2", chain: ["heart"], msg: "x" } }] })[0]).toMatch(/result type/);
    expect(bad({ clauses: [{ then: { a: "route", type: "P1", chain: ["heart"], msg: "hello {nope}" } }] })[0]).toMatch(/placeholder/);
    expect(bad({ clauses: [{ then: { a: "rewrite", type: "P1", chain: ["heart"] } }] })[0]).toMatch(/post-guards/);
    expect(bad({ when: [{ t: "matchedQ", re: "x" }], clauses: [{ then: { a: "setCategory", to: "heart" } }] })[0]).toMatch(/post-guards/);
    expect(bad({ when: [{ t: "text", re: "(", flags: "" }], clauses: [{ then: { a: "setCategory", to: "heart" } }] })[0]).toMatch(/invalid pattern/);
    expect(bad({ when: [{ t: "text", re: "a", flags: "g" }], clauses: [{ then: { a: "setCategory", to: "heart" } }] })[0]).toMatch(/flags/);
    expect(bad({ params: { x: 1 }, clauses: [{ then: { a: "setCategory", to: "heart" } }] })[0]).toMatch(/parameters/);
    expect(bad(shieldRule("\\bgout\\b"))).toEqual([]);
  });

  it("refuses patterns that match everything or are catastrophically slow, and trusts unchanged built-in text", async () => {
    const aliasKeys = (await env.repos.pedAliases.listAll()).map((a) => a.normalizedAlias);
    const probe = async (re: string) => checkRegexSafety([{ re, flags: "i", where: "test" }], aliasKeys, new Set());
    expect((await probe(".*"))[0]).toMatch(/empty|every/);
    expect((await probe("a*"))[0]).toMatch(/empty|every/);
    expect((await probe("[a-z ]"))[0]).toMatch(/too broad/);
    expect((await probe("^(a+)+$"))[0]).toMatch(/too slow|too complex|repeats/);
    expect((await probe("(x+x+)+y"))[0]).toMatch(/too slow|too complex|repeats/);
    expect(await probe("\\bgout\\b")).toEqual([]);
    // text the admin did not touch is not re-probed
    expect(await checkRegexSafety([{ re: ".*", flags: "i", where: "t" }], aliasKeys, new Set([".*\u0000i"]))).toEqual([]);
  }, 30_000);

  it("refuses rules that refer to themselves (loops)", async () => {
    const ctx = await ruleCtx();
    const mk = (key: string, to: string): RoutingRuleRow => ({ ruleKey: key, kind: "rule", stage: "shield", primitive: null, position: 150, planScope: null, enabled: true, description: "", definition: { clauses: [{ then: { a: "ref", rule: to } }] } });
    ctx.rules.set("custom.a", mk("custom.a", "custom.b"));
    ctx.rules.set("custom.b", mk("custom.b", "custom.c"));
    ctx.rules.set("custom.c", mk("custom.c", "custom.a"));
    expect(findRefLoop("custom.a", ["custom.b"], ctx.rules)).toMatch(/loop/);
    expect(findRefLoop("custom.z", ["custom.a"], ctx.rules)).toBeNull(); // a->b->c->a loops, but never reaches z
  });

  it("keeps rules inside their stage band and refuses clashing positions", async () => {
    const rules = await env.repos.routingRules.listAll();
    const shield = rules.find((r) => r.stage === "shield" && r.kind === "rule")!;
    expect(checkPosition(rules, { ruleKey: "custom.x", stage: "shield" }, 150)).toBeNull();
    expect(checkPosition(rules, { ruleKey: "custom.x", stage: "shield" }, 50)).toMatch(/band/);
    expect(checkPosition(rules, { ruleKey: "custom.x", stage: "shield" }, 1500)).toMatch(/band/);
    expect(checkPosition(rules, { ruleKey: "custom.x", stage: "shield" }, shield.position)).toMatch(/already used/);
    expect(checkPosition(rules, { ruleKey: "custom.x", stage: "shield" }, 150.5)).toMatch(/whole number/);
    expect(bandFor("dictionary")!.allowsNew).toBe(false);
    expect(STAGE_BANDS.filter((b) => b.group === "main").every((b, i, all) => i === 0 || b.min > all[i - 1].max)).toBe(true);
  });

  it("every seeded rule sits inside its own stage band (the bands describe the real pipeline)", async () => {
    const rules = await env.repos.routingRules.listAll();
    for (const r of rules) {
      const band = bandFor(r.stage)!;
      expect(r.position, r.ruleKey).toBeGreaterThanOrEqual(band.min);
      expect(r.position, r.ruleKey).toBeLessThanOrEqual(band.max);
    }
  });
});

describe("built-in pipeline steps and built-in rules are protected", () => {
  it("a primitive step cannot be edited, disabled, moved or deleted; built-in rules cannot be deleted or change stage", async () => {
    const prim = (await env.repos.routingRules.listAll()).find((r) => r.kind === "primitive")!;
    expect((await patchRule(env.repos, prim.ruleKey, { enabled: false })).status).toBe(400);
    expect((await moveRule(env.repos, prim.ruleKey, "up")).status).toBe(400);
    expect((await deleteRule(env.repos, prim.ruleKey)).status).toBe(400);
    const builtIn = (await env.repos.routingRules.listAll()).find((r) => r.kind === "rule" && r.stage === "shield")!;
    expect((await deleteRule(env.repos, builtIn.ruleKey)).status).toBe(400);
    const stageChange = await patchRule(env.repos, builtIn.ruleKey, { stage: "generic" } as any);
    expect((await env.repos.routingRules.getByKey(builtIn.ruleKey))!.stage).toBe("shield");
    expect([200, 400]).toContain(stageChange.status);
    expect((await createRule(env.repos, { suffix: "x1", stage: "dictionary", position: 350, description: "d", definition: shieldRule("\\bx\\b") })).status).toBe(400);
    expect((await createRule(env.repos, { suffix: "x1", stage: "plan_decision", position: 450, description: "d", definition: shieldRule("\\bx\\b") })).status).toBe(400);
  });

  it("move refuses to jump a built-in algorithm step", async () => {
    const rules = await env.repos.routingRules.listAll();
    const family = rules.filter((r) => r.stage === "family").sort((a, b) => a.position - b.position);
    const idx = family.findIndex((r, i) => r.kind === "rule" && family[i + 1]?.kind === "primitive");
    if (idx >= 0) expect(movePosition(rules, family[idx].ruleKey, "down").error).toMatch(/algorithm step/);
  });
});

describe("rule administration through the impact gate", () => {
  const SUFFIX = "zzfoo_test";
  const TERM = "zzfoo condition";
  const KEY = `custom.${SUFFIX}`;
  let created = 0;

  it("a new rule previews on admin-supplied test terms, needs the change-control fields, and applies", async () => {
    const body = { suffix: SUFFIX, stage: "shield", position: 150, description: "Test shield for zzfoo", definition: shieldRule("\\bzzfoo\\b") };
    const pv = await call("POST", "/rules", { body, preview: true, terms: [TERM] });
    expect(pv.status).toBe(200);
    expect(pv.body.impact.metrics.pairsChanged).toBeGreaterThan(0);
    expect(pv.body.impact.metrics.transitions["UNRESOLVED→P1"]).toBeGreaterThan(0);
    expect(await env.repos.routingRules.getByKey(KEY)).toBeUndefined(); // preview wrote nothing
    const noCtl = await call("POST", "/rules", { body, terms: [TERM], noControl: true });
    expect(noCtl.status).toBe(400);
    expect(noCtl.body.code).toBe("change_control_required");
    const ap = await call("POST", "/rules", { body, terms: [TERM], confirm: pv.body.impactHash });
    expect(ap.status).toBe(200);
    created = ap.body.mappingChange.id;
    expect((await env.repos.routingRules.getByKey(KEY))?.enabled).toBe(true);
  }, 180_000);

  it("the very next lookup — on a fresh instance, no restart — is decided by the new rule, and the trace names it", async () => {
    const instance = env.newInstance();
    const live = await instance.lookup(TERM, PLAN);
    expect(live.decidedBy).toBe(KEY);
    expect(live.matchType).toBe("P1");
    const repos = env.repos;
    const config = env.plans.get(PLAN)!;
    const { loadMappingSnapshot } = await import("../server/mappingSnapshot");
    const snapshot = await loadMappingSnapshot(repos, await repos.mappingState.getVersion());
    const t = await traceLookup(repos, { term: TERM, planName: PLAN, config, snapshot, engineVersion: "test-ev" });
    expect((t.body as any).rule).toMatchObject({ ruleKey: KEY, stage: "shield", builtIn: false });
    expect((t.body as any).resolved).toBe(true);
  });

  it("disable / reorder / edit act on the next lookup; invalid edits change nothing", async () => {
    const instance = env.newInstance();
    const off = await applyConfirmed("PATCH", `/rules/${KEY}`, { enabled: false }, [TERM]);
    expect(off.ap.status).toBe(200);
    expect((await instance.lookup(TERM, PLAN)).decidedBy).not.toBe(KEY);
    const on = await applyConfirmed("PATCH", `/rules/${KEY}`, { enabled: true }, [TERM]);
    expect(on.ap.status).toBe(200);
    expect((await instance.lookup(TERM, PLAN)).decidedBy).toBe(KEY);

    const before = JSON.stringify([...(await captureTables(env.db as never)).get("routing_rules")!]);
    for (const bad of [
      { definition: shieldRule(".*") },
      { definition: shieldRule("^(a+)+$") },
      { definition: shieldRule("\\bzzfoo\\b", "no_such_category") },
      { position: 5 },
      { position: 100 },
    ]) {
      const r = await call("PATCH", `/rules/${KEY}`, { body: bad, preview: true });
      expect(r.status, JSON.stringify(bad).slice(0, 60)).toBe(400);
    }
    expect(JSON.stringify([...(await captureTables(env.db as never)).get("routing_rules")!])).toBe(before);
  }, 240_000);

  it("order decides which rule wins: moving a rule changes the next lookup, and a refused move changes nothing", async () => {
    const second = { suffix: "zzfoo_second", stage: "shield", position: 151, description: "Second rule", definition: { when: [{ t: "text", re: "\\bzzfoo\\b", flags: "i" }], clauses: [{ then: { a: "route", type: "P1", chain: ["kidney"], msg: "second" } }] } };
    const r = await applyConfirmed("POST", "/rules", second, [TERM]);
    expect(r.ap.status).toBe(200);
    const instance = env.newInstance();
    expect((await instance.lookup(TERM, PLAN)).decidedBy).toBe(KEY); // 150 before 151
    const mv = await applyConfirmed("POST", `/rules/${KEY}/move`, { direction: "down" }, [TERM]);
    expect(mv.ap.status).toBe(200);
    expect((await instance.lookup(TERM, PLAN)).decidedBy).toBe("custom.zzfoo_second");
    expect((await call("POST", `/rules/${KEY}/move`, { body: { direction: "sideways" }, preview: true })).status).toBe(400);
  }, 240_000);

  it("undo restores the exact rule table; delete only for custom rules and not while referenced", async () => {
    const tablesNow = await captureTables(env.db as never);
    // delete custom rules (second first) through the gate, then undo the deletion of the second
    const delSecond = await applyConfirmed("DELETE", "/rules/custom.zzfoo_second", undefined, [TERM]);
    expect(delSecond.ap.status).toBe(200);
    expect(await env.repos.routingRules.getByKey("custom.zzfoo_second")).toBeUndefined();
    const undo = await undoAdminChange(env.db as never, delSecond.ap.body.mappingChange.id, "Tester (Admin)");
    expect(undo.reverted).toBe(true);
    const after = await captureTables(env.db as never);
    const sorted = (m: Map<string, unknown>) => JSON.stringify([...m].sort(([a], [b]) => (a < b ? -1 : 1)));
    expect(sorted(after.get("routing_rules")!)).toBe(sorted(tablesNow.get("routing_rules")!));
    // cleanup: remove both test rules, and the pipeline is back to the seeded rules
    expect((await applyConfirmed("DELETE", "/rules/custom.zzfoo_second", undefined, [TERM])).ap.status).toBe(200);
    expect((await applyConfirmed("DELETE", `/rules/${KEY}`, undefined, [TERM])).ap.status).toBe(200);
    const fresh = env.newInstance();
    expect((await fresh.lookup(TERM, PLAN)).decidedBy).not.toMatch(/^custom\./);
    expect(created).toBeGreaterThan(0);
  }, 300_000);

  it("disabling a built-in rule is previewed as an impact and undone exactly", async () => {
    const builtIn = (await env.repos.routingRules.listAll()).find((r) => r.kind === "rule" && r.stage === "shield")!;
    const before = JSON.stringify([...(await captureTables(env.db as never)).get("routing_rules")!].sort(([a], [b]) => (a < b ? -1 : 1)));
    const r = await applyConfirmed("PATCH", `/rules/${builtIn.ruleKey}`, { enabled: false });
    expect(r.pv.status).toBe(200);
    expect(r.ap.status).toBe(200);
    const undo = await undoAdminChange(env.db as never, r.ap.body.mappingChange.id, "Tester (Admin)");
    expect(undo.reverted).toBe(true);
    expect(JSON.stringify([...(await captureTables(env.db as never)).get("routing_rules")!].sort(([a], [b]) => (a < b ? -1 : 1)))).toBe(before);
  }, 240_000);
});

describe("category administration", () => {
  it("creates, renames, and deletes an unused category; refuses invalid keys, duplicates and used categories", async () => {
    expect((await call("POST", "/cats", { body: { categoryKey: "Bad Key", label: "x" }, preview: true })).status).toBe(400);
    expect((await call("POST", "/cats", { body: { categoryKey: "heart", label: "Dup" }, preview: true })).status).toBe(409);
    const add = await applyConfirmed("POST", "/cats", { categoryKey: "zz_test_cat", label: "ZZ Test" });
    expect(add.ap.status).toBe(200);
    expect((await env.repos.categories.get("zz_test_cat"))?.label).toBe("ZZ Test");
    const rename = await applyConfirmed("PATCH", "/cats/zz_test_cat", { label: "ZZ Renamed" });
    expect(rename.ap.status).toBe(200);
    const { loadMappingSnapshot } = await import("../server/mappingSnapshot");
    const snap = await loadMappingSnapshot(env.repos, await env.repos.mappingState.getVersion());
    expect(snap.categoryLabels.get("zz_test_cat")).toBe("ZZ Renamed");

    const used = await call("DELETE", "/cats/heart", { body: undefined, preview: true });
    expect(used.status).toBe(409);
    expect(used.body.usage.total).toBeGreaterThan(0);
    const listed = (await listCategories(env.db as never, env.repos)).body as any;
    expect(listed.categories.find((c: any) => c.categoryKey === "heart").usage.peds).toBeGreaterThan(0);

    const del = await applyConfirmed("DELETE", "/cats/zz_test_cat");
    expect(del.ap.status).toBe(200);
    expect(await env.repos.categories.get("zz_test_cat")).toBeUndefined();
    // undo of the delete brings it back exactly
    const undo = await undoAdminChange(env.db as never, del.ap.body.mappingChange.id, "Tester (Admin)");
    expect(undo.reverted).toBe(true);
    expect((await env.repos.categories.get("zz_test_cat"))?.label).toBe("ZZ Renamed");
    expect((await applyConfirmed("DELETE", "/cats/zz_test_cat")).ap.status).toBe(200);
  }, 300_000);

  it("a category used by a rule cannot be deleted", async () => {
    const add = await applyConfirmed("POST", "/cats", { categoryKey: "zz_rule_cat", label: "ZZ Rule" });
    expect(add.ap.status).toBe(200);
    const rule = await applyConfirmed("POST", "/rules", { suffix: "zz_cat_user", stage: "shield", position: 152, description: "uses zz_rule_cat", definition: shieldRule("\\bzzbar\\b", "zz_rule_cat") }, ["zzbar thing"]);
    expect(rule.ap.status).toBe(200);
    const blocked = await call("DELETE", "/cats/zz_rule_cat", { preview: true });
    expect(blocked.status).toBe(409);
    expect(blocked.body.usage.rules).toBe(1);
    expect((await applyConfirmed("DELETE", "/rules/custom.zz_cat_user", undefined, ["zzbar thing"])).ap.status).toBe(200);
    expect((await applyConfirmed("DELETE", "/cats/zz_rule_cat")).ap.status).toBe(200);
  }, 300_000);
});
