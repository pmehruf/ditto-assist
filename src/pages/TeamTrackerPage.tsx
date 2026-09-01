/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Fragment, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  RefreshCw,
  Users2,
  TrendingUp,
  TrendingDown,
  Minus,
  Trophy,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  CircleOff,
} from "lucide-react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { CustomSelect, type CustomSelectOption } from "../components/CustomSelect";
import { ClippedButton } from "../components/ClippedButton";

/**
 * TEAM QA PERFORMANCE TRACKER ("Team Tracker")
 * ---------------------------------------------------------------
 * A manager-facing companion to the QA Dashboard — same underlying QA data
 * and scoring (src/server/qaDashboard/teamTrackerService.ts calls the exact
 * same getAdvisorsBatchMetrics function the QA Dashboard's own roster view
 * uses, just once per calendar month instead of once per date range). This
 * page adds NO new QA calculation of its own beyond a single, already-
 * established composite ("Cumulative Score" = average of Lead Score +
 * Payment QA Score, same definition as the Home page's "Consolidated
 * Score" widget) — see teamTrackerService.ts.
 *
 * The server still answers with one row per (advisor, month) — see
 * MonthlyAdvisorRow below, unchanged from the server's own shape. Every
 * pivot/insight computed in this file (one-row-per-advisor table, Top 5/
 * Bottom 5, Most Improved/Declined, best/weakest medium, etc.) is a pure
 * client-side reshape of those same numbers; nothing here recomputes a QA
 * score.
 *
 * Visible only to Admin/Guide/Mentor (App.tsx gates the sidebar link on the
 * same /team-tracker/context probe this page itself uses) — a plain
 * Advisor has no team to track, so unlike the QA Dashboard there is no
 * "see your own record" fallback here.
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
  paymentsAvg: number | null;
  paymentsInstances: number;
  chatAvg: number | null;
  chatInstances: number;
  callAvg: number | null;
  callInstances: number;
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
type Medium = "all" | "lead" | "payment" | "chat" | "call";

const SCORE_DANGER = 3.5;
const SCORE_WARN = 3.75;

// Same danger/warn thresholds and treatment QaDashboardPage.tsx's
// scoreFlagClasses uses, reproduced locally (this file intentionally
// doesn't import from QaDashboardPage.tsx — see teamTrackerService.ts's
// header comment on staying a separate, additive surface). Absolute
// quality (this) is a deliberately separate signal from month-over-month
// trend (see TrendArrow below) — a cell can be a "good" 4.2 that just
// dropped from 4.6, or a "poor" 3.1 that just climbed from 2.8.
function scoreFlagClasses(value: number | null | undefined, dark: boolean): string {
  if (value === null || value === undefined) return "border-l-4 border-l-transparent";
  if (value < SCORE_DANGER) return dark ? "border-l-4 border-l-red-500 text-red-300 font-bold" : "border-l-4 border-l-red-500 text-red-700 font-bold";
  if (value < SCORE_WARN) return dark ? "border-l-4 border-l-amber-500 text-amber-300 font-bold" : "border-l-4 border-l-amber-500 text-amber-700 font-bold";
  return "border-l-4 border-l-transparent";
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

function avgArr(vals: (number | null)[]): number | null {
  const nums = vals.filter((v): v is number => v !== null);
  if (nums.length === 0) return null;
  return Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 100) / 100;
}
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

const inputClass = (dark: boolean) =>
  `px-2.5 py-1.5 rounded-lg border text-xs font-semibold outline-none ${
    dark ? "bg-[#102236] border-[#1e3e5c] text-[#eff6ff]" : "bg-white border-stone-250 text-stone-850"
  }`;

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
  /** Sum of Lead+Payment+Chat+Call instances across the whole period —
   * zero means genuinely no QA activity at all in the selected period,
   * distinct from "had activity but scored low". */
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
  bestMedium: { name: string; avg: number } | null;
  weakestMedium: { name: string; avg: number } | null;
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

    const totalInstances = advisorRows.reduce(
      (sum, r) => sum + r.leadScoreInstances + r.paymentsInstances + r.chatInstances + r.callInstances,
      0
    );

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

    const mediums: { name: string; avg: number | null }[] = [
      { name: "Lead", avg: avgArr(advisorRows.map((r) => r.leadScoreAvg)) },
      { name: "Payment", avg: avgArr(advisorRows.map((r) => r.paymentsAvg)) },
      { name: "Chat", avg: avgArr(advisorRows.map((r) => r.chatAvg)) },
      { name: "Call", avg: avgArr(advisorRows.map((r) => r.callAvg)) },
    ];
    const scoredMediums = mediums.filter((m): m is { name: string; avg: number } => m.avg !== null);
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
      bestMedium,
      weakestMedium,
    });
  }

  pivots.sort((a, b) => a.name.localeCompare(b.name));
  return pivots;
}

