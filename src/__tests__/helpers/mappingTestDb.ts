/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { sql } from "drizzle-orm";
import { createTestDb, type TestDb } from "../../server/db/testUtils";
import { createRepositories } from "../../server/db/repositories";
import { categories, pedAliases, pedMappingOverrides, pedRepository } from "../../server/db/schema";
import { applyMappingSeed } from "../../server/mappingSeed";
import { createMappingSnapshotProvider } from "../../server/mappingSnapshot";
import { runDeterministicPipeline } from "../../mapping/routingEngine";
import { planConfigsFromDump } from "../../mapping/equalityHarness";
import type { MappingDump } from "../../mapping/seedBuilder";
import type { LiveLookup } from "../../server/aiMappingPromotion";
import type { PlanConfig } from "../../types";

/**
 * Shared harness for admin-mapping tests: an in-process Postgres loaded with
 * the committed production day-one snapshot and the Phase 2 seed, plus a
 * "live lookup" function that behaves like /api/match's deterministic stage
 * (a snapshot provider per simulated server instance).
 */

const FIXTURES = new URL("../fixtures/mapping/", import.meta.url);
export const fixtureDump: MappingDump = (JSON.parse(gunzipSync(readFileSync(new URL("production-day-one.snapshot.json.gz", FIXTURES))).toString()) as { data: MappingDump }).data;

export interface MappingTestEnv {
  db: TestDb;
  repos: ReturnType<typeof createRepositories>;
  plans: Map<string, PlanConfig>;
  /** A simulated server instance: its own snapshot cache over the shared database. */
  newInstance: () => { lookup: (term: string, planName: string) => Promise<LiveLookup> };
}

export async function createMappingTestEnv(): Promise<MappingTestEnv> {
  const db = await createTestDb();
  const repos = createRepositories(db as never);
  await db.insert(categories).values(fixtureDump.categories.map((c) => ({ categoryKey: c.categoryKey, label: c.label })));
  await db.insert(pedRepository).values(
    fixtureDump.pedRepository.map((p) => ({ id: p.id, pedCode: p.pedCode ?? `PED-${p.id}`, canonicalName: p.canonicalName, categoryKey: p.categoryKey, status: p.status as "draft" | "approved" | "deprecated", addedBy: "fixture" }))
  );
  await db.insert(pedAliases).values(
    fixtureDump.pedAliases.map((a) => ({ id: a.id, pedId: a.pedId, aliasText: a.aliasText, normalizedAlias: a.normalizedAlias, isPrimary: a.isPrimary, isVisible: a.isVisible, addedBy: "fixture" }))
  );
  await db.insert(pedMappingOverrides).values(fixtureDump.pedMappingOverrides.map((o) => ({ pedText: o.pedText, category: o.category, addedBy: "fixture" })));
  await db.execute(sql`select setval(pg_get_serial_sequence('ped_repository','id'), (select max(id) from ped_repository))`);
  await db.execute(sql`select setval(pg_get_serial_sequence('ped_aliases','id'), (select max(id) from ped_aliases))`);
  await applyMappingSeed(db as never, { apply: true, addedBy: "test" });

  const plans = new Map(planConfigsFromDump(fixtureDump).map((p) => [p.planName, p.config] as const));
  const newInstance = () => {
    const provider = createMappingSnapshotProvider(repos);
    return {
      lookup: async (term: string, planName: string): Promise<LiveLookup> => {
        const snap = await provider.get();
        const { result, trace } = runDeterministicPipeline(term, planName, plans.get(planName)!, snap);
        return {
          question: result?.matched_question ?? null,
          matchType: result?.match_type ?? null,
          decidedBy: trace.decidedBy,
          effectiveCategory: trace.dictionary?.effectiveCategory ?? null,
          dictionarySource: trace.dictionary?.source ?? null,
          snapshotVersion: snap.version,
        };
      },
    };
  };
  return { db, repos, plans, newInstance };
}
