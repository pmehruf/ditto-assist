/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * ONE-TIME IMPORT — qa_evaluation_history (source_batch "2026-06-manual-backfill")
 * <- scripts/data/qa_june2026_backfill.csv
 *
 * The live master_feedback_dump Google Sheet was only freshly connected in
 * June 2026 and has gaps for that month (rows QA logged before/around the
 * cutover never made it into the Sheet). This is a manual export of exactly
 * those June 2026 Call/Payment evaluations, pushed into the same
 * qa_evaluation_history table the original June 2025-May 2026 archive import
 * uses (see scripts/importQaEvaluationHistory.ts) — but stamped with its own
 * source_batch id ("2026-06-manual-backfill") so it can be wiped and
 * re-imported on its own (deleteByBatch) without ever touching that earlier
 * import, which has no source CSV checked into git to reconstruct it from.
 *
 * UNLIKE the original import, this batch's date range (June 2026) DOES
 * overlap the live Sheet's own coverage by design — the whole point is
 * filling gaps within a month the Sheet also holds real rows for, not a
 * period the Sheet never had. Double-counting is prevented at READ time, not
 * import time: src/server/qaDashboard/qaDataEngine.ts's
 * getMergedFeedbackDumpRows() drops any archive row that matches a live
 * Sheet row on (checked date, TACT ID, chat ID, domain, score) — see that
 * function's comment. So this script imports every valid row from the CSV
 * unconditionally; nothing here needs to know what the live Sheet currently
 * holds, and a later Sheet backfill of the same rows can never cause a
 * double count regardless of import order.
 *
 * SOURCE FORMAT — deliberately different from the original import's CSV:
 *   Checked Date, Mistake Date, TACT ID, Advisor, Lead ID, Domain, Severity
 * "Lead ID" maps to the qa_evaluation_history chatId column (same "CH######"
 * identifier format used everywhere else in the app as Chat ID). "Severity"
 * maps to score (1-5). Domain is the friendly "Call"/"Payment" label (no
 * "Chat" domain rows exist in this export) rather than the raw
 * "FIRST_CALL"/"PAYMENT_CALL" enum the live Sheet and the original archive
 * both use — mapped via DOMAIN_MAP below so the stored value matches
 * TASK_TYPES in qaDataEngine.ts exactly.
 *
 * DATA QUALITY (as of the 2026-09-03 export, see the row-count summary this
 * script prints):
 *  - ~114 of 2063 rows have a blank TACT ID or Advisor name and are skipped
 *    (can't identify who the evaluation belongs to; qa_evaluation_history
 *    requires both). A few of these are visibly placeholder/test entries
 *    ("Little Data").
 *  - ~150 rows are exact duplicates of another row in this same CSV (same
 *    date/TACT/Lead ID/Domain/Severity) — imported as-is rather than
 *    silently deduped, since a repeat evaluation of the same chat is
 *    explicitly expected in this data (see the original import's own
 *    comment) and this script has no way to tell that apart from an
 *    accidental double-paste in the source export. Flagged in the summary
 *    for a human to sanity-check if the count looks off.
 *
 * SAFETY
 *  - Read-only against the CSV; writes only to this app's own
 *    qa_evaluation_history table, and only rows stamped with this script's
 *    own BATCH_ID.
 *  - Re-running with --commit APPENDS by default (would create duplicates on
 *    a second run); pass --replace together with --commit to first delete
 *    only this batch's existing rows (deleteByBatch), never the original
 *    archive import or any other batch.
 *
 * USAGE
 *   npx tsx scripts/importJune2026QaBackfill.ts                    # dry run, prints a summary
 *   npx tsx scripts/importJune2026QaBackfill.ts --commit            # append
 *   npx tsx scripts/importJune2026QaBackfill.ts --commit --replace  # wipe this batch first, then import
 */

import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { getDb } from "../src/server/db/client.js";
import { createRepositories } from "../src/server/db/repositories/index.js";
import { normalizeTactId } from "../src/utils/tactId.js";
import type { NewQaEvaluationHistoryEntry } from "../src/server/db/repositories/qaEvaluationHistoryRepository.js";

dotenv.config();

const COMMIT = process.argv.includes("--commit");
const REPLACE = process.argv.includes("--replace");
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CSV_PATH = path.join(__dirname, "data", "qa_june2026_backfill.csv");

