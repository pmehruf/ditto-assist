/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * READ-ONLY behaviour freeze / comparison against a LIVE database (the one DATABASE_URL points at).
 *
 *   npm run mapping:freeze -- --out backups/r11-baseline-production.json.gz
 *   npm run mapping:freeze -- --compare backups/r11-baseline-production.json.gz
 *   npm run mapping:freeze -- --compare <frozen> --dump <captured snapshot.json.gz>   (replay over a captured copy of the
 *                                                                                 mapping tables instead of the live DB)
 *
 * `--out` records, for every (plan, term) pair of the full equality corpus, the data-driven engine's outcome
 * (primary fields + a hash of the strict fields) using the code and database as they are now. `--compare` recomputes
 * every pair with the current code and lists each difference. Used to prove that a change to the engine (Phase 4 / R11)
 * alters nothing it is not meant to alter. Only SELECTs are issued.
 */

import dotenv from "dotenv";
import { gzipSync, gunzipSync } from "node:zlib";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { getDb, closeDb } from "../src/server/db/client.js";
import { createRepositories } from "../src/server/db/repositories/index.js";
import { createMappingSnapshotProvider } from "../src/server/mappingSnapshot.js";
import { corpusTerms, newEngineOutcome, planConfigsFromDump, primaryKey, strictHash } from "../src/mapping/equalityHarness.js";
import { snapshotFromDump, type MappingDump } from "../src/mapping/seedBuilder.js";
import type { MappingSnapshot } from "../src/mapping/ruleTypes.js";
import { categories, pedAliases, pedMappingOverrides, pedRepository, planConfigs, planOverrides, planRestrictions } from "../src/server/db/schema.js";

dotenv.config();

/** The corpus of the committed post-R10 baseline; aliases added to the database since are added on top. */
const FROZEN_TERMS = (JSON.parse(gunzipSync(readFileSync(new URL("../src/__tests__/fixtures/mapping/post-r10.baseline.json.gz", import.meta.url))).toString()) as { terms: string[] }).terms;

const arg = (name: string): string | undefined => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

async function computeAll(dumpPath?: string): Promise<{ outcomes: Record<string, string>; snapshotVersion: number; aliases: number; steps: number }> {
  if (dumpPath) {
    // Replay over a captured copy (npm run mapping:snapshot): the rules are the seeded pipeline (identical to the live one
    // while `mapping:verify` is EQUAL), the data is the captured mapping tables.
    const dump = (JSON.parse(gunzipSync(readFileSync(dumpPath)).toString()) as { data: MappingDump }).data;
    const snapshot: MappingSnapshot = snapshotFromDump(dump);
    const terms = corpusTerms(dump, FROZEN_TERMS);
    const outcomes: Record<string, string> = {};
    for (const { planName, config } of planConfigsFromDump(dump)) {
      for (const ped of terms) {
        const o = newEngineOutcome(ped, planName, config, snapshot);
        outcomes[`${planName}||${ped}`] = `${primaryKey(o)}#${strictHash(o)}`;
      }
    }
    return { outcomes, snapshotVersion: snapshot.version, aliases: snapshot.aliases.size, steps: snapshot.steps.length };
  }
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
  const snapshot = await createMappingSnapshotProvider(createRepositories(db)).get();
  const terms = corpusTerms(dump, FROZEN_TERMS);
  const outcomes: Record<string, string> = {};
  for (const { planName, config } of planConfigsFromDump(dump)) {
    for (const ped of terms) {
      const o = newEngineOutcome(ped, planName, config, snapshot);
      outcomes[`${planName}||${ped}`] = `${primaryKey(o)}#${strictHash(o)}`;
    }
  }
  return { outcomes, snapshotVersion: snapshot.version, aliases: snapshot.aliases.size, steps: snapshot.steps.length };
}

async function main() {
  const out = arg("out");
  const compare = arg("compare");
  if (!out && !compare) {
    console.error("Usage: --out <file.json.gz>  |  --compare <file.json.gz>   (DATABASE_URL selects the database)");
    process.exit(1);
  }
  const now = await computeAll(arg("dump"));
  const hash = createHash("sha256").update(JSON.stringify(Object.entries(now.outcomes).sort(([a], [b]) => (a < b ? -1 : 1)))).digest("hex");
  console.log(`Snapshot v${now.snapshotVersion}: ${now.steps} pipeline steps, ${now.aliases} aliases, ${Object.keys(now.outcomes).length} pairs, sha256 ${hash}`);
  if (out) {
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, gzipSync(JSON.stringify({ capturedAt: new Date().toISOString(), snapshotVersion: now.snapshotVersion, sha256: hash, outcomes: now.outcomes })));
    console.log(`Frozen to ${out}`);
  } else if (compare) {
    const frozen = JSON.parse(gunzipSync(readFileSync(compare)).toString()) as { sha256: string; outcomes: Record<string, string> };
    const keys = new Set([...Object.keys(frozen.outcomes), ...Object.keys(now.outcomes)]);
    const diffs: string[] = [];
    for (const k of keys) if (frozen.outcomes[k] !== now.outcomes[k]) diffs.push(k);
    console.log(JSON.stringify({ pairsFrozen: Object.keys(frozen.outcomes).length, pairsNow: Object.keys(now.outcomes).length, differences: diffs.length, frozenSha256: frozen.sha256, nowSha256: hash }, null, 2));
    for (const k of diffs.slice(0, 25)) console.log(`DIFF ${k}\n   before: ${frozen.outcomes[k]}\n   after : ${now.outcomes[k]}`);
    console.log(diffs.length === 0 ? "IDENTICAL — every pair behaves exactly as when frozen." : `${diffs.length} DIFFERENCES — classify each as intended or regression.`);
    process.exit(diffs.length === 0 ? 0 : 1);
  }
  await closeDb();
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
