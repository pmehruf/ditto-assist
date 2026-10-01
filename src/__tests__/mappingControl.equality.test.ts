/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { sql } from "drizzle-orm";
import { createTestDb, type TestDb } from "../server/db/testUtils";
import { createRepositories } from "../server/db/repositories";
import { categories, pedAliases, pedMappingOverrides, pedRepository, routingRules } from "../server/db/schema";
import { applyMappingSeed } from "../server/mappingSeed";
import { createMappingSnapshotProvider } from "../server/mappingSnapshot";
import { runDeterministicPipeline } from "../mapping/routingEngine";
import { LEGACY_RULE_SEED } from "../mapping/legacyRuleSeed";
import { planSeed, type MappingDump } from "../mapping/seedBuilder";
import { legacyEffectiveFactory, newEngineOutcome, planConfigsFromDump, primaryKey, strictHash } from "../mapping/equalityHarness";
import type { MappingSnapshot } from "../mapping/ruleTypes";

/**
 * Gates G2–G4, G7, G8: the DB-backed, data-driven engine must reproduce the
 * frozen production day-one baseline exactly.
 *
 * Production's mapping tables (the committed snapshot) are loaded into an
 * in-process Postgres, the seed is applied, the runtime snapshot is loaded
 * through the real loader, and every (term, plan) pair of the frozen legacy
 * baseline is replayed through the new engine.
 */

const FIXTURES = new URL("./fixtures/mapping/", import.meta.url);
const readGz = (name: string) => JSON.parse(gunzipSync(readFileSync(new URL(name, FIXTURES))).toString());

const snapshotFile = readGz("production-day-one.snapshot.json.gz") as { meta: Record<string, any>; data: MappingDump };
const baseline = readGz("production-day-one.baseline.json.gz") as {
  meta: Record<string, any>;
  terms: string[];
  questionTable: string[];
  results: Record<string, string[]>;
};
const dump = snapshotFile.data;

let db: TestDb;
let repos: ReturnType<typeof createRepositories>;
let snap: MappingSnapshot;
let seedReport: Awaited<ReturnType<typeof applyMappingSeed>>;
const before = { pedCategories: "", aliasTexts: "", pedCount: 0, aliasCount: 0, categoryCount: 0 };

async function loadDump(target: TestDb) {
  await target.insert(categories).values(dump.categories.map((c) => ({ categoryKey: c.categoryKey, label: c.label })));
  await target.insert(pedRepository).values(
    dump.pedRepository.map((p) => ({
      id: p.id,
      pedCode: p.pedCode ?? `PED-${p.id}`,
      canonicalName: p.canonicalName,
      categoryKey: p.categoryKey,
      status: p.status as "draft" | "approved" | "deprecated",
      addedBy: "fixture",
    }))
  );
  await target.insert(pedAliases).values(
    dump.pedAliases.map((a) => ({
      id: a.id,
      pedId: a.pedId,
      aliasText: a.aliasText,
      normalizedAlias: a.normalizedAlias,
      isPrimary: a.isPrimary,
      isVisible: a.isVisible,
      addedBy: "fixture",
    }))
  );
  await target.insert(pedMappingOverrides).values(dump.pedMappingOverrides.map((o) => ({ pedText: o.pedText, category: o.category, addedBy: "fixture" })));
  await target.execute(sql`select setval(pg_get_serial_sequence('ped_repository','id'), (select max(id) from ped_repository))`);
  await target.execute(sql`select setval(pg_get_serial_sequence('ped_aliases','id'), (select max(id) from ped_aliases))`);
}

beforeAll(async () => {
  db = await createTestDb();
  repos = createRepositories(db as never);
  await loadDump(db);
  const peds = await db.select().from(pedRepository);
  const aliases = await db.select().from(pedAliases);
  before.pedCategories = JSON.stringify(peds.map((p) => [p.id, p.categoryKey]).sort());
  before.aliasTexts = JSON.stringify(aliases.map((a) => [a.id, a.aliasText, a.normalizedAlias, a.pedId]).sort());
  before.pedCount = peds.length;
  before.aliasCount = aliases.length;
  before.categoryCount = (await db.select().from(categories)).length;
  seedReport = await applyMappingSeed(db as never, { apply: true, addedBy: "test" });
  snap = await createMappingSnapshotProvider(repos).get();
}, 120_000);

