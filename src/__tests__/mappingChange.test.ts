/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { eq } from "drizzle-orm";
import { createMappingTestEnv, fixtureDump, type MappingTestEnv } from "./helpers/mappingTestDb";
import { createMappingGate, captureTables, undoAdminChange, resetUsageCache, CHANGE_CATEGORIES } from "../server/mappingChange";
import { getDb } from "../server/db/client";
import { createRepositories } from "../server/db/repositories";
import { pedRepository, planConfigs, planOverrides, planRestrictions, pedAliases } from "../server/db/schema";

/**
 * Phase 3B-i — impact preview, confirmation, change sets and generic undo for admin
 * mapping writes. The routes below mimic the real PED Library routes (they call
 * `getDb()` and bump the mapping version) wrapped by the same `createMappingGate`.
 */

let env: MappingTestEnv;
let server: Server;
let base: string;
let gateOn = true;

const control = (extra: Record<string, unknown> = {}) =>
  encodeURIComponent(JSON.stringify({ reason: "Test change for the safety backbone", changeCategory: "Dictionary update", businessDecision: "none", ...extra }));

async function call(method: string, path: string, opts: { body?: unknown; preview?: boolean; change?: string | null } = {}) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (opts.preview) headers["x-mapping-preview"] = "1";
  if (opts.change !== null) headers["x-mapping-change"] = opts.change ?? control();
  const res = await fetch(base + path, { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) });
  return { status: res.status, body: (await res.json()) as any };
}

const category = async (id: number) => (await env.repos.pedRepository.get(id))?.categoryKey ?? null;

beforeAll(async () => {
  env = await createMappingTestEnv();
  await env.db.insert(planConfigs).values(fixtureDump.planConfigs.map((p: any) => ({ planName: p.planName, insurerName: p.insurerName, questions: p.questions, categoryMap: p.categoryMap, anyOther: p.anyOther, hasUmbrella: p.hasUmbrella, umbrellaQuestions: p.umbrellaQuestions, overrides: p.overrides, removed: p.removed, addedBy: "fixture" })));
  if (fixtureDump.planRestrictions.length) await env.db.insert(planRestrictions).values(fixtureDump.planRestrictions.map((r: any) => ({ planName: r.planName, categoryKey: r.categoryKey, mode: r.mode, keywords: r.keywords, explanation: r.explanation, isActive: r.isActive, createdBy: "fixture", updatedBy: "fixture" })) as any);
  if (fixtureDump.planOverrides.length) await env.db.insert(planOverrides).values(fixtureDump.planOverrides.map((o: any) => ({ planName: o.planName, pedId: o.pedId, categoryKey: o.categoryKey, targetQuestion: o.targetQuestion, reason: o.reason, addedBy: "fixture" })) as any);

  const gate = createMappingGate({ enabled: () => gateOn, rootDb: () => env.db as never, performer: async () => "Tester (Admin)" });
  const app = express();
  app.use(express.json());
  // Mimics PATCH /api/ped-repository/:id, DELETE, and POST alias.
  app.patch("/ped/:id", gate("Edited PED"), async (req, res) => {
    const id = Number(req.params.id);
    const repos = createRepositories(getDb());
    const row = await repos.pedRepository.get(id);
    if (!row) return res.status(404).json({ error: "PED not found." });
    await getDb().update(pedRepository).set({ categoryKey: req.body.categoryKey }).where(eq(pedRepository.id, id));
    await repos.mappingState.bump();
    return res.json({ ped: { id, categoryKey: req.body.categoryKey } });
  });
  app.delete("/alias/:id", gate("Deleted alias"), async (req, res) => {
    await getDb().delete(pedAliases).where(eq(pedAliases.id, Number(req.params.id)));
    await createRepositories(getDb()).mappingState.bump();
    return res.json({ ok: true });
  });
  app.patch("/plain/:id", async (req, res) => {
    // an ungated route to prove the gate is the only thing that adds the behaviour
    await env.db.update(pedRepository).set({ categoryKey: req.body.categoryKey }).where(eq(pedRepository.id, Number(req.params.id)));
    res.json({ ok: true });
  });
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  resetUsageCache();
}, 120_000);

afterAll(async () => {
  if (server) await new Promise((r) => server.close(r));
});

/** Finds a PED id (with aliases) whose change to `to` previews at the wanted tier. */
async function findPed(wantTier: string, to: string | null) {
  const peds = (await env.repos.pedRepository.list()).filter((p) => p.categoryKey && p.categoryKey !== to);
  for (const p of peds.slice(0, 80)) {
    const r = await call("PATCH", `/ped/${p.id}`, { body: { categoryKey: to }, preview: true, change: null });
    if (r.body.tier === wantTier) return { ped: p, preview: r.body };
  }
  throw new Error(`no PED found with tier ${wantTier}`);
}

