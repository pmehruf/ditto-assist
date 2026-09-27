/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * ONE-TIME SEED — imports Niva Bupa's dedicated per-plan Brochure / Policy
 * Wording / Prospectus documents into the Knowledge Base, tagged with
 * documentType so productAssist.ts can apply the Policy Wording > Prospectus
 * > Brochure authority precedence — see scripts/seedHdfcErgoUrls.ts for the
 * original pattern this follows.
 *
 * VARIANT STRUCTURE (per the user's final list — HealthPlus removed, 6 main
 * plans + add-ons): several plans sell multiple named tiers/variants that
 * share ONE Policy Wording and ONE Prospectus but have a SEPARATE Brochure
 * per variant (same shared-document shape as Aditya Birla's Activ One — see
 * scripts/seedAdityaBirlaUrls.ts):
 *   - Health Premia: base / Gold / Platinum (3 brochures, 1 shared PW+Prospectus)
 *   - ReAssure 2.0: Bronze Plus / (Titanium Plus & Platinum Plus, one shared
 *     brochure) / (Bronze & Gold, one shared brochure) — 3 brochures, 1
 *     shared PW+Prospectus covering all 5 tier names
 *   - ReAssure 3.0: Unlimited / Limited (2 brochures, 1 shared PW+Prospectus)
 * Each variant-specific Brochure is tagged with only its own tier name(s);
 * the shared Policy Wording/Prospectus for that plan family is tagged with
 * EVERY tier name under it (plus the bare plan name) so it stays in
 * retrieval scope regardless of which specific tier the advisor selected.
 * Aspire, Health Recharge, and ReAssure have no variants — one tag each.
 *
 * Also sets kb_categories.plan_names for the "Niva Bupa" category to the
 * full list of plan/tier/add-on names below (merged with whatever's already
 * there — the existing Niva Bupa category already has a few general,
 * non-plan-tagged resources from scripts/seedKnowledgeBaseUrls.ts, e.g. the
 * claim-document-checklist and exclusion-list articles; those are untouched).
 *
 * Idempotent: re-running matches URLs to existing kb_resources by sourceUrl
 * and re-ingests only if the fetched content changed.
 *
 * USAGE
 *   npx tsx scripts/seedNivaBupaUrls.ts               # dry run, lists what would happen
 *   npx tsx scripts/seedNivaBupaUrls.ts --commit       # actually fetches, ingests, embeds
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
const INSURER = "Niva Bupa";

interface SeedUrl {
  title: string;
  url: string;
  documentType: KbDocumentType;
  planTags: string[];
}

// ── Health Premia's 3 tiers, ReAssure 2.0's 5 tiers, ReAssure 3.0's 2 tiers —
//    each plan's shared PW/Prospectus gets the bare plan name + every tier. ──
const HEALTH_PREMIA_TIERS = ["Health Premia Gold", "Health Premia Platinum"];
const HEALTH_PREMIA_TAGS = ["Health Premia", ...HEALTH_PREMIA_TIERS];

const REASSURE_2_TIERS = ["ReAssure 2.0 Bronze Plus", "ReAssure 2.0 Titanium Plus", "ReAssure 2.0 Platinum Plus", "ReAssure 2.0 Bronze", "ReAssure 2.0 Gold"];
const REASSURE_2_TAGS = ["ReAssure 2.0", ...REASSURE_2_TIERS];

// Was mistakenly seeded as "ReAssure30" (no space) — the real product name
// is "ReAssure 3.0". See scripts/renameNivaBupaReassure3.ts for the one-off
// correction applied to data seeded under the old name.
const REASSURE30_TIERS = ["ReAssure 3.0 Unlimited", "ReAssure 3.0 Limited"];
const REASSURE30_TAGS = ["ReAssure 3.0", ...REASSURE30_TIERS];

