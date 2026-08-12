/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * ONE-TIME BACKFILL — users.tags <- scripts/data/master_advisors.csv,
 *                      AND normalizes every existing user's tactId
 *
 * Two independent things happen in one pass over the directory:
 *
 *  1. TACT ID normalization (ALL users, regardless of CSV match). Historic
 *     entries could be "tact1500", "Tact-1500", "TACT-1500", etc. — any of
 *     those now normalizes to the canonical "TACT1500" (see normalizeTactId,
 *     src/utils/tactId.ts), same rule the app enforces on every new write
 *     going forward (TactIdInput client-side, normalizeTactId server-side).
 *
 *  2. Tag assignment from the QA sheet export (scripts/data/master_advisors.csv,
 *     columns: Tact ID, Name, Email ID, Mentor Name, Tags). Each CSV row is
 *     matched against the directory by normalized TACT ID first, falling
 *     back to email if no TACT ID match — matches the spec ("map users
 *     against this csv using their tact id and email id"). "Both" in the
 *     sheet becomes BOTH tags ([Health, Term]), not a special third value.
 *     Sheet rows with no directory match are expected (not every advisor in
 *     the sheet has signed into this app yet) and just get skipped/reported.
 *
 * SAFETY
 *  - Every existing tags assignment is OVERWRITTEN by a CSV match (this is
 *     an authoritative resync from the sheet, unlike backfillAdvisorRole.ts's
 *     "only if empty" rule) — re-running is still idempotent (same input,
 *     same output), just not additive-only.
 *  - TACT ID normalization never changes WHICH user a row refers to, only
 *    its formatting — the underlying digits are preserved exactly.
 *  - Read-only against the CSV; writes only to this app's own `users` table.
 *
 * USAGE
 *   npx tsx scripts/assignAdvisorTagsFromCsv.ts           # dry run, prints a summary
 *   npx tsx scripts/assignAdvisorTagsFromCsv.ts --commit  # actually writes
 */

import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { getDb } from "../src/server/db/client.js";
import { createRepositories } from "../src/server/db/repositories/index.js";
import { normalizeTactId } from "../src/utils/tactId.js";

dotenv.config();

const COMMIT = process.argv.includes("--commit");
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CSV_PATH = path.join(__dirname, "data", "master_advisors.csv");

// Sheet's free-text Tags column -> the tag set it maps to. "-" / blank /
// anything else is "no data" and left untouched, not guessed at.
const SHEET_TAG_TO_TAGS: Record<string, string[]> = {
  health: ["Health"],
  term: ["Term"],
  both: ["Health", "Term"],
};

interface CsvRow {
  tactId: string; // normalized
  email: string; // lowercased, trimmed
  tags: string[] | null; // null = no recognizable tag data for this row
}

/** Minimal CSV line splitter — sufficient here since this sheet's export has
 * no quoted/escaped commas in any column (verified against the actual
 * file); a plain split avoids pulling in a CSV parsing dependency. */
function parseCsv(text: string): CsvRow[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const rows: CsvRow[] = [];
  // Skip the header row (line 0) — and also skip any row whose first column
  // is literally "Tact ID" again (the sheet export has one such duplicated-
  // header data row), since that's not a real TACT ID.
  for (const line of lines.slice(1)) {
    const cols = line.split(",");
    const rawTactId = (cols[0] || "").trim();
    const rawEmail = (cols[2] || "").trim();
    const rawTags = (cols[4] || "").trim().toLowerCase();
    if (!rawTactId || rawTactId.toLowerCase() === "tact id") continue;
    if (!rawEmail) continue;
    const tactId = normalizeTactId(rawTactId);
    if (!tactId) continue;
    rows.push({
      tactId,
      email: rawEmail.toLowerCase(),
      tags: SHEET_TAG_TO_TAGS[rawTags] ?? null,
    });
  }
  return rows;
}

function tagsEqual(a: string[] | undefined | null, b: string[]): boolean {
  const setA = new Set(a ?? []);
  if (setA.size !== b.length) return false;
  return b.every((t) => setA.has(t));
}

async function main() {
  const db = getDb();
  const { users: usersRepo } = createRepositories(db);

  console.log(`Reading ${CSV_PATH}...`);
  const csvText = fs.readFileSync(CSV_PATH, "utf-8");
  const csvRows = parseCsv(csvText);
  console.log(`Parsed ${csvRows.length} usable CSV rows.`);

  const allUsers = await usersRepo.list();
  console.log(`Directory has ${allUsers.length} users.`);

  const userByTactId = new Map(allUsers.map((u) => [normalizeTactId(u.tactId), u]));
  const userByEmail = new Map(allUsers.map((u) => [u.email.toLowerCase(), u]));

  // email -> planned patch (merges the tactId-normalization pass and the
  // CSV tag-assignment pass so each user gets at most ONE update call).
  const patches = new Map<string, { name: string; tactId?: string; tags?: string[] }>();
  const ensurePatch = (email: string, name: string) => {
    let p = patches.get(email);
    if (!p) {
      p = { name };
      patches.set(email, p);
    }
    return p;
  };

  // Pass 1 — normalize every existing user's tactId, regardless of CSV match.
  let tactIdFixes = 0;
  for (const u of allUsers) {
    const normalized = normalizeTactId(u.tactId);
    if (normalized && normalized !== u.tactId) {
      ensurePatch(u.email, u.name).tactId = normalized;
      tactIdFixes++;
    }
  }

  // Pass 2 — assign tags from the CSV, matching by TACT ID first, email second.
  let matchedByTactId = 0;
  let matchedByEmail = 0;
  let noTagData = 0;
  let noMatch = 0;
  let alreadyCorrect = 0;
  const unmatchedRows: CsvRow[] = [];

  for (const row of csvRows) {
    if (!row.tags) {
      noTagData++;
      continue;
    }
    let user = userByTactId.get(row.tactId);
    let matchKind: "tactId" | "email" | null = user ? "tactId" : null;
    if (!user) {
      user = userByEmail.get(row.email);
      if (user) matchKind = "email";
    }
    if (!user) {
      noMatch++;
      unmatchedRows.push(row);
      continue;
    }
    if (matchKind === "tactId") matchedByTactId++;
    else matchedByEmail++;

    if (tagsEqual(user.tags, row.tags)) {
      alreadyCorrect++;
      continue;
    }
    ensurePatch(user.email, user.name).tags = row.tags;
  }

  console.log("\n--- Summary ---");
  console.log(`TACT IDs needing normalization: ${tactIdFixes}`);
  console.log(`CSV rows matched by TACT ID: ${matchedByTactId}`);
  console.log(`CSV rows matched by email (no TACT ID match): ${matchedByEmail}`);
  console.log(`CSV rows with no directory match at all (expected — not every advisor has logged in yet): ${noMatch}`);
  console.log(`CSV rows with no recognizable Tags value ("-"/blank/other): ${noTagData}`);
  console.log(`Directory users whose tags already matched the sheet: ${alreadyCorrect}`);
  console.log(`Total directory users receiving an update: ${patches.size}`);

  if (!COMMIT) {
    console.log("\nDry run only — no writes made. Re-run with --commit to apply.");
    if (patches.size) {
      console.log("\nWould update:");
      for (const [email, p] of patches) {
        const parts: string[] = [];
        if (p.tactId) parts.push(`tactId -> ${p.tactId}`);
        if (p.tags) parts.push(`tags -> [${p.tags.join(", ")}]`);
        console.log(`  ${email} (${p.name}): ${parts.join(", ")}`);
      }
    }
    if (unmatchedRows.length) {
      console.log(`\n${unmatchedRows.length} CSV row(s) with tag data but no directory match (first 20):`);
      for (const row of unmatchedRows.slice(0, 20)) {
        console.log(`  ${row.tactId} / ${row.email}`);
      }
    }
    return;
  }

  console.log(`\nWriting ${patches.size} update(s)...`);
  for (const [email, p] of patches) {
    await usersRepo.updateUser(email, {
      ...(p.tactId ? { tactId: p.tactId } : {}),
      ...(p.tags ? { tags: p.tags } : {}),
    });
  }
  console.log("Done.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Backfill failed:", err);
    process.exit(1);
  });
