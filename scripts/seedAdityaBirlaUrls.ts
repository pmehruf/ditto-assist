/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * ONE-TIME SEED — imports Aditya Birla's dedicated per-plan Policy Wording
 * / Prospectus / Brochure documents into the Knowledge Base, tagged with
 * documentType so queryAssist.ts can apply the Policy Wording > Prospectus
 * > Brochure authority precedence — see scripts/seedHdfcErgoUrls.ts for the
 * original pattern this follows.
 *
 * ACTIV ONE'S SHARED-DOCUMENT STRUCTURE (per the user, verbatim): Activ One
 * has 7 variants — MAX, VYTL, NXT, VIP, VIP+, MAX+, SAVR — that all share
 * the SAME Policy Wording, Prospectus, and Brochure PDFs (each hosted under
 * one variant's own folder path, e.g. ".../ActivOneNXT/...", but the
 * content covers every variant). The Prospectus's own product benefit
 * table is what actually differentiates the variants' benefits, not a
 * separate document per variant. So all three Activ One resources below
 * are tagged with EVERY variant's plan name, not just one — a resource
 * with a single variant's tag would wrongly drop out of retrieval for the
 * other six variants' questions.
 *
 * NO BARE "Activ One" TAG/ROSTER ENTRY: earlier revisions of this script
 * also tagged these 3 resources with the bare plan name "Activ One" and
 * added it to the roster, which surfaced it as its own selectable plan in
 * Product Assist and its own "Base plan" grouping section in the admin UI
 * — misleading, since "Activ One" isn't itself a product an advisor would
 * select; every one of its 7 variants is already dedicatedly represented.
 * See scripts/removeAdityaBirlaBareActivOne.ts for the one-off correction
 * applied to data already seeded under the old tagging.
 *
 * Also sets kb_categories.plan_names for the "Aditya Birla" category to the
 * full list of plan/variant names below (merged with whatever's already
 * there) — the "add the plans under each insurer to the list of plans by
 * default" ask.
 *
 * NOTE: this batch's new "Super Health Plus Top Up — Policy Wording" URL is
 * DIFFERENT from the one seedKnowledgeBaseUrls.ts already added earlier
 * (adityabirlacapital.com/.../Super-Top-Up-Policy-wording.pdf) — different
 * URL means a distinct new kb_resources row, not a replacement of the old
 * one. Both will exist side by side after this runs; worth checking in the
 * admin UI whether the older one is now stale and should be archived.
 *
 * Idempotent: re-running matches URLs to existing kb_resources by sourceUrl
 * and re-ingests only if the fetched content changed.
 *
 * USAGE
 *   npx tsx scripts/seedAdityaBirlaUrls.ts               # dry run, lists what would happen
 *   npx tsx scripts/seedAdityaBirlaUrls.ts --commit       # actually fetches, ingests, embeds
 *
 * Requires GEMINI_API_KEY and DATABASE_URL in the environment (.env).
 */

import dotenv from "dotenv";
import { getDb } from "../src/server/db/client.js";
import { createRepositories } from "../src/server/db/repositories/index.js";
import { ingestUrlResource } from "../src/server/knowledgeBase/webIngest.js";
import { kbDocumentTypeEnum } from "../src/server/db/schema.js";

type KbDocumentType = (typeof kbDocumentTypeEnum.enumValues)[number];

dotenv.config();

const COMMIT = process.argv.includes("--commit");
const SEEDED_BY = "seed-script";
const INSURER = "Aditya Birla";

interface SeedUrl {
  title: string;
  url: string;
  documentType: KbDocumentType;
  planTags: string[];
}

// Activ One's 7 variants — see the file header on why there's no bare
// "Activ One" tag alongside them.
const ACTIV_ONE_VARIANTS = ["Activ One MAX", "Activ One VYTL", "Activ One NXT", "Activ One VIP", "Activ One VIP+", "Activ One MAX+", "Activ One SAVR"];
const ACTIV_ONE_TAGS = [...ACTIV_ONE_VARIANTS];