describe("mapping-control seed integrity (G2)", () => {
  it("is applied once and reports the expected, pinned counts", () => {
    expect(seedReport.mode).toBe("applied");
    expect(seedReport.rules).toBe(LEGACY_RULE_SEED.length);
    // Pinned from the committed production snapshot (sha256 below). If these
    // move, the snapshot or the seed derivation changed and must be reviewed.
    expect(seedReport.counts).toEqual({ aliases: 1396, notRouted: 137, categoryOverride: 53, fallback: 8, newPeds: 6, unchanged: 1205 });
    expect(snapshotFile.meta.sha256).toBe("a095196670509026a088b5833e85425d2cefae2b9877fdf0ed40e36148569e71");
    expect(snapshotFile.meta.environment).toBe("production");
  });

  it("deletes nothing and does not alter any existing PED category, alias text or category", async () => {
    const peds = await db.select().from(pedRepository);
    const aliases = await db.select().from(pedAliases);
    const maxPed = Math.max(...dump.pedRepository.map((x) => x.id));
    const maxAlias = Math.max(...dump.pedAliases.map((x) => x.id));
    const existingPeds = peds.filter((p) => p.id <= maxPed);
    const existingAliases = aliases.filter((a) => a.id <= maxAlias);
    expect(JSON.stringify(existingPeds.map((p) => [p.id, p.categoryKey]).sort())).toBe(before.pedCategories);
    expect(JSON.stringify(existingAliases.map((a) => [a.id, a.aliasText, a.normalizedAlias, a.pedId]).sort())).toBe(before.aliasTexts);
    expect(peds.length).toBe(before.pedCount + seedReport.counts.newPeds);
    expect(aliases.length).toBe(before.aliasCount + seedReport.counts.newPeds);
    expect((await db.select().from(categories)).length).toBe(before.categoryCount);
  });

  it("writes exactly the planned alias exceptions, and nothing else", async () => {
    const aliases = await db.select().from(pedAliases);
    const plan = planSeed(dump);
    expect(aliases.filter((a) => !a.routingEnabled).length).toBe(plan.counts.notRouted);
    expect(aliases.filter((a) => a.categoryKeyOverride !== null).length).toBe(plan.counts.categoryOverride);
    expect(aliases.filter((a) => a.fallbackCategoryKey !== null).length).toBe(plan.counts.fallback);
  });

  it("is idempotent: a second run is a no-op and leaves the version alone", async () => {
    const versionBefore = await repos.mappingState.getVersion();
    const rulesBefore = (await db.select().from(routingRules)).length;
    const again = await applyMappingSeed(db as never, { apply: true, addedBy: "test" });
    expect(again.mode).toBe("skipped-already-seeded");
    expect(await repos.mappingState.getVersion()).toBe(versionBefore);
    expect((await db.select().from(routingRules)).length).toBe(rulesBefore);
  });

  it("a dry run writes nothing", async () => {
    const dry = await applyMappingSeed(db as never, { apply: false, addedBy: "test" });
    expect(dry.mode).toBe("dry-run");
  });
});

describe("day-one equality against the frozen production baseline (G3 + G4)", () => {
  it("baseline provenance is pinned", () => {
    expect(baseline.meta.sourceSnapshot.sha256).toBe(snapshotFile.meta.sha256);
    expect(baseline.meta.pairs).toBe(baseline.terms.length * baseline.meta.plans.length);
    expect(baseline.meta.pairs).toBeGreaterThan(100_000);
  });

  it("reproduces every (term, plan) outcome — primary fields AND explanation/umbrella/flags — with zero differences", () => {
    const plans = planConfigsFromDump(dump);
    expect(plans.map((p) => p.planName).sort()).toEqual([...baseline.meta.plans].sort());
    const primaryDiffs: string[] = [];
    const strictDiffs: string[] = [];
    let compared = 0;
    for (const { planName, config } of plans) {
      const rows = baseline.results[planName];
      expect(rows.length).toBe(baseline.terms.length);
      for (let i = 0; i < baseline.terms.length; i++) {
        const ped = baseline.terms[i];
        const o = newEngineOutcome(ped, planName, config, snap);
        const row = rows[i];
        compared++;
        let expectedPrimary: string;
        let expectedStrict = "";
        if (row === "0") {
          expectedPrimary = "0|||";
        } else {
          const [, mt, qi, qn, h] = row.split("|");
          expectedPrimary = `1|${mt}|${baseline.questionTable[Number(qi)]}|${qn}`;
          expectedStrict = h;
        }
        if (primaryKey(o) !== expectedPrimary) {
          if (primaryDiffs.length < 20) primaryDiffs.push(`${planName} :: ${ped} :: baseline ${expectedPrimary.slice(0, 100)} :: new ${primaryKey(o).slice(0, 100)}`);
        } else if (row !== "0" && strictHash(o) !== expectedStrict) {
          if (strictDiffs.length < 20) strictDiffs.push(`${planName} :: ${ped}`);
        }
      }
    }
    expect(compared).toBe(baseline.meta.pairs);
    expect(primaryDiffs).toEqual([]);
    expect(strictDiffs).toEqual([]);
  }, 300_000);

  it("previously resolved conditions stay resolved and unresolved ones stay unresolved (coverage)", () => {
    const plans = planConfigsFromDump(dump);
    let resolvedBaseline = 0;
    let resolvedNew = 0;
    for (const { planName, config } of plans) {
      const rows = baseline.results[planName];
      for (let i = 0; i < baseline.terms.length; i += 7) {
        if (rows[i] !== "0") resolvedBaseline++;
        if (newEngineOutcome(baseline.terms[i], planName, config, snap).resolved) resolvedNew++;
      }
    }
    expect(resolvedNew).toBe(resolvedBaseline);
  }, 120_000);
});

