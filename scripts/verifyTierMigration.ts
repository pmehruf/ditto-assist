/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Diagnostic, read-only. Checks whether the 0019 "Owner" -> "Developer"
 * user_tier enum rename has actually landed on the live database, and shows
 * drizzle's migration bookkeeping so a "ran but nothing changed" mystery can
 * be resolved with facts instead of guessing.
 *
 * USAGE
 *   npx tsx scripts/verifyTierMigration.ts
 */

import dotenv from "dotenv";
import postgres from "postgres";

dotenv.config();

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("DATABASE_URL is required.");
    process.exit(1);
  }
  const sql = postgres(connectionString, { max: 1 });

  console.log("=== user_tier enum — current live values ===");
  const enumValues = await sql`
    SELECT enumlabel, enumsortorder
    FROM pg_enum
    WHERE enumtypid = 'user_tier'::regtype
    ORDER BY enumsortorder
  `;
  for (const row of enumValues) console.log(`  - ${row.enumlabel}`);

  console.log("\n=== __drizzle_migrations — most recent entries ===");
  try {
    const migrations = await sql`
      SELECT id, hash, created_at
      FROM drizzle.__drizzle_migrations
      ORDER BY id DESC
      LIMIT 8
    `;
    for (const row of migrations) {
      console.log(`  #${row.id}  ${new Date(Number(row.created_at)).toISOString()}  ${row.hash}`);
    }
  } catch (err: any) {
    console.log("  (could not read drizzle.__drizzle_migrations):", err.message);
  }

  console.log("\n=== users table — distinct tier values currently in use ===");
  const distinctTiers = await sql`SELECT DISTINCT tier, COUNT(*) FROM users GROUP BY tier ORDER BY tier`;
  for (const row of distinctTiers) console.log(`  - ${row.tier}: ${row.count}`);

  await sql.end();
}

main().catch((err) => {
  console.error("verifyTierMigration failed:", err);
  process.exit(1);
});
