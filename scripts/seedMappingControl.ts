/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Seeds mapping-control data for ONE environment (the database DATABASE_URL
 * points at): `npm run mapping:seed` is a DRY RUN that prints exactly what
 * would change; add `--apply` to write it. Add `--report <file.json>` to save
 * the full exception list for review. Refuses to run twice (rules already
 * present) unless `--force`.
 */

import dotenv from "dotenv";
import { writeFileSync } from "node:fs";
import { getDb, closeDb } from "../src/server/db/client.js";
import { applyMappingSeed } from "../src/server/mappingSeed.js";

dotenv.config();

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const has = (name: string) => process.argv.includes(`--${name}`);

async function main() {
  const apply = has("apply");
  const report = await applyMappingSeed(getDb() as never, { apply, force: has("force"), addedBy: "mapping-control seed" });
  console.log(`Mode: ${report.mode}`);
  console.log(`Routing rules to seed: ${report.rules}`);
  console.log("Alias counts:", report.counts);
  console.log(`New PEDs (dictionary keys with no alias row): ${report.newPeds.length}`);
  const reportPath = arg("report");
  if (reportPath) {
    writeFileSync(reportPath, JSON.stringify(report, null, 2));
    console.log(`Full report written to ${reportPath}`);
  }
  if (!apply) console.log("\nDry run only — nothing was written. Re-run with --apply to write.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => closeDb());
