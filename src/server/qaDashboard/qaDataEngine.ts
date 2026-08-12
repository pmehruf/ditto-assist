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

import { fetchSheetValues, dateStringToSerial, serialToDMY } from "./sheetsClient.js";
import { QA_SCORE_DASHBOARD_TACT_IDS } from "../../constants/qaDashboardAdvisorAllowlist.js";
import { getDb } from "../db/client.js";
import { createRepositories } from "../db/repositories/index.js";
import type { QaEvaluationHistoryRow } from "../db/schema.js";

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
  historyCache = null;
}

// ==================== ARCHIVE MERGE (qa_evaluation_history) ====================
// One-time-imported historical rows (see drizzle/0027_qa_evaluation_history.sql
// and scripts/importQaEvaluationHistory.ts) covering a period the live
// FEEDBACK_DUMP Sheet no longer holds — confirmed before this was built, so
// there's no overlap/double-count risk. getMergedFeedbackDumpRows() is a
// drop-in replacement for `getSheetDataCached(SHEETS.FEEDBACK_DUMP)` that
// stitches the archive's rows in, converted to the same serial-number
// cell-array shape, so every existing MASTER_DUMP_COLS-based reader below
// works completely unmodified.

interface HistoryCacheEntry {
  rows: QaEvaluationHistoryRow[];
  expiresAt: number;
}
let historyCache: HistoryCacheEntry | null = null;

async function getHistoryRowsCached(): Promise<QaEvaluationHistoryRow[]> {
  if (historyCache && historyCache.expiresAt > Date.now()) return historyCache.rows;
  const { qaEvaluationHistory } = createRepositories(getDb());
  const rows = await qaEvaluationHistory.listAll();
  historyCache = { rows, expiresAt: Date.now() + SHEET_CACHE_TTL_MS };
  return rows;
}

