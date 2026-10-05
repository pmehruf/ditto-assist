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
  getAdvisorsForGuideAsOf,
  getAdvisorsForMentorAsOf,
  getAdvisorsBatchMetrics,
  parseDateFilters,
  type Advisor,
  type DateFilters,
  type BatchMetric,
} from "./qaDataEngine.js";
import { resolveQaCallerRole } from "./qaRoles.js";
import { getDb } from "../db/client.js";
import { createRepositories } from "../db/repositories/index.js";

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

/** Same as monthDateFilters, but checkedTo is clamped to the given
 * day-of-month instead of the month's last day — "as of the Nth day of
 * this month" (Team Tracker Home Page's Current Month Period Change,
 * comparing a month-to-date score against prior months' scores as of that
 * same day-of-month). `day` is clamped to the month's own last day, so
 * asking for day 31 of a 28/29/30-day month still returns that month's
 * full range rather than an invalid date. tillDate keeps the exact same
 * "2nd-to-last day of the PREVIOUS month" convention as monthDateFilters —
 * that cutoff is about mistake-eligibility, not the checked-date window
 * being clamped here, so it does not scale with `day`. */
export function partialMonthDateFilters(year: number, monthIndex0: number, day: number): DateFilters {
  const lastDay = new Date(year, monthIndex0 + 1, 0).getDate();
  const clampedDay = Math.min(Math.max(day, 1), lastDay);
  return {
    checkedFrom: `${year}-${pad(monthIndex0 + 1)}-01`,
    checkedTo: `${year}-${pad(monthIndex0 + 1)}-${pad(clampedDay)}`,
    tillDate: fmtDate(new Date(year, monthIndex0, -1)),
  };
}

/** Same Start/End/Till formula as monthDateFilters, generalized from one
 * calendar month to an arbitrary [fromYm, toYm] range: checkedFrom = 1st of
 * fromYm, checkedTo = last day of toYm, tillDate = 2nd-to-last day of the
 * month BEFORE fromYm (identical "day -1 of the start month" trick
 * monthDateFilters uses, just anchored on the whole period's own start
 * instead of each individual month's). Backs getTeamTrackerPeriodSummary —
 * a single getAdvisorsBatchMetrics call over the *actual* date range,
 * instead of averaging each month's own already-rounded average (see that
 * function's header comment). */
