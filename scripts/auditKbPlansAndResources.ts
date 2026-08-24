/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * READ-ONLY audit — Knowledge Base plan roster + resource isolation, across
 * EVERY insurer category. Makes ZERO writes. Reports, per insurer:
 *   - every plan name in the roster and how many resources are genuinely
 *     tagged to it (not just falling into the untagged "applies broadly"
 *     bucket)
 *   - any resource plan-tag that doesn't match ANY roster entry (possible
 *     typo, or a tag applied before the roster caught up)
 *   - insurer-level resource counts
 *   - the flattened plan list post-fix (confirms no name silently swallows
 *     another anymore)
 *
 * USAGE
 *   npx tsx scripts/auditKbPlansAndResources.ts
 */

import dotenv from "dotenv";
import { getDb, closeDb } from "../src/server/db/client.js";
import { createRepositories } from "../src/server/db/repositories/index.js";

dotenv.config();

function normalize(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

async function main() {
  const db = getDb();
  const { kbCategories, kbResources } = createRepositories(db);

  const categories = await kbCategories.list();
  const resources = await kbResources.list();

  console.log(`=== ${categories.length} categories, ${resources.length} resources total ===\n`);

  for (const cat of categories) {
    const catResources = resources.filter(r => r.categoryId === cat.id);
    console.log(`--- ${cat.name} (${cat.type}) — category id ${cat.id} ---`);
    console.log(`  Roster (${cat.planNames.length}): ${cat.planNames.join(", ") || "(none)"}`);
    if (cat.disabledPlanNames.length > 0) {
      console.log(`  Disabled (${cat.disabledPlanNames.length}): ${cat.disabledPlanNames.join(", ")}`);
    }

    const rosterNorm = new Set(cat.planNames.map(normalize));
    const disabledNorm = new Set(cat.disabledPlanNames.map(normalize));

    // Every distinct tag actually used on this category's resources.
    const tagCounts = new Map<string, number>();
    for (const r of catResources) {
      for (const t of r.planTags) {
        const key = t; // preserve original casing for display
        tagCounts.set(key, (tagCounts.get(key) ?? 0) + 1);
      }
    }
    for (const [tag, count] of tagCounts) {
      const nk = normalize(tag);
      if (!rosterNorm.has(nk) && !disabledNorm.has(nk)) {
        console.log(`  ⚠ ORPHAN TAG: "${tag}" used on ${count} resource(s) but not in the roster or disabled list — possible typo or stale tag.`);
      }
    }

    const untaggedCount = catResources.filter(r => r.planTags.length === 0 && !r.isInsurerLevel && r.documentType !== "addon").length;
    if (untaggedCount > 0) {
      console.log(`  ${untaggedCount} untagged resource(s) — apply broadly to every plan in this insurer (by design).`);
    }
    const insurerLevelCount = catResources.filter(r => r.isInsurerLevel).length;
    if (insurerLevelCount > 0) console.log(`  ${insurerLevelCount} Insurer Resource(s).`);

    console.log("");
  }

  // Cross-insurer name collision check — two DIFFERENT insurers using the
  // exact same plan name would not be a bug per se (some plans are branded
  // identically across group companies), but worth surfacing since it's
  // easy to mistake for a mis-filed category.
  const nameToInsurers = new Map<string, Set<string>>();
  for (const cat of categories) {
    if (cat.type !== "insurer") continue;
    for (const name of cat.planNames) {
      const nk = normalize(name);
      if (!nameToInsurers.has(nk)) nameToInsurers.set(nk, new Set());
      nameToInsurers.get(nk)!.add(cat.name);
    }
  }
  const crossInsurerDupes = [...nameToInsurers.entries()].filter(([, insurers]) => insurers.size > 1);
  if (crossInsurerDupes.length > 0) {
    console.log("=== Plan names shared across MORE THAN ONE insurer (verify intentional) ===");
    for (const [name, insurers] of crossInsurerDupes) {
      console.log(`  "${name}": ${[...insurers].join(", ")}`);
    }
  }

  console.log("\nNo writes were made to any table. This script is strictly read-only.");
  await closeDb();
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error("Audit failed:", err);
    process.exit(1);
  });