async function getMergedFeedbackDumpRows(): Promise<{ headers: string[]; rows: unknown[][] }> {
  const live = await getSheetDataCached(SHEETS.FEEDBACK_DUMP);
  const history = await getHistoryRowsCached();
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

  const historyRows: unknown[][] = history.map((h) => {
    const row = new Array(width);
    row[iChecked] = dateStringToSerial(h.checkedDate);
    // Nullable in ~24 source rows — left undefined rather than a fabricated
    // date, matching how the rest of this file already treats a missing/
    // non-numeric mistake cell (typeof check, not a truthy/falsy one).
    if (h.mistakeDate) row[iMistake] = dateStringToSerial(h.mistakeDate);
    row[iTact] = h.tactId;
    row[iChatId] = h.chatId;
    row[iDomain] = h.domain;
    row[iScore] = h.score;
    if (iAdvisorName !== -1) row[iAdvisorName] = h.advisorName;
    return row;
  });

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

export async function getAdvisorByEmail(email: string): Promise<Advisor | null> {
  const { headers, rows } = await getSheetDataCached(SHEETS.MASTER_ADVISORS);
  const emailCol = colIndex(headers, "Email ID");
  const tactCol = colIndex(headers, "Tact ID");
  const nameCol = colIndex(headers, "Name");
  const guideCol = guideColIndex(headers);
  const mentorCol = mentorColIndex(headers);

  const target = String(email).trim().toLowerCase();
  for (const row of rows) {
    if (String(row[emailCol]).trim().toLowerCase() === target) {
      return {
        tactId: String(row[tactCol]),
        name: String(row[nameCol]),
        guide: guideCol !== -1 ? (row[guideCol] != null ? String(row[guideCol]) : null) : null,
        mentor: mentorCol !== -1 ? (row[mentorCol] != null ? String(row[mentorCol]) : null) : null,
        skillDomain: readSkillDomain(headers, row),
      };
    }
  }
  return null;
}

export async function findAdvisorByTactId(tactId: string): Promise<Advisor | null> {
  const { headers, rows } = await getSheetDataCached(SHEETS.MASTER_ADVISORS);
  const tactCol = colIndex(headers, "Tact ID");
  const nameCol = colIndex(headers, "Name");
  const guideCol = guideColIndex(headers);
  const mentorCol = mentorColIndex(headers);

  const target = String(tactId).trim();
  for (const row of rows) {
    if (String(row[tactCol]).trim() === target) {
      return {
        tactId: String(row[tactCol]),
        name: String(row[nameCol]),
        guide: guideCol !== -1 ? (row[guideCol] != null ? String(row[guideCol]) : null) : null,
        mentor: mentorCol !== -1 ? (row[mentorCol] != null ? String(row[mentorCol]) : null) : null,
        skillDomain: readSkillDomain(headers, row),
      };
    }
  }
  return null;
}

export async function getAllAdvisors(): Promise<Advisor[]> {
  const { headers, rows } = await getSheetDataCached(SHEETS.MASTER_ADVISORS);
  const tactCol = colIndex(headers, "Tact ID");
  const nameCol = colIndex(headers, "Name");
  const guideCol = guideColIndex(headers);
  const mentorCol = mentorColIndex(headers);
  const statusCol = statusColIndex(headers);

  if (statusCol === -1) {
    console.warn(
      `[QA Dashboard] Could not find an employment-status column on master_advisors (looked for: ${STATUS_COL_NAMES.join(", ")}) — ` +
        "the \"Currently Employed\" filter can't be applied, so getAllAdvisors() is returning every row with a Tact ID, active or not. Check the sheet's header row."
    );
  }

  const advisors: Advisor[] = [];
  for (const row of rows) {
    if (!row[tactCol]) continue;
    if (statusCol !== -1) {
      const s = String(row[statusCol] ?? "").trim().toLowerCase();
      if (!EMPLOYED_STATUS_VALUES.includes(s)) continue;
    }
    advisors.push({
      tactId: String(row[tactCol]),
      name: String(row[nameCol]),
      guide: guideCol !== -1 ? (row[guideCol] != null ? String(row[guideCol]) : null) : null,
      mentor: mentorCol !== -1 ? (row[mentorCol] != null ? String(row[mentorCol]) : null) : null,
      skillDomain: readSkillDomain(headers, row),
    });
  }
  return advisors;
}

export async function getAdvisorsForGuide(guideName: string): Promise<Advisor[]> {
  const target = String(guideName).trim().toLowerCase();
  const all = await getAllAdvisors();
  return all.filter((a) => String(a.guide ?? "").trim().toLowerCase() === target);
}

/** tactId -> raw Mentor Name value, straight from master_advisors column E
 * (ported from MentorHelpers.gs's _getMentorNameByTactId). */
async function getMentorNameByTactId(): Promise<Map<string, string>> {
  const { headers, rows } = await getSheetDataCached(SHEETS.MASTER_ADVISORS);
  const map = new Map<string, string>();
  const tactCol = headers.indexOf("Tact ID");
  const mentorCol = mentorColIndex(headers);
  if (tactCol === -1 || mentorCol === -1) return map;

  for (const row of rows) {
    const tactId = String(row[tactCol] ?? "").trim();
    if (!tactId) continue;
    map.set(tactId, String(row[mentorCol] ?? "").trim());
  }
  return map;
}

export async function getAdvisorsForMentor(mentorName: string): Promise<Advisor[]> {
  const mentorLc = String(mentorName || "").trim().toLowerCase();
  if (!mentorLc) return [];
  const [mentorMap, all] = await Promise.all([getMentorNameByTactId(), getAllAdvisors()]);
  return all.filter((a) => (mentorMap.get(String(a.tactId).trim()) || "").trim().toLowerCase() === mentorLc);
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

export async function getAdvisorMetrics(tactId: string, dateFilters: ParsedDateFilters): Promise<AdvisorMetrics> {
  const { headers, rows } = await getMergedFeedbackDumpRows();
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

export interface BatchMetric {
  paymentsAvg: number | null;
  paymentsInstances: number;
  leadScoreAvg: number | null;
  leadScoreInstances: number;
  // Chat/Call QA scores — the plain per-domain average (like paymentsAvg),
  // distinct from leadScoreAvg's per-chat-id-min dedup across CHAT+CALL.
  chatAvg: number | null;
  chatInstances: number;
  callAvg: number | null;
  callInstances: number;
}

export async function getAdvisorsBatchMetrics(
  tactIds: string[],
  checkedFrom: number,
  checkedTo: number,
  tillDate: number
): Promise<Record<string, BatchMetric>> {
  const { headers, rows } = await getMergedFeedbackDumpRows();
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
      leadScoreAvg: avgOf(mins),
      leadScoreInstances: mins.length,
      chatAvg: avgOf(cScores),
      chatInstances: cScores.length,
      callAvg: avgOf(clScores),
      callInstances: clScores.length,
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