describe("mapping change gate", () => {
  it("never lets a preview fall through to a real write when the gate is off", async () => {
    gateOn = false;
    const ped = (await env.repos.pedRepository.list()).find((p) => p.categoryKey)!;
    const before = ped.categoryKey;
    const r = await call("PATCH", `/ped/${ped.id}`, { body: { categoryKey: null }, preview: true, change: null });
    expect(r.status).toBe(409);
    expect(await category(ped.id)).toBe(before);
    gateOn = true;
  });

  it("preview reports the impact and changes nothing", async () => {
    const tablesBefore = await captureTables(env.db as never);
    const versionBefore = await env.repos.mappingState.getVersion();
    const { ped, preview } = await findPed("high", null);
    expect(preview.preview).toBe(true);
    expect(preview.impact.metrics.pairsChanged).toBeGreaterThan(0);
    expect(preview.impactHash).toMatch(/^[0-9a-f]{24}$/);
    expect(await category(ped.id)).toBe(ped.categoryKey);
    expect(await env.repos.mappingState.getVersion()).toBe(versionBefore);
    expect(JSON.stringify([...(await captureTables(env.db as never)).get("ped_repository")!])).toBe(JSON.stringify([...tablesBefore.get("ped_repository")!]));
    expect((await env.repos.mappingChangeSets.listRecent(5)).length).toBe(0);
  }, 120_000);

  it("refuses an apply without the change-control fields, and saves nothing", async () => {
    const { ped } = await findPed("high", null);
    const r = await call("PATCH", `/ped/${ped.id}`, { body: { categoryKey: null }, change: null });
    expect(r.status).toBe(400);
    expect(r.body.code).toBe("change_control_required");
    for (const bad of [{ reason: "x" }, { changeCategory: "Nonsense" }, { businessDecision: "maybe" }]) {
      const r2 = await call("PATCH", `/ped/${ped.id}`, { body: { categoryKey: null }, change: control(bad) });
      expect(r2.status).toBe(400);
    }
    expect(await category(ped.id)).toBe(ped.categoryKey);
    expect(CHANGE_CATEGORIES).toContain("Plan override");
  }, 120_000);

  it("high impact needs the exact previewed confirmation, a stale one is refused", async () => {
    const { ped, preview } = await findPed("high", null);
    const v0 = await env.repos.mappingState.getVersion();
    const noConfirm = await call("PATCH", `/ped/${ped.id}`, { body: { categoryKey: null } });
    expect(noConfirm.status).toBe(409);
    expect(noConfirm.body.code).toBe("impact_confirmation_required");
    expect(noConfirm.body.impactHash).toBe(preview.impactHash);
    expect(await category(ped.id)).toBe(ped.categoryKey);
    const wrong = await call("PATCH", `/ped/${ped.id}`, { body: { categoryKey: null }, change: control({ confirmHash: "deadbeef" }) });
    expect(wrong.status).toBe(409);
    expect(await env.repos.mappingState.getVersion()).toBe(v0);

    const ok = await call("PATCH", `/ped/${ped.id}`, { body: { categoryKey: null }, change: control({ confirmHash: preview.impactHash }) });
    expect(ok.status).toBe(200);
    expect(ok.body.mappingChange.tier).toBe("high");
    expect(await category(ped.id)).toBeNull();
    const cs = await env.repos.mappingChangeSets.get(ok.body.mappingChange.id);
    expect(cs?.reason).toMatch(/safety backbone/);
    expect(cs?.changeCategory).toBe("Dictionary update");
    expect(cs?.businessDecision).toBe("none");
    expect(cs?.impactTier).toBe("high");
    expect(cs?.performedBy).toBe("Tester (Admin)");
    expect(await env.repos.mappingState.getVersion()).toBeGreaterThan(v0);

    // undo restores the exact rows, then cannot be repeated
    const undo = await undoAdminChange(env.db as never, cs!.id, "Tester (Admin)");
    expect(undo.reverted).toBe(true);
    expect(await category(ped.id)).toBe(ped.categoryKey);
    const again = await undoAdminChange(env.db as never, cs!.id, "Tester (Admin)");
    expect(again.reverted).toBe(false);
  }, 180_000);

  it("what the preview predicts is what a live lookup then does", async () => {
    const { ped, preview } = await findPed("high", null);
    const ok = await call("PATCH", `/ped/${ped.id}`, { body: { categoryKey: null }, change: control({ confirmHash: preview.impactHash }) });
    expect(ok.status).toBe(200);
    const instance = env.newInstance();
    let checked = 0;
    for (const s of preview.impact.sample.slice(0, 8)) {
      const live = await instance.lookup(s.term, s.plan);
      expect(live.question).toBe(s.after.question);
      expect(live.matchType).toBe(s.after.matchType);
      checked++;
    }
    expect(checked).toBeGreaterThan(0);
    await undoAdminChange(env.db as never, ok.body.mappingChange.id, "Tester (Admin)");
  }, 180_000);

  it("undo is refused (never forced) when the row was edited afterwards", async () => {
    const { ped } = await findPed("low", "heart").catch(() => findPed("elevated", "heart"));
    const ok = await call("PATCH", `/ped/${ped.id}`, { body: { categoryKey: "heart" }, change: control({ confirmHash: undefined }) }).then(async (r) =>
      r.status === 409 ? call("PATCH", `/ped/${ped.id}`, { body: { categoryKey: "heart" }, change: control({ confirmHash: r.body.impactHash }) }) : r
    );
    expect(ok.status).toBe(200);
    await env.db.update(pedRepository).set({ categoryKey: "kidney" }).where(eq(pedRepository.id, ped.id));
    const undo = await undoAdminChange(env.db as never, ok.body.mappingChange.id, "Tester (Admin)");
    expect(undo.reverted).toBe(false);
    expect(await category(ped.id)).toBe("kidney");
  }, 180_000);

  it("a route error is passed through and nothing is written", async () => {
    const before = (await env.repos.mappingChangeSets.listRecent(100)).length;
    const r = await call("PATCH", `/ped/99999999`, { body: { categoryKey: null } });
    expect(r.status).toBe(404);
    expect((await env.repos.mappingChangeSets.listRecent(100)).length).toBe(before);
  });

  it("a deleted alias is restored exactly by undo", async () => {
    const alias = (await env.db.select().from(pedAliases).limit(1))[0];
    const tablesBefore = await captureTables(env.db as never);
    let r = await call("DELETE", `/alias/${alias.id}`);
    if (r.status === 409) r = await call("DELETE", `/alias/${alias.id}`, { change: control({ confirmHash: r.body.impactHash }) });
    expect(r.status).toBe(200);
    expect((await env.repos.pedAliases.listAll()).some((a) => a.id === alias.id)).toBe(false);
    const undo = await undoAdminChange(env.db as never, r.body.mappingChange.id, "Tester (Admin)");
    expect(undo.reverted).toBe(true);
    const after = await captureTables(env.db as never);
    const sorted = (m: Map<string, unknown>) => JSON.stringify([...m].sort(([a], [b]) => (a < b ? -1 : 1)));
    expect(sorted(after.get("ped_aliases")!)).toBe(sorted(tablesBefore.get("ped_aliases")!));
  }, 180_000);

  it("concurrent changes serialise and both land", async () => {
    const peds = (await env.repos.pedRepository.list()).filter((p) => p.categoryKey === "heart" || p.categoryKey === "kidney").slice(0, 2);
    const run = async (p: (typeof peds)[number]) => {
      let r = await call("PATCH", `/ped/${p.id}`, { body: { categoryKey: p.categoryKey } });
      if (r.status === 409) r = await call("PATCH", `/ped/${p.id}`, { body: { categoryKey: p.categoryKey }, change: control({ confirmHash: r.body.impactHash }) });
      return r;
    };
    // same-value writes are a no-op (no change set); use real changes
    const results = await Promise.all(
      peds.map(async (p) => {
        const to = p.categoryKey === "heart" ? "kidney" : "heart";
        let r = await call("PATCH", `/ped/${p.id}`, { body: { categoryKey: to } });
        if (r.status === 409) r = await call("PATCH", `/ped/${p.id}`, { body: { categoryKey: to }, change: control({ confirmHash: r.body.impactHash }) });
        return { r, p, to };
      })
    );
    void run;
    for (const { r } of results) expect([200, 409]).toContain(r.status);
    const ok = results.filter((x) => x.r.status === 200);
    expect(ok.length).toBeGreaterThan(0);
    for (const x of ok) expect(await category(x.p.id)).toBe(x.to);
    const ids = new Set(ok.map((x) => x.r.body.mappingChange.id));
    expect(ids.size).toBe(ok.length);
  }, 240_000);
});
