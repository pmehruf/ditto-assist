/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { defineConfig } from "drizzle-kit";

// Test/dev-only baseline config — completely separate from drizzle.config.ts.
//
// Purpose: generate a single "CREATE everything schema.ts currently
// declares" SQL file for bootstrapping FRESH databases (PGlite test
// instances, new dev environments) directly from the current schema,
// instead of replaying the full production migration history. This exists
// because migrations 0057-0081 were permanently lost from this local
// checkout before they could be committed (see drizzle/meta/_journal.json's
// history and src/server/db/testUtils.ts's doc comment) — production's real
// database already has all of that history applied and is unaffected, but a
// database built from scratch by replaying only what's left in
// drizzle/meta/_journal.json would land on an incomplete, incorrect schema.
//
// This config's `out` (./drizzle-test-baseline) is deliberately NOT
// "./drizzle" — it must never be confused with, or merged into, the real
// production migration history. Nothing here is ever applied to production;
// db:generate / db:migrate (drizzle.config.ts) are completely untouched by
// this file.
//
// Regenerate the baseline whenever schema.ts changes:
//   npm run db:generate:test-baseline
export default defineConfig({
  schema: "./src/server/db/schema.ts",
  out: "./drizzle-test-baseline",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL || "postgres://placeholder:placeholder@localhost:5432/placeholder",
  },
});