export function periodDateFilters(fromYm: string, toYm: string): DateFilters {
  const [fy, fm] = fromYm.split("-").map(Number);
  const [ty, tm] = toYm.split("-").map(Number);
  return {
    checkedFrom: `${fy}-${pad(fm)}-01`,
    checkedTo: fmtDate(new Date(ty, tm, 0)),
    tillDate: fmtDate(new Date(fy, fm - 1, -1)),
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

/** One entry in the Mentor/Guide Selection Page's picker (Task: real
 * avatars instead of a generic icon) — `pictureUrl` is that person's
 * Google account photo as of their own last sign-in (users.picture,
 * stamped by server.ts's OAuth callback), matched to this guide/mentor
 * NAME best-effort (see resolvePool's own comment on the matching). null
 * when no directory user matches, or that user has never signed in, or
 * their Google account has no photo — callers fall back to an initials
 * avatar in all three cases. */
export interface TeamTrackerPerson {
  name: string;
  pictureUrl: string | null;
}

export interface TeamTrackerContext {
  isAdmin: boolean;
  isGuide: boolean;
  isMentor: boolean;
  callerName: string;
  scopeLabel: string;
  /** For a Guide/Mentor (or an Admin who has picked one), the scoped team's
   * advisors. While needsSelection is true, this is every advisor instead
   * — powers the Admin picker page's own Advisor search box so an Admin
   * can jump straight to one advisor without first picking a Guide or
   * Mentor; guides/mentors below are populated in that case too, for the
   * rest of the picker. */
  advisors: Advisor[];
  /** True when an Admin hasn't picked a Guide or Mentor yet — the
   * table/pivot itself still requires picking one; only the picker page's
   * Advisor search box uses `advisors` while this is true. Always false
   * for Guide/Mentor (their pool is implicit). */
  needsSelection: boolean;
  guides: TeamTrackerPerson[];
  mentors: TeamTrackerPerson[];
}

/** Best-effort NAME -> Google avatar lookup for the picker. Guide/Mentor
 * names come from advisor records' free-text `guide`/`mentor` fields
 * (qaDataEngine.ts), which carry no email or other stable id — the only
 * way to attach a photo is a case/whitespace-insensitive match against the
 * `users` directory's own `name` column, so a guide whose two spellings
 * disagree simply falls back to an initials avatar rather than a wrong
 * photo (never guessed/fuzzy-matched beyond trim+lowercase). */
async function buildPictureLookup(): Promise<Map<string, string | null>> {
  try {
    const { users } = createRepositories(getDb());
    const all = await users.list();
    const map = new Map<string, string | null>();
    for (const u of all) {
      const key = u.name.trim().toLowerCase();
      if (key) map.set(key, u.picture ?? null);
    }
    return map;
  } catch (err) {
    // Best-effort, deliberately swallowed: avatars are a pure UX nicety on
    // top of the picker (falls back to initials), so a DB hiccup here — most
    // likely `users.picture` not existing yet because migration 0059 hasn't
    // been run against this environment (see project memory) — must never
    // take down the whole picker the way an uncaught error here would.
    console.error("Team Tracker avatar lookup failed (falling back to initials for everyone):", err);
    return new Map();
  }
}
function toPeople(names: string[], pictureByName: Map<string, string | null>): TeamTrackerPerson[] {
  return names.map((name) => ({ name, pictureUrl: pictureByName.get(name.trim().toLowerCase()) ?? null }));
}

async function resolvePool(
  email: string,
  requestedGuide: string | null,
  requestedMentor: string | null
): Promise<
  // kind/name identify WHO this pool is scoped to (a Guide/Mentor's own
  // name, or the Admin's selection) — reporting call sites re-resolve the
  // actual advisor membership per period from this kind+name via
  // resolvePoolAsOf below, since `pool` itself is only ever the CURRENT
  // membership (see this function's own access-control-stays-current
  // design decision, same as getAdvisorsForGuide/getAdvisorsForMentor in
  // qaDataEngine.ts).
  | { pool: Advisor[]; scopeLabel: string; needsSelection: false; kind: "guide" | "mentor"; name: string }
  // `pool` here is every advisor (Task: the Admin's own Advisors search box
  // on the picker page must be able to find someone directly, without
  // first picking a Guide or Mentor) — needsSelection stays true, so the
  // table/pivot itself still requires a Guide/Mentor pick; only the picker
  // page's Advisor search box reads this pool.
  | { pool: Advisor[]; scopeLabel: ""; needsSelection: true; guides: TeamTrackerPerson[]; mentors: TeamTrackerPerson[] }
  | ErrorResult
> {
  const role = await resolveQaCallerRole(email);

  if (role.isGuide) {
    const pool = await getAdvisorsForGuide(role.callerName);
    return { pool, scopeLabel: `${role.callerName}'s Team`, needsSelection: false, kind: "guide", name: role.callerName };
  }
  if (role.isMentor) {
    const pool = await getAdvisorsForMentor(role.callerName);
    return { pool, scopeLabel: `${role.callerName}'s Mentees`, needsSelection: false, kind: "mentor", name: role.callerName };
  }
  if (role.isAdmin) {
    const guideSel = (requestedGuide || "").trim();
    const mentorSel = (requestedMentor || "").trim();
    if (guideSel) {
      const pool = await getAdvisorsForGuide(guideSel);
      return { pool, scopeLabel: `${guideSel}'s Team`, needsSelection: false, kind: "guide", name: guideSel };
    }
    if (mentorSel) {
      const pool = await getAdvisorsForMentor(mentorSel);
      return { pool, scopeLabel: `${mentorSel}'s Mentees`, needsSelection: false, kind: "mentor", name: mentorSel };
    }
    const all = await getAllAdvisors();
    const guideNames = Array.from(new Set(all.map((a) => (a.guide || "").trim()).filter(Boolean))).sort();
    const mentorNames = Array.from(new Set(all.map((a) => (a.mentor || "").trim()).filter(Boolean))).sort();
    const pictureByName = await buildPictureLookup();
    return { pool: all, scopeLabel: "", needsSelection: true, guides: toPeople(guideNames, pictureByName), mentors: toPeople(mentorNames, pictureByName) };
  }
  return { error: "FORBIDDEN", message: "Team Tracker is only available to Admins, Guides, and Mentors." };
}

/** Re-resolves a resolvePool() target's ADVISOR MEMBERSHIP as of a
 * specific period's own start date, instead of today — the period-based
 * counterpart reporting call sites (the monthly table, period summary,
 * current-month comparison) use instead of trusting resolvePool's own
 * (current-only) `pool`. See qaDataEngine.ts's "Advisor Relationship
 * Mapping" section comment for why this is resolved per period rather
 * than once per request. */
async function resolvePoolAsOf(kind: "guide" | "mentor", name: string, asOfDate: string): Promise<Advisor[]> {
  return kind === "guide" ? getAdvisorsForGuideAsOf(name, asOfDate) : getAdvisorsForMentorAsOf(name, asOfDate);
}

/** Whether `email` (a Team Tracker Admin/Guide/Mentor) is allowed to see or
 * coach one specific advisor by tactId — the exact same scope this page's
 * own pivot table uses (Guide: only their own team via
 * getAdvisorsForGuide, Mentor: only their own mentees via
 * getAdvisorsForMentor, Admin: everyone via getAllAdvisors), reused as-is
 * by src/server/coaching/coachingService.ts rather than duplicated. A
 * plain Advisor is never allowed here, even for their own tactId — Team
 * Tracker (and therefore its Coaching Workspace) is manager-of-others
 * only, see this file's header comment. */
export async function canAccessAdvisorForCoaching(email: string, tactId: string): Promise<{ allowed: boolean; callerName: string; callerIsAdmin: boolean }> {
  const role = await resolveQaCallerRole(email);
  const target = String(tactId).trim().toLowerCase();
  if (role.isAdmin) {
    const all = await getAllAdvisors();
    return { allowed: all.some((a) => String(a.tactId).trim().toLowerCase() === target), callerName: role.callerName, callerIsAdmin: true };
  }
  if (role.isGuide) {
    const team = await getAdvisorsForGuide(role.callerName);
    return { allowed: team.some((a) => String(a.tactId).trim().toLowerCase() === target), callerName: role.callerName, callerIsAdmin: false };
  }
  if (role.isMentor) {
    const mentees = await getAdvisorsForMentor(role.callerName);
    return { allowed: mentees.some((a) => String(a.tactId).trim().toLowerCase() === target), callerName: role.callerName, callerIsAdmin: false };
  }
  return { allowed: false, callerName: role.callerName, callerIsAdmin: false };
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
        advisors: resolved.pool,
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
    // TS's control-flow narrowing on `resolved.needsSelection` doesn't hold
    // here (confirmed: even the very next line still sees the full union) —
    // so instead of relying on narrowing, this explicitly extracts the
    // needsSelection:false member of the union by type, then casts. Safe
    // because we've just returned in the needsSelection:true branch above,
    // so at runtime `resolved` can only be that member (or ErrorResult,
    // already returned earlier by the isError check).
    const scopedPool = resolved as Extract<typeof resolved, { needsSelection: false }>;
    const { kind: poolKind, name: poolName } = scopedPool;

    const tactFilter = (requestedTactId || "").trim();
    const months = enumerateMonths(fromYm, toYm);
    if (months.length === 0) {
      return { scopeLabel: resolved.scopeLabel, isAdmin: role.isAdmin, isGuide: role.isGuide, isMentor: role.isMentor, months, rows: [] };
    }

    // Period-based (2026-09 "Rewire Advisor Mapping"): who counts as this
    // Guide/Mentor's advisor is resolved SEPARATELY for each month, as of
    // that month's own start date — not once for the whole [fromYm, toYm]
    // range — so a Mentor/Guide change partway through the range moves an
    // advisor's row to their new Mentor/Guide starting the month it
    // actually took effect, while earlier months stay with the old one.
    // See qaDataEngine.ts's "Advisor Relationship Mapping" section comment.
    //
    // Months run one at a time, not via Promise.all: a 12-month range used to
    // fan out ~12 concurrent getAdvisorsBatchMetrics calls, each building its
    // own merged copy of the whole feedback dump, which pushed the Cloud Run
    // instance past its 512 MiB limit (container killed -> bare "HTTP 503").
    // The underlying sheet/archive reads are cached, so after the first month
    // the rest are cheap and sequential costs almost no extra time.
    const perMonthPools: Awaited<ReturnType<typeof resolvePoolAsOf>>[] = [];
    for (const m of months) {
      let pool = await resolvePoolAsOf(poolKind, poolName, m.filters.checkedFrom);
      if (tactFilter) pool = pool.filter((a) => String(a.tactId).trim() === tactFilter);
      perMonthPools.push(pool);
    }

    // One batch-metrics call per month (same function, same math the QA
    // Dashboard's own roster view uses for a single range), sequential for
    // the memory reason above.
    const perMonthMetrics: Awaited<ReturnType<typeof getAdvisorsBatchMetrics>>[] = [];
    for (let mi = 0; mi < months.length; mi++) {
      const tactIds = perMonthPools[mi].map((a) => String(a.tactId).trim());
      const parsed = parseDateFilters(months[mi].filters);
      perMonthMetrics.push(await getAdvisorsBatchMetrics(tactIds, parsed.checkedFrom, parsed.checkedTo, parsed.tillDate, months[mi].filters));
    }

    const rows: MonthlyAdvisorRow[] = [];
    months.forEach((m, mi) => {
      const metricsByTact = perMonthMetrics[mi];
      for (const a of perMonthPools[mi]) {
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

// ==================== PERIOD SUMMARY (ACTUAL DATE-RANGE CALC) ====================
// /table above answers with one getAdvisorsBatchMetrics call PER MONTH, so
// any "whole period" figure built from those rows is really an average of
// several already-rounded monthly averages — fine for the monthly table
// itself, but not the same number a single query over the period's actual
// Start/End/Till Date would produce (a month with 3 evaluations counts the
// same as a month with 300 in a mean-of-monthly-means). This is that single
// query instead: ONE getAdvisorsBatchMetrics call across the whole
// [fromYm, toYm] range (periodDateFilters above), giving every advisor's
// real period-wide BatchMetric straight from the underlying scores. Used
// for the "QA Performance" tiles shown in a period view, and any per-
// advisor ranking/stat that should reflect the period the same way.
export interface TeamTrackerPeriodSummaryResult {
  scopeLabel: string;
  filters: DateFilters;
  /** Keyed by tactId, one entry per advisor in the resolved pool — same
   * BatchMetric shape /table's per-month rows are built from, just scoped
   * to the whole period in one query instead of per month. */
  metrics: Record<string, BatchMetric>;
}

export async function getTeamTrackerPeriodSummary(
  email: string,
  requestedGuide: string | null,
  requestedMentor: string | null,
  fromYm: string,
  toYm: string
): Promise<TeamTrackerPeriodSummaryResult | ErrorResult> {
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

    const scopedPool = resolved as Extract<typeof resolved, { needsSelection: false }>; // see getTeamTrackerTable's comment on why this cast is needed
    const { kind: poolKind, name: poolName } = scopedPool;

    const filters = periodDateFilters(fromYm, toYm);
    // Period-based, same reasoning as getTeamTrackerTable above — resolved
    // as of the whole period's own start date (fromYm's 1st) rather than
    // resolved.pool's CURRENT membership.
    const pool = await resolvePoolAsOf(poolKind, poolName, filters.checkedFrom);
    if (pool.length === 0) {
      return { scopeLabel: resolved.scopeLabel, filters, metrics: {} };
    }

    const tactIds = pool.map((a) => String(a.tactId).trim());
    const parsed = parseDateFilters(filters);
    const metrics = await getAdvisorsBatchMetrics(tactIds, parsed.checkedFrom, parsed.checkedTo, parsed.tillDate, filters);

    return { scopeLabel: resolved.scopeLabel, filters, metrics };
  } catch (err: any) {
    return { error: "SERVER_ERROR", message: err.message };
  }
}

// ==================== CURRENT MONTH PERIOD CHANGE ====================
// Team Tracker Home Page's "Current Month Analysis" section needs its own
// Period Change figure, distinct from Selected Period's changeFirstLatest
// (first-vs-latest scored month in the whole range). Per the approved
// spec: "On 10 September, the current score is 4.2. The average score
// across previous months, as of the 10th day of those months, is 4.0. The
// card should therefore show an improvement of +0.2." That is: today's
// month-to-date score for the current month, minus the average of every
// PRIOR month's own score computed through that same day-of-month — a
// fair day-N-to-day-N comparison rather than a partial month vs. full
// months. Returns delta: null (rendered as "— (not enough data)" per the
// user's confirmed fallback) when there's no current-month score yet, or
// no prior month within the selected period has any data through day N.
export interface CurrentMonthPeriodChangeResult {
  delta: number | null;
  dayOfMonth: number;
  /** How many prior months actually had data through day N and
   * contributed to the average — not required by the UI, but cheap to
   * return and useful if the "not enough data" state ever needs a more
   * specific message. */
  comparedMonths: number;
}

function teamScoreFromMetrics(metricsByTact: Record<string, { leadScoreAvg: number | null; paymentsAvg: number | null }>, tactIds: string[]): number | null {
  const scores = tactIds.map((t) => avgOf(metricsByTact[t]?.leadScoreAvg ?? null, metricsByTact[t]?.paymentsAvg ?? null)).filter((v): v is number => v !== null);
  if (!scores.length) return null;
  return scores.reduce((s, v) => s + v, 0) / scores.length;
}

export async function getCurrentMonthPeriodChange(
  email: string,
  requestedGuide: string | null,
  requestedMentor: string | null,
  fromYm: string,
  toYm: string,
  currentMonthKey: string
): Promise<CurrentMonthPeriodChangeResult | ErrorResult> {
  const dayOfMonth = new Date().getDate();
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
    const scopedPool = resolved as Extract<typeof resolved, { needsSelection: false }>; // see getTeamTrackerTable's comment on why this cast is needed
    const { kind: poolKind, name: poolName } = scopedPool;
    if (!/^\d{4}-\d{2}$/.test(currentMonthKey)) {
      return { delta: null, dayOfMonth, comparedMonths: 0 };
    }

    const priorMonths = enumerateMonths(fromYm, toYm).filter((m) => m.key < currentMonthKey);
    if (priorMonths.length === 0) {
      return { delta: null, dayOfMonth, comparedMonths: 0 };
    }

    const [cy, cmRaw] = currentMonthKey.split("-").map(Number);
    const currentFilters = partialMonthDateFilters(cy, cmRaw - 1, dayOfMonth);
    const currentParsed = parseDateFilters(currentFilters);
    const priorMonthFilters = priorMonths.map((m) => {
      const [py, pmRaw] = m.key.split("-").map(Number);
      return partialMonthDateFilters(py, pmRaw - 1, dayOfMonth);
    });

    // Period-based (2026-09 "Rewire Advisor Mapping"): each month compared
    // here — the current month AND every prior month — resolves this
    // Guide/Mentor's advisor membership as of THAT month's own start date,
    // not resolved.pool's CURRENT membership, same reasoning as
    // getTeamTrackerTable/getTeamTrackerPeriodSummary above.
    const [currentPool, ...priorPools] = await Promise.all([
      resolvePoolAsOf(poolKind, poolName, currentFilters.checkedFrom),
      ...priorMonthFilters.map((f) => resolvePoolAsOf(poolKind, poolName, f.checkedFrom)),
    ]);
    if (currentPool.length === 0 && priorPools.every((p) => p.length === 0)) {
      return { delta: null, dayOfMonth, comparedMonths: 0 };
    }

    // Sequential (not Promise.all) to bound peak memory — see getTeamTrackerTable.
    const currentMetrics = await getAdvisorsBatchMetrics(
      currentPool.map((a) => String(a.tactId).trim()),
      currentParsed.checkedFrom,
      currentParsed.checkedTo,
      currentParsed.tillDate,
      currentFilters
    );
    const priorMetrics: Awaited<ReturnType<typeof getAdvisorsBatchMetrics>>[] = [];
    for (let i = 0; i < priorMonthFilters.length; i++) {
      const f = priorMonthFilters[i];
      const parsed = parseDateFilters(f);
      priorMetrics.push(await getAdvisorsBatchMetrics(priorPools[i].map((a) => String(a.tactId).trim()), parsed.checkedFrom, parsed.checkedTo, parsed.tillDate, f));
    }

    const currentScore = teamScoreFromMetrics(currentMetrics, currentPool.map((a) => String(a.tactId).trim()));
    const priorScores = priorMetrics
      .map((m, i) => teamScoreFromMetrics(m, priorPools[i].map((a) => String(a.tactId).trim())))
      .filter((v): v is number => v !== null);

    if (currentScore === null || priorScores.length === 0) {
      return { delta: null, dayOfMonth, comparedMonths: priorScores.length };
    }

    const avgPrior = priorScores.reduce((s, v) => s + v, 0) / priorScores.length;
    const delta = Math.round((currentScore - avgPrior) * 100) / 100;
    return { delta, dayOfMonth, comparedMonths: priorScores.length };
  } catch (err: any) {
    return { error: "SERVER_ERROR", message: err.message };
  }
}
