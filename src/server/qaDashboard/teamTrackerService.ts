/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * TEAM QA PERFORMANCE TRACKER — REQUEST-LEVEL SERVICE
 * ---------------------------------------------------------------
 * Backs the "Team Tracker" page (src/pages/TeamTrackerPage.tsx). This is a
 * NEW, separate service file — it does not modify qaDashboardService.ts or
 * qaDataEngine.ts, and does not reimplement any QA scoring math. Every
 * number here comes from qaDataEngine.ts's existing getAdvisorsBatchMetrics
 * (same function the QA Dashboard's own roster/summary view already calls),
 * just invoked once per calendar month instead of once for a single date
 * range, then combined into a "Cumulative Score" using the exact same
 * average-of-Lead-and-Payments definition already established by
 * QaPerformancePeek.tsx's "Consolidated Score" (there is no other composite
 * score defined anywhere in the QA data model).
 *
 * Role/eligibility model reused as-is from qaRoles.ts:
 *   Admin   — must explicitly choose a Guide or a Mentor to see any data
 *             (this page never shows an unscoped "everyone" view).
 *   Guide   — sees only their own team (getAdvisorsForGuide).
 *   Mentor  — sees only their own mentees (getAdvisorsForMentor).
 *   Advisor — no access to this page at all (FORBIDDEN) — unlike the QA
 *             Dashboard, which also shows a plain Advisor their own record,
 *             Team Tracker is a manager-of-others view only.
 */

import {
  getAllAdvisors,
  getAdvisorsForGuide,
  getAdvisorsForMentor,
  getAdvisorsBatchMetrics,
  parseDateFilters,
  type Advisor,
  type DateFilters,
} from "./qaDataEngine.js";
import { resolveQaCallerRole } from "./qaRoles.js";

type ErrorResult = { error: string; message: string };
function isError(x: unknown): x is ErrorResult {
  return !!x && typeof x === "object" && "error" in (x as object);
}

// ==================== MONTH / DATE-FILTER GENERATION ====================
// Mirrors QaDashboardPage.tsx's computeDefaultDates() exactly (Start = 1st
// of month, End = last day of month, Till = 2nd-to-last day of the PREVIOUS
// month), generalized from "the current month" to an arbitrary (year,
// month) pair so it can be applied across every month in the selected
// period. Same formula, same shape — just parameterized.

function pad(n: number): string {
  return String(n).padStart(2, "0");
}
function fmtDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** monthIndex0 is 0-11 (January = 0), matching JS Date's own convention. */
export function monthDateFilters(year: number, monthIndex0: number): DateFilters {
  return {
    checkedFrom: `${year}-${pad(monthIndex0 + 1)}-01`,
    checkedTo: fmtDate(new Date(year, monthIndex0 + 1, 0)),
    tillDate: fmtDate(new Date(year, monthIndex0, -1)),
  };
}

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export interface MonthSpec {
  /** "yyyy-MM", sortable and stable for use as a React key / grouping key. */
  key: string;
  /** "Jun 2026", for display. */
  label: string;
  filters: DateFilters;
}

/** Inclusive month range, "yyyy-MM" strings at both ends. Capped at 36
 * months (3 years) as a defensive limit against a malformed/huge custom
 * range — well beyond the "Last 1 Year" the UI itself ever requests. */
export function enumerateMonths(fromYm: string, toYm: string): MonthSpec[] {
  const [fy, fm] = fromYm.split("-").map(Number);
  const [ty, tm] = toYm.split("-").map(Number);
  if (!fy || !fm || !ty || !tm) return [];

  const out: MonthSpec[] = [];
  let y = fy;
  let m = fm - 1; // 0-indexed
  const targetY = ty;
  const targetM = tm - 1;
  let guard = 0;
  while (guard < 36 && (y < targetY || (y === targetY && m <= targetM))) {
    out.push({
      key: `${y}-${pad(m + 1)}`,
      label: `${MONTH_NAMES[m]} ${y}`,
      filters: monthDateFilters(y, m),
    });
    m++;
    if (m > 11) {
      m = 0;
      y++;
    }
    guard++;
  }
  return out;
}

// ==================== ROLE / POOL RESOLUTION ====================

