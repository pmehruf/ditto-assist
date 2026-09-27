/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * ONE-TIME SEED — imports Care Health's dedicated per-plan Brochure /
 * Prospectus documents (from cms.careinsurance.com) into the Knowledge
 * Base, via webIngest.ts's URL ingestion, tagged with documentType so
 * productAssist.ts can apply the Policy Wording > Prospectus > Brochure
 * authority precedence — see scripts/seedHdfcErgoUrls.ts for the original
 * pattern this follows.
 *
 * NOTE: this batch is Brochure + Prospectus only — Care Health did not
 * provide Policy Wording URLs for these plans. Policy Wording is the
 * HIGHEST-authority document type in productAssist.ts's SOURCE PRECEDENCE
 * (the plan's actual contract language), so until dedicated Policy Wording
 * PDFs are added per plan, Product Assist's Care Health answers for these
 * plans are grounded in Prospectus/Brochure content only — a Prospectus is
 * an IRDAI-mandated summary of the policy, not the contract itself, and a
 * Brochure is marketing material. Flag this to the user before treating
 * these as a complete replacement for the old merged per-plan PDFs.
 *
 * Also sets kb_categories.plan_names for the "Care Health" category to the
 * full list of plan/add-on names below (merged with whatever's already
 * there), so they show up as suggestions in the admin's plan-tagging UI —
 * the "add the plans under each insurer to the list of plans by default"
 * ask.
 *
 * Idempotent: re-running matches URLs to existing kb_resources by sourceUrl
 * and re-ingests only if the fetched content changed.
 *
 * USAGE
 *   npx tsx scripts/seedCareHealthUrls.ts               # dry run, lists what would happen
 *   npx tsx scripts/seedCareHealthUrls.ts --commit       # actually fetches, ingests, embeds
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
const INSURER = "Care Health";

interface SeedUrl {
  title: string;
  url: string;
  documentType: KbDocumentType;
  planTags: string[];
}

const URLS: SeedUrl[] = [
  // ── Ultimate Care ───────────────────────────────────────────────────────
  {
    title: "Care Health Ultimate Care — Prospectus",
    url: "https://cms.careinsurance.com/cms/public/uploads/download_center/ultimate-care---prospectus-cum-sales-literature.pdf?rv=0.01134900%201786956987",
    documentType: "prospectus",
    planTags: ["Ultimate Care"],
  },
  {
    title: "Care Health Ultimate Care — Brochure",
    url: "https://cms.careinsurance.com/cms/public/uploads/download_center/ultimate-care---brochure.pdf?rv=0.01135800%201786956987",
    documentType: "brochure",
    planTags: ["Ultimate Care"],
  },

  // ── Supreme Enhance ─────────────────────────────────────────────────────
  {
    title: "Care Health Supreme Enhance — Prospectus",
    url: "https://cms.careinsurance.com/cms/public/uploads/download_center/supreme-enhance---prospectus-cum-sales-literature.pdf?rv=0.01137100%201786956987",
    documentType: "prospectus",
    planTags: ["Supreme Enhance"],
  },
  {
    title: "Care Health Supreme Enhance — Brochure",
    url: "https://cms.careinsurance.com/cms/public/uploads/download_center/supreme-enhance---brochure.pdf?rv=0.01137700%201786956987",
    documentType: "brochure",
    planTags: ["Supreme Enhance"],
  },

  // ── Care Advantage (two distinct brochures: the plain plan, and the
  //    plan bundled with the Protect Plus + Care Shield add-ons) ──────────
  {
    title: "Care Health Care Advantage (with Add-on Protect Plus & Care Shield) — Brochure",
    url: "https://cms.careinsurance.com/cms/public/uploads/download_center/care-advantage-with-add-on-protect-plus-&-care-shield-brochure.pdf?rv=0.01138300%201786956987",
    documentType: "brochure",
    planTags: ["Care Advantage"],
  },
  {
    title: "Care Health Care Advantage — Prospectus",
    url: "https://cms.careinsurance.com/cms/public/uploads/download_center/care-advantage-(health-insurance-product)--prospectus-cum-sales-literature.pdf?rv=0.01157900%201786956987",
    documentType: "prospectus",
    planTags: ["Care Advantage"],
  },
  {
    title: "Care Health Care Advantage — Brochure",
    url: "https://cms.careinsurance.com/cms/public/uploads/download_center/care-advantage-(health-insurance-product)---brochure.pdf?rv=0.01155300%201786956987",
    documentType: "brochure",
    planTags: ["Care Advantage"],
  },

  // ── Care Supreme (dedicated replacement for the old merged PW+Prospectus
  //    PDF — see chunking.ts's fix; no Policy Wording URL in this batch,
  //    see the file header note) ────────────────────────────────────────
  {
    title: "Care Health Care Supreme — Brochure",
    url: "https://cms.careinsurance.com/cms/public/uploads/download_center/care-supreme---brochure.pdf?rv=0.01143400%201786956987",
    documentType: "brochure",
    planTags: ["Care Supreme"],
  },
  {
    title: "Care Health Care Supreme — Prospectus",
    url: "https://cms.careinsurance.com/cms/public/uploads/download_center/care-supreme---prospectus-cum-sales-literature.pdf?rv=0.01146400%201786956987",
    documentType: "prospectus",
    planTags: ["Care Supreme"],
  },

  // ── Enhance (Top-Up) ────────────────────────────────────────────────────
  {
    title: "Care Health Enhance (Top-Up) — Brochure",
    url: "https://cms.careinsurance.com/cms/public/uploads/download_center/enhance-(top-up-insurance-product)---brochure.pdf?rv=0.01152400%201786956987",
    documentType: "brochure",
    planTags: ["Enhance (Top-Up)"],
  },
  {
    title: "Care Health Enhance (Top-Up) — Prospectus",
    url: "https://cms.careinsurance.com/cms/public/uploads/download_center/enhance-(top-up-insurance-product)--prospectus-cum-sales-literature.pdf?rv=0.01163500%201786956987",
    documentType: "prospectus",
    planTags: ["Enhance (Top-Up)"],
  },

  // ── Care Plus ───────────────────────────────────────────────────────────
  {
    title: "Care Health Care Plus — Brochure",
    url: "https://cms.careinsurance.com/cms/public/uploads/download_center/care-plus-(health-insurance-product)---brochure.pdf?rv=0.01153000%201786956987",
    documentType: "brochure",
    planTags: ["Care Plus"],
  },
  {
    title: "Care Health Care Plus — Prospectus",
    url: "https://cms.careinsurance.com/cms/public/uploads/download_center/care-plus--(health-insurance-product)---prospectus-cum-sales-literature.pdf?rv=0.01156000%201786956987",
    documentType: "prospectus",
    planTags: ["Care Plus"],
  },

  // ── Care Heart ──────────────────────────────────────────────────────────
  {
    title: "Care Health Care Heart — Brochure",
    url: "https://cms.careinsurance.com/cms/public/uploads/download_center/care-heart-(health-insurance-product)---brochure.pdf?rv=0.01153600%201786956987",
    documentType: "brochure",
    planTags: ["Care Heart"],
  },
  {
    title: "Care Health Care Heart — Prospectus",
    url: "https://cms.careinsurance.com/cms/public/uploads/download_center/care-heart-(health-insurance-product)---prospectus-cum-sales-literature.pdf?rv=0.01164800%201786956987",
    documentType: "prospectus",
    planTags: ["Care Heart"],
  },

  // ── Care Freedom (an older Policy Wording for this plan already exists
  //    in the KB from seedKnowledgeBaseUrls.ts, at an S3-hosted URL — a
  //    different resource, not touched by this script) ────────────────────
  {
    title: "Care Health Care Freedom — Brochure",
    url: "https://cms.careinsurance.com/cms/public/uploads/download_center/care-freedom-(health-insurance-product)---brochure.pdf?rv=0.01154200%201786956987",
    documentType: "brochure",
    planTags: ["Care Freedom"],
  },
  {
    title: "Care Health Care Freedom — Prospectus",
    url: "https://cms.careinsurance.com/cms/public/uploads/download_center/care-freedom-(health-insurance-product)---prospectus-cum-sales-literature.pdf?rv=0.01165400%201786956987",
    documentType: "prospectus",
    planTags: ["Care Freedom"],
  },

  // ── Care ────────────────────────────────────────────────────────────────
  {
    title: "Care Health Care — Brochure",
    url: "https://cms.careinsurance.com/cms/public/uploads/download_center/care-(health-insurance-product)---brochure.pdf?rv=0.01154700%201786956987",
    documentType: "brochure",
    planTags: ["Care"],
  },
  {
    title: "Care Health Care — Prospectus",
    url: "https://cms.careinsurance.com/cms/public/uploads/download_center/care-(health-insurance-product)--prospectus-cum-sales-literature.pdf?rv=0.01156600%201786956987",
    documentType: "prospectus",
    planTags: ["Care"],
  },

  // ── Add-ons (Prospectus only — no separate Brochure provided) ──────────
  {
    title: "Care Health Add-on: Care Advanced — Prospectus",
    url: "https://cms.careinsurance.com/cms/public/uploads/download_center/care-advanced---prospectus-cum-sales-literature.pdf?rv=0.01136500%201786956987",
    documentType: "addon",
    planTags: ["Care Advanced"],
  },
  {
    title: "Care Health Add-on: Care OPD — Prospectus",
    url: "https://cms.careinsurance.com/cms/public/uploads/download_center/care-opd---prospectus-cum-sales-literature.pdf?rv=0.01145900%201786956987",
    documentType: "addon",
    planTags: ["Care OPD"],
  },
  {
    title: "Care Health Add-on: Care Shield Add-On — Prospectus",
    url: "https://cms.careinsurance.com/cms/public/uploads/download_center/care-shield-add-on---prospectus-cum-sales-literature.pdf?rv=0.01159800%201786956987",
    documentType: "addon",
    planTags: ["Care Shield Add-On"],
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

  // Populate the category's plan-name suggestion list from every plan/add-on
  // named above, merged with whatever's already there.
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
