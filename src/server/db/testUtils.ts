/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import { drizzle } from "drizzle-orm/pglite";
import { sql } from "drizzle-orm";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import * as schema from "./schema.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export type TestDb = ReturnType<typeof drizzle<typeof schema>>;

/**
 * Test/dev-only schema baseline (2026-09) — NOT the production migration
 * history. See drizzle.test.config.ts's header comment for the full story:
 * migrations 0057-0081 were permanently lost from this local checkout
 * before they could be committed. Production's real database already has
 * that entire history applied and is completely unaffected (its own
 * drizzle/meta/_journal.json + drizzle/*.sql stay exactly as they are,
 * untouched by any of this) — but a fresh database built by replaying only
 * what's left in that journal would silently land on an incomplete,
 * incorrect schema (it would jump straight from migration 0056 to 0082 and
 * fail, since 0082 assumes columns/renames that only happened in the lost
 * 57-81 range).
 *
 * This file is instead a single "CREATE everything schema.ts currently
 * declares" script, generated via `npm run db:generate:test-baseline`
 * (drizzle-kit generate against drizzle.test.config.ts, output to
 * ./drizzle-test-baseline — a folder entirely separate from ./drizzle).
 * Regenerate it whenever schema.ts changes; it always represents CURRENT
 * schema.ts, never a historical step-by-step record.
 */
const TEST_BASELINE_DIR = path.join(__dirname, "../../../drizzle-test-baseline");

function readTestBaselineSql(): string {
  const files = fs
    .readdirSync(TEST_BASELINE_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  if (files.length === 0) {
    throw new Error(
      `No baseline SQL file found in ${TEST_BASELINE_DIR}. Run \`npm run db:generate:test-baseline\` to generate it from the current schema.ts.`
    );
  }
  // Only ever one file today (a single consolidated baseline); sorted-last
  // wins if that ever changes, matching drizzle's own numbered-file convention.
  return fs.readFileSync(path.join(TEST_BASELINE_DIR, files[files.length - 1]), "utf-8");
}

/**
 * Spins up a fresh, in-process Postgres instance (PGlite — a real Postgres
 * engine compiled to WASM, not a different-dialect stand-in like SQLite)
 * and applies the current schema (see TEST_BASELINE_DIR above — NOT a
 * replay of production's migration history). Used exclusively by
 * repository unit tests so the DAL is tested against real Postgres SQL
 * semantics without needing a network connection to an external database.
 *
 * Each call returns an isolated, empty database — call this once per test
 * file (or per test) and let it get garbage-collected; there's no shared
 * state between instances.
 */
export async function createTestDb(): Promise<TestDb> {
  // Registers the pgvector extension so kb_chunks' embedding column (a
  // `CREATE EXTENSION IF NOT EXISTS vector;` in the baseline) succeeds here
  // too — PGlite doesn't bundle pgvector by default, only through this
  // separate extension package (see @electric-sql/pglite-pgvector's own
  // README).
  const client = new PGlite({ extensions: { vector } });
  const db = drizzle(client, { schema });
  // drizzle-kit generate only ever emits table/column/type DDL, never
  // `CREATE EXTENSION` — it doesn't track Postgres extensions at all (this
  // was true for the real, now-lost migration 0028 too, which hand-added
  // this same statement outside drizzle-kit's own generated output). Several
  // columns in the baseline (kb_chunks.embedding, faq_records/
  // term_faq_records.question_embedding, special_instructions.
  // topic_embedding) are `vector(768)`, so the extension must exist before
  // any of those CREATE TABLE statements run.
  await db.execute(sql.raw(`CREATE EXTENSION IF NOT EXISTS vector;`));
  const baselineSql = readTestBaselineSql();
  for (const statement of baselineSql.split("--> statement-breakpoint")) {
    const trimmed = statement.trim();
    if (trimmed) await db.execute(sql.raw(trimmed));
  }
  // `drizzle-kit generate` (and so the baseline above) only ever captures
  // table/column/type STRUCTURE, never hand-written INSERT seed data that a
  // historical migration file added on top of its own DDL. Migration 0038
  // (drizzle/0038_team_role_mapping_grants.sql — still present on disk, NOT
  // one of the lost 0057-0081 files) seeds exactly these convenience
  // catalog rows; several tests (e.g. evaluateAccess.test.ts's "Guide"
  // group test) depend on them existing. Carried forward here, verbatim,
  // rather than folded into the generated baseline file itself, so
  // regenerating the baseline never silently drops it.
  await db.execute(sql`
    INSERT INTO org_teams (name, description, created_by) VALUES
      ('Bliss', NULL, 'system (migration 0038)'),
      ('Falcon', NULL, 'system (migration 0038)'),
      ('Central', 'Oversees Bliss and Falcon operations.', 'system (migration 0038)')
  `);
  await db.execute(sql`
    INSERT INTO relationship_groups (name, description, created_by) VALUES
      ('Mentor', NULL, 'system (migration 0038)'),
      ('Guide', NULL, 'system (migration 0038)')
  `);
  await db.execute(sql`
    INSERT INTO roles (name, description, created_by) VALUES
      ('Advisor', NULL, 'system (migration 0038)'),
      ('Mentor', NULL, 'system (migration 0038)'),
      ('Guide', NULL, 'system (migration 0038)')
  `);
  // Migration 0049 (drizzle/0049_product_assist_eligibility_and_grant_expiry.sql
  // — also still on disk, not lost) seeds this convenience "Advisory"
  // department row; productAssistQuota.test.ts and advisorDirectorySync.test.ts
  // depend on it existing.
  await db.execute(sql`
    INSERT INTO departments (name, description, created_by) VALUES
      ('Advisory', 'Advisors who handle customer-facing declaration and product questions.', 'system (migration 0049)')
  `);
  // Migration 0090 (Product Playbook mirror) adds database-level guards
  // (functions + triggers) and two seeded playbook_source_issues rows that
  // drizzle-kit can't express, so the generated baseline above doesn't have
  // them. Run exactly those statements from the real migration file, so the
  // tests exercise the same guards as staging/production.
  for (const statement of readPlaybookMirrorExtrasSql()) {
    await db.execute(sql.raw(statement));
  }
  return db;
}

/** The statements of drizzle/0090_playbook_mirror.sql that the generated
 * baseline can't contain: CREATE FUNCTION, CREATE TRIGGER and the seed INSERT. */
function readPlaybookMirrorExtrasSql(): string[] {
  const file = path.join(__dirname, "../../../drizzle/0090_playbook_mirror.sql");
  return fs
    .readFileSync(file, "utf8")
    .split("--> statement-breakpoint")
    .map((s) => s.replace(/^(\s*--[^\n]*\n)+/, "").trim())
    .filter((s) => /^(CREATE FUNCTION|CREATE TRIGGER|INSERT INTO "playbook_source_issues")/.test(s));
}
