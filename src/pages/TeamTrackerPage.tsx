/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from "react";
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
  Check,
  Calendar,
  CircleOff,
  UserX,
  MessageCircle,
  Phone,
  Wallet,
  Target,
  ClipboardList,
  ListChecks,
  Pencil,
  X,
  Search,
  Layers,
} from "lucide-react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine } from "recharts";
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
/** One row in the Guide/Mentor picker — pictureUrl is that person's Google
 * account avatar (best-effort name match against the users directory, see
 * teamTrackerService.ts), null when no match/photo, in which case the row
 * falls back to an initials avatar. */
interface TeamTrackerPerson {
  name: string;
  pictureUrl: string | null;
}
interface TeamTrackerContext {
  isAdmin: boolean;
  isGuide: boolean;
  isMentor: boolean;
  callerName: string;
  scopeLabel: string;
  advisors: Advisor[];
  needsSelection: boolean;
  guides: TeamTrackerPerson[];
  mentors: TeamTrackerPerson[];
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

/** Mirrors qaDataEngine.ts's BatchMetric — one advisor's real scores over an
 * exact date range (not averaged from monthly rows). See
 * teamTrackerService.ts's getTeamTrackerPeriodSummary. */
interface BatchMetric {
  paymentsAvg: number | null;
  paymentsInstances: number;
  paymentsBlunders: number;
  leadScoreAvg: number | null;
  leadScoreInstances: number;
  leadScoreBlunders: number;
  chatAvg: number | null;
  chatInstances: number;
  chatBlunders: number;
  callAvg: number | null;
  callInstances: number;
  callBlunders: number;
}
/** Mirrors teamTrackerService.ts's TeamTrackerPeriodSummaryResult. */
interface TeamTrackerPeriodSummaryResult {
  scopeLabel: string;
  filters: { checkedFrom: string; checkedTo: string; tillDate: string };
  metrics: Record<string, BatchMetric>;
}
/** Team Home Page's period-view "QA Performance" data, derived from
 * periodSummary — bundled into one prop so TeamInsights doesn't need five
 * separate ones. null fields mean "still loading / not fetched yet"
 * (ONGOING never fetches periodSummary at all — see loadPeriodSummary). */
interface PeriodSummaryDerived {
  filters: { checkedFrom: string; checkedTo: string; tillDate: string } | null;
  teamMedium: Record<MediumKey, MediumStat> | null;
  teamCumulative: number | null;
  rankingsByMetric: Record<MetricKey, { top5: RankedEntry[]; bottom5: RankedEntry[] }> | null;
  loading: boolean;
  error: string;
}
/** Advisor Performance page's own period-view "QA Performance" data — one
 * advisor's own slice of periodSummary, rather than a team aggregate. */
interface AdvisorPeriodSummaryDerived {
  filters: { checkedFrom: string; checkedTo: string; tillDate: string } | null;
  metric: BatchMetric | null;
  cumulative: number | null;
  loading: boolean;
}

type Period = "ongoing" | "3m" | "6m" | "1y" | "custom";
type MediumKey = "lead" | "payment" | "chat" | "call";
type RankMode = "current" | "period";

// Team Tracker Universal Rules (explicit spec): the QA score benchmark is
// 3.5 — anything below is "not okay" — but no constant for it lives here
// anymore. It no longer drives QA score TEXT color: every main QA score
// renders plain white/neutral everywhere on this page (see scoreTextClass/
// scoreFlagClasses below) — Blunder % is the metric that carries color now,
// and it has its own real thresholds (used below), unlike the benchmark.
// Accepted Blunder % is up to and including 25%. Color tiers below.
const BLUNDER_AMBER_MIN_PCT = 15;
const BLUNDER_RED_MIN_PCT = 25;

const MEDIUM_LABELS: Record<MediumKey, string> = { lead: "Lead Score", payment: "Payment QA", chat: "Chat QA", call: "Call QA" };
const MEDIUM_SHORT_LABELS: Record<MediumKey, string> = { lead: "Lead", payment: "Payment", chat: "Chat", call: "Call" };
const MEDIUM_ICONS: Record<MediumKey, ReactNode> = {
  lead: <Target className="w-3.5 h-3.5" />,
  payment: <Wallet className="w-3.5 h-3.5" />,
  chat: <MessageCircle className="w-3.5 h-3.5" />,
  call: <Phone className="w-3.5 h-3.5" />,
};
/** Cumulative Score's own icon — every other KPI tile on this page pairs
 * its label with an icon; this one didn't. Layers reads as "a composite of
 * more than one thing," matching the tile's own "Lead Score + Payment
 * Score" tagline. */
const CUMULATIVE_ICON = <Layers className="w-3.5 h-3.5" />;
/** One muted color per medium — distinguishes each point on the ONGOING
 * view's "This Month by Medium" line chart (Ongoing View Updates item 3)
 * without leaning on red/green (those already mean good/bad delta
 * elsewhere on this page — see deltaTextClass). Muted tones throughout,
 * per the Universal Rules' "highlighting colours should use muted tones". */
const MEDIUM_CHART_COLORS: Record<MediumKey, string> = {
  lead: "#6366F1", // muted indigo
  payment: "#0D9488", // muted teal
  chat: "#D97706", // muted amber
  call: "#DB2777", // muted rose
};

// ── Piecewise ("segmented axis") score scale — shared by every 0–5 score
// chart on this page. Most QA scores cluster in the 3.0–5.0 band, where the
// difference between e.g. 4.2 and 4.6 is what actually drives a decision; a
// uniform 0–5 axis crushes that whole band into a sliver at the top. This
// scale keeps 0–SCORE_SCALE_BREAK at 1x (compressed — a bad score reads as
// "bad", its exact value below the benchmark rarely matters) and expands
// SCORE_SCALE_BREAK–5 at SCORE_SCALE_EXPAND-x (the band every read of this
// dashboard actually happens in), so more of the chart's pixels go to the
// range that matters. scoreToVisual/visualToScore convert between a real
// score and its position on this scale; SCORE_SCALE_VISUAL_TICKS +
// formatScoreScaleTick give every chart the same fixed, labeled tick set
// (whole numbers below the break, half-points above it) so a given score
// sits at the same relative axis position everywhere it's drawn.
const SCORE_SCALE_BREAK = 3;
const SCORE_SCALE_EXPAND = 2;
const SCORE_SCALE_MAX_VIRTUAL = SCORE_SCALE_BREAK + (5 - SCORE_SCALE_BREAK) * SCORE_SCALE_EXPAND; // 7
function scoreToVisual(v: number): number {
  return v <= SCORE_SCALE_BREAK ? v : SCORE_SCALE_BREAK + (v - SCORE_SCALE_BREAK) * SCORE_SCALE_EXPAND;
}
function visualToScore(v: number): number {
  return v <= SCORE_SCALE_BREAK ? v : SCORE_SCALE_BREAK + (v - SCORE_SCALE_BREAK) / SCORE_SCALE_EXPAND;
}
const SCORE_SCALE_TICKS = [0, 1, 2, 3, 3.5, 4, 4.5, 5];
const SCORE_SCALE_VISUAL_TICKS = SCORE_SCALE_TICKS.map(scoreToVisual);
const SCORE_SCALE_TICK_LABELS: [number, string][] = SCORE_SCALE_TICKS.map((t) => [scoreToVisual(t), Number.isInteger(t) ? String(t) : t.toFixed(1)]);
function formatScoreScaleTick(v: number): string {
  const hit = SCORE_SCALE_TICK_LABELS.find(([vv]) => Math.abs(vv - v) < 0.001);
  return hit ? hit[1] : visualToScore(v).toFixed(1);
}

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

// Team Tracker Universal Rules (explicit spec): "Main QA scores: White" —
// a QA score's own text no longer color-codes off the 3.5 benchmark (that
// used to run through here and scoreTextClass below). Kept as its own
// function/call sites unchanged (rather than inlining a literal class at
// every use) so a future rule change has one place to land, same reasoning
// as before — just a constant result now instead of a conditional one.
function scoreFlagClasses(_value: number | null | undefined, dark: boolean): string {
  return dark ? "text-white font-bold" : "text-stone-900 font-bold";
}
// Same rule, for a standalone big number (stat cards).
function scoreTextClass(_value: number | null | undefined, dark: boolean): string {
  return dark ? "text-white" : "text-stone-900";
}
// Blunder % is where color now lives (Universal Rules: "Blunder % colour
// treatment" — below 15% muted light green, 15-24% muted amber, 25%+ muted
// red — deliberately softer/darker-saturated shades than a flat -500 on
// every tier, per "all highlighting colours should use muted tones").
function blunderTextClass(pct: number | null, dark: boolean): string {
  if (pct === null) return dark ? "text-slate-500" : "text-stone-400";
  if (pct >= BLUNDER_RED_MIN_PCT) return dark ? "text-red-300" : "text-red-700";
  if (pct >= BLUNDER_AMBER_MIN_PCT) return dark ? "text-amber-300" : "text-amber-700";
  return dark ? "text-emerald-300" : "text-emerald-700";
}
/** Muted green for a positive delta, muted red for negative, muted
 * grey/slate for zero/unknown — the one consistent color convention every
 * MoM/trend indicator on this page uses (cards, table cells, chart). Softer
 * -300/-700 pair instead of a flat -500 on both themes, per the Universal
 * Rules' "muted tones only" rule. */
function deltaTextClass(delta: number | null, dark: boolean): string {
  if (delta === null) return dark ? "text-slate-400" : "text-stone-500";
  if (delta > 0) return dark ? "text-emerald-300" : "text-emerald-700";
  if (delta < 0) return dark ? "text-red-300" : "text-red-700";
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
/** "ongoing"/"3m"/"6m"/"1y" -> {fromMonth, toMonth} ending at the current
 * month, both "yyyy-MM". "ongoing" collapses the range to the current month
 * alone (fromMonth === toMonth) — the Home Page and Advisor Performance
 * page's shared default (see this file's header comment). Custom period
 * supplies its own pair directly instead of going through this. */
function periodToRange(period: Exclude<Period, "custom">): { fromMonth: string; toMonth: string } {
  const now = new Date();
  // ONGOING now loads the same trailing year as "Last Year" rather than
  // just the current month — its own Month Picker (preferredCurrentMonthKey)
  // needs real past months to offer, not just the one that's already
  // selected by default. CurrentMonthKpiRow/PivotAdvisorRowOngoing still
  // always default to the latest scored month unless the user pins an
  // older one, so nothing about ONGOING's own default view changes.
  const back = period === "3m" ? 2 : period === "6m" ? 5 : 11; // inclusive of current month
  const from = new Date(now.getFullYear(), now.getMonth() - back, 1);
  return { fromMonth: ymOf(from), toMonth: ymOf(now) };
}

/** "yyyy-MM-dd" -> "Jul 1, 2026" — for periodSummary's Start/End/Till Date
 * display (see getTeamTrackerPeriodSummary). Falls back to the raw string
 * on anything that doesn't parse, rather than throwing. */
function fmtDisplayDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return `${MONTH_ABBR[m - 1] ?? m} ${d}, ${y}`;
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

// ── Trend arrow — month-over-month direction, deliberately independent of
// scoreFlagClasses' absolute-quality coloring (see that function's comment
// above). null when either side is missing (nothing to compare, not "flat"). ─
function TrendArrow({ curr, prev, dark }: { curr: number | null; prev: number | null; dark: boolean }) {
  if (curr === null || prev === null) return null;
  const delta = round2(curr - prev);
  if (delta > 0) return <TrendingUp className={`w-3 h-3 shrink-0 ${dark ? "text-emerald-300" : "text-emerald-700"}`} />;
  if (delta < 0) return <TrendingDown className={`w-3 h-3 shrink-0 ${dark ? "text-red-300" : "text-red-700"}`} />;
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
/** One row of the Most Improved / Most Declined lists (Task item 4) — the
 * previous and current score plus which two months they came from, since
 * that can differ advisor to advisor (see AdvisorPivot's
 * firstScoredMonth/lastScoredMonth comment). */
interface ImprovedEntry {
  tactId: string;
  name: string;
  change: number;
  prevScore: number;
  prevMonthLabel: string;
  currScore: number;
  currMonthLabel: string;
}
const RANK_LIST_SIZE = 5;
const IMPROVED_LIST_SIZE = 3;
function rankFromEntries(entries: { tactId: string; name: string; value: number | null }[]): { top5: RankedEntry[]; bottom5: RankedEntry[] } {
  const withVal = entries.filter((e): e is RankedEntry => e.value !== null);
  const ranked = [...withVal].sort((a, b) => b.value - a.value);
  const top5 = ranked.slice(0, RANK_LIST_SIZE);
  const bottom5 = ranked.length > RANK_LIST_SIZE ? [...ranked].slice(-RANK_LIST_SIZE).reverse() : [...ranked].reverse();
  return { top5, bottom5 };
}
function rankEntries(pivots: AdvisorPivot[], valueOf: (p: AdvisorPivot) => number | null): { top5: RankedEntry[]; bottom5: RankedEntry[] } {
  return rankFromEntries(pivots.map((p) => ({ tactId: p.tactId, name: p.name, value: valueOf(p) })));
}

/** Pulls one metric's value out of a period-summary BatchMetric (the real
 * date-range figure — see getTeamTrackerPeriodSummary) — Cumulative isn't a
 * field on BatchMetric itself, so it's derived the same null-tolerant way
 * the server's own avgOf(lead, payment) is (avgArr does the identical
 * filter-then-mean). */
function periodMetricValueOf(m: BatchMetric | undefined, metric: MetricKey): number | null {
  if (!m) return null;
  switch (metric) {
    case "lead":
      return m.leadScoreAvg;
    case "payment":
      return m.paymentsAvg;
    case "chat":
      return m.chatAvg;
    case "call":
      return m.callAvg;
    default:
      return avgArr([m.leadScoreAvg, m.paymentsAvg]);
  }
}
/** Selected Period's own per-medium/per-metric Top 5 / Bottom 5, sourced
 * from the actual-date-range period summary instead of averaged monthly
 * pivots (see periodMetricValueOf) — the period-view equivalent of
 * computeInsights' rankingsByMediumCurrentMonth. `pivots` supplies the
 * advisor roster (name/tactId); `metrics` is the period summary's own
 * per-tactId BatchMetric map. */
function rankingsByMetricFromPeriodSummary(pivots: AdvisorPivot[], metrics: Record<string, BatchMetric>): Record<MetricKey, { top5: RankedEntry[]; bottom5: RankedEntry[] }> {
  const of = (metric: MetricKey) => rankFromEntries(pivots.map((p) => ({ tactId: p.tactId, name: p.name, value: periodMetricValueOf(metrics[p.tactId], metric) })));
  return { cumulative: of("cumulative"), lead: of("lead"), payment: of("payment"), chat: of("chat"), call: of("call") };
}
/** Team-wide per-medium score + instances + Blunder % built from the actual
 * date-range period summary (see getTeamTrackerPeriodSummary), not from
 * averaging each advisor's own already-monthly-averaged mediumStats — the
 * period-view equivalent of computeInsights' periodMedium. Same avgArr-of-
 * each-advisor's-own-avg aggregation style as periodMedium (only the time
 * dimension changes — real dates instead of per-month buckets), so results
 * stay comparable in shape, just more accurate. */
function teamMediumFromPeriodSummary(pivots: AdvisorPivot[], metrics: Record<string, BatchMetric>): Record<MediumKey, MediumStat> {
  const fieldsOf = (key: MediumKey, m: BatchMetric | undefined): { avg: number | null; instances: number; blunders: number } => {
    if (!m) return { avg: null, instances: 0, blunders: 0 };
    if (key === "lead") return { avg: m.leadScoreAvg, instances: m.leadScoreInstances, blunders: m.leadScoreBlunders };
    if (key === "payment") return { avg: m.paymentsAvg, instances: m.paymentsInstances, blunders: m.paymentsBlunders };
    if (key === "chat") return { avg: m.chatAvg, instances: m.chatInstances, blunders: m.chatBlunders };
    return { avg: m.callAvg, instances: m.callInstances, blunders: m.callBlunders };
  };
  const statFor = (key: MediumKey): MediumStat => {
    const rows = pivots.map((p) => fieldsOf(key, metrics[p.tactId]));
    return buildMediumStat(
      rows.map((r) => r.avg),
      rows.map((r) => r.instances),
      rows.map((r) => r.blunders)
    );
  };
  return { lead: statFor("lead"), payment: statFor("payment"), chat: statFor("chat"), call: statFor("call") };
}
/** Team-level Cumulative Score for a period view — same avgArr-of-each-
 * advisor's-own-cumulative aggregation style as teamMediumFromPeriodSummary
 * above (each advisor's own cumulative already comes from periodMetricValueOf's
 * avgArr([lead, payment]) case), so the Cumulative Score tile can appear
 * alongside Lead/Payment/Chat/Call in period views the same way it already
 * does in ONGOING (Task: "Add the Cumulative Score card to the period
 * views"). */
function teamCumulativeFromPeriodSummary(pivots: AdvisorPivot[], metrics: Record<string, BatchMetric>): number | null {
  return avgArr(pivots.map((p) => periodMetricValueOf(metrics[p.tactId], "cumulative")));
}

// ── Low-score flagging (ONGOING view only) — Lead Score and Payment QA are
// the only two mediums with an explicit low-volume/low-score policy (per
// this section's spec); Chat/Call aren't evaluated for either list. Both
// thresholds are score < 3.5 (the same benchmark this file's Universal
// Rules comment already documents); what differs is the instance-count
// side: Low-Score Monitoring is a "not enough volume to act on yet"
// watchlist, Potential QIP is "enough volume that this is a real pattern."
// The two instance bands (Monitoring <20/<10, QIP >=15/>=5) overlap by
// design (15-19 Lead instances, 5-9 Payment instances can land in both) —
// exactly as specified, not narrowed to be mutually exclusive. ───────────
const LOW_SCORE_BENCHMARK = 3.5;
const LEAD_MONITORING_MAX_INSTANCES = 20;
const LEAD_QIP_MIN_INSTANCES = 15;
const PAYMENT_MONITORING_MAX_INSTANCES = 10;
const PAYMENT_QIP_MIN_INSTANCES = 5;
interface LowScoreFlag {
  medium: "lead" | "payment";
  avg: number;
  instances: number;
}
interface LowScoreEntry {
  tactId: string;
  name: string;
  flags: LowScoreFlag[];
}
/** Builds the Low-Score Monitoring or Potential QIP list (mutually
 * governed by `mode`) for one specific month — always the team's current
 * month in this file's only call site, but takes the row map rather than
 * a monthKey so it stays a pure function of already-resolved data. */
function buildLowScoreEntries(pivots: AdvisorPivot[], monthKey: string | null, mode: "monitoring" | "qip"): LowScoreEntry[] {
  if (!monthKey) return [];
  const entries: LowScoreEntry[] = [];
  for (const p of pivots) {
    const row = p.monthly[monthKey];
    if (!row) continue;
    const flags: LowScoreFlag[] = [];
    if (row.leadScoreAvg !== null && row.leadScoreAvg < LOW_SCORE_BENCHMARK) {
      const qualifies = mode === "monitoring" ? row.leadScoreInstances < LEAD_MONITORING_MAX_INSTANCES : row.leadScoreInstances >= LEAD_QIP_MIN_INSTANCES;
      if (qualifies) flags.push({ medium: "lead", avg: row.leadScoreAvg, instances: row.leadScoreInstances });
    }
    if (row.paymentsAvg !== null && row.paymentsAvg < LOW_SCORE_BENCHMARK) {
      const qualifies = mode === "monitoring" ? row.paymentsInstances < PAYMENT_MONITORING_MAX_INSTANCES : row.paymentsInstances >= PAYMENT_QIP_MIN_INSTANCES;
      if (qualifies) flags.push({ medium: "payment", avg: row.paymentsAvg, instances: row.paymentsInstances });
    }
    if (flags.length) entries.push({ tactId: p.tactId, name: p.name, flags });
  }
  return entries;
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

// ── QA Feedback "Discussed" marks (Task 6 item 3) — backend-persisted
// (qa_feedback_discussed_marks table, via the /team-tracker/feedback-
// discussed routes) so the mark is the same for every Guide/Mentor/Admin
// who opens this advisor, not a per-browser localStorage flag only the
// person who ticked it would ever see. Keyed by a stable identity built
// from the row's own Chat ID + Checked Date + Domain (falls back to list
// index only for a row missing all three, which still marks correctly
// within one render but won't survive the underlying data reordering
// across a refresh — sheet-sourced rows carry no id of their own). ───────
function feedbackRowIdentity(r: Record<string, unknown>, index: number): string {
  const parts = [r["Chat ID"], r["Checked Date"], r["Domain"]].filter((v) => v !== null && v !== undefined && v !== "");
  return parts.length ? parts.map(String).join("|") : `row-${index}`;
}
async function fetchDiscussedFeedback(tactId: string): Promise<string[]> {
  return fetchJson<string[]>(`/api/qa-dashboard/team-tracker/feedback-discussed?${qs({ tactId })}`);
}
async function putFeedbackDiscussed(tactId: string, rowIdentity: string, discussed: boolean): Promise<void> {
  const res = await fetch("/api/qa-dashboard/team-tracker/feedback-discussed", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tactId, rowIdentity, discussed }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.message || body?.error || `HTTP ${res.status}`);
}

// Both call sites' date fields (Checked Date / Raised) come from
// serialToDMY() server-side, which always formats as "DD-MM-YY" (e.g.
// "02-09-26" for 2 Sept 2026) — see sheetsClient.ts. `Date.parse` does NOT
// know that convention; it reads a bare dash-separated triple as MM-DD-YY,
// so "02-09-26" silently became "9 Feb 2026" instead of "2 Sept 2026". That
// happened to only bite dates whose day-of-month is ≤12 (anything higher
// makes an invalid "month" and Date.parse returns NaN, which the fallback
// below correctly treats as unparseable and keeps) — which is exactly why
// this filter was dropping some very recent, legitimate rows (a Checked
// Date like "02-09-26") while working fine for others ("13-08-26"). Parse
// the known DD-MM-YY shape explicitly instead of trusting Date.parse's
// locale-ish guessing.
function parseDmyDateMs(value: string): number | null {
  const m = value.trim().match(/^(\d{1,2})-(\d{1,2})-(\d{2,4})$/);
  if (!m) return null;
  const day = Number(m[1]);
  const month = Number(m[2]);
  const year = Number(m[3]) < 100 ? Number(m[3]) + 2000 : Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return Date.UTC(year, month - 1, day);
}

// ── Last-30-days filter (Task 6 item 5) — shared by QA Feedback (Checked
// Date) and Disputes & Escalations (Raised). A row whose date field fails
// to parse is KEPT rather than silently hidden — this narrows the list, it
// shouldn't risk dropping a real record over an unexpected date format. ──
function isWithinLastDays(value: unknown, days: number): boolean {
  if (value === null || value === undefined || value === "") return true;
  const str = String(value);
  const t = parseDmyDateMs(str) ?? Date.parse(str);
  if (t === null || Number.isNaN(t)) return true;
  return t >= Date.now() - days * 24 * 60 * 60 * 1000;
}

// ── Session Feedback — full editable control lives here (explicit
// request: the earlier relocation to the Advisor QA Dashboard was a
// mapping error; "the full control of this program should be within team
// tracker page itself"). Draft persistence (browser localStorage,
// per-advisor) + saved history (DB, via the same
// /api/qa-dashboard/team-tracker/coaching/* routes used before) — a
// session is written ONLY on explicit Save. The QA Dashboard's own
// self-view gets a separate, read-only rendering of this same history
// (its own ActionableStatus/FeedbackSummaryEntry copies + fetch — see that
// file), with just the actionable status editable there since that's the
// advisor's own actionable to act on. ──────────────────────────────────
type ActionableStatus = "Open" | "In Progress" | "Completed" | "Failed";
interface SessionFeedbackActionableDraft {
  id: string; // client-only React key, not persisted as-is
  description: string;
  dueDate: string; // "yyyy-MM-dd", "" = none
}
interface SessionFeedbackDraft {
  meetingDate: string; // "yyyy-MM-dd"
  discussionPoints: string;
  meetingNotes: string;
  actionables: SessionFeedbackActionableDraft[];
}
function emptySessionFeedbackDraft(): SessionFeedbackDraft {
  const d = new Date();
  return { meetingDate: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, discussionPoints: "", meetingNotes: "", actionables: [] };
}
function sessionFeedbackDraftKey(tactId: string): string {
  return `ditto_session_feedback_draft_${tactId}`;
}
/** Reading/writing localStorage can throw (private browsing, storage full,
 * disabled) — every call site treats that as "no draft available" rather
 * than crashing the page. */
function loadSessionFeedbackDraft(tactId: string): SessionFeedbackDraft {
  try {
    const raw = window.localStorage.getItem(sessionFeedbackDraftKey(tactId));
    if (!raw) return emptySessionFeedbackDraft();
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && Array.isArray(parsed.actionables)) return parsed as SessionFeedbackDraft;
  } catch {
    /* corrupt/unreadable draft — start fresh rather than crash */
  }
  return emptySessionFeedbackDraft();
}
function saveSessionFeedbackDraftToStorage(tactId: string, draft: SessionFeedbackDraft) {
  try {
    window.localStorage.setItem(sessionFeedbackDraftKey(tactId), JSON.stringify(draft));
  } catch {
    /* storage full/unavailable — draft just won't survive a refresh */
  }
}
function clearSessionFeedbackDraft(tactId: string) {
  try {
    window.localStorage.removeItem(sessionFeedbackDraftKey(tactId));
  } catch {
    /* ignore */
  }
}
function isSessionFeedbackDraftEmpty(d: SessionFeedbackDraft): boolean {
  return !d.discussionPoints.trim() && !d.meetingNotes.trim() && d.actionables.every((a) => !a.description.trim());
}

interface FeedbackSummaryActionable {
  id: number;
  description: string;
  dueDate: string | null;
  status: ActionableStatus;
}
interface FeedbackSummaryEntry {
  id: number;
  tactId: string;
  advisorName: string;
  authorName: string;
  meetingDate: string;
  discussionPoints: string | null;
  meetingNotes: string | null;
  createdAt: string;
  actionables: FeedbackSummaryActionable[];
}
async function fetchFeedbackSummary(tactId: string): Promise<FeedbackSummaryEntry[]> {
  return fetchJson<FeedbackSummaryEntry[]>(`/api/qa-dashboard/team-tracker/coaching/history?${qs({ tactId })}`);
}
async function postSessionFeedback(payload: {
  tactId: string;
  meetingDate: string;
  discussionPoints: string;
  meetingNotes: string;
  actionables: { description: string; dueDate: string | null; status: "Open" }[];
}): Promise<FeedbackSummaryEntry> {
  const res = await fetch("/api/qa-dashboard/team-tracker/coaching/sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.message || body?.error || `HTTP ${res.status}`);
  return body as FeedbackSummaryEntry;
}
/** Edit option for saved session feedback (Task 7) — the only way a
 * session's own discussion points / meeting notes / actionable list change
 * after the initial Save. Returns the updated entry so the caller can
 * patch it into local state without a full refetch. */
async function patchSessionFeedback(
  sessionId: number,
  payload: {
    meetingDate: string;
    discussionPoints: string;
    meetingNotes: string;
    actionables: { id?: number; description: string; dueDate: string | null; status: ActionableStatus }[];
  }
): Promise<FeedbackSummaryEntry> {
  const res = await fetch(`/api/qa-dashboard/team-tracker/coaching/sessions/${sessionId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.message || body?.error || `HTTP ${res.status}`);
  return body as FeedbackSummaryEntry;
}

/** Feedback Summary's own status control — the only place an actionable's
 * status changes after it's created, other than the advisor's own
 * read-only-view status control on the QA Dashboard. */
async function patchActionableStatus(actionableId: number, status: ActionableStatus): Promise<void> {
  const res = await fetch(`/api/qa-dashboard/team-tracker/coaching/actionables/${actionableId}/status`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.message || body?.error || `HTTP ${res.status}`);
}

function ActionableStatusChip({ status, dark }: { status: ActionableStatus; dark: boolean }) {
  const cls =
    status === "Completed"
      ? dark
        ? "bg-emerald-500/20 text-emerald-300"
        : "bg-emerald-50 text-emerald-700"
      : status === "Failed"
        ? dark
          ? "bg-red-500/20 text-red-300"
          : "bg-red-50 text-red-700"
        : status === "In Progress"
          ? dark
            ? "bg-amber-500/20 text-amber-300"
            : "bg-amber-50 text-amber-700"
          : dark
            ? "bg-white/10 text-slate-300"
            : "bg-stone-100 text-stone-600";
  return <span className={`px-1.5 py-0.5 rounded text-[10px] font-black uppercase shrink-0 ${cls}`}>{status}</span>;
}

const ACTIONABLE_STATUS_OPTIONS: CustomSelectOption[] = [
  { value: "Open", label: "Open" },
  { value: "In Progress", label: "In Progress" },
  { value: "Completed", label: "Completed" },
  { value: "Failed", label: "Failed" },
];

/** Feedback Summary's own status control — Open -> In Progress ->
 * Completed/Failed, editable inline. Optimistic update with rollback on
 * failure so the dropdown feels immediate.
 *
 * Built on CustomSelect rather than a native <select> — a native select's
 * expanded option list is rendered by the OS/browser itself and can't be
 * restyled, which is exactly the "classic old design" look that stood out
 * against the rest of the app (flat white panel, generic blue highlight,
 * system font) instead of this app's floating-panel language. CustomSelect
 * is the app-wide fix for that same problem everywhere else it's used. Its
 * outer wrapper is `w-full` by design (fills whatever box it's given), so
 * it's wrapped here in a small fixed-width box sized to fit "In Progress"
 * (the longest option) rather than at each of this component's call sites. */
function ActionableStatusSelect({ actionableId, status, dark, onChanged }: { actionableId: number; status: ActionableStatus; dark: boolean; onChanged: (next: ActionableStatus) => void }) {
  const [saving, setSaving] = useState(false);
  const triggerClassName = `w-full flex items-center justify-between gap-1 pl-1.5 pr-5 py-0.5 rounded border outline-none text-[10px] font-black uppercase relative ${
    dark ? "bg-[#102236] border-[#1e3e5c] text-[#eff6ff]" : "bg-white border-stone-250 text-stone-850"
  } ${saving ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`;
  return (
    <div className="w-[118px] shrink-0">
      <CustomSelect
        value={status}
        disabled={saving}
        theme={dark ? "dark" : "light"}
        triggerClassName={triggerClassName}
        options={ACTIONABLE_STATUS_OPTIONS}
        onChange={async (value) => {
          const next = value as ActionableStatus;
          const prev = status;
          onChanged(next);
          setSaving(true);
          try {
            await patchActionableStatus(actionableId, next);
          } catch {
            onChanged(prev); // roll back on failure
          } finally {
            setSaving(false);
          }
        }}
      />
    </div>
  );
}

// ── Feedback Summary edit draft (Task 7 — "Enable an Edit option for
// saved session feedback"). Mirrors SessionFeedbackDraft's shape but each
// actionable carries the DB id it came from (undefined = new, added during
// this edit) so Save can tell coachingRepository.updateSession which rows
// to update vs. insert; any existing actionable simply absent from this
// list on Save is deleted server-side. ──────────────────────────────────
interface EditSessionDraft {
  meetingDate: string;
  discussionPoints: string;
  meetingNotes: string;
  actionables: { key: string; id?: number; description: string; dueDate: string; status: ActionableStatus }[];
}
function entryToEditDraft(s: FeedbackSummaryEntry): EditSessionDraft {
  return {
    meetingDate: s.meetingDate,
    discussionPoints: s.discussionPoints || "",
    meetingNotes: s.meetingNotes || "",
    actionables: s.actionables.map((a) => ({ key: `${a.id}`, id: a.id, description: a.description, dueDate: a.dueDate || "", status: a.status })),
  };
}

// ── Feedback Summary — the longitudinal record of session feedback for
// this advisor. Scannable list, newest meeting first; each actionable's
// status is editable right here rather than only settable at creation, and
// (Task 7) the whole entry — date, discussion, notes, actionable list —
// can now be edited after Save via the Pencil button, not just re-created.
function FeedbackSummarySection({ dark, tactId, refreshSignal }: { dark: boolean; tactId: string; refreshSignal: number }) {
  const [entries, setEntries] = useState<FeedbackSummaryEntry[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    fetchFeedbackSummary(tactId)
      .then((r) => {
        if (!cancelled) setEntries(r);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message || "Failed to load feedback summary.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tactId, refreshSignal]);

  const setActionableStatus = (sessionId: number, actionableId: number, next: ActionableStatus) => {
    setEntries((prev) => (prev ? prev.map((s) => (s.id !== sessionId ? s : { ...s, actionables: s.actionables.map((a) => (a.id === actionableId ? { ...a, status: next } : a)) })) : prev));
  };

  const [editingId, setEditingId] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState<EditSessionDraft | null>(null);
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState("");
  const startEdit = (s: FeedbackSummaryEntry) => {
    setEditingId(s.id);
    setEditDraft(entryToEditDraft(s));
    setEditError("");
  };
  const cancelEdit = () => {
    setEditingId(null);
    setEditDraft(null);
    setEditError("");
  };
  const saveEdit = async (sessionId: number) => {
    if (!editDraft) return;
    setEditSaving(true);
    setEditError("");
    try {
      const updated = await patchSessionFeedback(sessionId, {
        meetingDate: editDraft.meetingDate,
        discussionPoints: editDraft.discussionPoints,
        meetingNotes: editDraft.meetingNotes,
        actionables: editDraft.actionables.filter((a) => a.description.trim()).map((a) => ({ id: a.id, description: a.description.trim(), dueDate: a.dueDate || null, status: a.status })),
      });
      setEntries((prev) => (prev ? prev.map((s) => (s.id === sessionId ? updated : s)) : prev));
      cancelEdit();
    } catch (err: any) {
      setEditError(err.message || "Failed to save changes.");
    } finally {
      setEditSaving(false);
    }
  };

  const inputCls = `w-full rounded-lg border px-2.5 py-1.5 text-[12px] outline-none ${dark ? "bg-[#102236] border-[#1e3e5c] text-[#eff6ff]" : "bg-white border-stone-250 text-stone-850"}`;

  return (
    <div className={`rounded-xl border overflow-hidden ${dark ? "border-white/[0.08] bg-white/[0.03]" : "border-[var(--border)] bg-white"}`}>
      <div className={`px-3 py-2.5 border-b ${dark ? "border-white/[0.08]" : "border-stone-150"}`}>
        <h4 className={`text-[11px] font-black uppercase tracking-wider ${dark ? "text-white" : "text-[#111827]"}`}>Feedback Summary</h4>
      </div>
      <div className="p-3">
        {loading ? (
          <p className="text-[13px] text-content-muted py-2">Loading…</p>
        ) : error ? (
          <p className="text-[13px] text-red-500 py-2">{error}</p>
        ) : !entries || entries.length === 0 ? (
          <p className="text-[13px] text-content-muted py-2">No session feedback logged yet.</p>
        ) : (
          <ul className="space-y-2 max-h-[50vh] overflow-auto">
            {entries.map((s) =>
              editingId === s.id && editDraft ? (
                <li key={s.id} className={`rounded-lg border p-2.5 space-y-2 ${dark ? "border-white/[0.12] bg-white/[0.02]" : "border-stone-200 bg-surface-solid"}`}>
                  <label className="flex flex-col gap-1">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-content-muted">Meeting Date</span>
                    <input type="date" value={editDraft.meetingDate} onChange={(e) => setEditDraft((d) => (d ? { ...d, meetingDate: e.target.value } : d))} className={inputCls} />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-content-muted">Discussion Points</span>
                    <textarea rows={2} value={editDraft.discussionPoints} onChange={(e) => setEditDraft((d) => (d ? { ...d, discussionPoints: e.target.value } : d))} className={inputCls} />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-content-muted">Meeting Notes</span>
                    <textarea rows={2} value={editDraft.meetingNotes} onChange={(e) => setEditDraft((d) => (d ? { ...d, meetingNotes: e.target.value } : d))} className={inputCls} />
                  </label>
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-content-muted">
                        <ListChecks className="w-3 h-3" />
                        Actionables
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          setEditDraft((d) => (d ? { ...d, actionables: [...d.actionables, { key: `new-${Date.now()}`, description: "", dueDate: "", status: "Open" }] } : d))
                        }
                        className={`text-[11px] font-bold cursor-pointer ${dark ? "text-blue-300" : "text-blue-700"}`}
                      >
                        + Add
                      </button>
                    </div>
                    {editDraft.actionables.map((a) => (
                      <div key={a.key} className={`rounded-lg border p-2 space-y-1.5 ${dark ? "border-white/[0.08]" : "border-stone-150"}`}>
                        <div className="flex items-start gap-1.5">
                          <input
                            value={a.description}
                            onChange={(e) => setEditDraft((d) => (d ? { ...d, actionables: d.actionables.map((x) => (x.key === a.key ? { ...x, description: e.target.value } : x)) } : d))}
                            placeholder="Description"
                            className={inputCls + " flex-1"}
                          />
                          <button
                            type="button"
                            onClick={() => setEditDraft((d) => (d ? { ...d, actionables: d.actionables.filter((x) => x.key !== a.key) } : d))}
                            className={`cursor-pointer shrink-0 mt-1.5 ${dark ? "text-slate-400 hover:text-red-400" : "text-stone-400 hover:text-stone-500"}`}
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <input
                            type="date"
                            value={a.dueDate}
                            onChange={(e) => setEditDraft((d) => (d ? { ...d, actionables: d.actionables.map((x) => (x.key === a.key ? { ...x, dueDate: e.target.value } : x)) } : d))}
                            className={inputCls}
                          />
                          <div className="w-[118px] shrink-0">
                            <CustomSelect
                              value={a.status}
                              theme={dark ? "dark" : "light"}
                              triggerClassName={`w-full flex items-center justify-between gap-1 pl-1.5 pr-5 py-1.5 rounded border outline-none text-[10px] font-black uppercase cursor-pointer relative ${
                                dark ? "bg-[#102236] border-[#1e3e5c] text-[#eff6ff]" : "bg-white border-stone-250 text-stone-850"
                              }`}
                              options={ACTIONABLE_STATUS_OPTIONS}
                              onChange={(value) =>
                                setEditDraft((d) => (d ? { ...d, actionables: d.actionables.map((x) => (x.key === a.key ? { ...x, status: value as ActionableStatus } : x)) } : d))
                              }
                            />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                  {editError && <p className="text-[11px] text-red-500 font-semibold">{editError}</p>}
                  <div className="flex items-center justify-end gap-2 pt-1">
                    <button
                      type="button"
                      onClick={cancelEdit}
                      disabled={editSaving}
                      className={`text-[11px] font-bold uppercase tracking-wider px-2.5 py-1.5 rounded-lg cursor-pointer ${dark ? "text-slate-300 hover:bg-white/10" : "text-stone-500 hover:bg-stone-100"}`}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={() => saveEdit(s.id)}
                      disabled={editSaving}
                      className="text-[11px] font-bold uppercase tracking-wider px-2.5 py-1.5 rounded-lg cursor-pointer text-white bg-[#117FDA] hover:brightness-110 disabled:opacity-60"
                    >
                      {editSaving ? "Saving…" : "Save"}
                    </button>
                  </div>
                </li>
              ) : (
                <li key={s.id} className={`rounded-lg border p-2.5 text-[12px] ${dark ? "border-white/[0.06]" : "border-stone-100"}`}>
                  <div className="flex items-center justify-between gap-2">
                    <span className={`font-bold ${dark ? "text-white" : "text-stone-900"}`}>{s.meetingDate}</span>
                    <span className="flex items-center gap-2 shrink-0">
                      <span className={dark ? "text-slate-400" : "text-stone-500"}>{s.authorName}</span>
                      <button
                        type="button"
                        onClick={() => startEdit(s)}
                        title="Edit this entry"
                        className={`inline-flex items-center gap-1 text-[11px] font-bold cursor-pointer ${dark ? "text-blue-300 hover:text-blue-200" : "text-blue-700 hover:text-blue-800"}`}
                      >
                        <Pencil className="w-3 h-3" />
                        Edit
                      </button>
                    </span>
                  </div>
                  {s.discussionPoints && (
                    <p className="mt-1">
                      <span className="font-bold text-content-muted">Discussion: </span>
                      {s.discussionPoints}
                    </p>
                  )}
                  {s.meetingNotes && (
                    <p className="mt-1">
                      <span className="font-bold text-content-muted">Notes: </span>
                      {s.meetingNotes}
                    </p>
                  )}
                  {s.actionables.length > 0 && (
                    <div className="mt-1.5">
                      {/* Explicit "Actionable" label (Task 7 item 6) — this
                          block used to render as generic text
                          indistinguishable from Discussion/Notes above; the
                          icon + label makes clear every row under it is an
                          actionable, not more free-text commentary. */}
                      <span className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-content-muted mb-1">
                        <ListChecks className="w-3 h-3" />
                        Actionable{s.actionables.length === 1 ? "" : "s"}
                      </span>
                      <ul className="space-y-1">
                        {s.actionables.map((a) => (
                          <li key={a.id} className="flex items-center gap-2 flex-wrap">
                            <ActionableStatusChip status={a.status} dark={dark} />
                            <span className="flex-1 min-w-[120px]">{a.description}</span>
                            {a.dueDate && <span className="text-content-muted">(due {a.dueDate})</span>}
                            <ActionableStatusSelect actionableId={a.id} status={a.status} dark={dark} onChanged={(next) => setActionableStatus(s.id, a.id, next)} />
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </li>
              )
            )}
          </ul>
        )}
      </div>
    </div>
  );
}

// ── Floating Session Feedback workspace — icon-only button positioned
// above the app's pinned footer bar. New actionables always start "Open";
// status is only ever changed afterward, from Feedback Summary's own
// control (or the advisor's own read-only-view status control on the QA
// Dashboard). ────────────────────────────────────────────────────────
function SessionFeedbackWorkspace({ dark, tactId, advisorName, onSaved }: { dark: boolean; tactId: string; advisorName: string; onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<SessionFeedbackDraft>(() => loadSessionFeedbackDraft(tactId));
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [savedFlash, setSavedFlash] = useState(false);

  useEffect(() => {
    setDraft(loadSessionFeedbackDraft(tactId));
    setSaveError("");
    setSavedFlash(false);
  }, [tactId]);

  useEffect(() => {
    saveSessionFeedbackDraftToStorage(tactId, draft);
  }, [tactId, draft]);

  const addActionable = () => setDraft((d) => ({ ...d, actionables: [...d.actionables, { id: `${Date.now()}-${d.actionables.length}`, description: "", dueDate: "" }] }));
  const updateActionable = (id: string, patch: Partial<SessionFeedbackActionableDraft>) =>
    setDraft((d) => ({ ...d, actionables: d.actionables.map((a) => (a.id === id ? { ...a, ...patch } : a)) }));
  const removeActionable = (id: string) => setDraft((d) => ({ ...d, actionables: d.actionables.filter((a) => a.id !== id) }));

  const handleSave = async () => {
    if (isSessionFeedbackDraftEmpty(draft)) return;
    setSaving(true);
    setSaveError("");
    try {
      await postSessionFeedback({
        tactId,
        meetingDate: draft.meetingDate,
        discussionPoints: draft.discussionPoints,
        meetingNotes: draft.meetingNotes,
        actionables: draft.actionables.filter((a) => a.description.trim()).map((a) => ({ description: a.description.trim(), dueDate: a.dueDate || null, status: "Open" as const })),
      });
      clearSessionFeedbackDraft(tactId);
      setDraft(emptySessionFeedbackDraft());
      setSavedFlash(true);
      onSaved();
    } catch (err: any) {
      setSaveError(err.message || "Failed to save session feedback.");
    } finally {
      setSaving(false);
    }
  };

  // Plain opaque hex, not bg-white — this whole workspace floats fixed over
  // arbitrary page content (QA Feedback rows, etc.), so it must stay fully
  // opaque rather than pick up the site-wide translucent card-surface look
  // (html:not(.dark) .bg-white → var(--surface), ~55% alpha in index.css) —
  // that alpha let the list underneath visibly bleed through both the panel
  // shell and every input/textarea inside it in light mode.
  const inputCls = `w-full rounded-lg border px-2.5 py-1.5 text-[12px] outline-none ${dark ? "bg-[#102236] border-[#1e3e5c] text-[#eff6ff]" : "bg-[#ffffff] border-stone-250 text-stone-850"}`;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        // bottom-16 clears the app's own pinned footer bar.
        className="fixed bottom-16 right-5 z-40 inline-flex items-center justify-center w-11 h-11 rounded-full shadow-lg text-white cursor-pointer hover:brightness-110 transition"
        style={{ background: "#117FDA" }}
        title={`Session Feedback — ${advisorName}`}
        aria-label={`Session Feedback for ${advisorName}`}
      >
        <ClipboardList className="w-5 h-5" />
        {!isSessionFeedbackDraftEmpty(draft) && <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-amber-400" title="Unsaved draft" />}
      </button>

      {open && (
        <div
          // Plain opaque hex, not bg-white — see the inputCls comment above:
          // this panel floats fixed over arbitrary page content, so it must
          // never pick up the site-wide translucent card-surface look.
          className={`fixed bottom-[4.75rem] right-5 z-40 w-[380px] max-w-[calc(100vw-2.5rem)] max-h-[75vh] overflow-auto rounded-2xl border shadow-2xl p-4 space-y-3 ${
            dark ? "bg-[#0b1830] border-white/[0.12]" : "bg-[#ffffff] border-stone-200"
          }`}
        >
          <div className="flex items-start justify-between gap-2">
            <h3 className={`text-[13px] font-black ${dark ? "text-white" : "text-[#111827]"}`}>Session Feedback</h3>
            <button type="button" onClick={() => setOpen(false)} className={`cursor-pointer shrink-0 ${dark ? "text-slate-400 hover:text-white" : "text-stone-400 hover:text-stone-800"}`}>
              <X className="w-4 h-4" />
            </button>
          </div>

          <label className="flex flex-col gap-1">
            <span className="text-[10px] font-bold uppercase tracking-wider text-content-muted">Meeting Date</span>
            <input type="date" value={draft.meetingDate} onChange={(e) => setDraft((d) => ({ ...d, meetingDate: e.target.value }))} className={inputCls} />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-[10px] font-bold uppercase tracking-wider text-content-muted">Discussion Points</span>
            <textarea
              rows={3}
              value={draft.discussionPoints}
              onChange={(e) => setDraft((d) => ({ ...d, discussionPoints: e.target.value }))}
              className={inputCls}
              placeholder="What to bring up in this session…"
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-[10px] font-bold uppercase tracking-wider text-content-muted">Meeting Notes</span>
            <textarea
              rows={3}
              value={draft.meetingNotes}
              onChange={(e) => setDraft((d) => ({ ...d, meetingNotes: e.target.value }))}
              className={inputCls}
              placeholder="What was actually discussed…"
            />
          </label>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-wider text-content-muted">Actionables</span>
              <button type="button" onClick={addActionable} className={`text-[11px] font-bold cursor-pointer ${dark ? "text-blue-300" : "text-blue-700"}`}>
                + Add
              </button>
            </div>
            {draft.actionables.length === 0 ? (
              <p className="text-[11px] text-content-muted">No actionables yet.</p>
            ) : (
              <div className="space-y-1.5">
                {draft.actionables.map((a) => (
                  <div key={a.id} className={`rounded-lg border p-2 space-y-1.5 ${dark ? "border-white/[0.08]" : "border-stone-150"}`}>
                    <div className="flex items-start gap-1.5">
                      <input value={a.description} onChange={(e) => updateActionable(a.id, { description: e.target.value })} placeholder="Description" className={inputCls + " flex-1"} />
                      <button
                        type="button"
                        onClick={() => removeActionable(a.id)}
                        className={`cursor-pointer shrink-0 mt-1.5 ${dark ? "text-slate-400 hover:text-red-400" : "text-stone-400 hover:text-stone-500"}`}
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    {/* No status picker here — new actionables always start
                        "Open"; status is only ever changed afterward, from
                        Feedback Summary. */}
                    <input type="date" value={a.dueDate} onChange={(e) => updateActionable(a.id, { dueDate: e.target.value })} className={inputCls} />
                  </div>
                ))}
              </div>
            )}
          </div>

          {saveError && <p className="text-[11px] text-red-500 font-semibold">{saveError}</p>}
          {savedFlash && !saving && isSessionFeedbackDraftEmpty(draft) && <p className="text-[11px] text-emerald-500 font-semibold">Saved to Feedback Summary.</p>}

          {/* Shared --action-navy token (2026-09) instead of a hardcoded
              #1f2d3d, which stayed the light-theme color even in dark
              theme — see ClippedButton.tsx's variant="action" doc comment
              for the same fix applied app-wide. hover:brightness-110
              dropped in favor of an explicit hover background, which reads
              correctly in both themes (a brightness filter on this token's
              dark-theme value would lighten it unpredictably). */}
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || isSessionFeedbackDraftEmpty(draft)}
            className="w-full rounded-lg py-2 text-[13px] font-bold cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed transition bg-[var(--action-navy)] text-[var(--on-action-navy)] hover:bg-[var(--action-navy-hover)]"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      )}
    </>
  );
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
  /** Same two months as firstScore/lastScore, carrying their own label too
   * — Most Improved/Most Declined (Task item 4) shows "the months
   * considered for the comparison" per advisor, which can differ advisor to
   * advisor (one may have gaps the other doesn't), so this needs to travel
   * with each entry rather than being read off computeInsights' own single
   * team-wide month list. */
  firstScoredMonth: { monthKey: string; monthLabel: string } | null;
  lastScoredMonth: { monthKey: string; monthLabel: string } | null;
  change: number | null;
  /** True when this advisor is in the scope's CURRENT roster (context.advisors
   * — always Currently Employed only, see qaDataEngine.ts's getAllAdvisors/
   * getAdvisorsForGuide/getAdvisorsForMentor). The monthly rows themselves
   * are resolved PER PERIOD (resolvePoolAsOf in teamTrackerService.ts), so a
   * since-departed advisor still shows up here with their real historical
   * scores — this flag is what lets the UI keep those scores in every team
   * calculation while still excluding the advisor from ranking/list widgets
   * (Top 5/Bottom 5, Most Improved/Declined) that only make sense for people
   * still on the team. Defaults to true when the employed set hasn't loaded
   * yet (see buildPivots), so nothing is wrongly excluded during initial load. */
  isEmployed: boolean;
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

function buildPivots(rows: MonthlyAdvisorRow[], employedTactIds: Set<string> | null): AdvisorPivot[] {
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
    const firstScoredMonth = withScore.length ? { monthKey: withScore[0].monthKey, monthLabel: withScore[0].monthLabel } : null;
    const lastScoredMonth = withScore.length ? { monthKey: withScore[withScore.length - 1].monthKey, monthLabel: withScore[withScore.length - 1].monthLabel } : null;
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
      firstScoredMonth,
      lastScoredMonth,
      change,
      isEmployed: employedTactIds ? employedTactIds.has(tactId) : true,
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
  /** Current-month-only rankings broken out per metric (Cumulative + each
   * medium) — the ONGOING view's medium toggle (Task "Ongoing View
   * Updates" item 2) re-ranks Top Performers off of these instead of
   * always Cumulative. Empty lists across the board when currentMonth is
   * null. Selected Period's own rankings (top5Period/bottom5Period above)
   * stay Cumulative-only — only ONGOING's toggle needed a per-medium cut. */
  rankingsByMediumCurrentMonth: Record<MetricKey, { top5: RankedEntry[]; bottom5: RankedEntry[] }>;
  /** ONGOING view only (Task item 6) — replaces Bottom Performers there:
   * advisors whose current-month Lead Score or Payment QA is below 3.5
   * with enough volume to be a real pattern, not noise. */
  potentialQip: LowScoreEntry[];
  /** Every month within the loaded period that has a team Cumulative Score
   * — i.e. every month `currentMonth` could validly be pinned to via the
   * Current Month row's edit picker (see computeInsights's preferredMonthKey
   * param). Chronological, oldest first, same order the trend chart uses. */
  scoredMonths: { monthKey: string; monthLabel: string }[];
  /** Top 3, ranked (Task item 4) — mostImproved sorted by change descending
   * (best first), mostDeclined sorted by change ascending (worst first). */
  mostImproved: ImprovedEntry[];
  mostDeclined: ImprovedEntry[];
  totalMapped: number;
  changeFirstLatest: { delta: number | null; firstLabel: string | null; latestLabel: string | null };
  bestMedium: { key: MediumKey; label: string; avg: number } | null;
  weakestMedium: { key: MediumKey; label: string; avg: number } | null;
  /** Team-wide score + instances + Blunder % per medium (Lead/Payment/Chat/
   * Call), aggregated across every advisor and every month in the whole
   * loaded period — the Selected Period equivalent of `currentMonth`'s own
   * lead/payment/chat/call snapshot, just scoped to the full range instead
   * of one month. Built from each advisor's own already-computed
   * `mediumStats` (same source teamMediumAvgs/bestMedium/weakestMedium
   * above already read), not a second walk of the raw monthly rows. */
  periodMedium: Record<MediumKey, MediumStat>;
  /** Team-wide average score + instance count per month, chronological,
   * broken out per metric (Cumulative + each medium) — feeds the team
   * trend chart's metric selector (Task 3 item 3). Each month carries
   * all five metrics so switching the selector is a pure client-side
   * pick, no refetch. */
  chartData: { month: string; cumulative: MetricPoint; lead: MetricPoint; payment: MetricPoint; chat: MetricPoint; call: MetricPoint }[];
}

function computeInsights(pivots: AdvisorPivot[], months: MonthSpec[], preferredMonthKey?: string | null): TeamInsightsData {
  const scored = pivots.filter((p) => p.avgCumulative !== null);
  const teamAvg = avgArr(scored.map((p) => p.avgCumulative));
  // Ranking/list widgets (Top 5, Bottom 5, Most Improved, Most Declined)
  // only make sense for advisors still on the team — a departed advisor's
  // scores still feed every team-wide calculation above and below (teamAvg,
  // monthlyTeamAvg, periodMedium, chartData, etc. all keep using the full
  // unfiltered `pivots`), just not these callout lists.
  const rankablePivots = pivots.filter((p) => p.isEmployed);
  const { top5: top5Period, bottom5: bottom5Period } = rankEntries(rankablePivots, (p) => p.avgCumulative);
  const ranked = [...scored].sort((a, b) => b.avgCumulative! - a.avgCumulative!);
  const highest = ranked.length ? ranked[0] : null;
  const lowest = ranked.length ? ranked[ranked.length - 1] : null;

  // Top 3, ranked (Task item 4) — each entry carries its own prev/curr
  // score AND the two months they came from (firstScoredMonth/
  // lastScoredMonth), since one advisor's comparison window can differ from
  // another's if either has gaps.
  const toImprovedEntry = (p: AdvisorPivot): ImprovedEntry => ({
    tactId: p.tactId,
    name: p.name,
    change: p.change!,
    prevScore: p.firstScore!,
    prevMonthLabel: p.firstScoredMonth!.monthLabel,
    currScore: p.lastScore!,
    currMonthLabel: p.lastScoredMonth!.monthLabel,
  });
  const changeable = rankablePivots.filter((p) => p.change !== null);
  const mostImproved = changeable
    .filter((p) => p.change! > 0)
    .sort((a, b) => b.change! - a.change!)
    .slice(0, IMPROVED_LIST_SIZE)
    .map(toImprovedEntry);
  const mostDeclined = changeable
    .filter((p) => p.change! < 0)
    .sort((a, b) => a.change! - b.change!)
    .slice(0, IMPROVED_LIST_SIZE)
    .map(toImprovedEntry);

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
  // than assuming the current calendar month has data yet. `preferredMonthKey`
  // (the Current Month row's own pencil-icon picker) can pin this to any
  // other scored month instead — falls back to the latest scored month when
  // unset or when the pin no longer exists in this period's data (e.g. after
  // switching to a shorter period that no longer includes it).
  const preferredIndex = preferredMonthKey ? scoredMonths.findIndex((m) => m.monthKey === preferredMonthKey) : -1;
  const currentMonthIndex = preferredIndex >= 0 ? preferredIndex : scoredMonths.length - 1;
  const currentMonthKey = scoredMonths.length ? scoredMonths[currentMonthIndex].monthKey : null;
  // Delta vs the month immediately before whichever month is actually being
  // shown — NOT always `momentum.delta` (that's specifically latest-vs-
  // second-latest), so a pinned older month still gets an honest MoM
  // comparison against its own preceding month rather than the team's most
  // recent one.
  const currentMonthDelta =
    currentMonthKey && currentMonthIndex >= 1 && scoredMonths[currentMonthIndex].avg !== null && scoredMonths[currentMonthIndex - 1].avg !== null
      ? round2(scoredMonths[currentMonthIndex].avg! - scoredMonths[currentMonthIndex - 1].avg!)
      : null;
  const currentMonth: CurrentMonthSnapshot | null = currentMonthKey
    ? {
        monthKey: currentMonthKey,
        monthLabel: scoredMonths[currentMonthIndex].monthLabel,
        cumulative: scoredMonths[currentMonthIndex].avg,
        cumulativeDelta: currentMonthDelta,
        lead: teamMediumSnapshot(pivots, currentMonthKey, "leadScoreAvg", "leadScoreInstances", "leadScoreBlunders"),
        payment: teamMediumSnapshot(pivots, currentMonthKey, "paymentsAvg", "paymentsInstances", "paymentsBlunders"),
        chat: teamMediumSnapshot(pivots, currentMonthKey, "chatAvg", "chatInstances", "chatBlunders"),
        call: teamMediumSnapshot(pivots, currentMonthKey, "callAvg", "callInstances", "callBlunders"),
      }
    : null;
  const { top5: top5CurrentMonth, bottom5: bottom5CurrentMonth } = currentMonthKey
    ? rankEntries(rankablePivots, (p) => p.monthly[currentMonthKey]?.cumulativeScore ?? null)
    : { top5: [] as RankedEntry[], bottom5: [] as RankedEntry[] };

  // ONGOING view's medium toggle (Task item 2) — same current-month
  // ranking as top5CurrentMonth/bottom5CurrentMonth above, just broken out
  // per metric instead of Cumulative-only.
  const emptyRanking = { top5: [] as RankedEntry[], bottom5: [] as RankedEntry[] };
  const rankingsByMediumCurrentMonth: Record<MetricKey, { top5: RankedEntry[]; bottom5: RankedEntry[] }> = currentMonthKey
    ? {
        cumulative: { top5: top5CurrentMonth, bottom5: bottom5CurrentMonth },
        lead: rankEntries(rankablePivots, (p) => p.monthly[currentMonthKey]?.leadScoreAvg ?? null),
        payment: rankEntries(rankablePivots, (p) => p.monthly[currentMonthKey]?.paymentsAvg ?? null),
        chat: rankEntries(rankablePivots, (p) => p.monthly[currentMonthKey]?.chatAvg ?? null),
        call: rankEntries(rankablePivots, (p) => p.monthly[currentMonthKey]?.callAvg ?? null),
      }
    : { cumulative: emptyRanking, lead: emptyRanking, payment: emptyRanking, chat: emptyRanking, call: emptyRanking };

  const potentialQip = buildLowScoreEntries(pivots, currentMonthKey, "qip");

  const teamMediumAvgs = REAL_MEDIUM_KEYS.map((key) => ({ key, label: MEDIUM_SHORT_LABELS[key], avg: avgArr(pivots.map((p) => p.mediumStats[key].avg)) })).filter(
    (m): m is { key: MediumKey; label: string; avg: number } => m.avg !== null
  );
  const bestMedium = teamMediumAvgs.length ? teamMediumAvgs.reduce((a, b) => (b.avg > a.avg ? b : a)) : null;
  const weakestMedium = teamMediumAvgs.length ? teamMediumAvgs.reduce((a, b) => (b.avg < a.avg ? b : a)) : null;

  // Selected Period's own per-medium KPI row (score + Blunder %, team-wide)
  // — same aggregation teamMediumAvgs above already does (avgArr over every
  // advisor's own whole-period mediumStats), just also carrying
  // instances/blunders/blunderPct through buildMediumStat so the Selected
  // Period row can show Blunder % exactly like the Current Month row does.
  const periodMedium: Record<MediumKey, MediumStat> = {
    lead: buildMediumStat(pivots.map((p) => p.mediumStats.lead.avg), pivots.map((p) => p.mediumStats.lead.instances), pivots.map((p) => p.mediumStats.lead.blunders)),
    payment: buildMediumStat(pivots.map((p) => p.mediumStats.payment.avg), pivots.map((p) => p.mediumStats.payment.instances), pivots.map((p) => p.mediumStats.payment.blunders)),
    chat: buildMediumStat(pivots.map((p) => p.mediumStats.chat.avg), pivots.map((p) => p.mediumStats.chat.instances), pivots.map((p) => p.mediumStats.chat.blunders)),
    call: buildMediumStat(pivots.map((p) => p.mediumStats.call.avg), pivots.map((p) => p.mediumStats.call.instances), pivots.map((p) => p.mediumStats.call.blunders)),
  };

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
    rankingsByMediumCurrentMonth,
    potentialQip,
    scoredMonths: scoredMonths.map((m) => ({ monthKey: m.monthKey, monthLabel: m.monthLabel })),
    mostImproved,
    mostDeclined,
    totalMapped: pivots.length,
    changeFirstLatest,
    bestMedium,
    weakestMedium,
    periodMedium,
    chartData,
  };
}

// ── Mentor/Guide Selection Page (Admin only) — redesigned per the user's
// mockup: avatars (real Google photo when a directory match has one,
// otherwise colored initials) replace the plain text-only rows, the whole
// row is clickable (no more per-row "View Tracker" button — a hover state
// + trailing chevron signal it instead), rows are separated by a subtle
// divider rather than each being its own bordered box, and each card gets
// its own search box for client-side filtering. `onView` is either
// handlePickGuide or handlePickMentor, called with the clicked row's name —
// same as what the old dropdown's onChange / removed button did. ─────────

// A small fixed palette (not a full color wheel) so initials avatars stay
// legible in both themes — deliberately reuses this app's existing muted
// dark/light pairing convention (Universal Rules) rather than inventing new
// arbitrary hex pairs.
const AVATAR_PALETTE: { bg: string; text: string }[] = [
  { bg: "#206147", text: "#eafff4" }, // green (App.tsx's own single-user avatar color)
  { bg: "#1e3a8a", text: "#dbeafe" }, // navy
  { bg: "#7c2d12", text: "#fed7aa" }, // rust
  { bg: "#4c1d95", text: "#ede9fe" }, // violet
  { bg: "#854d0e", text: "#fef3c7" }, // amber
  { bg: "#155e75", text: "#cffafe" }, // teal
  { bg: "#9d174d", text: "#fce7f3" }, // rose
];
function avatarColorFor(name: string): { bg: string; text: string } {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return AVATAR_PALETTE[hash % AVATAR_PALETTE.length];
}
function PersonAvatar({ person }: { person: TeamTrackerPerson }) {
  const { bg, text } = avatarColorFor(person.name);
  return (
    <span
      className="w-8 h-8 shrink-0 rounded-full overflow-hidden flex items-center justify-center"
      style={{ backgroundColor: bg }}
    >
      {person.pictureUrl ? (
        <img src={person.pictureUrl} alt={person.name} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
      ) : (
        <span className="text-[12px] font-bold uppercase" style={{ color: text }}>
          {person.name.charAt(0)}
        </span>
      )}
    </span>
  );
}
function MentorGuideList({
  dark,
  title,
  people,
  onView,
}: {
  dark: boolean;
  title: string;
  people: TeamTrackerPerson[];
  onView: (name: string) => void;
}) {
  const [search, setSearch] = useState("");
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? people.filter((p) => p.name.toLowerCase().includes(q)) : people;
  }, [people, search]);

  return (
    <div className={`rounded-2xl overflow-hidden ${dark ? "bg-white/[0.04]" : "bg-stone-50"}`}>
      <div className={`px-4 pt-4 pb-3 space-y-2.5 ${dark ? "" : ""}`}>
        <h3 className="text-[11px] font-bold uppercase tracking-wider text-content-muted">{title}</h3>
        <div className="relative">
          <Search className={`w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none ${dark ? "text-white/40" : "text-stone-400"}`} />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={`Search ${title.toLowerCase()}...`}
            className={`w-full text-[13px] font-medium rounded-lg pl-8 pr-3 py-1.5 outline-none transition-colors ${
              dark
                ? "bg-white/[0.06] text-white placeholder:text-white/35 focus:bg-white/[0.10]"
                : "bg-white text-stone-850 placeholder:text-stone-400 border border-stone-200 focus:border-stone-350"
            }`}
          />
        </div>
      </div>
      {filtered.length === 0 ? (
        <p className="text-[13px] text-content-muted px-4 pb-4">{people.length === 0 ? "None found." : "No matches."}</p>
      ) : (
        <div className={`divide-y ${dark ? "divide-white/[0.07]" : "divide-stone-200"}`}>
          {filtered.map((person) => (
            <button
              key={person.name}
              type="button"
              onClick={() => onView(person.name)}
              className={`w-full flex items-center gap-3 px-4 py-2.5 text-left cursor-pointer transition-colors ${
                dark ? "hover:bg-white/[0.06]" : "hover:bg-white"
              }`}
            >
              <PersonAvatar person={person} />
              <span className={`flex-1 min-w-0 text-[13px] font-semibold truncate ${dark ? "text-[#eff6ff]" : "text-stone-850"}`}>{person.name}</span>
              <ChevronRight className={`w-4 h-4 shrink-0 ${dark ? "text-white/30" : "text-stone-350"}`} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Advisor search (Admin picker) — full-width, two-column card mirroring
// MentorGuideList's own look (search box, avatar, whole-row click, soft
// dividers), but laid out as two columns since the Advisor roster runs much
// longer than either the Mentor or Guide list. Picking a row here scopes
// the page to that advisor's own Guide/Mentor team (same mechanism
// handlePickGuide/handlePickMentor already use — a plain Advisor has no
// team of their own to load) and then jumps straight into that advisor's
// Performance view once the team's table finishes loading — see
// handlePickAdvisor/pendingAdvisorTactIdRef below. ───────────────────────
function AdvisorSearchSection({ dark, advisors, onView }: { dark: boolean; advisors: Advisor[]; onView: (advisor: Advisor) => void }) {
  const [search, setSearch] = useState("");
  const query = search.trim().toLowerCase();
  // Unlike MentorGuideList (which lists everyone up front), the Advisor
  // roster is far longer — Task: keep this to just a search box, with
  // results appearing only once the viewer types, rather than dumping the
  // full roster below it.
  const filtered = useMemo(() => {
    return query ? advisors.filter((a) => a.name.toLowerCase().includes(query)) : [];
  }, [advisors, query]);
  // Split top-to-bottom into two reading columns (first half left, second
  // half right) rather than interleaving — keeps each column's own
  // alphabetical order scannable instead of zig-zagging between them.
  const mid = Math.ceil(filtered.length / 2);
  const colA = filtered.slice(0, mid);
  const colB = filtered.slice(mid);

  const row = (advisor: Advisor) => (
    <button
      key={advisor.tactId}
      type="button"
      onClick={() => onView(advisor)}
      className={`w-full flex items-center gap-3 px-4 py-2.5 text-left cursor-pointer transition-colors ${dark ? "hover:bg-white/[0.06]" : "hover:bg-white"}`}
    >
      <PersonAvatar person={{ name: advisor.name, pictureUrl: null }} />
      <span className={`flex-1 min-w-0 text-[13px] font-semibold truncate ${dark ? "text-[#eff6ff]" : "text-stone-850"}`}>{advisor.name}</span>
      <ChevronRight className={`w-4 h-4 shrink-0 ${dark ? "text-white/30" : "text-stone-350"}`} />
    </button>
  );

  return (
    <div className={`rounded-2xl overflow-hidden ${dark ? "bg-white/[0.04]" : "bg-stone-50"}`}>
      <div className="px-4 pt-4 pb-3 space-y-2.5">
        <h3 className="text-[11px] font-bold uppercase tracking-wider text-content-muted">Advisors</h3>
        <div className="relative max-w-sm">
          <Search className={`w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none ${dark ? "text-white/40" : "text-stone-400"}`} />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search advisors..."
            className={`w-full text-[13px] font-medium rounded-lg pl-8 pr-3 py-1.5 outline-none transition-colors ${
              dark
                ? "bg-white/[0.06] text-white placeholder:text-white/35 focus:bg-white/[0.10]"
                : "bg-white text-stone-850 placeholder:text-stone-400 border border-stone-200 focus:border-stone-350"
            }`}
          />
        </div>
      </div>
      {query && filtered.length === 0 ? (
        <p className="text-[13px] text-content-muted px-4 pb-4">No matches.</p>
      ) : filtered.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2">
          <div className={`divide-y ${dark ? "divide-white/[0.07] md:border-r md:border-white/[0.07]" : "divide-stone-200 md:border-r md:border-stone-200"}`}>{colA.map(row)}</div>
          <div className={`divide-y ${dark ? "divide-white/[0.07]" : "divide-stone-200"}`}>{colB.map(row)}</div>
        </div>
      ) : null}
    </div>
  );
}

// ── Shared "which month" popover — a pencil-icon button next to a "Current
// Month" heading that lets the viewer pin that section to any other scored
// month in the loaded period instead of always following the actual latest
// one. Used by both CurrentMonthKpiRow (team-level) and AdvisorDetailView
// (Advisor Performance page's own Month Picker, Task 3 item 2) — pulled out
// once both needed the identical popover rather than duplicating it. ─────
function MonthPickerButton({
  dark,
  availableMonths,
  selectedMonthKey,
  onSelectMonth,
}: {
  dark: boolean;
  availableMonths: { monthKey: string; monthLabel: string }[];
  selectedMonthKey: string | null;
  onSelectMonth: (key: string | null) => void;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!pickerOpen) return;
    const handlePointerDown = (e: MouseEvent) => {
      if (!pickerRef.current?.contains(e.target as Node)) setPickerOpen(false);
    };
    document.addEventListener("mousedown", handlePointerDown as unknown as EventListener);
    return () => document.removeEventListener("mousedown", handlePointerDown as unknown as EventListener);
  }, [pickerOpen]);

  return (
    <div ref={pickerRef} className="relative">
      <button
        type="button"
        onClick={() => setPickerOpen((v) => !v)}
        title="Choose which month this section shows"
        className={`p-0.5 rounded cursor-pointer transition-colors ${
          dark ? "text-slate-500 hover:text-white hover:bg-white/[0.08]" : "text-stone-400 hover:text-stone-800 hover:bg-stone-100"
        } ${selectedMonthKey ? (dark ? "text-sky-400" : "text-sky-600") : ""}`}
      >
        <Pencil className="w-3 h-3" />
      </button>
      {pickerOpen && (
        <div
          className={`absolute z-20 top-full left-0 mt-1 w-44 max-h-64 overflow-y-auto rounded-lg border shadow-lg p-1 normal-case tracking-normal ${
            dark ? "bg-[#14181f] border-white/[0.08]" : "bg-[#ffffff] border-stone-200"
          }`}
        >
          <button
            type="button"
            onClick={() => {
              onSelectMonth(null);
              setPickerOpen(false);
            }}
            className={`w-full text-left px-2.5 py-1.5 rounded-md text-[12px] font-semibold flex items-center justify-between gap-2 cursor-pointer ${
              !selectedMonthKey
                ? dark
                  ? "bg-[#117FDA]/20 text-[#7cc2f5]"
                  : "bg-[#117FDA]/10 text-[#117FDA]"
                : dark
                  ? "hover:bg-white/[0.05] text-slate-200"
                  : "hover:bg-stone-100 text-stone-700"
            }`}
          >
            <span>Current (default)</span>
            {!selectedMonthKey && <Check className="w-3 h-3 shrink-0" />}
          </button>
          <div className={`my-1 border-t ${dark ? "border-white/[0.08]" : "border-stone-150"}`} />
          {[...availableMonths].reverse().map((m) => {
            const isSelected = m.monthKey === selectedMonthKey;
            return (
              <button
                key={m.monthKey}
                type="button"
                onClick={() => {
                  onSelectMonth(m.monthKey);
                  setPickerOpen(false);
                }}
                className={`w-full text-left px-2.5 py-1.5 rounded-md text-[12px] font-semibold flex items-center justify-between gap-2 cursor-pointer ${
                  isSelected
                    ? dark
                      ? "bg-[#117FDA]/20 text-[#7cc2f5]"
                      : "bg-[#117FDA]/10 text-[#117FDA]"
                    : dark
                      ? "hover:bg-white/[0.05] text-slate-200"
                      : "hover:bg-stone-100 text-stone-700"
                }`}
              >
                <span>{m.monthLabel}</span>
                {isSelected && <Check className="w-3 h-3 shrink-0" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
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

  // ONGOING (current month only) is the Home Page's default view (Task 2
  // item 1) — Custom's own seed range still starts from a full year back
  // so switching to Custom doesn't drop the viewer into a single month.
  const [period, setPeriod] = useState<Period>("ongoing");
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

  // Admin's Advisor search (Task 1 item 1) picks a specific advisor rather
  // than a team — there's no dedicated advisor-scoped endpoint, so this
  // reuses the exact same Guide/Mentor scoping handlePickGuide/
  // handlePickMentor already do (an advisor's own guide/mentor field), then
  // opens straight into that one advisor's Performance view once the
  // team's table finishes loading. A ref, not state — it's consumed once by
  // loadTable's own success handler below and shouldn't itself trigger a
  // re-render or become a loadTable dependency.
  const pendingAdvisorTactIdRef = useRef<string | null>(null);

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
      const pendingAdvisor = pendingAdvisorTactIdRef.current;
      pendingAdvisorTactIdRef.current = null;
      setOpenAdvisorTactId(pendingAdvisor && result.rows.some((r) => r.tactId === pendingAdvisor) ? pendingAdvisor : null);
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

  // "QA Performance" tiles/rankings for a period view — the actual-date-
  // range figure (Start/End/Till Date), a single extra call alongside
  // /table's own per-month one (see getTeamTrackerPeriodSummary's header
  // comment). Not fetched for ONGOING: a single month's /table row already
  // IS the real-date-range number, nothing to recompute.
  const [periodSummary, setPeriodSummary] = useState<TeamTrackerPeriodSummaryResult | null>(null);
  const [periodSummaryLoading, setPeriodSummaryLoading] = useState(false);
  const [periodSummaryError, setPeriodSummaryError] = useState("");
  const loadPeriodSummary = useCallback(async () => {
    if (!context || context.needsSelection) return;
    if (period === "ongoing") {
      setPeriodSummary(null);
      setPeriodSummaryError("");
      return;
    }
    setPeriodSummaryLoading(true);
    setPeriodSummaryError("");
    try {
      const { fromMonth, toMonth } = period === "custom" ? { fromMonth: customFrom, toMonth: customTo } : periodToRange(period);
      const result = await fetchJson<TeamTrackerPeriodSummaryResult>(
        `/api/qa-dashboard/team-tracker/period-summary?${qs({ guide: selectedGuide, mentor: selectedMentor, fromMonth, toMonth })}`
      );
      setPeriodSummary(result);
    } catch (err: any) {
      setPeriodSummaryError(err.message || "Failed to load this period's QA Performance.");
      setPeriodSummary(null);
    } finally {
      setPeriodSummaryLoading(false);
    }
  }, [context, period, customFrom, customTo, selectedGuide, selectedMentor]);
  useEffect(() => {
    loadPeriodSummary();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [context?.scopeLabel, period, customFrom, customTo]);

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
  const handlePickAdvisor = (advisor: Advisor) => {
    pendingAdvisorTactIdRef.current = advisor.tactId;
    if (advisor.guide) {
      setSelectedGuide(advisor.guide);
      setSelectedMentor("");
      loadContext(advisor.guide, "");
    } else if (advisor.mentor) {
      setSelectedMentor(advisor.mentor);
      setSelectedGuide("");
      loadContext("", advisor.mentor);
    } else {
      // Unmapped advisor (no Guide or Mentor on record) — nothing to scope
      // to, so there's no team table to load them from.
      pendingAdvisorTactIdRef.current = null;
    }
  };

  // ONGOING leads the list and is the default (Task 2 item 2) — every other
  // option is unchanged aside from "Last 1 Year" -> "Last Year" to match
  // the requested wording.
  const periodOptions: CustomSelectOption[] = [
    { value: "ongoing", label: "Ongoing" },
    { value: "3m", label: "Last 3 Months" },
    { value: "6m", label: "Last 6 Months" },
    { value: "1y", label: "Last Year" },
    { value: "custom", label: "Custom" },
  ];
  // context.advisors is always the CURRENT (Currently Employed only) roster
  // for this scope — see getTeamTrackerContext/resolvePool in
  // teamTrackerService.ts — unlike the monthly table rows, which are
  // resolved per period and can include since-departed advisors. null (not
  // an empty Set) until context has actually loaded, so buildPivots doesn't
  // wrongly mark everyone as not-employed during the initial load.
  const employedTactIds = useMemo(() => (context ? new Set(context.advisors.map((a) => a.tactId)) : null), [context]);
  const pivots = useMemo(() => (table ? buildPivots(table.rows, employedTactIds) : []), [table, employedTactIds]);
  // Current Month row's pencil-icon picker (Task 3 item 3) — null means "use
  // the actual latest scored month" (the pre-existing default behavior).
  // Reset whenever the underlying table reloads (new period/scope), since a
  // pin from one period's data may not exist — or may mean something
  // different — once the period changes; computeInsights also falls back to
  // the latest month on its own if the pinned key isn't found, so this is a
  // belt-and-suspenders reset rather than the only safeguard.
  const [preferredCurrentMonthKey, setPreferredCurrentMonthKey] = useState<string | null>(null);
  useEffect(() => {
    setPreferredCurrentMonthKey(null);
  }, [table]);
  const insights = useMemo(() => computeInsights(pivots, table?.months || [], preferredCurrentMonthKey), [pivots, table, preferredCurrentMonthKey]);
  const periodSummaryDerived: PeriodSummaryDerived = useMemo(
    () => ({
      filters: periodSummary?.filters ?? null,
      teamMedium: periodSummary ? teamMediumFromPeriodSummary(pivots, periodSummary.metrics) : null,
      teamCumulative: periodSummary ? teamCumulativeFromPeriodSummary(pivots, periodSummary.metrics) : null,
      // Same currently-employed-only filter as computeInsights' rankablePivots
      // — rankingsByMetric is a ranking widget (feeds Top 5/Bottom 5 in period
      // views), not a calculation; teamMedium/teamCumulative right below stay
      // on the full unfiltered `pivots` since those ARE calculations.
      rankingsByMetric: periodSummary ? rankingsByMetricFromPeriodSummary(pivots.filter((p) => p.isEmployed), periodSummary.metrics) : null,
      loading: periodSummaryLoading,
      error: periodSummaryError,
    }),
    [pivots, periodSummary, periodSummaryLoading, periodSummaryError]
  );

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

  // ── Advisor Performance page's own period control (Task 3) — fully
  // independent of the Home Page's period above, per "the page should be
  // controllable directly from itself." A second /table fetch, scoped to
  // the same Guide/Mentor team the Home Page already resolved (there's no
  // dedicated single-advisor endpoint — see handlePickAdvisor's comment
  // above), just with this page's own date range; buildPivots then picks
  // out only the one advisor being viewed. Resets to Ongoing whenever a
  // different advisor is opened, so it never silently inherits whatever
  // range was last picked for someone else.
  const [advisorPeriod, setAdvisorPeriod] = useState<Period>("ongoing");
  const [advisorCustomFrom, setAdvisorCustomFrom] = useState(() => periodToRange("1y").fromMonth);
  const [advisorCustomTo, setAdvisorCustomTo] = useState(() => periodToRange("1y").toMonth);
  const [advisorPreferredMonthKey, setAdvisorPreferredMonthKey] = useState<string | null>(null);
  useEffect(() => {
    setAdvisorPeriod("ongoing");
    setAdvisorPreferredMonthKey(null);
  }, [openAdvisorTactId]);

  const [advisorTable, setAdvisorTable] = useState<TeamTrackerTableResult | null>(null);
  const [advisorTableLoading, setAdvisorTableLoading] = useState(false);
  const [advisorTableError, setAdvisorTableError] = useState("");
  useEffect(() => {
    if (!context || context.needsSelection || !openAdvisorTactId) return;
    let cancelled = false;
    setAdvisorTableLoading(true);
    setAdvisorTableError("");
    (async () => {
      try {
        const { fromMonth, toMonth } = advisorPeriod === "custom" ? { fromMonth: advisorCustomFrom, toMonth: advisorCustomTo } : periodToRange(advisorPeriod);
        const result = await fetchJson<TeamTrackerTableResult>(
          `/api/qa-dashboard/team-tracker/table?${qs({ guide: selectedGuide, mentor: selectedMentor, fromMonth, toMonth })}`
        );
        if (!cancelled) setAdvisorTable(result);
      } catch (err: any) {
        if (!cancelled) {
          setAdvisorTableError(err.message || "Failed to load this advisor's data.");
          setAdvisorTable(null);
        }
      } finally {
        if (!cancelled) setAdvisorTableLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [context, openAdvisorTactId, advisorPeriod, advisorCustomFrom, advisorCustomTo, selectedGuide, selectedMentor]);

  // Advisor Performance page's own "QA Performance" (actual date-range)
  // figure — same idea as the Home Page's periodSummary above, just scoped
  // to this page's own independent period. Not fetched for ONGOING, same
  // reasoning as periodSummary.
  const [advisorPeriodSummary, setAdvisorPeriodSummary] = useState<TeamTrackerPeriodSummaryResult | null>(null);
  const [advisorPeriodSummaryLoading, setAdvisorPeriodSummaryLoading] = useState(false);
  useEffect(() => {
    if (!context || context.needsSelection || !openAdvisorTactId) return;
    if (advisorPeriod === "ongoing") {
      setAdvisorPeriodSummary(null);
      return;
    }
    let cancelled = false;
    setAdvisorPeriodSummaryLoading(true);
    (async () => {
      try {
        const { fromMonth, toMonth } = advisorPeriod === "custom" ? { fromMonth: advisorCustomFrom, toMonth: advisorCustomTo } : periodToRange(advisorPeriod);
        const result = await fetchJson<TeamTrackerPeriodSummaryResult>(
          `/api/qa-dashboard/team-tracker/period-summary?${qs({ guide: selectedGuide, mentor: selectedMentor, fromMonth, toMonth })}`
        );
        if (!cancelled) setAdvisorPeriodSummary(result);
      } catch {
        if (!cancelled) setAdvisorPeriodSummary(null);
      } finally {
        if (!cancelled) setAdvisorPeriodSummaryLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [context, openAdvisorTactId, advisorPeriod, advisorCustomFrom, advisorCustomTo, selectedGuide, selectedMentor]);

  const advisorPivots = useMemo(() => (advisorTable ? buildPivots(advisorTable.rows, employedTactIds) : []), [advisorTable, employedTactIds]);
  const openPivotDetail = useMemo(
    () => (openAdvisorTactId ? advisorPivots.find((p) => p.tactId === openAdvisorTactId) || null : null),
    [advisorPivots, openAdvisorTactId]
  );
  const advisorPeriodSummaryDerived: AdvisorPeriodSummaryDerived = useMemo(() => {
    const metric = advisorPeriodSummary && openAdvisorTactId ? (advisorPeriodSummary.metrics[openAdvisorTactId] ?? null) : null;
    return {
      filters: advisorPeriodSummary?.filters ?? null,
      metric,
      cumulative: metric ? avgArr([metric.leadScoreAvg, metric.paymentsAvg]) : null,
      loading: advisorPeriodSummaryLoading,
    };
  }, [advisorPeriodSummary, openAdvisorTactId, advisorPeriodSummaryLoading]);
  const openPivotDetailRows = useMemo(
    () => (openPivotDetail && advisorTable ? advisorTable.months.map((m) => openPivotDetail.monthly[m.key]).filter(Boolean) : []),
    [openPivotDetail, advisorTable]
  );
  const advisorPrevMonthKeyOf = useMemo(() => {
    const chron = advisorTable?.months || [];
    const map: Record<string, string | undefined> = {};
    chron.forEach((m, i) => {
      map[m.key] = i > 0 ? chron[i - 1].key : undefined;
    });
    return map;
  }, [advisorTable]);

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
  // A list of every available Guide/Mentor with its own "View Tracker"
  // button, NOT a dropdown (explicit request — a dropdown hides who's even
  // available until opened; a list surfaces the whole roster at a glance).
  // handlePickGuide/handlePickMentor are unchanged — same functions the old
  // dropdowns' onChange called, just now wired to a per-row button instead.
  if (context.needsSelection) {
    return (
      <div className="space-y-5 pb-6">
        <div>
          <h1 className={`text-page-title tracking-tight flex items-center gap-2 ${dark ? "text-white" : "text-[#111827]"}`}>
            <Users2 className="w-5 h-5" />
            <span>Team Tracker</span>
          </h1>
          <p className="text-[13px] mt-1 font-semibold text-content-muted">Admin view — choose a Mentor, Guide, or Advisor to see their QA performance.</p>
        </div>
        <div className="space-y-4">
          {/* Advisors search leads the page — it's the fastest path to a
              specific person (jump straight to them without first scanning
              the Mentor/Guide lists below), so it sits above them rather
              than at the bottom. */}
          <AdvisorSearchSection dark={dark} advisors={context.advisors} onView={handlePickAdvisor} />
          {/* Mentors lead the row, Guides adjacent (Task 1 item 2). */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <MentorGuideList dark={dark} title="Mentors" people={context.mentors} onView={handlePickMentor} />
            <MentorGuideList dark={dark} title="Guides" people={context.guides} onView={handlePickGuide} />
          </div>
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
                  <p className="text-[13px] mt-1 font-semibold text-content-muted">Team Tracker · {context.scopeLabel}</p>
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
              advisorTableError ? (
                <div className={`flex items-start gap-2 p-3 rounded-lg border text-[13px] font-semibold ${dark ? "bg-red-500/10 border-red-500/30 text-red-300" : "bg-red-50 border-red-200 text-red-700"}`}>
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{advisorTableError}</span>
                </div>
              ) : openPivotDetail ? (
                <AdvisorDetailView
                  dark={dark}
                  theme={theme}
                  pivot={openPivotDetail}
                  orderedRows={openPivotDetailRows}
                  prevMonthKeyOf={advisorPrevMonthKeyOf}
                  loading={advisorTableLoading}
                  period={advisorPeriod}
                  customFrom={advisorCustomFrom}
                  customTo={advisorCustomTo}
                  onChangePeriod={setAdvisorPeriod}
                  onChangeCustomFrom={setAdvisorCustomFrom}
                  onChangeCustomTo={setAdvisorCustomTo}
                  periodOptions={periodOptions}
                  preferredMonthKey={advisorPreferredMonthKey}
                  onChangePreferredMonthKey={setAdvisorPreferredMonthKey}
                  periodSummary={advisorPeriodSummaryDerived}
                />
              ) : (
                <div className={`rounded-xl border p-4 text-[13px] font-semibold text-content-muted ${dark ? "bg-white/[0.03] border-white/[0.08]" : "bg-white border-[var(--border)]"}`}>
                  {advisorTableLoading ? "Loading…" : "No data for this advisor in the selected period."}
                </div>
              )
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
            {/* Title sits where the old "<scope> · Change" line used to be —
                see this file's header comment. The Period control used to
                live directly under the title; it now sits on the "Current
                Month" heading row instead (see TeamInsights' periodControl
                prop below), so it's built here — where its state already
                lives — and just handed down rather than rendered here. */}
            <div className="flex flex-wrap items-start justify-between gap-3">
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
                {tableLoading && (
                  <span className="mt-1.5 flex items-center gap-1 text-[11px] font-bold uppercase tracking-wider text-content-muted">
                    <RefreshCw className="w-3 h-3 animate-spin" />
                    Loading…
                  </span>
                )}
              </div>
              {/* Total Mapped Advisors — a plain info line, not a card (Task
                  4): it's headcount context for the page, not a metric to
                  analyze alongside score/performance cards, so it sits with
                  the page's other top-level chrome instead of competing for
                  space in the Current Month / Selected Period analysis
                  grids it used to occupy a slot in. */}
              <div className="text-right shrink-0">
                <span className="block text-[10px] font-bold uppercase tracking-wider text-content-muted">Total Mapped Advisors</span>
                <span className={`text-lg font-black ${dark ? "text-white" : "text-stone-900"}`}>{insights.totalMapped}</span>
              </div>
            </div>

            {tableError ? (
              <div className={`flex items-start gap-2 p-3 rounded-lg border text-[13px] font-semibold ${dark ? "bg-red-500/10 border-red-500/30 text-red-300" : "bg-red-50 border-red-200 text-red-700"}`}>
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{tableError}</span>
              </div>
            ) : (
              <>
                <TeamInsights
                  dark={dark}
                  theme={theme}
                  insights={insights}
                  onOpenAdvisor={openAdvisor}
                  period={period}
                  preferredCurrentMonthKey={preferredCurrentMonthKey}
                  onChangePreferredCurrentMonthKey={setPreferredCurrentMonthKey}
                  periodControl={
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
                  }
                  periodSummary={periodSummaryDerived}
                />
                <TeamPivotTable
                  dark={dark}
                  pivots={pivots}
                  months={displayMonths}
                  prevMonthKeyOf={prevMonthKeyOf}
                  loading={tableLoading}
                  period={period}
                  onOpenAdvisor={openAdvisor}
                  cellClass={cellClass}
                  headClass={headClass}
                  currentMonth={insights.currentMonth}
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
  // Plot the piecewise-transformed score (see SCORE_SCALE_BREAK's comment)
  // as its own field — the real score is kept alongside on the same datum
  // for the tooltip and the 3.5 reference line's label to read from,
  // untransformed.
  const chartData = data.map((d) => ({ ...d, visualScore: d.score === null ? null : scoreToVisual(d.score) }));
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={chartData} margin={{ top: 8, right: hasInstances ? 8 : 16, left: -12, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={theme === "dark" ? "#1F2937" : "#E5E7EB"} />
        <XAxis dataKey="month" stroke={theme === "dark" ? "#9CA3AF" : "#4B5563"} fontSize={11} tickLine={false} />
        <YAxis
          yAxisId="score"
          domain={[0, SCORE_SCALE_MAX_VIRTUAL]}
          ticks={SCORE_SCALE_VISUAL_TICKS}
          tickFormatter={formatScoreScaleTick}
          stroke={theme === "dark" ? "#9CA3AF" : "#4B5563"}
          fontSize={11}
          tickLine={false}
          width={30}
        />
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
                      {p.dataKey === "visualScore" ? `${scoreLabel}: ` : "Instances: "}
                      {p.dataKey === "visualScore" ? ((p.payload as { score: number | null }).score ?? "NA") : (p.value ?? "NA")}
                    </p>
                  ))}
                </div>
              );
            }
            return null;
          }}
        />
        {hasInstances && <Legend wrapperStyle={{ fontSize: 11, fontWeight: 700 }} />}
        {/* Performance threshold — a flat reference at 3.5 so a score's
            position relative to the bar is legible at a glance, not just its
            month-over-month direction. Fixed regardless of which metric is
            selected: every MetricKey plots on the same 0–5 score scale. */}
        <ReferenceLine
          yAxisId="score"
          y={scoreToVisual(3.5)}
          stroke="#EF4444"
          strokeOpacity={0.45}
          strokeWidth={1}
          strokeDasharray="4 4"
          ifOverflow="extendDomain"
          label={{ value: "3.5", position: "insideTopRight", fill: "#EF4444", fillOpacity: 0.6, fontSize: 9, fontWeight: 600 }}
        />
        <Line yAxisId="score" type="monotone" dataKey="visualScore" name={scoreLabel} stroke="#117FDA" strokeWidth={2} dot={{ r: 3 }} connectNulls />
        {hasInstances && <Line yAxisId="instances" type="monotone" dataKey="instances" name="QA Instances" stroke="#9CA3AF" strokeWidth={1.5} strokeDasharray="4 3" dot={{ r: 2 }} />}
      </LineChart>
    </ResponsiveContainer>
  );
}

// ── ONGOING's Trend replacement (Task 2 item 5) — a single scored month has
// no month-over-month direction to plot, so instead of an empty/flat line
// chart this compares that one month's medium scores as horizontal bars on
// the shared piecewise score scale (axes reversed from a typical chart:
// scores run along X, mediums list down Y). Only two rows — Payment QA and
// Lead Score — carry their own full-width "main" bar; Chat QA and Call QA
// aren't listed as their own rows at all. Instead they ride inside the Lead
// Score row as thinner "sibling" bars, because Lead Score IS those two
// scores (the per-chat-id minimum of that chat's own Chat/Call scores — see
// teamTrackerService.ts) — the chart shows what composes it rather than
// listing it next to its own inputs as if they were independent. ─────────
// Hand-built with plain divs rather than Recharts — Recharts' automatic
// category-band layout couples several spacings together (the gap between
// Payment/Lead Score, the gap between the 3 stacked bars within Lead Score,
// and the gap below the last bar all move as a side effect of one another),
// which made it impossible to tune each one independently to spec. Flexbox
// gaps give each of those spacings its own exact, independent pixel value.
const MEDIUM_CHART_MAIN_BAR = 32;
const MEDIUM_CHART_SIDE_BAR = 13;
const MEDIUM_CHART_SIDE_BAR_GAP = 1; // Lead/Chat/Call bars within the Lead Score group
const MEDIUM_CHART_SECTION_GAP = 16; // Payment section -> Lead Score section
const MEDIUM_CHART_AXIS_BREATHING_ROOM = 14; // bottom of Call QA bar -> x-axis line
const MEDIUM_CHART_LABEL_COL_WIDTH = 64;
function CurrentMonthMediumChart({ dark, currentMonth }: { dark: boolean; currentMonth: CurrentMonthSnapshot | null }) {
  const hasData = currentMonth && (currentMonth.payment.avg !== null || currentMonth.lead.avg !== null || currentMonth.chat.avg !== null || currentMonth.call.avg !== null);
  if (!hasData) {
    return <div className="flex-1 flex items-center justify-center py-10 text-[13px] text-content-muted">Not enough scored data yet.</div>;
  }
  const axisColor = dark ? "#9CA3AF" : "#4B5563";
  const gridColor = dark ? "#1F2937" : "#E5E7EB";
  const pct = (v: number | null) => (v === null ? 0 : (scoreToVisual(v) / SCORE_SCALE_MAX_VIRTUAL) * 100);
  const tooltipOf = (label: string, v: number | null, instances: number) => (v === null ? `${label}: NA` : `${label}: ${v} · ${instances} instance${instances === 1 ? "" : "s"}`);
  const barAreaHeight =
    MEDIUM_CHART_MAIN_BAR + MEDIUM_CHART_SECTION_GAP + MEDIUM_CHART_MAIN_BAR + 2 * MEDIUM_CHART_SIDE_BAR_GAP + 2 * MEDIUM_CHART_SIDE_BAR + MEDIUM_CHART_AXIS_BREATHING_ROOM;
  return (
    <div className="w-full font-sans text-[11px] font-bold">
      {/* Legend gets its own row above the plot (top-right) instead of
          sitting below it — it can never overlap a bar this way, however
          long that bar gets. */}
      <div className="flex items-center justify-end gap-3 pb-2">
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: MEDIUM_CHART_COLORS.chat }} />
          <span className={dark ? "text-slate-400" : "text-stone-500"}>Chat QA</span>
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: MEDIUM_CHART_COLORS.call }} />
          <span className={dark ? "text-slate-400" : "text-stone-500"}>Call QA</span>
        </span>
      </div>
      <div className="flex">
        {/* Category label column */}
        <div className="shrink-0 flex flex-col" style={{ width: MEDIUM_CHART_LABEL_COL_WIDTH }}>
          <div className={`flex items-center justify-end text-right pr-2 ${dark ? "text-slate-300" : "text-stone-600"}`} style={{ height: MEDIUM_CHART_MAIN_BAR }}>
            Payment
          </div>
          <div style={{ height: MEDIUM_CHART_SECTION_GAP }} />
          <div
            className={`flex items-center justify-end text-right pr-2 leading-tight ${dark ? "text-slate-300" : "text-stone-600"}`}
            style={{ height: 2 * MEDIUM_CHART_SIDE_BAR_GAP + MEDIUM_CHART_MAIN_BAR + 2 * MEDIUM_CHART_SIDE_BAR }}
          >
            Lead Score
          </div>
        </div>
        {/* Plot area */}
        <div className="relative flex-1 min-w-0 pr-4">
          {/* Vertical gridlines span the bar area only — not the axis's own
              tick-label row below it. The 3.5 line (LOW_SCORE_BENCHMARK, the
              same minimum-score threshold ScoreTrendChart marks with a red
              ReferenceLine) gets that same muted red instead of the neutral
              grid color — enough to read as "the" threshold line at a
              glance, kept subtle (same low opacity, no thicker/solid
              treatment) so it doesn't compete with the bars themselves. */}
          <div className="absolute inset-x-0 top-0 pointer-events-none" style={{ height: barAreaHeight }}>
            {SCORE_SCALE_VISUAL_TICKS.map((v) => {
              const isThreshold = Math.abs(v - scoreToVisual(LOW_SCORE_BENCHMARK)) < 0.001;
              return (
                <div
                  key={v}
                  className="absolute top-0 bottom-0 border-l border-dashed"
                  style={{ left: `${(v / SCORE_SCALE_MAX_VIRTUAL) * 100}%`, borderColor: isThreshold ? "#EF4444" : gridColor, opacity: isThreshold ? 0.45 : 1 }}
                />
              );
            })}
          </div>
          {/* Payment */}
          <div className="flex items-center" style={{ height: MEDIUM_CHART_MAIN_BAR }}>
            {currentMonth.payment.avg !== null && (
              <div
                className="rounded-r h-full"
                style={{ width: `${pct(currentMonth.payment.avg)}%`, backgroundColor: MEDIUM_CHART_COLORS.payment }}
                title={tooltipOf("Payment", currentMonth.payment.avg, currentMonth.payment.instances)}
              />
            )}
          </div>
          {/* Deliberate section break before Lead Score */}
          <div style={{ height: MEDIUM_CHART_SECTION_GAP }} />
          {/* Lead Score group — Lead/Chat/Call each with their own thin,
              subtle gap so the three bars read as distinct, not merged. */}
          <div className="flex flex-col" style={{ gap: MEDIUM_CHART_SIDE_BAR_GAP }}>
            <div style={{ height: MEDIUM_CHART_MAIN_BAR }}>
              {currentMonth.lead.avg !== null && (
                <div
                  className="rounded-r h-full"
                  style={{ width: `${pct(currentMonth.lead.avg)}%`, backgroundColor: MEDIUM_CHART_COLORS.lead }}
                  title={tooltipOf("Lead Score", currentMonth.lead.avg, currentMonth.lead.instances)}
                />
              )}
            </div>
            <div style={{ height: MEDIUM_CHART_SIDE_BAR }}>
              {currentMonth.chat.avg !== null && (
                <div
                  className="rounded-r h-full"
                  style={{ width: `${pct(currentMonth.chat.avg)}%`, backgroundColor: MEDIUM_CHART_COLORS.chat }}
                  title={tooltipOf("Chat QA", currentMonth.chat.avg, currentMonth.chat.instances)}
                />
              )}
            </div>
            <div style={{ height: MEDIUM_CHART_SIDE_BAR }}>
              {currentMonth.call.avg !== null && (
                <div
                  className="rounded-r h-full"
                  style={{ width: `${pct(currentMonth.call.avg)}%`, backgroundColor: MEDIUM_CHART_COLORS.call }}
                  title={tooltipOf("Call QA", currentMonth.call.avg, currentMonth.call.instances)}
                />
              )}
            </div>
          </div>
          {/* Breathing room between the lowest bar (Call QA) and the axis */}
          <div style={{ height: MEDIUM_CHART_AXIS_BREATHING_ROOM }} />
          <div className="border-t" style={{ borderColor: axisColor }} />
          {/* Tick labels — tight, minimal padding below (Task: less wasted
              space below the axis). */}
          <div className="relative" style={{ height: 16 }}>
            {SCORE_SCALE_VISUAL_TICKS.map((v, i) => {
              const leftPct = (v / SCORE_SCALE_MAX_VIRTUAL) * 100;
              return (
                <span
                  key={v}
                  className="absolute top-0.5"
                  style={{
                    left: `${leftPct}%`,
                    color: axisColor,
                    transform: i === 0 ? "translateX(0)" : leftPct >= 99 ? "translateX(-100%)" : "translateX(-50%)",
                  }}
                >
                  {formatScoreScaleTick(v)}
                </span>
              );
            })}
          </div>
        </div>
      </div>
    </div>
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
  availableMonths,
  selectedMonthKey,
  onSelectMonth,
  periodControl,
}: {
  dark: boolean;
  monthLabel: string | null;
  cumulative: number | null;
  cumulativeDelta: number | null;
  lead: MediumStat;
  payment: MediumStat;
  chat: MediumStat;
  call: MediumStat;
  /** Passing these three together turns on the pencil-icon month picker
   * (Task 3 item 3) — omitted everywhere except the team-level Current
   * Month row, so the per-advisor pages' own CurrentMonthKpiRow usages are
   * unaffected. `selectedMonthKey` null means "the actual latest scored
   * month" (the default); a non-null value pins the row to that month
   * instead, until reset. */
  availableMonths?: { monthKey: string; monthLabel: string }[];
  selectedMonthKey?: string | null;
  onSelectMonth?: (key: string | null) => void;
  /** Rendered at the right end of this row, same line as the "Current
   * Month" heading — only passed at the team-level call site. */
  periodControl?: ReactNode;
}) {
  const card = `rounded-xl border p-3 flex flex-col gap-1 ${dark ? "bg-white/[0.03] border-white/[0.08]" : "bg-white border-[var(--border)]"}`;
  const label = "text-[10px] font-bold uppercase tracking-wider text-content-muted";
  const editable = !!(availableMonths && onSelectMonth);

  if (!monthLabel) {
    return (
      <div className="space-y-2">
        {periodControl && <div className="flex justify-end">{periodControl}</div>}
        <div className={`rounded-xl border p-4 text-[13px] font-semibold text-content-muted ${dark ? "bg-white/[0.03] border-white/[0.08]" : "bg-white border-[var(--border)]"}`}>
          No scored months in the selected period yet.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className={`flex items-center gap-1.5 text-[11px] font-black uppercase tracking-wider ${dark ? "text-white" : "text-[#111827]"}`}>
          <span>QA Performance</span>
          <span className={`font-semibold normal-case tracking-normal ${dark ? "text-slate-400" : "text-stone-500"}`}>· {monthLabel}</span>
          {editable && (
            <MonthPickerButton dark={dark} availableMonths={availableMonths!} selectedMonthKey={selectedMonthKey ?? null} onSelectMonth={onSelectMonth!} />
          )}
        </div>
        {periodControl}
      </div>
      {/* Lead Score and Payment QA lead the row as the team's key KPIs
          (Task 4 item 4) — Cumulative Score, their own composite, now
          follows in third position rather than heading the row. Each one's
          highlight now borrows its own medium's established brand color
          (indigo for Lead, teal for Payment — same colors the trend chart
          and Potential QIP capsules already use for these two mediums)
          instead of a shared pale "sky" tint that read as barely-there in
          both themes. */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <MediumKpiCard dark={dark} label="Lead Score" icon={MEDIUM_ICONS.lead} stat={lead} highlight accent="lead" />
        <MediumKpiCard dark={dark} label="Payment QA" icon={MEDIUM_ICONS.payment} stat={payment} highlight accent="payment" />
        <div className={card}>
          <span className={`flex items-center gap-1 ${label}`}>
            {CUMULATIVE_ICON}
            Cumulative Score
          </span>
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
        <MediumKpiCard dark={dark} label="Chat QA" icon={MEDIUM_ICONS.chat} stat={chat} />
        <MediumKpiCard dark={dark} label="Call QA" icon={MEDIUM_ICONS.call} stat={call} />
      </div>
    </div>
  );
}
// Universal Rules: "Blunder % should be given significant visual
// importance in the Current Month score cards" + "font size comparable to
// the QA score, but slightly smaller" — Blunder % now sits side by side
// with the score at text-xl (vs the score's text-2xl), each with its own
// label, instead of being a small 11px afterthought sharing a line with
// the instance count. Instance count moved under the score, in the same
// muted secondary-text treatment ("Evaluation counts: Muted blue/grey")
// this page already uses everywhere else via text-content-muted.
/** `highlight` marks a card as one of the team's key KPIs (Task 4 item 4 —
 * Lead Score and Payment QA on the Home Page's Current Month row), both
 * sharing the same teal tint (explicit request — one consistent "key KPI"
 * color rather than a different accent per medium) instead of the earlier
 * pale "sky" tint, which read as visually flat/no-op against this page's
 * own light-blue-gray background in light mode and was barely legible in
 * dark mode too. No badge — the color shift against the plain Chat/Call
 * cards is the signal on its own. The score/instance/blunder figures
 * themselves are untouched — only the card's own framing changes. */
// Light mode uses a bluish tint here (dark mode keeps the greenish teal) —
// the pale teal read as too close to this page's own light-blue-gray
// background to register as a highlight, whereas blue holds better contrast
// against it.
const KPI_ACCENT_CLASSES: Record<"lead" | "payment", { cardLight: string; cardDark: string; textLight: string; textDark: string }> = {
  lead: { cardLight: "bg-blue-50 border-blue-200", cardDark: "bg-teal-500/[0.12] border-teal-400/40", textLight: "text-blue-700", textDark: "text-teal-300" },
  payment: { cardLight: "bg-blue-50 border-blue-200", cardDark: "bg-teal-500/[0.12] border-teal-400/40", textLight: "text-blue-700", textDark: "text-teal-300" },
};
function MediumKpiCard({
  dark,
  label,
  icon,
  stat,
  highlight = false,
  accent,
}: {
  dark: boolean;
  label: string;
  icon: ReactNode;
  stat: MediumStat;
  highlight?: boolean;
  accent?: "lead" | "payment";
}) {
  const accentClasses = accent ? KPI_ACCENT_CLASSES[accent] : KPI_ACCENT_CLASSES.lead;
  const card = `rounded-xl border p-3 flex flex-col gap-1.5 ${
    highlight ? (dark ? accentClasses.cardDark : accentClasses.cardLight) : dark ? "bg-white/[0.03] border-white/[0.08]" : "bg-white border-[var(--border)]"
  }`;
  return (
    <div className={card}>
      <span className="flex items-center gap-1">
        <span className={`flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider ${highlight ? (dark ? accentClasses.textDark : accentClasses.textLight) : "text-content-muted"}`}>
          {icon}
          {label}
        </span>
      </span>
      <div className="flex items-end justify-between gap-2">
        <div className="flex flex-col gap-0.5 min-w-0">
          <span className={`text-2xl font-black leading-none ${scoreTextClass(stat.avg, dark)}`}>{stat.avg ?? "—"}</span>
          <span className="text-[10px] font-semibold text-content-muted truncate">
            {stat.instances} instance{stat.instances === 1 ? "" : "s"}
          </span>
        </div>
        <div className="flex flex-col gap-0.5 items-end shrink-0">
          <span className={`text-xl font-black leading-none ${blunderTextClass(stat.blunderPct, dark)}`}>{stat.blunderPct === null ? "—" : `${stat.blunderPct}%`}</span>
          <span className="text-[9px] font-bold uppercase tracking-wider text-content-muted">Blunder</span>
        </div>
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

const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Years offered by the Custom range's Year selects — recent-first (current
 * year down to 5 years back) since that covers this app's entire QA-data
 * history with room to spare, and puts the years advisors actually pick
 * within one scroll instead of buried under a decade of unused past years. */
function customRangeYears(): number[] {
  const currentYear = new Date().getFullYear();
  return Array.from({ length: 6 }, (_, i) => currentYear - i);
}

/** A single "YYYY-MM" value as two plain `<select>`s (Month, Year) instead
 * of a native `<input type="month">`. Replaces the prior month-input-in-a-
 * floating-panel design (see git history) — that combination had two
 * compounding, hard-to-fully-fix problems: Chromium clips a month input's
 * own displayed value once its rendered box drops below ~90-100px (showing
 * "025" instead of "2025"), and the floating panel hosting it needed its
 * pixel width estimated ahead of the browser's own layout pass, which kept
 * going stale on state changes. Two `<select>`s have neither problem — an
 * option list a couple of characters wide can't clip, and being plain
 * in-flow elements (not portalled/floating), they size themselves exactly
 * once and never need a manual re-layout. */
function MonthYearSelect({
  value,
  onChange,
  dark,
  ariaLabel,
}: {
  value: string; // "YYYY-MM"
  onChange: (v: string) => void;
  dark: boolean;
  ariaLabel: string;
}) {
  const [yearStr, monthStr] = value.split("-");
  const month = Number(monthStr) || new Date().getMonth() + 1;
  const year = Number(yearStr) || new Date().getFullYear();
  const selectCls = `rounded-md border pl-1.5 pr-1 py-[3px] text-[10.5px] font-semibold outline-none cursor-pointer appearance-none ${
    dark ? "bg-[#102236] border-[#1e3e5c] text-[#eff6ff]" : "bg-[#ffffff] border-stone-250 text-stone-850"
  }`;
  return (
    <div className="flex items-center gap-0.5">
      <select value={month} onChange={(e) => onChange(`${year}-${pad(Number(e.target.value))}`)} className={selectCls} aria-label={`${ariaLabel} — month`}>
        {MONTH_ABBR.map((m, i) => (
          <option key={m} value={i + 1}>
            {m}
          </option>
        ))}
      </select>
      <select value={year} onChange={(e) => onChange(`${e.target.value}-${pad(month)}`)} className={selectCls} aria-label={`${ariaLabel} — year`}>
        {customRangeYears().map((y) => (
          <option key={y} value={y}>
            {y}
          </option>
        ))}
      </select>
    </div>
  );
}

// ── Period control — an inline segmented toggle (3M / 6M / 1Y / Custom)
// instead of the prior dropdown-with-a-floating-panel design. No open/
// closed state, no positioning math, nothing to portal: every preset is a
// button always on screen, and picking "Custom" just reveals two
// MonthYearSelect pairs in the same flow — normal document layout, so nine
// out of ten of the previous design's clipping/stale-size/panel-not-
// closing complaints (see git history) simply don't have anywhere to
// happen anymore. ───────────────────────────────────────────────────────
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

  // Keep the range non-inverted from either end — picking a "From" past the
  // current "To" (or vice versa) pulls the other end along instead of
  // silently producing an empty/reversed range.
  const handleFromChange = (v: string) => {
    onChangeCustomFrom(v);
    if (v > customTo) onChangeCustomTo(v);
  };
  const handleToChange = (v: string) => {
    onChangeCustomTo(v);
    if (v < customFrom) onChangeCustomFrom(v);
  };

  return (
    <div className="flex flex-wrap items-center gap-1 text-[10.5px]">
      <div className={`inline-flex flex-wrap items-center rounded-md border p-0.5 gap-0.5 ${dark ? "bg-white/[0.04] border-white/[0.10]" : "bg-stone-100 border-stone-200"}`}>
        <Calendar className={`w-3 h-3 shrink-0 ml-1 mr-0.5 ${dark ? "text-slate-400" : "text-stone-400"}`} />
        {options.map((opt) => {
          const isSelected = opt.value === period;
          return (
            <button
              key={opt.value}
              type="button"
              aria-pressed={isSelected}
              onClick={() => onChangePeriod(opt.value as Period)}
              className={`px-1.5 py-[3px] rounded text-[10px] font-bold uppercase tracking-wide cursor-pointer transition-colors ${
                isSelected ? "bg-[#117FDA] text-white" : dark ? "text-slate-300 hover:text-white" : "text-stone-500 hover:text-stone-800"
              }`}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
      {period === "custom" && (
        <div className="flex flex-wrap items-center gap-1">
          <MonthYearSelect value={customFrom} onChange={handleFromChange} dark={dark} ariaLabel="Custom range start" />
          <span className={`text-[10px] font-semibold ${dark ? "text-slate-400" : "text-stone-500"}`}>to</span>
          <MonthYearSelect value={customTo} onChange={handleToChange} dark={dark} ariaLabel="Custom range end" />
        </div>
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
  period,
  preferredCurrentMonthKey,
  onChangePreferredCurrentMonthKey,
  periodControl,
  periodSummary,
}: {
  dark: boolean;
  theme: "light" | "dark";
  insights: TeamInsightsData;
  onOpenAdvisor: (tactId: string) => void;
  /** Drives the Trend card's ONGOING swap (Task 2 item 5) — a single-month
   * period has nothing to trend, so it's replaced with a same-month
   * per-medium comparison instead. */
  period: Period;
  preferredCurrentMonthKey: string | null;
  onChangePreferredCurrentMonthKey: (key: string | null) => void;
  /** Rendered on the "Current Month" heading row, right side — moved here
   * (previously sat directly under the page title) so it lives on the same
   * line as the section it actually controls. Only ever passed at this,
   * the team-level, call site — CurrentMonthKpiRow's other (per-advisor)
   * call sites don't pass it, so they're unaffected. */
  periodControl?: ReactNode;
  /** Period view's own actual-date-range QA Performance data — see
   * getTeamTrackerPeriodSummary. Unused/ignored while period === "ongoing". */
  periodSummary: PeriodSummaryDerived;
}) {
  // ONGOING's own Top Performers filter (Ongoing View Updates item 2) — a
  // medium toggle, since ONGOING has no "Selected Period" distinct from
  // "Current Month" to switch between. Independent of periodMetric below,
  // which drives every OTHER period's Trend chart + ranking instead.
  const [rankMetric, setRankMetric] = useState<MetricKey>("cumulative");
  // Single shared control for every non-ONGOING period (Task item 3) —
  // used to be two separate toggles (a Current Month/Selected Period mode
  // switch above Top 5, and this page's own Cumulative/Lead/Payment/Chat/
  // Call selector inside the Trend card). The mode switch is gone entirely
  // — a period view only ever ranks by the whole period now, matching
  // "no current-month info in a period view" (item 1) — and this one
  // selector, repositioned onto the shared "Trend & Rankings" header, now
  // drives BOTH the Trend line AND which metric Top 5/Bottom 5 rank by.
  const [periodMetric, setPeriodMetric] = useState<MetricKey>("cumulative");
  // Client-side pick of the selected metric out of each month's full
  // MetricPoint set (see TeamInsightsData.chartData's comment) — no
  // refetch when the selector changes.
  const chartSeriesData = insights.chartData.map((d) => ({ month: d.month, score: d[periodMetric].score, instances: d[periodMetric].instances }));
  const hasChartData = chartSeriesData.filter((d) => d.score !== null).length > 1;
  const rankedTop3 = period === "ongoing" ? insights.rankingsByMediumCurrentMonth[rankMetric].top5 : (periodSummary.rankingsByMetric?.[periodMetric].top5 ?? []);
  const rankedBottom3 = period === "ongoing" ? insights.rankingsByMediumCurrentMonth[rankMetric].bottom5 : (periodSummary.rankingsByMetric?.[periodMetric].bottom5 ?? []);
  // Selected Period's own date range, for that same "· context" treatment
  // — derived from chartData (already one point per month in the whole
  // loaded range, unfiltered by whether a month has scores yet), not a new
  // calculation. Falls back to "—" only when nothing has loaded at all.
  const selectedPeriodRangeLabel = insights.chartData.length
    ? insights.chartData[0].month === insights.chartData[insights.chartData.length - 1].month
      ? insights.chartData[0].month
      : `${insights.chartData[0].month} – ${insights.chartData[insights.chartData.length - 1].month}`
    : "—";

  return (
    <div className="space-y-3">
      {period === "ongoing" ? (
        <CurrentMonthKpiRow
          dark={dark}
          monthLabel={insights.currentMonth?.monthLabel ?? null}
          cumulative={insights.currentMonth?.cumulative ?? null}
          cumulativeDelta={insights.currentMonth?.cumulativeDelta ?? null}
          lead={insights.currentMonth?.lead ?? EMPTY_MEDIUM_STAT}
          payment={insights.currentMonth?.payment ?? EMPTY_MEDIUM_STAT}
          chat={insights.currentMonth?.chat ?? EMPTY_MEDIUM_STAT}
          call={insights.currentMonth?.call ?? EMPTY_MEDIUM_STAT}
          availableMonths={insights.scoredMonths}
          selectedMonthKey={preferredCurrentMonthKey}
          onSelectMonth={onChangePreferredCurrentMonthKey}
          periodControl={periodControl}
        />
      ) : (
        // No current-month info in a period view (Task item 1) — Period
        // Filter still needs a home since it isn't riding CurrentMonthKpiRow's
        // heading row here, so it gets its own row above. QA Performance's
        // own tiles below are the actual-date-range figures (Task item 2:
        // Start/End/Till Date, same line as the title, right-aligned+muted),
        // not an average of this period's monthly averages.
        <div className="space-y-2">
          <div className="flex justify-end">{periodControl}</div>
          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className={`flex items-center gap-1.5 text-[11px] font-black uppercase tracking-wider ${dark ? "text-white" : "text-[#111827]"}`}>
                <span>QA Performance</span>
                <span className={`font-semibold normal-case tracking-normal ${dark ? "text-slate-400" : "text-stone-500"}`}>· {selectedPeriodRangeLabel}</span>
              </div>
              {periodSummary.filters && (
                <span className={`text-[10px] font-semibold normal-case tracking-normal text-right ${dark ? "text-slate-500" : "text-stone-400"}`}>
                  Start: {fmtDisplayDate(periodSummary.filters.checkedFrom)} · End: {fmtDisplayDate(periodSummary.filters.checkedTo)} · Till: {fmtDisplayDate(periodSummary.filters.tillDate)}
                </span>
              )}
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
              <MediumKpiCard dark={dark} label="Lead Score" icon={MEDIUM_ICONS.lead} stat={periodSummary.teamMedium?.lead ?? EMPTY_MEDIUM_STAT} highlight accent="lead" />
              <MediumKpiCard dark={dark} label="Payment QA" icon={MEDIUM_ICONS.payment} stat={periodSummary.teamMedium?.payment ?? EMPTY_MEDIUM_STAT} highlight accent="payment" />
              {/* Cumulative Score now appears in period views too (Task: "Add
                  the Cumulative Score card to the period views"), same third
                  position as the ONGOING row above — team-level average of
                  each advisor's own Lead+Payment composite over the actual
                  date range (teamCumulativeFromPeriodSummary), not a MoM
                  comparison, so there's no delta line here the way ONGOING's
                  card has one. */}
              <div className={`rounded-xl border p-3 flex flex-col gap-1 ${dark ? "bg-white/[0.03] border-white/[0.08]" : "bg-white border-[var(--border)]"}`}>
                <span className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-content-muted">
                  {CUMULATIVE_ICON}
                  Cumulative Score
                </span>
                <span className={`text-2xl font-black ${scoreTextClass(periodSummary.teamCumulative, dark)}`}>{periodSummary.teamCumulative ?? "—"}</span>
                <span className="text-[10px] font-semibold text-content-faint">Lead Score + Payment Score</span>
              </div>
              <MediumKpiCard dark={dark} label="Chat QA" icon={MEDIUM_ICONS.chat} stat={periodSummary.teamMedium?.chat ?? EMPTY_MEDIUM_STAT} />
              <MediumKpiCard dark={dark} label="Call QA" icon={MEDIUM_ICONS.call} stat={periodSummary.teamMedium?.call ?? EMPTY_MEDIUM_STAT} />
            </div>
          </div>
        </div>
      )}

      {/* Trend & Rankings — chart, Top 5, and Bottom 5 all in one row, as
          before (explicit revert request: a prior redesign split this into
          a separate "Historical Performance" section — trend chart plus
          four historical per-medium tiles — stacked above a separate
          "Rankings" section, but that redesign was meant for elsewhere and
          got applied to this main team page by mistake. The four historical
          medium tiles never belonged on this page pre-redesign — they've
          been removed here along with their sole data source,
          historicalMediumStats, in computeInsights.

          ONGOING (a single month) swaps the chart for a same-month
          per-medium comparison instead (Task 2 item 5) — a month-over-month
          trend has nothing to show with only one data point. Every other
          period keeps the trend chart, now sharing its own metric selector
          with Top 5/Bottom 5 Performers below (Task item 3) instead of
          each having its own separate toggle. */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className={`text-[11px] font-black uppercase tracking-wider ${dark ? "text-white" : "text-[#111827]"}`}>Trend &amp; Rankings</h3>
        {period !== "ongoing" && <MetricSelector value={periodMetric} onChange={setPeriodMetric} dark={dark} />}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-[2fr_1fr_1fr] gap-3">
        <div className={`rounded-xl border p-3 flex flex-col ${dark ? "bg-white/[0.03] border-white/[0.08]" : "bg-white border-[var(--border)]"}`}>
          <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
            <h4 className={`text-[11px] font-black uppercase tracking-wider ${dark ? "text-white" : "text-[#111827]"}`}>{period === "ongoing" ? "This Month by Medium" : "Trend"}</h4>
          </div>
          {period === "ongoing" ? (
            <CurrentMonthMediumChart dark={dark} currentMonth={insights.currentMonth} />
          ) : hasChartData ? (
            <div className="w-full h-48 font-sans text-[11px] font-bold">
              <ScoreTrendChart dark={dark} theme={theme} data={chartSeriesData} scoreLabel={METRIC_LABELS[periodMetric]} />
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center py-10 text-[13px] text-content-muted">Not enough scored months yet.</div>
          )}
        </div>
        <div className="flex flex-col gap-2">
          {/* ONGOING keeps its own medium toggle here (Ongoing View Updates
              item 2) — unrelated to periodMetric above, which only exists
              for non-ONGOING periods. Every other period's ranking is
              driven by the shared periodMetric toggle on the section
              header instead, so there's nothing to render in this slot for
              them anymore (Task item 3 removes the old Current Month/
              Selected Period toggle entirely, rather than replacing it with
              a second copy of periodMetric down here too). */}
          {period === "ongoing" && (
            <div className="flex justify-center lg:justify-start">
              <MetricSelector value={rankMetric} onChange={setRankMetric} dark={dark} />
            </div>
          )}
          <RankedList
            title="Top 5 Performers"
            icon={<Trophy className={`w-3.5 h-3.5 ${dark ? "text-amber-300" : "text-amber-700"}`} />}
            entries={rankedTop3}
            dark={dark}
            tone="good"
            onSelect={onOpenAdvisor}
            emptyLabel={period === "ongoing" ? "No scores for the current month yet." : periodSummary.loading ? "Loading…" : "No scored advisors yet."}
          />
        </div>
        <div className="flex flex-col gap-2">
          {/* Invisible clone of the toggle rendered above Top 5, so both
              cards' tops line up exactly — only needed for ONGOING now,
              since a period view no longer renders anything in that slot
              (see the comment above Top 5). ONGOING swaps Bottom 5
              Performers for Potential QIP (Ongoing View Updates item 6) —
              a fixed Lead/Payment low-score-and-volume list, independent of
              the medium toggle above (that toggle only re-ranks Top
              Performers). */}
          {period === "ongoing" && (
            <div className="flex justify-center lg:justify-start opacity-0 pointer-events-none shrink-0" aria-hidden="true">
              <MetricSelector value={rankMetric} onChange={() => {}} dark={dark} />
            </div>
          )}
          {period === "ongoing" ? (
            <LowScoreList
              title="Potential QIP"
              icon={<AlertTriangle className={`w-3.5 h-3.5 ${dark ? "text-red-300" : "text-red-700"}`} />}
              entries={insights.potentialQip}
              dark={dark}
              onSelect={onOpenAdvisor}
              emptyLabel="No advisors currently meet the Potential QIP criteria."
            />
          ) : (
            <RankedList
              title="Bottom 5 Performers"
              icon={<AlertTriangle className={`w-3.5 h-3.5 ${dark ? "text-red-300" : "text-red-700"}`} />}
              entries={rankedBottom3}
              dark={dark}
              tone="poor"
              onSelect={onOpenAdvisor}
              emptyLabel={periodSummary.loading ? "Loading…" : "No scored advisors yet."}
            />
          )}
        </div>
      </div>

      {/* Most Improved / Most Declined — both compare an advisor's first vs
          latest scored month within the loaded period, which is meaningless
          when that period is a single ONGOING month (Ongoing View Updates
          item 4) — hidden there, unchanged everywhere else. Top 3, ranked,
          each with its own previous score, current score, and the two
          months compared (Task item 4). */}
      {period !== "ongoing" && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <ImprovedList title="Most Improved" entries={insights.mostImproved} direction="up" dark={dark} onSelect={onOpenAdvisor} />
          <ImprovedList title="Most Declined" entries={insights.mostDeclined} direction="down" dark={dark} onSelect={onOpenAdvisor} />
        </div>
      )}
    </div>
  );
}

/** One row per advisor, ranked — Most Improved/Most Declined (Task item 4).
 * `direction` just picks the icon/sign; both lists share this component. */
function ImprovedList({
  title,
  entries,
  direction,
  dark,
  onSelect,
}: {
  title: string;
  entries: ImprovedEntry[];
  direction: "up" | "down";
  dark: boolean;
  onSelect: (tactId: string) => void;
}) {
  const card = `rounded-xl border p-3 flex flex-col gap-1 ${dark ? "bg-white/[0.03] border-white/[0.08]" : "bg-white border-[var(--border)]"}`;
  const label = "text-[11px] font-bold uppercase tracking-wider text-content-muted";
  const Icon = direction === "up" ? TrendingUp : TrendingDown;
  return (
    <div className={card}>
      <span className={label}>{title}</span>
      {entries.length === 0 ? (
        <span className="text-[15px] text-content-muted py-1">Not enough data yet</span>
      ) : (
        <ol className="mt-0.5 space-y-1">
          {entries.map((e, i) => (
            <li key={e.tactId}>
              <button
                onClick={() => onSelect(e.tactId)}
                className={`w-full flex items-center justify-between gap-2 -mx-2 px-2 py-1.5 rounded-lg cursor-pointer transition-colors ${dark ? "hover:bg-white/[0.05]" : "hover:bg-stone-50"}`}
              >
                <span className="flex items-center gap-2 min-w-0">
                  <span className="text-[11px] font-bold text-content-muted w-4 shrink-0">{i + 1}</span>
                  <span className="flex flex-col items-start min-w-0">
                    <span className={`text-[13px] font-bold truncate ${dark ? "text-white" : "text-stone-900"}`}>{e.name}</span>
                    <span className="text-[10px] font-semibold text-content-muted whitespace-nowrap">
                      {e.prevScore} ({e.prevMonthLabel}) → {e.currScore} ({e.currMonthLabel})
                    </span>
                  </span>
                </span>
                <span className={`flex items-center gap-1 text-[13px] font-black shrink-0 ${deltaTextClass(e.change, dark)}`}>
                  <Icon className="w-3.5 h-3.5" />
                  {e.change > 0 ? "+" : ""}
                  {e.change}
                </span>
              </button>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

// Shared by RankedList and LowScoreList — Top/Bottom Performers and
// Potential QIP/Low-Score Monitoring all sit as peer cards in the same row
// (or the same column, stacked), so a short/empty list must still hold the
// same height a full 5-entry list would — otherwise an empty Potential QIP
// card visibly falls short of Top 5 Performers next to it. min-h is only a
// floor, not a cap — a taller card (e.g. LowScoreList's badges wrapping
// onto a second line) would still out-grow it and leave the bottoms
// mismatched, so `flex-1` is paired with it: their shared grid row (see the
// Trend & Rankings grid) stretches both side-by-side column wrappers to the
// same height, and flex-1 lets each card claim all of it, so whichever
// card's content is naturally taller sets the height for both.
const RANK_CARD_MIN_HEIGHT_CLASS = "min-h-[220px] flex-1";

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
    <div className={`rounded-xl border p-3 ${RANK_CARD_MIN_HEIGHT_CLASS} ${dark ? "bg-white/[0.03] border-white/[0.08]" : "bg-white border-[var(--border)]"}`}>
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
                {/* Main QA scores stay white/neutral (Universal Rules) — the
                    good/poor distinction between these two lists is now
                    just a small muted dot next to the value, not a full
                    text-color fill. */}
                <span className="flex items-center gap-1.5 shrink-0">
                  <span
                    aria-hidden="true"
                    className={`w-1.5 h-1.5 rounded-full ${tone === "good" ? (dark ? "bg-emerald-400" : "bg-emerald-600") : dark ? "bg-red-400" : "bg-red-600"}`}
                  />
                  <span className={`text-[13px] font-black ${scoreTextClass(e.value, dark)}`}>{e.value}</span>
                </span>
              </button>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

// ── Low-score list — Low-Score Monitoring and Potential QIP share this one
// component (Ongoing View Updates items 5 & 6): each row is an advisor plus
// one badge per medium that triggered the list, carrying that medium's own
// score and instance count so the "why" is visible without opening the
// advisor. No ranking number (unlike RankedList) — these aren't sorted by
// value, just flagged. ─────────────────────────────────────────────────
function LowScoreList({
  title,
  icon,
  entries,
  dark,
  onSelect,
  emptyLabel,
}: {
  title: string;
  icon: ReactNode;
  entries: LowScoreEntry[];
  dark: boolean;
  onSelect: (tactId: string) => void;
  emptyLabel?: string;
}) {
  return (
    <div className={`rounded-xl border p-3 ${RANK_CARD_MIN_HEIGHT_CLASS} ${dark ? "bg-white/[0.03] border-white/[0.08]" : "bg-white border-[var(--border)]"}`}>
      <div className="flex items-center gap-1.5 mb-2">
        {icon}
        <h3 className={`text-[13px] font-black uppercase tracking-wider ${dark ? "text-white" : "text-[#111827]"}`}>{title}</h3>
      </div>
      {entries.length === 0 ? (
        <p className="text-[13px] text-content-muted py-2">{emptyLabel || "None found."}</p>
      ) : (
        // Plain table, no cell borders — the medium is the only thing that
        // still gets a filled capsule (colored by medium, not a uniform
        // amber "this whole row is a warning" fill), so score and instance
        // count read as ordinary table data instead of all-caps alerting.
        <table className="w-full text-[13px] border-collapse">
          <thead>
            <tr>
              <th className={`text-left pb-1 pr-2 text-[10px] font-bold uppercase tracking-wider ${dark ? "text-slate-500" : "text-stone-400"}`}>Advisor</th>
              <th className={`text-left pb-1 pr-2 text-[10px] font-bold uppercase tracking-wider ${dark ? "text-slate-500" : "text-stone-400"}`}>Medium</th>
              <th className={`text-right pb-1 pr-2 text-[10px] font-bold uppercase tracking-wider ${dark ? "text-slate-500" : "text-stone-400"}`}>Score</th>
              <th className={`text-right pb-1 text-[10px] font-bold uppercase tracking-wider ${dark ? "text-slate-500" : "text-stone-400"}`}>Instances</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) =>
              e.flags.map((f, i) => (
                <tr
                  key={`${e.tactId}-${f.medium}`}
                  onClick={() => onSelect(e.tactId)}
                  onKeyDown={(ev) => {
                    if (ev.key === "Enter" || ev.key === " ") {
                      ev.preventDefault();
                      onSelect(e.tactId);
                    }
                  }}
                  role="button"
                  tabIndex={0}
                  className={`cursor-pointer transition-colors focus:outline-none ${dark ? "hover:bg-white/[0.05] focus-visible:bg-white/[0.05]" : "hover:bg-stone-50 focus-visible:bg-stone-50"}`}
                >
                  {i === 0 && (
                    <td rowSpan={e.flags.length} className={`align-top py-1.5 pr-2 font-bold truncate ${dark ? "text-white" : "text-stone-900"}`}>
                      {e.name}
                    </td>
                  )}
                  <td className="py-1.5 pr-2">
                    {/* Two colors, not one — Lead and Payment each keep the
                        same muted hue used for them on the Trend chart
                        (MEDIUM_CHART_COLORS), so the medium is identifiable
                        without reading the label. */}
                    <span
                      className={`inline-flex items-center text-[10px] font-bold px-1.5 py-0.5 rounded-full whitespace-nowrap ${
                        f.medium === "lead"
                          ? dark
                            ? "bg-indigo-400/15 text-indigo-300"
                            : "bg-indigo-50 text-indigo-700"
                          : dark
                            ? "bg-teal-400/15 text-teal-300"
                            : "bg-teal-50 text-teal-700"
                      }`}
                    >
                      {MEDIUM_SHORT_LABELS[f.medium]}
                    </span>
                  </td>
                  <td className={`py-1.5 pr-2 text-right font-black tabular-nums ${dark ? "text-white" : "text-stone-900"}`}>{f.avg}</td>
                  <td className={`py-1.5 text-right tabular-nums ${dark ? "text-slate-400" : "text-stone-500"}`}>{f.instances}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ── Team pivot table — one row per advisor, months as columns (newest
// first — see the header comment on displayMonths/prevMonthKeyOf), with a
// Cumulative/Lead/Payment/Chat/Call metric toggle (Task 2 item 8). ONGOING
// only ever has one month loaded, so a month-columns layout would leave the
// table mostly empty — it switches to a single-row-per-advisor breakdown of
// all four mediums' score + instance count instead, with no metric toggle
// (nothing to switch between — everything's already shown at once) and no
// Period Avg column (a lone month has no period to average) — see
// PivotAdvisorRowOngoing below. Every other period keeps the original
// month-columns layout unchanged (Ongoing View Updates item 7). ──────────
function TeamPivotTable({
  dark,
  pivots,
  months,
  prevMonthKeyOf,
  loading,
  period,
  onOpenAdvisor,
  cellClass,
  headClass,
  currentMonth,
}: {
  dark: boolean;
  pivots: AdvisorPivot[];
  months: MonthSpec[];
  prevMonthKeyOf: Record<string, string | undefined>;
  loading: boolean;
  period: Period;
  onOpenAdvisor: (tactId: string) => void;
  cellClass: string;
  headClass: string;
  /** Ongoing view's team-level summary row (Task item 6) reuses this
   * verbatim — same source the top QA Performance cards read from — so the
   * two are guaranteed to match exactly, per "for the ongoing view, the
   * team-level summary should exactly match the scores shown in the top
   * QA Performance cards." */
  currentMonth: CurrentMonthSnapshot | null;
}) {
  const [search, setSearch] = useState("");
  const filteredPivots = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? pivots.filter((p) => p.name.toLowerCase().includes(q)) : pivots;
  }, [pivots, search]);
  // Which score this table shows, per month and for Period Avg — restores
  // the medium filter this table used to have before it was pared down to
  // Cumulative-only (Task 2 item 8), reusing the same Metric selector/shape
  // the Trend chart already uses elsewhere on this page. Local state, not
  // lifted to the parent — purely how this one table's own cells are read,
  // no refetch involved (buildPivots already carries every medium). Unused
  // in ONGOING, which shows every medium at once instead of toggling.
  const [metric, setMetric] = useState<MetricKey>("cumulative");
  const ongoing = period === "ongoing";
  const currentMonthKey = ongoing ? months[0]?.key ?? null : null;
  // headClass already bakes in "text-left" (see its definition above), so
  // appending " text-center" leaves both classes on the element — Tailwind's
  // stylesheet order then decides the winner, not class-list order, and
  // text-left was winning. Swap the alignment token instead of stacking it.
  const headClassCenter = headClass.replace("text-left", "text-center");

  return (
    <div className={`rounded-xl border overflow-hidden ${dark ? "border-white/[0.08]" : "border-[var(--border)]"}`}>
      <div className="flex flex-wrap items-center justify-between gap-3 px-3 py-2 border-b text-[11px] font-bold uppercase tracking-wider text-content-muted border-inherit">
        <div className="flex flex-wrap items-center gap-2.5">
          <span className="shrink-0">{ongoing ? "QA Performance — Current Month" : "QA Performance – Monthly"}</span>
          {!ongoing && <MetricSelector value={metric} onChange={setMetric} dark={dark} />}
        </div>
        <div className="flex items-center gap-2.5 shrink-0">
          <div className="relative">
            <Search className={`absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 pointer-events-none ${dark ? "text-slate-500" : "text-stone-400"}`} />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search advisor…"
              className={`pl-6 pr-2 py-1 rounded-md border text-[11px] font-semibold normal-case tracking-normal outline-none w-36 focus:w-44 transition-[width] ${
                dark ? "bg-[#102236] border-[#1e3e5c] text-[#eff6ff] placeholder:text-slate-500" : "bg-white border-stone-250 text-stone-850 placeholder:text-stone-400"
              }`}
            />
          </div>
          <span className="normal-case tracking-normal">
            {filteredPivots.length} advisor{filteredPivots.length === 1 ? "" : "s"}
            {search.trim() && filteredPivots.length !== pivots.length ? ` of ${pivots.length}` : ""}
          </span>
        </div>
      </div>
      {/* Own scroll container, capped well below the viewport so the table
          never grows the page itself — every mapped advisor is reachable
          by scrolling here, none are cut off by the initial viewport (see
          the "Table usability" requirement). sticky top-0 on each <th>
          (headClass) keeps the header pinned while scrolling. */}
      <div className="max-h-[65vh] overflow-auto">
        {ongoing ? (
          <table className="w-full text-[13px] border-collapse">
            <thead>
              <tr>
                <th rowSpan={2} className={headClass + " min-w-[180px] align-bottom"}>
                  Advisor
                </th>
                {(["lead", "payment", "chat", "call"] as MediumKey[]).map((key) => (
                  <th key={key} colSpan={2} className={headClassCenter}>
                    {MEDIUM_LABELS[key]}
                  </th>
                ))}
                <th rowSpan={2} className={headClass + " w-8 align-bottom"} aria-hidden="true" />
              </tr>
              <tr>
                {(["lead", "payment", "chat", "call"] as MediumKey[]).map((key) => (
                  <Fragment key={key}>
                    <th className={headClassCenter}>Score</th>
                    <th className={headClassCenter}>Instances</th>
                  </Fragment>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredPivots.length === 0 ? (
                <tr>
                  <td colSpan={10} className="px-3 py-6 text-center text-content-muted">
                    {loading ? "Loading…" : search.trim() ? "No advisors match your search." : "No mapped advisors found for this scope."}
                  </td>
                </tr>
              ) : (
                filteredPivots.map((p) => (
                  <Fragment key={p.tactId}>
                    <PivotAdvisorRowOngoing dark={dark} pivot={p} monthKey={currentMonthKey} onOpen={() => onOpenAdvisor(p.tactId)} cellClass={cellClass} />
                  </Fragment>
                ))
              )}
              {/* Team-level summary row (Task item 6) — reads the same
                  insights.currentMonth snapshot the top QA Performance cards
                  use, so this row is guaranteed to match them exactly. */}
              <tr className={`font-black border-t-2 ${dark ? "bg-white/[0.05] border-white/[0.12]" : "bg-[var(--table-header-bg)] border-stone-300"}`}>
                <td className={cellClass}>Team Average</td>
                {(["lead", "payment", "chat", "call"] as MediumKey[]).map((key) => {
                  const stat = currentMonth ? currentMonth[key] : EMPTY_MEDIUM_STAT;
                  return (
                    <Fragment key={key}>
                      <td className={cellClass + " text-center"}>{stat.avg === null ? <span className="text-content-muted italic font-semibold">NA</span> : <span className={scoreFlagClasses(stat.avg, dark)}>{stat.avg}</span>}</td>
                      <td className={cellClass + " text-center"}>{stat.instances}</td>
                    </Fragment>
                  );
                })}
                <td className={cellClass} aria-hidden="true" />
              </tr>
            </tbody>
          </table>
        ) : (
          <table className="w-full text-[13px] border-collapse">
            <thead>
              <tr>
                <th className={headClass + " min-w-[180px]"}>Advisor</th>
                {months.map((m) => (
                  <th key={m.key} className={headClassCenter}>
                    {m.label}
                  </th>
                ))}
                <th className={headClass + " w-8"} aria-hidden="true" />
              </tr>
            </thead>
            <tbody>
              {filteredPivots.length === 0 ? (
                <tr>
                  <td colSpan={months.length + 2} className="px-3 py-6 text-center text-content-muted">
                    {loading ? "Loading…" : search.trim() ? "No advisors match your search." : "No mapped advisors found for this scope."}
                  </td>
                </tr>
              ) : (
                filteredPivots.map((p) => (
                  <Fragment key={p.tactId}>
                    <PivotAdvisorRow dark={dark} pivot={p} months={months} prevMonthKeyOf={prevMonthKeyOf} metric={metric} onOpen={() => onOpenAdvisor(p.tactId)} cellClass={cellClass} />
                  </Fragment>
                ))
              )}
              {/* Team-level summary row (Task item 6) — average of the
                  metric's own score across the team and the summed instance
                  count for that metric, computed straight from this table's
                  own pivots (independent of the actual-date-range
                  periodSummary), so this figure may differ from the top QA
                  Performance tiles — expected for period views. */}
              {filteredPivots.length > 0 && (
                <tr className={`font-black border-t-2 ${dark ? "bg-white/[0.05] border-white/[0.12]" : "bg-[var(--table-header-bg)] border-stone-300"}`}>
                  <td className={cellClass}>Team Average</td>
                  <td colSpan={months.length} className={cellClass + " text-center"}>
                    {(() => {
                      const scores = pivots.map((p) => periodAvgFor(p, metric)).filter((v): v is number => v !== null);
                      const teamAvg = scores.length ? round2(scores.reduce((a, b) => a + b, 0) / scores.length) : null;
                      const teamInstances = pivots.reduce((sum, p) => sum + (metric === "cumulative" ? p.totalInstances : p.mediumStats[metric].instances), 0);
                      return (
                        <span className="inline-flex items-center gap-4">
                          <span>Score: {teamAvg === null ? <span className="text-content-muted italic font-semibold">NA</span> : <span className={scoreFlagClasses(teamAvg, dark)}>{teamAvg}</span>}</span>
                          <span>Instances: {teamInstances}</span>
                        </span>
                      );
                    })()}
                  </td>
                  <td className={cellClass} aria-hidden="true" />
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

/** ONGOING's own row shape — one row per advisor, all four mediums' score +
 * instance count for the single current month (see TeamPivotTable's header
 * comment). `monthKey: null` (no scored month at all) renders every cell as
 * NA, same convention every other "no data" cell on this page uses. */
function PivotAdvisorRowOngoing({
  dark,
  pivot,
  monthKey,
  onOpen,
  cellClass,
}: {
  dark: boolean;
  pivot: AdvisorPivot;
  monthKey: string | null;
  onOpen: () => void;
  cellClass: string;
}) {
  const row = monthKey ? pivot.monthly[monthKey] : undefined;
  const cells: { avg: number | null; instances: number }[] = [
    { avg: row?.leadScoreAvg ?? null, instances: row?.leadScoreInstances ?? 0 },
    { avg: row?.paymentsAvg ?? null, instances: row?.paymentsInstances ?? 0 },
    { avg: row?.chatAvg ?? null, instances: row?.chatInstances ?? 0 },
    { avg: row?.callAvg ?? null, instances: row?.callInstances ?? 0 },
  ];
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
          {!pivot.isEmployed ? (
            <span title="Not currently employed">
              <UserX className="w-3 h-3 shrink-0 text-amber-500" />
            </span>
          ) : (
            !pivot.hasActivity && (
              <span title="No QA activity this period">
                <CircleOff className="w-3 h-3 shrink-0 text-content-muted" />
              </span>
            )
          )}
        </span>
      </td>
      {cells.map((c, i) => (
        <Fragment key={i}>
          <td className={cellClass + " text-center"}>{c.avg === null ? <span className="text-content-muted italic">NA</span> : <span className={scoreFlagClasses(c.avg, dark)}>{c.avg}</span>}</td>
          <td className={cellClass + " text-center"}>{c.instances}</td>
        </Fragment>
      ))}
      <td className={cellClass}>
        <ChevronRight className={`w-4 h-4 shrink-0 ${dark ? "text-white/30" : "text-stone-300"}`} aria-hidden="true" />
      </td>
    </tr>
  );
}

/** Pulls the score this table's selected metric points to out of one
 * MonthlyAdvisorRow — undefined/missing row reads as null, same as every
 * other "no data this month" case on this page. */
function metricValueOf(row: MonthlyAdvisorRow | undefined, metric: MetricKey): number | null {
  if (!row) return null;
  switch (metric) {
    case "lead":
      return row.leadScoreAvg;
    case "payment":
      return row.paymentsAvg;
    case "chat":
      return row.chatAvg;
    case "call":
      return row.callAvg;
    default:
      return row.cumulativeScore;
  }
}
/** The Period Avg column's own value for the selected metric — Cumulative
 * already has its own precomputed avgCumulative; every medium reads its
 * period-wide avg off the same mediumStats buildPivots already computed. */
function periodAvgFor(pivot: AdvisorPivot, metric: MetricKey): number | null {
  return metric === "cumulative" ? pivot.avgCumulative : pivot.mediumStats[metric].avg;
}

function PivotAdvisorRow({
  dark,
  pivot,
  months,
  prevMonthKeyOf,
  metric,
  onOpen,
  cellClass,
}: {
  dark: boolean;
  pivot: AdvisorPivot;
  months: MonthSpec[];
  prevMonthKeyOf: Record<string, string | undefined>;
  metric: MetricKey;
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
          {!pivot.isEmployed ? (
            <span title="Not currently employed">
              <UserX className="w-3 h-3 shrink-0 text-amber-500" />
            </span>
          ) : (
            !pivot.hasActivity && (
              <span title="No QA activity this period">
                <CircleOff className="w-3 h-3 shrink-0 text-content-muted" />
              </span>
            )
          )}
        </span>
      </td>
      {months.map((m) => {
        const row = pivot.monthly[m.key];
        const val = metricValueOf(row, metric);
        const prevKey = prevMonthKeyOf[m.key];
        const prevRow = prevKey ? pivot.monthly[prevKey] : undefined;
        const prevVal = metricValueOf(prevRow, metric);
        return (
          <td key={m.key} className={cellClass + " text-center"}>
            {val === null ? (
              <span className="text-content-muted italic">NA</span>
            ) : (
              <span className="inline-flex items-center gap-1 justify-center">
                <span className={scoreFlagClasses(val, dark)}>{val}</span>
                <TrendArrow curr={val} prev={prevVal} dark={dark} />
              </span>
            )}
          </td>
        );
      })}
      <td className={cellClass}>
        <ChevronRight className={`w-4 h-4 shrink-0 ${dark ? "text-white/30" : "text-stone-300"}`} aria-hidden="true" />
      </td>
    </tr>
  );
}

// ── Medium stat card — QA score + Blunder % for one medium (Lead/Payment/
// Chat/Call), used on the advisor detail view. `highlight` mirrors the Home
// Page's MediumKpiCard treatment for Lead Score/Payment QA (the same two
// "key KPI" mediums there) — same teal tint, so an advisor's own Current
// Month cards read consistently with the team page's. ───────────────────
function MediumStatCard({
  dark,
  mediumKey,
  stat,
  highlight = false,
  size = "lg",
}: {
  dark: boolean;
  mediumKey: MediumKey;
  stat: MediumStat;
  highlight?: boolean;
  /** "lg" for Lead Score/Payment QA (the key KPIs, given the larger
   * treatment — Task), "sm" for Chat/Call sitting underneath them at a
   * more compact size. */
  size?: "lg" | "sm";
}) {
  const lg = size === "lg";
  // Light mode uses a bluish tint (dark mode keeps the greenish teal) — see
  // KPI_ACCENT_CLASSES's own comment on why light mode departs from dark
  // mode's color here.
  const card = `rounded-xl border flex flex-col ${lg ? "p-4 gap-2" : "p-2.5 gap-1"} ${
    highlight ? (dark ? "bg-teal-500/[0.12] border-teal-400/40" : "bg-blue-50 border-blue-200") : dark ? "bg-white/[0.03] border-white/[0.08]" : "bg-white border-[var(--border)]"
  }`;
  return (
    <div className={card}>
      <span
        className={`flex items-center gap-1.5 font-bold uppercase tracking-wider ${lg ? "text-[11px]" : "text-[9px]"} ${
          highlight ? (dark ? "text-teal-300" : "text-blue-700") : dark ? "text-slate-300" : "text-stone-600"
        }`}
      >
        {MEDIUM_ICONS[mediumKey]}
        {MEDIUM_LABELS[mediumKey]}
      </span>
      <div className="flex items-end justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <span className={`font-bold uppercase tracking-wider text-content-muted ${lg ? "text-[10px]" : "text-[8px]"}`}>QA Score</span>
          <span className={`font-black ${lg ? "text-3xl" : "text-lg"} ${scoreTextClass(stat.avg, dark)}`}>{stat.avg ?? "—"}</span>
        </div>
        <div className="flex flex-col gap-0.5 items-end">
          <span className={`font-bold uppercase tracking-wider text-content-muted ${lg ? "text-[10px]" : "text-[8px]"}`}>Blunder %</span>
          {/* Slightly smaller than the QA score — "comparable... but
              slightly smaller" per the Universal Rules, while still
              carrying real color weight via blunderTextClass. */}
          <span className={`font-black ${lg ? "text-xl" : "text-sm"} ${blunderTextClass(stat.blunderPct, dark)}`}>{stat.blunderPct === null ? "—" : `${stat.blunderPct}%`}</span>
        </div>
      </div>
      <span className={`text-content-muted ${lg ? "text-[11px]" : "text-[9px]"}`}>
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
  loading,
  period,
  customFrom,
  customTo,
  onChangePeriod,
  onChangeCustomFrom,
  onChangeCustomTo,
  periodOptions,
  preferredMonthKey,
  onChangePreferredMonthKey,
  periodSummary,
}: {
  dark: boolean;
  theme: "light" | "dark";
  pivot: AdvisorPivot;
  orderedRows: MonthlyAdvisorRow[];
  prevMonthKeyOf: Record<string, string | undefined>;
  /** True while a newly-picked period/month range is still loading — the
   * page keeps showing the previous data underneath rather than blanking,
   * same "stale while revalidating" feel the Home Page's own tableLoading
   * gives via its header spinner. */
  loading: boolean;
  /** This page's own Period Filter (Task 3 item 2) — entirely independent
   * of the Home Page's period, per "the page should be controllable
   * directly from itself" (see TeamTrackerPage's advisorPeriod state). */
  period: Period;
  customFrom: string;
  customTo: string;
  onChangePeriod: (p: Period) => void;
  onChangeCustomFrom: (v: string) => void;
  onChangeCustomTo: (v: string) => void;
  periodOptions: CustomSelectOption[];
  /** This page's own Current Month / Month Picker (Task 3 item 2) — null
   * means "use this advisor's actual latest scored month" (the default),
   * same pin-or-default pattern the Home Page's Current Month row uses. */
  preferredMonthKey: string | null;
  onChangePreferredMonthKey: (key: string | null) => void;
  /** This advisor's own slice of the actual-date-range period summary (see
   * getTeamTrackerPeriodSummary) — powers this page's own QA Performance
   * card for a period view (Task item 2), same "everywhere a period-level
   * score appears" scope as the Home Page. Unused while period === "ongoing". */
  periodSummary: AdvisorPeriodSummaryDerived;
}) {
  // One point per month, every metric attached — same shape as the Team
  // Tracker home page's own insights.chartData, so the same MetricSelector/
  // ScoreTrendChart pair can be reused verbatim here (this view's chart
  // used to be Cumulative-only with no selector at all).
  const [chartMetric, setChartMetric] = useState<MetricKey>("cumulative");
  const fullChartData = orderedRows.map((r) => ({
    month: r.monthLabel,
    cumulative: { score: r.cumulativeScore, instances: r.paymentsInstances + r.chatInstances + r.callInstances },
    lead: { score: r.leadScoreAvg, instances: r.leadScoreInstances },
    payment: { score: r.paymentsAvg, instances: r.paymentsInstances },
    chat: { score: r.chatAvg, instances: r.chatInstances },
    call: { score: r.callAvg, instances: r.callInstances },
  }));
  const chartData = fullChartData.map((d) => ({ month: d.month, score: d[chartMetric].score, instances: d[chartMetric].instances }));
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

  // Every month within this page's own loaded period that has a Cumulative
  // Score for this advisor — the Month Picker's own option list (Task 3
  // item 2), mirroring the Home Page's insights.scoredMonths.
  const scoredMonthOptions = useMemo(
    () => orderedRows.filter((r) => r.cumulativeScore !== null).map((r) => ({ monthKey: r.monthKey, monthLabel: r.monthLabel })),
    [orderedRows]
  );

  // This advisor's own latest-scored-month snapshot (see AdvisorPivot's
  // latestScoredRow comment) — independent of the team-wide "Current
  // Month" the main page uses, since one advisor can be missing more
  // recent data than the team overall. A pinned month (Month Picker) takes
  // priority when it's actually present in this page's own loaded period;
  // falls back to the latest scored month otherwise, same as the Home
  // Page's own pin-or-default behavior.
  const pinnedRow = preferredMonthKey ? rowsByMonthKey[preferredMonthKey] : undefined;
  const latest = pinnedRow ?? pivot.latestScoredRow;
  const latestPrevRow = latest ? rowsByMonthKey[prevMonthKeyOf[latest.monthKey] ?? ""] : undefined;
  const latestCumulativeDelta =
    latest && latestPrevRow && latest.cumulativeScore !== null && latestPrevRow.cumulativeScore !== null ? round2(latest.cumulativeScore - latestPrevRow.cumulativeScore) : null;
  /** Reshapes `latest` (this advisor's own latest-scored-month row) into the
   * same CurrentMonthSnapshot shape the Home Page's ONGOING view already
   * uses, so CurrentMonthMediumChart ("This Month by Medium") can be reused
   * verbatim here instead of ScoreTrendChart for ONGOING (Task: the Score
   * Trend chart was showing a multi-month trend for what's meant to be a
   * single-month snapshot). */
  const currentMonthSnapshot: CurrentMonthSnapshot | null = latest
    ? {
        monthKey: latest.monthKey,
        monthLabel: latest.monthLabel,
        cumulative: latest.cumulativeScore,
        cumulativeDelta: latestCumulativeDelta,
        lead: buildMediumStat([latest.leadScoreAvg], [latest.leadScoreInstances], [latest.leadScoreBlunders]),
        payment: buildMediumStat([latest.paymentsAvg], [latest.paymentsInstances], [latest.paymentsBlunders]),
        chat: buildMediumStat([latest.chatAvg], [latest.chatInstances], [latest.chatBlunders]),
        call: buildMediumStat([latest.callAvg], [latest.callInstances], [latest.callBlunders]),
      }
    : null;

  // Period view's own actual-date-range figures (Task item 2) — null while
  // ONGOING (this advisor's single-month pivot data already IS the real
  // number there, see AdvisorPeriodSummaryDerived's fetch guard) or while
  // periodSummary hasn't loaded yet, in which case these render "—" rather
  // than silently falling back to the old monthly-average numbers.
  const periodOngoing = period === "ongoing";
  const periodMetricAvg = (key: MediumKey): number | null => {
    const m = periodSummary.metric;
    if (!m) return null;
    return key === "lead" ? m.leadScoreAvg : key === "payment" ? m.paymentsAvg : key === "chat" ? m.chatAvg : m.callAvg;
  };
  const periodBestWeakest = useMemo(() => {
    if (periodOngoing || !periodSummary.metric) return { best: null, weakest: null };
    const scored = REAL_MEDIUM_KEYS.map((key) => ({ key, label: MEDIUM_LABELS[key], avg: periodMetricAvg(key) })).filter(
      (m): m is { key: MediumKey; label: string; avg: number } => m.avg !== null
    );
    return {
      best: scored.length ? scored.reduce((a, b) => (b.avg > a.avg ? b : a)) : null,
      weakest: scored.length ? scored.reduce((a, b) => (b.avg < a.avg ? b : a)) : null,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [periodOngoing, periodSummary.metric]);
  const displayAvgCumulative = periodOngoing ? pivot.avgCumulative : periodSummary.cumulative;
  const displayBestMedium = periodOngoing ? pivot.bestMedium : periodBestWeakest.best;
  const displayWeakestMedium = periodOngoing ? pivot.weakestMedium : periodBestWeakest.weakest;
  const displayTotalInstances = periodOngoing
    ? pivot.totalInstances
    : periodSummary.metric
      ? periodSummary.metric.paymentsInstances + periodSummary.metric.chatInstances + periodSummary.metric.callInstances
      : null;
  // Same idea as displayAvgCumulative etc., for the per-medium "QA
  // Performance" list card below (score/instances/blunder% per medium).
  const displayMediumStats: Record<MediumKey, MediumStat> | null = periodOngoing
    ? pivot.mediumStats
    : periodSummary.metric
      ? {
          lead: buildMediumStat([periodSummary.metric.leadScoreAvg], [periodSummary.metric.leadScoreInstances], [periodSummary.metric.leadScoreBlunders]),
          payment: buildMediumStat([periodSummary.metric.paymentsAvg], [periodSummary.metric.paymentsInstances], [periodSummary.metric.paymentsBlunders]),
          chat: buildMediumStat([periodSummary.metric.chatAvg], [periodSummary.metric.chatInstances], [periodSummary.metric.chatBlunders]),
          call: buildMediumStat([periodSummary.metric.callAvg], [periodSummary.metric.callInstances], [periodSummary.metric.callBlunders]),
        }
      : null;

  const groupHeadClass = `sticky top-0 z-10 text-center py-1.5 px-2 font-bold whitespace-nowrap border-b ${
    dark ? "bg-[#0d1c3f] border-white/[0.16] text-slate-300" : "bg-[#f5f5f4] border-stone-200 text-stone-700"
  }`;
  const subHeadClass = `sticky top-[27px] z-10 text-center py-1.5 px-2 font-semibold whitespace-nowrap border-b text-[11px] ${
    dark ? "bg-[#0d1c3f] border-white/[0.16] text-slate-400" : "bg-[#f5f5f4] border-stone-200 text-stone-500"
  }`;
  const bodyCell = `px-2 py-2 text-center border-b ${dark ? "border-white/[0.05]" : "border-stone-100"}`;

  const periodControl = (
    <PeriodControl
      theme={theme}
      period={period}
      customFrom={customFrom}
      customTo={customTo}
      onChangePeriod={onChangePeriod}
      onChangeCustomFrom={onChangeCustomFrom}
      onChangeCustomTo={onChangeCustomTo}
      options={periodOptions}
    />
  );

  return (
    <div className="space-y-4">
      {loading && (
        <span className="flex items-center gap-1 text-[11px] font-bold uppercase tracking-wider text-content-muted">
          <RefreshCw className="w-3 h-3 animate-spin" />
          Loading…
        </span>
      )}
      {/* Current Month — built inline rather than via the shared
          <CurrentMonthKpiRow/> (which the main team page also uses for its
          own Current Month row) so the card-design swap below stays scoped
          to this advisor-level view only. The Cumulative Score tile keeps
          its own distinct design (score + MoM delta + tagline — there's no
          blunder% concept for it), but the four per-medium tiles now use
          MediumStatCard's design (QA Score + large colored Blunder %, side
          by side) instead of MediumKpiCard — explicit request to swap the
          Current Month and historical medium card designs. No current-month
          info in a period view (Task item 1) — only the Period Filter still
          renders there, so the page stays controllable from itself
          regardless of data. */}
      {!periodOngoing ? (
        <div className="flex justify-end">{periodControl}</div>
      ) : !latest ? (
        <div className="space-y-2">
          <div className="flex justify-end">{periodControl}</div>
          <div className={`rounded-xl border p-4 text-[13px] font-semibold text-content-muted ${dark ? "bg-white/[0.03] border-white/[0.08]" : "bg-white border-[var(--border)]"}`}>
            No scored months in the selected period yet.
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className={`flex items-center gap-1.5 text-[11px] font-black uppercase tracking-wider ${dark ? "text-white" : "text-[#111827]"}`}>
              <span>QA Performance</span>
              <span className={`font-semibold normal-case tracking-normal ${dark ? "text-slate-400" : "text-stone-500"}`}>· {latest.monthLabel}</span>
              <MonthPickerButton dark={dark} availableMonths={scoredMonthOptions} selectedMonthKey={preferredMonthKey} onSelectMonth={onChangePreferredMonthKey} />
            </div>
            {periodControl}
          </div>
          {/* Score cards and the "This Month by Medium" chart sit side by
              side (Task: the chart was a full-width card of its own, leaving
              a lot of empty space around a fairly compact visual). Lead
              Score/Payment QA — the key KPIs — get the larger top row;
              Chat QA, Call QA, and Cumulative Score sit underneath at a more
              compact size, so the whole tile block totals about the same
              width and height as the chart beside it (items-stretch +
              justify-between lets the two tile rows spread to match the
              chart card's own height exactly, so both sides end at the same
              bottom edge) — freeing up the rest of the row's width for the
              chart itself instead of the previous 3-wide tile grid. */}
          <div className="grid grid-cols-1 xl:grid-cols-[2fr_3fr] gap-3 items-stretch">
            <div className="flex flex-col justify-between gap-3">
              <div className="grid grid-cols-2 gap-3">
                <MediumStatCard dark={dark} mediumKey="lead" stat={buildMediumStat([latest.leadScoreAvg], [latest.leadScoreInstances], [latest.leadScoreBlunders])} highlight size="lg" />
                <MediumStatCard dark={dark} mediumKey="payment" stat={buildMediumStat([latest.paymentsAvg], [latest.paymentsInstances], [latest.paymentsBlunders])} highlight size="lg" />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <MediumStatCard dark={dark} mediumKey="chat" stat={buildMediumStat([latest.chatAvg], [latest.chatInstances], [latest.chatBlunders])} size="sm" />
                <MediumStatCard dark={dark} mediumKey="call" stat={buildMediumStat([latest.callAvg], [latest.callInstances], [latest.callBlunders])} size="sm" />
                <div className={`rounded-xl border p-2.5 flex flex-col gap-1 ${dark ? "bg-white/[0.03] border-white/[0.08]" : "bg-white border-[var(--border)]"}`}>
                  <span className="flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-wider text-content-muted">
                    {CUMULATIVE_ICON}
                    Cumulative
                  </span>
                  <span className={`text-lg font-black ${scoreTextClass(latest.cumulativeScore, dark)}`}>{latest.cumulativeScore ?? "—"}</span>
                  {latestCumulativeDelta !== null ? (
                    <span className={`flex items-center gap-1 text-[9px] font-bold ${deltaTextClass(latestCumulativeDelta, dark)}`}>
                      <DeltaIcon delta={latestCumulativeDelta} />
                      {latestCumulativeDelta > 0 ? "+" : ""}
                      {latestCumulativeDelta} MoM
                    </span>
                  ) : (
                    <span className="text-[9px] text-content-muted">No prior month</span>
                  )}
                </div>
              </div>
            </div>
            <div className={`rounded-xl border p-3 flex flex-col ${dark ? "bg-white/[0.03] border-white/[0.08]" : "bg-white border-[var(--border)]"}`}>
              <h4 className={`text-[11px] font-black uppercase tracking-wider mb-1 ${dark ? "text-white" : "text-[#111827]"}`}>This Month by Medium</h4>
              <CurrentMonthMediumChart dark={dark} currentMonth={currentMonthSnapshot} />
            </div>
          </div>
        </div>
      )}

      {/* Selected-period insights — period views only (Task: remove this
          second "QA Performance" section from the Ongoing view; Section A
          above already covers Ongoing's own current-month snapshot, so this
          would otherwise duplicate it). Cumulative Score/Best/Weakest/Total
          Evaluations are the actual-date-range figures for a period view
          (Task item 2: Start/End/Till Date on the title line, right-aligned
          +muted), not an average of this advisor's own monthly averages.
          Highest/Lowest Month and Change (First → Latest) stay pivot-based
          regardless — those are inherently about individual scored MONTHS,
          which an actual-date-range query doesn't produce a per-month
          breakdown of. */}
      {!periodOngoing && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className={`text-[11px] font-black uppercase tracking-wider ${dark ? "text-white" : "text-[#111827]"}`}>QA Performance</h3>
            {periodSummary.filters && (
              <span className={`text-[10px] font-semibold normal-case tracking-normal text-right ${dark ? "text-slate-500" : "text-stone-400"}`}>
                Start: {fmtDisplayDate(periodSummary.filters.checkedFrom)} · End: {fmtDisplayDate(periodSummary.filters.checkedTo)} · Till: {fmtDisplayDate(periodSummary.filters.tillDate)}
              </span>
            )}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
            <div className={card}>
              <span className={`flex items-center gap-1 ${statLabel}`}>
                {CUMULATIVE_ICON}
                Cumulative Score
              </span>
              <span className={`${statValue} ${scoreTextClass(displayAvgCumulative, dark)}`}>{displayAvgCumulative ?? "—"}</span>
            </div>
            <div className={card}>
              <span className={statLabel}>Highest Month</span>
              <span className={statValue}>{pivot.highest ? `${pivot.highest.score} (${pivot.highest.monthLabel})` : "—"}</span>
            </div>
            <div className={card}>
              <span className={statLabel}>Lowest Month</span>
              <span className={statValue}>{pivot.lowest ? `${pivot.lowest.score} (${pivot.lowest.monthLabel})` : "—"}</span>
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
              <span className={statValue}>{displayBestMedium ? `${displayBestMedium.label} (${displayBestMedium.avg})` : "—"}</span>
            </div>
            <div className={card}>
              <span className={statLabel}>Weakest Medium</span>
              <span className={statValue}>{displayWeakestMedium ? `${displayWeakestMedium.label} (${displayWeakestMedium.avg})` : "—"}</span>
            </div>
            <div className={card}>
              <span className={statLabel}>Total Evaluations</span>
              <span className={statValue}>{displayTotalInstances ?? "—"}</span>
            </div>
          </div>
        </div>
      )}

      {/* Trend + Per-medium QA (whole selected period) — period views only.
          ONGOING's own "This Month by Medium" chart now lives up in the
          score-cards row above instead of down here (Task: put the score
          cards and the chart side by side rather than two stacked full-width
          rows), so this block has nothing left to show while ONGOING.

          Redesigned per the approved "Score Trend / QA Performance" mockup
          (Task 5): the four medium tiles used to be MediumKpiCard's design
          (four separate bordered cards in a 2x2 grid, each with its own
          label/icon/score/instances/blunder%) — spacious but not
          information-dense at a glance. They're replaced here with a single
          compact list card (one row per medium — name, score, instance
          count — divided by hairlines instead of four separate card
          borders/gaps), matching the mockup's single right-hand box exactly.
          MediumKpiCard itself is untouched and still used elsewhere (the
          Home Page's own Current Month row). The list card is titled "QA by
          Medium" rather than "QA Performance" so it reads as distinct from
          the tile section above it (both are visible together in period
          views — Task: de-duplicate the "QA Performance" title across
          sections). */}
      {!periodOngoing && (
        <div className="grid grid-cols-1 lg:grid-cols-[3fr_2fr] gap-3">
          <div className={`rounded-xl border p-4 flex flex-col ${dark ? "bg-white/[0.03] border-white/[0.08]" : "bg-white border-[var(--border)]"}`}>
            <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
              <h4 className={`text-[11px] font-black uppercase tracking-wider ${dark ? "text-white" : "text-[#111827]"}`}>Score Trend</h4>
              <MetricSelector value={chartMetric} onChange={setChartMetric} dark={dark} />
            </div>
            {hasChartData ? (
              <div className="w-full h-64 font-sans text-[11px] font-bold">
                <ScoreTrendChart dark={dark} theme={theme} data={chartData} scoreLabel={METRIC_LABELS[chartMetric]} />
              </div>
            ) : (
              <div className="flex-1 flex items-center justify-center py-10 text-[13px] text-content-muted">Not enough scored months yet.</div>
            )}
          </div>
          <div className={`rounded-xl border flex flex-col overflow-hidden ${dark ? "bg-white/[0.03] border-white/[0.08]" : "bg-white border-[var(--border)]"}`}>
            <h4 className={`text-[11px] font-black uppercase tracking-wider p-4 pb-2 ${dark ? "text-white" : "text-[#111827]"}`}>QA by Medium</h4>
            <div className="flex-1 flex flex-col">
              {(["lead", "payment", "chat", "call"] as MediumKey[]).map((key) => {
                const stat = displayMediumStats?.[key] ?? EMPTY_MEDIUM_STAT;
                // Same Lead Score/Payment QA "key KPI" highlight as the Home
                // Page's MediumKpiCard/this card's own Current Month tiles
                // above — a subtle row tint here rather than a full card
                // treatment, to stay consistent with this list's own compact,
                // hairline-divided design.
                const isKeyKpi = key === "lead" || key === "payment";
                return (
                  <div
                    key={key}
                    className={`flex items-center justify-between gap-3 px-4 py-2.5 border-t ${dark ? "border-white/[0.08]" : "border-[var(--border)]"} ${
                      // Bluish tint in light mode, greenish teal in dark
                      // mode — see KPI_ACCENT_CLASSES's own comment.
                      isKeyKpi ? (dark ? "bg-teal-500/[0.07]" : "bg-blue-50/70") : ""
                    }`}
                  >
                    <span
                      className={`flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider shrink-0 ${isKeyKpi ? (dark ? "text-teal-300" : "text-blue-700") : dark ? "text-slate-300" : "text-stone-600"}`}
                    >
                      {MEDIUM_ICONS[key]}
                      {MEDIUM_SHORT_LABELS[key]}
                    </span>
                    {/* Blunder % sits beside the score, same "significant
                        visual weight, comparable but slightly smaller than the
                        QA score" treatment as MediumKpiCard/MediumStatCard use
                        elsewhere on this page (previously this row only showed
                        score + instances, with no Blunder % at all). */}
                    <div className="flex items-center gap-4">
                      <div className="flex flex-col items-end gap-0.5">
                        <span className={`text-lg font-black leading-none ${scoreTextClass(stat.avg, dark)}`}>{stat.avg ?? "—"}</span>
                        <span className="text-[10px] font-semibold text-content-muted whitespace-nowrap">
                          {stat.instances} instance{stat.instances === 1 ? "" : "s"}
                        </span>
                      </div>
                      <div className="flex flex-col items-end gap-0.5">
                        <span className={`text-base font-black leading-none ${blunderTextClass(stat.blunderPct, dark)}`}>{stat.blunderPct === null ? "—" : `${stat.blunderPct}%`}</span>
                        <span className="text-[9px] font-bold uppercase tracking-wider text-content-muted">Blunder</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Full monthly breakdown — period views only (Task: remove this table
          from the Ongoing view, it's not needed there). Newest month first,
          grouped 2-row header so each medium's own Score/Instances pair only
          needs "Instances" rather than repeating the medium's name again. */}
      {!periodOngoing && (
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
                          <TrendArrow curr={r.cumulativeScore} prev={prevRow?.cumulativeScore ?? null} dark={dark} />
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
      )}

      {/* Assigned Actionables — a quick-view of this advisor's coaching
          actionables and their statuses (Task), shown in both Ongoing and
          period views since actionables aren't tied to a scored month or
          date range the way the rest of this page is. Same underlying data/
          status control as the full coaching record (fetchFeedbackSummary/
          ActionableStatusSelect) — just flattened across sessions and
          trimmed to the ones that still need attention first, rather than
          reproducing that whole record here. */}
      <AssignedActionablesSection dark={dark} tactId={pivot.tactId} />
    </div>
  );
}

/** Sorts open/in-progress actionables to the top (soonest due date first,
 * undated ones last within that group), with completed/failed ones
 * afterward (most recently assigned first) — "what still needs attention"
 * takes priority over "what's already resolved" in a quick-view list. */
type QuickViewActionable = FeedbackSummaryActionable & { sessionId: number; meetingDate: string };
function sortActionablesForQuickView(items: QuickViewActionable[]): QuickViewActionable[] {
  const isDone = (s: ActionableStatus) => s === "Completed" || s === "Failed";
  return [...items].sort((a, b) => {
    const aDone = isDone(a.status);
    const bDone = isDone(b.status);
    if (aDone !== bDone) return aDone ? 1 : -1;
    if (!aDone) {
      if (a.dueDate !== b.dueDate) {
        if (!a.dueDate) return 1;
        if (!b.dueDate) return -1;
        return a.dueDate < b.dueDate ? -1 : 1;
      }
      return 0;
    }
    return a.meetingDate < b.meetingDate ? 1 : -1;
  });
}
const ASSIGNED_ACTIONABLES_QUICK_VIEW_LIMIT = 6;
/** Compact "what's assigned + its status" list for one advisor — a quick
 * view rather than the full editable coaching record (that stays on the
 * Insights side; see FeedbackSummarySection), so this only surfaces the
 * status control, not discussion points/meeting notes/edit-session tools. */
function AssignedActionablesSection({ dark, tactId }: { dark: boolean; tactId: string }) {
  const [entries, setEntries] = useState<FeedbackSummaryEntry[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    fetchFeedbackSummary(tactId)
      .then((r) => {
        if (!cancelled) setEntries(r);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message || "Failed to load assigned actionables.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tactId]);

  const setActionableStatus = (sessionId: number, actionableId: number, next: ActionableStatus) => {
    setEntries((prev) => (prev ? prev.map((s) => (s.id !== sessionId ? s : { ...s, actionables: s.actionables.map((a) => (a.id === actionableId ? { ...a, status: next } : a)) })) : prev));
  };

  const flattened: QuickViewActionable[] = (entries ?? []).flatMap((s) => s.actionables.map((a) => ({ ...a, sessionId: s.id, meetingDate: s.meetingDate })));
  const sorted = sortActionablesForQuickView(flattened);
  const shown = sorted.slice(0, ASSIGNED_ACTIONABLES_QUICK_VIEW_LIMIT);
  const hiddenCount = sorted.length - shown.length;

  return (
    <div className={`rounded-xl border p-4 flex flex-col gap-2 ${dark ? "bg-white/[0.03] border-white/[0.08]" : "bg-white border-[var(--border)]"}`}>
      <div className="flex items-center justify-between gap-2">
        <h4 className={`text-[11px] font-black uppercase tracking-wider ${dark ? "text-white" : "text-[#111827]"}`}>Assigned Actionables</h4>
        {loading && (
          <span className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-content-muted">
            <RefreshCw className="w-3 h-3 animate-spin" />
            Loading…
          </span>
        )}
      </div>
      {error ? (
        <p className="text-[12px] font-semibold text-red-500">{error}</p>
      ) : !loading && shown.length === 0 ? (
        <p className="text-[12px] text-content-muted">No actionables assigned yet.</p>
      ) : (
        <div className="flex flex-col">
          {shown.map((a) => (
            <div key={a.id} className={`flex items-center justify-between gap-3 py-2 border-t first:border-t-0 ${dark ? "border-white/[0.08]" : "border-[var(--border)]"}`}>
              <div className="flex flex-col gap-0.5 min-w-0">
                <span className={`text-[12px] font-semibold truncate ${dark ? "text-slate-200" : "text-stone-800"}`}>{a.description || "Untitled actionable"}</span>
                <span className="text-[10px] font-semibold text-content-muted">
                  {a.dueDate ? `Due ${fmtDisplayDate(a.dueDate)}` : "No due date"} · Assigned {fmtDisplayDate(a.meetingDate)}
                </span>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <ActionableStatusSelect actionableId={a.id} status={a.status} dark={dark} onChanged={(next) => setActionableStatus(a.sessionId, a.id, next)} />
              </div>
            </div>
          ))}
          {hiddenCount > 0 && <p className="text-[10px] font-semibold text-content-muted pt-1">+{hiddenCount} more</p>}
        </div>
      )}
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

function QaFeedbackSection({ dark, tactId, data, loading, error }: { dark: boolean; tactId: string; data: SheetTableLike | null; loading: boolean; error: string }) {
  const [expanded, setExpanded] = useState(false);
  const [discussed, setDiscussed] = useState<Set<string>>(new Set());
  useEffect(() => {
    let cancelled = false;
    fetchDiscussedFeedback(tactId)
      .then((ids) => {
        if (!cancelled) setDiscussed(new Set(ids));
      })
      .catch(() => {
        /* left empty on failure — worst case a previously-discussed row
           briefly shows unchecked rather than blocking the whole section */
      });
    return () => {
      cancelled = true;
    };
  }, [tactId]);
  // Optimistic toggle with rollback on failure (same pattern as
  // ActionableStatusSelect's own status control) — the checkbox flips
  // immediately, and reverts if the PUT to persist it fails.
  const toggleDiscussed = async (id: string) => {
    const wasDiscussed = discussed.has(id);
    setDiscussed((prev) => {
      const next = new Set(prev);
      if (wasDiscussed) next.delete(id);
      else next.add(id);
      return next;
    });
    try {
      await putFeedbackDiscussed(tactId, id, !wasDiscussed);
    } catch {
      setDiscussed((prev) => {
        const next = new Set(prev);
        if (wasDiscussed) next.add(id);
        else next.delete(id);
        return next;
      });
    }
  };

  // Rating 5 evaluations are excluded entirely (Task 6 item 2) and only the
  // last 30 days are shown (item 5) — both narrow the underlying data, so
  // "View all N" counts/paginates the FILTERED list, not the raw fetch.
  const dateFiltered = (data?.rows || []).filter((r) => Number(r["Score"]) !== 5 && isWithinLastDays(r["Checked Date"], 30));

  // Domain filter (All / Chat / Call / Payment) — the sheet's own "Domain"
  // column stores the raw task-type code (CHAT / FIRST_CALL / PAYMENT_CALL,
  // same enum qaDataEngine.ts's TASK_TYPES uses server-side), not a friendly
  // label, so the filter matches against those raw codes rather than the
  // "Chat"/"Call"/"Payment" text the tab buttons display.
  const [domainFilter, setDomainFilter] = useState<"all" | "CHAT" | "FIRST_CALL" | "PAYMENT_CALL">("all");
  const rows =
    domainFilter === "all" ? dateFiltered : dateFiltered.filter((r) => String(r["Domain"] ?? "").trim().toUpperCase() === domainFilter);
  const shown = expanded ? rows : rows.slice(0, 5);
  return (
    <SectionCard dark={dark} title="QA Feedback" action={<ViewAllToggle dark={dark} expanded={expanded} total={rows.length} onToggle={() => setExpanded((v) => !v)} />}>
      {!loading && !error && !data?.error && dateFiltered.length > 0 && (
        <div className="mb-2">
          <SegmentedToggle
            value={domainFilter}
            onChange={setDomainFilter}
            options={[
              { value: "all", label: "All" },
              { value: "CHAT", label: "Chat" },
              { value: "FIRST_CALL", label: "Call" },
              { value: "PAYMENT_CALL", label: "Payment" },
            ]}
            dark={dark}
          />
        </div>
      )}
      {loading ? (
        <p className="text-[13px] text-content-muted py-2">Loading…</p>
      ) : error || data?.error ? (
        <p className="text-[13px] text-red-500 py-2">{error || data?.message || "Failed to load QA feedback."}</p>
      ) : dateFiltered.length === 0 ? (
        <p className="text-[13px] text-content-muted py-2">No QA feedback records from the last 30 days.</p>
      ) : rows.length === 0 ? (
        <p className="text-[13px] text-content-muted py-2">No QA feedback records match this filter.</p>
      ) : (
        <ul className="space-y-1.5 max-h-[50vh] overflow-auto">
          {shown.map((r, i) => {
            const id = feedbackRowIdentity(r, i);
            const isDiscussed = discussed.has(id);
            return (
              <li
                key={id}
                className={`rounded-lg border px-2.5 py-2 text-[12px] flex items-start gap-2.5 transition-opacity ${dark ? "border-white/[0.06]" : "border-stone-100"} ${
                  isDiscussed ? "opacity-50" : ""
                }`}
              >
                {/* Fixed-width column — Chat ID on top, rating below (Task 6
                    item 4) — every row's two anchor values line up here
                    regardless of how long the date/domain/flag text on the
                    right runs. */}
                <div className="w-[92px] shrink-0 flex flex-col gap-1">
                  {r["Chat ID"] ? <ChatIdLink value={r["Chat ID"]} dark={dark} /> : <span className="text-[11px] text-content-muted">—</span>}
                  <span className={`inline-flex w-fit px-2 py-0.5 rounded-full text-[11px] font-black ${scoreChipClass(r["Score"], dark)}`}>{fmtCell(r["Score"])}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <span className="flex items-center gap-2 font-bold">
                      <span className={dark ? "text-slate-300" : "text-stone-600"}>{fmtCell(r["Checked Date"])}</span>
                      <span className={dark ? "text-slate-500" : "text-stone-400"}>·</span>
                      <span>{fmtCell(r["Domain"])}</span>
                    </span>
                    <label className={`flex items-center gap-1.5 text-[11px] font-bold cursor-pointer shrink-0 ${dark ? "text-slate-300" : "text-stone-600"}`}>
                      <input type="checkbox" checked={isDiscussed} onChange={() => toggleDiscussed(id)} className="cursor-pointer" />
                      Discussed
                    </label>
                  </div>
                  {(r["Red Flags"] || r["Orange Flags"] || r["Green Flags"]) && (
                    <div className="mt-1.5 space-y-1 text-[11px]">
                      {r["Red Flags"] ? <FlagLine dot="bg-red-500" text={String(r["Red Flags"])} /> : null}
                      {r["Orange Flags"] ? <FlagLine dot="bg-amber-500" text={String(r["Orange Flags"])} /> : null}
                      {r["Green Flags"] ? <FlagLine dot="bg-emerald-500" text={String(r["Green Flags"])} /> : null}
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </SectionCard>
  );
}

function DisputesEscalationsSection({ dark, data, loading, error }: { dark: boolean; data: SheetTableLike | null; loading: boolean; error: string }) {
  const [expanded, setExpanded] = useState(false);
  // Last 30 days only (Task 6 item 5) — same fail-open date parsing as QA
  // Feedback's own filter.
  const rows = (data?.rows || []).filter((r) => isWithinLastDays(r["Raised"], 30));
  const shown = expanded ? rows : rows.slice(0, 5);
  return (
    <SectionCard dark={dark} title="Disputes & Escalations" action={<ViewAllToggle dark={dark} expanded={expanded} total={rows.length} onToggle={() => setExpanded((v) => !v)} />}>
      {loading ? (
        <p className="text-[13px] text-content-muted py-2">Loading…</p>
      ) : error || data?.error ? (
        <p className="text-[13px] text-red-500 py-2">{error || data?.message || "Failed to load disputes & escalations."}</p>
      ) : rows.length === 0 ? (
        <p className="text-[13px] text-content-muted py-2">No disputes or escalations from the last 30 days.</p>
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

  // Toggle switch below the Current Month score cards (Task 6 item 1) —
  // replaces the previous QA Feedback / Disputes & Escalations / Feedback
  // Summary stack with one section shown at a time. "Session Feedback"
  // renders the existing Feedback Summary content, per the spec's own
  // wording — no new component, just a new tab label pointing at it.
  const [insightsTab, setInsightsTab] = useState<"qa_feedback" | "disputes" | "session_feedback">("qa_feedback");

  const [feedback, setFeedback] = useState<SheetTableLike | null>(null);
  const [feedbackLoading, setFeedbackLoading] = useState(true);
  const [feedbackError, setFeedbackError] = useState("");
  const [reviews, setReviews] = useState<SheetTableLike | null>(null);
  const [reviewsLoading, setReviewsLoading] = useState(true);
  const [reviewsError, setReviewsError] = useState("");
  // Bumped after a Session Feedback Save so this advisor's Feedback
  // Summary refetches without a full page reload.
  const [feedbackRefreshSignal, setFeedbackRefreshSignal] = useState(0);

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
      <div className="flex justify-center sm:justify-start">
        <SegmentedToggle
          value={insightsTab}
          onChange={setInsightsTab}
          options={[
            { value: "qa_feedback", label: "QA Feedback" },
            { value: "disputes", label: "Disputes & Escalations" },
            { value: "session_feedback", label: "Session Feedback" },
          ]}
          dark={dark}
        />
      </div>
      {insightsTab === "qa_feedback" && <QaFeedbackSection dark={dark} tactId={pivot.tactId} data={feedback} loading={feedbackLoading} error={feedbackError} />}
      {insightsTab === "disputes" && <DisputesEscalationsSection dark={dark} data={reviews} loading={reviewsLoading} error={reviewsError} />}
      {/* Session Feedback tab — the existing Feedback Summary content, per
          the spec's own wording ("The Session Feedback tab should display
          the existing Feedback Summary content"). Full editable control,
          restored here per an earlier explicit request ("the full control
          of this program should be within team tracker page itself"). The
          QA Dashboard's own self-view shows a separate, read-only
          rendering of this same history for the advisor (see
          ReadOnlyFeedbackSummarySection in QaDashboardPage.tsx) — distinct
          sections, distinct pages, only this one is editable. The floating
          add-new-entry button stays mounted regardless of the active tab —
          it's a persistent trigger, not tab content. */}
      {insightsTab === "session_feedback" && <FeedbackSummarySection dark={dark} tactId={pivot.tactId} refreshSignal={feedbackRefreshSignal} />}
      <SessionFeedbackWorkspace dark={dark} tactId={pivot.tactId} advisorName={pivot.name || pivot.tactId} onSaved={() => setFeedbackRefreshSignal((v) => v + 1)} />
    </div>
  );
}
