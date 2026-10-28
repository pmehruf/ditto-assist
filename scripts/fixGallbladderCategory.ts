/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * ONE-TIME FIX — ped_repository.category_key for gallbladder/biliary terms
 *
 * Flagged by Ankit Sharma (Optima Secure, 2026-08-11): "Gall bladder
 * removal" was routing to the generic Digestive System question instead
 * of "Liver or Gall Bladder ailment / Jaundice / Hepatitis B or C?".
 * Root cause: these terms were categorized "digestive" instead of
 * "liver" in ped_repository (the live classification source of truth
 * when the database-backed engine — see PED_REPOSITORY_GOVERNANCE.md). Only visibly
 * wrong on Optima Secure today (the only plan where "liver" and
 * "digestive" resolve to two DIFFERENT questions — every other plan
 * currently points both category keys at the same combined question
 * text), but this fixes the underlying data for all plans, present and
 * future. Mirrors the same correction already made to the static
 * TOP_PED_DICTIONARY fallback in src/types.ts and to the DIGESTIVE/LIVER
 * regex sections in src/mapping/helpers.ts.
 *
 * SAFETY
 *  - Only touches rows whose canonicalName exactly matches (case-
 *    insensitive) one of the terms below AND whose current categoryKey
 *    is still what we expect (the wrong value, or null) — never
 *    overwrites a category an admin may have since corrected by hand.
 *  - Reports (and skips) any row whose current categoryKey doesn't
 *    match what's expected, so nothing is silently clobbered.
 *  - "Gallbladder cancer" is deliberately NOT included — that's a
 *    neoplasm/tumor question on every plan, not a liver/gallbladder one.
 *
 * USAGE
 *   npx tsx scripts/fixGallbladderCategory.ts           # dry run, prints a summary
 *   npx tsx scripts/fixGallbladderCategory.ts --commit  # actually writes
 */

import dotenv from "dotenv";
import { getDb } from "../src/server/db/client.js";
import { createRepositories } from "../src/server/db/repositories/index.js";
import { bumpMappingVersionAfterApply } from "./_mappingVersion.js";

dotenv.config();

const COMMIT = process.argv.includes("--commit");

// term (case-insensitive exact canonicalName match) -> [expectedCurrentCategory[], newCategory]
const FIXES: { term: string; expectedCurrent: (string | null)[]; newCategory: string }[] = [
  { term: "cholecystectomy", expectedCurrent: ["digestive"], newCategory: "liver" },
  { term: "gall bladder removal", expectedCurrent: ["digestive"], newCategory: "liver" },
  { term: "gall bladder stone", expectedCurrent: ["digestive"], newCategory: "liver" },
  { term: "gallbladder disease", expectedCurrent: ["digestive"], newCategory: "liver" },
  { term: "gallbladder stone", expectedCurrent: ["digestive"], newCategory: "liver" },
  // Previously uncategorized (null) — clearly liver/gallbladder-system
  // conditions, backfilled while this cluster is already being reviewed.
  { term: "cholecystitis", expectedCurrent: [null], newCategory: "liver" },
  { term: "gallstones", expectedCurrent: [null], newCategory: "liver" },
  { term: "primary biliary cholangitis", expectedCurrent: [null], newCategory: "liver" },
];

async function main() {
  const db = getDb();
  const repos = createRepositories(db);
  const { pedRepository } = repos;

  const allPeds = await pedRepository.list();
  const byNameLower = new Map(allPeds.map((p) => [p.canonicalName.trim().toLowerCase(), p]));

  const toUpdate: { id: number; term: string; from: string | null; to: string }[] = [];
  let notFound = 0;
  let unexpectedCurrent = 0;

  for (const fix of FIXES) {
    const row = byNameLower.get(fix.term.toLowerCase());
    if (!row) {
      console.log(`NOT FOUND in ped_repository: "${fix.term}" — skipping.`);
      notFound++;
      continue;
    }
    if (!fix.expectedCurrent.includes(row.categoryKey)) {
      console.log(
        `SKIPPING "${fix.term}" (${row.pedCode}) — current category is "${row.categoryKey}", expected one of [${fix.expectedCurrent.join(", ")}]. Looks like this was already reviewed/edited — leaving it alone.`
      );
      unexpectedCurrent++;
      continue;
    }
    toUpdate.push({ id: row.id, term: fix.term, from: row.categoryKey, to: fix.newCategory });
  }

  console.log("\n--- Summary ---");
  console.log(`Ready to update: ${toUpdate.length}`);
  console.log(`Not found in ped_repository: ${notFound}`);
  console.log(`Skipped (unexpected current category): ${unexpectedCurrent}`);

  if (toUpdate.length) {
    console.log("\nChanges:");
    for (const u of toUpdate) console.log(`  ${u.term} (id ${u.id}): "${u.from}" -> "${u.to}"`);
  }

  if (!COMMIT) {
    console.log("\nDry run only — no writes made. Re-run with --commit to apply.");
    return;
  }

  console.log(`\nWriting ${toUpdate.length} update(s)...`);
  for (const u of toUpdate) {
    await pedRepository.update(u.id, { categoryKey: u.to });
  }
  await bumpMappingVersionAfterApply(repos);
  console.log("Done.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Fix failed:", err);
    process.exit(1);
  });
