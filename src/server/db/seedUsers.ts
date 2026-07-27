/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * One-off seed script: `npm run db:seed:users`.
 *
 * Carries the accounts that used to live in data/users.json into the new
 * `users` table. Needed because PUT /api/users (and every tier check) now
 * reads from Postgres — against a freshly-migrated, empty table, nobody
 * (including the real Owner) could use the app's own UI to seed the first
 * accounts, since editing the directory itself requires already being Owner
 * in that directory.
 *
 * Safe to re-run: uses ON CONFLICT DO NOTHING per email, so it will never
 * duplicate rows or clobber tier/status edits already made via the app
 * since the last run.
 */

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import dotenv from "dotenv";
import { users } from "./schema.js";

dotenv.config();

const SEED_USERS = [
  { email: "mehruf.p@joinditto.in", name: "Mehruf P", tactId: "TACT-101", tier: "Owner" as const, status: "Active" as const },
  { email: "rebecca.s@joinditto.in", name: "Rebecca S", tactId: "TACT-102", tier: "Admin" as const, status: "Active" as const },
  { email: "shashank@joinditto.in", name: "Shashank J", tactId: "TACT-103", tier: "General" as const, status: "Active" as const },
];

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("DATABASE_URL environment variable is required. See .env.example.");
    process.exit(1);
  }

  const client = postgres(connectionString, { max: 1 });
  const db = drizzle(client);

  for (const u of SEED_USERS) {
    await db.insert(users).values(u).onConflictDoNothing({ target: users.email });
    console.log(`Seeded (or already present): ${u.email}`);
  }

  await client.end();
}

main().catch((err) => {
  console.error("Seeding failed:", err);
  process.exit(1);
});