export interface TeamTrackerContext {
  isAdmin: boolean;
  isGuide: boolean;
  isMentor: boolean;
  callerName: string;
  scopeLabel: string;
  advisors: Advisor[];
  /** True when an Admin hasn't picked a Guide or Mentor yet — advisors is
   * empty in that case; guides/mentors below are populated instead so the
   * page can render the picker. Always false for Guide/Mentor (their pool
   * is implicit). */
  needsSelection: boolean;
  guides: string[];
  mentors: string[];
}

async function resolvePool(
  email: string,
  requestedGuide: string | null,
  requestedMentor: string | null
): Promise<{ pool: Advisor[]; scopeLabel: string; needsSelection: false } | { pool: []; scopeLabel: ""; needsSelection: true; guides: string[]; mentors: string[] } | ErrorResult> {
  const role = await resolveQaCallerRole(email);

  if (role.isGuide) {
    const pool = await getAdvisorsForGuide(role.callerName);
    return { pool, scopeLabel: `${role.callerName}'s Team`, needsSelection: false };
  }
  if (role.isMentor) {
    const pool = await getAdvisorsForMentor(role.callerName);
    return { pool, scopeLabel: `${role.callerName}'s Mentees`, needsSelection: false };
  }
  if (role.isAdmin) {
    const guideSel = (requestedGuide || "").trim();
    const mentorSel = (requestedMentor || "").trim();
    if (guideSel) {
      const pool = await getAdvisorsForGuide(guideSel);
      return { pool, scopeLabel: `${guideSel}'s Team`, needsSelection: false };
    }
    if (mentorSel) {
      const pool = await getAdvisorsForMentor(mentorSel);
      return { pool, scopeLabel: `${mentorSel}'s Mentees`, needsSelection: false };
    }
    const all = await getAllAdvisors();
    const guides = Array.from(new Set(all.map((a) => (a.guide || "").trim()).filter(Boolean))).sort();
    const mentors = Array.from(new Set(all.map((a) => (a.mentor || "").trim()).filter(Boolean))).sort();
    return { pool: [], scopeLabel: "", needsSelection: true, guides, mentors };
  }
  return { error: "FORBIDDEN", message: "Team Tracker is only available to Admins, Guides, and Mentors." };
}

/** "Who am I, and what can I see" — used both to gate the sidebar nav item
 * (App.tsx probes this once and treats a FORBIDDEN response as "hide the
 * link") and to populate the page's own filters (advisor list, and for an
 * Admin, the Guide/Mentor picker options). */
export async function getTeamTrackerContext(
  email: string,
  requestedGuide: string | null,
  requestedMentor: string | null
): Promise<TeamTrackerContext | ErrorResult> {
  try {
    const role = await resolveQaCallerRole(email);
    if (!role.isAdmin && !role.isGuide && !role.isMentor) {
      return { error: "FORBIDDEN", message: "Team Tracker is only available to Admins, Guides, and Mentors." };
    }
    const resolved = await resolvePool(email, requestedGuide, requestedMentor);
    if (isError(resolved)) return resolved;

    if (resolved.needsSelection) {
      return {
        isAdmin: role.isAdmin,
        isGuide: role.isGuide,
        isMentor: role.isMentor,
        callerName: role.callerName,
        scopeLabel: "",
        advisors: [],
        needsSelection: true,
        guides: resolved.guides,
        mentors: resolved.mentors,
      };
    }
    return {
      isAdmin: role.isAdmin,
      isGuide: role.isGuide,
      isMentor: role.isMentor,
      callerName: role.callerName,
      scopeLabel: resolved.scopeLabel,
      advisors: resolved.pool,
      needsSelection: false,
      guides: [],
      mentors: [],
    };
  } catch (err: any) {
    return { error: "SERVER_ERROR", message: err.message };
  }
}

// ==================== MONTHLY TABLE ====================

export interface MonthlyAdvisorRow {
  tactId: string;
  name: string;
  monthKey: string;
  monthLabel: string;
  leadScoreAvg: number | null;
  leadScoreInstances: number;
  /** Count of that month's Lead Score evaluations scored 1 or 2 — see
   * qaDataEngine.ts's BLUNDER_MAX_SCORE. */
  leadScoreBlunders: number;
  paymentsAvg: number | null;
  paymentsInstances: number;
  paymentsBlunders: number;
  chatAvg: number | null;
  chatInstances: number;
  chatBlunders: number;
  callAvg: number | null;
  callInstances: number;
  callBlunders: number;
  /** average of Lead Score + Payment QA Score — null only when BOTH are
   * null (no Lead or Payment data that month at all), matching the same
   * null-tolerant averaging QaPerformancePeek.tsx's Consolidated Score
   * already uses. Never derived from Chat/Call. */
  cumulativeScore: number | null;
}

