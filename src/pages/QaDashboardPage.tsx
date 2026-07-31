/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Search, RefreshCw, ArrowLeft } from "lucide-react";
import { QaDashboardIcon } from "../components/icons";
import { CustomSelect } from "../components/CustomSelect";
import { ClippedButton } from "../components/ClippedButton";

/**
 * QA Dashboard — native React port of the standalone Apps Script "Advisor
 * QA Dashboard" (Index.html's vanilla-JS state/render app). Same data,
 * same role model (Admin/Guide/Mentor/Advisor), same tabs (Score / QA
 * Feedback / Reviews) — now backed by src/server/qaDashboard/* reading the
 * same Google Sheet read-only over the app's existing Google login instead
 * of a separate Apps Script deployment. See the QA Dashboard integration
 * memory for why this native port was chosen over iframing the original.
 */

// ── Types (mirror src/server/qaDashboard/*.ts response shapes) ────────────
interface Advisor {
  tactId: string;
  name: string;
  guide: string | null;
}
interface BucketMetrics {
  instances: number;
  perfect: number;
  perfectPct: number | null;
  average: number | null;
}
interface AdvisorMetrics {
  tactId: string;
  loChats: BucketMetrics;
  loCalls: BucketMetrics;
  loPayments: BucketMetrics;
  leadScore: { totalScore: number; numberOfLeads: number; average: number | null };
}
interface DashboardData {
  advisor: Advisor | null;
  metrics: AdvisorMetrics | null;
  isAdmin: boolean;
  isGuide: boolean;
  isMentor: boolean;
  callerName?: string;
  error?: string;
  message?: string;
}
interface SheetTable {
  headers: string[];
  rows: Record<string, unknown>[];
  error?: string;
  message?: string;
}
interface AdvisorSummaryRow {
  tactId: string;
  name: string;
  guide: string | null;
  leadScoreAvg: number | null;
  paymentsAvg: number | null;
}
interface DateFilters {
  checkedFrom: string;
  checkedTo: string;
  tillDate: string;
}

const FEEDBACK_COLUMNS = [
  "Checked Date", "Mistake Date", "Domain", "Chat ID",
  "Red Flags", "Orange Flags", "Green Flags", "Score", "Dispute Window\n(Days)",
];
const REVIEW_COLUMNS = [
  "TACT ID", "Advisor", "Chat ID", "Type", "Score", "Raised", "Resolved",
  "Comment", "QA Response", "Status",
];

const SCORE_DANGER = 3.5;
const SCORE_WARN = 3.75;

function norm(s: string): string {
  return s.replace(/\s+/g, " ").trim().toLowerCase();
}

// Transparent cell + colored text + 4px left accent border, instead of a
// solid fill — lets the row's own hover tint (see the <tr> below) show
// through consistently on score cells the same way it does on every other
// cell, rather than a flat color block masking it. Good scores get no
// treatment at all — only the two tiers actually worth flagging (danger,
// warning) get the accent.
function scoreFlagClasses(value: number | null | undefined, dark: boolean): string {
  if (value === null || value === undefined) return "border-l-4 border-l-transparent";
  if (value < SCORE_DANGER) return dark ? "border-l-4 border-l-red-500 text-red-300 font-bold" : "border-l-4 border-l-red-500 text-red-700 font-bold";
  if (value < SCORE_WARN) return dark ? "border-l-4 border-l-amber-500 text-amber-300 font-bold" : "border-l-4 border-l-amber-500 text-amber-700 font-bold";
  return "border-l-4 border-l-transparent";
}

// Border color only — no text color. Feedback text here is long-form
// paragraphs, not short labels, so tinting the font made whole blocks of
// prose hard to read. Applied to a content-sized wrapper (not the <td>
// itself — see SheetTableView below) so the accent bar hugs just the text,
// instead of stretching down the full row height and reading as one
// continuous line down the column when neighboring cells are taller.
function cellFlagBorderClass(header: string, value: unknown): string {
  const lo = header.toLowerCase();
  const hasValue = value !== null && value !== undefined && String(value).trim() !== "";
  if (!hasValue || !lo.includes("flag")) return "border-l-4 border-l-transparent";
  if (lo.includes("red flag")) return "border-l-4 border-l-red-500";
  if (lo.includes("orange flag")) return "border-l-4 border-l-amber-500";
  if (lo.includes("green flag")) return "border-l-4 border-l-emerald-500";
  return "border-l-4 border-l-transparent";
}