const URLS: SeedUrl[] = [
  // ── Aspire ──────────────────────────────────────────────────────────────
  {
    title: "Niva Bupa Aspire — Brochure",
    url: "https://transactions.nivabupa.com/pages/doc/brochure/aspire_ss.pdf?v=1.6",
    documentType: "brochure",
    planTags: ["Aspire"],
  },
  {
    title: "Niva Bupa Aspire — Policy Wording",
    url: "https://transactions.nivabupa.com/pages/doc/policy_wording/Aspire_Policy_Wordings.pdf?v=1.8",
    documentType: "policy_wording",
    planTags: ["Aspire"],
  },
  {
    title: "Niva Bupa Aspire — Prospectus",
    url: "https://transactions.nivabupa.com/pages/doc/prospectus/Aspire_Prospectus.pdf?v=1.8",
    documentType: "prospectus",
    planTags: ["Aspire"],
  },

  // ── Health Premia (base / Gold / Platinum) ─────────────────────────────
  {
    title: "Niva Bupa Health Premia — Brochure",
    url: "https://transactions.nivabupa.com/pages/doc/brochure/Health_Premia_Br.pdf?v=1.6",
    documentType: "brochure",
    planTags: ["Health Premia"],
  },
  {
    title: "Niva Bupa Health Premia (Gold) — Brochure",
    url: "https://transactions.nivabupa.com/pages/doc/brochure/Health_Premia_Gold_Br.pdf?v=2.5",
    documentType: "brochure",
    planTags: ["Health Premia Gold"],
  },
  {
    title: "Niva Bupa Health Premia (Platinum) — Brochure",
    url: "https://transactions.nivabupa.com/pages/doc/brochure/Health_Premia_PLATINUM_Br.pdf?v=2.5",
    documentType: "brochure",
    planTags: ["Health Premia Platinum"],
  },
  {
    title: "Niva Bupa Health Premia (all tiers) — Policy Wording",
    url: "https://transactions.nivabupa.com/pages/doc/policy_wording/Health-Premia-Policy-Wording.pdf?v=1.0",
    documentType: "policy_wording",
    planTags: HEALTH_PREMIA_TAGS,
  },
  {
    title: "Niva Bupa Health Premia (all tiers) — Prospectus",
    url: "https://transactions.nivabupa.com/pages/doc/prospectus/Health-Premia-Prospectus.pdf?v=1.4",
    documentType: "prospectus",
    planTags: HEALTH_PREMIA_TAGS,
  },

  // ── Health Recharge ─────────────────────────────────────────────────────
  {
    title: "Niva Bupa Health Recharge — Brochure",
    url: "https://transactions.nivabupa.com/pages/doc/brochure/Health_Recharge_SS.pdf",
    documentType: "brochure",
    planTags: ["Health Recharge"],
  },
  {
    title: "Niva Bupa Health Recharge — Policy Wording",
    url: "https://transactions.nivabupa.com/pages/doc/policy_wording/health-recharge-t-and-c.pdf?v=1.0",
    documentType: "policy_wording",
    planTags: ["Health Recharge"],
  },
  {
    title: "Niva Bupa Health Recharge — Prospectus",
    url: "https://transactions.nivabupa.com/pages/doc/prospectus/Health-Recharge-Prospectus.pdf?v=1.0",
    documentType: "prospectus",
    planTags: ["Health Recharge"],
  },

  // ── ReAssure (original) ─────────────────────────────────────────────────
  {
    title: "Niva Bupa ReAssure — Brochure",
    url: "https://transactions.nivabupa.com/pages/doc/brochure/ReAssure_SS.pdf?v=1.5",
    documentType: "brochure",
    planTags: ["ReAssure"],
  },
  {
    title: "Niva Bupa ReAssure — Policy Wording",
    url: "https://transactions.nivabupa.com/pages/doc/policy_wording/ReAssure-Policy-Wording.pdf?v=1.4",
    documentType: "policy_wording",
    planTags: ["ReAssure"],
  },
  {
    title: "Niva Bupa ReAssure — Prospectus",
    url: "https://transactions.nivabupa.com/pages/doc/prospectus/ReAssure-Prospectus.pdf?v=1.5",
    documentType: "prospectus",
    planTags: ["ReAssure"],
  },

  // ── ReAssure 2.0 (Bronze Plus / Titanium Plus & Platinum Plus / Bronze & Gold) ──
  {
    title: "Niva Bupa ReAssure 2.0 (Bronze Plus) — Brochure",
    url: "https://transactions.nivabupa.com/pages/doc/brochure/ReAssure_2.0_Bronze_plus_SS_with_Deductible.pdf?v=1.2",
    documentType: "brochure",
    planTags: ["ReAssure 2.0 Bronze Plus"],
  },
  {
    title: "Niva Bupa ReAssure 2.0 (Titanium Plus & Platinum Plus) — Brochure",
    url: "https://transactions.nivabupa.com/pages/doc/brochure/ReAssure_2.0_Titanium_plus_&_Platinumplus_SS_with_Deductible.pdf?v=1.2",
    documentType: "brochure",
    planTags: ["ReAssure 2.0 Titanium Plus", "ReAssure 2.0 Platinum Plus"],
  },
  {
    title: "Niva Bupa ReAssure 2.0 (Bronze & Gold) — Brochure",
    url: "https://transactions.nivabupa.com/pages/doc/brochure/ReAssure_2.0_Bronze_Gold_SS.pdf?v=1.2",
    documentType: "brochure",
    planTags: ["ReAssure 2.0 Bronze", "ReAssure 2.0 Gold"],
  },
  {
    title: "Niva Bupa ReAssure 2.0 (all tiers) — Policy Wording",
    url: "https://transactions.nivabupa.com/pages/doc/policy_wording/ReAssure-2.0-Policy-Wording.pdf?v=1.8",
    documentType: "policy_wording",
    planTags: REASSURE_2_TAGS,
  },
  {
    title: "Niva Bupa ReAssure 2.0 (all tiers) — Prospectus",
    url: "https://transactions.nivabupa.com/pages/doc/prospectus/ReAssure-2.0-Prospectus-cum-Sales-Literature.pdf?v=1.10",
    documentType: "prospectus",
    planTags: REASSURE_2_TAGS,
  },

  // ── ReAssure 3.0 (Unlimited / Limited) ──────────────────────────────────
  {
    title: "Niva Bupa ReAssure 3.0 (Unlimited) — Brochure",
    url: "https://transactions.nivabupa.com/pages/doc/brochure/Reassure30_SS_Unlimited.pdf?v=1.2",
    documentType: "brochure",
    planTags: ["ReAssure 3.0 Unlimited"],
  },
  {
    title: "Niva Bupa ReAssure 3.0 (Limited) — Brochure",
    url: "https://transactions.nivabupa.com/pages/doc/brochure/Reassure30_SS_Limited.pdf?v=1.2",
    documentType: "brochure",
    planTags: ["ReAssure 3.0 Limited"],
  },
  {
    title: "Niva Bupa ReAssure 3.0 (all tiers) — Policy Wording",
    url: "https://transactions.nivabupa.com/pages/doc/policy_wording/ReAssure30_Policy_Wordings.pdf?v=1.5",
    documentType: "policy_wording",
    planTags: REASSURE30_TAGS,
  },
  {
    title: "Niva Bupa ReAssure 3.0 (all tiers) — Prospectus",
    url: "https://transactions.nivabupa.com/pages/doc/prospectus/ReAssure30_Prospectus.pdf?v=1.2",
    documentType: "prospectus",
    planTags: REASSURE30_TAGS,
  },

  // ── Add-ons ─────────────────────────────────────────────────────────────
  {
    title: "Niva Bupa Add-on: Smart Health Plus — Brochure",
    url: "https://transactions.nivabupa.com/pages/doc/brochure/Smart_Health_plus_AC_SS.pdf?v=1.0",
    documentType: "addon",
    planTags: ["Smart Health Plus"],
  },
  {
    title: "Niva Bupa Add-on: Smart Health Plus — Prospectus",
    url: "https://transactions.nivabupa.com/pages/doc/prospectus/Smart-Healthplus-Prospectus.pdf?v=1.0",
    documentType: "addon",
    planTags: ["Smart Health Plus"],
  },
  {
    title: "Niva Bupa Add-on: Safeguard — Prospectus",
    url: "https://transactions.nivabupa.com/pages/doc/prospectus/Safeguard-Ride-Prospectus.pdf?v=1.0",
    documentType: "addon",
    planTags: ["Safeguard"],
  },
  {
    title: "Niva Bupa Add-on: Fast Forward — Policy Wording",
    url: "https://transactions.nivabupa.com/pages/doc/policy_wording/Fast-Forward-Add-o-Endorsment-Document.pdf?v=1.0",
    documentType: "addon",
    planTags: ["Fast Forward"],
  },
  {
    title: "Niva Bupa Add-on: Fast Forward — Prospectus",
    url: "https://transactions.nivabupa.com/pages/doc/prospectus/Fast-Forward-Add-on-Prospectus.pdf",
    documentType: "addon",
    planTags: ["Fast Forward"],
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