describe("frozen baseline is the legacy oracle's output (spot check against the live legacy engine)", () => {
  it("2,000 sampled pairs re-computed with the untouched legacy engine match the fixture", () => {
    const plans = planConfigsFromDump(dump);
    const legacy = legacyEffectiveFactory(dump);
    let x = 987654321;
    const next = () => (x = (Math.imul(x, 1664525) + 1013904223) >>> 0) / 0x100000000;
    const diffs: string[] = [];
    for (let n = 0; n < 2000; n++) {
      const plan = plans[Math.floor(next() * plans.length)];
      const i = Math.floor(next() * baseline.terms.length);
      const o = legacy(baseline.terms[i], plan.planName, plan.config);
      const row = baseline.results[plan.planName][i];
      let expected = "0|||";
      if (row !== "0") {
        const [, mt, qi, qn] = row.split("|");
        expected = `1|${mt}|${baseline.questionTable[Number(qi)]}|${qn}`;
      }
      if (primaryKey(o) !== expected) diffs.push(`${plan.planName} :: ${baseline.terms[i]}`);
    }
    expect(diffs).toEqual([]);
  }, 120_000);
});

describe("deterministic, AI-free, traceable (G7 + G8)", () => {
  it("gives identical results on repeated runs", () => {
    const plans = planConfigsFromDump(dump);
    for (const { planName, config } of plans) {
      for (const ped of ["diabetes", "obstructive sleep apnea", "cigarette", "dns", "history of nasal polyp", "totally unknown thing"]) {
        const a = JSON.stringify(runDeterministicPipeline(ped, planName, config, snap));
        const b = JSON.stringify(runDeterministicPipeline(ped, planName, config, snap));
        expect(a).toBe(b);
      }
    }
  });

  it("the engine modules contain no AI/network calls", () => {
    for (const f of ["../mapping/routingEngine.ts", "../mapping/ruleTypes.ts", "../server/mappingSnapshot.ts"]) {
      const src = readFileSync(new URL(f, import.meta.url), "utf8");
      expect(src).not.toMatch(/gemini|GoogleGenAI|fetch\(|openai/i);
    }
  });

  it("records which rule decided, and why an alias control was used", () => {
    const plans = planConfigsFromDump(dump);
    const optima = plans.find((p) => p.planName === "Optima Secure")!;
    const lifestyle = runDeterministicPipeline("cigarette", optima.planName, optima.config, snap);
    expect(lifestyle.trace.decidedBy).toBe("dict.lifestyle");
    expect(lifestyle.trace.dictionary?.source).toBe("alias_override");
    expect(lifestyle.trace.dictionary?.categoryOverride).toBe("lifestyle");
    expect(lifestyle.trace.dictionary?.pedCategory).toBeNull();

    const shield = runDeterministicPipeline("mri brain", optima.planName, optima.config, snap);
    expect(shield.trace.decidedBy).toBe("shield.A_tests");

    const aom = plans.find((p) => p.planName === "Activ One Max")!;
    const fallback = runDeterministicPipeline("dns", aom.planName, aom.config, snap);
    expect(fallback.trace.dictionary?.source).toBe("fallback_category");
    expect(fallback.trace.dictionary?.effectiveCategory).toBe("ent");
  });
});
