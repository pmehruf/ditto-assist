/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * ONE-TIME MIGRATION — plan_configs.overrides -> plan_restrictions
 *
 * Replaces the 3 hardcoded PlanOverrides booleans (excludePrediabetes /
 * requiresInsulinForDiabetes / bypassBenignTumors — types.ts) with
 * equivalent rows in the new `plan_restrictions` table (schema.ts,
 * migration 0045), without changing any plan's current valid declaration
 * behaviour. See engine.ts's hasActiveRestriction/isCategoryRestrictedForPed
 * doc comments for how these rows are evaluated at match time, and
 * planRestrictionsRepository.ts for the table's shape.
 *
 * SOURCE OF TRUTH FOR "WHAT'S TRUE TODAY" (per the explicit instruction this
 * migration was scoped against: "not guessable from the hardcoded seed"):
 *  - If a plan has a live `plan_configs` DB row, its `overrides` COLUMN is
 *    authoritative — even if that differs from the hardcoded getPlanConfig()
 *    default for a plan of the same name (dbRowToPlanConfig never merges
 *    the two; a DB row's overrides fully replace the hardcoded default the
 *    moment that row exists — see server.ts's /api/match).
 *  - Only when a plan has NO `plan_configs` row at all (still 100% on the
 *    hardcoded bootstrap seed) does the hardcoded `overrides` object in
 *    types.ts apply.
 * This script reads BOTH and resolves the effective value per plan exactly
 * the way engine.ts's `config` used to before this refactor.
 *
 * MAPPING (see engine.ts's hasActiveRestriction doc comment):
 *   requiresInsulinForDiabetes -> ("diabetes", "require_keywords")
 *   excludePrediabetes         -> ("diabetes", "exclude_keywords")
 *                                  (skipped if requiresInsulinForDiabetes is
 *                                  ALSO true for the same plan — every call
 *                                  site already treats requiresInsulin as a
 *                                  strict superset of excludePrediabetes, so
 *                                  writing both rows would be redundant, not
 *                                  incorrect, but this keeps the migrated
 *                                  data minimal and easy to audit)
 *   bypassBenignTumors          -> ("benign_growth", "block_category")
 *
 * Keyword lists mirror the exact regexes engine.ts's own call sites already
 * test against the SAME flags (see hasInsulinOrType1/isGestationalOrType2 in
 * the "G. GESTATIONAL & TYPE 2 DIABETES INTERCEPT COUPLING" block and the
 * prediabetes regex in "H. PREDIABETES PLAN-AWARE INTERCEPT") — chosen for
 * consistency with applyPostGuards' diabetes post-guard, which is the one
 * call site that actually evaluates a migrated row's keywords against real
 * PED text via isCategoryRestrictedForPed (every other call site only
 * checks whether an active row of that category+mode exists at all, via
 * hasActiveRestriction, and keeps its own pre-existing regex logic
 * untouched).
 *
 * IDEMPOTENT: skips a (planName, categoryKey, mode) combination that
 * already has an active row, so re-running after a partial/failed run, or
 * after an admin has since edited these restrictions by hand, never creates
 * duplicates or clobbers manual edits.
 *
 * SAFETY: does NOT touch or clear plan_configs.overrides — that column
 * stays in place as a historical record until task #146 (removing the now-
 * dead hardcoded engine.ts blocks + old checkbox UI) explicitly retires it.
 * classifyDeterministic/applyPostGuards no longer read it (see engine.ts) —
 * see task #146 in this task's tracking for that follow-up.
 *
 * USAGE
 *   npx tsx scripts/migratePlanRestrictions.ts           # dry run, prints a summary
 *   npx tsx scripts/migratePlanRestrictions.ts --commit   # actually writes
 */

import dotenv from "dotenv";
import { getDb, closeDb } from "../src/server/db/client.js";
import { createRepositories } from "../src/server/db/repositories/index.js";
import { getPlanConfig } from "../src/types.js";

dotenv.config();

const COMMIT = process.argv.includes("--commit");
const MIGRATION_ACTOR = "system-migration:plan_restrictions";

const SEVERE_DIABETES_KEYWORDS = [
  "type 1",
  "type-1",
  "typei",
  "type i",
  "t1dm",
  "t1d",
  "insulin",
  "blindness",
  "blind",
  "foot ulcer",
  "chronic foot ulcer",
];

const PREDIABETES_KEYWORDS = [
  "pre-diabetes",
  "prediabetes",
  "pre diabetes",
  "borderline diabetes",
  "impaired fasting glucose",
  "impaired glucose tolerance",
];

type PlannedRow = {
  planName: string;
  categoryKey: string;
  mode: "require_keywords" | "exclude_keywords" | "block_category";
  keywords: string[];
  explanation: string;
  sourceFlag: string;
};

async function main() {
  const db = getDb();
  const { planConfigs, planRestrictions } = createRepositories(db);

  const hardcodedPlans = getPlanConfig();
  const dbRows = await planConfigs.list();
  const dbRowByPlan = new Map(dbRows.map((r) => [r.planName, r]));

  const planNames = new Set<string>([...Object.keys(hardcodedPlans), ...dbRows.map((r) => r.planName)]);

  const planned: PlannedRow[] = [];
  const skippedNoOverrides: string[] = [];

  for (const planName of planNames) {
    const dbRow = dbRowByPlan.get(planName);
    // A removed plan (Plan Management's Delete action) has no live
    // declaration flow left to protect — don't manufacture restrictions
    // for it either.
    if (dbRow?.removed) continue;

    // Live source of truth per plan: the DB row's own `overrides` column
    // once a plan_configs row exists at all, else the hardcoded seed's
    // `overrides` — exactly what engine.ts's `config.overrides` used to
    // resolve to (see dbRowToPlanConfig: it never merges the two).
    const overrides = dbRow
      ? ((dbRow.overrides as { excludePrediabetes?: boolean; requiresInsulinForDiabetes?: boolean; bypassBenignTumors?: boolean } | null) || {})
      : (hardcodedPlans[planName]?.overrides || {});

    if (!overrides.requiresInsulinForDiabetes && !overrides.excludePrediabetes && !overrides.bypassBenignTumors) {
      skippedNoOverrides.push(planName);
      continue;
    }

    if (overrides.requiresInsulinForDiabetes) {
      planned.push({
        planName,
        categoryKey: "diabetes",
        mode: "require_keywords",
        keywords: SEVERE_DIABETES_KEYWORDS,
        explanation:
          "This plan's diabetes question applies only to confirmed diagnoses or specified severe conditions: Type 1 Diabetes, diabetes on insulin, or connected with blindness/ulcers. Anything else routes to the 'Others' section.",
        sourceFlag: "requiresInsulinForDiabetes",
      });
    } else if (overrides.excludePrediabetes) {
      // Only when requiresInsulinForDiabetes is NOT also true — see the
      // header comment above for why that combination is skipped as
      // redundant rather than migrated as two rows.
      planned.push({
        planName,
        categoryKey: "diabetes",
        mode: "exclude_keywords",
        keywords: PREDIABETES_KEYWORDS,
        explanation:
          "This plan's diabetes question applies only to confirmed diagnoses, not elevated blood sugar findings. Prediabetes does not qualify and should be declared under the 'Others' section.",
        sourceFlag: "excludePrediabetes",
      });
    }

    if (overrides.bypassBenignTumors) {
      planned.push({
        planName,
        categoryKey: "benign_growth",
        mode: "block_category",
        keywords: [],
        explanation: "This plan's primary question strictly targets malignant cancers. Benign growths map to the 'Others' section.",
        sourceFlag: "bypassBenignTumors",
      });
    }
  }

  console.log(`Plans considered: ${planNames.size}`);
  console.log(`Plans with no active overrides (nothing to migrate): ${skippedNoOverrides.length} [${skippedNoOverrides.join(", ")}]`);
  console.log(`\nPlanned plan_restrictions rows: ${planned.length}`);

  const toCreate: PlannedRow[] = [];
  const alreadyExists: PlannedRow[] = [];

  for (const row of planned) {
    const existing = await planRestrictions.listForPlan(row.planName);
    const hasMatch = existing.some((r) => r.categoryKey === row.categoryKey && r.mode === row.mode);
    if (hasMatch) {
      alreadyExists.push(row);
    } else {
      toCreate.push(row);
    }
  }

  console.log("\n--- Summary ---");
  for (const row of planned) {
    const status = alreadyExists.includes(row) ? "ALREADY EXISTS (skipping)" : "TO CREATE";
    console.log(`  [${status}] "${row.planName}" -- ${row.sourceFlag} -> categoryKey="${row.categoryKey}" mode="${row.mode}"`);
  }
  console.log(`\nTo create: ${toCreate.length}. Already present (idempotent skip): ${alreadyExists.length}.`);

  if (!COMMIT) {
    console.log("\nDry run only — no writes made. Re-run with --commit to apply.");
    await closeDb();
    return;
  }

  console.log(`\nWriting ${toCreate.length} row(s)...`);
  for (const row of toCreate) {
    await planRestrictions.create({
      planName: row.planName,
      categoryKey: row.categoryKey,
      mode: row.mode,
      keywords: row.keywords,
      explanation: row.explanation,
      isActive: true,
      createdBy: MIGRATION_ACTOR,
      updatedBy: MIGRATION_ACTOR,
    });
    console.log(`  Created: "${row.planName}" / ${row.categoryKey} / ${row.mode}`);
  }
  console.log("Done.");
  await closeDb();
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Migration failed:", err);
    process.exit(1);
  });
