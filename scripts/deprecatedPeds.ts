/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Lists ped_repository rows with status "deprecated" — i.e. PEDs that are
 * NOT active in the app (see pedStatusEnum in schema.ts: "draft" | "approved"
 * | "deprecated"; scripts/migrationStats.ts and scripts/uncategorizedPeds.ts
 * both treat "deprecated" as the inactive population).
 *
 * USAGE
 *   npx tsx scripts/deprecatedPeds.ts        # first 20
 *   npx tsx scripts/deprecatedPeds.ts --all   # every row
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
  const deprecated = peds.filter((p) => p.status === "deprecated");

  console.log(`Deprecated (inactive) PEDs: ${deprecated.length} of ${peds.length} total\n`);

  const rows = showAll ? deprecated : deprecated.slice(0, 20);
  for (const p of rows) {
    console.log(`  ${p.pedCode}\t${p.canonicalName}\t(categoryKey: ${p.categoryKey ?? "none"})`);
  }
  if (!showAll && deprecated.length > rows.length) {
    console.log(`  ...and ${deprecated.length - rows.length} more (run with --all to list every row)`);
  }

  await closeDb().catch(() => {});
}

main().catch((err) => {
  console.error("deprecatedPeds failed:", err);
  process.exit(1);
});
