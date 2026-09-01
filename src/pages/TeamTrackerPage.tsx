/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowLeft,
  RefreshCw,
  Users2,
  TrendingUp,
  TrendingDown,
  Minus,
  Trophy,
  AlertTriangle,
  ChevronRight,
  ChevronDown,
  Check,
  Calendar,
  CircleOff,
  MessageCircle,
  Phone,
  Wallet,
  Target,
} from "lucide-react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { CustomSelect, type CustomSelectOption } from "../components/CustomSelect";

/**
 * TEAM QA PERFORMANCE TRACKER ("Team Tracker")
 * ---------------------------------------------------------------
 * A manager-facing companion to the QA Dashboard — same underlying QA data
 * and scoring (src/server/qaDashboard/teamTrackerService.ts calls the exact
 * same getAdvisorsBatchMetrics function the QA Dashboard's own roster view
 * uses, just once per calendar month instead of once per date range). This
 * page adds NO new QA calculation of its own beyond two already-established
 * composites: "Cumulative Score" (average of Lead Score + Payment QA
 * Score, same definition as the Home page's "Consolidated Score" widget)
 * and "Blunder %" (evaluations scored 1 or 2, out of that medium's total
 * evaluations — see qaDataEngine.ts's BLUNDER_MAX_SCORE, the one place
 * that count is actually computed from raw scores).
 *
 * The server still answers with one row per (advisor, month) — see
 * MonthlyAdvisorRow below, unchanged from the server's own shape. Every
 * pivot/insight computed in this file (one-row-per-advisor table, team and
 * per-advisor Top 5/Bottom 5/Best-Weakest Medium/blunder rates, "Current
 * Month" snapshots, etc.) is a pure client-side reshape of those same
 * numbers; nothing here recomputes a QA score.
 *
 * Visible only to Admin/Guide/Mentor (App.tsx gates the sidebar link on the
 * same /team-tracker/context probe this page itself uses) — a plain
 * Advisor has no team to track, so unlike the QA Dashboard there is no
 * "see your own record" fallback here.
 *
 * Only Period remains as a page-level control (Advisor/Medium filters were
 * deliberately removed — see the header row below); picking a Period
 * auto-reloads the table. A small "Change Team" link next to the title lets
 * an Admin step back to the Guide/Mentor picker.
 *
 * Advisor analysis opens as its own full-width view (openAdvisorTactId
 * below) rather than expanding inline under the table row, with a slide/
 * fade transition (AnimatePresence) between the two — this page draws its
 * own local "Back" button in that view rather than relying on any shared
 * app-wide control, since there is no global header anymore (App.tsx).
 */

// ── Types (mirror teamTrackerService.ts's response shapes) ────────────────
interface Advisor {
  tactId: string;
  name: string;
  guide: string | null;
  mentor: string | null;
}
interface TeamTrackerContext {
  isAdmin: boolean;
  isGuide: boolean;
  isMentor: boolean;
  callerName: string;
  scopeLabel: string;
  advisors: Advisor[];
  needsSelection: boolean;
  guides: string[];
  mentors: string[];
}
interface MonthSpec {
  key: string;
  label: string;
}
interface MonthlyAdvisorRow {
  tactId: string;
  name: string;
  monthKey: string;
  monthLabel: string;
  leadScoreAvg: number | null;
  leadScoreInstances: number;
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
  cumulativeScore: number | null;
}
interface TeamTrackerTableResult {
  scopeLabel: string;
  isAdmin: boolean;
  isGuide: boolean;
  isMentor: boolean;
  months: MonthSpec[];
  rows: MonthlyAdvisorRow[];
}

type Period = "3m" | "6m" | "1y" | "custom";
type MediumKey = "lead" | "payment" | "chat" | "call";
type RankMode = "current" | "period";

const SCORE_DANGER = 3.5;
const SCORE_WARN = 3.75;
// Illustrative thresholds for the blunder-% (evaluations scored 1 or 2)
// stat cards — flags a medium worth a closer look without claiming a
// precise, QA-team-defined cutoff.
const BLUNDER_WARN_PCT = 10;
const BLUNDER_DANGER_PCT = 20;

const MEDIUM_LABELS: Record<MediumKey, string> = { lead: "Lead Score", payment: "Payment QA", chat: "Chat QA", call: "Call QA" };
const MEDIUM_SHORT_LABELS: Record<MediumKey, string> = { lead: "Lead", payment: "Payment", chat: "Chat", call: "Call" };
const MEDIUM_ICONS: Record<MediumKey, ReactNode> = {
  lead: <Target className="w-3.5 h-3.5" />,
  payment: <Wallet className="w-3.5 h-3.5" />,
  chat: <MessageCircle className="w-3.5 h-3.5" />,
  call: <Phone className="w-3.5 h-3.5" />,
};
// Lead Score is a derived composite (the per-chat-id minimum of that chat's
// own Chat/Call scores — see teamTrackerService.ts), not an independent QA
// channel the way Chat/Call/Payment are: every Lead Score evaluation is
// already counted once under Chat or Call. It still gets its own stat card
// (the redesign explicitly asked for Lead alongside Chat/Call/Payment), but
// it's excluded from "Best/Weakest Medium" comparisons and from activity/
// "Total QA Instances" totals — both are about the three actual evaluation
// channels, and including Lead would double-count.
const REAL_MEDIUM_KEYS: MediumKey[] = ["payment", "chat", "call"];

// ── Trend chart metric selector (Task 3 item 3) — lets the shared trend
// chart switch between Cumulative Score and any one medium, on both Team
// Tracker's main page and the Advisor QA Dashboard. One point per month
// carries all five metrics (MetricPoint), so switching is a pure
// client-side pick with no refetch. ──────────────────────────────────────
type MetricKey = "cumulative" | MediumKey;
interface MetricPoint {
  score: number | null;
  instances: number;
}
const METRIC_OPTIONS: { value: MetricKey; label: string }[] = [
  { value: "cumulative", label: "Cumulative" },
  { value: "lead", label: "Lead" },
  { value: "payment", label: "Payment" },
  { value: "chat", label: "Chat" },
  { value: "call", label: "Call" },
];
const METRIC_LABELS: Record<MetricKey, string> = { cumulative: "Cumulative Score", lead: "Lead Score", payment: "Payment QA", chat: "Chat QA", call: "Call QA" };

// Same danger/warn thresholds and treatment QaDashboardPage.tsx's
// scoreFlagClasses uses, reproduced locally (this file intentionally
// doesn't import from QaDashboardPage.tsx — see teamTrackerService.ts's
// header comment on staying a separate, additive surface). Absolute
// quality (this) is a deliberately separate signal from month-over-month
// trend (see TrendArrow below) — a cell can be a "good" 4.2 that just
// dropped from 4.6, or a "poor" 3.1 that just climbed from 2.8.
// Text-color only (no border accent) — used for both compact table cells
// and standalone stat-card numbers.
function scoreFlagClasses(value: number | null | undefined, dark: boolean): string {
  if (value === null || value === undefined) return "";
  if (value < SCORE_DANGER) return dark ? "text-red-300 font-bold" : "text-red-700 font-bold";
  if (value < SCORE_WARN) return dark ? "text-amber-300 font-bold" : "text-amber-700 font-bold";
  return "";
}
// Same thresholds, for a standalone big number (stat cards) — just a text
// color, no border accent.
function scoreTextClass(value: number | null | undefined, dark: boolean): string {
  const base = dark ? "text-white" : "text-stone-900";
  if (value === null || value === undefined) return base;
  if (value < SCORE_DANGER) return "text-red-500";
  if (value < SCORE_WARN) return "text-amber-500";
  return base;
}
function blunderTextClass(pct: number | null, dark: boolean): string {
  if (pct === null) return dark ? "text-slate-500" : "text-stone-400";
  if (pct >= BLUNDER_DANGER_PCT) return "text-red-500";
  if (pct >= BLUNDER_WARN_PCT) return "text-amber-500";
  return dark ? "text-slate-200" : "text-stone-700";
}
/** Green for a positive delta, red for negative, muted for zero/unknown —
 * the one consistent color convention every trend indicator on this page
 * uses (cards, table cells, chart). */
function deltaTextClass(delta: number | null, dark: boolean): string {
  if (delta === null) return dark ? "text-slate-400" : "text-stone-500";
  if (delta > 0) return "text-emerald-500";
  if (delta < 0) return "text-red-500";
  return dark ? "text-slate-400" : "text-stone-500";
}
function DeltaIcon({ delta }: { delta: number | null }) {
  if (delta === null) return null;
  if (delta > 0) return <TrendingUp className="w-3.5 h-3.5 shrink-0" />;
  if (delta < 0) return <TrendingDown className="w-3.5 h-3.5 shrink-0" />;
  return <Minus className="w-3.5 h-3.5 shrink-0" />;
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.message || body?.error || `HTTP ${res.status}`);
  return body as T;
}

function qs(params: Record<string, string | null | undefined>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== null && v !== undefined && v !== "") p.set(k, v);
  }
  return p.toString();
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}
function ymOf(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}
/** "3m"/"6m"/"1y" -> {fromMonth, toMonth} ending at the current month, both
 * "yyyy-MM". Custom period supplies its own pair directly instead of going
 * through this. */
function periodToRange(period: Exclude<Period, "custom">): { fromMonth: string; toMonth: string } {
  const now = new Date();
  const back = period === "3m" ? 2 : period === "6m" ? 5 : 11; // inclusive of current month
  const from = new Date(now.getFullYear(), now.getMonth() - back, 1);
  return { fromMonth: ymOf(from), toMonth: ymOf(now) };
}

/** Strips teamTrackerService.ts's trailing "'s Team"/"'s Mentees" off a
 * scopeLabel ("Priya's Team" -> "Priya") — used to show the team owner's
 * bare name in the page title for an Admin (see this file's header
 * comment; a Guide/Mentor viewing their own team already knows whose it
 * is, so their title stays plain "Team Tracker"). */
function ownerNameFromScope(scopeLabel: string): string {
  return scopeLabel.replace(/'s (Team|Mentees)$/, "");
}

function avgArr(vals: (number | null)[]): number | null {
  const nums = vals.filter((v): v is number => v !== null);
  if (nums.length === 0) return null;
  return Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 100) / 100;
}
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

const inputClass = (dark: boolean) =>
  `px-2.5 py-1.5 rounded-lg border text-[13px] font-semibold outline-none ${
    dark ? "bg-[#102236] border-[#1e3e5c] text-[#eff6ff]" : "bg-white border-stone-250 text-stone-850"
  }`;

/** Opens the native calendar/month picker on ANY click within the field,
 * not just the small calendar-icon glyph browsers otherwise require you to
 * hit precisely (clicking the text portion of a native month input only
 * focuses it). Falls back to plain focus on browsers without showPicker(). */
function openNativePicker(e: MouseEvent<HTMLInputElement>) {
  const el = e.currentTarget as HTMLInputElement & { showPicker?: () => void };
  try {
    el.showPicker?.();
  } catch {
    el.focus();
  }
}

// ── Trend arrow — month-over-month direction, deliberately independent of
// scoreFlagClasses' absolute-quality coloring (see that function's comment
// above). null when either side is missing (nothing to compare, not "flat"). ─
function TrendArrow({ curr, prev }: { curr: number | null; prev: number | null }) {
  if (curr === null || prev === null) return null;
  const delta = round2(curr - prev);
  if (delta > 0) return <TrendingUp className="w-3 h-3 text-emerald-500 shrink-0" />;
  if (delta < 0) return <TrendingDown className="w-3 h-3 text-red-500 shrink-0" />;
  return <Minus className="w-3 h-3 text-content-muted shrink-0" />;
}

interface MediumStat {
  avg: number | null;
  instances: number;
  blunders: number;
  blunderPct: number | null;
}
function buildMediumStat(avgs: (number | null)[], instancesArr: number[], blundersArr: number[]): MediumStat {
  // `|| 0` guards against a stale server response missing the newer
  // blunder-count fields (undefined) — without it, one undefined/NaN entry
  // poisons the whole reduce() sum and blunderPct renders as "NaN%" instead
  // of falling back to a sane 0.
  const instances = instancesArr.reduce((a, b) => a + (b || 0), 0);
  const blunders = blundersArr.reduce((a, b) => a + (b || 0), 0);
  return {
    avg: avgArr(avgs),
    instances,
    blunders,
    blunderPct: instances > 0 ? round2((blunders / instances) * 100) : null,
  };
}

/** Empty placeholder for a medium with no data yet — the "Current Month"
 * KPI row falls back to this when insights.currentMonth is null. */
const EMPTY_MEDIUM_STAT: MediumStat = { avg: null, instances: 0, blunders: 0, blunderPct: null };

/** One ranked advisor for a Top 5 / Bottom 5 list — the number displayed
 * IS the value it was ranked by, so the same component works for either
 * the Current Month or Selected Period ranking mode (see the toggle in
 * TeamInsights). */
