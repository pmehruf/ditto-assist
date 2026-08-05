/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * ONE-TIME FIX — clear the stale `excludePrediabetes` (and, if present,
 * `requiresInsulinForDiabetes`) override on Optima Secure's *database*
 * plan_configs row.
 *
 * BACKGROUND: plan_configs in the database is the live source of truth
 * /api/match reads from (see PlanConfigsRepository's own doc comment) — the
 * hardcoded getPlanConfig() in src/types.ts is only a bootstrap seed. A
 * code-level fix removing `excludePrediabetes` from Optima Secure's
 * hardcoded default (already done) has no effect on a plan that already has
 * a DB row, which is why Prediabetes on Optima Secure kept returning
 * Fallback ("Type 1 Diabetes, diabetes on insulin...") even after that fix
 * was deployed. This script updates ONLY the `overrides` column on Optima
 * Secure's existing row — questions, categoryMap, specificIllnesses, and
 * every other field are left completely untouched.
 *
 * USAGE
 *   npx tsx scripts/fixOptimaSecurePrediabetesOverride.ts   (dry-run, default)
 *   npx tsx scripts/fixOptimaSecurePrediabetesOverride.ts --apply
 */

import dotenv from "dotenv";
import { getDb, closeDb } from "../src/server/db/client.js";
import { createRepositories } from "../src/server/db/repositories/index.js";

dotenv.config();

const APPLY = process.argv.includes("--apply");
const PLAN_NAME = "Optima Secure";

async function main() {
  console.log(`Mode: ${APPLY ? "APPLY (will UPDATE plan_configs)" : "DRY RUN (no DB writes — pass --apply to write)"}`);

  const db = getDb();
  const repos = createRepositories(db);

  const row = await repos.planConfigs.get(PLAN_NAME);
  if (!row) {
    console.log(`No plan_configs row found for "${PLAN_NAME}" — nothing to fix (it's using the hardcoded default, which is already correct).`);
    await closeDb();
    return;
  }

  const currentOverrides = (row.overrides as Record<string, unknown> | null) || {};
  console.log(`Current overrides for "${PLAN_NAME}":`, JSON.stringify(currentOverrides));

  if (!("excludePrediabetes" in currentOverrides) && !("requiresInsulinForDiabetes" in currentOverrides)) {
    console.log("Neither excludePrediabetes nor requiresInsulinForDiabetes is set — nothing to fix.");
    await closeDb();
    return;
  }

  const { excludePrediabetes, requiresInsulinForDiabetes, ...rest } = currentOverrides;
  const newOverrides = Object.keys(rest).length > 0 ? rest : null;

  console.log(`New overrides for "${PLAN_NAME}" (removing excludePrediabetes=${excludePrediabetes}, requiresInsulinForDiabetes=${requiresInsulinForDiabetes}):`, JSON.stringify(newOverrides));

  if (!APPLY) {
    console.log("\nDRY RUN complete — no rows were written. Re-run with --apply to write this change.");
    await closeDb();
    return;
  }

  const updated = await repos.planConfigs.update(PLAN_NAME, { overrides: newOverrides });
  console.log("\nUpdated row overrides:", JSON.stringify(updated?.overrides ?? null));
  console.log("Done.");

  await closeDb();
}

main().catch((err) => {
  console.error("Fix failed:", err);
  process.exit(1);
});