const BATCH_ID = "2026-06-manual-backfill";

// Friendly sheet-export labels -> the raw TASK_TYPES codes qaDataEngine.ts
// and the live Sheet both use (see MASTER_DUMP_COLS.DOMAIN / TASK_TYPES).
const DOMAIN_MAP: Record<string, string> = {
  Call: "FIRST_CALL",
  Payment: "PAYMENT_CALL",
  Chat: "CHAT",
};

/**
 * Minimal RFC4180-ish CSV parser: handles double-quoted fields (including
 * embedded commas and embedded newlines), "" as an escaped literal quote
 * inside a quoted field, and both CRLF and LF line endings. Returns rows as
 * plain string arrays; the header row is included (caller skips it). Copied
 * from scripts/importQaEvaluationHistory.ts rather than shared, matching
 * that script's own one-time/standalone nature.
 */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  const n = text.length;

  const endField = () => {
    row.push(field);
    field = "";
  };
  const endRow = () => {
    endField();
    rows.push(row);
    row = [];
  };

  while (i < n) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (ch === ",") {
      endField();
      i++;
      continue;
    }
    if (ch === "\r") {
      if (text[i + 1] === "\n") i++;
      endRow();
      i++;
      continue;
    }
    if (ch === "\n") {
      endRow();
      i++;
      continue;
    }
    field += ch;
    i++;
  }
  if (field.length > 0 || row.length > 0) endRow();

  return rows.filter((r) => !(r.length === 1 && r[0] === ""));
}

/** "DD/MM/YYYY" -> "yyyy-MM-dd", with real calendar-date validation (not
 * just a regex shape check) so e.g. 31/02/2026 is rejected, not silently
 * rolled forward to March. */
function ddmmyyyyToIso(raw: string): string | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(raw.trim());
  if (!m) return null;
  const [, ddStr, mmStr, yyyyStr] = m;
  const dd = Number(ddStr);
  const mm = Number(mmStr);
  const yyyy = Number(yyyyStr);
  const d = new Date(Date.UTC(yyyy, mm - 1, dd));
  if (d.getUTCFullYear() !== yyyy || d.getUTCMonth() !== mm - 1 || d.getUTCDate() !== dd) return null;
  return `${yyyyStr}-${mmStr}-${ddStr}`;
}

interface SkipReason {
  row: number;
  reason: string;
}

