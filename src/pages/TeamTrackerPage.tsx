/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCw, Users2, TrendingUp, TrendingDown, Minus, ArrowLeft, Trophy, AlertTriangle } from "lucide-react";
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
 * Score" widget).
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
// header comment on staying a separate, additive surface).
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

const inputClass = (dark: boolean) =>
  `px-2.5 py-1.5 rounded-lg border text-xs font-semibold outline-none ${
    dark ? "bg-[#102236] border-[#1e3e5c] text-[#eff6ff]" : "bg-white border-stone-250 text-stone-850"
  }`;

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

  const [period, setPeriod] = useState<Period>("3m");
  const [customFrom, setCustomFrom] = useState(() => periodToRange("3m").fromMonth);
  const [customTo, setCustomTo] = useState(() => periodToRange("3m").toMonth);
  const [advisorFilter, setAdvisorFilter] = useState(""); // "" = All
  const [mediumFilter, setMediumFilter] = useState<Medium>("all");

  const [table, setTable] = useState<TeamTrackerTableResult | null>(null);
  const [tableLoading, setTableLoading] = useState(false);
  const [tableError, setTableError] = useState("");

  const [selectedTactId, setSelectedTactId] = useState<string | null>(null);

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
    setSelectedTactId(null);
    loadContext(guide, "");
  };
  const handlePickMentor = (mentor: string) => {
    setSelectedMentor(mentor);
    setSelectedGuide("");
    setAdvisorFilter("");
    setSelectedTactId(null);
    loadContext("", mentor);
  };

  const periodOptions: CustomSelectOption[] = [
    { value: "3m", label: "Last 3 Months" },
    { value: "6m", label: "Last 6 Months" },
    { value: "1y", label: "Last 1 Year" },
    { value: "custom", label: "Custom" },
  ];
  const mediumOptions: CustomSelectOption[] = [
    { value: "all", label: "All" },
    { value: "lead", label: "Lead" },
    { value: "payment", label: "Payment" },
    { value: "chat", label: "Chat" },
    { value: "call", label: "Call" },
  ];
  const advisorOptions: CustomSelectOption[] = useMemo(
    () => [{ value: "", label: "All mapped advisors" }, ...(context?.advisors || []).map((a) => ({ value: a.tactId, label: a.name || a.tactId }))],
    [context]
  );
  const guideOptions: CustomSelectOption[] = useMemo(
    () => (context?.guides || []).map((g) => ({ value: g, label: g })),
    [context]
  );
  const mentorOptions: CustomSelectOption[] = useMemo(
    () => (context?.mentors || []).map((m) => ({ value: m, label: m })),
    [context]
  );

  // ── Team overview (computed client-side from already-fetched rows — no
  // extra server math, just aggregation of the per-advisor cumulativeScore
  // teamTrackerService.ts already computed). ─────────────────────────────
  const overview = useMemo(() => {
    if (!table || table.rows.length === 0 || table.months.length === 0) return null;

    const byAdvisor = new Map<string, MonthlyAdvisorRow[]>();
    for (const r of table.rows) {
      if (!byAdvisor.has(r.tactId)) byAdvisor.set(r.tactId, []);
      byAdvisor.get(r.tactId)!.push(r);
    }
    // Every advisor's own rows arrive already sorted by month ascending
    // (teamTrackerService.ts enumerates months in order) — sort defensively
    // anyway since this is purely a display concern.
    for (const rows of byAdvisor.values()) rows.sort((a, b) => (a.monthKey < b.monthKey ? -1 : 1));

    type Latest = { tactId: string; name: string; latest: number | null; prev: number | null };
    const latests: Latest[] = [];
    for (const [tactId, rows] of byAdvisor) {
      const withScore = rows.filter((r) => r.cumulativeScore !== null);
      const latest = withScore.length ? withScore[withScore.length - 1] : null;
      const prev = withScore.length > 1 ? withScore[withScore.length - 2] : null;
      latests.push({ tactId, name: rows[0].name, latest: latest?.cumulativeScore ?? null, prev: prev?.cumulativeScore ?? null });
    }

    const scored = latests.filter((l) => l.latest !== null) as (Latest & { latest: number })[];
    const teamAvg = avgArr(scored.map((l) => l.latest));
    const highest = scored.length ? scored.reduce((a, b) => (b.latest > a.latest ? b : a)) : null;
    const lowest = scored.length ? scored.reduce((a, b) => (b.latest < a.latest ? b : a)) : null;
    const improving = latests.filter((l) => l.latest !== null && l.prev !== null && l.latest > l.prev).length;
    const declining = latests.filter((l) => l.latest !== null && l.prev !== null && l.latest < l.prev).length;

    // Company/team-wide month-over-month trend line — average cumulative
    // score across every advisor, per month, for the small trend chart and
    // the Team Average's own MoM badge.
    const monthAverages = table.months.map((m) => ({
      key: m.key,
      label: m.label,
      avg: avgArr(table.rows.filter((r) => r.monthKey === m.key).map((r) => r.cumulativeScore)),
    }));
    const scoredMonths = monthAverages.filter((m) => m.avg !== null);
    const teamTrend =
      scoredMonths.length > 1 ? Math.round((scoredMonths[scoredMonths.length - 1].avg! - scoredMonths[scoredMonths.length - 2].avg!) * 100) / 100 : null;

    return { teamAvg, highest, lowest, improving, declining, monthAverages, teamTrend };
  }, [table]);

  // Rows respecting the Medium filter is purely which COLUMNS render, not
  // which rows — every medium's data still comes back from the server
  // regardless of this filter, so switching it is instant with no refetch.
  const sortedRows = useMemo(() => {
    if (!table) return [];
    return [...table.rows].sort((a, b) => (a.name === b.name ? (a.monthKey < b.monthKey ? -1 : 1) : a.name.localeCompare(b.name)));
  }, [table]);

  const drilldownRows = useMemo(() => {
    if (!table || !selectedTactId) return [];
    return table.rows.filter((r) => r.tactId === selectedTactId).sort((a, b) => (a.monthKey < b.monthKey ? -1 : 1));
  }, [table, selectedTactId]);

  const cellClass = `px-3 py-2 border-b ${dark ? "border-white/[0.05]" : "border-stone-100"}`;
  const headClass = `text-left py-2 px-3 font-bold whitespace-nowrap border-b ${
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
              <button
                type="button"
                onClick={() => loadContext("", "")}
                className={`ml-2 underline cursor-pointer ${dark ? "text-blue-300" : "text-blue-700"}`}
              >
                Change Guide/Mentor
              </button>
            )}
          </p>
        </div>
      </div>

      {selectedTactId ? (
        <AdvisorDrilldown
          dark={dark}
          theme={theme}
          rows={drilldownRows}
          onBack={() => setSelectedTactId(null)}
          cellClass={cellClass}
          headClass={headClass}
        />
      ) : (
        <>
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
            <label className="flex flex-col gap-1 w-36">
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
              {overview && <TeamOverview dark={dark} overview={overview} />}
              <MainTable
                dark={dark}
                rows={sortedRows}
                medium={mediumFilter}
                loading={tableLoading}
                onAdvisorSelect={setSelectedTactId}
                cellClass={cellClass}
                headClass={headClass}
              />
            </>
          )}
        </>
      )}
    </div>
  );
}

// ── Team overview strip ─────────────────────────────────────────────────
function TeamOverview({
  dark,
  overview,
}: {
  dark: boolean;
  overview: {
    teamAvg: number | null;
    highest: { name: string; latest: number } | null;
    lowest: { name: string; latest: number } | null;
    improving: number;
    declining: number;
    teamTrend: number | null;
  };
}) {
  const card = `rounded-xl border p-3 flex flex-col gap-1 ${dark ? "bg-white/[0.03] border-white/[0.08]" : "bg-white border-[var(--border)]"}`;
  const label = "text-[10px] font-bold uppercase tracking-wider text-content-muted";
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
      <div className={card}>
        <span className={label}>Team Average QA</span>
        <div className="flex items-center gap-2">
          <span className={`text-2xl font-black ${dark ? "text-white" : "text-stone-900"}`}>{overview.teamAvg ?? "—"}</span>
          {overview.teamTrend !== null && (
            <span className={`flex items-center gap-0.5 text-[11px] font-bold ${overview.teamTrend > 0 ? "text-emerald-500" : overview.teamTrend < 0 ? "text-red-500" : "text-content-muted"}`}>
              {overview.teamTrend > 0 ? <TrendingUp className="w-3.5 h-3.5" /> : overview.teamTrend < 0 ? <TrendingDown className="w-3.5 h-3.5" /> : <Minus className="w-3.5 h-3.5" />}
              {overview.teamTrend > 0 ? "+" : ""}
              {overview.teamTrend}
            </span>
          )}
        </div>
      </div>
      <div className={card}>
        <span className={label}>Highest Performer</span>
        <div className="flex items-center gap-1.5">
          <Trophy className="w-3.5 h-3.5 text-amber-500 shrink-0" />
          <span className={`text-sm font-bold truncate ${dark ? "text-white" : "text-stone-900"}`}>{overview.highest ? overview.highest.name : "—"}</span>
        </div>
        {overview.highest && <span className="text-xs font-semibold text-emerald-500">{overview.highest.latest}</span>}
      </div>
      <div className={card}>
        <span className={label}>Lowest Performer</span>
        <span className={`text-sm font-bold truncate ${dark ? "text-white" : "text-stone-900"}`}>{overview.lowest ? overview.lowest.name : "—"}</span>
        {overview.lowest && <span className={`text-xs font-semibold ${overview.lowest.latest < SCORE_DANGER ? "text-red-500" : "text-content-muted"}`}>{overview.lowest.latest}</span>}
      </div>
      <div className={card}>
        <span className={label}>Advisors Improving</span>
        <span className="text-2xl font-black text-emerald-500 flex items-center gap-1.5">
          <TrendingUp className="w-4 h-4" />
          {overview.improving}
        </span>
      </div>
      <div className={card}>
        <span className={label}>Advisors Declining</span>
        <span className="text-2xl font-black text-red-500 flex items-center gap-1.5">
          <TrendingDown className="w-4 h-4" />
          {overview.declining}
        </span>
      </div>
    </div>
  );
}

// ── Main monthly performance table ──────────────────────────────────────
function MainTable({
  dark,
  rows,
  medium,
  loading,
  onAdvisorSelect,
  cellClass,
  headClass,
}: {
  dark: boolean;
  rows: MonthlyAdvisorRow[];
  medium: Medium;
  loading: boolean;
  onAdvisorSelect: (tactId: string) => void;
  cellClass: string;
  headClass: string;
}) {
  const showLead = medium === "all" || medium === "lead";
  const showPayment = medium === "all" || medium === "payment";
  const showChat = medium === "all" || medium === "chat";
  const showCall = medium === "all" || medium === "call";

  return (
    <div className={`rounded-xl border overflow-hidden ${dark ? "border-white/[0.08]" : "border-[var(--border)]"}`}>
      <div className="max-h-[60vh] overflow-auto">
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr>
              <th className={headClass}>Advisor</th>
              <th className={headClass}>Month</th>
              {showLead && (
                <>
                  <th className={headClass}>Lead Score</th>
                  <th className={headClass}>Lead Instances</th>
                </>
              )}
              {showPayment && (
                <>
                  <th className={headClass}>Payment QA</th>
                  <th className={headClass}>Payment Instances</th>
                </>
              )}
              {showChat && (
                <>
                  <th className={headClass}>Chat QA</th>
                  <th className={headClass}>Chat Instances</th>
                </>
              )}
              {showCall && (
                <>
                  <th className={headClass}>Call QA</th>
                  <th className={headClass}>Call Instances</th>
                </>
              )}
              <th className={headClass}>Cumulative Score</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={11} className="px-3 py-6 text-center text-content-muted">
                  {loading ? "Loading…" : "No data for this period."}
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={`${r.tactId}-${r.monthKey}`} className={`transition-colors ${dark ? "hover:bg-white/[0.03]" : "odd:bg-black/[0.015] hover:bg-stone-50"}`}>
                  <td className={cellClass}>
                    <button
                      onClick={() => onAdvisorSelect(r.tactId)}
                      className={`font-bold text-left cursor-pointer hover:underline ${dark ? "text-blue-300" : "text-blue-700"}`}
                      title="View this advisor's monthly history"
                    >
                      {r.name || r.tactId}
                    </button>
                  </td>
                  <td className={cellClass}>{r.monthLabel}</td>
                  {showLead && (
                    <>
                      <td className={cellClass}>
                        <div className={`inline-block pl-2.5 ${scoreFlagClasses(r.leadScoreAvg, dark)}`}>{r.leadScoreAvg ?? "NA"}</div>
                      </td>
                      <td className={cellClass}>{r.leadScoreInstances}</td>
                    </>
                  )}
                  {showPayment && (
                    <>
                      <td className={cellClass}>
                        <div className={`inline-block pl-2.5 ${scoreFlagClasses(r.paymentsAvg, dark)}`}>{r.paymentsAvg ?? "NA"}</div>
                      </td>
                      <td className={cellClass}>{r.paymentsInstances}</td>
                    </>
                  )}
                  {showChat && (
                    <>
                      <td className={cellClass}>{r.chatAvg ?? "NA"}</td>
                      <td className={cellClass}>{r.chatInstances}</td>
                    </>
                  )}
                  {showCall && (
                    <>
                      <td className={cellClass}>{r.callAvg ?? "NA"}</td>
                      <td className={cellClass}>{r.callInstances}</td>
                    </>
                  )}
                  <td className={cellClass}>
                    <span className="font-black">{r.cumulativeScore ?? "NA"}</span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Advisor drill-down ───────────────────────────────────────────────────
function AdvisorDrilldown({
  dark,
  theme,
  rows,
  onBack,
  cellClass,
  headClass,
}: {
  dark: boolean;
  theme: "light" | "dark";
  rows: MonthlyAdvisorRow[];
  onBack: () => void;
  cellClass: string;
  headClass: string;
}) {
  const name = rows[0]?.name || rows[0]?.tactId || "Advisor";
  const chartData = rows.map((r) => ({ month: r.monthLabel, score: r.cumulativeScore }));

  return (
    <div className="space-y-4">
      <button
        onClick={onBack}
        className={`inline-flex items-center gap-1.5 text-xs font-bold cursor-pointer ${dark ? "text-blue-300" : "text-blue-700"}`}
      >
        <ArrowLeft className="w-3.5 h-3.5" />
        Back to Team View
      </button>

      <h2 className={`text-lg font-black ${dark ? "text-white" : "text-stone-900"}`}>{name}</h2>

      {chartData.length > 1 && (
        <div className={`rounded-xl border p-4 ${dark ? "bg-white/[0.03] border-white/[0.08]" : "bg-white border-[var(--border)]"}`}>
          <h3 className={`text-xs font-black uppercase tracking-wider mb-2 ${dark ? "text-white" : "text-[#111827]"}`}>Cumulative Score Trend</h3>
          <div className="w-full h-52 font-sans text-[11px] font-bold">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={theme === "dark" ? "#1F2937" : "#E5E7EB"} />
                <XAxis dataKey="month" stroke={theme === "dark" ? "#9CA3AF" : "#4B5563"} fontSize={10} tickLine={false} />
                <YAxis domain={[0, 5]} stroke={theme === "dark" ? "#9CA3AF" : "#4B5563"} fontSize={10} tickLine={false} />
                <Tooltip
                  content={({ active, payload, label }) => {
                    if (active && payload && payload.length) {
                      return (
                        <div className={`p-2.5 rounded-xl border text-xs font-sans shadow-lg font-bold ${dark ? "bg-stone-900 border-stone-800 text-zinc-100" : "bg-white border-stone-200 text-stone-950"}`}>
                          <p className="opacity-75 mb-0.5">{label}</p>
                          <p className="text-xs font-black">{payload[0].value ?? "NA"}</p>
                        </div>
                      );
                    }
                    return null;
                  }}
                />
                <Line type="monotone" dataKey="score" stroke="#117FDA" strokeWidth={2} dot={{ r: 3 }} connectNulls />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      <div className={`rounded-xl border overflow-hidden ${dark ? "border-white/[0.08]" : "border-[var(--border)]"}`}>
        <div className="max-h-[55vh] overflow-auto">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr>
                <th className={headClass}>Month</th>
                <th className={headClass}>Lead Score</th>
                <th className={headClass}>Lead Instances</th>
                <th className={headClass}>Payment QA</th>
                <th className={headClass}>Payment Instances</th>
                <th className={headClass}>Chat QA</th>
                <th className={headClass}>Chat Instances</th>
                <th className={headClass}>Call QA</th>
                <th className={headClass}>Call Instances</th>
                <th className={headClass}>Cumulative Score</th>
                <th className={headClass}>MoM Change</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const prev = i > 0 ? rows[i - 1].cumulativeScore : null;
                const delta = r.cumulativeScore !== null && prev !== null ? Math.round((r.cumulativeScore - prev) * 100) / 100 : null;
                return (
                  <tr key={r.monthKey} className={`transition-colors ${dark ? "hover:bg-white/[0.03]" : "odd:bg-black/[0.015] hover:bg-stone-50"}`}>
                    <td className={cellClass}>{r.monthLabel}</td>
                    <td className={cellClass}>
                      <div className={`inline-block pl-2.5 ${scoreFlagClasses(r.leadScoreAvg, dark)}`}>{r.leadScoreAvg ?? "NA"}</div>
                    </td>
                    <td className={cellClass}>{r.leadScoreInstances}</td>
                    <td className={cellClass}>
                      <div className={`inline-block pl-2.5 ${scoreFlagClasses(r.paymentsAvg, dark)}`}>{r.paymentsAvg ?? "NA"}</div>
                    </td>
                    <td className={cellClass}>{r.paymentsInstances}</td>
                    <td className={cellClass}>{r.chatAvg ?? "NA"}</td>
                    <td className={cellClass}>{r.chatInstances}</td>
                    <td className={cellClass}>{r.callAvg ?? "NA"}</td>
                    <td className={cellClass}>{r.callInstances}</td>
                    <td className={cellClass}>
                      <span className="font-black">{r.cumulativeScore ?? "NA"}</span>
                    </td>
                    <td className={cellClass}>
                      {delta === null ? (
                        <span className="text-content-muted">—</span>
                      ) : (
                        <span className={`flex items-center gap-1 font-bold ${delta > 0 ? "text-emerald-500" : delta < 0 ? "text-red-500" : "text-content-muted"}`}>
                          {delta > 0 ? <TrendingUp className="w-3 h-3" /> : delta < 0 ? <TrendingDown className="w-3 h-3" /> : <Minus className="w-3 h-3" />}
                          {delta > 0 ? "+" : ""}
                          {delta}
                        </span>
                      )}
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