// ── Default date filters — Start/End = current calendar month, Till Date =
// start of current month minus 2 days. Restored from localStorage after
// the first visit (see loadStoredDates), matching the original tool. ──────
function pad(n: number): string {
  return String(n).padStart(2, "0");
}
function fmtDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function computeDefaultDates(): DateFilters {
  const d = new Date();
  const y = d.getFullYear();
  const m = d.getMonth();
  return {
    checkedFrom: `${y}-${pad(m + 1)}-01`,
    checkedTo: fmtDate(new Date(y, m + 1, 0)),
    tillDate: fmtDate(new Date(y, m, -1)),
  };
}
const DATES_STORAGE_KEY = "qa_dashboard_date_filters";
function loadStoredDates(): DateFilters | null {
  try {
    const raw = window.localStorage.getItem(DATES_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && parsed.checkedFrom && parsed.checkedTo && parsed.tillDate) return parsed;
  } catch {
    /* corrupt/unreadable storage — ignore */
  }
  return null;
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body?.error) {
    throw new Error(body?.message || body?.error || `HTTP ${res.status}`);
  }
  return body as T;
}

function qs(params: Record<string, string | null | undefined>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== null && v !== undefined && v !== "") p.set(k, v);
  }
  return p.toString();
}

// ── Small reusable advisor combobox (name/TACT ID search) ─────────────────
function AdvisorCombobox({
  advisors,
  value,
  onChange,
  theme,
  placeholder = "Type a name or TACT ID…",
}: {
  advisors: Advisor[];
  value: string;
  onChange: (tactId: string) => void;
  theme: "light" | "dark";
  placeholder?: string;
}) {
  const dark = theme === "dark";
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);

  const selected = value ? advisors.find((a) => a.tactId === value) : undefined;
  const selectedLabel = selected ? (selected.name && selected.name !== selected.tactId ? `${selected.name} (${selected.tactId})` : selected.tactId) : "";

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return advisors.filter((a) => a.name?.toLowerCase().includes(q) || a.tactId?.toLowerCase().includes(q));
  }, [advisors, query]);

  useEffect(() => {
    function onDocMouseDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    }
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, []);

  function select(tactId: string) {
    onChange(tactId);
    setOpen(false);
    setQuery("");
    setHighlighted(-1);
  }

  return (
    <div ref={containerRef} className="relative w-full max-w-[280px]">
      <input
        type="text"
        value={open ? query : selectedLabel}
        placeholder={open ? placeholder : selectedLabel || placeholder}
        onFocus={() => {
          setOpen(true);
          setQuery("");
        }}
        onChange={(e) => {
          setQuery(e.target.value);
          setHighlighted(0);
        }}
        onKeyDown={(e) => {
          if (!open) return;
          if (e.key === "ArrowDown") {
            e.preventDefault();
            if (filtered.length) setHighlighted((i) => (i + 1) % filtered.length);
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            if (filtered.length) setHighlighted((i) => (i - 1 + filtered.length) % filtered.length);
          } else if (e.key === "Enter") {
            e.preventDefault();
            if (highlighted >= 0 && highlighted < filtered.length) select(filtered[highlighted].tactId);
            else if (filtered.length === 1) select(filtered[0].tactId);
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
        className={`w-full px-3 py-2 rounded-lg border outline-none text-xs font-semibold ${
          dark ? "bg-[#102236] border-[#1e3e5c] text-[#eff6ff]" : "bg-white border-stone-250 text-stone-850"
        }`}
      />
      {open && (
        <ul
          className={`absolute z-20 mt-1 w-full max-h-64 overflow-y-auto rounded-lg border shadow-lg py-1 ${
            dark ? "bg-[#0d1c3f] border-white/10" : "bg-white border-stone-200"
          }`}
        >
          {filtered.length === 0 ? (
            <li className={`px-3 py-2 text-xs ${dark ? "text-slate-400" : "text-stone-500"}`}>
              {query ? `No match for "${query}"` : "Type to search…"}
            </li>
          ) : (
            filtered.map((a, i) => (
              <li
                key={a.tactId}
                onMouseDown={(e) => {
                  e.preventDefault();
                  select(a.tactId);
                }}
                onMouseEnter={() => setHighlighted(i)}
                className={`px-3 py-2 text-xs flex justify-between gap-2 cursor-pointer ${
                  i === highlighted
                    ? dark ? "bg-blue-600/20" : "bg-blue-50"
                    : ""
                } ${a.tactId === value ? "font-bold" : ""}`}
              >
                <span>{a.name || a.tactId}</span>
                {a.name && a.name !== a.tactId && (
                  <span className={dark ? "text-slate-400" : "text-stone-400"}>{a.tactId}</span>
                )}
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}

function StatRow({
  label,
  value,
  suffix = "",
  bold = false,
  valueClassName = "",
}: {
  label: string;
  value: number | null;
  suffix?: string;
  bold?: boolean;
  /** Extra classes for the value only — used to color just the QA Score
      figure on a danger card, instead of tinting the whole row/card. */
  valueClassName?: string;
}) {
  const isNa = value === null || value === undefined;
  return (
    <div className="flex justify-between text-xs py-1 border-b border-stone-200/60 dark:border-white/[0.06] last:border-b-0">
      <span className={`text-content-muted ${bold ? "font-bold" : ""}`}>{label}</span>
      <span className={`${isNa ? "text-content-faint font-normal" : "font-semibold"} ${bold ? "font-black" : ""} ${valueClassName}`}>
        {isNa ? "NA" : `${value}${suffix}`}
      </span>
    </div>
  );
}

// Same principle as the table cells above: transparent card (no solid
// danger fill), a 4px left accent border instead of recoloring the whole
// card border, and color reserved for the one number that matters (QA
// Score) rather than the title too.
function BucketCard({ title, bucket, highlight, theme }: { title: string; bucket: BucketMetrics; highlight?: boolean; theme: "light" | "dark" }) {
  const dark = theme === "dark";
  const isDanger = !!highlight && bucket.average !== null && bucket.average < SCORE_DANGER;
  return (
    <div
      className={`rounded-2xl border p-4 space-y-1 ${dark ? "bg-white/[0.03] border-white/[0.08]" : "bg-surface-elevated/70 border-[#D2DFEC]"} ${
        isDanger ? "border-l-4 border-l-red-500" : ""
      }`}
    >
      {highlight && (
        <span
          className={`inline-block text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded mb-1 ${
            isDanger ? "bg-red-600 text-white" : "bg-amber-500 text-white"
          }`}
        >
          {isDanger ? "Below threshold" : "KPI"}
        </span>
      )}
      <h2 className="text-xs font-bold uppercase tracking-wide text-content-muted">{title}</h2>
      <StatRow label="Instances" value={bucket.instances} />
      <StatRow label="Perfect" value={bucket.perfect} />
      <StatRow label="% Perfect" value={bucket.perfectPct} suffix={bucket.perfectPct === null ? "" : "%"} />
      <StatRow label="QA Score" value={bucket.average} bold valueClassName={isDanger ? (dark ? "text-red-300" : "text-red-700") : ""} />
    </div>
  );
}

function LeadScoreCard({ lead, theme }: { lead: AdvisorMetrics["leadScore"]; theme: "light" | "dark" }) {
  const dark = theme === "dark";
  const isDanger = lead.average !== null && lead.average < SCORE_DANGER;
  return (
    <div
      className={`rounded-2xl border p-4 space-y-1 ${dark ? "bg-white/[0.03] border-white/[0.08]" : "bg-surface-elevated/70 border-[#D2DFEC]"} ${
        isDanger ? "border-l-4 border-l-red-500" : ""
      }`}
    >
      <span className={`inline-block text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded mb-1 ${isDanger ? "bg-red-600 text-white" : "bg-amber-500 text-white"}`}>
        {isDanger ? "Below threshold" : "KPI"}
      </span>
      <h2 className="text-xs font-bold uppercase tracking-wide text-content-muted">Lead Score</h2>
      <StatRow label="Total Score" value={lead.totalScore} />
      <StatRow label="Number of Leads" value={lead.numberOfLeads} />
      <StatRow label="QA Score" value={lead.average} bold valueClassName={isDanger ? (dark ? "text-red-300" : "text-red-700") : ""} />
    </div>
  );
}

function SheetTableView({
  table,
  loading,
  error,
  columns,
  theme,
}: {
  table: SheetTable | null;
  loading: boolean;
  error: string;
  columns: string[] | null;
  theme: "light" | "dark";
}) {
  const dark = theme === "dark";
  if (loading) return <p className="text-xs text-content-muted py-6">Loading…</p>;
  if (error) return <p className="text-xs text-red-500 py-6">{error}</p>;
  if (!table || table.rows.length === 0) return <p className="text-xs text-content-muted py-6">No records found.</p>;

  const visible = columns ? table.headers.filter((h) => columns.some((c) => norm(c) === norm(h))) : table.headers;

  return (
    <div className={`overflow-auto max-h-[65vh] rounded-xl border ${dark ? "border-white/[0.08]" : "border-[#D2DFEC]"}`}>
      <table className="w-full text-xs border-collapse min-w-[700px]">
        <thead>
          <tr>
            {visible.map((h) => (
              <th
                key={h}
                className={`sticky top-0 text-left px-3 py-2 font-bold whitespace-nowrap border-b ${
                  dark ? "bg-[#0d1c3f] border-white/[0.08] text-slate-300" : "bg-stone-100 border-stone-200 text-stone-600"
                }`}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((row, i) => (
            <tr key={i} className={`transition-colors ${dark ? "hover:bg-white/[0.03]" : "hover:bg-stone-50"}`}>
              {visible.map((h) => {
                const isFlagCol = h.toLowerCase().includes("flag");
                const text = row[h] != null ? String(row[h]) : "";
                return (
                  <td
                    key={h}
                    className={`px-3 py-2 border-b align-top ${dark ? "border-white/[0.05]" : "border-stone-100"}`}
                  >
                    {isFlagCol ? <div className={`pl-2.5 ${cellFlagBorderClass(h, row[h])}`}>{text}</div> : text}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

interface QaDashboardPageProps {
  theme: "light" | "dark";
}

export function QaDashboardPage({ theme }: QaDashboardPageProps) {
  const dark = theme === "dark";
  // Matches the px-2.5/py-1.5/text-xs sizing of the plain <input> filters
  // beside it — CustomSelect's own default trigger uses much larger py-3
  // padding, which otherwise makes the Guide/Type/Status dropdowns visibly
  // taller than the Search/Date fields in the same filter row.
  const selectTriggerClass = `w-full flex items-center justify-between gap-2 pl-2.5 pr-8 py-1.5 rounded-lg border outline-none text-xs font-semibold cursor-pointer relative ${
    dark ? "bg-[#102236] border-[#1e3e5c] text-[#eff6ff]" : "bg-white border-stone-250 text-stone-850"
  }`;

  const [dates, setDates] = useState<DateFilters>(() => loadStoredDates() || computeDefaultDates());
  useEffect(() => {
    try {
      window.localStorage.setItem(DATES_STORAGE_KEY, JSON.stringify(dates));
    } catch {
      /* ignore quota/serialization errors */
    }
  }, [dates]);

  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [advisorList, setAdvisorList] = useState<Advisor[] | null>(null);
  const [selectedTactId, setSelectedTactId] = useState<string | null>(null);
  const [guideFilter, setGuideFilter] = useState("");
  const [activeTab, setActiveTab] = useState<"score" | "feedback" | "reviews">("score");
  const [tabData, setTabData] = useState<Record<string, SheetTable | undefined>>({});
  const [tabLoading, setTabLoading] = useState<Record<string, boolean>>({});
  const [tabError, setTabError] = useState<Record<string, string>>({});

  const [advisorsSummary, setAdvisorsSummary] = useState<AdvisorSummaryRow[] | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryError, setSummaryError] = useState("");
  const [summaryGuideFilter, setSummaryGuideFilter] = useState("");
  const [summarySearch, setSummarySearch] = useState("");

  const [reviewTypeFilter, setReviewTypeFilter] = useState("");
  const [reviewStatusFilter, setReviewStatusFilter] = useState("");

  const loadDashboard = useCallback(async (dateFilters: DateFilters, requestedTactId: string | null, hasList: boolean) => {
    setLoading(true);
    setError("");
    try {
      const data = await fetchJson<DashboardData>(
        `/api/qa-dashboard/dashboard?${qs({ ...dateFilters, tactId: requestedTactId })}`
      );
      setDashboard(data);
      setSelectedTactId(data.advisor ? data.advisor.tactId : null);
      if ((data.isAdmin || data.isGuide || data.isMentor) && !hasList) {
        try {
          const list = await fetchJson<{ advisors: Advisor[] }>(`/api/qa-dashboard/advisors`);
          setAdvisorList(list.advisors);
        } catch (e) {
          console.warn("Advisor list failed:", e);
        }
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadAdvisorsSummary = useCallback(async (dateFilters: DateFilters) => {
    setSummaryLoading(true);
    setSummaryError("");
    try {
      const data = await fetchJson<{ advisors: AdvisorSummaryRow[] }>(`/api/qa-dashboard/summary?${qs(dateFilters)}`);
      setAdvisorsSummary(data.advisors || []);
    } catch (err: any) {
      setSummaryError(err.message);
    } finally {
      setSummaryLoading(false);
    }
  }, []);

  const loadTab = useCallback(async (tabId: "feedback" | "reviews", tactId: string, dateFilters: DateFilters) => {
    setTabLoading((prev) => ({ ...prev, [tabId]: true }));
    setTabError((prev) => ({ ...prev, [tabId]: "" }));
    try {
      const url =
        tabId === "feedback"
          ? `/api/qa-dashboard/feedback?${qs({ tactId })}`
          : `/api/qa-dashboard/reviews?${qs({ tactId, checkedFrom: dateFilters.checkedFrom, checkedTo: dateFilters.checkedTo })}`;
      const data = await fetchJson<SheetTable>(url);
      setTabData((prev) => ({ ...prev, [tabId]: data }));
    } catch (err: any) {
      setTabError((prev) => ({ ...prev, [tabId]: err.message }));
    } finally {
      setTabLoading((prev) => ({ ...prev, [tabId]: false }));
    }
  }, []);

  // Initial load on mount.
  useEffect(() => {
    loadDashboard(dates, null, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-load the landing summary once we know the caller is Admin/Guide/Mentor.
  useEffect(() => {
    if (dashboard && !dashboard.advisor && (dashboard.isAdmin || dashboard.isGuide || dashboard.isMentor) && advisorsSummary === null && !summaryLoading) {
      loadAdvisorsSummary(dates);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dashboard, advisorsSummary, summaryLoading]);

  function handleRefresh() {
    loadDashboard(dates, selectedTactId, !!advisorList);
    setTabData({});
    setTabLoading({});
    setTabError({});
    if (activeTab !== "score" && selectedTactId) loadTab(activeTab, selectedTactId, dates);
  }

  function handleAdvisorChange(tactId: string) {
    setSelectedTactId(tactId);
    setActiveTab("score");
    setTabData({});
    setTabLoading({});
    setTabError({});
    loadDashboard(dates, tactId, !!advisorList);
  }

  function handleBackToList() {
    setDashboard((prev) => (prev ? { ...prev, advisor: null, metrics: null } : prev));
    setSelectedTactId(null);
    setActiveTab("score");
    setTabData({});
    setTabLoading({});
    setTabError({});
  }

  function handleTabClick(tabId: "score" | "feedback" | "reviews") {
    setActiveTab(tabId);
    if (tabId !== "score" && !tabData[tabId] && !tabLoading[tabId] && dashboard?.advisor) {
      loadTab(tabId, dashboard.advisor.tactId, dates);
    }
  }

  const guideNames = useMemo(
    () => Array.from(new Set((advisorList || []).map((a) => a.guide).filter(Boolean))).sort() as string[],
    [advisorList]
  );
  const pickerAdvisors = useMemo(
    () => (advisorList ? (guideFilter ? advisorList.filter((a) => a.guide === guideFilter) : advisorList) : []),
    [advisorList, guideFilter]
  );

  const summaryGuideNames = useMemo(
    () => Array.from(new Set((advisorsSummary || []).map((a) => a.guide).filter(Boolean))).sort() as string[],
    [advisorsSummary]
  );
  const filteredSummary = useMemo(() => {
    if (!advisorsSummary) return [];
    const q = summarySearch.trim().toLowerCase();
    return advisorsSummary
      .filter((a) => !(dashboard?.isAdmin && summaryGuideFilter) || a.guide === summaryGuideFilter)
      .filter((a) => !q || a.name?.toLowerCase().includes(q) || a.tactId?.toLowerCase().includes(q));
  }, [advisorsSummary, summarySearch, summaryGuideFilter, dashboard?.isAdmin]);

  const reviewRows = tabData.reviews?.rows;
  const reviewTypeOptions = useMemo(
    () => Array.from(new Set((reviewRows || []).map((r) => String(r["Type"] ?? "")).filter(Boolean))),
    [reviewRows]
  );
  const reviewStatusOptions = useMemo(
    () => Array.from(new Set((reviewRows || []).map((r) => String(r["Status"] ?? "")).filter(Boolean))),
    [reviewRows]
  );
  const filteredReviewTable = useMemo(() => {
    if (!tabData.reviews) return tabData.reviews;
    const rows = tabData.reviews.rows.filter(
      (r) => (!reviewTypeFilter || r["Type"] === reviewTypeFilter) && (!reviewStatusFilter || r["Status"] === reviewStatusFilter)
    );
    return { ...tabData.reviews, rows };
  }, [tabData.reviews, reviewTypeFilter, reviewStatusFilter]);

  const dateFilterBar = (
    <div className={`flex flex-wrap items-end gap-3 rounded-2xl border p-4 ${dark ? "bg-white/[0.03] border-white/[0.08]" : "bg-surface-elevated/70 border-[#D2DFEC]"}`}>
      {(["checkedFrom", "checkedTo", "tillDate"] as const).map((field) => (
        <label key={field} className="flex flex-col gap-1 text-[11px] font-bold text-content-muted">
          {field === "checkedFrom" ? "Start Date" : field === "checkedTo" ? "End Date" : "Till Date"}
          <input
            type="date"
            value={dates[field]}
            onChange={(e) => setDates((prev) => ({ ...prev, [field]: e.target.value }))}
            className={`px-2.5 py-1.5 rounded-lg border text-xs font-semibold outline-none ${
              dark ? "bg-[#102236] border-[#1e3e5c] text-[#eff6ff]" : "bg-white border-stone-250 text-stone-850"
            }`}
          />
        </label>
      ))}
      <ClippedButton onClick={handleRefresh} size="md" className="h-8 gap-2 px-4 text-xs font-bold text-white" style={{ background: "#1f2d3d" }}>
        <RefreshCw className="w-3 h-3" />
        {loading ? "Loading…" : "Load Dashboard"}
      </ClippedButton>
    </div>
  );

  if (!dashboard) {
    return (
      <div className="space-y-4">
        <h1 className="text-page-title flex items-center gap-2">
          <QaDashboardIcon className="w-5 h-5" />
          QA Dashboard
        </h1>
        {loading ? <p className="text-xs text-content-muted">Loading your metrics…</p> : null}
        {error ? <p className="text-xs text-red-500">{error}</p> : null}
      </div>
    );
  }

  // ── Landing page (Admin/Guide/Mentor roster) ─────────────────────────────
  if (!dashboard.advisor) {
    const roleLabel = dashboard.isAdmin ? "Admin view" : dashboard.isGuide ? "Guide view" : dashboard.isMentor ? "Mentor view" : "";
    return (
      <div className="space-y-5 pb-6">
        <div>
          <h1 className={`text-page-title tracking-tight flex items-center gap-2 ${dark ? "text-white" : "text-[#111827]"}`}>
            <QaDashboardIcon className="w-5 h-5" />
            <span>Hey {dashboard.callerName || "there"}, welcome to the QA Dashboard</span>
          </h1>
          <p className="text-xs mt-1 font-semibold text-content-muted">{roleLabel}</p>
        </div>

        <div className={`flex flex-wrap items-end gap-3 rounded-2xl border p-4 ${dark ? "bg-white/[0.03] border-white/[0.08]" : "bg-surface-elevated/70 border-[#D2DFEC]"}`}>
          <label className="flex flex-col gap-1 text-[11px] font-bold text-content-muted">
            Search Advisor
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-content-faint" />
              <input
                type="text"
                value={summarySearch}
                onChange={(e) => setSummarySearch(e.target.value)}
                placeholder="Name or TACT ID…"
                className={`pl-7 pr-2.5 py-1.5 rounded-lg border text-xs font-semibold outline-none min-w-[200px] ${
                  dark ? "bg-[#102236] border-[#1e3e5c] text-[#eff6ff]" : "bg-white border-stone-250 text-stone-850"
                }`}
              />
            </div>
          </label>
          {dashboard.isAdmin && summaryGuideNames.length > 0 && (
            <label className="flex flex-col gap-1 text-[11px] font-bold text-content-muted min-w-[140px]">
              Guide
              <CustomSelect
                value={summaryGuideFilter}
                onChange={setSummaryGuideFilter}
                theme={theme}
                triggerClassName={selectTriggerClass}
                options={[{ value: "", label: "All guides" }, ...summaryGuideNames.map((g) => ({ value: g, label: g }))]}
              />
            </label>
          )}
          {(["checkedFrom", "checkedTo", "tillDate"] as const).map((field) => (
            <label key={field} className="flex flex-col gap-1 text-[11px] font-bold text-content-muted">
              {field === "checkedFrom" ? "Start Date" : field === "checkedTo" ? "End Date" : "Till Date"}
              <input
                type="date"
                value={dates[field]}
                onChange={(e) => setDates((prev) => ({ ...prev, [field]: e.target.value }))}
                className={`px-2.5 py-1.5 rounded-lg border text-xs font-semibold outline-none ${
                  dark ? "bg-[#102236] border-[#1e3e5c] text-[#eff6ff]" : "bg-white border-stone-250 text-stone-850"
                }`}
              />
            </label>
          ))}
          <ClippedButton onClick={() => loadAdvisorsSummary(dates)} size="md" className="h-8 gap-2 px-4 text-xs font-bold text-white" style={{ background: "#1f2d3d" }}>
            <RefreshCw className="w-3.5 h-3.5" />
            {summaryLoading ? "Loading…" : "Load Dashboard"}
          </ClippedButton>
        </div>

        {summaryError && <p className="text-xs text-red-500">{summaryError}</p>}
        {error && <p className="text-xs text-red-500">{error}</p>}

        {advisorsSummary === null ? (
          <p className="text-xs text-content-muted py-6">Loading advisors…</p>
        ) : (
          <div className={`overflow-auto rounded-xl border ${dark ? "border-white/[0.08]" : "border-[#D2DFEC]"}`}>
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr>
                  {["Sl No", "TACT ID", "Advisor", "Lead Score", "Payments QA", "Dashboard"].map((h) => (
                    <th
                      key={h}
                      className={`sticky top-0 text-left px-3 py-2 font-bold whitespace-nowrap border-b ${
                        dark ? "bg-[#0d1c3f] border-white/[0.08] text-slate-300" : "bg-stone-100 border-stone-200 text-stone-600"
                      }`}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredSummary.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-3 py-6 text-center text-content-muted">
                      No advisors found.
                    </td>
                  </tr>
                ) : (
                  filteredSummary.map((a, i) => (
                    <tr key={a.tactId} className={`transition-colors ${dark ? "hover:bg-white/[0.03]" : "hover:bg-stone-50"}`}>
                      <td className={`px-3 py-2 border-b ${dark ? "border-white/[0.05]" : "border-stone-100"}`}>{i + 1}</td>
                      <td className={`px-3 py-2 border-b ${dark ? "border-white/[0.05]" : "border-stone-100"}`}>{a.tactId}</td>
                      <td className={`px-3 py-2 border-b ${dark ? "border-white/[0.05]" : "border-stone-100"}`}>{a.name || a.tactId}</td>
                      <td className={`px-3 py-2 border-b ${dark ? "border-white/[0.05]" : "border-stone-100"}`}>
                        <div className={`inline-block pl-2.5 ${scoreFlagClasses(a.leadScoreAvg, dark)}`}>{a.leadScoreAvg ?? "NA"}</div>
                      </td>
                      <td className={`px-3 py-2 border-b ${dark ? "border-white/[0.05]" : "border-stone-100"}`}>
                        <div className={`inline-block pl-2.5 ${scoreFlagClasses(a.paymentsAvg, dark)}`}>{a.paymentsAvg ?? "NA"}</div>
                      </td>
                      <td className={`px-3 py-2 border-b ${dark ? "border-white/[0.05]" : "border-stone-100"}`}>
                        <button
                          onClick={() => handleAdvisorChange(a.tactId)}
                          className="px-2.5 py-1 rounded text-[11px] font-bold text-white bg-blue-600 hover:bg-blue-700 cursor-pointer"
                        >
                          View
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    );
  }

  // ── Individual advisor dashboard ─────────────────────────────────────────
  const { advisor, metrics, isAdmin, isGuide, isMentor } = dashboard;
  const canBrowseOthers = isAdmin || isGuide || isMentor;

  return (
    <div className="space-y-5 pb-6">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 pb-3 border-b border-stone-200 dark:border-stone-800">
        <div className="flex items-start gap-3">
          {canBrowseOthers && (
            <button
              onClick={handleBackToList}
              title="Back to advisor list"
              className={`w-8 h-8 rounded-lg border flex items-center justify-center shrink-0 cursor-pointer ${
                dark ? "bg-white/[0.03] border-white/10 text-blue-300" : "bg-white border-stone-250 text-blue-700"
              }`}
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
          )}
          <div>
            <h1 className={`text-page-title tracking-tight flex items-center gap-2 ${dark ? "text-white" : "text-[#111827]"}`}>
              <QaDashboardIcon className="w-5 h-5" />
              <span>{advisor?.name || advisor?.tactId}&#8217;s QA Dashboard</span>
            </h1>
            <p className="text-xs mt-1 font-semibold text-content-muted">
              TACT ID: {advisor?.tactId}
              {advisor?.guide ? ` · Guide: ${advisor.guide}` : ""}
              {isAdmin ? " · Admin view" : isGuide ? " · Guide view" : isMentor ? " · Mentor view" : ""}
            </p>
          </div>
        </div>
      </div>

      {canBrowseOthers && advisorList && (
        <div className={`flex flex-wrap items-end gap-3 rounded-2xl border p-4 ${dark ? "bg-white/[0.03] border-white/[0.08]" : "bg-surface-elevated/70 border-[#D2DFEC]"}`}>
          {isAdmin && guideNames.length > 0 && (
            <label className="flex flex-col gap-1 text-[11px] font-bold text-content-muted min-w-[140px]">
              Guide
              <CustomSelect
                value={guideFilter}
                onChange={setGuideFilter}
                theme={theme}
                triggerClassName={selectTriggerClass}
                options={[{ value: "", label: "All guides" }, ...guideNames.map((g) => ({ value: g, label: g }))]}
              />
            </label>
          )}
          <label className="flex flex-col gap-1 text-[11px] font-bold text-content-muted">
            Viewing advisor
            <AdvisorCombobox advisors={pickerAdvisors} value={selectedTactId || ""} onChange={handleAdvisorChange} theme={theme} />
          </label>
        </div>
      )}

      {dateFilterBar}

      {error && <p className="text-xs text-red-500">{error}</p>}

      <nav className={`flex gap-1 border-b-2 ${dark ? "border-white/10" : "border-stone-200"}`}>
        {(["score", "feedback", "reviews"] as const).map((tabId) => (
          <button
            key={tabId}
            onClick={() => handleTabClick(tabId)}
            className={`px-4 py-2 text-xs font-bold rounded-t-lg -mb-0.5 border-b-[3px] cursor-pointer transition-colors ${
              activeTab === tabId
                ? "border-blue-600 text-blue-600 dark:text-blue-400"
                : "border-transparent text-content-muted hover:text-content"
            }`}
          >
            {tabId === "score" ? "Score Dashboard" : tabId === "feedback" ? "QA Feedback" : "Reviews"}
            {tabId !== "score" && tabLoading[tabId] ? " ⟳" : ""}
          </button>
        ))}
      </nav>

      {activeTab === "score" && metrics && (
        <div className={`grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3.5 ${loading ? "opacity-40 pointer-events-none" : ""}`}>
          <BucketCard title="Chats" bucket={metrics.loChats} theme={theme} />
          <BucketCard title="Calls" bucket={metrics.loCalls} theme={theme} />
          <BucketCard title="Payments" bucket={metrics.loPayments} highlight theme={theme} />
          <LeadScoreCard lead={metrics.leadScore} theme={theme} />
        </div>
      )}

      {activeTab === "feedback" && (
        <SheetTableView table={tabData.feedback ?? null} loading={!!tabLoading.feedback} error={tabError.feedback || ""} columns={FEEDBACK_COLUMNS} theme={theme} />
      )}

      {activeTab === "reviews" && (
        <>
          <div className="flex flex-wrap gap-3">
            <label className="flex flex-col gap-1 text-[11px] font-bold text-content-muted min-w-[110px]">
              Type
              <CustomSelect
                value={reviewTypeFilter}
                onChange={setReviewTypeFilter}
                theme={theme}
                triggerClassName={selectTriggerClass}
                options={[{ value: "", label: "All" }, ...reviewTypeOptions.map((t) => ({ value: t, label: t }))]}
              />
            </label>
            <label className="flex flex-col gap-1 text-[11px] font-bold text-content-muted min-w-[110px]">
              Status
              <CustomSelect
                value={reviewStatusFilter}
                onChange={setReviewStatusFilter}
                theme={theme}
                triggerClassName={selectTriggerClass}
                options={[{ value: "", label: "All" }, ...reviewStatusOptions.map((s) => ({ value: s, label: s }))]}
              />
            </label>
          </div>
          <SheetTableView table={filteredReviewTable ?? null} loading={!!tabLoading.reviews} error={tabError.reviews || ""} columns={REVIEW_COLUMNS} theme={theme} />
        </>
      )}
    </div>
  );
}

export default QaDashboardPage;
