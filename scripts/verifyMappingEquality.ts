/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * READ-ONLY pre-flip equality check against a LIVE database (the one
 * DATABASE_URL points at): `npm run mapping:verify`. Run it after the
 * migration and seed, before setting MAPPING_ENGINE=db.
 *
 * Replays the full corpus (alias texts, dictionary terms, synonym groups,
 * smoke-test terms, regex probes, generated variants, compound terms) for every
 * live plan through BOTH the untouched legacy engine (browser leg, then server
 * leg — i.e. what advisors get today) and the data-driven engine loaded from
 * this database, and exits non-zero on any difference in the primary fields
 * (resolved, match type, question, question number) or the strict fields
 * (explanation, umbrella recommendations, supporting flags, plan-override flag).
 * Only SELECTs are issued.
 */

import dotenv from "dotenv";
import { sql } from "drizzle-orm";
import { getDb, closeDb } from "../src/server/db/client.js";
import { createRepositories } from "../src/server/db/repositories/index.js";
import { createMappingSnapshotProvider } from "../src/server/mappingSnapshot.js";
import { baseTerms, compoundTerms, legacyEffectiveFactory, newEngineOutcome, planConfigsFromDump, primaryKey, variantTerms } from "../src/mapping/equalityHarness.js";
import type { MappingDump } from "../src/mapping/seedBuilder.js";
import { categories, pedAliases, pedMappingOverrides, pedRepository, planConfigs, planOverrides, planRestrictions } from "../src/server/db/schema.js";

dotenv.config();

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const db = getDb();
  await db.execute(sql`SET default_transaction_read_only = on`);
  const [plans, cats, peds, aliases, overrides, restrictions, legacyOverrides] = await Promise.all([
    db.select().from(planConfigs),
    db.select().from(categories),
    db.select().from(pedRepository),
    db
      .select({ id: pedAliases.id, pedId: pedAliases.pedId, aliasText: pedAliases.aliasText, normalizedAlias: pedAliases.normalizedAlias, isPrimary: pedAliases.isPrimary, isVisible: pedAliases.isVisible })
      .from(pedAliases),
    db.select().from(planOverrides),
    db.select().from(planRestrictions),
    db.select().from(pedMappingOverrides),
  ]);
  const dump = {
    planConfigs: plans,
    categories: cats.map((c) => ({ categoryKey: c.categoryKey, label: c.label })),
    pedRepository: peds.map((p) => ({ id: p.id, pedCode: p.pedCode, canonicalName: p.canonicalName, categoryKey: p.categoryKey, status: p.status })),
    pedAliases: aliases,
    planOverrides: overrides,
    planRestrictions: restrictions,
    pedMappingOverrides: legacyOverrides.map((o) => ({ pedText: o.pedText, category: o.category })),
  } as unknown as MappingDump;

  const repos = createRepositories(db);
  const snapshot = await createMappingSnapshotProvider(repos).get();
  console.log(`Snapshot v${snapshot.version}: ${snapshot.steps.length} pipeline steps, ${snapshot.aliases.size} aliases.`);
  if (snapshot.steps.length === 0) {
    console.error("No routing rules found — run the mapping seed first.");
    process.exit(2);
  }

  const base = baseTerms(dump, "src/engine.ts");
  const terms = [...new Set([...base, ...variantTerms(base), ...compoundTerms(base, Number(arg("compound") ?? 6000))])].sort();
  const livePlans = planConfigsFromDump(dump);
  const legacy = legacyEffectiveFactory(dump);

  let pairs = 0;
  let primaryDiffs = 0;
  let strictDiffs = 0;
  const examples: string[] = [];
  for (const { planName, config } of livePlans) {
    for (const ped of terms) {
      pairs++;
      const a = legacy(ped, planName, config);
      const b = newEngineOutcome(ped, planName, config, snapshot);
      if (primaryKey(a) !== primaryKey(b)) {
        primaryDiffs++;
        if (examples.length < 25) examples.push(`PRIMARY ${planName} :: ${ped} :: legacy ${primaryKey(a).slice(0, 90)} :: new ${primaryKey(b).slice(0, 90)}`);
      } else if (a.strict !== b.strict) {
        strictDiffs++;
        if (examples.length < 25) examples.push(`STRICT  ${planName} :: ${ped}`);
      }
    }
  }
  console.log(JSON.stringify({ plans: livePlans.length, terms: terms.length, pairs, primaryDiffs, strictDiffs }, null, 2));
  for (const e of examples) console.log(e);
  if (primaryDiffs > 0 || strictDiffs > 0) {
    console.error("\nNOT EQUAL — do not switch MAPPING_ENGINE to db.");
    process.exitCode = 1;
  } else {
    console.log("\nEQUAL — zero differences against the legacy engine.");
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => closeDb());
