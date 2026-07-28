/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * PED REPOSITORY DB MIGRATION — Phase 5 production cutover verification.
 *
 * Read-only script exercising a representative, clinically-chosen set of
 * PED terms (the same set reviewed and requested for Phase 5 sign-off)
 * against every configured plan, using the exact same
 * `classifyDeterministic(..., dbSource)` call path `/api/match` uses in
 * production once `PED_SOURCE=db`. Never writes to any table.
 *
 * What this proves, concretely, per term/plan:
 *   - Whether the alias resolved via the DB-backed cache at all (a
 *     PostgreSQL `ped_aliases` row was found for the normalized input) —
 *     direct evidence of requirement #7 ("confirm the application is
 *     reading PEDs, aliases, categories, and plan overrides from
 *     PostgreSQL").
 *   - The resolved `ped_repository.id` / `categoryKey`, and whether a
 *     `plan_overrides` row fired for this (plan, PED) pair (flagged via the
 *     same DB_PLAN_OVERRIDE_MARKER string validatePedMigration.ts uses).
 *   - The final match_type / matched_question / explanation the advisor
 *     would actually see.
 *
 * What this does NOT prove by itself: that legacy TOP_PED_DICTIONARY is
 * never read (see PED_REPOSITORY_GOVERNANCE.md / the Phase 5 cutover report
 * for the static code-path audit of that — the 4 historical hardcoded
 * plan-specific blocks in engine.ts still read it as their OWN fallback,
 * unconditionally, but are only reached when dbSource's plan_override
 * branch does NOT resolve the pair first). This script's per-pair
 * `dbPlanOverrideFired` / `dbAliasFound` flags are the empirical evidence
 * for which branch actually won on each of these representative cases.
 *
 * USAGE
 *   npx tsx scripts/verifyProductionCutover.ts
 */

import dotenv from "dotenv";
import { getDb, closeDb } from "../src/server/db/client.js";
import { createRepositories } from "../src/server/db/repositories/index.js";
import { getPlanConfig, type PlanConfig } from "../src/types.js";
import { classifyDeterministic, sanitizeOutput, applyPostGuards, finalizeOutput, normalizeDictionaryKey, type DbDictionarySource } from "../src/engine.js";
import { ensurePedRuntimeCacheLoaded, getDbAliasLookup, planOverrideLookup } from "../src/server/pedRuntimeCache.js";
import { dbRowToPlanConfig } from "../src/server/planConfigUtils.js";

dotenv.config();

const DB_PLAN_OVERRIDE_MARKER = "(PED Repository, plan override)";

// The representative set requested for Phase 5 sign-off.
const REPRESENTATIVE_TERMS = [
  "Diabetes",
  "Hypertension",
  "Obstructive Sleep Apnea",
  "COPD",
  "CABG",
  "CVA",
  "Bell's palsy",
  "Preeclampsia",
  "Graves disease",
  "Leptospirosis",
  "Weil's disease",
  "Cystoscopy",
  "Peptic ulcer disease",
  "Diabetic foot ulcer",
];

async function main() {
  const db = getDb();
  const repos = createRepositories(db);

  console.log("Loading DB-backed runtime cache (ped_repository + ped_aliases + plan_overrides)...");
  await ensurePedRuntimeCacheLoaded(repos);
  const aliasLookup = getDbAliasLookup();
  console.log(`Cache loaded: ${aliasLookup.size} aliases.`);
  if (aliasLookup.size === 0) {
    console.error("ABORT: DB-backed cache loaded with 0 aliases — cannot verify production searches against an empty cache. Check DATABASE_URL / seeding.");
    await closeDb().catch(() => {});
    process.exit(1);
  }
  const dbSource: DbDictionarySource = { aliasLookup, planOverrideLookup };

  console.log("Loading plans...");
  const hardcodedPlans = getPlanConfig();
  const dbPlanRows = await repos.planConfigs.list();
  const planNames = new Set<string>([...Object.keys(hardcodedPlans), ...dbPlanRows.map((r) => r.planName)]);
  const configByPlan = new Map<string, PlanConfig>();
  for (const planName of planNames) {
    const dbRow = dbPlanRows.find((r) => r.planName === planName);
    const config = dbRow ? (dbRowToPlanConfig(dbRow) as PlanConfig) : hardcodedPlans[planName];
    if (config) configByPlan.set(planName, config);
  }
  console.log(`Resolved ${configByPlan.size} plans: ${Array.from(configByPlan.keys()).join(", ")}\n`);

  let totalChecked = 0;
  let totalResolvedViaDb = 0;
  let totalNull = 0;
  const nullCases: string[] = [];

  for (const term of REPRESENTATIVE_TERMS) {
    const normalized = normalizeDictionaryKey(term);
    const dbEntry = aliasLookup.get(normalized);
    console.log(`\n=== "${term}" ===`);
    if (dbEntry) {
      console.log(`  DB alias found: pedId=${dbEntry.pedId}, categoryKey=${dbEntry.categoryKey ?? "(none)"}`);
    } else {
      console.log(`  DB alias NOT found for normalized key "${normalized}" — will resolve via engine.ts's shared regex/shield sections (still legacy-free of TOP_PED_DICTIONARY, but worth confirming that's expected).`);
    }

    for (const [planName, config] of configByPlan) {
      totalChecked++;
      let output = classifyDeterministic(term, planName, config, dbSource);
      let dbPlanOverrideFired = false;
      if (output) {
        dbPlanOverrideFired = !!output.explanation?.includes(DB_PLAN_OVERRIDE_MARKER);
        output = sanitizeOutput(output, term, config);
        output = applyPostGuards(output, term, planName, config);
        const final = finalizeOutput(output, term, config, config.questions);
        totalResolvedViaDb++;
        const flag = dbPlanOverrideFired ? " [DB plan_override]" : "";
        console.log(`  [${planName}]${flag} ${final.match_type} -> "${final.matched_question}"`);
      } else {
        totalNull++;
        nullCases.push(`"${term}" / ${planName}`);
        console.log(`  [${planName}] NULL (would fall through to AI Memory/Gemini) — UNEXPECTED for a representative sign-off term, investigate.`);
      }
    }
  }

  console.log(`\n\n=== SUMMARY ===`);
  console.log(`Checked ${totalChecked} (term, plan) pairs across ${REPRESENTATIVE_TERMS.length} representative terms and ${configByPlan.size} plans.`);
  console.log(`Resolved deterministically: ${totalResolvedViaDb}. Null (would hit AI): ${totalNull}.`);
  if (nullCases.length) {
    console.log("Null cases:");
    for (const c of nullCases) console.log(`  - ${c}`);
  }

  await closeDb().catch(() => {});
  process.exit(totalNull > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Production cutover verification failed:", err);
  process.exit(1);
});