interface TeamInsightsData {
  teamAvg: number | null;
  highest: AdvisorPivot | null;
  lowest: AdvisorPivot | null;
  top5: AdvisorPivot[];
  bottom5: AdvisorPivot[];
  mostImproved: AdvisorPivot | null;
  mostDeclined: AdvisorPivot | null;
  noActivity: AdvisorPivot[];
  totalMapped: number;
}

function computeInsights(pivots: AdvisorPivot[]): TeamInsightsData {
  const scored = pivots.filter((p) => p.avgCumulative !== null);
  const teamAvg = avgArr(scored.map((p) => p.avgCumulative));
  const ranked = [...scored].sort((a, b) => b.avgCumulative! - a.avgCumulative!);
  const highest = ranked.length ? ranked[0] : null;
  const lowest = ranked.length ? ranked[ranked.length - 1] : null;
  const top5 = ranked.slice(0, 5);
  const bottom5 = ranked.length > 5 ? [...ranked].slice(-5).reverse() : [...ranked].reverse();

  const changeable = pivots.filter((p) => p.change !== null);
  const mostImproved = changeable.length ? changeable.reduce((a, b) => (b.change! > a.change! ? b : a)) : null;
  const mostDeclined = changeable.length ? changeable.reduce((a, b) => (b.change! < a.change! ? b : a)) : null;

  const noActivity = pivots.filter((p) => !p.hasActivity);

  return {
    teamAvg,
    highest,
    lowest,
    top5,
    bottom5,
    mostImproved: mostImproved && mostImproved.change! > 0 ? mostImproved : null,
    mostDeclined: mostDeclined && mostDeclined.change! < 0 ? mostDeclined : null,
    noActivity,
    totalMapped: pivots.length,
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
  const [advisorFilter, setAdvisorFilter] = useState(""); // "" = All
  const [mediumFilter, setMediumFilter] = useState<Medium>("all");

  const [table, setTable] = useState<TeamTrackerTableResult | null>(null);
  const [tableLoading, setTableLoading] = useState(false);
  const [tableError, setTableError] = useState("");

  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const toggleExpanded = (tactId: string) => setExpanded((prev) => ({ ...prev, [tactId]: !prev[tactId] }));

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
          tactId: advisorFilter,
          fromMonth,
          toMonth,
        })}`
      );
      setTable(result);
      setExpanded({});
    } catch (err: any) {
      setTableError(err.message || "Failed to load Team Tracker data.");
      setTable(null);
    } finally {
      setTableLoading(false);
    }
  }, [context, period, customFrom, customTo, advisorFilter, selectedGuide, selectedMentor]);

  // Auto-load once a scope is resolved (Guide/Mentor immediately; Admin
  // right after picking) — mirrors the QA Dashboard's own "loads on entry,
  // Load/Refresh button for subsequent changes" convention.
  useEffect(() => {
    if (context && !context.needsSelection) {
      loadTable();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [context?.scopeLabel]);

  const handlePickGuide = (guide: string) => {
    setSelectedGuide(guide);
    setSelectedMentor("");
    setAdvisorFilter("");
    loadContext(guide, "");
  };
  const handlePickMentor = (mentor: string) => {
    setSelectedMentor(mentor);
    setSelectedGuide("");
    setAdvisorFilter("");
    loadContext("", mentor);
  };

  const periodOptions: CustomSelectOption[] = [
    { value: "3m", label: "Last 3 Months" },
    { value: "6m", label: "Last 6 Months" },
    { value: "1y", label: "Last 1 Year" },
    { value: "custom", label: "Custom" },
  ];
  const mediumOptions: CustomSelectOption[] = [
    { value: "all", label: "All (Cumulative)" },
    { value: "lead", label: "Lead" },
    { value: "payment", label: "Payment" },
    { value: "chat", label: "Chat" },
    { value: "call", label: "Call" },
  ];
  const advisorOptions: CustomSelectOption[] = useMemo(
    () => [{ value: "", label: "All mapped advisors" }, ...(context?.advisors || []).map((a) => ({ value: a.tactId, label: a.name || a.tactId }))],
    [context]
  );
  const guideOptions: CustomSelectOption[] = useMemo(() => (context?.guides || []).map((g) => ({ value: g, label: g })), [context]);
  const mentorOptions: CustomSelectOption[] = useMemo(() => (context?.mentors || []).map((m) => ({ value: m, label: m })), [context]);

  const pivots = useMemo(() => (table ? buildPivots(table.rows) : []), [table]);
  const insights = useMemo(() => computeInsights(pivots), [pivots]);

  // The metric each month's pivot cell shows — Cumulative by default, or a
  // single medium's own average when the Medium filter narrows to one.
  // Field key on MonthlyAdvisorRow the metric comes from.
  const metricField: keyof MonthlyAdvisorRow =
    mediumFilter === "lead" ? "leadScoreAvg" : mediumFilter === "payment" ? "paymentsAvg" : mediumFilter === "chat" ? "chatAvg" : mediumFilter === "call" ? "callAvg" : "cumulativeScore";
  const metricLabel = mediumFilter === "all" ? "Cumulative Score" : mediumOptions.find((o) => o.value === mediumFilter)?.label + " QA";

  const cellClass = `px-3 py-2 border-b ${dark ? "border-white/[0.05]" : "border-stone-100"}`;
  const headClass = `sticky top-0 z-10 text-left py-2 px-3 font-bold whitespace-nowrap border-b ${
    dark ? "bg-[#0d1c3f] border-white/[0.16] text-slate-300" : "bg-[#f5f5f4] border-stone-200 text-stone-700"
  }`;

  // ── Loading / unauthorized states ──────────────────────────────────────
  if (contextLoading) {
    return (
      <div className="space-y-4">
        <h1 className="text-page-title flex items-center gap-2">
          <Users2 className="w-5 h-5" />
          Team Tracker
        </h1>
        <p className="text-xs text-content-muted">Loading…</p>
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
          className={`flex items-start gap-2 p-3 rounded-lg border text-xs font-semibold ${
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
          <p className="text-xs mt-1 font-semibold text-content-muted">Admin view — choose a Guide or Mentor to see their team's QA performance.</p>
        </div>
        <div className={`flex flex-wrap items-end gap-3 rounded-2xl border p-4 ${dark ? "bg-white/[0.05] border-white/[0.10]" : "bg-surface-elevated border-[var(--border-strong)]"}`}>
          <label className="flex flex-col gap-1 flex-1 min-w-[200px]">
            <span className="text-[10px] font-bold uppercase tracking-wider text-content-muted">Guide</span>
            <CustomSelect
              theme={theme}
              value={selectedGuide}
              onChange={handlePickGuide}
              options={guideOptions}
              placeholder="Select a Guide…"
              triggerClassName={`w-full flex items-center justify-between gap-2 pl-2.5 pr-8 py-1.5 rounded-lg border outline-none text-xs font-semibold cursor-pointer relative ${
                dark ? "bg-[#102236] border-[#1e3e5c] text-[#eff6ff]" : "bg-white border-stone-250 text-stone-850"
              }`}
            />
          </label>
          <label className="flex flex-col gap-1 flex-1 min-w-[200px]">
            <span className="text-[10px] font-bold uppercase tracking-wider text-content-muted">Mentor</span>
            <CustomSelect
              theme={theme}
              value={selectedMentor}
              onChange={handlePickMentor}
              options={mentorOptions}
              placeholder="Select a Mentor…"
              triggerClassName={`w-full flex items-center justify-between gap-2 pl-2.5 pr-8 py-1.5 rounded-lg border outline-none text-xs font-semibold cursor-pointer relative ${
                dark ? "bg-[#102236] border-[#1e3e5c] text-[#eff6ff]" : "bg-white border-stone-250 text-stone-850"
              }`}
            />
          </label>
        </div>
      </div>
    );
  }

  // ── Main view ───────────────────────────────────────────────────────────
  return (
    <div className="space-y-5 pb-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className={`text-page-title tracking-tight flex items-center gap-2 ${dark ? "text-white" : "text-[#111827]"}`}>
            <Users2 className="w-5 h-5" />
            <span>Team Tracker</span>
          </h1>
          <p className="text-xs mt-1 font-semibold text-content-muted">
            {context.scopeLabel}
            {context.isAdmin && (
              <button type="button" onClick={() => loadContext("", "")} className={`ml-2 underline cursor-pointer ${dark ? "text-blue-300" : "text-blue-700"}`}>
                Change Guide/Mentor
              </button>
            )}
          </p>
        </div>
      </div>

      {/* FILTERS */}
      <div className={`flex flex-wrap items-end gap-3 rounded-2xl border p-4 ${dark ? "bg-white/[0.05] border-white/[0.10]" : "bg-surface-elevated border-[var(--border-strong)]"}`}>
        <label className="flex flex-col gap-1 w-44">
          <span className="text-[10px] font-bold uppercase tracking-wider text-content-muted">Period</span>
          <CustomSelect theme={theme} value={period} onChange={(v) => setPeriod(v as Period)} options={periodOptions} triggerClassName={inputClass(dark) + " w-full flex items-center justify-between gap-2 pr-8 cursor-pointer relative"} />
        </label>
        {period === "custom" && (
          <>
            <label className="flex flex-col gap-1">
              <span className="text-[10px] font-bold uppercase tracking-wider text-content-muted">From</span>
              <input type="month" value={customFrom} max={customTo} onChange={(e) => setCustomFrom(e.target.value)} className={inputClass(dark)} />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[10px] font-bold uppercase tracking-wider text-content-muted">To</span>
              <input type="month" value={customTo} min={customFrom} onChange={(e) => setCustomTo(e.target.value)} className={inputClass(dark)} />
            </label>
          </>
        )}
        <label className="flex flex-col gap-1 w-56">
          <span className="text-[10px] font-bold uppercase tracking-wider text-content-muted">Advisor</span>
          <CustomSelect theme={theme} value={advisorFilter} onChange={setAdvisorFilter} options={advisorOptions} triggerClassName={inputClass(dark) + " w-full flex items-center justify-between gap-2 pr-8 cursor-pointer relative"} />
        </label>
        <label className="flex flex-col gap-1 w-44">
          <span className="text-[10px] font-bold uppercase tracking-wider text-content-muted">Medium</span>
          <CustomSelect theme={theme} value={mediumFilter} onChange={(v) => setMediumFilter(v as Medium)} options={mediumOptions} triggerClassName={inputClass(dark) + " w-full flex items-center justify-between gap-2 pr-8 cursor-pointer relative"} />
        </label>
        <ClippedButton onClick={loadTable} size="md" className="h-8 gap-2 px-4 text-xs font-bold text-white hover:brightness-110 shrink-0" style={{ background: "#1f2d3d" }}>
          <RefreshCw className="w-3 h-3" />
          {tableLoading ? "Loading…" : "Load"}
        </ClippedButton>
      </div>

      {tableError ? (
        <div className={`flex items-start gap-2 p-3 rounded-lg border text-xs font-semibold ${dark ? "bg-red-500/10 border-red-500/30 text-red-300" : "bg-red-50 border-red-200 text-red-700"}`}>
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{tableError}</span>
        </div>
      ) : (
        <>
          <TeamInsights dark={dark} insights={insights} onFocusAdvisor={(tactId) => { setExpanded((prev) => ({ ...prev, [tactId]: true })); }} />
          <TeamPivotTable
            dark={dark}
            pivots={pivots}
            months={table?.months || []}
            metricField={metricField}
            metricLabel={metricLabel || "Cumulative Score"}
            loading={tableLoading}
            expanded={expanded}
            onToggle={toggleExpanded}
            theme={theme}
            cellClass={cellClass}
            headClass={headClass}
          />
        </>
      )}
    </div>
  );
}

