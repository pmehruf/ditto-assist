/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * ONE-TIME CORRECTION — scripts/seedNivaBupaUrls.ts originally seeded Niva
 * Bupa's newest ReAssure tier as "ReAssure30" (no space) instead of the real
 * product name, "ReAssure 3.0". The seed script itself only ever ADDS plan
 * names/tags (see its mergePlanNames + "!existing" guard) and never renames
 * an already-seeded resource's planTags, so simply fixing the seed script
 * and re-running it would leave the old "ReAssure30"-named entries in place
 * alongside new "ReAssure 3.0" ones instead of correcting them. This script
 * does the actual rename, in both places the old name lives:
 *   1. kb_categories.plan_names roster for "Niva Bupa" — renames the 3
 *      entries in place (preserves position, doesn't just append).
 *   2. kb_resources.plan_tags — for every Niva Bupa resource whose tags
 *      include one of the old names, swaps it for the new one.
 *
 * Idempotent — finds nothing left to rename on a second run.
 *
 * USAGE
 *   npx tsx scripts/renameNivaBupaReassure3.ts             # dry run
 *   npx tsx scripts/renameNivaBupaReassure3.ts --commit    # applies it
 *
 * Requires DATABASE_URL in the environment. Run once against staging and
 * once against production (whichever DATABASE_URL is currently exported).
 */

import dotenv from "dotenv";
import { getDb } from "../src/server/db/client.js";
import { createRepositories } from "../src/server/db/repositories/index.js";

dotenv.config();

const COMMIT = process.argv.includes("--commit");
const INSURER = "Niva Bupa";

// old name (lowercased match) -> correct name
const RENAMES: Record<string, string> = {
  "reassure30": "ReAssure 3.0",
  "reassure30 unlimited": "ReAssure 3.0 Unlimited",
  "reassure30 limited": "ReAssure 3.0 Limited",
};

function renameOne(name: string): string {
  return RENAMES[name.trim().toLowerCase()] ?? name;
}

async function main() {
  const db = getDb();
  const repos = createRepositories(db);

  const categories = await repos.kbCategories.list();
  const category = categories.find(c => c.name.toLowerCase() === INSURER.toLowerCase());
  if (!category) {
    console.log(`No "${INSURER}" category found — nothing to do.`);
    return;
  }

  // 1. Roster rename (in place, dedupe if the correct name is already present).
  const renamedRoster: string[] = [];
  for (const name of category.planNames) {
    const renamed = renameOne(name);
    if (!renamedRoster.some(n => n.toLowerCase() === renamed.toLowerCase())) renamedRoster.push(renamed);
  }
  const rosterChanged = JSON.stringify(renamedRoster) !== JSON.stringify(category.planNames);

  // 2. Resource plan_tags rename.
  const resources = await repos.kbResources.list();
  const categoryResources = resources.filter(r => r.categoryId === category.id);
  const resourceUpdates: { id: number; title: string; from: string[]; to: string[] }[] = [];
  for (const r of categoryResources) {
    const newTags: string[] = [];
    let changed = false;
    for (const tag of r.planTags) {
      const renamed = renameOne(tag);
      if (renamed !== tag) changed = true;
      if (!newTags.some(n => n.toLowerCase() === renamed.toLowerCase())) newTags.push(renamed);
    }
    if (changed) resourceUpdates.push({ id: r.id, title: r.title, from: r.planTags, to: newTags });
  }

  console.log(`"${INSURER}" roster: ${rosterChanged ? `will rename ${category.planNames.filter(n => renameOne(n) !== n).join(", ")}` : "nothing to rename"}.`);
  console.log(`Resources needing a plan_tags rename: ${resourceUpdates.length}`);
  for (const u of resourceUpdates) {
    console.log(`  "${u.title}"`);
    console.log(`    ${JSON.stringify(u.from)} -> ${JSON.stringify(u.to)}`);
  }

  if (!COMMIT) {
    console.log("\nDry run only — nothing written. Re-run with --commit to apply.");
    return;
  }

  if (rosterChanged) {
    await repos.kbCategories.update(category.id, { planNames: renamedRoster });
    console.log(`Updated "${INSURER}" roster.`);
  }
  for (const u of resourceUpdates) {
    await repos.kbResources.update(u.id, { planTags: u.to });
  }
  console.log(`Updated ${resourceUpdates.length} resource(s).`);
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error("Rename failed:", err);
    process.exit(1);
  });