interface RankedEntry {
  tactId: string;
  name: string;
  value: number;
}
function rankEntries(pivots: AdvisorPivot[], valueOf: (p: AdvisorPivot) => number | null): { top5: RankedEntry[]; bottom5: RankedEntry[] } {
  const withVal = pivots
    .map((p) => ({ tactId: p.tactId, name: p.name, value: valueOf(p) }))
    .filter((e): e is RankedEntry => e.value !== null);
  const ranked = [...withVal].sort((a, b) => b.value - a.value);
  const top5 = ranked.slice(0, 5);
  const bottom5 = ranked.length > 5 ? [...ranked].slice(-5).reverse() : [...ranked].reverse();
  return { top5, bottom5 };
}

// ── Advisor Insights — QA Feedback / Disputes & Escalations / Coaching
// History (Task 2). Feedback and Reviews reuse the QA Dashboard's own
// existing endpoints/data (getAdvisorFeedback/getAdvisorReviews via
// qaDashboardService.ts) rather than a parallel data source — see this
// section's fetch helpers below. Headers are whatever the source sheet/
// query returns, so rows are read by header name rather than a fixed
// shape. ────────────────────────────────────────────────────────────────
interface SheetTableLike {
  headers: string[];
  rows: Record<string, unknown>[];
  error?: string;
  message?: string;
}
function fmtCell(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  return String(v);
}
function scoreChipClass(score: unknown, dark: boolean): string {
  const n = typeof score === "number" ? score : Number(score);
  if (!Number.isFinite(n)) return dark ? "bg-white/10 text-slate-300" : "bg-stone-100 text-stone-600";
  if (n <= 2) return dark ? "bg-red-500/20 text-red-300" : "bg-red-50 text-red-700";
  if (n <= 3) return dark ? "bg-amber-500/20 text-amber-300" : "bg-amber-50 text-amber-700";
  return dark ? "bg-emerald-500/20 text-emerald-300" : "bg-emerald-50 text-emerald-700";
}
async function fetchQaFeedback(tactId: string): Promise<SheetTableLike> {
  return fetchJson<SheetTableLike>(`/api/qa-dashboard/feedback?${qs({ tactId })}`);
}
async function fetchQaReviews(tactId: string): Promise<SheetTableLike> {
  return fetchJson<SheetTableLike>(`/api/qa-dashboard/reviews?${qs({ tactId })}`);
}

// Session Feedback (formerly "Coaching Workspace") — draft persistence,
// history types, and save/fetch helpers — has moved to the Advisor QA
// Dashboard (QaDashboardPage.tsx), per requirement #15. Team Tracker no
// longer has any coaching/session-feedback code of its own.

// ── Pivoted, one-row-per-advisor shape + period-level insights ────────────
// Pure client-side reshape of the server's (advisor, month) rows — see this
// file's header comment. Every mapped advisor gets an entry here (the
// server already emits a row for every advisor in the mapped pool for
// every month, with nulls/zeros when there's no QA activity — see
// teamTrackerService.ts's `for (const a of pool)` loop — so nobody is
// silently dropped for lacking data).
interface AdvisorPivot {
  tactId: string;
  name: string;
  monthly: Record<string, MonthlyAdvisorRow>;
  /** Sum of Payment+Chat+Call instances across the whole period (Lead
   * excluded — see REAL_MEDIUM_KEYS' comment). Zero means genuinely no QA
   * activity at all in the selected period, distinct from "had activity
   * but scored low". */
  totalInstances: number;
  hasActivity: boolean;
  avgCumulative: number | null;
  highest: { monthLabel: string; score: number } | null;
  lowest: { monthLabel: string; score: number } | null;
  /** First and last MONTH WITH DATA in the period (not necessarily the
   * calendar-first/last month of the range if the edges are NA). */
  firstScore: number | null;
  lastScore: number | null;
  change: number | null;
  /** This advisor's own most recent month with a Cumulative Score, within
   * the selected period — the "actual QA data" latest month, per this
   * file's header comment, which may differ per advisor if some have gone
   * quiet more recently than others. null when nobody has scored them at
   * all in the period. Feeds the advisor detail page's own Current Month
   * KPI row (a team-wide "Current Month" instead uses one shared month —
   * see computeInsights). */
  latestScoredRow: MonthlyAdvisorRow | null;
  mediumStats: Record<MediumKey, MediumStat>;
  bestMedium: { key: MediumKey; label: string; avg: number } | null;
  weakestMedium: { key: MediumKey; label: string; avg: number } | null;
}

function buildPivots(rows: MonthlyAdvisorRow[]): AdvisorPivot[] {
  const byAdvisor = new Map<string, MonthlyAdvisorRow[]>();
  for (const r of rows) {
    if (!byAdvisor.has(r.tactId)) byAdvisor.set(r.tactId, []);
    byAdvisor.get(r.tactId)!.push(r);
  }

  const pivots: AdvisorPivot[] = [];
  for (const [tactId, advisorRows] of byAdvisor) {
    advisorRows.sort((a, b) => (a.monthKey < b.monthKey ? -1 : 1));
    const monthly: Record<string, MonthlyAdvisorRow> = {};
    for (const r of advisorRows) monthly[r.monthKey] = r;

    // Lead Score instances are excluded here — they're the same underlying
    // Chat/Call evaluations counted a second time (see REAL_MEDIUM_KEYS'
    // comment), so including them would inflate "had activity" for
    // advisors who only ever got Chat/Call evaluations.
    const totalInstances = advisorRows.reduce((sum, r) => sum + r.paymentsInstances + r.chatInstances + r.callInstances, 0);

    const withScore = advisorRows.filter((r) => r.cumulativeScore !== null);
    const avgCumulative = avgArr(advisorRows.map((r) => r.cumulativeScore));
    const highest = withScore.length
      ? withScore.reduce((a, b) => (b.cumulativeScore! > a.cumulativeScore! ? b : a))
      : null;
    const lowest = withScore.length
      ? withScore.reduce((a, b) => (b.cumulativeScore! < a.cumulativeScore! ? b : a))
      : null;
    const firstScore = withScore.length ? withScore[0].cumulativeScore : null;
    const lastScore = withScore.length ? withScore[withScore.length - 1].cumulativeScore : null;
    const change = firstScore !== null && lastScore !== null && withScore.length > 1 ? round2(lastScore - firstScore) : null;
    // advisorRows (and therefore withScore) is sorted ascending by
    // monthKey, so the last entry is this advisor's own most recent
    // scored month.
    const latestScoredRow = withScore.length ? withScore[withScore.length - 1] : null;

    const mediumStats: Record<MediumKey, MediumStat> = {
      lead: buildMediumStat(advisorRows.map((r) => r.leadScoreAvg), advisorRows.map((r) => r.leadScoreInstances), advisorRows.map((r) => r.leadScoreBlunders)),
      payment: buildMediumStat(advisorRows.map((r) => r.paymentsAvg), advisorRows.map((r) => r.paymentsInstances), advisorRows.map((r) => r.paymentsBlunders)),
      chat: buildMediumStat(advisorRows.map((r) => r.chatAvg), advisorRows.map((r) => r.chatInstances), advisorRows.map((r) => r.chatBlunders)),
      call: buildMediumStat(advisorRows.map((r) => r.callAvg), advisorRows.map((r) => r.callInstances), advisorRows.map((r) => r.callBlunders)),
    };
    const scoredMediums = REAL_MEDIUM_KEYS.map((key) => ({ key, label: MEDIUM_LABELS[key], avg: mediumStats[key].avg })).filter(
      (m): m is { key: MediumKey; label: string; avg: number } => m.avg !== null
    );
    const bestMedium = scoredMediums.length ? scoredMediums.reduce((a, b) => (b.avg > a.avg ? b : a)) : null;
    const weakestMedium = scoredMediums.length ? scoredMediums.reduce((a, b) => (b.avg < a.avg ? b : a)) : null;

    pivots.push({
      tactId,
      name: advisorRows[0]?.name || tactId,
      monthly,
      totalInstances,
      hasActivity: totalInstances > 0,
      avgCumulative,
      highest: highest ? { monthLabel: highest.monthLabel, score: highest.cumulativeScore! } : null,
      lowest: lowest ? { monthLabel: lowest.monthLabel, score: lowest.cumulativeScore! } : null,
      firstScore,
      lastScore,
      change,
      latestScoredRow,
      mediumStats,
      bestMedium,
      weakestMedium,
    });
  }

  pivots.sort((a, b) => a.name.localeCompare(b.name));
  return pivots;
}

/** Team-wide avg + instance total + blunder% for one medium in one
 * specific month — the "Current Month" KPI row's per-medium cards (Task
 * 3 item 1 adds Blunder % here alongside the avg/instances this already
 * had, reusing MediumStat's shape rather than inventing a new one). */
function teamMediumSnapshot(
  pivots: AdvisorPivot[],
  monthKey: string,
  avgField: keyof MonthlyAdvisorRow,
  instField: keyof MonthlyAdvisorRow,
  blunderField: keyof MonthlyAdvisorRow
): MediumStat {
  const avgs = pivots.map((p) => (p.monthly[monthKey]?.[avgField] as number | null | undefined) ?? null);
  const instancesArr = pivots.map((p) => (p.monthly[monthKey]?.[instField] as number | undefined) ?? 0);
  const blundersArr = pivots.map((p) => (p.monthly[monthKey]?.[blunderField] as number | undefined) ?? 0);
  return buildMediumStat(avgs, instancesArr, blundersArr);
}

interface CurrentMonthSnapshot {
  monthKey: string;
  monthLabel: string;
  cumulative: number | null;
  cumulativeDelta: number | null;
  lead: MediumStat;
  payment: MediumStat;
  chat: MediumStat;
  call: MediumStat;
}

interface TeamInsightsData {
  teamAvg: number | null;
  /** Latest scored month vs the one right before it — a short-term
   * momentum read, distinct from changeFirstLatest's whole-period view.
   * Doubles as the Current Month KPI row's month-over-month delta. */
  momentum: { delta: number | null; latestLabel: string | null; prevLabel: string | null };
  /** The team's own single latest-scored-month snapshot — see this file's
   * header comment on "actual QA data" determining the month, not the
   * current calendar date. null only when nothing in the period has a
   * Cumulative Score yet. */
  currentMonth: CurrentMonthSnapshot | null;
  highest: AdvisorPivot | null;
  lowest: AdvisorPivot | null;
  top5Period: RankedEntry[];
  bottom5Period: RankedEntry[];
  /** Ranked by currentMonth's month specifically (same month for every
   * advisor), not each advisor's own individually-latest month — so the
   * ranking compares everyone on equal footing. Empty when currentMonth
   * is null. */
  top5CurrentMonth: RankedEntry[];
  bottom5CurrentMonth: RankedEntry[];
  mostImproved: AdvisorPivot | null;
  mostDeclined: AdvisorPivot | null;
  totalMapped: number;
  changeFirstLatest: { delta: number | null; firstLabel: string | null; latestLabel: string | null };
  /** Team-wide whole-period avg/instances/blunder% per medium — the
   * Historical Performance section's four tiles (Task 2 item 2). */
  historicalMediumStats: Record<MediumKey, MediumStat>;
  bestMedium: { key: MediumKey; label: string; avg: number } | null;
  weakestMedium: { key: MediumKey; label: string; avg: number } | null;
  /** Team-wide average score + instance count per month, chronological,
   * broken out per metric (Cumulative + each medium) — feeds the team
   * trend chart's metric selector (Task 3 item 3). Each month carries
   * all five metrics so switching the selector is a pure client-side
   * pick, no refetch. */
  chartData: { month: string; cumulative: MetricPoint; lead: MetricPoint; payment: MetricPoint; chat: MetricPoint; call: MetricPoint }[];
}

