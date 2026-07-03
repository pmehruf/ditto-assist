/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { defineConfig } from "drizzle-kit";

// Note: this file is only read by the `drizzle-kit` CLI (db:generate /
// db:studio scripts), never imported by application code, so it's fine for
// it to reference DATABASE_URL directly without the lazy-init pattern used
// in src/server/db/client.ts.
export default defineConfig({
  schema: "./src/server/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL || "postgres://placeholder:placeholder@localhost:5432/placeholder",
  },
});
