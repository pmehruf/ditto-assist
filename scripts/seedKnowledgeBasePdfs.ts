/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * ONE-TIME SEED — imports the 14 PDFs from "Product Assist\" into the
 * Knowledge Base (Ask the Playbook), auto-categorized by filename keyword
 * matching against the app's 4 known insurers. Anything that doesn't match
 * a known insurer falls into a "General / Others" category rather than
 * being skipped, per the user's request for a general/others bucket.
 *
 * Idempotent: re-running matches PDFs to existing kb_resources by title and
 * re-ingests only if the extracted text changed (see pdfIngest.ts's
 * contentHash check), so it's safe to re-run after adding/replacing files.
 *
 * USAGE
 *   npx tsx scripts/seedKnowledgeBasePdfs.ts               # dry run, lists what would happen
 *   npx tsx scripts/seedKnowledgeBasePdfs.ts --commit       # actually ingests + embeds
 *
 * Requires GEMINI_API_KEY in the environment (loaded from .env below).
 */

import dotenv from "dotenv";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { getDb } from "../src/server/db/client.js";
import { createRepositories } from "../src/server/db/repositories/index.js";
import { ingestPdfResource } from "../src/server/knowledgeBase/pdfIngest.js";

dotenv.config();

const COMMIT = process.argv.includes("--commit");
const SEEDED_BY = "seed-script";

// Folder the user placed the 14 PDFs in — see the "Product Assist" folder
// under the project root.
const PDF_DIR = path.resolve(process.cwd(), "Product Assist");

// Known insurers (must match src/constants/insurerLogos.ts's INSURER_LOGOS
// keys) plus the filename keywords that identify each one. Order matters:
// first match wins, so more specific keywords ("care supreme") are listed
// before generic ones aren't needed here since names don't collide.
const INSURER_KEYWORDS: { insurer: string; keywords: string[] }[] = [
  { insurer: "HDFC ERGO", keywords: ["hdfc ergo", "hdfc", "optima"] },
  { insurer: "Care Health", keywords: ["care health", "care supreme"] },
  { insurer: "Aditya Birla", keywords: ["aditya birla", "activ"] },
  { insurer: "Niva Bupa", keywords: ["niva bupa", "aspire", "reassure"] },
];

const GENERAL_CATEGORY_NAME = "General / Others";

function detectInsurer(filename: string): string | null {
  const lower = filename.toLowerCase();
  for (const { insurer, keywords } of INSURER_KEYWORDS) {
    if (keywords.some((kw) => lower.includes(kw))) return insurer;
  }
  return null;
}

async function main() {
  const db = getDb();
  const repos = createRepositories(db);

  let files: string[];
  try {
    files = (await readdir(PDF_DIR)).filter((f) => f.toLowerCase().endsWith(".pdf"));
  } catch (err) {
    console.error(`Could not read "${PDF_DIR}": ${err instanceof Error ? err.message : err}`);
    console.error('Expected the PDFs at "Product Assist\\" under the project root.');
    process.exit(1);
    return;
  }

  if (files.length === 0) {
    console.log(`No PDFs found in "${PDF_DIR}".`);
    return;
  }

  console.log(`Found ${files.length} PDF(s) in "${PDF_DIR}".\n`);

  const existingCategories = await repos.kbCategories.list();
  const categoryByName = new Map(existingCategories.map((c) => [c.name.toLowerCase(), c]));

  const plan: { filename: string; insurer: string; categoryType: "insurer" | "general" }[] = [];
  for (const filename of files) {
    const insurer = detectInsurer(filename);
    if (insurer) {
      plan.push({ filename, insurer, categoryType: "insurer" });
    } else {
      plan.push({ filename, insurer: GENERAL_CATEGORY_NAME, categoryType: "general" });
    }
  }

  console.log("Planned categorization:");
  for (const p of plan) console.log(`  [${p.insurer}]  ${p.filename}`);
  console.log();

  if (!COMMIT) {
    console.log("Dry run only — no categories created, no PDFs ingested. Re-run with --commit to apply.");
    return;
  }

  if (!process.env.GEMINI_API_KEY) {
    console.error("GEMINI_API_KEY is required to embed chunks — aborting.");
    process.exit(1);
    return;
  }

  // Ensure every needed category exists (create missing ones).
  const neededNames = Array.from(new Set(plan.map((p) => p.insurer)));
  for (const name of neededNames) {
    if (categoryByName.has(name.toLowerCase())) continue;
    const type = name === GENERAL_CATEGORY_NAME ? "general" : "insurer";
    const created = await repos.kbCategories.create({ name, type, sortOrder: type === "general" ? 999 : 0 });
    categoryByName.set(name.toLowerCase(), created);
    console.log(`Created category "${name}" (${type}).`);
  }

  const existingResources = await repos.kbResources.list();
  const resourceByTitle = new Map(existingResources.map((r) => [r.title, r]));

  for (const p of plan) {
    const category = categoryByName.get(p.insurer.toLowerCase());
    if (!category) {
      console.error(`No category resolved for "${p.insurer}" — skipping ${p.filename}.`);
      continue;
    }
    const filePath = path.join(PDF_DIR, p.filename);
    const buffer = await readFile(filePath);
    const existing = resourceByTitle.get(p.filename);

    console.log(`Ingesting "${p.filename}" -> [${p.insurer}]...`);
    const result = await ingestPdfResource(repos, {
      resourceId: existing?.id,
      categoryId: category.id,
      title: p.filename,
      sourceLabel: p.filename,
      buffer,
      addedBy: SEEDED_BY,
    });

    if (result.resource.status === "error") {
      console.log(`  ERROR: ${result.resource.errorMessage}`);
    } else if (result.skipped) {
      console.log(`  Unchanged, skipped re-embedding (${result.chunkCount} chunks already stored).`);
    } else {
      console.log(`  Embedded ${result.chunkCount} chunk(s).`);
    }
  }

  console.log("\nDone.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Seed failed:", err);
    process.exit(1);
  });
