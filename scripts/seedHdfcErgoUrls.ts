/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * ONE-TIME SEED — imports the HDFC ERGO Optima Secure family's dedicated
 * Brochure / Policy Wording / Prospectus documents (and their riders) into
 * the Knowledge Base, via webIngest.ts's URL ingestion (auto-detects PDF
 * vs. ordinary web page per URL, same as seedKnowledgeBaseUrls.ts).
 *
 * Each entry is tagged with documentType (brochure/policy_wording/
 * prospectus/addon) — see 0034_kb_resource_document_type.sql — so
 * queryAssist.ts can apply its Policy Wording > Prospectus > Brochure
 * authority precedence. Rider/add-on documents (ABCD Chronic Care,
 * Limitless, Parenthood, etc.) are tagged "addon" regardless of whether
 * the underlying PDF is itself structured as a policy wording or
 * prospectus, matching scripts/seedCareHealthUrls.ts's convention — an
 * add-on's own contract detail still matters, but it's not competing with
 * the base plan's own PW/Prospectus/Brochure in the precedence ordering.
 *
 * Also sets kb_categories.plan_names for the "HDFC ERGO" category to the
 * full list of plan/rider names below (merged with whatever's already
 * there), so they show up as suggestions in the admin's plan-tagging UI.
 *
 * Idempotent: re-running matches URLs to existing kb_resources by sourceUrl
 * and re-ingests only if the fetched content changed.
 *
 * USAGE
 *   npx tsx scripts/seedHdfcErgoUrls.ts               # dry run, lists what would happen
 *   npx tsx scripts/seedHdfcErgoUrls.ts --commit       # actually fetches, ingests, embeds
 *
 * Requires GEMINI_API_KEY and DATABASE_URL in the environment (.env).
 * Run this AFTER the chunking.ts fix (lossless sentence split) — these are
 * exactly the kind of numbered-clause policy wording documents that bug
 * silently drops text from.
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
const INSURER = "HDFC ERGO";

interface SeedUrl {
  title: string;
  url: string;
  documentType: KbDocumentType;
  /** Empty = applies broadly across HDFC ERGO (matches kb_resources.planTags's convention). */
  planTags?: string[];
}

