/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import path from "path";
import { fileURLToPath } from "url";
import * as schema from "./schema.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export type TestDb = ReturnType<typeof drizzle<typeof schema>>;

/**
 * Spins up a fresh, in-process Postgres instance (PGlite — a real Postgres
 * engine compiled to WASM, not a different-dialect stand-in like SQLite)
 * and applies the same migrations that run in production. Used exclusively
 * by repository unit tests so the DAL is tested against real Postgres SQL
 * semantics without needing a network connection to an external database.
 *
 * Each call returns an isolated, empty database — call this once per test
 * file (or per test) and let it get garbage-collected; there's no shared
 * state between instances.
 */
export async function createTestDb(): Promise<TestDb> {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: path.join(__dirname, "../../../drizzle") });
  return db;
}
