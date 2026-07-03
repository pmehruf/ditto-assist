/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Standalone migration runner: `npm run db:migrate`.
 *
 * Applies every migration under ./drizzle (generated via `npm run
 * db:generate` whenever src/server/db/schema.ts changes) to whatever
 * database DATABASE_URL points at. Safe to run repeatedly — already-applied
 * migrations are tracked and skipped.
 */

import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("DATABASE_URL environment variable is required. See .env.example.");
    process.exit(1);
  }

  const sql = postgres(connectionString, { max: 1 });
  const db = drizzle(sql);

  console.log("Running migrations...");
  await migrate(db, { migrationsFolder: path.join(__dirname, "../../../drizzle") });
  console.log("Migrations complete.");

  await sql.end();
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
