/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Fragment, useCallback, useEffect, useMemo, useState, type MouseEvent, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  RefreshCw,
  Users2,
  TrendingUp,
  TrendingDown,
  Minus,
  Trophy,
  AlertTriangle,
  ChevronRight,
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
 * Only Period remains as a page-level control (Advisor/Medium filters and
 * the Admin "Change team" card were deliberately removed — see the header
 * row below); picking a Period auto-reloads the table, and for an Admin
 * the app-wide header back button steps back to the Guide/Mentor picker
 * before leaving the tab (registerSubPageBack), so "change team" is still
 * reachable without a dedicated on-page control.
 *
 * Advisor analysis opens as its own full-width view (openAdvisorTactId
 * below) rather than expanding inline under the table row, with a slide/
 * fade transition (AnimatePresence) between the two — this page registers
 * a "close the advisor view" handler with the app-wide header back button
 * (registerSubPageBack, from App.tsx) instead of drawing its own back
 * button, so one back control does both jobs everywhere in the app — see
 * App.tsx's goBack.
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

/** Avg + instance count for one medium in one specific month, team-wide —
 * feeds the "Current Month" KPI row (see computeInsights). */
interface MediumSnapshot {
  avg: number | null;
  instances: number;
}
const EMPTY_MEDIUM_SNAPSHOT: MediumSnapshot = { avg: null, instances: 0 };

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

/** Team-wide avg + instance total for one medium in one specific month —
 * the "Current Month" KPI row's per-medium cards. */
function teamMediumSnapshot(pivots: AdvisorPivot[], monthKey: string, avgField: keyof MonthlyAdvisorRow, instField: keyof MonthlyAdvisorRow): MediumSnapshot {
  const avg = avgArr(pivots.map((p) => (p.monthly[monthKey]?.[avgField] as number | null | undefined) ?? null));
  const instances = pivots.reduce((sum, p) => sum + ((p.monthly[monthKey]?.[instField] as number | undefined) ?? 0), 0);
  return { avg, instances };
}

interface CurrentMonthSnapshot {
  monthKey: string;
  monthLabel: string;
  cumulative: number | null;
  cumulativeDelta: number | null;
  lead: MediumSnapshot;
  payment: MediumSnapshot;
  chat: MediumSnapshot;
  call: MediumSnapshot;
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
  bestMedium: { key: MediumKey; label: string; avg: number } | null;
  weakestMedium: { key: MediumKey; label: string; avg: number } | null;
  /** Team-wide average Cumulative Score + total QA instances per month,
   * chronological — feeds the dual-axis team trend chart. */
  chartData: { month: string; score: number | null; instances: number }[];
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
        lead: teamMediumSnapshot(pivots, currentMonthKey, "leadScoreAvg", "leadScoreInstances"),
        payment: teamMediumSnapshot(pivots, currentMonthKey, "paymentsAvg", "paymentsInstances"),
        chat: teamMediumSnapshot(pivots, currentMonthKey, "chatAvg", "chatInstances"),
        call: teamMediumSnapshot(pivots, currentMonthKey, "callAvg", "callInstances"),
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

  // Total QA Instances (chart's second line) — Payment+Chat+Call only, same
  // Lead-exclusion rule as totalInstances/REAL_MEDIUM_KEYS above.
  const chartData = monthlyTeamAvg.map((m) => ({
    month: m.monthLabel,
    score: m.avg,
    instances: pivots.reduce((sum, p) => sum + (p.monthly[m.monthKey]?.paymentsInstances ?? 0) + (p.monthly[m.monthKey]?.chatInstances ?? 0) + (p.monthly[m.monthKey]?.callInstances ?? 0), 0),
  }));

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
    bestMedium,
    weakestMedium,
    chartData,
  };
}

interface TeamTrackerPageProps {
  theme: "light" | "dark";
  /** Registers/clears this page's "close the advisor detail view" handler
   * with the app-wide header back button (App.tsx), so a single back
   * control both leaves the tab AND steps out of the advisor view — see
   * App.tsx's goBack. Called with null whenever no advisor view is open
   * (or on unmount) so the header falls back to normal tab history. */
  registerSubPageBack?: (handler: (() => void) | null) => void;
}

