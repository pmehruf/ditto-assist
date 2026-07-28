/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * PED REPOSITORY DB MIGRATION — Phase 4 cutover validation script.
 * See PED_REPOSITORY_DB_MIGRATION_DESIGN.md §5 ("Cutover validation report
 * (hard gate)") for the full design this implements.
 *
 * Runs the FULL /api/match pipeline (classifyDeterministic -> sanitizeOutput
 * -> applyPostGuards -> finalizeOutput) twice for every (searchable PED
 * text, plan) pair — once against the legacy path (TOP_PED_DICTIONARY +
 * ped_mapping_overrides + the 4 hardcoded plan-specific blocks, exactly as
 * running in production today) and once against the DB-backed path
 * (src/server/pedRuntimeCache.ts, populated entirely from ped_repository /
 * ped_aliases / plan_overrides) — and records every case where match_type
 * or matched_question differs between the two.
 *
 * Broader than the design doc's literal "every ped_repository row": tests
 * every ALIAS (not just each PED's canonical name), since a real advisor
 * types whatever synonym occurs to them, not necessarily the canonical
 * form — canonical-name-only coverage would silently under-test the exact
 * thing this migration changes (alias resolution).
 *
 * SAFETY: strictly read-only. Never writes to any table. Never mutates
 * TOP_PED_DICTIONARY beyond the same in-place ped_mapping_overrides merge
 * ensurePedOverridesLoaded already does for every real request.
 *
 * USAGE
 *   npx tsx scripts/validatePedMigration.ts [--out <dir>]
 *
 * Writes <out>/migration-validation-report.json (full machine-readable
 * report) and <out>/migration-validation-summary.md (grouped-by-cause
 * human summary). Exits with a non-zero code if any UNEXPLAINED difference
 * (see "likelyCause" below) is found, so this can also gate a CI step later
 * if wanted — right now it's advisory, read by a human before Checkpoint B.
 */

import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { getDb, closeDb } from "../src/server/db/client.js";
import { createRepositories } from "../src/server/db/repositories/index.js";
import { getPlanConfig, type PlanConfig } from "../src/types.js";
import { classifyDeterministic, sanitizeOutput, applyPostGuards, finalizeOutput, type DbDictionarySource } from "../src/engine.js";
import { ensurePedOverridesLoaded } from "../src/server/pedMappingLive.js";
import { ensurePedRuntimeCacheLoaded, getDbAliasLookup, planOverrideLookup } from "../src/server/pedRuntimeCache.js";
import { dbRowToPlanConfig } from "../src/server/planConfigUtils.js";

dotenv.config();

// Signature string engine.ts's DB-backed generic plan-override branch
// stamps onto its explanation (see src/engine.ts, "DB-BACKED GENERIC PLAN
// OVERRIDE") — used purely to classify differences by likely cause below,
// never to change any routing decision.
const DB_PLAN_OVERRIDE_MARKER = "(PED Repository, plan override)";

interface RunResult {
  matchType: string | null;
  matchedQuestion: string | null;
  explanation: string | null;
}

interface Difference {
  pedId: number;
  pedCode: string;
  canonicalName: string;
  aliasText: string;
  planName: string;
  legacy: RunResult;
  db: RunResult;
  likelyCause: string;
}

interface ValidationReport {
  generatedAt: string;
  totalPeds: number;
  totalAliases: number;
  totalPlans: number;
  totalPairsCompared: number;
  totalDifferences: number;
  differencesByLikelyCause: Record<string, number>;
  unexplainedCount: number;
  differences: Difference[];
}

function runPipeline(
  pedText: string,
  planName: string,
  config: PlanConfig,
  dbSource: DbDictionarySource | null
): RunResult {
  let output = classifyDeterministic(pedText, planName, config, dbSource ?? undefined);
  if (!output) return { matchType: null, matchedQuestion: null, explanation: null };
  output = sanitizeOutput(output, pedText, config);
  output = applyPostGuards(output, pedText, planName, config);
  const final = finalizeOutput(output, pedText, config, config.questions);
  return {
    matchType: final.match_type ?? null,
    matchedQuestion: final.matched_question ?? null,
    explanation: final.explanation ?? null,
  };
}

/**
 * Classifies a difference by likely cause, so the report can be scanned in
 * groups ("N differences are all X") instead of read row-by-row. Every
 * bucket is a hypothesis based on observable signals (the DB marker string,
 * null-vs-non-null), not a guarantee — a human still reviews each group
 * before Checkpoint B, per the design doc. "unexplained" is the bucket that
 * actually needs investigation; everything else is a named, expected
 * category of change.
 */
function classifyCause(legacy: RunResult, db: RunResult): string {
  const dbFiredPlanOverride = !!db.explanation?.includes(DB_PLAN_OVERRIDE_MARKER);
  const legacyNull = legacy.matchType === null;
  const dbNull = db.matchType === null;

  if (dbFiredPlanOverride) {
    // The new generic plan_overrides row resolved this pair; legacy either
    // fell through to a DIFFERENT hardcoded block/regex section, or to
    // null (AI fallback) — i.e. this alias/plan combo has real DB
    // plan-override coverage that the old hardcoded regex simply didn't
    // reach (e.g. a synonym not in the hardcoded block's word list).
    return "new_plan_override_coverage";
  }
  if (legacyNull && !dbNull) return "new_dictionary_coverage"; // DB alias resolves this term; legacy dictionary/regex never did
  if (!legacyNull && dbNull) return "lost_dictionary_coverage"; // legacy resolved it; DB alias set doesn't have this term/category yet
  if (legacyNull && dbNull) return "both_null_but_flagged"; // shouldn't happen — both null means no difference to record
  return "category_mismatch"; // both resolved, to a genuinely different question/match_type — needs a close look
}

async function main() {
  const outArgIdx = process.argv.indexOf("--out");
  const OUT_DIR = outArgIdx >= 0 ? process.argv[outArgIdx + 1] : path.join(process.cwd(), "migration-reports");

  const db = getDb();
  const repos = createRepositories(db);

  console.log("Loading legacy dictionary (TOP_PED_DICTIONARY + ped_mapping_overrides)...");
  await ensurePedOverridesLoaded(repos.pedMappingOverrides);

  console.log("Loading DB-backed runtime cache (ped_repository + ped_aliases + plan_overrides)...");
  await ensurePedRuntimeCacheLoaded(repos);
  const dbSource: DbDictionarySource = { aliasLookup: getDbAliasLookup(), planOverrideLookup };

  console.log("Loading plans (hardcoded bootstrap defaults + any DB-authored plans)...");
  const hardcodedPlans = getPlanConfig();
  const dbPlanRows = await repos.planConfigs.list();
  const planNames = new Set<string>([...Object.keys(hardcodedPlans), ...dbPlanRows.map((r) => r.planName)]);
  const configByPlan = new Map<string, PlanConfig>();
  for (const planName of planNames) {
    const dbRow = dbPlanRows.find((r) => r.planName === planName);
    const config = dbRow ? (dbRowToPlanConfig(dbRow) as PlanConfig) : hardcodedPlans[planName];
    if (config) configByPlan.set(planName, config);
  }
  console.log(`Resolved ${configByPlan.size} plans: ${Array.from(configByPlan.keys()).join(", ")}`);

  console.log("Loading every ped_repository row + every ped_aliases row...");
  const pedRows = await repos.pedRepository.list();
  const pedById = new Map(pedRows.map((p) => [p.id, p] as const));
  const aliasRows = await repos.pedAliases.listAll();
  console.log(`${pedRows.length} PEDs, ${aliasRows.length} aliases, ${configByPlan.size} plans -> up to ${aliasRows.length * configByPlan.size} pairs.`);

  const differences: Difference[] = [];
  let totalPairsCompared = 0;

  for (const alias of aliasRows) {
    const ped = pedById.get(alias.pedId);
    if (!ped) continue; // orphaned alias row — shouldn't happen, skip rather than crash the whole run
    for (const [planName, config] of configByPlan) {
      totalPairsCompared++;
      const legacy = runPipeline(alias.aliasText, planName, config, null);
      const dbResult = runPipeline(alias.aliasText, planName, config, dbSource);

      const same = legacy.matchType === dbResult.matchType && legacy.matchedQuestion === dbResult.matchedQuestion;
      if (same) continue;

      differences.push({
        pedId: ped.id,
        pedCode: ped.pedCode,
        canonicalName: ped.canonicalName,
        aliasText: alias.aliasText,
        planName,
        legacy,
        db: dbResult,
        likelyCause: classifyCause(legacy, dbResult),
      });
    }
  }

  const differencesByLikelyCause: Record<string, number> = {};
  for (const d of differences) {
    differencesByLikelyCause[d.likelyCause] = (differencesByLikelyCause[d.likelyCause] || 0) + 1;
  }
  const unexplainedCount = differencesByLikelyCause["category_mismatch"] || 0;

  const report: ValidationReport = {
    generatedAt: new Date().toISOString(),
    totalPeds: pedRows.length,
    totalAliases: aliasRows.length,
    totalPlans: configByPlan.size,
    totalPairsCompared,
    totalDifferences: differences.length,
    differencesByLikelyCause,
    unexplainedCount,
    differences,
  };

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const jsonPath = path.join(OUT_DIR, "migration-validation-report.json");
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));

  const summaryLines: string[] = [];
  summaryLines.push("# PED Repository Migration — Cutover Validation Report (Phase 4)");
  summaryLines.push("");
  summaryLines.push(`Generated: ${report.generatedAt}`);
  summaryLines.push("");
  summaryLines.push(`- PEDs: ${report.totalPeds}`);
  summaryLines.push(`- Aliases tested: ${report.totalAliases}`);
  summaryLines.push(`- Plans tested: ${report.totalPlans}`);
  summaryLines.push(`- (alias, plan) pairs compared: ${report.totalPairsCompared}`);
  summaryLines.push(`- Total differences: ${report.totalDifferences}`);
  summaryLines.push("");
  summaryLines.push("## Differences by likely cause");
  summaryLines.push("");
  for (const [cause, count] of Object.entries(report.differencesByLikelyCause)) {
    summaryLines.push(`- **${cause}**: ${count}`);
  }
  summaryLines.push("");
  summaryLines.push(
    report.unexplainedCount === 0
      ? "**No unexplained differences (category_mismatch).** Every recorded difference falls into a named, expected bucket — still review each bucket by hand before Checkpoint B, but nothing here looks like a silent regression."
      : `**${report.unexplainedCount} unexplained difference(s) (category_mismatch)** — these are the ones to investigate first; everything else has a hypothesis attached. See the JSON report for full detail on each.`
  );
  summaryLines.push("");
  summaryLines.push("## Bucket definitions");
  summaryLines.push("");
  summaryLines.push("- `new_plan_override_coverage`: the DB-backed generic plan_overrides row resolved this (alias, plan) pair; legacy's hardcoded regex block didn't reach it (e.g. a synonym not in the block's word list). Expected — this is the DB-backed path doing its job better, not a regression.");
  summaryLines.push("- `new_dictionary_coverage`: legacy returned null (would have fallen to AI); the DB alias set resolves it deterministically. Expected improvement, but confirm the resolved category is actually correct.");
  summaryLines.push("- `lost_dictionary_coverage`: legacy resolved it; the DB alias set doesn't yet (returns null, would fall to AI). Needs attention — likely a term present in TOP_PED_DICTIONARY/ped_mapping_overrides that the Phase 2 seed script didn't carry over, or a category conflict left deliberately unresolved.");
  summaryLines.push("- `category_mismatch`: both sides resolved, to a genuinely different question or match_type. The bucket that most needs a human look — could be an intentional fix (e.g. exactly the OSA-on-Optima-Secure case that started this whole migration) or a real regression.");
  summaryLines.push("");
  summaryLines.push(`Full per-pair detail: \`${path.basename(jsonPath)}\`.`);

  const summaryPath = path.join(OUT_DIR, "migration-validation-summary.md");
  fs.writeFileSync(summaryPath, summaryLines.join("\n"));

  console.log(`\nWrote:\n  ${jsonPath}\n  ${summaryPath}`);
  console.log(
    `\n${report.totalDifferences} difference(s) out of ${report.totalPairsCompared} pairs compared. ` +
      `By cause: ${Object.entries(differencesByLikelyCause).map(([k, v]) => `${k}=${v}`).join(", ") || "none"}.`
  );

  await closeDb().catch(() => {});
  process.exit(report.unexplainedCount > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Validation script failed:", err);
  process.exit(1);
});
