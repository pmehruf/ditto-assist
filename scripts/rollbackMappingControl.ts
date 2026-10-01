/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Reverses migration 0085 + the mapping seed on ONE database (the one
 * DATABASE_URL points at): `npm run mapping:rollback` previews, add `--apply`
 * to execute. One transaction, all-or-nothing.
 *
 * ORDER MATTERS. The new application code selects the new ped_aliases
 * columns, so first return Cloud Run traffic to the previous revision (or at
 * least set MAPPING_ENGINE=legacy AND redeploy code that predates the
 * columns), THEN run this. For an engine-only rollback no database change is
 * needed — just set MAPPING_ENGINE=legacy.
 *
 * Removes: PEDs/aliases created by the seed (added_by = 'mapping-control
 * seed'), the three ped_aliases columns, routing_rules, mapping_state, and the
 * migration bookkeeping row. Any alias-control values edited after the seed are
 * discarded with their columns. Nothing else is touched.
 */

import dotenv from "dotenv";
import postgres from "postgres";

dotenv.config();

const MIGRATION_CREATED_AT = 1791900000000;

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is required.");
    process.exit(1);
  }
  const apply = process.argv.includes("--apply");
  const sql = postgres(url, { max: 1 });
  try {
    const seededAliases = await sql`select count(*)::int as n from ped_aliases where added_by = 'mapping-control seed'`.catch(() => [{ n: 0 }]);
    const seededPeds = await sql`select count(*)::int as n from ped_repository where added_by = 'mapping-control seed'`;
    const applied = await sql`select count(*)::int as n from drizzle.__drizzle_migrations where created_at = ${MIGRATION_CREATED_AT}`;
    console.log(`Seed-created aliases: ${seededAliases[0].n} | seed-created PEDs: ${seededPeds[0].n} | migration 0085 recorded: ${applied[0].n === 1}`);
    if (!apply) {
      console.log("Preview only — nothing changed. Re-run with --apply to roll back.");
      return;
    }
    await sql.begin(async (tx) => {
      await tx.unsafe(`delete from ped_aliases where added_by = 'mapping-control seed'`);
      await tx.unsafe(`delete from ped_repository where added_by = 'mapping-control seed'`);
      await tx.unsafe(`alter table ped_aliases drop column if exists routing_enabled`);
      await tx.unsafe(`alter table ped_aliases drop column if exists category_key_override`);
      await tx.unsafe(`alter table ped_aliases drop column if exists fallback_category_key`);
      await tx.unsafe(`drop table if exists routing_rules`);
      await tx.unsafe(`drop table if exists mapping_state`);
      await tx.unsafe(`delete from drizzle.__drizzle_migrations where created_at = ${MIGRATION_CREATED_AT}`);
    });
    console.log("Rolled back: migration 0085 and the seed are removed.");
  } finally {
    await sql.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