export function TeamTrackerPage({ theme, registerSubPageBack }: TeamTrackerPageProps) {
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

  // Register/clear the app-wide header back button's job whenever the
  // advisor view opens/closes, or (with nothing else registered) let an
  // Admin step back to the Guide/Mentor picker before leaving the tab —
  // the only remaining way to change team now that the on-page "Change"
  // control is gone (see this file's header comment).
  useEffect(() => {
    if (!registerSubPageBack) return;
    if (openPivot) {
      registerSubPageBack(() => setOpenAdvisorTactId(null));
    } else if (context?.isAdmin && !context.needsSelection) {
      registerSubPageBack(() => loadContext("", ""));
    } else {
      registerSubPageBack(null);
    }
    return () => registerSubPageBack(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openPivot, context?.isAdmin, context?.needsSelection]);

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
            <div>
              <h1 className={`text-page-title tracking-tight flex items-center gap-2 ${dark ? "text-white" : "text-[#111827]"}`}>
                <Users2 className="w-5 h-5" />
                <span>{openPivot.name}</span>
              </h1>
              <p className="text-[13px] mt-1 font-semibold text-content-muted">
                Team Tracker · {context.scopeLabel} · {periodOptions.find((o) => o.value === period)?.label}
              </p>
            </div>
            <AdvisorDetailView dark={dark} theme={theme} pivot={openPivot} orderedRows={openPivotRows} prevMonthKeyOf={prevMonthKeyOf} />
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
              </h1>
              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                <CustomSelect
                  theme={theme}
                  value={period}
                  onChange={(v) => setPeriod(v as Period)}
                  options={periodOptions}
                  triggerClassName={`inline-flex items-center gap-2 pl-3 pr-8 py-1.5 rounded-lg border text-[13px] font-bold cursor-pointer relative ${
                    dark ? "bg-[#102236] border-[#1e3e5c] text-[#eff6ff]" : "bg-white border-stone-250 text-stone-850"
                  }`}
                />
                {period === "custom" && (
                  <>
                    <input type="month" value={customFrom} max={customTo} onChange={(e) => setCustomFrom(e.target.value)} onClick={openNativePicker} className={inputClass(dark) + " cursor-pointer"} />
                    <span className="text-[13px] text-content-muted">to</span>
                    <input type="month" value={customTo} min={customFrom} onChange={(e) => setCustomTo(e.target.value)} onClick={openNativePicker} className={inputClass(dark) + " cursor-pointer"} />
                  </>
                )}
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
function ScoreTrendChart({ dark, theme, data }: { dark: boolean; theme: "light" | "dark"; data: { month: string; score: number | null; instances?: number }[] }) {
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
                      {p.dataKey === "score" ? "Score: " : "Instances: "}
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
        <Line yAxisId="score" type="monotone" dataKey="score" name="Cumulative Score" stroke="#117FDA" strokeWidth={2} dot={{ r: 3 }} connectNulls />
        {hasInstances && <Line yAxisId="instances" type="monotone" dataKey="instances" name="QA Instances" stroke="#9CA3AF" strokeWidth={1.5} strokeDasharray="4 3" dot={{ r: 2 }} />}
      </LineChart>
    </ResponsiveContainer>
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
  lead: MediumSnapshot;
  payment: MediumSnapshot;
  chat: MediumSnapshot;
  call: MediumSnapshot;
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
        </div>
        <MediumKpiCard dark={dark} label="Lead Score" icon={MEDIUM_ICONS.lead} stat={lead} />
        <MediumKpiCard dark={dark} label="Payment QA" icon={MEDIUM_ICONS.payment} stat={payment} />
        <MediumKpiCard dark={dark} label="Chat QA" icon={MEDIUM_ICONS.chat} stat={chat} />
        <MediumKpiCard dark={dark} label="Call QA" icon={MEDIUM_ICONS.call} stat={call} />
      </div>
    </div>
  );
}
function MediumKpiCard({ dark, label, icon, stat }: { dark: boolean; label: string; icon: ReactNode; stat: MediumSnapshot }) {
  const card = `rounded-xl border p-3 flex flex-col gap-1 ${dark ? "bg-white/[0.03] border-white/[0.08]" : "bg-white border-[var(--border)]"}`;
  return (
    <div className={card}>
      <span className={`flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-content-muted`}>
        {icon}
        {label}
      </span>
      <span className={`text-2xl font-black ${scoreTextClass(stat.avg, dark)}`}>{stat.avg ?? "—"}</span>
      <span className="text-[11px] text-content-muted">
        {stat.instances} instance{stat.instances === 1 ? "" : "s"}
      </span>
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
  const card = `rounded-xl border p-3 flex flex-col gap-1 ${dark ? "bg-white/[0.03] border-white/[0.08]" : "bg-white border-[var(--border)]"}`;
  const label = "text-[11px] font-bold uppercase tracking-wider text-content-muted";
  const iconClass = dark ? "text-slate-400" : "text-stone-400";
  const hasChartData = insights.chartData.filter((d) => d.score !== null).length > 1;
  const rankedTop5 = rankMode === "current" ? insights.top5CurrentMonth : insights.top5Period;
  const rankedBottom5 = rankMode === "current" ? insights.bottom5CurrentMonth : insights.bottom5Period;

  return (
    <div className="space-y-3">
      <CurrentMonthKpiRow
        dark={dark}
        monthLabel={insights.currentMonth?.monthLabel ?? null}
        cumulative={insights.currentMonth?.cumulative ?? null}
        cumulativeDelta={insights.currentMonth?.cumulativeDelta ?? null}
        lead={insights.currentMonth?.lead ?? EMPTY_MEDIUM_SNAPSHOT}
        payment={insights.currentMonth?.payment ?? EMPTY_MEDIUM_SNAPSHOT}
        chat={insights.currentMonth?.chat ?? EMPTY_MEDIUM_SNAPSHOT}
        call={insights.currentMonth?.call ?? EMPTY_MEDIUM_SNAPSHOT}
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
              className={`text-[15px] font-bold truncate text-left cursor-pointer hover:underline ${dark ? "text-white" : "text-stone-900"}`}
            >
              {insights.highest ? insights.highest.name : "—"}
            </button>
            {insights.highest && <span className="text-[13px] font-semibold text-emerald-500">{insights.highest.avgCumulative}</span>}
          </div>
          <div className={card}>
            <span className={`${label} flex items-center gap-1`}>
              <TrendingDown className={`w-3.5 h-3.5 ${iconClass}`} />
              Lowest Performer
            </span>
            <button
              onClick={() => insights.lowest && onOpenAdvisor(insights.lowest.tactId)}
              className={`text-[15px] font-bold truncate text-left cursor-pointer hover:underline ${dark ? "text-white" : "text-stone-900"}`}
            >
              {insights.lowest ? insights.lowest.name : "—"}
            </button>
            {insights.lowest && <span className={`text-[13px] font-semibold ${insights.lowest.avgCumulative! < SCORE_DANGER ? "text-red-500" : "text-content-muted"}`}>{insights.lowest.avgCumulative}</span>}
          </div>
          <div className={card}>
            <span className={`${label} flex items-center gap-1`}>
              <TrendingUp className={`w-3.5 h-3.5 ${iconClass}`} />
              Change (First → Latest)
            </span>
            {insights.changeFirstLatest.delta !== null ? (
              <>
                <span className={`flex items-center gap-1 text-xl font-black ${deltaTextClass(insights.changeFirstLatest.delta, dark)}`}>
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
            <span className={`text-[15px] font-bold ${dark ? "text-white" : "text-stone-900"}`}>{insights.bestMedium ? insights.bestMedium.label : "—"}</span>
            {insights.bestMedium && <span className="text-[13px] font-semibold text-emerald-500">{insights.bestMedium.avg}</span>}
          </div>
          <div className={card}>
            <span className={`${label} flex items-center gap-1`}>
              {insights.weakestMedium ? MEDIUM_ICONS[insights.weakestMedium.key] : <Target className={`w-3.5 h-3.5 ${iconClass}`} />}
              Weakest Medium
            </span>
            <span className={`text-[15px] font-bold ${dark ? "text-white" : "text-stone-900"}`}>{insights.weakestMedium ? insights.weakestMedium.label : "—"}</span>
            {insights.weakestMedium && <span className={`text-[13px] font-semibold ${insights.weakestMedium.avg < SCORE_DANGER ? "text-red-500" : "text-content-muted"}`}>{insights.weakestMedium.avg}</span>}
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

      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className={`text-[11px] font-black uppercase tracking-wider ${dark ? "text-white" : "text-[#111827]"}`}>Trend &amp; Rankings</h3>
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-bold uppercase tracking-wider text-content-muted">Rank Top 5 / Bottom 5 by</span>
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
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-[2fr_1fr_1fr] gap-3">
        <div className={`rounded-xl border p-3 flex flex-col ${dark ? "bg-white/[0.03] border-white/[0.08]" : "bg-white border-[var(--border)]"}`}>
          <h4 className={`text-[11px] font-black uppercase tracking-wider mb-2 ${dark ? "text-white" : "text-[#111827]"}`}>Cumulative Score &amp; QA Instances Trend</h4>
          {hasChartData ? (
            <div className="w-full h-48 font-sans text-[11px] font-bold">
              <ScoreTrendChart dark={dark} theme={theme} data={insights.chartData} />
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center py-10 text-[13px] text-content-muted">Not enough scored months yet.</div>
          )}
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

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className={card}>
          <span className={label}>Most Improved</span>
          <span className="text-[10px] text-content-muted -mt-0.5">Selected period, first vs. latest month</span>
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
          <span className="text-[10px] text-content-muted -mt-0.5">Selected period, first vs. latest month</span>
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
        lead={{ avg: latest?.leadScoreAvg ?? null, instances: latest?.leadScoreInstances ?? 0 }}
        payment={{ avg: latest?.paymentsAvg ?? null, instances: latest?.paymentsInstances ?? 0 }}
        chat={{ avg: latest?.chatAvg ?? null, instances: latest?.chatInstances ?? 0 }}
        call={{ avg: latest?.callAvg ?? null, instances: latest?.callInstances ?? 0 }}
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