const URLS: SeedUrl[] = [
  // ── Optima Secure / Optima Secure+ (share the same Policy Wording and
  //    Prospectus document — tagged with both plan names on one resource
  //    each, rather than ingesting the same URL twice) ─────────────────────
  {
    title: "HDFC ERGO Optima Secure — Brochure",
    url: "https://customer-portal-assets.hdfcergo.com/documents/OptimaSecure-BR(18)-761501386357.pdf",
    documentType: "brochure",
    planTags: ["Optima Secure"],
  },
  {
    title: "HDFC ERGO Optima Secure+ — Brochure",
    url: "https://customer-portal-assets.hdfcergo.com/documents/OptimaSecure+A5Leaflet-307611592842.pdf",
    documentType: "brochure",
    planTags: ["Optima Secure+"],
  },
  {
    title: "HDFC ERGO Optima Secure / Optima Secure+ — Policy Wording",
    url: "https://customer-portal-assets.hdfcergo.com/documents/PolicyWordings_myOptimaSecure-76673175551.pdf",
    documentType: "policy_wording",
    planTags: ["Optima Secure", "Optima Secure+"],
  },
  {
    title: "HDFC ERGO Optima Secure / Optima Secure+ — Prospectus",
    url: "https://customer-portal-assets.hdfcergo.com/documents/Prospectus_myOptimaSecure-676203564982.pdf",
    documentType: "prospectus",
    planTags: ["Optima Secure", "Optima Secure+"],
  },

  // ── Energy ──────────────────────────────────────────────────────────────
  {
    title: "HDFC ERGO Energy — Brochure",
    url: "https://customer-portal-assets.hdfcergo.com/assets/v2/docs/default-source/downloads/brochures/onepager_onergy(f)-175900671697.pdf",
    documentType: "brochure",
    planTags: ["Energy"],
  },
  {
    title: "HDFC ERGO Energy — Policy Wording",
    url: "https://customer-portal-assets.hdfcergo.com/documents/energy-combined-pw-cis-919573709506.pdf",
    documentType: "policy_wording",
    planTags: ["Energy"],
  },
  {
    title: "HDFC ERGO Energy — Prospectus",
    url: "https://customer-portal-assets.hdfcergo.com/documents/Energy_Prospectus-612487347347.pdf",
    documentType: "prospectus",
    planTags: ["Energy"],
  },

  // ── my:health Medisure Super Top Up ────────────────────────────────────
  {
    title: "HDFC ERGO my:health Medisure Super Top Up — Brochure",
    url: "https://customer-portal-assets.hdfcergo.com/assets/v2/docs/default-source/downloads/brochures/health-suraksha-top-up-plus-501689357997.pdf",
    documentType: "brochure",
    planTags: ["Medisure Super Top Up"],
  },
  {
    title: "HDFC ERGO my:health Medisure Super Top Up — Policy Wording",
    url: "https://customer-portal-assets.hdfcergo.com/documents/myhealth-medisure-super-top-up-insurance-569138917326.pdf",
    documentType: "policy_wording",
    planTags: ["Medisure Super Top Up"],
  },
  {
    title: "HDFC ERGO my:health Medisure Super Top Up — Prospectus",
    url: "https://customer-portal-assets.hdfcergo.com/documents/myhealthMedisureSuperTopUp-263217038830.pdf",
    documentType: "prospectus",
    planTags: ["Medisure Super Top Up"],
  },

  // ── Optima Secure / Secure+ riders — Prospectus ────────────────────────
  {
    title: "HDFC ERGO Rider: ABCD Chronic Care — Prospectus",
    url: "https://customer-portal-assets.hdfcergo.com/assets/v2/docs/default-source/downloads/prospectus/health/abcd-chronic-care---prospectus-290427732098.pdf",
    documentType: "addon",
    planTags: ["ABCD Chronic Care"],
  },
  {
    title: "HDFC ERGO Rider: Limitless — Prospectus",
    url: "https://customer-portal-assets.hdfcergo.com/documents/Prospectus_Limitless-208396423469.pdf",
    documentType: "addon",
    planTags: ["Limitless"],
  },
  {
    title: "HDFC ERGO Rider: Parenthood — Prospectus",
    url: "https://customer-portal-assets.hdfcergo.com/assets/v2/docs/default-source/downloads/prospectus/health/parenthood-612113942106.pdf",
    documentType: "addon",
    planTags: ["Parenthood"],
  },
  {
    title: "HDFC ERGO Rider: Individual Personal Accident — Prospectus",
    url: "https://customer-portal-assets.hdfcergo.com/assets/v2/docs/default-source/downloads/prospectus/health/ipa-prospectus-118695228056.pdf",
    documentType: "addon",
    planTags: ["Individual Personal Accident"],
  },
  {
    title: "HDFC ERGO Rider: my:health Hospital Cash — Prospectus",
    url: "https://customer-portal-assets.hdfcergo.com/assets/v2/docs/default-source/downloads/prospectus/health/myhealth-suraksha-hospital-cash-add-on-prospectus-8590996678.pdf",
    documentType: "addon",
    planTags: ["my:health Hospital Cash"],
  },
  {
    title: "HDFC ERGO Rider: my:health Critical Illness — Prospectus",
    url: "https://customer-portal-assets.hdfcergo.com/assets/v2/docs/default-source/downloads/prospectus/health/my-health-critical-illness_prospectus-790153722319.pdf",
    documentType: "addon",
    planTags: ["my:health Critical Illness"],
  },
  {
    title: "HDFC ERGO Rider: Unlimited Restore — Prospectus",
    url: "https://customer-portal-assets.hdfcergo.com/documents/Prospectus_UnlimitedRestore(Addon)-567282723831.pdf",
    documentType: "addon",
    planTags: ["Unlimited Restore"],
  },
  {
    title: "HDFC ERGO Rider: Optima Wellbeing — Prospectus",
    url: "https://customer-portal-assets.hdfcergo.com/documents/Prospectus_OptimaWellbeing(Add-on)-902554553429.pdf",
    documentType: "addon",
    planTags: ["Optima Wellbeing"],
  },

  // ── Optima Secure / Secure+ riders — Policy Wordings ───────────────────
  {
    title: "HDFC ERGO Rider: ABCD Chronic Care — Policy Wording",
    url: "https://customer-portal-assets.hdfcergo.com/assets/v2/docs/default-source/downloads/policy-wordings/health/abcd-chronic-care---policy-wordings/abcd-chronic-care---policy-wordings-588300043193.pdf",
    documentType: "addon",
    planTags: ["ABCD Chronic Care"],
  },
  {
    title: "HDFC ERGO Rider: Limitless — Policy Wording",
    url: "https://customer-portal-assets.hdfcergo.com/documents/Policywordings_Limitless-727294559278.pdf",
    documentType: "addon",
    planTags: ["Limitless"],
  },
  {
    title: "HDFC ERGO Rider: Parenthood — Policy Wording",
    url: "https://customer-portal-assets.hdfcergo.com/assets/v2/docs/default-source/downloads/policy-wordings/health/parenthood/parenthood-613771733087.pdf",
    documentType: "addon",
    planTags: ["Parenthood"],
  },
  {
    title: "HDFC ERGO Rider: Individual Personal Accident — Policy Wording",
    url: "https://customer-portal-assets.hdfcergo.com/assets/v2/docs/default-source/downloads/policy-wordings/health/ipa-rider---pww/ipa-rider---pww-819611261262.pdf",
    documentType: "addon",
    planTags: ["Individual Personal Accident"],
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
    console.log(`  [${u.documentType}]  ${u.title}${u.planTags ? `  (plan: ${u.planTags.join(", ")})` : ""}`);
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

  const allPlanNames = Array.from(new Set(URLS.flatMap((u) => u.planTags ?? [])));
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

      if (!existing && u.planTags && u.planTags.length > 0) {
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
