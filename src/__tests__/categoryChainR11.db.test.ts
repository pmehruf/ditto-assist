/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createMappingTestEnv, type MappingTestEnv } from "./helpers/mappingTestDb";
import { createPedWithPrimaryAlias } from "../server/pedRepositoryLive";
import { pedRepository } from "../server/db/schema";
import { questionForCategory } from "../engine";
import { categoriesInDefinition } from "../server/mappingAdmin";
import { compareWorlds } from "../mapping/impact";
import { snapshotFromDump } from "../mapping/seedBuilder";
import { loadMappingSnapshot } from "../server/mappingSnapshot";
import { captureTables, diffTables } from "../server/mappingChange";
import { fixtureDump } from "./helpers/mappingTestDb";
import type { World } from "../mapping/impact";

/**
 * Phase 4 / R11 against the real tables: the chain is stored on the PED, loaded into the snapshot, and a change is live
 * on every instance's next lookup (no restart, no redeploy, no cache clearing).
 */

const PLAN = "Optima Secure";
const TERM = "xqzr11dbprobe";
let env: MappingTestEnv;
let pedId: number;
let noQ: string; // a category the plan has no question for
let A: string; // real
let B: string; // real, different
let questionA: string;
let questionB: string;

const setChain = async (chain: string[] | null) => {
  await env.db.update(pedRepository).set({ categoryChain: chain }).where(eq(pedRepository.id, pedId));
  await env.repos.mappingState.bump();
};

beforeAll(async () => {
  env = await createMappingTestEnv();
  const config = env.plans.get(PLAN)!;
  const snap = await loadMappingSnapshot(env.repos, await env.repos.mappingState.getVersion());
  const keys = [...snap.categoryLabels.keys()];
  const ruleCategories = new Set<string>();
  for (const st of snap.steps) if (st.stage === "dictionary" || st.stage === "firewall") for (const c of categoriesInDefinition(st.definition)) ruleCategories.add(c);
  noQ = keys.find((k) => !questionForCategory(config, k) && !ruleCategories.has(k))!;
  const probe = async (k: string) => {
    await env.db.update(pedRepository).set({ categoryKey: k }).where(eq(pedRepository.id, pedId));
    await env.repos.mappingState.bump();
    const live = await env.newInstance().lookup(TERM, PLAN);
    return live.decidedBy === "primitive.plan_decision" && live.matchType === "P1" ? live.question : null;
  };
  const created = await createPedWithPrimaryAlias(env.repos, { canonicalName: TERM, categoryKey: noQ, addedBy: "test" });
  pedId = created.ped.id;
  const reals: Array<[string, string]> = [];
  for (const k of keys) {
    if (reals.length >= 2) break;
    if (!questionForCategory(config, k) || k === "diabetes") continue;
    const q = await probe(k);
    if (q && !reals.some(([, rq]) => rq === q)) reals.push([k, q]);
  }
  [[A, questionA], [B, questionB]] = reals;
  await env.db.update(pedRepository).set({ categoryKey: noQ, categoryChain: null }).where(eq(pedRepository.id, pedId));
  await env.repos.mappingState.bump();
}, 120_000);

describe("R11 against the database", () => {
  it("a PED with no chain behaves as before (its category has no question → unresolved)", async () => {
    expect((await env.newInstance().lookup(TERM, PLAN)).question).toBeNull();
  });

  it("the chain is read from ped_repository.category_chain and is live on instances that were already running", async () => {
    const i1 = env.newInstance();
    const i2 = env.newInstance();
    expect((await i1.lookup(TERM, PLAN)).question).toBeNull(); // both instances now hold a cached snapshot
    expect((await i2.lookup(TERM, PLAN)).question).toBeNull();

    await setChain([B]); // primary has no question; fallback B has
    for (const inst of [i1, i2]) {
      const live = await inst.lookup(TERM, PLAN);
      expect(live.question).toBe(questionB);
      expect(live.dictionarySource).toBe("category_chain");
      expect(live.effectiveCategory).toBe(B);
    }

    await setChain([A, B]); // reorder / extend: first real wins, B no longer used
    for (const inst of [i1, i2]) expect((await inst.lookup(TERM, PLAN)).question).toBe(questionA);
    await setChain([B, A]);
    for (const inst of [i1, i2]) expect((await inst.lookup(TERM, PLAN)).question).toBe(questionB);

    await setChain(null); // removing the chain returns to today's behaviour immediately
    for (const inst of [i1, i2]) expect((await inst.lookup(TERM, PLAN)).question).toBeNull();
  });

  it("a primary category that already has a real question ignores the chain; the chain is only a fallback", async () => {
    await env.db.update(pedRepository).set({ categoryKey: A, categoryChain: [B] }).where(eq(pedRepository.id, pedId));
    await env.repos.mappingState.bump();
    expect((await env.newInstance().lookup(TERM, PLAN)).question).toBe(questionA);
    await env.db.update(pedRepository).set({ categoryKey: noQ, categoryChain: null }).where(eq(pedRepository.id, pedId));
    await env.repos.mappingState.bump();
  });

  it("the change is previewed (impact) and recorded as an undoable row change on ped_repository", async () => {
    const before = await captureTables(env.db as never);
    const worldOf = async (): Promise<World> => ({ snapshot: await loadMappingSnapshot(env.repos, await env.repos.mappingState.getVersion()), plans: env.plans });
    const w0 = await worldOf();
    await setChain([B]);
    const w1 = await worldOf();
    const report = compareWorlds(w0, w1, [TERM]);
    expect(report.metrics.pairsChanged).toBeGreaterThan(0);
    expect(report.metrics.transitions["UNRESOLVED→P1"]).toBeGreaterThan(0);
    const ops = diffTables(before, await captureTables(env.db as never));
    expect(ops.some((o) => o.table === "ped_repository" && o.op === "update" && (o.after as any).categoryChain?.[0] === B && (o.before as any).categoryChain === null)).toBe(true);
    await setChain(null);
  });

  it("existing PEDs are untouched: no existing row has a chain, and snapshot entries carry the field only when set", async () => {
    const rows = await env.repos.pedRepository.list();
    expect(rows.filter((p) => p.categoryChain !== null && p.id !== pedId)).toHaveLength(0);
    const snap = await loadMappingSnapshot(env.repos, await env.repos.mappingState.getVersion());
    expect([...snap.aliases.values()].filter((e) => e.categoryChain !== undefined)).toHaveLength(0);
    // the fixture-built snapshot (used by the equality tests) has no chains either
    expect([...snapshotFromDump(fixtureDump).aliases.values()].some((e) => e.categoryChain !== undefined)).toBe(false);
  });
});