async function main() {
  console.log(`Reading ${CSV_PATH}...`);
  const text = fs.readFileSync(CSV_PATH, "utf-8");
  const table = parseCsv(text);
  console.log(`Parsed ${table.length} total lines (including header).`);

  const header = table[0]?.map((h) => h.trim()) ?? [];
  const expected = ["Checked Date", "Mistake Date", "TACT ID", "Advisor", "Lead ID", "Domain", "Severity"];
  const headerOk = expected.every((col, idx) => header[idx] === col);
  if (!headerOk) {
    console.error(`Unexpected header. Expected: ${expected.join(", ")}\nGot: ${header.join(", ")}`);
    process.exit(1);
  }

  const dataRows = table.slice(1);
  const entries: NewQaEvaluationHistoryEntry[] = [];
  const skipped: SkipReason[] = [];
  const domainCounts: Record<string, number> = { CHAT: 0, FIRST_CALL: 0, PAYMENT_CALL: 0 };
  let blankScoreCount = 0;
  let tactIdNormalizedCount = 0;
  const exactDupeKeys = new Map<string, number>();

  dataRows.forEach((cols, idx) => {
    const lineNo = idx + 2; // +1 for 0-index, +1 for header row
    const [checkedRaw, mistakeRaw, tactRaw, advisorRaw, leadRaw, domainRaw, severityRaw] = cols;

    const checkedDate = ddmmyyyyToIso((checkedRaw || "").trim());
    if (!checkedDate) {
      skipped.push({ row: lineNo, reason: `invalid Checked Date "${checkedRaw}"` });
      return;
    }
    const mistakeRawTrimmed = (mistakeRaw || "").trim();
    let mistakeDate: string | null = null;
    if (mistakeRawTrimmed !== "") {
      mistakeDate = ddmmyyyyToIso(mistakeRawTrimmed);
      if (!mistakeDate) {
        skipped.push({ row: lineNo, reason: `invalid Mistake Date "${mistakeRaw}"` });
        return;
      }
    }
    const tactRawTrimmed = (tactRaw || "").trim();
    if (!tactRawTrimmed) {
      skipped.push({ row: lineNo, reason: "missing TACT ID" });
      return;
    }
    const tactId = normalizeTactId(tactRawTrimmed);
    if (!tactId) {
      skipped.push({ row: lineNo, reason: `invalid TACT ID "${tactRaw}"` });
      return;
    }
    if (tactId !== tactRawTrimmed) tactIdNormalizedCount++;

    const advisorName = (advisorRaw || "").trim();
    if (!advisorName) {
      skipped.push({ row: lineNo, reason: "missing Advisor name" });
      return;
    }
    const chatId = (leadRaw || "").trim();
    if (!chatId) {
      skipped.push({ row: lineNo, reason: "missing Lead ID" });
      return;
    }
    const domainRawTrimmed = (domainRaw || "").trim();
    const domain = DOMAIN_MAP[domainRawTrimmed];
    if (!domain) {
      skipped.push({ row: lineNo, reason: `unrecognized Domain "${domainRaw}"` });
      return;
    }

    const severityTrimmed = (severityRaw || "").trim();
    let score: number | null = null;
    if (severityTrimmed !== "") {
      const n = Number(severityTrimmed);
      if (!Number.isInteger(n) || n < 1 || n > 5) {
        skipped.push({ row: lineNo, reason: `invalid Severity "${severityRaw}"` });
        return;
      }
      score = n;
    } else {
      blankScoreCount++;
    }

    const dupeKey = `${checkedDate}|${tactId}|${chatId}|${domain}|${score ?? ""}`;
    exactDupeKeys.set(dupeKey, (exactDupeKeys.get(dupeKey) || 0) + 1);

    domainCounts[domain] = (domainCounts[domain] || 0) + 1;
    entries.push({ checkedDate, mistakeDate, tactId, advisorName, chatId, domain, score, sourceBatch: BATCH_ID });
  });

  const exactDupeRows = [...exactDupeKeys.values()].filter((n) => n > 1).reduce((sum, n) => sum + (n - 1), 0);

  console.log("\n--- Summary ---");
  console.log(`Data rows parsed: ${dataRows.length}`);
  console.log(`Valid rows: ${entries.length}`);
  console.log(`Skipped rows: ${skipped.length}`);
  console.log(`TACT IDs that needed normalization: ${tactIdNormalizedCount}`);
  console.log(`Domain breakdown: CHAT ${domainCounts.CHAT}, FIRST_CALL ${domainCounts.FIRST_CALL}, PAYMENT_CALL ${domainCounts.PAYMENT_CALL}`);
  console.log(`Rows with no recorded Severity (stored as null score): ${blankScoreCount}`);
  console.log(`Exact-duplicate rows within this CSV (same date/TACT/Lead ID/Domain/Severity) — imported as-is, see script header: ${exactDupeRows}`);
  if (skipped.length) {
    console.log(`\nFirst ${Math.min(20, skipped.length)} skipped row(s):`);
    for (const s of skipped.slice(0, 20)) console.log(`  line ${s.row}: ${s.reason}`);
  }

  const db = getDb();
  const { qaEvaluationHistory } = createRepositories(db);
  const existingBatchCount = await qaEvaluationHistory.countByBatch(BATCH_ID);
  console.log(`\nBatch "${BATCH_ID}" currently has ${existingBatchCount} row(s) in the table.`);

  if (!COMMIT) {
    console.log("\nDry run only — no writes made. Re-run with --commit to apply (add --replace to wipe this batch first).");
    return;
  }

  if (REPLACE) {
    console.log(`Wiping batch "${BATCH_ID}" before import (--replace)...`);
    await qaEvaluationHistory.deleteByBatch(BATCH_ID);
  }

  console.log(`Writing ${entries.length} row(s)...`);
  const inserted = await qaEvaluationHistory.bulkInsert(entries);
  console.log(`Done. Inserted ${inserted} row(s).`);
  console.log(
    "\nNote: the app's own in-process cache of this table (5-minute TTL, see qaDataEngine.ts's SHEET_CACHE_TTL_MS) " +
      "means the QA Dashboard and Team Tracker may take up to 5 minutes — or a server restart — to reflect these rows."
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Import failed:", err);
    process.exit(1);
  });
