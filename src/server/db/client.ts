/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { drizzle } from "drizzle-orm/postgres-js";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import postgres from "postgres";
import * as schema from "./schema.js";

export type Db = ReturnType<typeof drizzle<typeof schema>>;

/**
 * Driver-agnostic Drizzle database type. Repositories are typed against
 * this instead of `Db` so the exact same repository class works against
 * the real postgres-js connection in production (`Db`, from `getDb()`) and
 * the in-process PGlite connection in tests (`TestDb`, from
 * `testUtils.ts#createTestDb()`) — the two use different
 * `PgQueryResultHKT` implementations under the hood, which `Db` alone
 * doesn't accept.
 */
export type AnyDb = PgDatabase<PgQueryResultHKT, typeof schema>;

let _sql: ReturnType<typeof postgres> | null = null;
let _db: Db | null = null;

/**
 * Lazily-initialized singleton Postgres connection + Drizzle client, used by
 * server.ts / API routes in production. Requires DATABASE_URL to be set
 * (a standard Postgres connection string, e.g. from Neon/Supabase/RDS).
 *
 * Tests do NOT use this — see src/server/db/testUtils.ts, which spins up an
 * in-process PGlite instance instead so the DAL can be unit tested without a
 * real network connection.
 */
export function getDb(): Db {
  if (!_db) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error(
        "DATABASE_URL environment variable is required to connect to the database. " +
          "See .env.example for the expected format."
      );
    }
    _sql = postgres(connectionString, { max: 10 });
    _db = drizzle(_sql, { schema });
  }
  return _db;
}

/** For graceful shutdown (e.g. process signal handlers) and test teardown. */
export async function closeDb(): Promise<void> {
  if (_sql) {
    await _sql.end();
    _sql = null;
    _db = null;
  }
}