function computeInsights(pivots: AdvisorPivot[], months: MonthSpec[]): TeamInsightsData {
  const scored = pivots.filter((p) => p.avgCumulative !== null);
  const teamAvg = avgArr(scored.map((p) => p.avgCumulative));
  const { top5: top5Period, bottom5: bottom5Period } = rankEntries(pivots, (p) => p.avgCumulative);
  const ranked = [...scored].sort((a, b) => b.avgCumulative! - a.avgCumulative!);
  const highest = ranked.length ? ranked[0] : null;
  const lowest = ranked.length ? ranked[ranked.length - 1] : null;

  const changeable = pivots.filter((p) => p.change !== null);
  const mostImproved = changeable.length ? changeable.reduce((a, b) => (b.change! > a.change! ? b : a)) : null;
  const mostDeclined = changeable.length ? changeable.reduce((a, b) => (b.change! < a.change! ? b : a)) : null;

  const monthlyTeamAvg = months.map((m) => ({
    monthKey: m.key,
    monthLabel: m.label,
    avg: avgArr(pivots.map((p) => p.monthly[m.key]?.cumulativeScore ?? null)),
  }));
  const scoredMonths = monthlyTeamAvg.filter((m) => m.avg !== null);
  const momentum =
    scoredMonths.length >= 2
      ? {
          delta: round2(scoredMonths[scoredMonths.length - 1].avg! - scoredMonths[scoredMonths.length - 2].avg!),
          latestLabel: scoredMonths[scoredMonths.length - 1].monthLabel,
          prevLabel: scoredMonths[scoredMonths.length - 2].monthLabel,
        }
      : { delta: null, latestLabel: null, prevLabel: null };
  const changeFirstLatest =
    scoredMonths.length >= 2
      ? {
          delta: round2(scoredMonths[scoredMonths.length - 1].avg! - scoredMonths[0].avg!),
          firstLabel: scoredMonths[0].monthLabel,
          latestLabel: scoredMonths[scoredMonths.length - 1].monthLabel,
        }
      : { delta: null, firstLabel: null, latestLabel: null };

  // "The latest available month" (this file's Current Month sections) is
  // the most recent month, WITHIN THE LOADED PERIOD, that has a team
  // Cumulative Score — i.e. the last entry of scoredMonths above — rather
  // than assuming the current calendar month has data yet.
  const currentMonthKey = scoredMonths.length ? scoredMonths[scoredMonths.length - 1].monthKey : null;
  const currentMonth: CurrentMonthSnapshot | null = currentMonthKey
    ? {
        monthKey: currentMonthKey,
        monthLabel: scoredMonths[scoredMonths.length - 1].monthLabel,
        cumulative: scoredMonths[scoredMonths.length - 1].avg,
        cumulativeDelta: momentum.delta,
        lead: teamMediumSnapshot(pivots, currentMonthKey, "leadScoreAvg", "leadScoreInstances", "leadScoreBlunders"),
        payment: teamMediumSnapshot(pivots, currentMonthKey, "paymentsAvg", "paymentsInstances", "paymentsBlunders"),
        chat: teamMediumSnapshot(pivots, currentMonthKey, "chatAvg", "chatInstances", "chatBlunders"),
        call: teamMediumSnapshot(pivots, currentMonthKey, "callAvg", "callInstances", "callBlunders"),
      }
    : null;
  const { top5: top5CurrentMonth, bottom5: bottom5CurrentMonth } = currentMonthKey
    ? rankEntries(pivots, (p) => p.monthly[currentMonthKey]?.cumulativeScore ?? null)
    : { top5: [] as RankedEntry[], bottom5: [] as RankedEntry[] };

  const teamMediumAvgs = REAL_MEDIUM_KEYS.map((key) => ({ key, label: MEDIUM_SHORT_LABELS[key], avg: avgArr(pivots.map((p) => p.mediumStats[key].avg)) })).filter(
    (m): m is { key: MediumKey; label: string; avg: number } => m.avg !== null
  );
  const bestMedium = teamMediumAvgs.length ? teamMediumAvgs.reduce((a, b) => (b.avg > a.avg ? b : a)) : null;
  const weakestMedium = teamMediumAvgs.length ? teamMediumAvgs.reduce((a, b) => (b.avg < a.avg ? b : a)) : null;

  // One point per month, every metric attached (Task 3 item 3's metric
  // selector picks among these client-side — see MetricPoint's comment).
  // Cumulative's own "instances" reuses the same Payment+Chat+Call-only
  // total every other instance count in this file uses (Lead excluded —
  // see REAL_MEDIUM_KEYS' comment); each medium's own instances is just
  // that medium's count.
  const teamMonthlyMediumAvg = (key: MediumKey, avgField: keyof MonthlyAdvisorRow) => monthlyTeamAvg.map((m) => avgArr(pivots.map((p) => (p.monthly[m.monthKey]?.[avgField] as number | null | undefined) ?? null)));
  const teamMonthlyMediumInstances = (instField: keyof MonthlyAdvisorRow) => monthlyTeamAvg.map((m) => pivots.reduce((sum, p) => sum + ((p.monthly[m.monthKey]?.[instField] as number | undefined) ?? 0), 0));
  const leadAvgs = teamMonthlyMediumAvg("lead", "leadScoreAvg");
  const paymentAvgs = teamMonthlyMediumAvg("payment", "paymentsAvg");
  const chatAvgs = teamMonthlyMediumAvg("chat", "chatAvg");
  const callAvgs = teamMonthlyMediumAvg("call", "callAvg");
  const leadInst = teamMonthlyMediumInstances("leadScoreInstances");
  const paymentInst = teamMonthlyMediumInstances("paymentsInstances");
  const chatInst = teamMonthlyMediumInstances("chatInstances");
  const callInst = teamMonthlyMediumInstances("callInstances");
  const chartData = monthlyTeamAvg.map((m, i) => ({
    month: m.monthLabel,
    cumulative: { score: m.avg, instances: paymentInst[i] + chatInst[i] + callInst[i] },
    lead: { score: leadAvgs[i], instances: leadInst[i] },
    payment: { score: paymentAvgs[i], instances: paymentInst[i] },
    chat: { score: chatAvgs[i], instances: chatInst[i] },
    call: { score: callAvgs[i], instances: callInst[i] },
  }));

  // Team-wide whole-period stat per medium (avg + instances + blunder%) —
  // Task 2 item 2's four historical medium tiles, alongside the trend
  // chart rather than folded into the rankings area.
  const historicalMediumStats: Record<MediumKey, MediumStat> = {
    lead: buildMediumStat(pivots.map((p) => p.mediumStats.lead.avg), pivots.map((p) => p.mediumStats.lead.instances), pivots.map((p) => p.mediumStats.lead.blunders)),
    payment: buildMediumStat(pivots.map((p) => p.mediumStats.payment.avg), pivots.map((p) => p.mediumStats.payment.instances), pivots.map((p) => p.mediumStats.payment.blunders)),
    chat: buildMediumStat(pivots.map((p) => p.mediumStats.chat.avg), pivots.map((p) => p.mediumStats.chat.instances), pivots.map((p) => p.mediumStats.chat.blunders)),
    call: buildMediumStat(pivots.map((p) => p.mediumStats.call.avg), pivots.map((p) => p.mediumStats.call.instances), pivots.map((p) => p.mediumStats.call.blunders)),
  };

  return {
    teamAvg,
    momentum,
    currentMonth,
    highest,
    lowest,
    top5Period,
    bottom5Period,
    top5CurrentMonth,
    bottom5CurrentMonth,
    mostImproved: mostImproved && mostImproved.change! > 0 ? mostImproved : null,
    mostDeclined: mostDeclined && mostDeclined.change! < 0 ? mostDeclined : null,
    totalMapped: pivots.length,
    changeFirstLatest,
    historicalMediumStats,
    bestMedium,
    weakestMedium,
    chartData,
  };
}

interface TeamTrackerPageProps {
  theme: "light" | "dark";
}

