/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * PED REPOSITORY GOVERNANCE — post-merge categoryKey reconciliation
 * (Checkpoint B follow-up, 2026-07-28, bug found by validatePedMigration.ts
 * turning up a new "lost_dictionary_coverage" difference after the entity
 * cleanup apply run).
 *
 * ROOT CAUSE: applyEntityCleanupPlan.ts's "merge_into" treatment reassigns
 * every alias from the losing PED to the winning PED, but never looks at
 * either PED's `categoryKey`. When a losing PED carried a real, meaningful
 * categoryKey (seeded from TOP_PED_DICTIONARY) and the winning PED it got
 * merged into has no categoryKey of its own (an uncategorized pre-existing
 * duplicate row), that categorization is silently dropped: the alias still
 * resolves to a PED, but the PED resolves to nothing, so classifyDeterministic
 * falls all the way through to `return null` instead of the FALLBACK
 * "declare under Others" legacy used to give.
 *
 * Concretely: PED-000118 "Weils disease" (categoryKey "acute_infection") was
 * merged into PED-001033 "Leptospirosis" (categoryKey presumably null). The
 * "Weil's disease" alias now points at Leptospirosis, but Leptospirosis's
 * own categoryKey governs resolution — and it has none, so DB returns
 * null across all 6 plans where legacy correctly fell back to "Others".
 *
 * FIX (this script): find every PED_repository row that is `status =
 * deprecated` with a `merged_into_id` set (i.e. every merge this project
 * has ever performed, not just the latest batch), and where the winning
 * PED's categoryKey is null/empty while the losing PED's categoryKey is
 * not. Backfill the winning PED's categoryKey from the losing one and
 * record mapping_history. Never overwrites a winning PED's EXISTING
 * categoryKey — the winning PED's own categorization always takes
 * precedence if it has one; this only fills a genuine gap.
 *
 * USAGE
 *   npx tsx scripts/reconcileMergedCategoryKeys.ts             (dry-run)
 *   npx tsx scripts/reconcileMergedCategoryKeys.ts --apply
 */

import dotenv from "dotenv";
import { getDb, closeDb } from "../src/server/db/client.js";
import { createRepositories } from "../src/server/db/repositories/index.js";

dotenv.config();

const APPLY = process.argv.includes("--apply");

async function main() {
  const db = getDb();
  const repos = createRepositories(db);

  const allPeds = await repos.pedRepository.list();
  const byId = new Map(allPeds.map((p) => [p.id, p]));

  const deprecatedWithMerge = allPeds.filter((p) => p.status === "deprecated" && p.mergedIntoId != null);

  console.log(`Scanned ${allPeds.length} PEDs, found ${deprecatedWithMerge.length} deprecated/merged row(s).`);

  let candidates = 0;
  let applied = 0;
  const skipped: string[] = [];

  for (const losing of deprecatedWithMerge) {
    const winning = byId.get(losing.mergedIntoId!);
    if (!winning) {
      skipped.push(`${losing.pedCode} "${losing.canonicalName}": merged_into_id ${losing.mergedIntoId} not found — skipped`);
      continue;
    }
    const losingHasCategory = !!losing.categoryKey;
    const winningHasCategory = !!winning.categoryKey;

    if (!losingHasCategory) continue; // nothing to reconcile
    if (winningHasCategory) continue; // winning PED's own categorization wins, untouched

    candidates++;
    console.log(
      `[reconcile] ${winning.pedCode} "${winning.canonicalName}" has no categoryKey; ` +
        `inheriting "${losing.categoryKey}" from merged PED ${losing.pedCode} "${losing.canonicalName}"`
    );

    if (APPLY) {
      await repos.pedRepository.update(winning.id, { categoryKey: losing.categoryKey! });
      await repos.mappingHistory.record({
        pedId: winning.id,
        entityType: "ped",
        action: "updated",
        previousValue: { categoryKey: null },
        newValue: { categoryKey: losing.categoryKey },
        reason: `Post-merge categoryKey reconciliation (2026-07-28): ${winning.pedCode} had no categoryKey after absorbing ${losing.pedCode} ("${losing.canonicalName}")'s aliases; inherited that PED's categoryKey since it was the only one of the two carrying real classification. Found via validatePedMigration.ts turning up a new lost_dictionary_coverage difference for "Weil's disease" after the entity-cleanup merge.`,
        performedBy: "reconcile-merged-category-keys-script",
      });
      applied++;
    }
  }

  console.log(`\n${APPLY ? "APPLIED" : "DRY-RUN"} categoryKey reconciliation.`);
  console.log(`Candidates found: ${candidates}, Applied: ${applied}`);
  if (skipped.length) {
    console.log("Skipped:");
    for (const s of skipped) console.log(`  - ${s}`);
  }

  await closeDb();
}

main().catch((err) => {
  console.error("CategoryKey reconciliation failed:", err);
  process.exit(1);
});
