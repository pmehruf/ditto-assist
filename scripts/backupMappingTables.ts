/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Full-row, READ-ONLY backup of every table the mapping-control migration
 * touches or reads: `npm run mapping:backup -- --out backups/<name>.json.gz`.
 * Take it immediately before running migration 0085. All columns are saved
 * (select *), so it works before and after the migration. The file can contain
 * staff names ("added by") — keep it local; `backups/` is git-ignored.
 */

import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { gzipSync } from "node:zlib";
import dotenv from "dotenv";
import postgres from "postgres";

dotenv.config();

const TABLES = [
  "ped_repository",
  "ped_aliases",
  "categories",
  "plan_configs",
  "plan_overrides",
  "plan_restrictions",
  "ped_mapping_overrides",
  "mapping_history",
  "ped_directory",
  "ai_memory",
];

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const out = arg("out");
  const url = process.env.DATABASE_URL;
  if (!out || !url) {
    console.error("Usage: --out <file.json.gz>   (DATABASE_URL selects the database)");
    process.exit(1);
  }
  const sql = postgres(url, { max: 1 });
  try {
    await sql`SET default_transaction_read_only = on`;
    const startedAt = new Date().toISOString();
    const tables: Record<string, unknown[]> = {};
    for (const t of TABLES) tables[t] = await sql.unsafe(`select * from "${t}"`);
    const mig = await sql`select count(*)::int as n, max(created_at)::text as last from drizzle.__drizzle_migrations`;
    const body = JSON.stringify(tables);
    const meta = {
      purpose: "Pre-migration restore point (mapping-control 0085)",
      takenAt: startedAt,
      migrations: { applied: mig[0].n, lastCreatedAt: mig[0].last },
      rowCounts: Object.fromEntries(Object.entries(tables).map(([k, v]) => [k, v.length])),
      sha256: createHash("sha256").update(body).digest("hex"),
    };
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, gzipSync(JSON.stringify({ meta, tables })));
    console.log(JSON.stringify(meta, null, 2));
  } finally {
    await sql.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