const URLS: SeedUrl[] = [
  // ── Activ One (7 variants, 3 shared documents — see file header) ───────
  {
    title: "Aditya Birla Activ One (all variants) — Policy Wording",
    url: "https://www.adityabirlacapital.com/healthinsurance/assets/pdf/ActivOneDocs/ActivOneNXT/ProductInformation/PolicyDocument.pdf",
    documentType: "policy_wording",
    planTags: ACTIV_ONE_TAGS,
  },
  {
    title: "Aditya Birla Activ One (all variants) — Prospectus",
    url: "https://www.adityabirlacapital.com/healthinsurance/assets/pdf/ActivOneDocs/ActivOneVYTL/ProductInformation/Prospectus.pdf",
    documentType: "prospectus",
    planTags: ACTIV_ONE_TAGS,
  },
  {
    title: "Aditya Birla Activ One (all variants) — Brochure",
    url: "https://www.adityabirlacapital.com/healthinsurance/assets/pdf/ActivOneDocs/ActivOneVYTL/ProductInformation/Brochure.pdf",
    documentType: "brochure",
    planTags: ACTIV_ONE_TAGS,
  },

  // ── Super Health Plus Top Up ────────────────────────────────────────────
  {
    title: "Aditya Birla Super Health Plus Top Up — Policy Wording",
    url: "https://www.adityabirlacapital.com/healthinsurance/assets/PDF/20251120T070742.pdf",
    documentType: "policy_wording",
    planTags: ["Super Health Plus Top Up"],
  },
  {
    title: "Aditya Birla Super Health Plus Top Up — Prospectus",
    url: "https://www.adityabirlacapital.com/healthinsurance/assets/PDF/20241007T114341.pdf",
    documentType: "prospectus",
    planTags: ["Super Health Plus Top Up"],
  },
  {
    title: "Aditya Birla Super Health Plus Top Up — Brochure",
    url: "https://www.adityabirlacapital.com/healthinsurance/assets/PDF/20240930T180024.pdf",
    documentType: "brochure",
    planTags: ["Super Health Plus Top Up"],
  },

  // ── Activ Fit ───────────────────────────────────────────────────────────
  {
    title: "Aditya Birla Activ Fit — Product Benefit Table",
    url: "https://www.adityabirlacapital.com/healthinsurance/assets/PDF/20250627T084206.pdf",
    documentType: "other",
    planTags: ["Activ Fit"],
  },
  {
    title: "Aditya Birla Activ Fit — Policy Wording",
    url: "https://www.adityabirlacapital.com/healthinsurance/assets/PDF/20250821T102947.pdf",
    documentType: "policy_wording",
    planTags: ["Activ Fit"],
  },
  {
    title: "Aditya Birla Activ Fit — Prospectus",
    url: "https://www.adityabirlacapital.com/healthinsurance/assets/PDF/20250821T055832.pdf",
    documentType: "prospectus",
    planTags: ["Activ Fit"],
  },
  {
    title: "Aditya Birla Activ Fit — Brochure",
    url: "https://www.adityabirlacapital.com/healthinsurance/assets/PDF/20250902T104727.pdf",
    documentType: "brochure",
    planTags: ["Activ Fit"],
  },
];

/** Case-insensitive dedupe, preserving the casing of whichever spelling
 * (existing or new) is added first — mirrors
 * KnowledgeBaseResourceManagement.tsx's addCategoryPlanName convention. */
function mergePlanNames(existing: string[], toAdd: string[]): string[] {
  const merged = [...existing];
  for (const name of toAdd) {
    if (!merged.some(n => n.toLowerCase() === name.toLowerCase())) merged.push(name);
  }
  return merged;
}

async function main() {
  const db = getDb();
  const repos = createRepositories(db);

  console.log(`Planned: ${URLS.length} URL(s) for ${INSURER}.\n`);
  for (const u of URLS) {
    console.log(`  [${u.documentType}]  ${u.title}  (plan: ${u.planTags.join(", ")})`);
    console.log(`      ${u.url}`);
  }
  console.log();

  if (!COMMIT) {
    console.log("Dry run only — nothing fetched or ingested. Re-run with --commit to apply.");
    return;
  }

  if (!process.env.GEMINI_API_KEY) {
    console.error("GEMINI_API_KEY is required to embed chunks — aborting.");
    process.exit(1);
    return;
  }

  const existingCategories = await repos.kbCategories.list();
  let category = existingCategories.find((c) => c.name.toLowerCase() === INSURER.toLowerCase());
  if (!category) {
    category = await repos.kbCategories.create({ name: INSURER, type: "insurer", sortOrder: 0 });
    console.log(`Created category "${INSURER}" (insurer) — it didn't already exist.`);
  }

  const allPlanNames = Array.from(new Set(URLS.flatMap((u) => u.planTags)));
  const mergedPlanNames = mergePlanNames(category.planNames, allPlanNames);
  if (mergedPlanNames.length !== category.planNames.length) {
    const added = mergedPlanNames.filter((n) => !category!.planNames.some((e) => e.toLowerCase() === n.toLowerCase()));
    category = await repos.kbCategories.update(category.id, { planNames: mergedPlanNames });
    console.log(`Added plan name(s) to "${INSURER}": ${added.join(", ")}`);
  }

  const existingResources = await repos.kbResources.list();
  const resourceByUrl = new Map(existingResources.filter((r) => r.sourceUrl).map((r) => [r.sourceUrl as string, r]));

  let succeeded = 0;
  let skipped = 0;
  let failed = 0;

  for (const u of URLS) {
    const existing = resourceByUrl.get(u.url);

    console.log(`Ingesting "${u.title}"...`);
    try {
      const result = await ingestUrlResource(repos, {
        resourceId: existing?.id,
        categoryId: category.id,
        title: u.title,
        url: u.url,
        documentType: u.documentType,
        addedBy: SEEDED_BY,
      });

      if (result.resource.status === "error") {
        console.log(`  ERROR: ${result.resource.errorMessage}`);
        failed++;
        continue;
      }

      if (!existing && u.planTags.length > 0) {
        await repos.kbResources.update(result.resource.id, { planTags: u.planTags });
      }

      if (result.skipped) {
        console.log(`  Unchanged, skipped re-embedding (${result.chunkCount} chunk(s) already stored, detected as ${result.detectedType}).`);
        skipped++;
      } else {
        console.log(`  Embedded ${result.chunkCount} chunk(s) (detected as ${result.detectedType}).`);
        succeeded++;
      }
    } catch (err) {
      console.log(`  ERROR: ${err instanceof Error ? err.message : String(err)}`);
      failed++;
    }
  }

  console.log(`\nDone. ${succeeded} ingested, ${skipped} unchanged, ${failed} failed.`);
  if (failed > 0) {
    console.log("Check the failed entries above — a source blocking automated fetches or a moved URL are the usual causes.");
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Seed failed:", err);
    process.exit(1);
  });
