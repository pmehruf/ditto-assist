/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * ONE-TIME SEED — imports the insurer claim-process guides, glossaries, and
 * hosted policy-wording PDFs the user sourced from NotebookLM into the
 * Knowledge Base ("Ask the Playbook"), via webIngest.ts's URL ingestion
 * (auto-detects PDF vs. ordinary web page per URL). Categorized by the same
 * 4 known insurers seedKnowledgeBasePdfs.ts uses — every URL below is
 * explicitly branded by one of them, so unlike that script there's no
 * "General / Others" fallback needed here.
 *
 * Idempotent: re-running matches URLs to existing kb_resources by sourceUrl
 * and re-ingests only if the fetched content changed (webIngest.ts's
 * contentHash check), so it's safe to re-run after this list changes.
 *
 * USAGE
 *   npx tsx scripts/seedKnowledgeBaseUrls.ts               # dry run, lists what would happen
 *   npx tsx scripts/seedKnowledgeBaseUrls.ts --commit       # actually fetches, ingests, embeds
 *
 * Requires GEMINI_API_KEY in the environment (loaded from .env below).
 *
 * A resource that fails to ingest (e.g. a source blocking automated
 * fetches, or a since-moved URL) is recorded with status "error" and its
 * errorMessage — check the Connections/Knowledge Base admin page after
 * running this, don't assume every row succeeded just because the script
 * didn't throw.
 */

import dotenv from "dotenv";
import { getDb } from "../src/server/db/client.js";
import { createRepositories } from "../src/server/db/repositories/index.js";
import { ingestUrlResource } from "../src/server/knowledgeBase/webIngest.js";

dotenv.config();

const COMMIT = process.argv.includes("--commit");
const SEEDED_BY = "seed-script";

interface SeedUrl {
  insurer: "HDFC ERGO" | "Care Health" | "Aditya Birla" | "Niva Bupa";
  title: string;
  url: string;
  /** Empty = applies broadly across the insurer (matches kb_resources.planTags's convention). */
  planTags?: string[];
}

