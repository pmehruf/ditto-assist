/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * PED REPOSITORY DB MIGRATION — repository health / stats snapshot.
 * Read-only. Prints the counts needed for the Phase 5 cutover report and
 * the permanent Migration Completion Report: PEDs (by status), aliases (by
 * visibility), plan overrides, categories, collision guardrails, and recent
 * mapping_history activity.
 *
 * USAGE
 *   npx tsx scripts/migrationStats.ts
 */

import dotenv from "dotenv";
import { getDb, closeDb } from "../src/server/db/client.js";
import { createRepositories } from "../src/server/db/repositories/index.js";

dotenv.config();

async function main() {
  const db = getDb();
  const repos = createRepositories(db);

  const [peds, aliases, planOverrides, categories, collisions, history] = await Promise.all([
    repos.pedRepository.list(),
    repos.pedAliases.listAll(),
    repos.planOverrides.listAll(),
    repos.categories.list(),
    repos.collisions.list(),
    repos.mappingHistory.list(1000),
  ]);

  const pedsByStatus: Record<string, number> = {};
  for (const p of peds) pedsByStatus[p.status ?? "(null)"] = (pedsByStatus[p.status ?? "(null)"] || 0) + 1;

  const pedsWithoutCategory = peds.filter((p) => p.status !== "deprecated" && !p.categoryKey).length;

  const visibleAliases = aliases.filter((a) => a.isVisible).length;
  const hiddenAliases = aliases.length - visibleAliases;

  const activeCollisions = collisions.filter((c) => c.active).length;

  const overridesByPlan: Record<string, number> = {};
  for (const o of planOverrides) overridesByPlan[o.planName] = (overridesByPlan[o.planName] || 0) + 1;

  console.log("=== PED Repository — health snapshot ===\n");
  console.log(`PEDs (ped_repository): ${peds.length} total`);
  for (const [status, count] of Object.entries(pedsByStatus)) console.log(`  - ${status}: ${count}`);
  console.log(`  - active PEDs missing a categoryKey: ${pedsWithoutCategory}${pedsWithoutCategory > 0 ? "  <-- worth a look" : ""}`);
  console.log(`\nAliases (ped_aliases): ${aliases.length} total`);
  console.log(`  - visible: ${visibleAliases}`);
  console.log(`  - hidden (normalization layer): ${hiddenAliases}`);
  console.log(`\nCategories (categories): ${categories.length}`);
  console.log(`\nPlan overrides (plan_overrides): ${planOverrides.length} total`);
  for (const [plan, count] of Object.entries(overridesByPlan)) console.log(`  - ${plan}: ${count}`);
  console.log(`\nCollision guardrails (collision_repository): ${collisions.length} total (${activeCollisions} active)`);
  console.log(`\nMapping history (mapping_history): ${history.length} row(s) in most recent 1000 fetched${history.length === 1000 ? " (capped — more exist)" : ""}`);
  const byAction: Record<string, number> = {};
  for (const h of history) byAction[h.action] = (byAction[h.action] || 0) + 1;
  for (const [action, count] of Object.entries(byAction)) console.log(`  - ${action}: ${count}`);

  await closeDb().catch(() => {});
}

main().catch((err) => {
  console.error("migrationStats failed:", err);
  process.exit(1);
});
