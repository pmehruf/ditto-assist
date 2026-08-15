/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * ONE-TIME SEED — copies the (insurer, plan) pairs already synced into
 * `kb_playbook_plan_facts` (from the Product Playbook's "Ditto's
 * Recommended Policies" tab) into each matching `kb_categories.planNames`
 * array, so those plan names show up as ready-made tagging suggestions in
 * Knowledge Base Management / the Product Assist plan filter — without
 * clicking "Add" once per plan by hand.
 *
 * Matching insurer name -> category is loose (either string contains the
 * other, case-insensitive), same convention
 * kbPlaybookPlanFactsRepository.findMatching already uses at query time —
 * so "HDFC Ergo" (Playbook) matches a "HDFC ERGO" category.
 *
 * Only ADDS plan names; never removes or overwrites an existing one, and
 * skips a plan name that's already present (case-insensitive) on that
 * category. Safe to re-run.
 *
 * USAGE
 *   npx tsx scripts/seedKbCategoryPlanNamesFromPlaybook.ts             # dry run, lists what would happen
 *   npx tsx scripts/seedKbCategoryPlanNamesFromPlaybook.ts --commit    # actually updates kb_categories
 */

import dotenv from "dotenv";
import { getDb } from "../src/server/db/client.js";
import { createRepositories } from "../src/server/db/repositories/index.js";

dotenv.config();

const COMMIT = process.argv.includes("--commit");

function insurerMatches(playbookInsurer: string, categoryName: string): boolean {
  const a = playbookInsurer.trim().toLowerCase();
  const b = categoryName.trim().toLowerCase();
  return a.includes(b) || b.includes(a);
}

async function main() {
  const db = getDb();
  const repos = createRepositories(db);

  const [categories, planFacts] = await Promise.all([repos.kbCategories.list(), repos.kbPlaybookPlanFacts.listAll()]);

  if (planFacts.length === 0) {
    console.log("No rows in kb_playbook_plan_facts — sync the Product Playbook first (Knowledge Base Management -> Resync now).");
    return;
  }

  // Distinct (insurerName, planName) pairs — the plan_facts table can have
  // multiple rows per plan (one per feature row parsed from the sheet).
  const distinctPairs = new Map<string, { insurerName: string; planName: string }>();
  for (const f of planFacts) {
    const key = `${f.insurerName.toLowerCase()}::${f.planName.toLowerCase()}`;
    if (!distinctPairs.has(key)) distinctPairs.set(key, { insurerName: f.insurerName, planName: f.planName });
  }

  console.log(`Found ${distinctPairs.size} distinct (insurer, plan) pair(s) synced from the Playbook.\n`);

  type PlannedAdd = { categoryId: number; categoryName: string; planName: string };
  const planned: PlannedAdd[] = [];
  const unmatched: string[] = [];

  for (const { insurerName, planName } of distinctPairs.values()) {
    const category = categories.find((c) => insurerMatches(insurerName, c.name));
    if (!category) {
      unmatched.push(`${insurerName} — ${planName}`);
      continue;
    }
    const alreadyPresent = category.planNames.some((n) => n.toLowerCase() === planName.toLowerCase());
    if (alreadyPresent) continue;
    planned.push({ categoryId: category.id, categoryName: category.name, planName });
  }

  if (planned.length === 0) {
    console.log("Nothing to add — every synced plan is already present on its category.");
  } else {
    console.log("Planned additions:");
    for (const p of planned) console.log(`  [${p.categoryName}]  + "${p.planName}"`);
    console.log();
  }

  if (unmatched.length > 0) {
    console.log(`No matching kb_categories row for ${unmatched.length} pair(s) (insurer name doesn't match any category — create the category first if needed):`);
    for (const u of unmatched) console.log(`  ${u}`);
    console.log();
  }

  if (!COMMIT) {
    console.log("Dry run only — no categories updated. Re-run with --commit to apply.");
    return;
  }

  // Group planned additions by category so each category is updated once.
  const byCategory = new Map<number, PlannedAdd[]>();
  for (const p of planned) {
    if (!byCategory.has(p.categoryId)) byCategory.set(p.categoryId, []);
    byCategory.get(p.categoryId)!.push(p);
  }

  for (const [categoryId, adds] of byCategory) {
    const category = categories.find((c) => c.id === categoryId)!;
    const nextNames = [...category.planNames, ...adds.map((a) => a.planName)];
    await repos.kbCategories.update(categoryId, { planNames: nextNames });
    console.log(`Updated "${category.name}": +${adds.length} plan name(s), now ${nextNames.length} total.`);
  }

  console.log("\nDone.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Seed failed:", err);
    process.exit(1);
  });