function avgOf(a: number | null, b: number | null): number | null {
  const vals = [a, b].filter((v): v is number => v !== null);
  if (vals.length === 0) return null;
  return Math.round((vals.reduce((s, v) => s + v, 0) / vals.length) * 100) / 100;
}

export interface TeamTrackerTableResult {
  scopeLabel: string;
  isAdmin: boolean;
  isGuide: boolean;
  isMentor: boolean;
  months: MonthSpec[];
  rows: MonthlyAdvisorRow[];
}

export async function getTeamTrackerTable(
  email: string,
  requestedGuide: string | null,
  requestedMentor: string | null,
  requestedTactId: string | null,
  fromYm: string,
  toYm: string
): Promise<TeamTrackerTableResult | ErrorResult> {
  try {
    const role = await resolveQaCallerRole(email);
    if (!role.isAdmin && !role.isGuide && !role.isMentor) {
      return { error: "FORBIDDEN", message: "Team Tracker is only available to Admins, Guides, and Mentors." };
    }
    const resolved = await resolvePool(email, requestedGuide, requestedMentor);
    if (isError(resolved)) return resolved;
    if (resolved.needsSelection) {
      return { error: "NO_SELECTION", message: "Select a Guide or Mentor first" };
    }

    let pool = resolved.pool;
    const tactFilter = (requestedTactId || "").trim();
    if (tactFilter) {
      pool = pool.filter((a) => String(a.tactId).trim() === tactFilter);
    }

    const months = enumerateMonths(fromYm, toYm);
    if (pool.length === 0 || months.length === 0) {
      return { scopeLabel: resolved.scopeLabel, isAdmin: role.isAdmin, isGuide: role.isGuide, isMentor: role.isMentor, months, rows: [] };
    }

    const tactIds = pool.map((a) => String(a.tactId).trim());

    // One batch-metrics call per month (same function, same math the QA
    // Dashboard's own roster view uses for a single range) — run
    // concurrently since each is an independent read of the same
    // already-cached sheet/archive data.
    const perMonthMetrics = await Promise.all(
      months.map((m) => {
        const parsed = parseDateFilters(m.filters);
        return getAdvisorsBatchMetrics(tactIds, parsed.checkedFrom, parsed.checkedTo, parsed.tillDate, m.filters);
      })
    );

    const rows: MonthlyAdvisorRow[] = [];
    months.forEach((m, mi) => {
      const metricsByTact = perMonthMetrics[mi];
      for (const a of pool) {
        const tact = String(a.tactId).trim();
        const mm = metricsByTact[tact];
        rows.push({
          tactId: a.tactId,
          name: a.name,
          monthKey: m.key,
          monthLabel: m.label,
          leadScoreAvg: mm?.leadScoreAvg ?? null,
          leadScoreInstances: mm?.leadScoreInstances ?? 0,
          leadScoreBlunders: mm?.leadScoreBlunders ?? 0,
          paymentsAvg: mm?.paymentsAvg ?? null,
          paymentsInstances: mm?.paymentsInstances ?? 0,
          paymentsBlunders: mm?.paymentsBlunders ?? 0,
          chatAvg: mm?.chatAvg ?? null,
          chatInstances: mm?.chatInstances ?? 0,
          chatBlunders: mm?.chatBlunders ?? 0,
          callAvg: mm?.callAvg ?? null,
          callInstances: mm?.callInstances ?? 0,
          callBlunders: mm?.callBlunders ?? 0,
          cumulativeScore: avgOf(mm?.leadScoreAvg ?? null, mm?.paymentsAvg ?? null),
        });
      }
    });

    return { scopeLabel: resolved.scopeLabel, isAdmin: role.isAdmin, isGuide: role.isGuide, isMentor: role.isMentor, months, rows };
  } catch (err: any) {
    return { error: "SERVER_ERROR", message: err.message };
  }
}
