/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * ONE-TIME IMPORT — qa_evaluation_history <- scripts/data/qa_evaluation_history.csv
 *
 * Loads the historical QA evaluation export (June 2025-May 2026 — a period
 * the live master_feedback_dump Google Sheet no longer holds, confirmed
 * before this table/script was built, so there's no overlap/double-count
 * risk with the live Sheet data src/server/qaDashboard/qaDataEngine.ts
 * reads) into the qa_evaluation_history table. That table only carries the
 * six identification columns from the sheet export (dates, TACT ID,
 * advisor name, chat ID, domain, score) — no dispute/escalation/feedback
 * text, which this source file doesn't contain either.
 *
 * Uses a real RFC4180-ish CSV parser (quoted fields, embedded commas,
 * doubled-quote escaping) rather than a naive split(",") — unlike the much
 * smaller advisor CSV backfill, this file has at least one row with a
 * legitimately quoted comma inside a field.
 *
 * SAFETY
 *  - Read-only against the CSV; writes only to this app's own
 *    qa_evaluation_history table.
 *  - No natural unique key across the source rows to upsert against (the
 *    same Chat ID can legitimately appear multiple times — repeat
 *    evaluations of the same chat). Re-running with --commit therefore
 *    APPENDS by default; pass --replace together with --commit to wipe the
 *    table first instead (use after re-importing a corrected CSV).
 *
 * USAGE
 *   npx tsx scripts/importQaEvaluationHistory.ts                    # dry run, prints a summary
 *   npx tsx scripts/importQaEvaluationHistory.ts --commit            # append
 *   npx tsx scripts/importQaEvaluationHistory.ts --commit --replace  # wipe table first, then import
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
const CSV_PATH = path.join(__dirname, "data", "qa_evaluation_history.csv");

const VALID_DOMAINS = new Set(["CHAT", "FIRST_CALL", "PAYMENT_CALL"]);

/**
 * Minimal RFC4180-ish CSV parser: handles double-quoted fields (including
 * embedded commas and embedded newlines), "" as an escaped literal quote
 * inside a quoted field, and both CRLF and LF line endings. Returns rows as
 * plain string arrays; the header row is included (caller skips it).
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
      // Peek for \r\n; either way this ends the row.
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
  // Trailing field/row with no terminating newline.
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
  const expected = ["Checked Date", "Mistake Date", "TACT ID", "Advisor", "CHAT ID", "Domain", "Score"];
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
  let blankMistakeDateCount = 0;
  let tactIdNormalizedCount = 0;

  dataRows.forEach((cols, idx) => {
    const lineNo = idx + 2; // +1 for 0-index, +1 for header row
    const [checkedRaw, mistakeRaw, tactRaw, advisorRaw, chatRaw, domainRaw, scoreRaw] = cols;

    const checkedDate = ddmmyyyyToIso((checkedRaw || "").trim());
    if (!checkedDate) {
      skipped.push({ row: lineNo, reason: `invalid Checked Date "${checkedRaw}"` });
      return;
    }
    // Mistake Date is nullable — ~24 source rows have it blank. A non-blank
    // value that still fails to parse is a real data-quality problem
    // (typo/wrong format), so that case is still skipped and reported.
    const mistakeRawTrimmed = (mistakeRaw || "").trim();
    let mistakeDate: string | null = null;
    if (mistakeRawTrimmed !== "") {
      mistakeDate = ddmmyyyyToIso(mistakeRawTrimmed);
      if (!mistakeDate) {
        skipped.push({ row: lineNo, reason: `invalid Mistake Date "${mistakeRaw}"` });
        return;
      }
    } else {
      blankMistakeDateCount++;
    }
    const tactId = normalizeTactId((tactRaw || "").trim());
    if (!tactId) {
      skipped.push({ row: lineNo, reason: `missing/invalid TACT ID "${tactRaw}"` });
      return;
    }
    if (tactId !== (tactRaw || "").trim()) tactIdNormalizedCount++;

    const advisorName = (advisorRaw || "").trim();
    if (!advisorName) {
      skipped.push({ row: lineNo, reason: "missing Advisor name" });
      return;
    }
    const chatId = (chatRaw || "").trim();
    if (!chatId) {
      skipped.push({ row: lineNo, reason: "missing CHAT ID" });
      return;
    }
    const domain = (domainRaw || "").trim();
    if (!VALID_DOMAINS.has(domain)) {
      skipped.push({ row: lineNo, reason: `unrecognized Domain "${domainRaw}"` });
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

    domainCounts[domain] = (domainCounts[domain] || 0) + 1;
    entries.push({ checkedDate, mistakeDate, tactId, advisorName, chatId, domain, score });
  });

  console.log("\n--- Summary ---");
  console.log(`Data rows parsed: ${dataRows.length}`);
  console.log(`Valid rows: ${entries.length}`);
  console.log(`Skipped rows: ${skipped.length}`);
  console.log(`TACT IDs that needed normalization: ${tactIdNormalizedCount}`);
  console.log(`Domain breakdown: CHAT ${domainCounts.CHAT}, FIRST_CALL ${domainCounts.FIRST_CALL}, PAYMENT_CALL ${domainCounts.PAYMENT_CALL}`);
  console.log(`Rows with no recorded Score (stored as null): ${blankScoreCount}`);
  console.log(`Rows with no Mistake Date (stored as null): ${blankMistakeDateCount}`);
  if (skipped.length) {
    console.log(`\nFirst ${Math.min(20, skipped.length)} skipped row(s):`);
    for (const s of skipped.slice(0, 20)) console.log(`  line ${s.row}: ${s.reason}`);
  }

  const db = getDb();
  const { qaEvaluationHistory } = createRepositories(db);
  const existingCount = await qaEvaluationHistory.count();
  console.log(`\nTable currently has ${existingCount} row(s).`);

  if (!COMMIT) {
    console.log("\nDry run only — no writes made. Re-run with --commit to apply (add --replace to wipe the table first).");
    return;
  }

  if (REPLACE) {
    console.log("Wiping qa_evaluation_history before import (--replace)...");
    await qaEvaluationHistory.deleteAll();
  }

  console.log(`Writing ${entries.length} row(s)...`);
  const inserted = await qaEvaluationHistory.bulkInsert(entries);
  console.log(`Done. Inserted ${inserted} row(s).`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Import failed:", err);
    process.exit(1);
  });
