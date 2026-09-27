/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * QA DASHBOARD — DATA ENGINE
 * ---------------------------------------------------------------
 * Node port of the standalone QA Dashboard's Phase1_DataEngine.gs +
 * MentorHelpers.gs + the _getReviewRows/getAdvisorFeedback business logic
 * from BackendAPI.gs. Reads live, read-only, from the same Google Sheet
 * (master_advisors / master_feedback_dump / qa_feedback) — never
 * duplicates or writes data. See sheetsClient.ts for the read layer and its
 * date-serial-number approach (replaces Apps Script's timezone-anchored
 * Date objects with plain calendar-day integers — see that file's header).
 *
 * Deliberately mirrors the original's structure and comments closely so the
 * two can be diffed against each other if the source sheet's schema ever
 * changes and both need updating in lockstep.
 */

import { fetchSheetValues, dateStringToSerial, serialToDMY, serialToISODate } from "./sheetsClient.js";
import { QA_SCORE_DASHBOARD_TACT_IDS } from "../../constants/qaDashboardAdvisorAllowlist.js";
import { getDb } from "../db/client.js";
import { createRepositories } from "../db/repositories/index.js";
import type { QaEvaluationHistoryColumns } from "../db/repositories/index.js";

const SHEETS = {
  QA_FEEDBACK: "qa_feedback",
  MASTER_ADVISORS: "master_advisors",
  FEEDBACK_DUMP: "master_feedback_dump",
} as const;

const MASTER_DUMP_COLS = {
  CHECKED_DATE: "effective_date",
  MISTAKE_DATE: "helper_mistake_date",
  TACT_ID: "advisor_tact",
  CHAT_ID: "chat_display_id",
  DOMAIN: "task_type",
  SCORE: "score",
} as const;

const TASK_TYPES = { CHAT: "CHAT", CALL: "FIRST_CALL", PAYMENT: "PAYMENT_CALL" } as const;
const PERFECT_SCORE = 5;

// Friendly labels for the raw task_type/"Domain" enum — matches the Chats/
// Calls/Payments naming already used by the Score tab's BucketCards.
const DOMAIN_LABELS: Record<string, string> = {
  [TASK_TYPES.CHAT]: "Chat",
  [TASK_TYPES.CALL]: "Call",
  [TASK_TYPES.PAYMENT]: "Payment",
};
function domainLabel(raw: unknown): string {
  const s = String(raw ?? "").trim();
  return DOMAIN_LABELS[s] || s;
}

export interface Advisor {
  tactId: string;
  name: string;
  guide: string | null;
  mentor: string | null;
  /** master_advisors column F ("Health"/"Term"/"Both", etc.) — see
   * skillDomainColIndex's comment. Not a filter criterion (that's status
   * only, see EMPLOYED_STATUS_VALUES) — just attached to the advisor
   * record for the User Directory / a future skill-domain-based feature. */
  skillDomain: string | null;
  /** master_advisors "Email ID" column — same lookup getAdvisorByEmail
   * already uses. Added (additive-only, no existing field changed) for
   * advisorDirectorySync.ts's email-based directory matching; every other
   * consumer of Advisor already ignores fields it doesn't use. */
  email: string | null;
}

export interface DateFilters {
  checkedFrom: string; // "yyyy-MM-dd"
  checkedTo: string;
  tillDate: string;
}

interface ParsedDateFilters {
  checkedFrom: number;
  checkedTo: number;
  tillDate: number;
}

export function parseDateFilters(f: DateFilters): ParsedDateFilters {
  return {
    checkedFrom: dateStringToSerial(f.checkedFrom, false),
    checkedTo: dateStringToSerial(f.checkedTo, true),
    tillDate: dateStringToSerial(f.tillDate, false),
  };
}

// ==================== SHEET READ CACHE ====================
// Mirrors Phase1_DataEngine.gs's CacheService-backed cache: a short TTL so
// repeat page loads / advisor switches don't re-fetch the whole sheet every
// time, while keeping this a pure read-through cache that always falls back
// to a live fetch on miss. In-process Map instead of Apps Script's shared
// ScriptCache (no chunking needed — no per-key size limit here).
const SHEET_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes, matches SHEET_CACHE_TTL_SEC

interface SheetCacheEntry {
  headers: string[];
  rows: unknown[][];
  expiresAt: number;
}

const sheetCache = new Map<string, SheetCacheEntry>();

async function getSheetDataCached(sheetName: string): Promise<{ headers: string[]; rows: unknown[][] }> {
  const hit = sheetCache.get(sheetName);
  if (hit && hit.expiresAt > Date.now()) return hit;

  const values = await fetchSheetValues(sheetName);
  const headers = (values[0] || []).map((h) => String(h));
  const rows = values.slice(1);
  const entry: SheetCacheEntry = { headers, rows, expiresAt: Date.now() + SHEET_CACHE_TTL_MS };
  sheetCache.set(sheetName, entry);
  return entry;
}

/** Exposed so an admin action ("Refresh") can force a re-read instead of
 * waiting out the TTL, without needing to restart the server. Also clears
 * the qa_evaluation_history cache below, so a corrected re-import is picked
 * up the same way a live Sheet edit is. */
export function invalidateQaSheetCache(): void {
  sheetCache.clear();
  historyCacheByRange.clear();
  advisorSnapshotCache.clear();
}

// ==================== ARCHIVE MERGE (qa_evaluation_history) ====================
// One-time-imported historical/backfill rows (see drizzle/0027_qa_evaluation_history.sql,
// drizzle/0061_qa_evaluation_history_source_batch.sql, scripts/importQaEvaluationHistory.ts
// and scripts/importJune2026QaBackfill.ts). getMergedFeedbackDumpRows() is a
// drop-in replacement for `getSheetDataCached(SHEETS.FEEDBACK_DUMP)` that
// stitches the archive's rows in, converted to the same serial-number
// cell-array shape, so every existing MASTER_DUMP_COLS-based reader below
// works completely unmodified.
//
// OVERLAP / DE-DUPE: the original archive batch (June 2025-May 2026)
// covered a period the live Sheet never held, so it never needed de-dupe
// logic. A later batch — the 2026-06 gap-fill, imported to cover rows the
// freshly-launched live Sheet was missing — DOES overlap the Sheet's own
// date range by design (the whole point is filling in-range gaps, not a
// range the Sheet never had). To stay safe if the QA team later completes
// the Sheet with the very rows a batch already fills in, every archive row
// is checked against a de-dupe key built from the live Sheet's own rows
// (checked date + TACT ID + chat ID + domain + score, see rowDedupeKey())
// before being merged in — a match means the same evaluation is already
// live, so the archive row is dropped rather than double-counted. This
// applies uniformly to every batch (harmless no-op for the original one,
// since it shares no dates with the live Sheet to ever match against).

interface HistoryCacheEntry {
  rows: QaEvaluationHistoryColumns[];
  expiresAt: number;
}
// Keyed by checked_date range ("yyyy-MM-dd|yyyy-MM-dd", or "all" for the
// unfiltered fetch) instead of a single shared entry — different callers
// now ask for different SQL-pushed-down ranges (see getHistoryRowsCached),
// so a single-entry cache would thrash between them. In practice this stays
// cheap: both the Home page widget and the QA Dashboard page default to
// "current month", so most concurrent traffic within the 5-minute TTL still
// shares one entry, same as the old single-entry cache did.
const historyCacheByRange = new Map<string, HistoryCacheEntry>();

function historyCacheKey(checkedFrom?: string, checkedTo?: string): string {
  return checkedFrom && checkedTo ? `${checkedFrom}|${checkedTo}` : "all";
}

/** checkedFrom/checkedTo (when both given) push a `WHERE checked_date
 * BETWEEN ...` down into SQL via listInRange(), using the existing
 * qa_evaluation_history_checked_date_idx — the archive is a frozen,
 * one-time import covering 2025-06-01..2026-05-31 (confirmed 2026-08-17),
 * so most real callers asking for "this month"/"last month" now fetch 0
 * rows instead of all ~54k. Omit both args for the pre-existing "give me
 * everything" behavior (listAll()) — used by getAdvisorReviews, which
 * filters by a different date column and can't safely narrow this fetch;
 * see its comment below. */
async function getHistoryRowsCached(checkedFrom?: string, checkedTo?: string): Promise<QaEvaluationHistoryColumns[]> {
  const key = historyCacheKey(checkedFrom, checkedTo);
  const hit = historyCacheByRange.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.rows;
  const { qaEvaluationHistory } = createRepositories(getDb());
  const rows =
    checkedFrom && checkedTo
      ? await qaEvaluationHistory.listInRange(checkedFrom, checkedTo)
      : await qaEvaluationHistory.listAll();
  historyCacheByRange.set(key, { rows, expiresAt: Date.now() + SHEET_CACHE_TTL_MS });
  return rows;
}

/** checkedFrom/checkedTo (optional, "yyyy-MM-dd") are forwarded straight to
 * getHistoryRowsCached's SQL pushdown — pass both when the caller filters
 * its OWN output by checked_date (getAdvisorMetrics, getAdvisorsBatchMetrics
 * do); omit both when it doesn't (getAdvisorReviews), since narrowing the
 * archive fetch by a date range the caller isn't actually filtering by
 * would silently drop rows it needs. */
// De-dupe key for one evaluation, shared between a live Sheet row and an
// archive row so the two can be compared — see the OVERLAP / DE-DUPE note
// above. Includes score (not just date+TACT+chat+domain) so a genuine
// second evaluation of the same chat on the same day (the existing scripts'
// own "the same Chat ID can legitimately appear multiple times" case) isn't
// mistaken for a duplicate unless every field, score included, matches too —
// at which point treating it as the same evaluation logged twice is by far
// the more likely explanation.
// Exported only so its exact-match semantics can be unit tested directly
// (qaDataEngine.test.ts) without mocking the full Sheets+DB merge pipeline
// getMergedFeedbackDumpRows() sits behind — not used by any other module.
export function rowDedupeKey(checkedSerial: unknown, tactId: unknown, chatId: unknown, domain: unknown, score: unknown): string {
  return `${checkedSerial}|${String(tactId ?? "").trim()}|${String(chatId ?? "").trim()}|${String(domain ?? "").trim()}|${score ?? ""}`;
}

async function getMergedFeedbackDumpRows(checkedFrom?: string, checkedTo?: string): Promise<{ headers: string[]; rows: unknown[][] }> {
  const live = await getSheetDataCached(SHEETS.FEEDBACK_DUMP);
  const history = await getHistoryRowsCached(checkedFrom, checkedTo);
  if (history.length === 0 || live.headers.length === 0) return live;

  const iChecked = colIndex(live.headers, MASTER_DUMP_COLS.CHECKED_DATE);
  const iMistake = colIndex(live.headers, MASTER_DUMP_COLS.MISTAKE_DATE);
  const iTact = colIndex(live.headers, MASTER_DUMP_COLS.TACT_ID);
  const iChatId = colIndex(live.headers, MASTER_DUMP_COLS.CHAT_ID);
  const iDomain = colIndex(live.headers, MASTER_DUMP_COLS.DOMAIN);
  const iScore = colIndex(live.headers, MASTER_DUMP_COLS.SCORE);
  // "advisor_name" isn't in MASTER_DUMP_COLS (only used by getAdvisorReviews
  // below) — looked up defensively with indexOf rather than colIndex so a
  // future rename there can't break the merge itself.
  const iAdvisorName = live.headers.indexOf("advisor_name");
  const width = Math.max(iChecked, iMistake, iTact, iChatId, iDomain, iScore, iAdvisorName) + 1;

  // Every evaluation the live Sheet already has, keyed for the overlap check
  // below — built once per call, off however many rows the Sheet currently
  // holds (cheap; the Sheet is thousands, not millions, of rows).
  const liveKeys = new Set<string>();
  for (const r of live.rows) {
    liveKeys.add(rowDedupeKey(r[iChecked], r[iTact], r[iChatId], r[iDomain], r[iScore]));
  }

  const historyRows: unknown[][] = [];
  for (const h of history) {
    const checkedSerial = dateStringToSerial(h.checkedDate);
    if (liveKeys.has(rowDedupeKey(checkedSerial, h.tactId, h.chatId, h.domain, h.score))) {
      // Already present in the live Sheet — skip so this archive row (from
      // a batch that overlaps the Sheet's own date range, see the OVERLAP /
      // DE-DUPE note above) doesn't double-count it.
      continue;
    }
    const row = new Array(width);
    row[iChecked] = checkedSerial;
    // Nullable in ~24 source rows — left undefined rather than a fabricated
    // date, matching how the rest of this file already treats a missing/
    // non-numeric mistake cell (typeof check, not a truthy/falsy one).
    if (h.mistakeDate) row[iMistake] = dateStringToSerial(h.mistakeDate);
    row[iTact] = h.tactId;
    row[iChatId] = h.chatId;
    row[iDomain] = h.domain;
    row[iScore] = h.score;
    if (iAdvisorName !== -1) row[iAdvisorName] = h.advisorName;
    historyRows.push(row);
  }

  return { headers: live.headers, rows: [...live.rows, ...historyRows] };
}

function colIndex(headers: string[], name: string): number {
  const idx = headers.indexOf(name);
  if (idx === -1) {
    throw new Error(`Expected column "${name}" not found in headers: ${headers.join(", ")}`);
  }
  return idx;
}

const GUIDE_COL_NAMES = ["guide", "assigned guide", "guide name", "qa guide"];
function guideColIndex(headers: string[]): number {
  return headers.findIndex((h) => GUIDE_COL_NAMES.includes(String(h).trim().toLowerCase()));
}

const MENTOR_COL_NAMES = ["mentor name", "mentor"];
function mentorColIndex(headers: string[]): number {
  return headers.findIndex((h) => MENTOR_COL_NAMES.includes(String(h).trim().toLowerCase()));
}

const STATUS_COL_NAMES = ["status", "employment status", "employment_status", "joining status"];
function statusColIndex(headers: string[]): number {
  return headers.findIndex((h) => STATUS_COL_NAMES.includes(String(h).trim().toLowerCase()));
}

// The three columns below back the Master Advisors page's Guide/Mentor
// Advisor Mapping (guideMentorRelationshipsSync.ts) only — tolerant header-name
// lookups in the same style as guide/mentor/status above, since the exact
// header text on master_advisors hasn't been confirmed against every
// possible spelling; a header that doesn't match any of these falls back to
// -1 (field left null), never a thrown error, so a naming mismatch degrades
// gracefully instead of breaking the whole sync.
const BATCH_COL_NAMES = ["batch number", "batch no", "batch no.", "batch id", "batch"];
function batchColIndex(headers: string[]): number {
  return headers.findIndex((h) => BATCH_COL_NAMES.includes(String(h).trim().toLowerCase()));
}

// "Date of moving out to a different role" — the sheet's own tracking of
// when an advisor stopped being an advisor because they moved internally,
// as distinct from resigning (see LAST_WORKING_DAY_COL_NAMES below).
const MOVED_OUT_COL_NAMES = [
  "date of moving out to a different role",
  "date of moving out",
  "moved out date",
  "moving out date",
  "role change date",
  "date of role change",
  "date moved to another role",
];
function movedOutColIndex(headers: string[]): number {
  return headers.findIndex((h) => MOVED_OUT_COL_NAMES.includes(String(h).trim().toLowerCase()));
}

const LAST_WORKING_DAY_COL_NAMES = ["last working day", "last working date", "lwd", "last day"];
function lastWorkingDayColIndex(headers: string[]): number {
  return headers.findIndex((h) => LAST_WORKING_DAY_COL_NAMES.includes(String(h).trim().toLowerCase()));
}

/** Reads a date-typed cell as "yyyy-MM-dd" — the sheet normally hands back
 * a Sheets serial number for a real date cell (see sheetsClient.ts's file
 * header), converted via serialToISODate; a small defensive fallback
 * handles a cell that's a plain date-like string instead (inconsistent
 * column typing happens on real spreadsheets), via Date.parse. Anything
 * else (blank, unparseable) is null rather than a guess. */
function readDateCell(headers: string[], row: unknown[], colIndexFn: (headers: string[]) => number): string | null {
  const idx = colIndexFn(headers);
  if (idx === -1) return null;
  const v = row[idx];
  if (v == null || v === "") return null;
  if (typeof v === "number") return serialToISODate(v);
  const parsed = new Date(String(v));
  if (!Number.isNaN(parsed.getTime())) return serialToISODate((parsed.getTime() - Date.UTC(1899, 11, 30)) / (24 * 60 * 60 * 1000));
  return null;
}
function readBatchNumber(headers: string[], row: unknown[]): string | null {
  const idx = batchColIndex(headers);
  if (idx === -1) return null;
  const v = row[idx];
  return v != null && String(v).trim() ? String(v).trim() : null;
}

// Positive match, not a blacklist — mirrors the live source-of-truth query
// the QA team itself uses against this sheet:
//   =QUERY(FILTER(master_advisors!A1:U, master_advisors!M:M="Currently Employed"), ...)
// (2026-08-07) Replaces a previous blacklist-of-keywords approach, and — more
// importantly — replaces a hardcoded, manually-maintained TACT ID allowlist
// (qaDashboardAdvisorAllowlist.ts) that the roster views used to additionally
// filter through on top of this. That list drifted out of sync with reality
// (118 shown vs. 132 actually "Currently Employed" advisors) because nothing
// kept it updated as people joined/left. This status check is now the ONLY
// eligibility filter for the roster views, so it stays correct automatically
// as the sheet changes — see getAllAdvisors below and qaDashboardService.ts's
// getAdvisorsDashboardListFor/getCompanyWideQaAggregateFor, which no longer
// filter through that allowlist.
const EMPLOYED_STATUS_VALUES = ["currently employed"];

// Column F on master_advisors — the product(s) an advisor is assigned to
// (e.g. "Health", "Term", "Both"). Business significance: attached to each
// advisor as their "skill domain" and surfaced in the app's User Directory,
// for a future feature the skill-domain data will drive (2026-08-07). Tried
// by header name first (resilient to sheet edits); falls back to the raw
// column F position (index 5) if none of these header names are present,
// since that's the exact column the QA team pointed at.
const SKILL_DOMAIN_COL_NAMES = ["product", "product assigned", "assigned product", "skill domain", "line of business", "lob"];
const SKILL_DOMAIN_FALLBACK_COL_INDEX = 5; // column F, 0-indexed
function skillDomainColIndex(headers: string[]): number {
  const byName = headers.findIndex((h) => SKILL_DOMAIN_COL_NAMES.includes(String(h).trim().toLowerCase()));
  if (byName !== -1) return byName;
  return headers.length > SKILL_DOMAIN_FALLBACK_COL_INDEX ? SKILL_DOMAIN_FALLBACK_COL_INDEX : -1;
}
function readSkillDomain(headers: string[], row: unknown[]): string | null {
  const idx = skillDomainColIndex(headers);
  if (idx === -1) return null;
  const v = row[idx];
  return v != null && String(v).trim() ? String(v).trim() : null;
}

// ==================== IDENTITY ====================

/** "Email ID" header lookup, tolerant of a missing column (some advisor
 * sheets predate the column, or a future header rename) — returns -1
 * rather than throwing, matching guideColIndex/mentorColIndex's pattern
 * rather than colIndex's throwing one, since email is optional context
 * here, not a hard requirement for every existing caller of this file. */
function emailColIndex(headers: string[]): number {
  const idx = headers.indexOf("Email ID");
  return idx;
}
function readEmail(headers: string[], row: unknown[]): string | null {
  const idx = emailColIndex(headers);
  if (idx === -1) return null;
  const v = row[idx];
  return v != null && String(v).trim() ? String(v).trim().toLowerCase() : null;
}

// ==================== ADVISOR RELATIONSHIP MAPPING (Access Control Center) ====================
// Advisor identity, Guide/Mentor mapping, and eligibility for QA Dashboard/
// Team Tracker no longer come from this sheet directly (2026-09 "Rewire
// Advisor Mapping" change) — they now come from the Access Control
// Center's Master Advisors page: guide_mentor_advisor_mappings (identity +
// eligibility) and guide_mentor_relationship_history (the Guide/Mentor
// timeline), both themselves POPULATED by a sync of this same sheet (see
// guideMentorRelationshipsSync.ts) — so master_advisors is still the
// ultimate source of the data, just no longer read live for every mapping
// lookup. getMasterAdvisorsRowsForSync/isEmployedStatus below remain
// sheet-reading — that sync path is unaffected; only the identity/pool
// lookups in this section moved to the DB.
//
// Two independent checks, both resolved as of one "asOfDate"
// ("yyyy-MM-dd"):
//   1. Was this advisor still active as of asOfDate? (eligibility — see
//      activeTillOf below, the same calculation
//      MasterAdvisorsManagement.tsx's own "Active Till" column uses: the
//      earlier of dateOfMovingOut/lastWorkingDay, or always-active if
//      neither is set)
//   2. Who was their Guide/Mentor as of asOfDate? (guide_mentor_
//      relationship_history's terminate-and-replace timeline)
// For a reporting call, asOfDate is the PERIOD'S START date (not its
// end) — so an advisor who left partway through a period, or whose
// Mentor/Guide changed partway through, still counts for that period the
// way they did at its start: "June data must remain attributed to Mentor
// A" even if the change to Mentor B happened on, say, June 15.
//
// Pre-history dates: guide_mentor_relationship_history only has real
// change-by-change data from when this feature shipped (2026-09) onward —
// migration 0072 backfilled one "active since [migration date]" row per
// advisor from whatever guide_mentor_advisor_mappings held at the time, so
// there is no true timeline before that point. For an asOfDate earlier
// than every history row for a given advisor/kind, resolvePersonAsOf
// falls back to that advisor's EARLIEST known row (its best available
// estimate for "who it probably was before we started tracking") rather
// than showing blank — a genuine mid-timeline gap (a relationship cleared
// to "None" and never replaced) still correctly resolves to null, since
// that fallback only applies when asOfDate precedes every row, not when
// it falls between two of them.

/** Internal snapshot row — carries `eligible` (see activeTillOf) so pool
 * functions (getAllAdvisorsAsOf and friends) can filter on it, while
 * identity lookups (findAdvisorByTactIdAsOf, getAdvisorByEmail) can ignore
 * it — a direct-by-tactId/email lookup should always find the record
 * regardless of employment status, matching the old sheet-based
 * findAdvisorByTactId/getAdvisorByEmail's behavior (neither ever applied
 * the Currently-Employed filter; only getAllAdvisors did). Never exposed
 * outside this file — every exported function strips it via
 * stripEligibility before returning. */
interface AdvisorSnapshotRow extends Advisor {
  eligible: boolean;
}
function stripEligibility(rows: AdvisorSnapshotRow[]): Advisor[] {
  return rows.map(({ eligible: _eligible, ...rest }) => rest);
}

const advisorSnapshotCache = new Map<string, { rows: AdvisorSnapshotRow[]; expiresAt: number }>();

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

/** The earlier of dateOfMovingOut/lastWorkingDay — same calculation as
 * MasterAdvisorsManagement.tsx's activeTillOf. null means "no known end
 * date", i.e. always eligible. */
function activeTillOf(m: { dateOfMovingOut: string | null; lastWorkingDay: string | null }): string | null {
  const dates = [m.dateOfMovingOut, m.lastWorkingDay].filter((d): d is string => !!d);
  if (dates.length === 0) return null;
  return dates.sort()[0];
}

/** Who held one relationship kind (guide/mentor) for one advisor as of
 * asOfDate, from their history rows — see the section comment above for
 * the pre-history fallback rule. `rows` should already be filtered to one
 * tactId+kind (unsorted is fine, this does its own scan). */
function resolvePersonAsOf(rows: { personName: string; startDate: string; endDate: string | null }[], asOfDate: string): string | null {
  if (rows.length === 0) return null;
  const covering = rows.find((r) => r.startDate <= asOfDate && (r.endDate === null || r.endDate >= asOfDate));
  if (covering) return covering.personName;
  const earliest = rows.reduce((a, b) => (a.startDate <= b.startDate ? a : b));
  if (asOfDate < earliest.startDate) return earliest.personName; // pre-history fallback
  return null; // asOfDate falls in a real gap (cleared, never replaced) — correctly nobody
}

/** Builds EVERY advisor's identity + Guide/Mentor as of asOfDate, each
 * tagged with whether they were active as of that date — no eligibility
 * filtering here (see AdvisorSnapshotRow's comment); callers decide
 * whether their use case needs the eligible-only subset. */
async function buildAdvisorSnapshotAsOf(asOfDate: string): Promise<AdvisorSnapshotRow[]> {
  const cached = advisorSnapshotCache.get(asOfDate);
  if (cached && cached.expiresAt > Date.now()) return cached.rows;

  const { guideMentorAdvisorMappings, guideMentorRelationshipHistory } = createRepositories(getDb());
  const [mappings, history] = await Promise.all([guideMentorAdvisorMappings.list(), guideMentorRelationshipHistory.listAll()]);

  const historyByTactId = new Map<string, { guide: typeof history; mentor: typeof history }>();
  for (const h of history) {
    let bucket = historyByTactId.get(h.tactId);
    if (!bucket) {
      bucket = { guide: [], mentor: [] };
      historyByTactId.set(h.tactId, bucket);
    }
    (h.kind === "guide" ? bucket.guide : bucket.mentor).push(h);
  }

  const rows: AdvisorSnapshotRow[] = mappings.map((m) => {
    const activeTill = activeTillOf(m);
    const bucket = historyByTactId.get(m.tactId);
    return {
      tactId: m.tactId,
      name: m.name,
      email: m.email,
      skillDomain: m.skillDomain,
      guide: bucket ? resolvePersonAsOf(bucket.guide, asOfDate) : null,
      mentor: bucket ? resolvePersonAsOf(bucket.mentor, asOfDate) : null,
      eligible: activeTill === null || asOfDate <= activeTill,
    };
  });

  advisorSnapshotCache.set(asOfDate, { rows, expiresAt: Date.now() + SHEET_CACHE_TTL_MS });
  return rows;
}

/** Every advisor who was ACTIVE as of asOfDate, with their Guide/Mentor as
 * of that same date — the DB-backed replacement for what getAllAdvisors()
 * used to read live from master_advisors (see section comment above).
 * Used directly by reporting call sites (QA Dashboard roster, Team
 * Tracker's monthly/period functions) that need a specific period's own
 * eligible membership. */
export async function getAllAdvisorsAsOf(asOfDate: string): Promise<Advisor[]> {
  const all = await buildAdvisorSnapshotAsOf(asOfDate);
  return stripEligibility(all.filter((a) => a.eligible));
}

export async function getAdvisorsForGuideAsOf(guideName: string, asOfDate: string): Promise<Advisor[]> {
  const target = String(guideName).trim().toLowerCase();
  if (!target) return [];
  const all = await buildAdvisorSnapshotAsOf(asOfDate);
  return stripEligibility(all.filter((a) => a.eligible && (a.guide || "").trim().toLowerCase() === target));
}

export async function getAdvisorsForMentorAsOf(mentorName: string, asOfDate: string): Promise<Advisor[]> {
  const target = String(mentorName).trim().toLowerCase();
  if (!target) return [];
  const all = await buildAdvisorSnapshotAsOf(asOfDate);
  return stripEligibility(all.filter((a) => a.eligible && (a.mentor || "").trim().toLowerCase() === target));
}

/** Direct identity lookup by tactId, as of asOfDate — deliberately ignores
 * eligibility (see AdvisorSnapshotRow's comment): once a caller already
 * has a specific tactId in hand (an advisor's own dashboard page, a
 * Guide/Mentor opening one team member), the record should always
 * resolve, showing who their Guide/Mentor was as of that date, even for a
 * period after the advisor became ineligible (e.g. viewing a resigned
 * advisor's final month). */
export async function findAdvisorByTactIdAsOf(tactId: string, asOfDate: string): Promise<Advisor | null> {
  const target = String(tactId).trim();
  const all = await buildAdvisorSnapshotAsOf(asOfDate);
  const row = all.find((a) => String(a.tactId).trim() === target);
  return row ? stripEligibility([row])[0] : null;
}

// ---- "Current" (today-anchored) identity/pool functions — every existing
// caller of these (access-control checks, the QA Dashboard/Team Tracker's
// own "who am I"/picker logic, coachingService.ts) keeps working
// unchanged; only what's UNDER them moved from live-sheet reads to the DB,
// anchored at today via the *AsOf functions above. Per this feature's own
// design decision, access control (who can open/search/coach an advisor)
// intentionally stays on the CURRENT relationship regardless of whatever
// period a report elsewhere is showing — only reporting call sites
// (getAdvisorsDashboardListFor, getCompanyWideQaAggregateFor, and Team
// Tracker's monthly/period functions) call the *AsOf variants directly
// with a period's own start date instead of going through these. ----

export async function getAdvisorByEmail(email: string): Promise<Advisor | null> {
  // Identity lookup, like findAdvisorByTactIdAsOf — deliberately ignores
  // eligibility, so a resigned advisor's own login still resolves to their
  // record rather than "no advisor found" (the old sheet-based version had
  // no status filter either).
  const target = String(email).trim().toLowerCase();
  const all = await buildAdvisorSnapshotAsOf(todayIsoDate());
  const row = all.find((a) => (a.email || "").trim().toLowerCase() === target);
  return row ? stripEligibility([row])[0] : null;
}

export async function findAdvisorByTactId(tactId: string): Promise<Advisor | null> {
  return findAdvisorByTactIdAsOf(tactId, todayIsoDate());
}

export async function getAllAdvisors(): Promise<Advisor[]> {
  return getAllAdvisorsAsOf(todayIsoDate());
}

/** True for the exact same "Currently Employed" match getAllAdvisors() uses
 * — exposed so advisorDirectorySync.ts can apply the identical filtering
 * rule without duplicating the EMPLOYED_STATUS_VALUES literal, per "without
 * changing the existing QA Dashboard sync or filtering logic." */
export function isEmployedStatus(statusRaw: string | null): boolean {
  return EMPLOYED_STATUS_VALUES.includes(String(statusRaw ?? "").trim().toLowerCase());
}

export interface MasterAdvisorsRow extends Advisor {
  /** Raw, untrimmed Status cell (column header-matched, see
   * statusColIndex) — null if the sheet has no recognizable status column
   * at all. Use isEmployedStatus(statusRaw) for the actual filter. */
  statusRaw: string | null;
  /** master_advisors' Batch Number column, free text — see
   * batchColIndex's comment. Only consumed by
   * guideMentorRelationshipsSync.ts today. */
  batchNumber: string | null;
  /** "Date of moving out to a different role" — see movedOutColIndex's
   * comment. "yyyy-MM-dd", or null if blank/unrecognized/unparseable. */
  dateOfMovingOut: string | null;
  /** "Last working day" — see lastWorkingDayColIndex's comment. Same
   * "yyyy-MM-dd" format as dateOfMovingOut. */
  lastWorkingDay: string | null;
}

/**
 * Every row of master_advisors (Currently Employed or not), for
 * advisorDirectorySync.ts's directory sync — unlike getAllAdvisors(), which
 * pre-filters to only Currently Employed and is left completely unchanged
 * above, this returns every row (including a null-tactId row, since a sync
 * needs to see rows the roster views intentionally skip in order to report
 * accurate "records read" / "no longer employed" counts) plus the raw
 * status cell so the caller can apply isEmployedStatus() itself. Same
 * cached sheet read as every other function in this file — no separate
 * fetch, no separate cache entry.
 */
export async function getMasterAdvisorsRowsForSync(): Promise<{ totalRows: number; rows: MasterAdvisorsRow[] }> {
  const { headers, rows } = await getSheetDataCached(SHEETS.MASTER_ADVISORS);
  const tactCol = colIndex(headers, "Tact ID");
  const nameCol = colIndex(headers, "Name");
  const guideCol = guideColIndex(headers);
  const mentorCol = mentorColIndex(headers);
  const statusCol = statusColIndex(headers);

  const out: MasterAdvisorsRow[] = rows
    .filter((row) => row[tactCol] || row[nameCol]) // skip genuinely blank rows (no tact id AND no name)
    .map((row) => ({
      tactId: row[tactCol] != null ? String(row[tactCol]) : "",
      name: row[nameCol] != null ? String(row[nameCol]) : "",
      guide: guideCol !== -1 ? (row[guideCol] != null ? String(row[guideCol]) : null) : null,
      mentor: mentorCol !== -1 ? (row[mentorCol] != null ? String(row[mentorCol]) : null) : null,
      skillDomain: readSkillDomain(headers, row),
      email: readEmail(headers, row),
      statusRaw: statusCol !== -1 && row[statusCol] != null ? String(row[statusCol]) : null,
      batchNumber: readBatchNumber(headers, row),
      dateOfMovingOut: readDateCell(headers, row, movedOutColIndex),
      lastWorkingDay: readDateCell(headers, row, lastWorkingDayColIndex),
    }));

  return { totalRows: out.length, rows: out };
}

export async function getAdvisorsForGuide(guideName: string): Promise<Advisor[]> {
  return getAdvisorsForGuideAsOf(guideName, todayIsoDate());
}

export async function getAdvisorsForMentor(mentorName: string): Promise<Advisor[]> {
  return getAdvisorsForMentorAsOf(mentorName, todayIsoDate());
}

export function isInScoreDashboardAllowlist(tactId: string): boolean {
  return QA_SCORE_DASHBOARD_TACT_IDS.has(String(tactId).trim());
}

// ==================== METRIC ENGINE ====================

interface BucketMetrics {
  instances: number;
  perfect: number;
  perfectPct: number | null;
  average: number | null;
}

export interface AdvisorMetrics {
  tactId: string;
  loChats: BucketMetrics;
  loCalls: BucketMetrics;
  loPayments: BucketMetrics;
  leadScore: { totalScore: number; numberOfLeads: number; average: number | null };
}

function sum(arr: number[]): number {
  return arr.reduce((a, b) => a + b, 0);
}
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export async function getAdvisorMetrics(
  tactId: string,
  dateFilters: ParsedDateFilters,
  rawRange: Pick<DateFilters, "checkedFrom" | "checkedTo">
): Promise<AdvisorMetrics> {
  // rawRange is the pre-parseDateFilters "yyyy-MM-dd" pair — needed
  // verbatim for the archive's SQL pushdown (see getMergedFeedbackDumpRows);
  // dateFilters/ParsedDateFilters below are the already-parsed serial
  // numbers used for the in-memory checked/mistake comparisons, unchanged.
  const { headers, rows } = await getMergedFeedbackDumpRows(rawRange.checkedFrom, rawRange.checkedTo);
  const iChecked = colIndex(headers, MASTER_DUMP_COLS.CHECKED_DATE);
  const iMistake = colIndex(headers, MASTER_DUMP_COLS.MISTAKE_DATE);
  const iTact = colIndex(headers, MASTER_DUMP_COLS.TACT_ID);
  const iChatId = colIndex(headers, MASTER_DUMP_COLS.CHAT_ID);
  const iDomain = colIndex(headers, MASTER_DUMP_COLS.DOMAIN);
  const iScore = colIndex(headers, MASTER_DUMP_COLS.SCORE);

  const { checkedFrom, checkedTo, tillDate } = dateFilters;
  const tactIdStr = String(tactId).trim();

  const inScope = rows.filter((r) => {
    const checked = r[iChecked];
    const mistake = r[iMistake];
    return (
      String(r[iTact]).trim() === tactIdStr &&
      typeof checked === "number" &&
      checked >= checkedFrom &&
      checked <= checkedTo &&
      typeof mistake === "number" &&
      mistake >= tillDate
    );
  });

  function bucketMetrics(taskType: string): BucketMetrics {
    const scores = inScope.filter((r) => r[iDomain] === taskType).map((r) => Number(r[iScore]));
    const instances = scores.length;
    const perfect = scores.filter((s) => s === PERFECT_SCORE).length;
    const average = instances ? round2(sum(scores) / instances) : null;
    const perfectPct = instances ? round2((perfect / instances) * 100) : null;
    return { instances, perfect, perfectPct, average };
  }

  const leadRows = inScope.filter((r) => r[iDomain] === TASK_TYPES.CHAT || r[iDomain] === TASK_TYPES.CALL);
  const minByChatId = new Map<unknown, number>();
  for (const r of leadRows) {
    const chatId = r[iChatId];
    const score = Number(r[iScore]);
    const existing = minByChatId.get(chatId);
    if (existing === undefined || score < existing) minByChatId.set(chatId, score);
  }
  const leadScores = Array.from(minByChatId.values());
  const leadInstances = leadScores.length;
  const leadTotal = round2(sum(leadScores));
  const leadAverage = leadInstances ? round2(leadTotal / leadInstances) : null;

  return {
    tactId,
    loChats: bucketMetrics(TASK_TYPES.CHAT),
    loCalls: bucketMetrics(TASK_TYPES.CALL),
    loPayments: bucketMetrics(TASK_TYPES.PAYMENT),
    leadScore: { totalScore: leadTotal, numberOfLeads: leadInstances, average: leadAverage },
  };
}

/** A "blunder" is any evaluation scored 1 or 2 (out of 5) — the Team
 * Tracker's per-medium blunder-% sections divide this count by the
 * medium's own instance count. Kept as a named threshold rather than a
 * bare literal so its meaning is discoverable from a single definition. */
const BLUNDER_MAX_SCORE = 2;

export interface BatchMetric {
  paymentsAvg: number | null;
  paymentsInstances: number;
  /** Count of paymentsAvg's own scores that were 1 or 2 — see
   * BLUNDER_MAX_SCORE. Always <= paymentsInstances. */
  paymentsBlunders: number;
  leadScoreAvg: number | null;
  leadScoreInstances: number;
  /** Count of the per-chat-id-min scores (same dedup as leadScoreAvg) that
   * were 1 or 2. */
  leadScoreBlunders: number;
  // Chat/Call QA scores — the plain per-domain average (like paymentsAvg),
  // distinct from leadScoreAvg's per-chat-id-min dedup across CHAT+CALL.
  chatAvg: number | null;
  chatInstances: number;
  chatBlunders: number;
  callAvg: number | null;
  callInstances: number;
  callBlunders: number;
}

export async function getAdvisorsBatchMetrics(
  tactIds: string[],
  checkedFrom: number,
  checkedTo: number,
  tillDate: number,
  rawRange: Pick<DateFilters, "checkedFrom" | "checkedTo">
): Promise<Record<string, BatchMetric>> {
  // See getAdvisorMetrics's comment — rawRange is the pre-parse string pair,
  // passed through to the archive's SQL pushdown only; the numeric
  // checkedFrom/checkedTo/tillDate params below (already-parsed serials)
  // still drive every in-memory comparison, unchanged.
  const { headers, rows } = await getMergedFeedbackDumpRows(rawRange.checkedFrom, rawRange.checkedTo);
  const iChecked = colIndex(headers, MASTER_DUMP_COLS.CHECKED_DATE);
  const iMistake = colIndex(headers, MASTER_DUMP_COLS.MISTAKE_DATE);
  const iTact = colIndex(headers, MASTER_DUMP_COLS.TACT_ID);
  const iChatId = colIndex(headers, MASTER_DUMP_COLS.CHAT_ID);
  const iDomain = colIndex(headers, MASTER_DUMP_COLS.DOMAIN);
  const iScore = colIndex(headers, MASTER_DUMP_COLS.SCORE);

  const wanted = new Set(tactIds.map((id) => String(id).trim()));
  const paymentScores = new Map<string, number[]>();
  const chatScores = new Map<string, number[]>();
  const callScores = new Map<string, number[]>();
  const minByChatId = new Map<string, Map<unknown, number>>();

  for (const r of rows) {
    const tact = String(r[iTact]).trim();
    if (!wanted.has(tact)) continue;
    const checked = r[iChecked];
    const mistake = r[iMistake];
    const inRange =
      typeof checked === "number" &&
      checked >= checkedFrom &&
      checked <= checkedTo &&
      typeof mistake === "number" &&
      mistake >= tillDate;
    if (!inRange) continue;

    const domain = r[iDomain];
    const score = Number(r[iScore]);
    if (domain === TASK_TYPES.PAYMENT) {
      if (!paymentScores.has(tact)) paymentScores.set(tact, []);
      paymentScores.get(tact)!.push(score);
    }
    if (domain === TASK_TYPES.CHAT) {
      if (!chatScores.has(tact)) chatScores.set(tact, []);
      chatScores.get(tact)!.push(score);
    }
    if (domain === TASK_TYPES.CALL) {
      if (!callScores.has(tact)) callScores.set(tact, []);
      callScores.get(tact)!.push(score);
    }
    if (domain === TASK_TYPES.CHAT || domain === TASK_TYPES.CALL) {
      const chatId = r[iChatId];
      if (!minByChatId.has(tact)) minByChatId.set(tact, new Map());
      const m = minByChatId.get(tact)!;
      const existing = m.get(chatId);
      if (existing === undefined || score < existing) m.set(chatId, score);
    }
  }

  function avgOf(scores: number[]): number | null {
    return scores.length ? round2(sum(scores) / scores.length) : null;
  }
  function blunderCount(scores: number[]): number {
    return scores.filter((s) => s <= BLUNDER_MAX_SCORE).length;
  }

  const result: Record<string, BatchMetric> = {};
  for (const id of tactIds) {
    const tact = String(id).trim();
    const pScores = paymentScores.get(tact) || [];
    const cScores = chatScores.get(tact) || [];
    const clScores = callScores.get(tact) || [];
    const mins = Array.from((minByChatId.get(tact) || new Map()).values());
    result[tact] = {
      paymentsAvg: avgOf(pScores),
      paymentsInstances: pScores.length,
      paymentsBlunders: blunderCount(pScores),
      leadScoreAvg: avgOf(mins),
      leadScoreInstances: mins.length,
      leadScoreBlunders: blunderCount(mins),
      chatAvg: avgOf(cScores),
      chatInstances: cScores.length,
      chatBlunders: blunderCount(cScores),
      callAvg: avgOf(clScores),
      callInstances: clScores.length,
      callBlunders: blunderCount(clScores),
    };
  }
  return result;
}

// ==================== TABULAR DATA (QA FEEDBACK / REVIEWS) ====================

export interface SheetTable {
  headers: string[];
  rows: Record<string, unknown>[];
}

// Columns whose raw value is a date serial and should render as DD-MM-YY,
// same set the original treats as dates via `cell instanceof Date`.
const KNOWN_DATE_HEADERS = new Set(["checked date", "mistake date"]);

/** Advisor Feedback tab — still reads the qa_feedback presentation sheet
 * (not yet repointed to master_feedback_dump; see Phase1_DataEngine.gs's
 * SOURCE OF TRUTH note — getAdvisorFeedback was deliberately left alone). */
export async function getAdvisorFeedback(
  tactId: string,
  checkedFromStr?: string | null,
  checkedToStr?: string | null
): Promise<SheetTable & { sheetMissing?: boolean }> {
  const { headers, rows } = await getSheetDataCached(SHEETS.QA_FEEDBACK);
  if (headers.length === 0) return { headers: [], rows: [], sheetMissing: true };

  const filterColIdx = headers.indexOf("TACT ID");
  if (filterColIdx === -1) return { headers, rows: [] };
  const sortColIdx = headers.indexOf("Checked Date");

  const target = String(tactId).trim().toLowerCase();
  let matched = rows.filter((r) => String(r[filterColIdx]).trim().toLowerCase() === target);

  // Optional Checked Date range filter — applied on the raw serial value,
  // same as getAdvisorReviews's date-range handling, before serialToDMY
  // formatting below discards the numeric type.
  if (sortColIdx !== -1 && (checkedFromStr || checkedToStr)) {
    const dateFrom = checkedFromStr ? dateStringToSerial(checkedFromStr, false) : null;
    const dateTo = checkedToStr ? dateStringToSerial(checkedToStr, true) : null;
    matched = matched.filter((r) => {
      const cell = r[sortColIdx];
      if (typeof cell !== "number") return false;
      if (dateFrom !== null && cell < dateFrom) return false;
      if (dateTo !== null && cell > dateTo) return false;
      return true;
    });
  }

  if (sortColIdx !== -1) {
    matched.sort((a, b) => {
      const at = typeof a[sortColIdx] === "number" ? (a[sortColIdx] as number) : 0;
      const bt = typeof b[sortColIdx] === "number" ? (b[sortColIdx] as number) : 0;
      return bt - at;
    });
  }

  const outRows = matched.map((rowArr) => {
    const obj: Record<string, unknown> = {};
    headers.forEach((h, idx) => {
      const cell = rowArr[idx];
      obj[h] = KNOWN_DATE_HEADERS.has(h.trim().toLowerCase()) && typeof cell === "number" ? serialToDMY(cell) : cell;
    });
    return obj;
  });

  return { headers, rows: outRows };
}

/** Combined Dispute + Escalation rows, derived live from master_feedback_dump
 * (ported from BackendAPI.gs's _getReviewRows). Note: this endpoint parses
 * its date-range args with a plain calendar-day boundary rather than
 * _parseSheetDate's careful end-of-day handling — that's an existing
 * inconsistency in the source project (getReviewRows never adopted the
 * _parseSheetDate fix), preserved here rather than silently "fixed", per
 * "preserve existing production behavior unless explicitly instructed
 * otherwise." */
export async function getAdvisorReviews(
  tactId: string,
  checkedFromStr: string | null,
  checkedToStr: string | null
): Promise<SheetTable & { sheetMissing?: boolean; error?: string }> {
  const advisor = await findAdvisorByTactId(tactId);
  if (!advisor) return { headers: [], rows: [], error: "Advisor not found" };

  // Deliberately called with NO range, even though this function has its
  // own checkedFromStr/checkedToStr — those filter dispute_raised_at/
  // escalation_raised_at below (a different column), not checked_date, so
  // narrowing the archive fetch by them would silently drop legitimate
  // rows. Always pulls the full archive; see getMergedFeedbackDumpRows.
  const { headers, rows } = await getMergedFeedbackDumpRows();
  if (headers.length === 0) return { headers: [], rows: [], sheetMissing: true };

  const iTact = colIndex(headers, "advisor_tact");
  const iAdvisor = colIndex(headers, "advisor_name");
  const iChat = colIndex(headers, "chat_display_id");
  const iDomain = colIndex(headers, MASTER_DUMP_COLS.DOMAIN);
  const iScore = colIndex(headers, "score");
  const iDispRaised = colIndex(headers, "dispute_raised");
  const iDispRaisedAt = colIndex(headers, "dispute_raised_at");
  const iDispStatus = colIndex(headers, "dispute_status");
  const iDispComment = colIndex(headers, "dispute_comment");
  const iDispResolvedAt = colIndex(headers, "dispute_resolved_at");
  const iDispResponse = colIndex(headers, "dispute_response");
  const iEscRaised = colIndex(headers, "escalation_raised");
  const iEscRaisedAt = colIndex(headers, "escalation_raised_at");
  const iEscStatus = colIndex(headers, "escalation_status");
  const iEscComment = colIndex(headers, "escalation_comment");
  const iEscResolvedAt = colIndex(headers, "escalation_resolved_at");
  const iEscResponse = colIndex(headers, "escalation_response");

  const target = String(tactId).trim().toLowerCase();
  const hasDateFilter = !!checkedFromStr || !!checkedToStr;
  const dateFrom = checkedFromStr ? dateStringToSerial(checkedFromStr, false) : null;
  const dateTo = checkedToStr ? dateStringToSerial(checkedToStr, false) : null;

  function inDateRange(cell: unknown): boolean {
    if (!hasDateFilter) return true;
    if (typeof cell !== "number") return false;
    if (dateFrom !== null && cell < dateFrom) return false;
    if (dateTo !== null && cell > dateTo) return false;
    return true;
  }
  function isYes(v: unknown): boolean {
    return String(v).trim().toLowerCase() === "yes";
  }
  function fmt(cell: unknown): unknown {
    return typeof cell === "number" ? serialToDMY(cell) : cell;
  }

  const out: (Record<string, unknown> & { _sortDate: number })[] = [];
  for (const row of rows) {
    if (String(row[iTact]).trim().toLowerCase() !== target) continue;

    if (isYes(row[iDispRaised])) {
      const dRaised = row[iDispRaisedAt];
      if (inDateRange(dRaised)) {
        out.push({
          _sortDate: typeof dRaised === "number" ? dRaised : 0,
          "TACT ID": row[iTact],
          Advisor: row[iAdvisor],
          "Chat ID": row[iChat],
          Domain: domainLabel(row[iDomain]),
          Type: "Dispute",
          Score: row[iScore],
          Raised: fmt(dRaised),
          Resolved: fmt(row[iDispResolvedAt]),
          Comment: row[iDispComment],
          "QA Response": row[iDispResponse],
          Status: row[iDispStatus],
        });
      }
    }

    if (isYes(row[iEscRaised])) {
      const eRaised = row[iEscRaisedAt];
      if (inDateRange(eRaised)) {
        out.push({
          _sortDate: typeof eRaised === "number" ? eRaised : 0,
          "TACT ID": row[iTact],
          Advisor: row[iAdvisor],
          "Chat ID": row[iChat],
          Domain: domainLabel(row[iDomain]),
          Type: "Escalation",
          Score: row[iScore],
          Raised: fmt(eRaised),
          Resolved: fmt(row[iEscResolvedAt]),
          Comment: row[iEscComment],
          "QA Response": row[iEscResponse],
          Status: row[iEscStatus],
        });
      }
    }
  }

  out.sort((a, b) => b._sortDate - a._sortDate);
  out.forEach((r) => delete (r as Record<string, unknown>)._sortDate);

  return {
    headers: ["TACT ID", "Advisor", "Chat ID", "Domain", "Type", "Score", "Raised", "Resolved", "Comment", "QA Response", "Status"],
    rows: out,
  };
}
