/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * ONE-TIME IMPORT — qa_evaluation_history (source_batch "2025-payment-qa-backfill")
 * <- scripts/data/qa_payment_2025_backfill.csv
 *
 * Fills a Payment QA gap the ORIGINAL June 2025-May 2026 archive import
 * (scripts/importQaEvaluationHistory.ts, source_batch NULL) left before
 * Jan 2026 — per the person who requested this import, the current QA data
 * (live Sheet + that original archive) is missing/sparse for Payment QA
 * evaluations checked before 2026-01-01. This is a fresh export of Payment
 * QA evaluations covering June 2025 through the present; ONLY rows with
 * Checked Date strictly before CUTOFF_DATE below are imported — everything
 * from Jan 2026 onward is already covered by the live master_feedback_dump
 * Google Sheet, so those rows are silently skipped (not an error, not a
 * "duplicate" — just out of this batch's scope) rather than risking a
 * double count against the Sheet.
 *
 * SOURCE FORMAT: Checked Date, Date of Mistake, Chat ID, TACT ID, Advisor, Score
 * (note the column order — Chat ID before TACT ID — differs from both
 * earlier import scripts' CSVs). No Domain column: this export is Payment QA
 * only, so every row is stamped domain "PAYMENT_CALL" (the same TASK_TYPES
 * code qaDataEngine.ts and the live Sheet use).
 *
 * DUPLICATE SAFETY — stronger than the two earlier import scripts needed:
 *   - qaDataEngine.ts's getMergedFeedbackDumpRows() only de-dupes an archive
 *     row against the LIVE SHEET at read time (see its own "OVERLAP /
 *     DE-DUPE" comment) — it has no way to de-dupe one archive batch against
 *     another. This batch's date range (June-Dec 2025) sits INSIDE the
 *     original archive's own June 2025-May 2026 range, so that original
 *     import may already hold some of these exact Payment QA rows (if its
 *     source CSV had any Payment coverage for this period at all — unknown
 *     without inspecting the live DB, which this script does at runtime
 *     instead of guessing). To stay safe regardless of how much overlap
 *     actually exists, this script queries every EXISTING qa_evaluation_history
 *     row already in this batch's checked-date range (from every OTHER
 *     batch — the original NULL-batch import and any other batch, but never
 *     this batch's own prior rows, so a --replace re-run behaves correctly —
 *     see the code comment at that check) and skips any CSV row whose
 *     (checked date, TACT ID, chat ID, domain, score) exactly matches one
 *     already stored. Only genuinely new rows are inserted.
 *   - Exact duplicates WITHIN this CSV itself (same key repeated) are still
 *     imported as-is, not silently collapsed — a repeat evaluation of the
 *     same chat on the same day is legitimate (see the original script's own
 *     comment); flagged in the summary for a human sanity-check.
 *
 * SAFETY
 *  - Read-only against the CSV and against the rest of qa_evaluation_history;
 *    writes only new rows stamped with this script's own BATCH_ID.
 *  - Re-running with --commit APPENDS by default (would create duplicates of
 *    THIS SAME batch's own rows on a second run — the against-DB dedupe
 *    check only protects against OTHER batches, matching both earlier
 *    scripts' documented behavior); pass --replace together with --commit to
 *    first delete only this batch's existing rows (deleteByBatch), never the
 *    original archive import or any other batch.
 *
 * USAGE
 *   npx tsx scripts/importPayment2025QaBackfill.ts                    # dry run, prints a summary
 *   npx tsx scripts/importPayment2025QaBackfill.ts --commit            # append
 *   npx tsx scripts/importPayment2025QaBackfill.ts --commit --replace  # wipe this batch first, then import
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
const CSV_PATH = path.join(__dirname, "data", "qa_payment_2025_backfill.csv");

const BATCH_ID = "2025-payment-qa-backfill";
const DOMAIN = "PAYMENT_CALL";
// Exclusive upper bound — only Checked Dates strictly before this are
// imported. Everything from this date onward is already covered by the live
// Sheet, per the explicit ask this batch fills ("Payment QA before Jan
// 2026").
const CUTOFF_DATE = "2026-01-01";

/**
 * Minimal RFC4180-ish CSV parser: handles double-quoted fields (including
 * embedded commas and embedded newlines), "" as an escaped literal quote
 * inside a quoted field, and both CRLF and LF line endings. Returns rows as
 * plain string arrays; the header row is included (caller skips it). Copied
 * from the two earlier import scripts rather than shared, matching their own
 * one-time/standalone nature.
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
  const expected = ["Checked Date", "Date of Mistake", "Chat ID", "TACT ID", "Advisor", "Score"];
  const headerOk = expected.every((col, idx) => header[idx] === col);
  if (!headerOk) {
    console.error(`Unexpected header. Expected: ${expected.join(", ")}\nGot: ${header.join(", ")}`);
    process.exit(1);
  }

  const dataRows = table.slice(1);
  const entries: NewQaEvaluationHistoryEntry[] = [];
  const skipped: SkipReason[] = [];
  let outOfRangeCount = 0; // Checked Date >= CUTOFF_DATE — expected, not an error
  let blankScoreCount = 0;
  let tactIdNormalizedCount = 0;
  const exactDupeKeys = new Map<string, number>();

  dataRows.forEach((cols, idx) => {
    const lineNo = idx + 2; // +1 for 0-index, +1 for header row
    const [checkedRaw, mistakeRaw, chatRaw, tactRaw, advisorRaw, scoreRaw] = cols;

    const checkedDate = ddmmyyyyToIso((checkedRaw || "").trim());
    if (!checkedDate) {
      skipped.push({ row: lineNo, reason: `invalid Checked Date "${checkedRaw}"` });
      return;
    }
    if (checkedDate >= CUTOFF_DATE) {
      outOfRangeCount++;
      return; // already covered by the live Sheet — not imported, not an error
    }

    const mistakeRawTrimmed = (mistakeRaw || "").trim();
    let mistakeDate: string | null = null;
    if (mistakeRawTrimmed !== "") {
      mistakeDate = ddmmyyyyToIso(mistakeRawTrimmed);
      if (!mistakeDate) {
        skipped.push({ row: lineNo, reason: `invalid Date of Mistake "${mistakeRaw}"` });
        return;
      }
    }

    const chatId = (chatRaw || "").trim();
    if (!chatId) {
      skipped.push({ row: lineNo, reason: "missing Chat ID" });
      return;
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

    const scoreTrimmed = (scoreRaw || "").trim();
    let score: number | null = null;
    if (scoreTrimmed !== "") {
      const n = Number(scoreTrimmed);
      if (!Number.isInteger(n) || n < 1 || n > 5) {
        skipped.push({ row: lineNo, reason: `invalid Score "${scoreRaw}"` });
        return;
      }
      score = n;
    } else {
      blankScoreCount++;
    }

    const dupeKey = `${checkedDate}|${tactId}|${chatId}|${DOMAIN}|${score ?? ""}`;
    exactDupeKeys.set(dupeKey, (exactDupeKeys.get(dupeKey) || 0) + 1);

    entries.push({ checkedDate, mistakeDate, tactId, advisorName, chatId, domain: DOMAIN, score, sourceBatch: BATCH_ID });
  });

  const exactDupeRows = [...exactDupeKeys.values()].filter((n) => n > 1).reduce((sum, n) => sum + (n - 1), 0);

  console.log("\n--- Parse summary ---");
  console.log(`Data rows parsed: ${dataRows.length}`);
  console.log(`In-range rows (Checked Date < ${CUTOFF_DATE}): ${entries.length}`);
  console.log(`Out-of-range rows (Checked Date >= ${CUTOFF_DATE}, already covered by the live Sheet — not imported): ${outOfRangeCount}`);
  console.log(`Skipped (invalid/missing data): ${skipped.length}`);
  console.log(`TACT IDs that needed normalization: ${tactIdNormalizedCount}`);
  console.log(`Rows with no recorded Score (stored as null): ${blankScoreCount}`);
  console.log(`Exact-duplicate rows within this CSV (imported as-is, see script header): ${exactDupeRows}`);
  if (skipped.length) {
    console.log(`\nFirst ${Math.min(20, skipped.length)} skipped row(s):`);
    for (const s of skipped.slice(0, 20)) console.log(`  line ${s.row}: ${s.reason}`);
  }

  if (entries.length === 0) {
    console.log("\nNothing in range to import. Exiting.");
    return;
  }

  // ── De-dupe against rows ALREADY in the DB, from any OTHER batch — see
  // the script header's "DUPLICATE SAFETY" section. Deliberately excludes
  // this batch's own rows (sourceBatch === BATCH_ID) from the comparison set:
  // on a plain re-run without --replace, re-inserting this batch's own rows
  // is the documented, accepted "APPENDS by default" behavior (matching both
  // earlier scripts); on a --replace re-run, this query runs BEFORE the wipe
  // below, so if it didn't exclude this batch's own rows, a rerun would see
  // its own about-to-be-wiped rows as "already archived" and wrongly skip
  // re-inserting them.
  const db = getDb();
  const { qaEvaluationHistory } = createRepositories(db);
  const earliestDate = entries.reduce((min, e) => (e.checkedDate < min ? e.checkedDate : min), entries[0].checkedDate);
  const latestDate = entries.reduce((max, e) => (e.checkedDate > max ? e.checkedDate : max), entries[0].checkedDate);
  console.log(`\nChecking existing qa_evaluation_history rows for ${earliestDate}..${latestDate} to avoid re-importing rows already archived by another batch...`);
  const existingRows = await qaEvaluationHistory.listInRange(earliestDate, latestDate);
  const existingKeys = new Set(
    existingRows
      .filter((r) => r.sourceBatch !== BATCH_ID)
      .map((r) => `${r.checkedDate}|${String(r.tactId).trim()}|${String(r.chatId).trim()}|${String(r.domain).trim()}|${r.score ?? ""}`)
  );
  console.log(`Found ${existingRows.length} existing row(s) already in that range (${existingKeys.size} from other batches, considered for de-dupe).`);

  const toInsert = entries.filter((e) => !existingKeys.has(`${e.checkedDate}|${e.tactId}|${e.chatId}|${e.domain}|${e.score ?? ""}`));
  const alreadyArchivedCount = entries.length - toInsert.length;
  console.log(`Already archived by another batch (exact match on date/TACT/chat/domain/score) — skipped to avoid duplicates: ${alreadyArchivedCount}`);
  console.log(`New rows to insert: ${toInsert.length}`);

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

  console.log(`Writing ${toInsert.length} row(s)...`);
  const inserted = await qaEvaluationHistory.bulkInsert(toInsert);
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
