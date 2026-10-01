/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Captures a READ-ONLY, scrubbed snapshot of an environment's mapping tables
 * for the mapping-control equality migration: `npm run mapping:snapshot --
 * --env production --out src/__tests__/fixtures/mapping/production-day-one.snapshot.json.gz`
 *
 * Only SELECTs. Contains mapping/configuration data only — no credentials,
 * customer data, user records, or "added by" names (stripped). Stamped with
 * capture time, environment, migration version and a SHA-256 of the data so a
 * snapshot can be pinned and verified.
 */

import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import { gzipSync } from "node:zlib";
import { writeFileSync } from "node:fs";
import dotenv from "dotenv";
import postgres from "postgres";

dotenv.config();

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const env = arg("env");
  const out = arg("out");
  if (!env || !out) {
    console.error("Usage: --env <production|staging|...> --out <file.json.gz>   (DATABASE_URL selects the database)");
    process.exit(1);
  }
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is required.");
    process.exit(1);
  }
  const sql = postgres(url, { max: 1 });
  try {
    await sql`SET default_transaction_read_only = on`;
    const planConfigs = await sql`select plan_name as "planName", insurer_name as "insurerName", questions, category_map as "categoryMap", any_other as "anyOther", has_umbrella as "hasUmbrella", umbrella_questions as "umbrellaQuestions", overrides, removed from plan_configs order by plan_name`;
    const categories = await sql`select category_key as "categoryKey", label from categories order by category_key`;
    const pedRepository = await sql`select id, ped_code as "pedCode", canonical_name as "canonicalName", category_key as "categoryKey", status from ped_repository order by id`;
    const pedAliases = await sql`select id, ped_id as "pedId", alias_text as "aliasText", normalized_alias as "normalizedAlias", is_primary as "isPrimary", is_visible as "isVisible" from ped_aliases order by id`;
    const planOverrides = await sql`select plan_name as "planName", ped_id as "pedId", category_key as "categoryKey", target_question as "targetQuestion", reason from plan_overrides order by id`;
    const planRestrictions = await sql`select plan_name as "planName", category_key as "categoryKey", mode, keywords, explanation, is_active as "isActive" from plan_restrictions order by id`;
    const pedMappingOverrides = await sql`select ped_text as "pedText", category from ped_mapping_overrides order by id`;
    const mig = await sql`select count(*)::int as n, max(created_at)::text as last from drizzle.__drizzle_migrations`;

    const data = { planConfigs, categories, pedRepository, pedAliases, planOverrides, planRestrictions, pedMappingOverrides };
    const body = JSON.stringify(data);
    const meta = {
      purpose: env === "production" ? "PRODUCTION day-one baseline snapshot (mapping-control equality migration)" : `${env} mapping snapshot`,
      environment: env,
      capturedAt: new Date().toISOString(),
      migrationVersion: { applied: mig[0].n, lastCreatedAt: mig[0].last },
      codeCommit: execSync("git rev-parse HEAD").toString().trim(),
      sha256: createHash("sha256").update(body).digest("hex"),
      rowCounts: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, (v as unknown[]).length])),
    };
    writeFileSync(out, gzipSync(JSON.stringify({ meta, data })));
    console.log(JSON.stringify(meta, null, 2));
  } finally {
    await sql.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
