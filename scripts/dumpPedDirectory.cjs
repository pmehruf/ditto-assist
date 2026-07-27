/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// Plain CommonJS (no TS transform / esbuild needed — avoids the sandbox's
// Windows-vs-Linux native-binary mismatch in node_modules). Read-only dump
// of the live `ped_directory` table for backup/analysis. Run with:
//   node scripts/dumpPedDirectory.cjs
require("dotenv").config();
const postgres = require("postgres");
const fs = require("fs");

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL not set.");
    process.exit(1);
  }
  const sql = postgres(url, { max: 1 });
  try {
    const rows = await sql`SELECT id, term, category, added_by, created_at FROM ped_directory ORDER BY id ASC`;
    console.log(`Fetched ${rows.length} rows from ped_directory.`);
    fs.writeFileSync("scripts/ped_directory_backup.json", JSON.stringify(rows, null, 2), "utf8");
    console.log("Wrote scripts/ped_directory_backup.json");
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
