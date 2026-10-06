/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Declaration Assist suggestion cleanup: hide an approved list of names from the suggestion list. The ONLY data change is
 * `ped_aliases.is_visible = false` for those names (src/server/pedSuggestionHide.ts). DATABASE_URL selects the database.
 *
 *   npx tsx scripts/hideSuggestionNames.ts --plan <hide-plan.json>                      DRY RUN (default): reads only
 *   npx tsx scripts/hideSuggestionNames.ts --plan <hide-plan.json> --apply --backup <file.json.gz>
 *   npx tsx scripts/hideSuggestionNames.ts --rollback <file.json.gz>                    put the names back
 *
 * Apply = backup file first, checks against the live data (any mismatch stops it), ONE transaction, mapping version bump so
 * running servers reload, then a re-check that every hidden name still gives the same answer on every plan; if any answer
 * differs the change is rolled back automatically.
 */

import dotenv from "dotenv";
import { gunzipSync, gzipSync } from "node:zlib";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { getDb, closeDb } from "../src/server/db/client.js";
import { applyHide, captureAnswers, checkPlan, makeBackup, rollbackHide, type Backup, type HidePlan } from "../src/server/pedSuggestionHide.js";

dotenv.config();
const arg = (n: string) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const flag = (n: string) => process.argv.includes(`--${n}`);

function target(): string {
  try {
    const u = new URL(process.env.DATABASE_URL ?? "");
    return `${u.hostname}${u.pathname}`;
  } catch {
    return "(unknown database)";
  }
}

async function main() {
  const db = getDb();
  console.log(`Database: ${target()}`);
  const rollbackPath = arg("rollback");
  if (rollbackPath) {
    const backup = JSON.parse(gunzipSync(readFileSync(rollbackPath)).toString()) as Backup;
    const r = await rollbackHide(db, backup);
    console.log(`Rolled back: ${backup.rows.filter((x) => x.isVisible === true).length} names visible again. Visible now: ${r.visibleAfter}. Mapping version: ${r.mappingVersion}.`);
    return;
  }
  const planPath = arg("plan");
  if (!planPath) {
    console.error("Usage: --plan <hide-plan.json> [--apply --backup <file.json.gz>]   |   --rollback <file.json.gz>");
    process.exit(1);
  }
  const plan = JSON.parse(readFileSync(planPath, "utf8")) as HidePlan;
  const check = await checkPlan(db, plan);
  console.log(`Plan: ${plan.items.length} names (${plan.madeFrom.environment} snapshot of ${plan.madeFrom.capturedAt}).`);
  console.log(`Visible names now: ${check.visibleNow} (plan expected ${plan.expectedVisibleBefore}).`);
  console.log(`Would hide: ${check.toHide.length}. Already hidden: ${check.alreadyHidden.length}. Problems: ${check.problems.length}.`);
  for (const p of check.problems) console.log(`  PROBLEM: "${p.item.text}" (id ${p.item.id}): ${p.why}`);
  console.log(`Visible names after: ${check.expectedVisibleAfter}.`);
  const names = plan.items.map((i) => i.text);
  const before = await captureAnswers(db, names);

  if (!flag("apply")) {
    console.log("DRY RUN: nothing was changed. Add --apply --backup <file.json.gz> to apply.");
    return;
  }
  if (check.problems.length) {
    console.error("Stopped: fix or remove the problems above, or make a fresh plan from a fresh snapshot. Nothing was changed.");
    process.exit(2);
  }
  const backupPath = arg("backup");
  if (!backupPath) {
    console.error("--apply needs --backup <file.json.gz>. Nothing was changed.");
    process.exit(1);
  }
  const backup = await makeBackup(db, check.toHide);
  mkdirSync(dirname(backupPath), { recursive: true });
  writeFileSync(backupPath, gzipSync(JSON.stringify(backup)));
  console.log(`Backup written: ${backupPath} (${backup.rows.length} rows, ${backup.visibleBefore} visible before, mapping version ${backup.mappingVersionBefore}).`);

  const result = await applyHide(db, check.toHide);
  console.log(`Applied in one transaction: ${result.hidden} names hidden. Visible now: ${result.visibleAfter}. Mapping version bumped to ${result.mappingVersion}.`);

  const after = await captureAnswers(db, names);
  const differences = Object.keys(before).filter((k) => before[k] !== after[k]);
  if (differences.length) {
    console.error(`ANSWER CHANGED for ${differences.length} (name, plan) pairs, e.g. ${differences[0]}. Rolling back.`);
    const r = await rollbackHide(db, backup);
    console.error(`Rolled back. Visible now: ${r.visibleAfter}.`);
    process.exit(3);
  }
  console.log(`Verified: all ${Object.keys(before).length} (name, plan) answers are identical before and after.`);
  console.log("Next: run `npm run mapping:freeze -- --compare <the file you saved before applying>` for the full equality check.");
}

main()
  .then(() => closeDb())
  .catch(async (e) => {
    console.error(e);
    await closeDb().catch(() => undefined);
    process.exit(2);
  });
