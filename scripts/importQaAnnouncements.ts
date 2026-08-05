/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * ONE-TIME IMPORT — CSV backlog → announcements (QA Announcement)
 *
 * Imports a historical backlog of QA Announcements (scripts/data/
 * qa-announcements-import.csv) directly into the `announcements` table so
 * they appear in the Announcements Archive with their *original* dates,
 * instead of being re-entered by hand through the Announcement Manager form
 * (which would stamp today's date and mark them as fresh/unread).
 *
 * WHY THIS RUNS OUTSIDE THE APP, NOT THROUGH POST /api/announcements
 *  - The API route always sets createdAt = now() and requiresAck = true
 *    (see server.ts + schema.ts's `announcements` table default) — correct
 *    for a brand-new announcement, wrong for backfilling history.
 *  - This script inserts directly via Drizzle so it can set:
 *      • announcementDate / effectiveDate = the CSV's own dates (not today)
 *      • createdAt = derived from announcementDate (not now()), so the row
 *        doesn't jump to the top of any createdAt-sorted admin view either
 *      • requiresAck = false, the exact same flag migration 0023 used to
 *        grandfather in all pre-existing announcements — this is what keeps
 *        these rows out of the mandatory read-and-acknowledge modal (see
 *        announcementAcksRepository.ts's listUnackedForUser, which only
 *        ever selects requiresAck = true rows). No "new announcement"
 *        badge/notification logic anywhere else keys off anything but this
 *        flag + createdAt, so setting both is sufficient.
 *  - Touches no schema, no existing repository method, no UI. The only new
 *    thing that exists after this runs is data — same tables, same columns.
 *
 * SOURCE DATA
 *  scripts/data/qa-announcements-import.csv — columns:
 *    Titles, Severity, QA Announcement, Announcement, Announcement Date, Effective Date
 *  Every row is imported as-is (no dedupe, no skipping) per the request this
 *  script was written for. Dates arrive in two formats (D/M/YYYY and
 *  D-M-YYYY, both day-first — confirmed unambiguous: every row has at least
 *  one date component > 12 in the first position and none in the second).
 *  Effective Date is sometimes blank or the literal "Already inforce" — both
 *  map to null, the same as ticking the form's own "Already in-Force" box.
 *
 * SAFETY
 *  - Dry run by default: parses and prints a full preview, writes nothing.
 *  - Re-running with --commit after a successful commit WILL insert the CSV
 *    rows again (there is no unique key to dedupe against — announcements
 *    have no natural key). Only run --commit once.
 *
 * USAGE
 *   npx tsx scripts/importQaAnnouncements.ts            # dry run, prints every parsed row
 *   npx tsx scripts/importQaAnnouncements.ts --commit    # actually inserts
 */

import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import { getDb } from "../src/server/db/client.js";
import { announcements } from "../src/server/db/schema.js";

// Same as backfillAiMemory.ts / migrate.ts — this runs standalone, outside
// the server process, so DATABASE_URL has to be loaded from .env here.
dotenv.config();

const COMMIT = process.argv.includes("--commit");
const CSV_PATH = path.resolve(process.cwd(), "scripts/data/qa-announcements-import.csv");

// No CSV field identifies who originally posted these — every row is
// labelled as a historical bulk import rather than attributing it to
// whoever happens to run this script.
const ADDED_BY = "QA Team (Historical Import)";

// ---------------------------------------------------------------------------
// Minimal RFC4180 CSV parser — handles quoted fields with embedded commas,
// newlines, and doubled "" quotes, which the Announcement column relies on
// (multi-paragraph bodies quoted as a single field).
// ---------------------------------------------------------------------------
function parseCsv(raw: string): string[][] {
  const text = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  const len = text.length;

  const endField = () => {
    row.push(field);
    field = "";
  };
  const endRow = () => {
    endField();
    rows.push(row);
    row = [];
  };

  while (i < len) {
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

/** "2/9/2026" or "02-09-2026" (both day-first, confirmed unambiguous against
 * this CSV — see file header) -> "2026-09-02". Blank / "Already inforce" /
 * anything unparseable -> null. */
function parseDMY(input: string): string | null {
  const s = input.trim();
  if (!s || /^already\s*in\s*force$/i.test(s)) return null;
  const m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (!m) return null;
  const [, d, mo, y] = m;
  return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
}

function parseRating(input: string): number | null {
  const s = input.trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/**
 * Manual date correction(s) — confirmed by the user against the source
 * spreadsheet. Every other row in this CSV is unambiguously day-first (see
 * the file-header note: most rows have a first component > 12, which is
 * only valid as a day), but row 49's "06/11/2026" was actually entered
 * month-first in the source sheet and really means 11 June 2026, not
 * 6 November 2026. Keyed by 1-based CSV data-row number (the same `lineNo`
 * used in dry-run output and error messages) rather than by date string, so
 * this can't accidentally match some other unrelated row.
 */
const DATE_OVERRIDES: Record<number, { announcementDate?: string; effectiveDate?: string }> = {
  49: { announcementDate: "2026-06-11", effectiveDate: "2026-06-11" },
};

interface ParsedRow {
  lineNo: number; // 1-based data-row index, for error messages
  category: string;
  rating: number | null;
  announcement: string;
  announcementDate: string; // ISO, required
  effectiveDate: string | null;
}

function loadRows(): ParsedRow[] {
  const raw = fs.readFileSync(CSV_PATH, "utf8");
  const table = parseCsv(raw);
  const [header, ...data] = table;
  const expected = ["Titles", "Severity", "QA Announcement", "Announcement", "Announcement Date", "Effective Date"];
  if (header.length !== expected.length || header.some((h, i) => h.trim() !== expected[i])) {
    throw new Error(`Unexpected CSV header: ${JSON.stringify(header)}`);
  }

  return data.map((cols, idx) => {
    const lineNo = idx + 1;
    const [titles, severity, , announcementBody, annDateRaw, effDateRaw] = cols;
    const announcementDate = parseDMY(annDateRaw);
    if (!announcementDate) {
      throw new Error(`Row ${lineNo}: could not parse Announcement Date "${annDateRaw}"`);
    }
    const category = titles.trim();
    if (!category) throw new Error(`Row ${lineNo}: blank Titles/category`);
    const announcement = announcementBody.trim();
    if (!announcement) throw new Error(`Row ${lineNo}: blank Announcement body`);

    const override = DATE_OVERRIDES[lineNo];
    return {
      lineNo,
      category,
      rating: parseRating(severity),
      announcement,
      announcementDate: override?.announcementDate ?? announcementDate,
      effectiveDate: override?.effectiveDate ?? parseDMY(effDateRaw),
    };
  });
}

async function main() {
  const rows = loadRows();
  console.log(`Parsed ${rows.length} data rows from ${CSV_PATH}\n`);

  const sorted = [...rows].sort((a, b) => a.announcementDate.localeCompare(b.announcementDate));
  console.log(`Date range: ${sorted[0].announcementDate} .. ${sorted[sorted.length - 1].announcementDate}`);

  if (!COMMIT) {
    console.log("\n--- DRY RUN (no writes). Every parsed row: ---");
    rows.forEach((r) => {
      console.log(
        `  [${String(r.lineNo).padStart(2, "0")}] ${r.announcementDate} (eff ${r.effectiveDate ?? "—"}) ` +
          `rating=${r.rating ?? "—"} category="${r.category}" :: ${r.announcement.split("\n")[0].slice(0, 70)}...`
      );
    });
    console.log(`\n${rows.length} rows parsed OK. Re-run with --commit to insert them into the announcements table.`);
    return;
  }

  const db = getDb();
  let inserted = 0;

  // csv row order is NOT strictly chronological (a few rows near the end
  // jump backward — see file header), so createdAt is derived independently
  // per row from that row's own announcementDate, not from CSV position.
  // The `idx * 1000ms` nudge only disambiguates same-day rows (deterministic
  // CSV-order tie-break) and is far too small (max ~52s here) to ever cross
  // a day boundary and disturb ordering between different dates.
  for (let idx = 0; idx < rows.length; idx++) {
    const r = rows[idx];
    const createdAt = new Date(`${r.announcementDate}T00:00:00.000Z`);
    createdAt.setUTCSeconds(createdAt.getUTCSeconds() + idx);

    await db.insert(announcements).values({
      announcement: r.announcement,
      category: r.category,
      title: r.category,
      addedBy: ADDED_BY,
      rating: r.rating,
      type: "QA Announcement",
      validTillDate: null,
      fromTeam: null,
      announcementDate: r.announcementDate,
      effectiveDate: r.effectiveDate,
      // Grandfathered out of the mandatory read-and-acknowledge flow — same
      // flag/mechanism migration 0023 used for pre-existing history. This is
      // what keeps these rows from ever appearing as unread/new.
      requiresAck: false,
      createdAt,
    });
    inserted++;
  }

  console.log(`\nInserted ${inserted} announcements (requiresAck=false, historical dates preserved).`);
  console.log("Open Announcements Archive to verify.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Import failed:", err);
    process.exit(1);
  });
