/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Lists active (non-deprecated) ped_repository rows that have no
 * categoryKey assigned yet — the "missing mapping" backlog referenced in
 * the Phase 5 migration stats (see scripts/migrationStats.ts).
 *
 * USAGE
 *   npx tsx scripts/uncategorizedPeds.ts        # first 20
 *   npx tsx scripts/uncategorizedPeds.ts --all   # every row
 */

import dotenv from "dotenv";
import { getDb, closeDb } from "../src/server/db/client.js";
import { createRepositories } from "../src/server/db/repositories/index.js";

dotenv.config();

async function main() {
  const showAll = process.argv.includes("--all");
  const db = getDb();
  const repos = createRepositories(db);

  const peds = await repos.pedRepository.list();
  const uncategorized = peds.filter((p) => p.status !== "deprecated" && !p.categoryKey);

  console.log(`Active PEDs missing categoryKey: ${uncategorized.length} of ${peds.length} total\n`);

  const rows = showAll ? uncategorized : uncategorized.slice(0, 20);
  for (const p of rows) {
    console.log(`  ${p.pedCode}\t${p.canonicalName}\t(status: ${p.status})`);
  }
  if (!showAll && uncategorized.length > rows.length) {
    console.log(`  ...and ${uncategorized.length - rows.length} more (run with --all to list every row)`);
  }

  await closeDb().catch(() => {});
}

main().catch((err) => {
  console.error("uncategorizedPeds failed:", err);
  process.exit(1);
});
