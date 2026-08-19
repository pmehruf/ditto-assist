/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * ONE-TIME CORRECTION — scripts/seedAdityaBirlaUrls.ts originally tagged
 * Activ One's 3 shared documents (Policy Wording, Prospectus, Brochure)
 * with the bare plan name "Activ One" in ADDITION to all 7 real variant
 * names (MAX, VYTL, NXT, VIP, VIP+, MAX+, SAVR), and added "Activ One" to
 * the "Aditya Birla" category's plan roster. That surfaced "Activ One" as
 * its own selectable plan in Product Assist and its own "Base plan" section
 * in the admin UI's Plans tab — misleading, since it isn't itself a product
 * an advisor would pick; every variant is already dedicatedly represented.
 *
 * The seed script itself only ever ADDS tags/roster entries and never
 * removes one from an already-seeded resource (see its "!existing" guard),
 * so simply fixing the seed script and re-running it would leave "Activ
 * One" in place on already-seeded data instead of correcting it. This
 * script does the actual removal, in both places the tag lives:
 *   1. kb_categories.plan_names roster for "Aditya Birla" — drops the
 *      "Activ One" entry (the 7 variant entries are untouched).
 *   2. kb_resources.plan_tags — for the 3 shared Activ One resources
 *      (matched by sourceUrl, same URLs as the seed script), drops "Activ
 *      One" from the tag array while leaving all 7 variant tags in place.
 *
 * Once both are gone, the admin UI's plan-family grouping (see
 * KnowledgeBaseResourceManagement.tsx's buildPlanFamilies) naturally stops
 * treating "Activ One" as a family root — each of the 7 variants becomes
 * its own standalone top-level plan entry instead of being nested under a
 * "Base plan" umbrella, which is the intended outcome, not a side effect
 * to work around.
 *
 * Idempotent — finds nothing left to remove on a second run.
 *
 * USAGE
 *   npx tsx scripts/removeAdityaBirlaBareActivOne.ts             # dry run
 *   npx tsx scripts/removeAdityaBirlaBareActivOne.ts --commit    # applies it
 *
 * Requires DATABASE_URL in the environment. Run once against staging and
 * once against production (whichever DATABASE_URL is currently exported).
 */

import dotenv from "dotenv";
import { getDb } from "../src/server/db/client.js";
import { createRepositories } from "../src/server/db/repositories/index.js";

dotenv.config();

const COMMIT = process.argv.includes("--commit");
const INSURER = "Aditya Birla";
const BARE_TAG = "activ one";

// The 3 shared Activ One resources, by sourceUrl — same URLs
// scripts/seedAdityaBirlaUrls.ts uses, so this only ever touches exactly
// those documents regardless of what else may be tagged similarly.
const SHARED_ACTIV_ONE_URLS = new Set([
  "https://www.adityabirlacapital.com/healthinsurance/assets/pdf/ActivOneDocs/ActivOneNXT/ProductInformation/PolicyDocument.pdf",
  "https://www.adityabirlacapital.com/healthinsurance/assets/pdf/ActivOneDocs/ActivOneVYTL/ProductInformation/Prospectus.pdf",
  "https://www.adityabirlacapital.com/healthinsurance/assets/pdf/ActivOneDocs/ActivOneVYTL/ProductInformation/Brochure.pdf",
]);

async function main() {
  const db = getDb();
  const repos = createRepositories(db);

  const categories = await repos.kbCategories.list();
  const category = categories.find(c => c.name.toLowerCase() === INSURER.toLowerCase());
  if (!category) {
    console.log(`No "${INSURER}" category found — nothing to do.`);
    return;
  }

  const rosterHasBare = category.planNames.some(n => n.trim().toLowerCase() === BARE_TAG);
  const newRoster = category.planNames.filter(n => n.trim().toLowerCase() !== BARE_TAG);

  const resources = await repos.kbResources.list();
  const resourceUpdates: { id: number; title: string; from: string[]; to: string[] }[] = [];
  for (const r of resources) {
    if (r.categoryId !== category.id) continue;
    if (!r.sourceUrl || !SHARED_ACTIV_ONE_URLS.has(r.sourceUrl)) continue;
    if (!r.planTags.some(t => t.trim().toLowerCase() === BARE_TAG)) continue;
    resourceUpdates.push({
      id: r.id,
      title: r.title,
      from: r.planTags,
      to: r.planTags.filter(t => t.trim().toLowerCase() !== BARE_TAG),
    });
  }

  console.log(`"${INSURER}" roster: ${rosterHasBare ? 'will remove "Activ One"' : "nothing to remove"}.`);
  console.log(`Resources needing the bare tag removed: ${resourceUpdates.length}`);
  for (const u of resourceUpdates) {
    console.log(`  "${u.title}"`);
    console.log(`    ${JSON.stringify(u.from)} -> ${JSON.stringify(u.to)}`);
  }

  if (!COMMIT) {
    console.log("\nDry run only — nothing written. Re-run with --commit to apply.");
    return;
  }

  if (rosterHasBare) {
    await repos.kbCategories.update(category.id, { planNames: newRoster });
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
    console.error("Correction failed:", err);
    process.exit(1);
  });