export function TeamTrackerPage({ theme }: TeamTrackerPageProps) {
  const dark = theme === "dark";

  const [context, setContext] = useState<TeamTrackerContext | null>(null);
  const [contextError, setContextError] = useState("");
  const [contextLoading, setContextLoading] = useState(true);

  const [selectedGuide, setSelectedGuide] = useState("");
  const [selectedMentor, setSelectedMentor] = useState("");

  const [period, setPeriod] = useState<Period>("1y");
  const [customFrom, setCustomFrom] = useState(() => periodToRange("1y").fromMonth);
  const [customTo, setCustomTo] = useState(() => periodToRange("1y").toMonth);

  const [table, setTable] = useState<TeamTrackerTableResult | null>(null);
  const [tableLoading, setTableLoading] = useState(false);
  const [tableError, setTableError] = useState("");

  // Advisor analysis is its own full-width view, not an inline row expand —
  // see this file's header comment. null = showing the team table.
  const [openAdvisorTactId, setOpenAdvisorTactId] = useState<string | null>(null);
  const openAdvisor = useCallback((tactId: string) => setOpenAdvisorTactId(tactId), []);

  // Performance/Insights toggle (Task 2) — resets to Performance whenever a
  // different advisor is opened; switching between the two while the SAME
  // advisor stays open otherwise leaves everything else (advisor, team,
  // period) untouched, since this is independent page state.
  const [advisorViewMode, setAdvisorViewMode] = useState<"performance" | "insights">("performance");
  useEffect(() => {
    setAdvisorViewMode("performance");
  }, [openAdvisorTactId]);


  const loadContext = useCallback(async (guide: string, mentor: string) => {
    setContextLoading(true);
    setContextError("");
    try {
      const result = await fetchJson<TeamTrackerContext>(`/api/qa-dashboard/team-tracker/context?${qs({ guide, mentor })}`);
      setContext(result);
    } catch (err: any) {
      setContextError(err.message || "Failed to load Team Tracker.");
      setContext(null);
    } finally {
      setContextLoading(false);
    }
  }, []);

  useEffect(() => {
    loadContext("", "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadTable = useCallback(async () => {
    if (!context || context.needsSelection) return;
    setTableLoading(true);
    setTableError("");
    try {
      const { fromMonth, toMonth } = period === "custom" ? { fromMonth: customFrom, toMonth: customTo } : periodToRange(period);
      const result = await fetchJson<TeamTrackerTableResult>(
        `/api/qa-dashboard/team-tracker/table?${qs({
          guide: selectedGuide,
          mentor: selectedMentor,
          fromMonth,
          toMonth,
        })}`
      );
      setTable(result);
      setOpenAdvisorTactId(null);
    } catch (err: any) {
      setTableError(err.message || "Failed to load Team Tracker data.");
      setTable(null);
    } finally {
      setTableLoading(false);
    }
  }, [context, period, customFrom, customTo, selectedGuide, selectedMentor]);

  // Auto-load once a scope is resolved (Guide/Mentor immediately; Admin
  // right after picking).
  useEffect(() => {
    if (context && !context.needsSelection) {
      loadTable();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [context?.scopeLabel]);

  // Period is now the only page-level control (see this file's header
  // comment) — picking a new value (or editing a Custom range) auto-reloads
  // the table instead of requiring a separate "Load Dashboard" click. A
  // no-op via loadTable's own guard until context resolves, so this never
  // double-fires the context-triggered load above.
  useEffect(() => {
    loadTable();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period, customFrom, customTo]);

  const handlePickGuide = (guide: string) => {
    setSelectedGuide(guide);
    setSelectedMentor("");
    loadContext(guide, "");
  };
  const handlePickMentor = (mentor: string) => {
    setSelectedMentor(mentor);
    setSelectedGuide("");
    loadContext("", mentor);
  };

  const periodOptions: CustomSelectOption[] = [
    { value: "3m", label: "Last 3 Months" },
    { value: "6m", label: "Last 6 Months" },
    { value: "1y", label: "Last 1 Year" },
    { value: "custom", label: "Custom" },
  ];
  const guideOptions: CustomSelectOption[] = useMemo(() => (context?.guides || []).map((g) => ({ value: g, label: g })), [context]);
  const mentorOptions: CustomSelectOption[] = useMemo(() => (context?.mentors || []).map((m) => ({ value: m, label: m })), [context]);

  const pivots = useMemo(() => (table ? buildPivots(table.rows) : []), [table]);
  const insights = useMemo(() => computeInsights(pivots, table?.months || []), [pivots, table]);
  const openPivot = useMemo(() => (openAdvisorTactId ? pivots.find((p) => p.tactId === openAdvisorTactId) || null : null), [pivots, openAdvisorTactId]);
  const openPivotRows = useMemo(
    () => (openPivot && table ? table.months.map((m) => openPivot.monthly[m.key]).filter(Boolean) : []),
    [openPivot, table]
  );

  // Table columns/rows display newest-month-first (see this file's header
  // comment); chart data and every "vs previous month" comparison stay
  // chronological underneath, driven off this lookup rather than display
  // order — see prevMonthKeyOf's use in PivotAdvisorRow/AdvisorDetailView.
  const displayMonths = useMemo(() => [...(table?.months || [])].reverse(), [table]);
  const prevMonthKeyOf = useMemo(() => {
    const chron = table?.months || [];
    const map: Record<string, string | undefined> = {};
    chron.forEach((m, i) => {
      map[m.key] = i > 0 ? chron[i - 1].key : undefined;
    });
    return map;
  }, [table]);

  const cellClass = `px-3 py-2 border-b ${dark ? "border-white/[0.05]" : "border-stone-100"}`;
  const headClass = `sticky top-0 z-10 text-left py-2 px-3 font-bold whitespace-nowrap border-b ${
    dark ? "bg-[#0d1c3f] border-white/[0.16] text-slate-300" : "bg-[#f5f5f4] border-stone-200 text-stone-700"
  }`;

  // Opening/closing the advisor detail view swaps content in place (no
  // activeTab change), so App.tsx's own "scroll to top on tab switch"
  // effect never fires for it — without this, the advisor view could open
  // already scrolled to wherever the team table happened to be (e.g. the
  // bottom, if that's where its row was clicked from). Mirrors App.tsx's
  // own scroll-reset (window + the #main-scrollable-body container).
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior });
    document.getElementById("main-scrollable-body")?.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior });
  }, [openAdvisorTactId]);

  // ── Loading / unauthorized states ──────────────────────────────────────
  if (contextLoading) {
    return (
      <div className="space-y-4">
        <h1 className="text-page-title flex items-center gap-2">
          <Users2 className="w-5 h-5" />
          Team Tracker
        </h1>
        <p className="text-[13px] text-content-muted">Loading…</p>
      </div>
    );
  }
  if (contextError || !context) {
    return (
      <div className="space-y-4">
        <h1 className="text-page-title flex items-center gap-2">
          <Users2 className="w-5 h-5" />
          Team Tracker
        </h1>
        <div
          className={`flex items-start gap-2 p-3 rounded-lg border text-[13px] font-semibold ${
            dark ? "bg-red-500/10 border-red-500/30 text-red-300" : "bg-red-50 border-red-200 text-red-700"
          }`}
        >
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{contextError || "Team Tracker is only available to Admins, Guides, and Mentors."}</span>
        </div>
      </div>
    );
  }

  // ── Admin: must pick a Guide or Mentor before anything else renders ────
  if (context.needsSelection) {
    return (
      <div className="space-y-5 pb-6">
        <div>
          <h1 className={`text-page-title tracking-tight flex items-center gap-2 ${dark ? "text-white" : "text-[#111827]"}`}>
            <Users2 className="w-5 h-5" />
            <span>Team Tracker</span>
          </h1>
          <p className="text-[13px] mt-1 font-semibold text-content-muted">Admin view — choose a Guide or Mentor to see their team's QA performance.</p>
        </div>
        <div className={`flex flex-wrap items-end gap-3 rounded-2xl border p-4 ${dark ? "bg-white/[0.05] border-white/[0.10]" : "bg-surface-elevated border-[var(--border-strong)]"}`}>
          <label className="flex flex-col gap-1 flex-1 min-w-[200px]">
            <span className="text-[11px] font-bold uppercase tracking-wider text-content-muted">Guide</span>
            <CustomSelect
              theme={theme}
              value={selectedGuide}
              onChange={handlePickGuide}
              options={guideOptions}
              placeholder="Select a Guide…"
              triggerClassName={`w-full flex items-center justify-between gap-2 pl-2.5 pr-8 py-1.5 rounded-lg border outline-none text-[13px] font-semibold cursor-pointer relative ${
                dark ? "bg-[#102236] border-[#1e3e5c] text-[#eff6ff]" : "bg-white border-stone-250 text-stone-850"
              }`}
            />
          </label>
          <label className="flex flex-col gap-1 flex-1 min-w-[200px]">
            <span className="text-[11px] font-bold uppercase tracking-wider text-content-muted">Mentor</span>
            <CustomSelect
              theme={theme}
              value={selectedMentor}
              onChange={handlePickMentor}
              options={mentorOptions}
              placeholder="Select a Mentor…"
              triggerClassName={`w-full flex items-center justify-between gap-2 pl-2.5 pr-8 py-1.5 rounded-lg border outline-none text-[13px] font-semibold cursor-pointer relative ${
                dark ? "bg-[#102236] border-[#1e3e5c] text-[#eff6ff]" : "bg-white border-stone-250 text-stone-850"
              }`}
            />
          </label>
        </div>
      </div>
    );
  }

  const pageTitle = context.isAdmin ? `Team Tracker – ${ownerNameFromScope(context.scopeLabel)}` : "Team Tracker";

  // ── Main view / advisor detail — same tab, animated swap ───────────────
  return (
    <div className="space-y-5 pb-6">
      <AnimatePresence mode="wait" initial={false}>
        {openPivot ? (
          <motion.div
            key="advisor-detail"
            initial={{ opacity: 0, x: 28 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -28 }}
            transition={{ duration: 0.25, ease: "easeOut" }}
            className="space-y-5"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                {/* Local back button — closes the advisor detail view.
                    Previously routed through the app-wide header back
                    arrow (registerSubPageBack); now a plain page-owned
                    control since that shared header no longer exists. */}
                <button
                  onClick={() => setOpenAdvisorTactId(null)}
                  className={`mt-1 p-1.5 rounded-lg transition-colors shrink-0 cursor-pointer ${
                    dark ? "hover:bg-white/10 text-slate-300" : "hover:bg-stone-100 text-stone-600"
                  }`}
                  title="Back to team"
                  aria-label="Back to team"
                >
                  <ArrowLeft className="w-4 h-4" />
                </button>
                <div>
                  <h1 className={`text-page-title tracking-tight flex items-center gap-2 ${dark ? "text-white" : "text-[#111827]"}`}>
                    <Users2 className="w-5 h-5" />
                    <span>{openPivot.name}</span>
                  </h1>
                  <p className="text-[13px] mt-1 font-semibold text-content-muted">
                    Team Tracker · {context.scopeLabel} · {periodOptions.find((o) => o.value === period)?.label}
                  </p>
                </div>
              </div>
              <SegmentedToggle
                value={advisorViewMode}
                onChange={setAdvisorViewMode}
                options={[
                  { value: "performance", label: "Performance" },
                  { value: "insights", label: "Insights" },
                ]}
                dark={dark}
              />
            </div>
            {advisorViewMode === "performance" ? (
              <AdvisorDetailView dark={dark} theme={theme} pivot={openPivot} orderedRows={openPivotRows} prevMonthKeyOf={prevMonthKeyOf} />
            ) : (
              <AdvisorInsightsView dark={dark} pivot={openPivot} orderedRows={openPivotRows} prevMonthKeyOf={prevMonthKeyOf} />
            )}
          </motion.div>
        ) : (
          <motion.div
            key="team-view"
            initial={{ opacity: 0, x: -28 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 28 }}
            transition={{ duration: 0.25, ease: "easeOut" }}
            className="space-y-5"
          >
            {/* Title + the one remaining page-level control (Period) sit
                where the old "<scope> · Change" line used to be — see this
                file's header comment. CustomSelect already opens as a
                floating panel and closes itself the moment a value is
                picked, so it satisfies "a controller that collapses once
                the required change is made" without any extra state. */}
            <div>
              <h1 className={`text-page-title tracking-tight flex items-center gap-2 ${dark ? "text-white" : "text-[#111827]"}`}>
                <Users2 className="w-5 h-5" />
                <span>{pageTitle}</span>
                {/* Admin-only "change team" control — previously reached via
                    the app-wide header back button stepping to the Guide/
                    Mentor picker (see loadContext below); restored as a
                    small local control now that the shared header is gone. */}
                {context.isAdmin && (
                  <button
                    onClick={() => loadContext("", "")}
                    className={`ml-1 inline-flex items-center gap-1 text-[11px] font-bold uppercase tracking-wider px-2 py-1 rounded-lg cursor-pointer transition-colors ${
                      dark ? "text-slate-300 hover:bg-white/10" : "text-stone-500 hover:bg-stone-100"
                    }`}
                    title="Change Guide/Mentor team"
                  >
                    <ArrowLeft className="w-3 h-3" />
                    Change Team
                  </button>
                )}
              </h1>
              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                <PeriodControl
                  theme={theme}
                  period={period}
                  customFrom={customFrom}
                  customTo={customTo}
                  onChangePeriod={setPeriod}
                  onChangeCustomFrom={setCustomFrom}
                  onChangeCustomTo={setCustomTo}
                  options={periodOptions}
                />
                {tableLoading && (
                  <span className="flex items-center gap-1 text-[11px] font-bold uppercase tracking-wider text-content-muted">
                    <RefreshCw className="w-3 h-3 animate-spin" />
                    Loading…
                  </span>
                )}
              </div>
            </div>

            {tableError ? (
              <div className={`flex items-start gap-2 p-3 rounded-lg border text-[13px] font-semibold ${dark ? "bg-red-500/10 border-red-500/30 text-red-300" : "bg-red-50 border-red-200 text-red-700"}`}>
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{tableError}</span>
              </div>
            ) : (
              <>
                <TeamInsights dark={dark} theme={theme} insights={insights} onOpenAdvisor={openAdvisor} />
                <TeamPivotTable
                  dark={dark}
                  pivots={pivots}
                  months={displayMonths}
                  prevMonthKeyOf={prevMonthKeyOf}
                  loading={tableLoading}
                  onOpenAdvisor={openAdvisor}
                  cellClass={cellClass}
                  headClass={headClass}
                />
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Shared score trend line chart — used at both team and advisor level.
// Dual-axis: Cumulative Score (0–5, left, visually primary) plus a second
// "QA Instances" line/axis when the data includes it — see Task 1 item 6.
// A data point with `instances` omitted/undefined (never produced by this
// file today, but kept optional so the single-axis shape still typechecks
// anywhere this gets reused) simply draws no instances line. ────────────
function ScoreTrendChart({
  dark,
  theme,
  data,
  scoreLabel = "Cumulative Score",
}: {
  dark: boolean;
  theme: "light" | "dark";
  data: { month: string; score: number | null; instances?: number }[];
  /** Line/tooltip label for the score series — defaults to "Cumulative
   * Score" for every pre-existing call site; the metric-selector call
   * sites pass the currently-selected metric's own label instead. */
  scoreLabel?: string;
}) {
  const hasInstances = data.some((d) => typeof d.instances === "number");
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ top: 8, right: hasInstances ? 8 : 16, left: -12, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={theme === "dark" ? "#1F2937" : "#E5E7EB"} />
        <XAxis dataKey="month" stroke={theme === "dark" ? "#9CA3AF" : "#4B5563"} fontSize={11} tickLine={false} />
        <YAxis yAxisId="score" domain={[0, 5]} stroke={theme === "dark" ? "#9CA3AF" : "#4B5563"} fontSize={11} tickLine={false} />
        {hasInstances && (
          <YAxis yAxisId="instances" orientation="right" allowDecimals={false} stroke={theme === "dark" ? "#9CA3AF" : "#4B5563"} fontSize={11} tickLine={false} />
        )}
        <Tooltip
          content={({ active, payload, label }) => {
            if (active && payload && payload.length) {
              return (
                <div className={`p-2 rounded-lg border text-[11px] font-sans shadow-lg font-bold ${dark ? "bg-stone-900 border-stone-800 text-zinc-100" : "bg-white border-stone-200 text-stone-950"}`}>
                  <p className="opacity-75 mb-0.5">{label}</p>
                  {payload.map((p) => (
                    <p key={p.dataKey as string} className="font-black">
                      {p.dataKey === "score" ? `${scoreLabel}: ` : "Instances: "}
                      {p.value ?? "NA"}
                    </p>
                  ))}
                </div>
              );
            }
            return null;
          }}
        />
        {hasInstances && <Legend wrapperStyle={{ fontSize: 11, fontWeight: 700 }} />}
        <Line yAxisId="score" type="monotone" dataKey="score" name={scoreLabel} stroke="#117FDA" strokeWidth={2} dot={{ r: 3 }} connectNulls />
        {hasInstances && <Line yAxisId="instances" type="monotone" dataKey="instances" name="QA Instances" stroke="#9CA3AF" strokeWidth={1.5} strokeDasharray="4 3" dot={{ r: 2 }} />}
      </LineChart>
    </ResponsiveContainer>
  );
}

// ── Compact metric selector for the trend chart — a small pill row that
// reads as part of the chart card rather than another large filter
// section (Task 3 item 3). Reused by both Team Tracker's main page and
// the Advisor QA Dashboard. ──────────────────────────────────────────────
function MetricSelector({ value, onChange, dark }: { value: MetricKey; onChange: (v: MetricKey) => void; dark: boolean }) {
  return (
    <div className={`inline-flex flex-wrap rounded-lg border p-0.5 gap-0.5 ${dark ? "bg-white/[0.04] border-white/[0.10]" : "bg-stone-100 border-stone-200"}`}>
      {METRIC_OPTIONS.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={`px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider cursor-pointer transition-colors ${
            value === o.value ? "bg-[#117FDA] text-white" : dark ? "text-slate-300 hover:text-white" : "text-stone-500 hover:text-stone-800"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ── Current Month KPI row — the "actual QA data" latest-scored-month
// snapshot (Task 1 item 3), shared by the team main view and the advisor
// detail view. `monthLabel: null` means nothing in the loaded period has a
// Cumulative Score yet. ────────────────────────────────────────────────
function CurrentMonthKpiRow({
  dark,
  monthLabel,
  cumulative,
  cumulativeDelta,
  lead,
  payment,
  chat,
  call,
}: {
  dark: boolean;
  monthLabel: string | null;
  cumulative: number | null;
  cumulativeDelta: number | null;
  lead: MediumStat;
  payment: MediumStat;
  chat: MediumStat;
  call: MediumStat;
}) {
  const card = `rounded-xl border p-3 flex flex-col gap-1 ${dark ? "bg-white/[0.03] border-white/[0.08]" : "bg-white border-[var(--border)]"}`;
  const label = "text-[10px] font-bold uppercase tracking-wider text-content-muted";

  if (!monthLabel) {
    return (
      <div className={`rounded-xl border p-4 text-[13px] font-semibold text-content-muted ${dark ? "bg-white/[0.03] border-white/[0.08]" : "bg-white border-[var(--border)]"}`}>
        No scored months in the selected period yet.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className={`flex items-center gap-1.5 text-[11px] font-black uppercase tracking-wider ${dark ? "text-white" : "text-[#111827]"}`}>
        <span>Current Month</span>
        <span className={`font-semibold normal-case tracking-normal ${dark ? "text-slate-400" : "text-stone-500"}`}>· {monthLabel}</span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <div className={card}>
          <span className={label}>Cumulative Score</span>
          <span className={`text-2xl font-black ${scoreTextClass(cumulative, dark)}`}>{cumulative ?? "—"}</span>
          {cumulativeDelta !== null ? (
            <span className={`flex items-center gap-1 text-[11px] font-bold ${deltaTextClass(cumulativeDelta, dark)}`}>
              <DeltaIcon delta={cumulativeDelta} />
              {cumulativeDelta > 0 ? "+" : ""}
              {cumulativeDelta} MoM
            </span>
          ) : (
            <span className="text-[11px] text-content-muted">No prior month to compare</span>
          )}
          {/* Secondary supporting tagline — visually subordinate to the
              score itself, just clarifying what feeds it. */}
          <span className="text-[10px] font-semibold text-content-faint">Lead Score + Payment Score</span>
        </div>
        <MediumKpiCard dark={dark} label="Lead Score" icon={MEDIUM_ICONS.lead} stat={lead} />
        <MediumKpiCard dark={dark} label="Payment QA" icon={MEDIUM_ICONS.payment} stat={payment} />
        <MediumKpiCard dark={dark} label="Chat QA" icon={MEDIUM_ICONS.chat} stat={chat} />
        <MediumKpiCard dark={dark} label="Call QA" icon={MEDIUM_ICONS.call} stat={call} />
      </div>
    </div>
  );
}
function MediumKpiCard({ dark, label, icon, stat }: { dark: boolean; label: string; icon: ReactNode; stat: MediumStat }) {
  const card = `rounded-xl border p-3 flex flex-col gap-1 ${dark ? "bg-white/[0.03] border-white/[0.08]" : "bg-white border-[var(--border)]"}`;
  return (
    <div className={card}>
      <span className={`flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-content-muted`}>
        {icon}
        {label}
      </span>
      <span className={`text-2xl font-black ${scoreTextClass(stat.avg, dark)}`}>{stat.avg ?? "—"}</span>
      <div className="flex items-center gap-2 text-[11px] font-semibold">
        <span className="text-content-muted">
          {stat.instances} instance{stat.instances === 1 ? "" : "s"}
        </span>
        <span className={blunderTextClass(stat.blunderPct, dark)}>{stat.blunderPct === null ? "—" : `${stat.blunderPct}% blunder`}</span>
      </div>
    </div>
  );
}

function SegmentedToggle<T extends string>({ value, onChange, options, dark }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[]; dark: boolean }) {
  return (
    <div className={`inline-flex rounded-lg border p-0.5 ${dark ? "bg-white/[0.04] border-white/[0.10]" : "bg-stone-100 border-stone-200"}`}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={`px-2.5 py-1 rounded-md text-[11px] font-bold uppercase tracking-wider cursor-pointer transition-colors ${
            value === o.value ? "bg-[#117FDA] text-white" : dark ? "text-slate-300 hover:text-white" : "text-stone-500 hover:text-stone-800"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ── Compact Period control — a single small trigger ("Period: Last 1
// Year") that opens a floating popover instead of expanding a large
// full-width row inline in the header. Deliberately its own component
// (rather than reusing CustomSelect) because the popover needs to host
// the Custom date-range inputs conditionally, which CustomSelect's
// options-only panel doesn't support — but it copies CustomSelect's own
// positioning/close behavior (portal into document.body, viewport-aware
// up/down flip, --app-zoom correction, outside-click/Escape/scroll close)
// so it behaves identically to every other dropdown in the app. ────────
function PeriodControl({
  theme,
  period,
  customFrom,
  customTo,
  onChangePeriod,
  onChangeCustomFrom,
  onChangeCustomTo,
  options,
}: {
  theme: "light" | "dark";
  period: Period;
  customFrom: string;
  customTo: string;
  onChangePeriod: (p: Period) => void;
  onChangeCustomFrom: (v: string) => void;
  onChangeCustomTo: (v: string) => void;
  options: CustomSelectOption[];
}) {
  const dark = theme === "dark";
  const [open, setOpen] = useState(false);
  const [openUpward, setOpenUpward] = useState(false);
  const [panelRect, setPanelRect] = useState<{ top: number; bottom: number; left: number; width: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const handleToggle = () => {
    if (!open && containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      // Custom adds a date-range block below the option list, so the panel
      // can be taller than a plain option list — estimate generously when
      // deciding whether it fits below the trigger.
      const estimatedHeight = period === "custom" ? 260 : 190;
      const spaceBelow = window.innerHeight - rect.bottom;
      const spaceAbove = rect.top;
      setOpenUpward(spaceBelow < estimatedHeight && spaceAbove > spaceBelow);
      // See CustomSelect's handleToggle for why every coordinate below is
      // pre-divided by --app-zoom (Chromium re-multiplies position: fixed
      // descendants of a zoomed <html> a second time at paint).
      const zoom = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--app-zoom")) || 1;
      const margin = 8;
      const minWidth = 220;
      const width = Math.max(rect.width, minWidth);
      const clampedLeft = Math.min(Math.max(rect.left, margin), Math.max(margin, window.innerWidth - width - margin));
      setPanelRect({
        top: (rect.bottom + 6) / zoom,
        bottom: (window.innerHeight - rect.top + 6) / zoom,
        left: clampedLeft / zoom,
        width: width / zoom,
      });
    }
    setOpen((v) => !v);
  };

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (e: MouseEvent) => {
      const target = e.target as unknown as Node;
      const insideTrigger = containerRef.current?.contains(target);
      const insidePanel = panelRef.current?.contains(target);
      if (!insideTrigger && !insidePanel) setOpen(false);
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const handleReposition = (e: Event) => {
      const target = e.target as Node | null;
      if (target && panelRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", handlePointerDown as unknown as EventListener);
    document.addEventListener("keydown", handleKeyDown);
    window.addEventListener("scroll", handleReposition, true);
    window.addEventListener("resize", handleReposition);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown as unknown as EventListener);
      document.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("scroll", handleReposition, true);
      window.removeEventListener("resize", handleReposition);
    };
  }, [open, period]);

  const selectedLabel = options.find((o) => o.value === period)?.label ?? "";

  return (
    <div ref={containerRef} className="relative inline-block">
      <button
        type="button"
        onClick={handleToggle}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={`inline-flex items-center gap-1.5 pl-2.5 pr-2 py-1.5 rounded-lg border text-[13px] font-semibold cursor-pointer transition-colors ${
          dark ? "bg-[#102236] border-[#1e3e5c] text-[#eff6ff] hover:bg-[#132a42]" : "bg-white border-stone-250 text-stone-850 hover:bg-stone-50"
        } ${open ? (dark ? "ring-1 ring-[#117FDA]/50" : "ring-1 ring-[#117FDA]/30") : ""}`}
      >
        <Calendar className={`w-3.5 h-3.5 shrink-0 ${dark ? "text-slate-400" : "text-stone-400"}`} />
        <span className={dark ? "text-slate-400" : "text-stone-500"}>Period:</span>
        <span className="font-black">{selectedLabel}</span>
        <ChevronDown className={`w-3.5 h-3.5 shrink-0 transition-transform ${open ? "rotate-180" : ""} ${dark ? "text-slate-400" : "text-stone-400"}`} />
      </button>

      {open &&
        panelRect &&
        createPortal(
          <div
            ref={panelRef}
            role="listbox"
            className={`fixed z-50 rounded-xl border shadow-lg overflow-hidden ${
              dark ? "bg-[#14181f] border-white/[0.08] text-white" : "bg-[#ffffff] border-stone-200 text-stone-900"
            }`}
            style={{
              left: panelRect.left,
              width: panelRect.width,
              ...(openUpward ? { bottom: panelRect.bottom } : { top: panelRect.top }),
            }}
          >
            <div className="p-1.5 flex flex-col gap-0.5">
              {options.map((opt) => {
                const isSelected = opt.value === period;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    onClick={() => {
                      onChangePeriod(opt.value as Period);
                      if (opt.value !== "custom") setOpen(false);
                    }}
                    className={`w-full text-left px-3 py-1.5 rounded-lg text-[13px] font-semibold flex items-center justify-between gap-2 transition-colors ${
                      isSelected
                        ? dark
                          ? "bg-[#117FDA]/20 text-[#7cc2f5]"
                          : "bg-[#117FDA]/10 text-[#117FDA]"
                        : dark
                          ? "hover:bg-white/[0.05] text-slate-200"
                          : "hover:bg-stone-100 text-stone-700"
                    }`}
                  >
                    <span>{opt.label}</span>
                    {isSelected && <Check className="w-3.5 h-3.5 shrink-0" />}
                  </button>
                );
              })}
            </div>
            {period === "custom" && (
              <div className={`px-3 py-2.5 border-t flex flex-col gap-1.5 ${dark ? "border-white/[0.08]" : "border-stone-150"}`}>
                <span className="text-[10px] font-bold uppercase tracking-wider text-content-muted">Custom Range</span>
                <div className="flex items-center gap-1.5">
                  <input
                    type="month"
                    value={customFrom}
                    max={customTo}
                    onChange={(e) => onChangeCustomFrom(e.target.value)}
                    onClick={openNativePicker}
                    className={inputClass(dark) + " cursor-pointer flex-1 min-w-0"}
                  />
                  <span className="text-[12px] text-content-muted shrink-0">to</span>
                  <input
                    type="month"
                    value={customTo}
                    min={customFrom}
                    onChange={(e) => onChangeCustomTo(e.target.value)}
                    onClick={openNativePicker}
                    className={inputClass(dark) + " cursor-pointer flex-1 min-w-0"}
                  />
                </div>
              </div>
            )}
          </div>,
          document.body
        )}
    </div>
  );
}

// ── Team insights ────────────────────────────────────────────────────────
function TeamInsights({
  dark,
  theme,
  insights,
  onOpenAdvisor,
}: {
  dark: boolean;
  theme: "light" | "dark";
  insights: TeamInsightsData;
  onOpenAdvisor: (tactId: string) => void;
}) {
  const [rankMode, setRankMode] = useState<RankMode>("current");
  const [chartMetric, setChartMetric] = useState<MetricKey>("cumulative");
  const card = `rounded-xl border p-3 flex flex-col gap-1 ${dark ? "bg-white/[0.03] border-white/[0.08]" : "bg-white border-[var(--border)]"}`;
  const label = "text-[11px] font-bold uppercase tracking-wider text-content-muted";
  const iconClass = dark ? "text-slate-400" : "text-stone-400";
  // Client-side pick of the selected metric out of each month's full
  // MetricPoint set (see TeamInsightsData.chartData's comment) — no
  // refetch when the selector changes.
  const chartSeriesData = insights.chartData.map((d) => ({ month: d.month, score: d[chartMetric].score, instances: d[chartMetric].instances }));
  const hasChartData = chartSeriesData.filter((d) => d.score !== null).length > 1;
  const rankedTop5 = rankMode === "current" ? insights.top5CurrentMonth : insights.top5Period;
  const rankedBottom5 = rankMode === "current" ? insights.bottom5CurrentMonth : insights.bottom5Period;

  return (
    <div className="space-y-3">
      <CurrentMonthKpiRow
        dark={dark}
        monthLabel={insights.currentMonth?.monthLabel ?? null}
        cumulative={insights.currentMonth?.cumulative ?? null}
        cumulativeDelta={insights.currentMonth?.cumulativeDelta ?? null}
        lead={insights.currentMonth?.lead ?? EMPTY_MEDIUM_STAT}
        payment={insights.currentMonth?.payment ?? EMPTY_MEDIUM_STAT}
        chat={insights.currentMonth?.chat ?? EMPTY_MEDIUM_STAT}
        call={insights.currentMonth?.call ?? EMPTY_MEDIUM_STAT}
      />

      <div className="space-y-2">
        <h3 className={`text-[11px] font-black uppercase tracking-wider ${dark ? "text-white" : "text-[#111827]"}`}>Selected Period</h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-7 gap-3">
          <div className={card}>
            <span className={`${label} flex items-center gap-1`}>
              <Users2 className={`w-3.5 h-3.5 ${iconClass}`} />
              Cumulative Score
            </span>
            <span className={`text-2xl font-black ${scoreTextClass(insights.teamAvg, dark)}`}>{insights.teamAvg ?? "—"}</span>
            {insights.momentum.delta !== null ? (
              <span className={`flex items-center gap-1 text-[11px] font-bold ${deltaTextClass(insights.momentum.delta, dark)}`}>
                <DeltaIcon delta={insights.momentum.delta} />
                {insights.momentum.delta > 0 ? "+" : ""}
                {insights.momentum.delta} vs {insights.momentum.prevLabel}
              </span>
            ) : (
              <span className="text-[11px] text-content-muted">Not enough data yet</span>
            )}
          </div>
          <div className={card}>
            <span className={`${label} flex items-center gap-1`}>
              <Trophy className={`w-3.5 h-3.5 ${iconClass}`} />
              Highest Performer
            </span>
            <button
              onClick={() => insights.highest && onOpenAdvisor(insights.highest.tactId)}
              className={`text-base font-black truncate text-left cursor-pointer hover:underline ${dark ? "text-white" : "text-stone-900"}`}
            >
              {insights.highest ? insights.highest.name : "—"}
            </button>
            {insights.highest && <span className="text-xl font-black text-emerald-500">{insights.highest.avgCumulative}</span>}
          </div>
          <div className={card}>
            <span className={`${label} flex items-center gap-1`}>
              <TrendingDown className={`w-3.5 h-3.5 ${iconClass}`} />
              Lowest Performer
            </span>
            <button
              onClick={() => insights.lowest && onOpenAdvisor(insights.lowest.tactId)}
              className={`text-base font-black truncate text-left cursor-pointer hover:underline ${dark ? "text-white" : "text-stone-900"}`}
            >
              {insights.lowest ? insights.lowest.name : "—"}
            </button>
            {insights.lowest && <span className={`text-xl font-black ${insights.lowest.avgCumulative! < SCORE_DANGER ? "text-red-500" : dark ? "text-slate-200" : "text-stone-700"}`}>{insights.lowest.avgCumulative}</span>}
          </div>
          <div className={card}>
            <span className={`${label} flex items-center gap-1`}>
              <TrendingUp className={`w-3.5 h-3.5 ${iconClass}`} />
              Period Change
            </span>
            {insights.changeFirstLatest.delta !== null ? (
              <>
                <span className={`flex items-center gap-1 text-2xl font-black ${deltaTextClass(insights.changeFirstLatest.delta, dark)}`}>
                  <DeltaIcon delta={insights.changeFirstLatest.delta} />
                  {insights.changeFirstLatest.delta > 0 ? "+" : ""}
                  {insights.changeFirstLatest.delta}
                </span>
                <span className="text-[11px] text-content-muted">
                  {insights.changeFirstLatest.firstLabel} → {insights.changeFirstLatest.latestLabel}
                </span>
              </>
            ) : (
              <span className="text-[13px] text-content-muted">Not enough data yet</span>
            )}
          </div>
          <div className={card}>
            <span className={`${label} flex items-center gap-1`}>
              {insights.bestMedium ? MEDIUM_ICONS[insights.bestMedium.key] : <Target className={`w-3.5 h-3.5 ${iconClass}`} />}
              Best Medium
            </span>
            <span className={`text-base font-black ${dark ? "text-white" : "text-stone-900"}`}>{insights.bestMedium ? insights.bestMedium.label : "—"}</span>
            {insights.bestMedium && <span className="text-xl font-black text-emerald-500">{insights.bestMedium.avg}</span>}
          </div>
          <div className={card}>
            <span className={`${label} flex items-center gap-1`}>
              {insights.weakestMedium ? MEDIUM_ICONS[insights.weakestMedium.key] : <Target className={`w-3.5 h-3.5 ${iconClass}`} />}
              Weakest Medium
            </span>
            <span className={`text-base font-black ${dark ? "text-white" : "text-stone-900"}`}>{insights.weakestMedium ? insights.weakestMedium.label : "—"}</span>
            {insights.weakestMedium && <span className={`text-xl font-black ${insights.weakestMedium.avg < SCORE_DANGER ? "text-red-500" : dark ? "text-slate-200" : "text-stone-700"}`}>{insights.weakestMedium.avg}</span>}
          </div>
          <div className={card}>
            <span className={`${label} flex items-center gap-1`}>
              <Users2 className={`w-3.5 h-3.5 ${iconClass}`} />
              Total Mapped Advisors
            </span>
            <span className={`text-2xl font-black ${dark ? "text-white" : "text-stone-900"}`}>{insights.totalMapped}</span>
          </div>
        </div>
      </div>

      {/* Historical Performance — deliberately its own section, separate
          from Rankings below, so it doesn't visually compete with Current
          Month above it (Task 3 items 2 &amp; 5). Balanced two-up: trend
          chart on one side, the four historical medium tiles on the
          other — instead of one full-width chart dominating the page. */}
      <div className="space-y-2">
        <h3 className={`text-[11px] font-black uppercase tracking-wider ${dark ? "text-white" : "text-[#111827]"}`}>Historical Performance</h3>
        <div className="grid grid-cols-1 lg:grid-cols-[3fr_2fr] gap-3">
          <div className={`rounded-xl border p-3 flex flex-col ${dark ? "bg-white/[0.03] border-white/[0.08]" : "bg-white border-[var(--border)]"}`}>
            <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
              <h4 className={`text-[11px] font-black uppercase tracking-wider ${dark ? "text-white" : "text-[#111827]"}`}>Trend</h4>
              <MetricSelector value={chartMetric} onChange={setChartMetric} dark={dark} />
            </div>
            {hasChartData ? (
              <div className="w-full h-48 font-sans text-[11px] font-bold">
                <ScoreTrendChart dark={dark} theme={theme} data={chartSeriesData} scoreLabel={METRIC_LABELS[chartMetric]} />
              </div>
            ) : (
              <div className="flex-1 flex items-center justify-center py-10 text-[13px] text-content-muted">Not enough scored months yet.</div>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <MediumStatCard dark={dark} mediumKey="lead" stat={insights.historicalMediumStats.lead} />
            <MediumStatCard dark={dark} mediumKey="payment" stat={insights.historicalMediumStats.payment} />
            <MediumStatCard dark={dark} mediumKey="chat" stat={insights.historicalMediumStats.chat} />
            <MediumStatCard dark={dark} mediumKey="call" stat={insights.historicalMediumStats.call} />
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className={`text-[11px] font-black uppercase tracking-wider ${dark ? "text-white" : "text-[#111827]"}`}>Rankings</h3>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <div className="flex flex-col gap-2">
          {/* The toggle sits directly above Top 5 / Bottom 5, with no extra
              label — placement alone ties it to the two lists it controls
              (see this section's request: remove the "Rank Top 5 / Bottom 5
              by" text, keep the association obvious through layout). */}
          <div className="flex justify-center lg:justify-start">
            <SegmentedToggle
              value={rankMode}
              onChange={setRankMode}
              options={[
                { value: "current", label: "Current Month" },
                { value: "period", label: "Selected Period" },
              ]}
              dark={dark}
            />
          </div>
          <RankedList
            title="Top 5 Performers"
            icon={<Trophy className="w-3.5 h-3.5 text-amber-500" />}
            entries={rankedTop5}
            dark={dark}
            tone="good"
            onSelect={onOpenAdvisor}
            emptyLabel={rankMode === "current" ? "No scores for the current month yet." : "No scored advisors yet."}
          />
        </div>
        <div className="flex flex-col gap-2">
          {/* Spacer matching the toggle's own height above Top 5, so both
              cards' tops line up even though only Top 5 needs the toggle
              rendered above it. */}
          <div className="h-[30px] shrink-0" aria-hidden="true" />
          <RankedList
            title="Bottom 5 Performers"
            icon={<AlertTriangle className="w-3.5 h-3.5 text-red-500" />}
            entries={rankedBottom5}
            dark={dark}
            tone="poor"
            onSelect={onOpenAdvisor}
            emptyLabel={rankMode === "current" ? "No scores for the current month yet." : "No scored advisors yet."}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className={card}>
          <span className={label}>Most Improved</span>
          {insights.mostImproved ? (
            <button
              onClick={() => onOpenAdvisor(insights.mostImproved!.tactId)}
              className={`flex items-center justify-between gap-2 -mx-2 px-2 py-1.5 mt-0.5 rounded-lg cursor-pointer transition-colors ${dark ? "hover:bg-white/[0.05]" : "hover:bg-stone-50"}`}
            >
              <span className={`text-[15px] font-bold ${dark ? "text-white" : "text-stone-900"}`}>{insights.mostImproved.name}</span>
              <span className="flex items-center gap-1 text-[13px] font-black text-emerald-500">
                <TrendingUp className="w-3.5 h-3.5" />+{insights.mostImproved.change}
              </span>
            </button>
          ) : (
            <span className="text-[15px] text-content-muted">Not enough data yet</span>
          )}
        </div>
        <div className={card}>
          <span className={label}>Most Declined</span>
          {insights.mostDeclined ? (
            <button
              onClick={() => onOpenAdvisor(insights.mostDeclined!.tactId)}
              className={`flex items-center justify-between gap-2 -mx-2 px-2 py-1.5 mt-0.5 rounded-lg cursor-pointer transition-colors ${dark ? "hover:bg-white/[0.05]" : "hover:bg-stone-50"}`}
            >
              <span className={`text-[15px] font-bold ${dark ? "text-white" : "text-stone-900"}`}>{insights.mostDeclined.name}</span>
              <span className="flex items-center gap-1 text-[13px] font-black text-red-500">
                <TrendingDown className="w-3.5 h-3.5" />
                {insights.mostDeclined.change}
              </span>
            </button>
          ) : (
            <span className="text-[15px] text-content-muted">Not enough data yet</span>
          )}
        </div>
      </div>
    </div>
  );
}

function RankedList({
  title,
  icon,
  entries,
  dark,
  tone,
  onSelect,
  emptyLabel,
}: {
  title: string;
  icon: ReactNode;
  entries: RankedEntry[];
  dark: boolean;
  tone: "good" | "poor";
  onSelect: (tactId: string) => void;
  emptyLabel?: string;
}) {
  return (
    <div className={`rounded-xl border p-3 ${dark ? "bg-white/[0.03] border-white/[0.08]" : "bg-white border-[var(--border)]"}`}>
      <div className="flex items-center gap-1.5 mb-2">
        {icon}
        <h3 className={`text-[13px] font-black uppercase tracking-wider ${dark ? "text-white" : "text-[#111827]"}`}>{title}</h3>
      </div>
      {entries.length === 0 ? (
        <p className="text-[13px] text-content-muted py-2">{emptyLabel || "No scored advisors yet."}</p>
      ) : (
        <ol className="space-y-1">
          {entries.map((e, i) => (
            <li key={e.tactId}>
              <button
                onClick={() => onSelect(e.tactId)}
                className={`w-full flex items-center justify-between gap-2 px-2 py-1.5 rounded-lg cursor-pointer transition-colors ${dark ? "hover:bg-white/[0.05]" : "hover:bg-stone-50"}`}
              >
                <span className="flex items-center gap-2 min-w-0">
                  <span className="text-[11px] font-bold text-content-muted w-4 shrink-0">{i + 1}</span>
                  <span className={`text-[13px] font-bold truncate ${dark ? "text-white" : "text-stone-900"}`}>{e.name}</span>
                </span>
                <span className={`text-[13px] font-black shrink-0 ${tone === "good" ? "text-emerald-500" : "text-red-500"}`}>{e.value}</span>
              </button>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

// ── Team pivot table — one row per advisor, months as columns (newest
// first — see the header comment on displayMonths/prevMonthKeyOf). Always
// shows Cumulative Score (the Medium filter that used to switch this was
// removed — see this file's header comment). ─────────────────────────────
function TeamPivotTable({
  dark,
  pivots,
  months,
  prevMonthKeyOf,
  loading,
  onOpenAdvisor,
  cellClass,
  headClass,
}: {
  dark: boolean;
  pivots: AdvisorPivot[];
  months: MonthSpec[];
  prevMonthKeyOf: Record<string, string | undefined>;
  loading: boolean;
  onOpenAdvisor: (tactId: string) => void;
  cellClass: string;
  headClass: string;
}) {
  return (
    <div className={`rounded-xl border overflow-hidden ${dark ? "border-white/[0.08]" : "border-[var(--border)]"}`}>
      <div className="flex items-center justify-between px-3 py-2 border-b text-[11px] font-bold uppercase tracking-wider text-content-muted border-inherit">
        <span>Cumulative Score — Selected Period, by Month</span>
        <span>
          {pivots.length} advisor{pivots.length === 1 ? "" : "s"}
        </span>
      </div>
      {/* Own scroll container, capped well below the viewport so the table
          never grows the page itself — every mapped advisor is reachable
          by scrolling here, none are cut off by the initial viewport (see
          the "Table usability" requirement). sticky top-0 on each <th>
          (headClass) keeps the header pinned while scrolling. */}
      <div className="max-h-[65vh] overflow-auto">
        <table className="w-full text-[13px] border-collapse">
          <thead>
            <tr>
              <th className={headClass + " min-w-[180px]"}>Advisor</th>
              {months.map((m) => (
                <th key={m.key} className={headClass + " text-center"}>
                  {m.label}
                </th>
              ))}
              <th className={headClass + " text-center"}>Period Avg</th>
              <th className={headClass + " w-8"} aria-hidden="true" />
            </tr>
          </thead>
          <tbody>
            {pivots.length === 0 ? (
              <tr>
                <td colSpan={months.length + 3} className="px-3 py-6 text-center text-content-muted">
                  {loading ? "Loading…" : "No mapped advisors found for this scope."}
                </td>
              </tr>
            ) : (
              pivots.map((p) => (
                <Fragment key={p.tactId}>
                  <PivotAdvisorRow dark={dark} pivot={p} months={months} prevMonthKeyOf={prevMonthKeyOf} onOpen={() => onOpenAdvisor(p.tactId)} cellClass={cellClass} />
                </Fragment>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PivotAdvisorRow({
  dark,
  pivot,
  months,
  prevMonthKeyOf,
  onOpen,
  cellClass,
}: {
  dark: boolean;
  pivot: AdvisorPivot;
  months: MonthSpec[];
  prevMonthKeyOf: Record<string, string | undefined>;
  onOpen: () => void;
  cellClass: string;
}) {
  return (
    <tr
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
      role="button"
      tabIndex={0}
      title={`View ${pivot.name}'s QA performance`}
      className={`cursor-pointer transition-colors focus:outline-none ${dark ? "hover:bg-white/[0.06] focus-visible:bg-white/[0.06]" : "odd:bg-black/[0.015] hover:bg-stone-50 focus-visible:bg-stone-50"}`}
    >
      <td className={cellClass}>
        <span className={`flex items-center gap-1.5 font-bold truncate ${dark ? "text-blue-300" : "text-blue-700"}`}>
          <span className="truncate">{pivot.name}</span>
          {!pivot.hasActivity && (
            <span title="No QA activity this period">
              <CircleOff className="w-3 h-3 shrink-0 text-content-muted" />
            </span>
          )}
        </span>
      </td>
      {months.map((m) => {
        const row = pivot.monthly[m.key];
        const val = row ? row.cumulativeScore : null;
        const prevKey = prevMonthKeyOf[m.key];
        const prevRow = prevKey ? pivot.monthly[prevKey] : undefined;
        const prevVal = prevRow ? prevRow.cumulativeScore : null;
        return (
          <td key={m.key} className={cellClass + " text-center"}>
            {val === null ? (
              <span className="text-content-muted italic">NA</span>
            ) : (
              <span className="inline-flex items-center gap-1 justify-center">
                <span className={scoreFlagClasses(val, dark)}>{val}</span>
                <TrendArrow curr={val} prev={prevVal} />
              </span>
            )}
          </td>
        );
      })}
      <td className={cellClass + " text-center"}>
        <span className="font-black">{pivot.avgCumulative ?? "—"}</span>
      </td>
      <td className={cellClass}>
        <ChevronRight className={`w-4 h-4 shrink-0 ${dark ? "text-white/30" : "text-stone-300"}`} aria-hidden="true" />
      </td>
    </tr>
  );
}

// ── Medium stat card — QA score + Blunder % for one medium (Lead/Payment/
// Chat/Call), used on the advisor detail view. ───────────────────────────
function MediumStatCard({ dark, mediumKey, stat }: { dark: boolean; mediumKey: MediumKey; stat: MediumStat }) {
  return (
    <div className={`rounded-xl border p-3 flex flex-col gap-2 ${dark ? "bg-white/[0.03] border-white/[0.08]" : "bg-white border-[var(--border)]"}`}>
      <span className={`flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider ${dark ? "text-slate-300" : "text-stone-600"}`}>
        {MEDIUM_ICONS[mediumKey]}
        {MEDIUM_LABELS[mediumKey]}
      </span>
      <div className="flex items-end justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <span className="text-[10px] font-bold uppercase tracking-wider text-content-muted">QA Score</span>
          <span className={`text-xl font-black ${scoreTextClass(stat.avg, dark)}`}>{stat.avg ?? "—"}</span>
        </div>
        <div className="flex flex-col gap-0.5 items-end">
          <span className="text-[10px] font-bold uppercase tracking-wider text-content-muted">Blunder %</span>
          <span className={`text-xl font-black ${blunderTextClass(stat.blunderPct, dark)}`}>{stat.blunderPct === null ? "—" : `${stat.blunderPct}%`}</span>
        </div>
      </div>
      <span className="text-[11px] text-content-muted">
        {stat.instances} evaluation{stat.instances === 1 ? "" : "s"}
      </span>
    </div>
  );
}

// ── Advisor analysis — its own full-width view (see this file's header
// comment for why this replaced the old inline row expansion). ───────────
function AdvisorDetailView({
  dark,
  theme,
  pivot,
  orderedRows,
  prevMonthKeyOf,
}: {
  dark: boolean;
  theme: "light" | "dark";
  pivot: AdvisorPivot;
  orderedRows: MonthlyAdvisorRow[];
  prevMonthKeyOf: Record<string, string | undefined>;
}) {
  const chartData = orderedRows.map((r) => ({ month: r.monthLabel, score: r.cumulativeScore, instances: r.paymentsInstances + r.chatInstances + r.callInstances }));
  const hasChartData = chartData.filter((d) => d.score !== null).length > 1;
  const displayRows = useMemo(() => [...orderedRows].reverse(), [orderedRows]);

  const card = `rounded-xl border p-3 flex flex-col gap-1 ${dark ? "bg-white/[0.03] border-white/[0.08]" : "bg-white border-[var(--border)]"}`;
  const statLabel = "text-[10px] font-bold uppercase tracking-wider text-content-muted";
  const statValue = `text-lg font-black ${dark ? "text-white" : "text-stone-900"}`;

  const rowsByMonthKey = useMemo(() => {
    const map: Record<string, MonthlyAdvisorRow> = {};
    for (const r of orderedRows) map[r.monthKey] = r;
    return map;
  }, [orderedRows]);

  // This advisor's own latest-scored-month snapshot (see AdvisorPivot's
  // latestScoredRow comment) — independent of the team-wide "Current
  // Month" the main page uses, since one advisor can be missing more
  // recent data than the team overall.
  const latest = pivot.latestScoredRow;
  const latestPrevRow = latest ? rowsByMonthKey[prevMonthKeyOf[latest.monthKey] ?? ""] : undefined;
  const latestCumulativeDelta =
    latest && latestPrevRow && latest.cumulativeScore !== null && latestPrevRow.cumulativeScore !== null ? round2(latest.cumulativeScore - latestPrevRow.cumulativeScore) : null;

  const groupHeadClass = `sticky top-0 z-10 text-center py-1.5 px-2 font-bold whitespace-nowrap border-b ${
    dark ? "bg-[#0d1c3f] border-white/[0.16] text-slate-300" : "bg-[#f5f5f4] border-stone-200 text-stone-700"
  }`;
  const subHeadClass = `sticky top-[27px] z-10 text-center py-1.5 px-2 font-semibold whitespace-nowrap border-b text-[11px] ${
    dark ? "bg-[#0d1c3f] border-white/[0.16] text-slate-400" : "bg-[#f5f5f4] border-stone-200 text-stone-500"
  }`;
  const bodyCell = `px-2 py-2 text-center border-b ${dark ? "border-white/[0.05]" : "border-stone-100"}`;

  return (
    <div className="space-y-4">
      <CurrentMonthKpiRow
        dark={dark}
        monthLabel={latest?.monthLabel ?? null}
        cumulative={latest?.cumulativeScore ?? null}
        cumulativeDelta={latestCumulativeDelta}
        lead={buildMediumStat([latest?.leadScoreAvg ?? null], [latest?.leadScoreInstances ?? 0], [latest?.leadScoreBlunders ?? 0])}
        payment={buildMediumStat([latest?.paymentsAvg ?? null], [latest?.paymentsInstances ?? 0], [latest?.paymentsBlunders ?? 0])}
        chat={buildMediumStat([latest?.chatAvg ?? null], [latest?.chatInstances ?? 0], [latest?.chatBlunders ?? 0])}
        call={buildMediumStat([latest?.callAvg ?? null], [latest?.callInstances ?? 0], [latest?.callBlunders ?? 0])}
      />

      {/* Selected-period insights */}
      <div className="space-y-2">
        <h3 className={`text-[11px] font-black uppercase tracking-wider ${dark ? "text-white" : "text-[#111827]"}`}>Selected Period</h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
          <div className={card}>
            <span className={statLabel}>Period Avg</span>
            <span className={`${statValue} ${scoreTextClass(pivot.avgCumulative, dark)}`}>{pivot.avgCumulative ?? "—"}</span>
          </div>
          <div className={card}>
            <span className={statLabel}>Highest Month</span>
            <span className={`${statValue} text-emerald-500`}>{pivot.highest ? `${pivot.highest.score} (${pivot.highest.monthLabel})` : "—"}</span>
          </div>
          <div className={card}>
            <span className={statLabel}>Lowest Month</span>
            <span className={`${statValue} ${pivot.lowest && pivot.lowest.score < SCORE_DANGER ? "text-red-500" : ""}`}>{pivot.lowest ? `${pivot.lowest.score} (${pivot.lowest.monthLabel})` : "—"}</span>
          </div>
          <div className={card}>
            <span className={statLabel}>Change (First → Latest)</span>
            <span className={`${statValue} flex items-center gap-1 ${deltaTextClass(pivot.change, dark)}`}>
              <DeltaIcon delta={pivot.change} />
              {pivot.change === null ? "—" : `${pivot.change > 0 ? "+" : ""}${pivot.change}`}
            </span>
          </div>
          <div className={card}>
            <span className={statLabel}>Best Medium</span>
            <span className={`${statValue} text-emerald-500`}>{pivot.bestMedium ? `${pivot.bestMedium.label} (${pivot.bestMedium.avg})` : "—"}</span>
          </div>
          <div className={card}>
            <span className={statLabel}>Weakest Medium</span>
            <span className={`${statValue} ${pivot.weakestMedium && pivot.weakestMedium.avg < SCORE_DANGER ? "text-red-500" : ""}`}>{pivot.weakestMedium ? `${pivot.weakestMedium.label} (${pivot.weakestMedium.avg})` : "—"}</span>
          </div>
          <div className={card}>
            <span className={statLabel}>Total Evaluations</span>
            <span className={statValue}>{pivot.totalInstances}</span>
          </div>
        </div>
      </div>

      {/* Per-medium QA Score + Blunder % (whole selected period) */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <MediumStatCard dark={dark} mediumKey="lead" stat={pivot.mediumStats.lead} />
        <MediumStatCard dark={dark} mediumKey="payment" stat={pivot.mediumStats.payment} />
        <MediumStatCard dark={dark} mediumKey="chat" stat={pivot.mediumStats.chat} />
        <MediumStatCard dark={dark} mediumKey="call" stat={pivot.mediumStats.call} />
      </div>

      {hasChartData && (
        <div className={`rounded-xl border p-4 ${dark ? "bg-white/[0.03] border-white/[0.08]" : "bg-white border-[var(--border)]"}`}>
          <h4 className={`text-[11px] font-black uppercase tracking-wider mb-2 ${dark ? "text-white" : "text-[#111827]"}`}>Cumulative Score &amp; QA Instances Trend</h4>
          <div className="w-full h-64 font-sans text-[11px] font-bold">
            <ScoreTrendChart dark={dark} theme={theme} data={chartData} />
          </div>
        </div>
      )}

      {/* Full monthly breakdown — newest month first, grouped 2-row header
          so each medium's own Score/Instances pair only needs "Instances"
          rather than repeating the medium's name a second time. */}
      <div className={`rounded-xl border overflow-hidden ${dark ? "border-white/[0.08]" : "border-[var(--border)]"}`}>
        <div className="max-h-[55vh] overflow-auto">
          <table className="w-full text-[13px] border-collapse">
            <thead>
              <tr>
                <th rowSpan={2} className={groupHeadClass + " text-left"}>
                  Month
                </th>
                <th colSpan={2} className={groupHeadClass}>
                  Lead Score
                </th>
                <th colSpan={2} className={groupHeadClass}>
                  Payment QA
                </th>
                <th colSpan={2} className={groupHeadClass}>
                  Chat QA
                </th>
                <th colSpan={2} className={groupHeadClass}>
                  Call QA
                </th>
                <th rowSpan={2} className={groupHeadClass}>
                  Cumulative Score
                </th>
              </tr>
              <tr>
                <th className={subHeadClass}>Score</th>
                <th className={subHeadClass}>Instances</th>
                <th className={subHeadClass}>Score</th>
                <th className={subHeadClass}>Instances</th>
                <th className={subHeadClass}>Score</th>
                <th className={subHeadClass}>Instances</th>
                <th className={subHeadClass}>Score</th>
                <th className={subHeadClass}>Instances</th>
              </tr>
            </thead>
            <tbody>
              {displayRows.map((r) => {
                const prevKey = prevMonthKeyOf[r.monthKey];
                const prevRow = prevKey ? rowsByMonthKey[prevKey] : undefined;
                return (
                  <tr key={r.monthKey} className={`transition-colors ${dark ? "hover:bg-white/[0.03]" : "odd:bg-black/[0.015] hover:bg-stone-50"}`}>
                    <td className={`px-2 py-2 border-b text-left ${dark ? "border-white/[0.05]" : "border-stone-100"}`}>
                      <span className="inline-flex items-center gap-1">
                        {r.monthLabel}
                        <TrendArrow curr={r.cumulativeScore} prev={prevRow?.cumulativeScore ?? null} />
                      </span>
                    </td>
                    <td className={bodyCell}>
                      <span className={scoreFlagClasses(r.leadScoreAvg, dark)}>{r.leadScoreAvg ?? "NA"}</span>
                    </td>
                    <td className={bodyCell}>{r.leadScoreInstances}</td>
                    <td className={bodyCell}>
                      <span className={scoreFlagClasses(r.paymentsAvg, dark)}>{r.paymentsAvg ?? "NA"}</span>
                    </td>
                    <td className={bodyCell}>{r.paymentsInstances}</td>
                    <td className={bodyCell}>
                      <span className={scoreFlagClasses(r.chatAvg, dark)}>{r.chatAvg ?? "NA"}</span>
                    </td>
                    <td className={bodyCell}>{r.chatInstances}</td>
                    <td className={bodyCell}>
                      <span className={scoreFlagClasses(r.callAvg, dark)}>{r.callAvg ?? "NA"}</span>
                    </td>
                    <td className={bodyCell}>{r.callInstances}</td>
                    <td className={bodyCell}>
                      <span className="font-black">{r.cumulativeScore ?? "NA"}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ── Advisor Insights (Task 2) — Latest QA Performance, QA Feedback,
// Disputes & Escalations, and Coaching History for one advisor. Every
// number/record here is either the same Current Month snapshot the
// Performance view uses, or an actual source record from the QA
// Dashboard's existing Feedback/Reviews endpoints or this file's own
// Coaching Workspace — nothing here is AI-generated or reinterpreted, per
// this file's header comment. ──────────────────────────────────────────
function SectionCard({ dark, title, action, children }: { dark: boolean; title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <div className={`rounded-xl border p-3 ${dark ? "bg-white/[0.03] border-white/[0.08]" : "bg-white border-[var(--border)]"}`}>
      <div className="flex items-center justify-between gap-2 mb-2">
        <h3 className={`text-[11px] font-black uppercase tracking-wider ${dark ? "text-white" : "text-[#111827]"}`}>{title}</h3>
        {action}
      </div>
      {children}
    </div>
  );
}

function ViewAllToggle({ dark, expanded, total, onToggle }: { dark: boolean; expanded: boolean; total: number; onToggle: () => void }) {
  if (total <= 5) return null;
  return (
    <button type="button" onClick={onToggle} className={`text-[11px] font-bold cursor-pointer ${dark ? "text-blue-300" : "text-blue-700"}`}>
      {expanded ? "Show less" : `View all ${total}`}
    </button>
  );
}

// ── Chat ID link + flag-severity dot line — shared by QA Feedback and
// Disputes & Escalations (Task 3 items 11 &amp; 12). A Chat ID only ever
// renders as a link when the record actually has one — never fabricated
// for records without one. ────────────────────────────────────────────
function chatIdLink(chatId: string): string {
  return `https://dittohq.in/whatsapp/chats?chat=${encodeURIComponent(chatId)}`;
}
function ChatIdLink({ value, dark }: { value: unknown; dark: boolean }) {
  const chatId = value === null || value === undefined || value === "" ? "" : String(value);
  if (!chatId) return null;
  return (
    <a
      href={chatIdLink(chatId)}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
      className={`text-[11px] font-bold underline underline-offset-2 shrink-0 ${dark ? "text-blue-300 hover:text-blue-200" : "text-blue-700 hover:text-blue-800"}`}
      title="Open chat"
    >
      {chatId}
    </a>
  );
}
function FlagLine({ dot, text }: { dot: string; text: string }) {
  return (
    <div className="flex items-start gap-1.5">
      <span className={`mt-1 w-1.5 h-1.5 rounded-full shrink-0 ${dot}`} />
      <span>{text}</span>
    </div>
  );
}

function QaFeedbackSection({ dark, data, loading, error }: { dark: boolean; data: SheetTableLike | null; loading: boolean; error: string }) {
  const [expanded, setExpanded] = useState(false);
  const rows = data?.rows || [];
  const shown = expanded ? rows : rows.slice(0, 5);
  return (
    <SectionCard dark={dark} title="QA Feedback" action={<ViewAllToggle dark={dark} expanded={expanded} total={rows.length} onToggle={() => setExpanded((v) => !v)} />}>
      {loading ? (
        <p className="text-[13px] text-content-muted py-2">Loading…</p>
      ) : error || data?.error ? (
        <p className="text-[13px] text-red-500 py-2">{error || data?.message || "Failed to load QA feedback."}</p>
      ) : rows.length === 0 ? (
        <p className="text-[13px] text-content-muted py-2">No QA feedback records yet.</p>
      ) : (
        <ul className="space-y-1.5 max-h-[50vh] overflow-auto">
          {shown.map((r, i) => (
            <li key={i} className={`rounded-lg border px-2.5 py-2 text-[12px] ${dark ? "border-white/[0.06]" : "border-stone-100"}`}>
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <span className="flex items-center gap-2 font-bold">
                  <span className={dark ? "text-slate-300" : "text-stone-600"}>{fmtCell(r["Checked Date"])}</span>
                  <span className={dark ? "text-slate-500" : "text-stone-400"}>·</span>
                  <span>{fmtCell(r["Domain"])}</span>
                </span>
                <span className="flex items-center gap-2 shrink-0">
                  <span className={`px-2 py-0.5 rounded-full text-[11px] font-black ${scoreChipClass(r["Score"], dark)}`}>{fmtCell(r["Score"])}</span>
                  <ChatIdLink value={r["Chat ID"]} dark={dark} />
                </span>
              </div>
              {(r["Red Flags"] || r["Orange Flags"] || r["Green Flags"]) && (
                <div className="mt-1.5 space-y-1 text-[11px]">
                  {r["Red Flags"] ? <FlagLine dot="bg-red-500" text={String(r["Red Flags"])} /> : null}
                  {r["Orange Flags"] ? <FlagLine dot="bg-amber-500" text={String(r["Orange Flags"])} /> : null}
                  {r["Green Flags"] ? <FlagLine dot="bg-emerald-500" text={String(r["Green Flags"])} /> : null}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}

function DisputesEscalationsSection({ dark, data, loading, error }: { dark: boolean; data: SheetTableLike | null; loading: boolean; error: string }) {
  const [expanded, setExpanded] = useState(false);
  const rows = data?.rows || [];
  const shown = expanded ? rows : rows.slice(0, 5);
  return (
    <SectionCard dark={dark} title="Disputes & Escalations" action={<ViewAllToggle dark={dark} expanded={expanded} total={rows.length} onToggle={() => setExpanded((v) => !v)} />}>
      {loading ? (
        <p className="text-[13px] text-content-muted py-2">Loading…</p>
      ) : error || data?.error ? (
        <p className="text-[13px] text-red-500 py-2">{error || data?.message || "Failed to load disputes & escalations."}</p>
      ) : rows.length === 0 ? (
        <p className="text-[13px] text-content-muted py-2">No disputes or escalations on record.</p>
      ) : (
        <ul className="space-y-1.5 max-h-[50vh] overflow-auto">
          {shown.map((r, i) => (
            <li key={i} className={`rounded-lg border px-2.5 py-2 text-[12px] ${dark ? "border-white/[0.06]" : "border-stone-100"}`}>
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <span className="flex items-center gap-2 font-bold flex-wrap">
                  <span className={dark ? "text-slate-300" : "text-stone-600"}>{fmtCell(r["Raised"])}</span>
                  <span className={dark ? "text-slate-500" : "text-stone-400"}>·</span>
                  <span>{fmtCell(r["Domain"])}</span>
                  <span
                    className={`px-1.5 py-0.5 rounded text-[10px] font-black uppercase ${
                      r["Type"] === "Dispute" ? (dark ? "bg-blue-500/20 text-blue-300" : "bg-blue-50 text-blue-700") : dark ? "bg-amber-500/20 text-amber-300" : "bg-amber-50 text-amber-700"
                    }`}
                  >
                    {fmtCell(r["Type"])}
                  </span>
                </span>
                <span className="flex items-center gap-2 shrink-0">
                  <span className={`px-2 py-0.5 rounded-full text-[11px] font-black ${scoreChipClass(r["Score"], dark)}`}>{fmtCell(r["Score"])}</span>
                  <span className={`text-[11px] font-bold ${dark ? "text-slate-300" : "text-stone-600"}`}>{fmtCell(r["Status"])}</span>
                  <ChatIdLink value={r["Chat ID"]} dark={dark} />
                </span>
              </div>
              {(r["Comment"] || r["QA Response"]) && (
                <div className="mt-1 space-y-0.5 text-[11px]">
                  {r["Comment"] ? (
                    <p>
                      <span className="font-bold text-content-muted">Advisor: </span>
                      {String(r["Comment"])}
                    </p>
                  ) : null}
                  {r["QA Response"] ? (
                    <p>
                      <span className="font-bold text-content-muted">QA Response: </span>
                      {String(r["QA Response"])}
                    </p>
                  ) : null}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}

function AdvisorInsightsView({
  dark,
  pivot,
  orderedRows,
  prevMonthKeyOf,
}: {
  dark: boolean;
  pivot: AdvisorPivot;
  orderedRows: MonthlyAdvisorRow[];
  prevMonthKeyOf: Record<string, string | undefined>;
}) {
  const latest = pivot.latestScoredRow;
  const latestDelta = useMemo(() => {
    if (!latest) return null;
    const prevRow = orderedRows.find((r) => r.monthKey === prevMonthKeyOf[latest.monthKey]);
    return prevRow && latest.cumulativeScore !== null && prevRow.cumulativeScore !== null ? round2(latest.cumulativeScore - prevRow.cumulativeScore) : null;
  }, [latest, orderedRows, prevMonthKeyOf]);

  const [feedback, setFeedback] = useState<SheetTableLike | null>(null);
  const [feedbackLoading, setFeedbackLoading] = useState(true);
  const [feedbackError, setFeedbackError] = useState("");
  const [reviews, setReviews] = useState<SheetTableLike | null>(null);
  const [reviewsLoading, setReviewsLoading] = useState(true);
  const [reviewsError, setReviewsError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setFeedbackLoading(true);
    setFeedbackError("");
    fetchQaFeedback(pivot.tactId)
      .then((r) => {
        if (!cancelled) setFeedback(r);
      })
      .catch((err) => {
        if (!cancelled) setFeedbackError(err.message || "Failed to load QA feedback.");
      })
      .finally(() => {
        if (!cancelled) setFeedbackLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [pivot.tactId]);

  useEffect(() => {
    let cancelled = false;
    setReviewsLoading(true);
    setReviewsError("");
    fetchQaReviews(pivot.tactId)
      .then((r) => {
        if (!cancelled) setReviews(r);
      })
      .catch((err) => {
        if (!cancelled) setReviewsError(err.message || "Failed to load disputes & escalations.");
      })
      .finally(() => {
        if (!cancelled) setReviewsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [pivot.tactId]);

  return (
    <div className="space-y-4">
      <CurrentMonthKpiRow
        dark={dark}
        monthLabel={latest?.monthLabel ?? null}
        cumulative={latest?.cumulativeScore ?? null}
        cumulativeDelta={latestDelta}
        lead={buildMediumStat([latest?.leadScoreAvg ?? null], [latest?.leadScoreInstances ?? 0], [latest?.leadScoreBlunders ?? 0])}
        payment={buildMediumStat([latest?.paymentsAvg ?? null], [latest?.paymentsInstances ?? 0], [latest?.paymentsBlunders ?? 0])}
        chat={buildMediumStat([latest?.chatAvg ?? null], [latest?.chatInstances ?? 0], [latest?.chatBlunders ?? 0])}
        call={buildMediumStat([latest?.callAvg ?? null], [latest?.callInstances ?? 0], [latest?.callBlunders ?? 0])}
      />
      <QaFeedbackSection dark={dark} data={feedback} loading={feedbackLoading} error={feedbackError} />
      <DisputesEscalationsSection dark={dark} data={reviews} loading={reviewsLoading} error={reviewsError} />
    </div>
  );
}

// Session Feedback (formerly "Coaching Workspace") has moved to the
// Advisor QA Dashboard (QaDashboardPage.tsx) — see requirement #15. It no
// longer lives here; TeamTrackerPage.tsx keeps only the QA
// Feedback/Disputes & Escalations sections in AdvisorInsightsView above.
