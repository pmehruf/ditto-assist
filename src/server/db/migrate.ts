/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Standalone migration runner: `npm run db:migrate`.
 *
 * Applies every migration under ./drizzle (generated via `npm run
 * db:generate` whenever src/server/db/schema.ts changes, or hand-written for
 * 0012+ — see the Drizzle migration convention memory) to whatever database
 * DATABASE_URL points at. Safe to run repeatedly — already-applied
 * migrations are tracked and skipped.
 *
 * Deliberately NOT using drizzle-orm's own `migrate()` (drizzle-orm/postgres-js/
 * migrator) — that helper wraps EVERY pending migration into a single
 * transaction (see its PgDialect.migrate: one `session.transaction(...)`
 * around the whole loop). That breaks migration pairs like 0055/0056 here:
 * 0055 does `ALTER TYPE announcement_type ADD VALUE 'Product Announcement'`
 * and 0056 does `UPDATE ... SET type = 'Product Announcement' ...` —
 * Postgres refuses to use a new enum value before the transaction that added
 * it has committed ("unsafe use of new value ... enum type", error 55P04),
 * so on a fresh database where BOTH are pending at once, bundling them into
 * one transaction always fails, even though each migration file is
 * individually correct and the 0056 file's own comment says exactly this
 * ("Must run as its OWN migration, after 0055 has committed"). The fix below
 * runs each migration file in its OWN transaction — standard practice for
 * most migration tools anyway — so an earlier file's ADD VALUE is committed
 * and visible before a later file that uses it even starts. Migration
 * bookkeeping (schema `drizzle`, table `__drizzle_migrations`, same
 * id/hash/created_at columns) is kept byte-for-byte compatible with
 * drizzle-orm's own format, so this doesn't disturb history already
 * recorded by a prior run of the old runner.
 */

import { readMigrationFiles } from "drizzle-orm/migrator";
import postgres from "postgres";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_SCHEMA = "drizzle";
const MIGRATIONS_TABLE = "__drizzle_migrations";

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("DATABASE_URL environment variable is required. See .env.example.");
    process.exit(1);
  }

  const sql = postgres(connectionString, { max: 1 });

  console.log("Running migrations...");

  const migrations = readMigrationFiles({ migrationsFolder: path.join(__dirname, "../../../drizzle") });

  // Same bookkeeping table drizzle-orm's own migrator creates/reads —
  // matching name/schema/columns keeps this compatible with history any
  // prior run (via the old drizzle-orm migrate()) already recorded.
  await sql.unsafe(`CREATE SCHEMA IF NOT EXISTS "${MIGRATIONS_SCHEMA}"`);
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS "${MIGRATIONS_SCHEMA}"."${MIGRATIONS_TABLE}" (
      id SERIAL PRIMARY KEY,
      hash text NOT NULL,
      created_at bigint
    )
  `);
  const lastApplied = await sql.unsafe(
    `SELECT created_at FROM "${MIGRATIONS_SCHEMA}"."${MIGRATIONS_TABLE}" ORDER BY created_at DESC LIMIT 1`
  );
  const lastAppliedAt = lastApplied[0]?.created_at !== undefined ? Number(lastApplied[0].created_at) : null;

  let appliedCount = 0;
  for (const migration of migrations) {
    if (lastAppliedAt !== null && lastAppliedAt >= migration.folderMillis) continue; // already applied

    console.log(`Applying migration (folderMillis=${migration.folderMillis})...`);
    // Each migration file gets its OWN transaction (see this file's header
    // comment on why) — commits before the next file's statements run.
    await sql.begin(async (tx) => {
      for (const statement of migration.sql) {
        const trimmed = statement.trim();
        if (!trimmed) continue; // statement-breakpoint split can leave blank entries
        await tx.unsafe(trimmed);
      }
      await tx.unsafe(
        `INSERT INTO "${MIGRATIONS_SCHEMA}"."${MIGRATIONS_TABLE}" ("hash", "created_at") VALUES ($1, $2)`,
        [migration.hash, migration.folderMillis]
      );
    });
    appliedCount++;
  }

  console.log(appliedCount > 0 ? `Migrations complete — applied ${appliedCount}.` : "Migrations complete — nothing new to apply.");

  await sql.end();
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