const URLS: SeedUrl[] = [
  // ── Claims process guides ──────────────────────────────────────────────
  {
    insurer: "HDFC ERGO",
    title: "HDFC ERGO — Claim Process",
    url: "https://www.hdfcergo.com/docs/default-source/documents/claim-process-document.pdf",
  },
  {
    insurer: "Niva Bupa",
    title: "Niva Bupa — Claim Document Checklist",
    url: "https://transactions.nivabupa.com/claims/clientlibs/library/docs/Claim%20Document%20Checklist.pdf",
  },
  {
    insurer: "Niva Bupa",
    title: "Niva Bupa — How to File a Health Insurance Claim",
    url: "https://www.nivabupa.com/health-insurance-articles/how-to-file-claim-for-health-insurance-and-mediclaim.html",
  },
  {
    insurer: "Aditya Birla",
    title: "Aditya Birla — How to Claim Medical/Health Insurance",
    url: "https://www.adityabirlacapital.com/healthinsurance/health-insurance-guide/how-to-claim-medical-health-insurance",
  },
  {
    insurer: "Care Health",
    title: "Care Health — Documents Required While Claiming Health Insurance",
    url: "https://www.careinsurance.com/blog/health-insurance-articles/documents-required-while-claiming-health-insurance",
  },
  // ── Other articles and policy wordings ─────────────────────────────────
  {
    insurer: "Niva Bupa",
    title: "Niva Bupa — Health Insurance Exclusion List (IRDAI)",
    url: "https://www.nivabupa.com/health-insurance-articles/all-about-health-insurance-exclusion-list-updated-from-irdai.html",
  },
  {
    insurer: "Care Health",
    title: "Care Freedom — Policy Wording",
    url: "https://ditto-partners.s3.ap-south-1.amazonaws.com/Care/Care+Freedom-Policy+wording.pdf",
    planTags: ["Care Freedom"],
  },
  {
    insurer: "Aditya Birla",
    title: "Aditya Birla Activ Health — Chronic Management Program",
    url: "https://www.adityabirlacapital.com/healthinsurance/assets/pdf/20210209T052629.pdf",
    planTags: ["Activ Health"],
  },
  {
    insurer: "Aditya Birla",
    title: "Aditya Birla Activ Health — Policy Wording",
    url: "https://www.adityabirlacapital.com/healthinsurance/assets/PDF/20210209T052110.pdf",
    planTags: ["Activ Health"],
  },
  {
    insurer: "Care Health",
    title: "Care Joy Today — Policy Wording",
    url: "https://ditto-partners.s3.ap-south-1.amazonaws.com/Care/Joy+Today-Policy+wording.pdf",
    planTags: ["Joy Today"],
  },
  {
    insurer: "HDFC ERGO",
    title: "HDFC ERGO my:health Medisure Super Top Up — Policy Wording",
    url: "https://www.hdfcergo.com/documents/downloads/policywordings/myhealth_Medisure_Super_Top_Up_Insurance_Policy_Wordings.pdf",
    planTags: ["Medisure Super Top Up"],
  },
  {
    insurer: "Aditya Birla",
    title: "Aditya Birla Super Health Plus Top Up — Policy Wording",
    url: "https://www.adityabirlacapital.com/healthinsurance/assets/pdf/planpdf/Super-Top-Up-Policy-wording.pdf",
    planTags: ["Super Health Plus Top Up"],
  },
  {
    insurer: "HDFC ERGO",
    title: "HDFC ERGO — Copay vs Coinsurance vs Deductible",
    url: "https://www.hdfcergo.com/blogs/health-insurance/copay-vs-coinsurance-vs-deductible",
  },
  {
    insurer: "Niva Bupa",
    title: "Niva Bupa — Health Insurance Terms Glossary",
    url: "https://www.nivabupa.com/health-insurance-articles/health-insurance-terms.html",
  },
  {
    insurer: "Niva Bupa",
    title: "Niva Bupa — Lapsed Health Insurance vs Grace Period",
    url: "https://www.nivabupa.com/health-insurance-articles/lapsed-health-insurance-vs-grace-period-how-bad-is-it-really.html",
  },
];

async function main() {
  const db = getDb();
  const repos = createRepositories(db);

  console.log(`Planned: ${URLS.length} URL(s).\n`);
  for (const u of URLS) {
    console.log(`  [${u.insurer}]  ${u.title}${u.planTags ? `  (plan: ${u.planTags.join(", ")})` : ""}`);
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
  const categoryByName = new Map(existingCategories.map((c) => [c.name.toLowerCase(), c]));

  const neededNames = Array.from(new Set(URLS.map((u) => u.insurer)));
  for (const name of neededNames) {
    if (categoryByName.has(name.toLowerCase())) continue;
    const created = await repos.kbCategories.create({ name, type: "insurer", sortOrder: 0 });
    categoryByName.set(name.toLowerCase(), created);
    console.log(`Created category "${name}" (insurer) — it didn't already exist.`);
  }

  const existingResources = await repos.kbResources.list();
  const resourceByUrl = new Map(existingResources.filter((r) => r.sourceUrl).map((r) => [r.sourceUrl as string, r]));

  let succeeded = 0;
  let skipped = 0;
  let failed = 0;

  for (const u of URLS) {
    const category = categoryByName.get(u.insurer.toLowerCase());
    if (!category) {
      console.error(`No category resolved for "${u.insurer}" — skipping "${u.title}".`);
      failed++;
      continue;
    }
    const existing = resourceByUrl.get(u.url);

    console.log(`Ingesting "${u.title}" -> [${u.insurer}]...`);
    try {
      const result = await ingestUrlResource(repos, {
        resourceId: existing?.id,
        categoryId: category.id,
        title: u.title,
        url: u.url,
        addedBy: SEEDED_BY,
      });

      if (result.resource.status === "error") {
        console.log(`  ERROR: ${result.resource.errorMessage}`);
        failed++;
        continue;
      }

      // Plan tags only apply once (on first successful ingest) — re-running
      // the script won't clobber tags an admin has since edited by hand.
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