// ── Team insights ────────────────────────────────────────────────────────
function TeamInsights({
  dark,
  insights,
  onFocusAdvisor,
}: {
  dark: boolean;
  insights: TeamInsightsData;
  onFocusAdvisor: (tactId: string) => void;
}) {
  const card = `rounded-xl border p-3 flex flex-col gap-1 ${dark ? "bg-white/[0.03] border-white/[0.08]" : "bg-white border-[var(--border)]"}`;
  const label = "text-[10px] font-bold uppercase tracking-wider text-content-muted";

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
        <div className={card}>
          <span className={label}>Team Average QA</span>
          <span className={`text-2xl font-black ${dark ? "text-white" : "text-stone-900"}`}>{insights.teamAvg ?? "—"}</span>
        </div>
        <div className={card}>
          <span className={label}>Highest Performer</span>
          <div className="flex items-center gap-1.5">
            <Trophy className="w-3.5 h-3.5 text-amber-500 shrink-0" />
            <button
              onClick={() => insights.highest && onFocusAdvisor(insights.highest.tactId)}
              className={`text-sm font-bold truncate text-left cursor-pointer hover:underline ${dark ? "text-white" : "text-stone-900"}`}
            >
              {insights.highest ? insights.highest.name : "—"}
            </button>
          </div>
          {insights.highest && <span className="text-xs font-semibold text-emerald-500">{insights.highest.avgCumulative}</span>}
        </div>
        <div className={card}>
          <span className={label}>Lowest Performer</span>
          <button
            onClick={() => insights.lowest && onFocusAdvisor(insights.lowest.tactId)}
            className={`text-sm font-bold truncate text-left cursor-pointer hover:underline ${dark ? "text-white" : "text-stone-900"}`}
          >
            {insights.lowest ? insights.lowest.name : "—"}
          </button>
          {insights.lowest && <span className={`text-xs font-semibold ${insights.lowest.avgCumulative! < SCORE_DANGER ? "text-red-500" : "text-content-muted"}`}>{insights.lowest.avgCumulative}</span>}
        </div>
        <div className={card}>
          <span className={label}>Total Mapped Advisors</span>
          <span className={`text-2xl font-black ${dark ? "text-white" : "text-stone-900"}`}>{insights.totalMapped}</span>
        </div>
        <div className={card}>
          <span className={label}>No QA Activity</span>
          <span className={`text-2xl font-black ${insights.noActivity.length > 0 ? "text-amber-500" : dark ? "text-white" : "text-stone-900"}`}>{insights.noActivity.length}</span>
          {insights.noActivity.length > 0 && (
            <span className="text-[10px] text-content-muted truncate" title={insights.noActivity.map((a) => a.name).join(", ")}>
              {insights.noActivity
                .slice(0, 3)
                .map((a) => a.name)
                .join(", ")}
              {insights.noActivity.length > 3 ? ` +${insights.noActivity.length - 3} more` : ""}
            </span>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <RankedList title="Top 5 Performers" icon={<Trophy className="w-3.5 h-3.5 text-amber-500" />} entries={insights.top5} dark={dark} tone="good" onSelect={onFocusAdvisor} />
        <RankedList title="Bottom 5 Performers" icon={<AlertTriangle className="w-3.5 h-3.5 text-red-500" />} entries={insights.bottom5} dark={dark} tone="poor" onSelect={onFocusAdvisor} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className={card}>
          <span className={label}>Most Improved</span>
          {insights.mostImproved ? (
            <button onClick={() => onFocusAdvisor(insights.mostImproved!.tactId)} className="flex items-center justify-between gap-2 cursor-pointer">
              <span className={`text-sm font-bold hover:underline ${dark ? "text-white" : "text-stone-900"}`}>{insights.mostImproved.name}</span>
              <span className="flex items-center gap-1 text-xs font-black text-emerald-500">
                <TrendingUp className="w-3.5 h-3.5" />+{insights.mostImproved.change}
              </span>
            </button>
          ) : (
            <span className="text-sm text-content-muted">Not enough data yet</span>
          )}
        </div>
        <div className={card}>
          <span className={label}>Most Declined</span>
          {insights.mostDeclined ? (
            <button onClick={() => onFocusAdvisor(insights.mostDeclined!.tactId)} className="flex items-center justify-between gap-2 cursor-pointer">
              <span className={`text-sm font-bold hover:underline ${dark ? "text-white" : "text-stone-900"}`}>{insights.mostDeclined.name}</span>
              <span className="flex items-center gap-1 text-xs font-black text-red-500">
                <TrendingDown className="w-3.5 h-3.5" />
                {insights.mostDeclined.change}
              </span>
            </button>
          ) : (
            <span className="text-sm text-content-muted">Not enough data yet</span>
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
}: {
  title: string;
  icon: ReactNode;
  entries: AdvisorPivot[];
  dark: boolean;
  tone: "good" | "poor";
  onSelect: (tactId: string) => void;
}) {
  return (
    <div className={`rounded-xl border p-3 ${dark ? "bg-white/[0.03] border-white/[0.08]" : "bg-white border-[var(--border)]"}`}>
      <div className="flex items-center gap-1.5 mb-2">
        {icon}
        <h3 className={`text-xs font-black uppercase tracking-wider ${dark ? "text-white" : "text-[#111827]"}`}>{title}</h3>
      </div>
      {entries.length === 0 ? (
        <p className="text-xs text-content-muted py-2">No scored advisors yet.</p>
      ) : (
        <ol className="space-y-1">
          {entries.map((a, i) => (
            <li key={a.tactId}>
              <button
                onClick={() => onSelect(a.tactId)}
                className={`w-full flex items-center justify-between gap-2 px-2 py-1.5 rounded-lg cursor-pointer transition-colors ${dark ? "hover:bg-white/[0.05]" : "hover:bg-stone-50"}`}
              >
                <span className="flex items-center gap-2 min-w-0">
                  <span className="text-[10px] font-bold text-content-muted w-4 shrink-0">{i + 1}</span>
                  <span className={`text-xs font-bold truncate ${dark ? "text-white" : "text-stone-900"}`}>{a.name}</span>
                </span>
                <span className={`text-xs font-black shrink-0 ${tone === "good" ? "text-emerald-500" : "text-red-500"}`}>{a.avgCumulative}</span>
              </button>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

// ── Team pivot table — one row per advisor, months as columns ────────────
function TeamPivotTable({
  dark,
  theme,
  pivots,
  months,
  metricField,
  metricLabel,
  loading,
  expanded,
  onToggle,
  cellClass,
  headClass,
}: {
  dark: boolean;
  theme: "light" | "dark";
  pivots: AdvisorPivot[];
  months: MonthSpec[];
  metricField: keyof MonthlyAdvisorRow;
  metricLabel: string;
  loading: boolean;
  expanded: Record<string, boolean>;
  onToggle: (tactId: string) => void;
  cellClass: string;
  headClass: string;
}) {
  return (
    <div className={`rounded-xl border overflow-hidden ${dark ? "border-white/[0.08]" : "border-[var(--border)]"}`}>
      <div className="flex items-center justify-between px-3 py-2 border-b text-[10px] font-bold uppercase tracking-wider text-content-muted border-inherit">
        <span>Showing: {metricLabel}</span>
        <span>{pivots.length} advisor{pivots.length === 1 ? "" : "s"}</span>
      </div>
      {/* Own scroll container, capped well below the viewport so the table
          never grows the page itself — every mapped advisor is reachable
          by scrolling here, none are cut off by the initial viewport (see
          the "Table usability" requirement). sticky top-0 on each <th>
          (headClass) keeps the header pinned while scrolling. */}
      <div className="max-h-[65vh] overflow-auto">
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr>
              <th className={headClass + " min-w-[180px]"}>Advisor</th>
              {months.map((m) => (
                <th key={m.key} className={headClass + " text-center"}>
                  {m.label}
                </th>
              ))}
              <th className={headClass + " text-center"}>Period Avg</th>
            </tr>
          </thead>
          <tbody>
            {pivots.length === 0 ? (
              <tr>
                <td colSpan={months.length + 2} className="px-3 py-6 text-center text-content-muted">
                  {loading ? "Loading…" : "No mapped advisors found for this scope."}
                </td>
              </tr>
            ) : (
              pivots.map((p) => (
                <Fragment key={p.tactId}>
                  <PivotAdvisorRows
                    dark={dark}
                    theme={theme}
                    pivot={p}
                    months={months}
                    metricField={metricField}
                    isExpanded={!!expanded[p.tactId]}
                    onToggle={() => onToggle(p.tactId)}
                    cellClass={cellClass}
                  />
                </Fragment>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PivotAdvisorRows({
  dark,
  theme,
  pivot,
  months,
  metricField,
  isExpanded,
  onToggle,
  cellClass,
}: {
  dark: boolean;
  theme: "light" | "dark";
  pivot: AdvisorPivot;
  months: MonthSpec[];
  metricField: keyof MonthlyAdvisorRow;
  isExpanded: boolean;
  onToggle: () => void;
  cellClass: string;
}) {
  const ordered = months.map((m) => pivot.monthly[m.key]).filter(Boolean);

  return (
    <>
      <tr className={`transition-colors ${dark ? "hover:bg-white/[0.03]" : "odd:bg-black/[0.015] hover:bg-stone-50"}`}>
        <td className={cellClass}>
          <button onClick={onToggle} className={`flex items-center gap-1.5 font-bold text-left cursor-pointer w-full ${dark ? "text-blue-300" : "text-blue-700"}`}>
            {isExpanded ? <ChevronDown className="w-3.5 h-3.5 shrink-0" /> : <ChevronRight className="w-3.5 h-3.5 shrink-0" />}
            <span className="truncate">{pivot.name}</span>
            {!pivot.hasActivity && (
              <span title="No QA activity this period">
                <CircleOff className="w-3 h-3 shrink-0 text-content-muted" />
              </span>
            )}
          </button>
        </td>
        {months.map((m, i) => {
          const row = pivot.monthly[m.key];
          const val = row ? (row[metricField] as number | null) : null;
          const prevRow = i > 0 ? pivot.monthly[months[i - 1].key] : undefined;
          const prevVal = prevRow ? (prevRow[metricField] as number | null) : null;
          return (
            <td key={m.key} className={cellClass + " text-center"}>
              {val === null ? (
                <span className="text-content-muted italic">NA</span>
              ) : (
                <span className="inline-flex items-center gap-1 justify-center">
                  <span className={`inline-block pl-2 ${scoreFlagClasses(val, dark)}`}>{val}</span>
                  <TrendArrow curr={val} prev={prevVal} />
                </span>
              )}
            </td>
          );
        })}
        <td className={cellClass + " text-center"}>
          <span className="font-black">{pivot.avgCumulative ?? "—"}</span>
        </td>
      </tr>

      {isExpanded && (
        <tr>
          <td colSpan={months.length + 2} className={`p-0 border-b ${dark ? "border-white/[0.05]" : "border-stone-100"}`}>
            <AdvisorExpandedPanel dark={dark} theme={theme} pivot={pivot} orderedRows={ordered} />
          </td>
        </tr>
      )}
    </>
  );
}

// ── Expanded advisor detail — insights strip, trend chart, full monthly
// breakdown. Rendered inline under the advisor's own row (see
// PivotAdvisorRows above) rather than navigating to a separate view, so
// several advisors can stay open side by side for comparison. ────────────
function AdvisorExpandedPanel({
  dark,
  theme,
  pivot,
  orderedRows,
}: {
  dark: boolean;
  theme: "light" | "dark";
  pivot: AdvisorPivot;
  orderedRows: MonthlyAdvisorRow[];
}) {
  const chartData = orderedRows.map((r) => ({ month: r.monthLabel, score: r.cumulativeScore }));
  const hasChartData = chartData.filter((d) => d.score !== null).length > 1;

  const statClass = "flex flex-col gap-0.5";
  const statLabel = "text-[9px] font-bold uppercase tracking-wider text-content-muted";
  const statValue = `text-sm font-black ${dark ? "text-white" : "text-stone-900"}`;

  return (
    <div className={`p-4 space-y-4 ${dark ? "bg-black/[0.15]" : "bg-stone-50/70"}`}>
      {/* Advisor-level insights */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
        <div className={statClass}>
          <span className={statLabel}>Period Avg</span>
          <span className={statValue}>{pivot.avgCumulative ?? "—"}</span>
        </div>
        <div className={statClass}>
          <span className={statLabel}>Highest Month</span>
          <span className={`${statValue} text-emerald-500`}>{pivot.highest ? `${pivot.highest.score} (${pivot.highest.monthLabel})` : "—"}</span>
        </div>
        <div className={statClass}>
          <span className={statLabel}>Lowest Month</span>
          <span className={`${statValue} ${pivot.lowest && pivot.lowest.score < SCORE_DANGER ? "text-red-500" : ""}`}>{pivot.lowest ? `${pivot.lowest.score} (${pivot.lowest.monthLabel})` : "—"}</span>
        </div>
        <div className={statClass}>
          <span className={statLabel}>Change (First → Latest)</span>
          <span className={`${statValue} flex items-center gap-1 ${pivot.change === null ? "" : pivot.change > 0 ? "text-emerald-500" : pivot.change < 0 ? "text-red-500" : ""}`}>
            {pivot.change !== null && (pivot.change > 0 ? <TrendingUp className="w-3.5 h-3.5" /> : pivot.change < 0 ? <TrendingDown className="w-3.5 h-3.5" /> : <Minus className="w-3.5 h-3.5" />)}
            {pivot.change === null ? "—" : `${pivot.change > 0 ? "+" : ""}${pivot.change}`}
          </span>
        </div>
        <div className={statClass}>
          <span className={statLabel}>Best Medium</span>
          <span className={`${statValue} text-emerald-500`}>{pivot.bestMedium ? `${pivot.bestMedium.name} (${pivot.bestMedium.avg})` : "—"}</span>
        </div>
        <div className={statClass}>
          <span className={statLabel}>Weakest Medium</span>
          <span className={`${statValue} ${pivot.weakestMedium && pivot.weakestMedium.avg < SCORE_DANGER ? "text-red-500" : ""}`}>{pivot.weakestMedium ? `${pivot.weakestMedium.name} (${pivot.weakestMedium.avg})` : "—"}</span>
        </div>
        <div className={statClass}>
          <span className={statLabel}>Total QA Instances</span>
          <span className={statValue}>{pivot.totalInstances}</span>
        </div>
      </div>

      {hasChartData && (
        <div className={`rounded-xl border p-3 ${dark ? "bg-white/[0.03] border-white/[0.08]" : "bg-white border-[var(--border)]"}`}>
          <h4 className={`text-[10px] font-black uppercase tracking-wider mb-2 ${dark ? "text-white" : "text-[#111827]"}`}>Cumulative Score Trend</h4>
          <div className="w-full h-40 font-sans text-[10px] font-bold">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 8, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={theme === "dark" ? "#1F2937" : "#E5E7EB"} />
                <XAxis dataKey="month" stroke={theme === "dark" ? "#9CA3AF" : "#4B5563"} fontSize={9} tickLine={false} />
                <YAxis domain={[0, 5]} stroke={theme === "dark" ? "#9CA3AF" : "#4B5563"} fontSize={9} tickLine={false} />
                <Tooltip
                  content={({ active, payload, label }) => {
                    if (active && payload && payload.length) {
                      return (
                        <div className={`p-2 rounded-lg border text-[10px] font-sans shadow-lg font-bold ${dark ? "bg-stone-900 border-stone-800 text-zinc-100" : "bg-white border-stone-200 text-stone-950"}`}>
                          <p className="opacity-75 mb-0.5">{label}</p>
                          <p className="font-black">{payload[0].value ?? "NA"}</p>
                        </div>
                      );
                    }
                    return null;
                  }}
                />
                <Line type="monotone" dataKey="score" stroke="#117FDA" strokeWidth={2} dot={{ r: 2.5 }} connectNulls />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Full monthly breakdown */}
      <div className={`rounded-xl border overflow-hidden ${dark ? "border-white/[0.08]" : "border-[var(--border)]"}`}>
        <div className="max-h-[40vh] overflow-auto">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr>
                <th className={`sticky top-0 z-10 text-left py-2 px-3 font-bold whitespace-nowrap border-b ${dark ? "bg-[#0d1c3f] border-white/[0.16] text-slate-300" : "bg-[#f5f5f4] border-stone-200 text-stone-700"}`}>Month</th>
                {["Lead Score", "Lead Instances", "Payment QA", "Payment Instances", "Chat QA", "Chat Instances", "Call QA", "Call Instances", "Cumulative Score"].map((h) => (
                  <th key={h} className={`sticky top-0 z-10 text-left py-2 px-3 font-bold whitespace-nowrap border-b ${dark ? "bg-[#0d1c3f] border-white/[0.16] text-slate-300" : "bg-[#f5f5f4] border-stone-200 text-stone-700"}`}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {orderedRows.map((r) => (
                <tr key={r.monthKey} className={`transition-colors ${dark ? "hover:bg-white/[0.03]" : "odd:bg-black/[0.015] hover:bg-stone-50"}`}>
                  <td className={`px-3 py-2 border-b ${dark ? "border-white/[0.05]" : "border-stone-100"}`}>{r.monthLabel}</td>
                  <td className={`px-3 py-2 border-b ${dark ? "border-white/[0.05]" : "border-stone-100"}`}>
                    <div className={`inline-block pl-2.5 ${scoreFlagClasses(r.leadScoreAvg, dark)}`}>{r.leadScoreAvg ?? "NA"}</div>
                  </td>
                  <td className={`px-3 py-2 border-b ${dark ? "border-white/[0.05]" : "border-stone-100"}`}>{r.leadScoreInstances}</td>
                  <td className={`px-3 py-2 border-b ${dark ? "border-white/[0.05]" : "border-stone-100"}`}>
                    <div className={`inline-block pl-2.5 ${scoreFlagClasses(r.paymentsAvg, dark)}`}>{r.paymentsAvg ?? "NA"}</div>
                  </td>
                  <td className={`px-3 py-2 border-b ${dark ? "border-white/[0.05]" : "border-stone-100"}`}>{r.paymentsInstances}</td>
                  <td className={`px-3 py-2 border-b ${dark ? "border-white/[0.05]" : "border-stone-100"}`}>{r.chatAvg ?? "NA"}</td>
                  <td className={`px-3 py-2 border-b ${dark ? "border-white/[0.05]" : "border-stone-100"}`}>{r.chatInstances}</td>
                  <td className={`px-3 py-2 border-b ${dark ? "border-white/[0.05]" : "border-stone-100"}`}>{r.callAvg ?? "NA"}</td>
                  <td className={`px-3 py-2 border-b ${dark ? "border-white/[0.05]" : "border-stone-100"}`}>{r.callInstances}</td>
                  <td className={`px-3 py-2 border-b ${dark ? "border-white/[0.05]" : "border-stone-100"}`}>
                    <span className="font-black">{r.cumulativeScore ?? "NA"}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
