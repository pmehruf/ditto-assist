/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { eq, sql } from "drizzle-orm";
import { createTestDb, type TestDb } from "../server/db/testUtils";
import { createRepositories } from "../server/db/repositories";
import { categories, pedAliases, pedMappingOverrides, pedRepository } from "../server/db/schema";
import { applyMappingSeed } from "../server/mappingSeed";
import { createMappingSnapshotProvider } from "../server/mappingSnapshot";
import { runDeterministicPipeline } from "../mapping/routingEngine";
import { planConfigsFromDump } from "../mapping/equalityHarness";
import type { MappingDump } from "../mapping/seedBuilder";
import type { PlanConfig } from "../types";

/**
 * Gate G6 — live-change propagation. A change made through the data layer
 * (a routing rule, an alias control) followed by the mapping-version bump
 * must show on the very next lookup, on the instance that made it AND on a
 * second, independent instance (its own snapshot cache over the same
 * database), and on a freshly started instance.
 */

const FIXTURES = new URL("./fixtures/mapping/", import.meta.url);
const dump = (JSON.parse(gunzipSync(readFileSync(new URL("production-day-one.snapshot.json.gz", FIXTURES))).toString()) as { data: MappingDump }).data;

let db: TestDb;
let repos: ReturnType<typeof createRepositories>;
let instanceA: ReturnType<typeof createMappingSnapshotProvider>;
let instanceB: ReturnType<typeof createMappingSnapshotProvider>;
let optima: { planName: string; config: PlanConfig };

async function lookup(provider: ReturnType<typeof createMappingSnapshotProvider>, ped: string) {
  const snap = await provider.get();
  const { result, trace } = runDeterministicPipeline(ped, optima.planName, optima.config, snap);
  return { question: result?.matched_question ?? null, type: result?.match_type ?? null, decidedBy: trace.decidedBy };
}

beforeAll(async () => {
  db = await createTestDb();
  repos = createRepositories(db as never);
  await db.insert(categories).values(dump.categories.map((c) => ({ categoryKey: c.categoryKey, label: c.label })));
  await db.insert(pedRepository).values(
    dump.pedRepository.map((p) => ({ id: p.id, pedCode: p.pedCode ?? `PED-${p.id}`, canonicalName: p.canonicalName, categoryKey: p.categoryKey, status: p.status as "draft" | "approved" | "deprecated", addedBy: "fixture" }))
  );
  await db.insert(pedAliases).values(
    dump.pedAliases.map((a) => ({ id: a.id, pedId: a.pedId, aliasText: a.aliasText, normalizedAlias: a.normalizedAlias, isPrimary: a.isPrimary, isVisible: a.isVisible, addedBy: "fixture" }))
  );
  await db.insert(pedMappingOverrides).values(dump.pedMappingOverrides.map((o) => ({ pedText: o.pedText, category: o.category, addedBy: "fixture" })));
  await db.execute(sql`select setval(pg_get_serial_sequence('ped_repository','id'), (select max(id) from ped_repository))`);
  await db.execute(sql`select setval(pg_get_serial_sequence('ped_aliases','id'), (select max(id) from ped_aliases))`);
  await applyMappingSeed(db as never, { apply: true, addedBy: "test" });
  instanceA = createMappingSnapshotProvider(repos);
  instanceB = createMappingSnapshotProvider(repos);
  optima = planConfigsFromDump(dump).find((p) => p.planName === "Optima Secure")!;
}, 120_000);

describe("live-change propagation (G6)", () => {
  it("the version counter only moves forward", async () => {
    const v0 = await repos.mappingState.getVersion();
    const v1 = await repos.mappingState.bump();
    const v2 = await repos.mappingState.bump();
    expect(v1).toBe(v0 + 1);
    expect(v2).toBe(v1 + 1);
  });

  it("a routing-rule edit is live on the very next lookup, on this instance, a second instance and a fresh instance", async () => {
    const before = await lookup(instanceA, "kidney stone");
    await lookup(instanceB, "kidney stone"); // second instance has loaded its own snapshot
    expect(before.decidedBy).toBe("family.kidney");
    expect(before.question).toMatch(/Kidney ailment/);

    const rule = (await repos.routingRules.getByKey("family.kidney"))!;
    await repos.routingRules.upsert({
      ...rule,
      definition: {
        ...rule.definition,
        clauses: rule.definition.clauses!.map((c) => (c.then.a === "route" ? { ...c, then: { ...c.then, chain: ["digestive"] } } : c)),
      },
    });
    await repos.mappingState.bump();

    const afterA = await lookup(instanceA, "kidney stone");
    const afterB = await lookup(instanceB, "kidney stone");
    const fresh = await lookup(createMappingSnapshotProvider(repos), "kidney stone");
    for (const after of [afterA, afterB, fresh]) {
      expect(after.question).toMatch(/Ulcer \(Stomach/);
      expect(after.question).not.toBe(before.question);
    }
  });

  it("disabling a shield is live on the next lookup everywhere", async () => {
    expect((await lookup(instanceA, "mri brain")).decidedBy).toBe("shield.A_tests");
    const rule = (await repos.routingRules.getByKey("shield.A_tests"))!;
    await repos.routingRules.upsert({ ...rule, enabled: false });
    await repos.mappingState.bump();
    for (const provider of [instanceA, instanceB, createMappingSnapshotProvider(repos)]) {
      expect((await lookup(provider, "mri brain")).decidedBy).not.toBe("shield.A_tests");
    }
  });

  it("changing an alias control is live on the next lookup everywhere, and the trace says why", async () => {
    const aliasKey = "cigarette";
    expect((await lookup(instanceA, aliasKey)).decidedBy).toBe("dict.lifestyle");
    await db.update(pedAliases).set({ categoryKeyOverride: "acute_trauma" }).where(eq(pedAliases.normalizedAlias, aliasKey));
    await repos.mappingState.bump();
    for (const provider of [instanceA, instanceB, createMappingSnapshotProvider(repos)]) {
      const snap = await provider.get();
      const { trace } = runDeterministicPipeline(aliasKey, optima.planName, optima.config, snap);
      expect(trace.decidedBy).toBe("dict.acute_trauma");
      expect(trace.dictionary?.source).toBe("alias_override");
      expect(trace.dictionary?.categoryOverride).toBe("acute_trauma");
    }
  });

  it("without a version bump a stale instance does not see the change (the bump is what propagates it)", async () => {
    const stale = createMappingSnapshotProvider(repos);
    await stale.get();
    await db.update(pedAliases).set({ routingEnabled: false }).where(eq(pedAliases.normalizedAlias, "cigarettes"));
    expect((await lookup(stale, "cigarettes")).decidedBy).toBe("dict.lifestyle"); // not bumped yet
    await repos.mappingState.bump();
    expect((await lookup(stale, "cigarettes")).decidedBy).not.toBe("dict.lifestyle");
  });
});
