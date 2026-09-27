/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Fragment, useEffect, useMemo, useState } from "react";
import { Filter, Search, Calendar, Activity, Download, Clock, ChevronRight } from "lucide-react";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell } from "recharts";
import { AuditLogEntry } from "../types/announcements";
import { ChangeLogEntry } from "../types/changeLog";
import { UserProfile } from "../types/user";
import { formatDisplayTimestamp } from "../utils/timestamps";
import { translateSourceToLayman } from "../utils/labelTranslation";
import { getMatchTierInfo } from "../utils/matchTier";
import { CustomSelect } from "../components/CustomSelect";
import { ClippedButton } from "../components/ClippedButton";
import { SortableTh } from "../components/SortableTh";
import { Pagination } from "../components/Pagination";
import { DateInputDMY } from "../components/DateInputDMY";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import { useServerSort } from "../hooks/useServerSort";

const PAGE_SIZE = 50;

interface PaginatedListResponse<T> {
  entries: T[];
  total: number;
  page: number;
  totalPages: number;
  tierCounts?: { level1: number; level2: number; level3: number; needsClarification: number; notMedicalAilment: number };
}

/** search_history sortKeys used by this page's User Activity table -> the
 * server-side column each maps to (searchHistoryRepository.ts). "adviser"
 * has no dedicated column on search_history (the advisor's display name is
 * resolved client-side from userEmail via the user directory below), so it
 * sorts by the underlying userEmail instead — the closest real column. */
const AUDIT_SORT_KEY_MAP: Record<string, string> = {
  adviser: "userEmail",
  timestamp: "timestamp",
  planName: "planName",
  pedInput: "pedInput",
  matchType: "matchType",
  matchedQuestion: "matchedQuestion",
  source: "source",
};

interface AuditPageProps {
  theme: "light" | "dark";
  auditSubTab: "user" | "modification";
  setAuditSubTab: (value: "user" | "modification") => void;
  auditSearch: string;
  setAuditSearch: (value: string) => void;
  auditPlanFilter: string;
  setAuditPlanFilter: (value: string) => void;
  auditStatusFilter: string;
  setAuditStatusFilter: (value: string) => void;
  auditTypeFilter: string;
  setAuditTypeFilter: (value: string) => void;
  auditStartDate: string;
  setAuditStartDate: (value: string) => void;
  auditEndDate: string;
  setAuditEndDate: (value: string) => void;
  downloadCSV: (data: Record<string, unknown>[], filename: string) => void;
  historySearch: string;
  setHistorySearch: (value: string) => void;
  historyActionFilter: string;
  setHistoryActionFilter: (value: string) => void;
  /**
   * User directory, used to resolve an advisor's real name and TACT ID from
   * the email stored on each log row. search_history only records
   * user_email, so without this the table had to fall back to the
   * email's local-part — which is not the advisor's actual name.
   */
  usersList: UserProfile[];
}

/**
 * "Activity Log" (audit) tab content. Originally extracted verbatim from
 * App.tsx (Phase 1.3); both sub-tabs (User Activity / search_history and
 * Modification History / change_logs) now self-fetch server-side
 * paginated/searched/filtered/sorted data directly from this component
 * rather than reading a fully-loaded array passed down from App.tsx — see
 * the fetch effects near the top of the component body. The
 * `activeTab === "audit"` condition and wrapping `<motion.div key="audit">`
 * deliberately stay in App.tsx (see ResourcesPage.tsx for why).
 */
export function AuditPage({
  theme,
  auditSubTab,
  setAuditSubTab,
  auditSearch,
  setAuditSearch,
  auditPlanFilter,
  setAuditPlanFilter,
  auditStatusFilter,
  setAuditStatusFilter,
  auditTypeFilter,
  setAuditTypeFilter,
  auditStartDate,
  setAuditStartDate,
  auditEndDate,
  setAuditEndDate,
  downloadCSV,
  historySearch,
  setHistorySearch,
  historyActionFilter,
  setHistoryActionFilter,
  usersList,
}: AuditPageProps) {
  // Explicit per-<th> sticky-header background (see the comment at each
  // table's <thead> for why this can't just live on <thead> + bg-inherit).
  const auditThBg = theme === "dark" ? "bg-[#132c46] text-stone-300 border-stone-800" : "bg-[var(--table-header-bg)] text-[#111827] border-stone-300";
  const changeLogThBg = theme === "dark" ? "bg-[#132c46] text-stone-300 border-stone-800" : "bg-[var(--table-header-bg)] text-[#111827] border-stone-200";

  // Which rows have their explanation expanded (keyed by row index).
  const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set());

  const toggleRow = (index: number) => {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  /**
   * email -> { name, tactId } from the user directory.
   *
   * Log rows only carry the email, so the previous display derived a "name"
   * by chopping at the "@". That produced things like "p.mehruf" rather than
   * the advisor's real name, and never showed the TACT ID at all.
   */
  const userDirectory = useMemo(() => {
    const map = new Map<string, { name: string; tactId: string }>();
    usersList.forEach((u) => {
      map.set(u.email.toLowerCase(), { name: u.name, tactId: u.tactId });
    });
    return map;
  }, [usersList]);

  const resolveAdviser = (email: string): { name: string; tactId: string } => {
    const hit = userDirectory.get((email || "").toLowerCase());
    if (hit) return hit;
    // Not in the directory (deactivated/deleted user, or a log predating
    // them). Fall back to formatting the email's local-part as a name --
    // "priya.sharma" -> "Priya Sharma" -- instead of showing the raw,
    // lowercase, dot-separated local-part verbatim. Still not a substitute
    // for the real name on file, so say plainly that no TACT ID is on record
    // rather than inventing one.
    const localPart = (email || "").split("@")[0] || "";
    const formattedName = localPart
      .split(/[._-]+/)
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
      .join(" ") || "Unknown";
    return { name: formattedName, tactId: "—" };
  };

  // ── USER ACTIVITY (search_history) — server-side page/search/filter/sort ──
  const debouncedAuditSearch = useDebouncedValue(auditSearch, 350);
  const [auditPage, setAuditPage] = useState(1);
  const { sort: auditLogsSort, toggleSort: toggleAuditLogsSort } = useServerSort({ key: "timestamp", direction: "desc" });
  const [auditEntries, setAuditEntries] = useState<AuditLogEntry[]>([]);
  const [auditTotal, setAuditTotal] = useState(0);
  const [auditTotalPages, setAuditTotalPages] = useState(1);
  const [auditLoading, setAuditLoading] = useState(true);
  const [auditExporting, setAuditExporting] = useState(false);
  const [tierCounts, setTierCounts] = useState({ level1: 0, level2: 0, level3: 0, needsClarification: 0, notMedicalAilment: 0 });

  const buildAuditParams = (forExport: boolean) => {
    const params = new URLSearchParams({ paginated: "1" });
    if (!forExport) params.set("page", String(auditPage));
    params.set("pageSize", forExport ? "10000" : String(PAGE_SIZE));
    if (debouncedAuditSearch) params.set("search", debouncedAuditSearch);
    if (auditPlanFilter !== "All") params.set("planName", auditPlanFilter);
    if (auditStatusFilter !== "All") params.set("statusTier", auditStatusFilter);
    if (auditTypeFilter !== "All") params.set("sourceType", auditTypeFilter);
    if (auditStartDate) params.set("from", auditStartDate);
    if (auditEndDate) params.set("to", auditEndDate);
    if (auditLogsSort) {
      params.set("sortBy", AUDIT_SORT_KEY_MAP[auditLogsSort.key] || auditLogsSort.key);
      params.set("sortDir", auditLogsSort.direction);
    }
    return params;
  };

  useEffect(() => {
    setAuditPage(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedAuditSearch, auditPlanFilter, auditStatusFilter, auditTypeFilter, auditStartDate, auditEndDate, auditLogsSort?.key, auditLogsSort?.direction]);

  useEffect(() => {
    if (auditSubTab !== "user") return;
    let cancelled = false;
    setAuditLoading(true);
    const params = buildAuditParams(false);
    params.set("includeTierCounts", "1");
    fetch(`/api/search-history?${params.toString()}`)
      .then(async (res) => {
        const body: PaginatedListResponse<AuditLogEntry> = await res.json();
        if (!res.ok) throw new Error((body as any).error || `HTTP ${res.status}`);
        if (cancelled) return;
        setAuditEntries(body.entries || []);
        setAuditTotal(body.total ?? 0);
        setAuditTotalPages(body.totalPages ?? 1);
        if (body.tierCounts) setTierCounts(body.tierCounts);
        if (typeof body.page === "number" && body.page !== auditPage) setAuditPage(body.page);
      })
      .catch((err) => console.error("Failed to load search history from the server:", err))
      .finally(() => { if (!cancelled) setAuditLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auditSubTab, auditPage, debouncedAuditSearch, auditPlanFilter, auditStatusFilter, auditTypeFilter, auditStartDate, auditEndDate, auditLogsSort?.key, auditLogsSort?.direction]);

  const hasActiveAuditFilter = Boolean(
    auditSearch || auditPlanFilter !== "All" || auditStatusFilter !== "All" || auditTypeFilter !== "All" || auditStartDate || auditEndDate
  );

  const auditChartData = useMemo(() => ([
    { name: "Level 1: Direct Match", count: tierCounts.level1, color: "#14B8A6" },
    { name: "Level 2: Category Match", count: tierCounts.level2, color: "#3B82F6" },
    { name: "Level 3: Fallback", count: tierCounts.level3, color: "#8B5CF6" },
    { name: "Needs Clarification", count: tierCounts.needsClarification, color: "#EF4444" },
    { name: "Not a Medical Ailment", count: tierCounts.notMedicalAilment, color: "#10B981" },
  ]), [tierCounts]);

  const exportAuditCsv = async () => {
    setAuditExporting(true);
    try {
      const res = await fetch(`/api/search-history?${buildAuditParams(true).toString()}&export=1`);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      downloadCSV(Array.isArray(body.entries) ? body.entries : [], "ped-audit-history-crm.csv");
    } catch (err) {
      console.error("Failed to export the activity log:", err);
    } finally {
      setAuditExporting(false);
    }
  };

  // ── MODIFICATION HISTORY (change_logs) — server-side page/search/filter/sort ──
  const debouncedHistorySearch = useDebouncedValue(historySearch, 350);
  const [historyPage, setHistoryPage] = useState(1);
  const { sort: changeLogsSort, toggleSort: toggleChangeLogsSort } = useServerSort({ key: "timestamp", direction: "desc" });
  const [changeLogEntries, setChangeLogEntries] = useState<ChangeLogEntry[]>([]);
  const [changeLogTotal, setChangeLogTotal] = useState(0);
  const [changeLogTotalPages, setChangeLogTotalPages] = useState(1);
  const [changeLogLoading, setChangeLogLoading] = useState(true);

  const buildHistoryParams = (forExport: boolean) => {
    const params = new URLSearchParams({ paginated: "1" });
    if (!forExport) params.set("page", String(historyPage));
    params.set("pageSize", forExport ? "10000" : String(PAGE_SIZE));
    if (debouncedHistorySearch) params.set("search", debouncedHistorySearch);
    if (historyActionFilter !== "All") params.set("actionType", historyActionFilter);
    if (changeLogsSort) {
      params.set("sortBy", changeLogsSort.key);
      params.set("sortDir", changeLogsSort.direction);
    }
    return params;
  };

  useEffect(() => {
    setHistoryPage(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedHistorySearch, historyActionFilter, changeLogsSort?.key, changeLogsSort?.direction]);

  useEffect(() => {
    if (auditSubTab !== "modification") return;
    let cancelled = false;
    setChangeLogLoading(true);
    fetch(`/api/change-logs?${buildHistoryParams(false).toString()}`)
      .then(async (res) => {
        const body: PaginatedListResponse<ChangeLogEntry> = await res.json();
        if (!res.ok) throw new Error((body as any).error || `HTTP ${res.status}`);
        if (cancelled) return;
        setChangeLogEntries(body.entries || []);
        setChangeLogTotal(body.total ?? 0);
        setChangeLogTotalPages(body.totalPages ?? 1);
        if (typeof body.page === "number" && body.page !== historyPage) setHistoryPage(body.page);
      })
      .catch((err) => console.error("Failed to load modification history from the server:", err))
      .finally(() => { if (!cancelled) setChangeLogLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auditSubTab, historyPage, debouncedHistorySearch, historyActionFilter, changeLogsSort?.key, changeLogsSort?.direction]);

  const [historyExporting, setHistoryExporting] = useState(false);

  const exportChangeLogsCsv = async () => {
    setHistoryExporting(true);
    try {
      const res = await fetch(`/api/change-logs?${buildHistoryParams(true).toString()}&export=1`);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      const filteredLogs: ChangeLogEntry[] = Array.isArray(body.entries) ? body.entries : [];

      const headers = [
        "Timestamp",
        "User",
        "Role",
        "Action Type",
        "Plan Title",
        "Description Log",
        "Draft Plans State",
        "Production Plans State",
        "Question Database Size",
        "Insurer Metadata Count",
        "Specific Waiting Period Count",
      ];
      const rows = filteredLogs.map((log) => [
        log.timestamp,
        log.userName,
        log.role,
        log.actionType,
        log.planName,
        log.description.replace(/"/g, '""'),
        log.snapshot?.draftPlans ? `${log.snapshot.draftPlans.length} drafts active` : "Active draft baseline",
        log.snapshot?.productionPlans ? `${log.snapshot.productionPlans.length} prod active` : "Active prod baseline",
        log.snapshot?.planQuestionsState ? `${Object.keys(log.snapshot.planQuestionsState).length} items` : "Default schema baseline",
        log.snapshot?.insurerMetadata ? `${Object.keys(log.snapshot.insurerMetadata).length} mapped` : "Default metadata",
        log.snapshot?.specificIllnesses ? `${Object.keys(log.snapshot.specificIllnesses).length} schedules` : "Default schedules",
      ]);

      const csvContent = "data:text/csv;charset=utf-8,"
        + [headers.join(","), ...rows.map(e => `"${e.join('","')}"`)].join("\n");

      const encodedUri = encodeURI(csvContent);
      const link = document.createElement("a");
      link.setAttribute("href", encodedUri);
      link.setAttribute("download", `ditto_modification_history_${new Date().toISOString().split("T")[0]}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (err) {
      console.error("Failed to export the modification history:", err);
    } finally {
      setHistoryExporting(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* PAGE-LEVEL HEADER — standardized app-wide (see Coverage Projection
          Studio, the reference implementation): flat, no card surface,
          accent line + title sitting directly on the page. */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 pb-3 border-b border-stone-200 dark:border-stone-800">
        <div>
          <h1 className={`text-page-title tracking-tight flex items-center gap-2 ${
            theme === "dark" ? "text-white" : "text-[#111827]"
          }`}>
            <div className="w-8 h-0.5 flex-shrink-0" style={{ backgroundColor: theme === "dark" ? "#00D3F3" : "#4673a9" }} />
            <span>Activity Log</span>
          </h1>
          <p className="text-xs mt-1 font-semibold text-content-muted">
            {auditSubTab === "user"
              ? "A complete record of all adviser condition searches and mapping outcomes."
              : "A detailed auditable history of all master policy changes, drafts, and mappings."}
          </p>
        </div>

          <div role="tablist" aria-label="Activity log view" className={`flex p-1 rounded-xl border shrink-0 select-none ${
            theme === "dark"
              ? "bg-stone-900/40 border-stone-800"
              : "bg-stone-100 border-stone-250"
          }`}>
            <button
              role="tab" aria-selected={auditSubTab === "user"} onClick={() => setAuditSubTab("user")}
              className={`px-4 py-1.5 rounded-lg text-xs font-black uppercase tracking-wider transition-all cursor-pointer ${
                auditSubTab === "user"
                  ? "bg-[var(--tab-active-bg)] text-[var(--tab-active-text)] shadow-md font-extrabold"
                  : theme === "dark"
                    ? "text-stone-400 hover:text-stone-200"
                    : "text-stone-600 hover:text-stone-900 font-bold"
              }`}
            >
              User Activity
            </button>
            <button
              role="tab" aria-selected={auditSubTab === "modification"} onClick={() => setAuditSubTab("modification")}
              className={`px-4 py-1.5 rounded-lg text-xs font-black uppercase tracking-wider transition-all cursor-pointer ${
                auditSubTab === "modification"
                  ? "bg-[var(--tab-active-bg)] text-[var(--tab-active-text)] shadow-md font-extrabold"
                  : theme === "dark"
                    ? "text-stone-400 hover:text-stone-200"
                    : "text-stone-600 hover:text-stone-900 font-bold font-sans"
              }`}
            >
              Modification History
            </button>
          </div>
      </div>

      {auditSubTab === "user" && (
        <>
      {/* CHARTS & FILTERS GRID — shown once the first page has loaded (even
          if the result set is empty after filtering), so the filters
          themselves stay usable to clear a filter that zeroed the results. */}
      {!auditLoading && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Filters Card — flat transparent-grey glass card (was a
              teal/blue gradient wash) to match the neutral, low-chroma card
              treatment used throughout an earlier version of this page. */}
          <div className={`relative overflow-hidden lg:col-span-4 rounded-2xl border p-5 space-y-4 ${
            theme === "dark"
              ? "bg-white/[0.03] border-white/[0.08]"
              : "bg-black/[0.02] border-black/[0.08]"
          }`}>
            <div className="absolute right-0 top-0 w-40 h-40 bg-white/[0.02] dark:bg-white/[0.03] rounded-full blur-3xl pointer-events-none" />
            <div className="relative z-10 flex items-center justify-between gap-2 pb-2.5 border-b border-stone-200 dark:border-stone-850">
              <div className="flex items-center gap-2">
                <Filter className="w-4 h-4 text-[#117FDA] dark:text-sky-400" />
                <h3 className={`text-xs font-black uppercase tracking-wider ${theme === 'dark' ? 'text-white' : 'text-[#111827]'}`}>
                  Filter Logs
                </h3>
              </div>
              {/* App-wide clipped-corner button (see ClippedButton.tsx)
                  instead of a one-off rounded pill, so this matches every
                  other function-performing button in the app. */}
              <ClippedButton
                onClick={exportAuditCsv}
                disabled={auditExporting || auditTotal === 0}
                size="sm"
                title="Export the filtered activity log as a CSV file"
                className="shrink-0 gap-1.5 pl-2 pr-2.5 py-1.5 text-white text-[10px] font-black uppercase tracking-wider bg-[#117FDA] hover:bg-[#0d6dbb]"
              >
                {/* Was an unlabelled icon — no way to tell what it did
                    without hovering. */}
                <Download className="w-3.5 h-3.5 shrink-0" />
                <span>Export CSV</span>
              </ClippedButton>
            </div>

            {/* Search Input */}
            <div className="space-y-1.5">
              <label className="text-[10px] font-black uppercase tracking-wider text-stone-450 block font-mono">
                Keyword Filter
              </label>
              <div className="relative">
                <input
                  type="text"
                  placeholder="Search adviser, condition, question..."
                  value={auditSearch}
                  onChange={(e) => setAuditSearch(e.target.value)}
                  className={`w-full text-xs pl-8 pr-3 py-2 rounded-xl border outline-none font-semibold ${
                    theme === 'dark'
                      ? 'bg-[#060a12] border-stone-800 text-white focus:border-[#117FDA]'
                      : 'bg-white border-stone-200 text-stone-900 focus:border-[#117FDA]'
                  }`}
                />
                <Search className="w-3.5 h-3.5 text-stone-400 absolute left-3 top-2.5" />
              </div>
            </div>

            {/* Plan Name Filter */}
            <div className="space-y-1.5">
              <label className="text-[10px] font-black uppercase tracking-wider text-stone-450 block font-mono">
                Insurance Plan
              </label>
              <CustomSelect
                theme={theme === "dark" ? "dark" : "light"}
                value={auditPlanFilter}
                onChange={setAuditPlanFilter}
                triggerClassName={`w-full flex items-center justify-between gap-2 text-xs pl-3 pr-8 py-2 rounded-xl border outline-none font-semibold cursor-pointer relative ${
                  theme === 'dark'
                    ? 'bg-[#060a12] border-stone-800 text-white'
                    : 'bg-white border-stone-200 text-stone-900'
                }`}
                options={[
                  { value: "All", label: "All Plans" },
                  { value: "Optima Secure", label: "Optima Secure" },
                  { value: "Care Supreme", label: "Care Supreme" },
                  { value: "Activ One Max", label: "Activ One Max" },
                  { value: "Activ Fit Preferred", label: "Activ Fit Preferred" },
                ]}
              />
            </div>

            {/* Mapping Status + Mapping Source Filters — laid out side by
                side in one row, same grid-cols-2 pattern as the Start/End
                Date row below. Status filters by the shared confidence
                tier taxonomy (src/utils/matchTier.ts): Level 1/2/3, Needs
                Clarification, or Not a Medical Ailment — same labels as the
                MAPPING STATUS column and the Match Category Distribution
                chart above. Source filters by *how* a mapping was produced
                (System Rule vs AI Generated), matching the SOURCE column
                terminology exactly. Two independent filters, not a single
                merged one. */}
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1.5">
                <label className="text-[10px] font-black uppercase tracking-wider text-stone-450 block font-mono">
                  Mapping Status
                </label>
                <CustomSelect
                  theme={theme === "dark" ? "dark" : "light"}
                  value={auditStatusFilter}
                  onChange={setAuditStatusFilter}
                  triggerClassName={`w-full flex items-center justify-between gap-2 text-xs pl-3 pr-8 py-2 rounded-xl border outline-none font-semibold cursor-pointer relative ${
                    theme === 'dark'
                      ? 'bg-[#060a12] border-stone-800 text-white'
                      : 'bg-white border-stone-200 text-stone-900'
                  }`}
                  options={[
                    { value: "All", label: "All" },
                    { value: "Level 1: Direct Match", label: "Level 1: Direct Match" },
                    { value: "Level 2: Category Match", label: "Level 2: Category Match" },
                    { value: "Level 3: Fallback", label: "Level 3: Fallback" },
                    { value: "Needs Clarification", label: "Needs Clarification" },
                    { value: "Not a Medical Ailment", label: "Not a Medical Ailment" },
                  ]}
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] font-black uppercase tracking-wider text-stone-450 block font-mono">
                  Mapping Source
                </label>
                <CustomSelect
                  theme={theme === "dark" ? "dark" : "light"}
                  value={auditTypeFilter}
                  onChange={setAuditTypeFilter}
                  triggerClassName={`w-full flex items-center justify-between gap-2 text-xs pl-3 pr-8 py-2 rounded-xl border outline-none font-semibold cursor-pointer relative ${
                    theme === 'dark'
                      ? 'bg-[#060a12] border-stone-800 text-white'
                      : 'bg-white border-stone-200 text-stone-900'
                  }`}
                  options={[
                    { value: "All", label: "All" },
                    { value: "System Rule", label: "System Rule" },
                    { value: "AI Generated", label: "AI Generated" },
                  ]}
                />
              </div>
            </div>

            {/* Date filter inputs */}
            <div className="grid grid-cols-2 gap-2 pt-1">
              <div className="space-y-1.5">
                <label className="text-[10px] font-black uppercase tracking-wider text-stone-500 dark:text-stone-300 block font-mono flex items-center gap-1">
                  <Calendar className="w-3 h-3 text-cyan-500 dark:text-cyan-400" />
                  Start Date
                </label>
                <DateInputDMY
                  value={auditStartDate}
                  onChange={setAuditStartDate}
                  displayClassName={`w-full text-xs px-2 py-2 rounded-xl border font-semibold flex items-center ${
                    theme === 'dark'
                      ? 'bg-[#060a12] border-stone-800 text-white'
                      : 'bg-white border-stone-200 text-stone-900'
                  }`}
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] font-black uppercase tracking-wider text-stone-500 dark:text-stone-300 block font-mono flex items-center gap-1">
                  <Calendar className="w-3 h-3 text-cyan-500 dark:text-cyan-400" />
                  End Date
                </label>
                <DateInputDMY
                  value={auditEndDate}
                  onChange={setAuditEndDate}
                  displayClassName={`w-full text-xs px-2 py-2 rounded-xl border font-semibold flex items-center ${
                    theme === 'dark'
                      ? 'bg-[#060a12] border-stone-800 text-white'
                      : 'bg-white border-stone-200 text-stone-900'
                  }`}
                />
              </div>
            </div>

            {(auditStartDate || auditEndDate) && (
              <button
                onClick={() => {
                  setAuditStartDate("");
                  setAuditEndDate("");
                }}
                className={`w-full py-1.5 text-[10px] font-black uppercase tracking-wider border rounded-xl transition-all cursor-pointer ${
                  theme === 'dark'
                    ? 'bg-stone-500/10 hover:bg-stone-500/20 border-stone-700 text-stone-300'
                    : 'bg-stone-50 hover:bg-stone-100 border-stone-200 text-stone-700'
                }`}
              >
                Reset Date Filters
              </button>
            )}
          </div>

          {/* Distribution Chart Card — same flat transparent-grey treatment
              as the Filters Card above (was a teal/blue gradient wash). */}
          <div className={`relative overflow-hidden lg:col-span-8 rounded-2xl border p-5 flex flex-col justify-between ${
            theme === "dark"
              ? "bg-white/[0.03] border-white/[0.08]"
              : "bg-black/[0.02] border-black/[0.08]"
          }`}>
            <div className="absolute left-1/3 bottom-0 w-64 h-64 bg-white/[0.02] dark:bg-white/[0.03] rounded-full blur-3xl pointer-events-none" />
            <div className="pb-3 border-b border-stone-200 dark:border-stone-850 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Activity className="w-4 h-4 text-emerald-500" />
                <h3 className={`text-xs font-black uppercase tracking-wider ${theme === 'dark' ? 'text-white' : 'text-[#111827]'}`}>
                  Match Category Distribution
                </h3>
              </div>
              <div className={`text-[10px] font-black uppercase tracking-wider px-2.5 py-0.5 rounded font-sans ${
                theme === 'dark' ? 'text-teal-400 bg-teal-500/10' : 'text-stone-700 bg-stone-100'
              }`}>
                Total Lookups: {auditTotal.toLocaleString()}
              </div>
            </div>

            {/* Recharts BarChart Container */}
            <div className="w-full h-56 pt-4 font-sans text-[11px] font-bold">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={auditChartData} margin={{ top: 20, right: 10, left: -25, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={theme === 'dark' ? '#1F2937' : '#E5E7EB'} />
                  <XAxis
                    dataKey="name"
                    stroke={theme === 'dark' ? '#9CA3AF' : '#4B5563'}
                    fontSize={10}
                    tickLine={false}
                  />
                  <YAxis
                    stroke={theme === 'dark' ? '#9CA3AF' : '#4B5563'}
                    fontSize={10}
                    allowDecimals={false}
                    tickLine={false}
                  />
                  <Tooltip
                    content={({ active, payload, label }) => {
                      if (active && payload && payload.length) {
                        return (
                          <div className={`p-2.5 rounded-xl border text-xs font-sans shadow-lg font-bold ${
                            theme === 'dark'
                              ? 'bg-stone-900 border-stone-800 text-zinc-100'
                              : 'bg-white border-stone-200 text-stone-950'
                          }`}>
                            <p className="opacity-75 mb-0.5">{label}</p>
                            <p className="text-xs font-black flex items-center gap-1.5" style={{ color: payload[0].payload.color }}>
                              <span>Count:</span>
                              <span>{payload[0].value}</span>
                            </p>
                          </div>
                        );
                      }
                      return null;
                    }}
                  />
                  <Bar
                    dataKey="count"
                    radius={[4, 4, 0, 0]}
                    label={{
                      position: 'top',
                      fill: theme === 'dark' ? '#E4E4E7' : '#3F3F46',
                      fontSize: 10,
                      fontWeight: 'bold',
                      fontFamily: 'Inter, system-ui, sans-serif'
                    }}
                  >
                    {auditChartData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      )}

      {/* TABLE CONTAINER: FOLLOWED DIRECTLY BY THE TABLE */}
      <div className={`rounded-2xl border overflow-hidden ${
        theme === "dark" ? "bg-white/[0.03] border-white/[0.08]" : "bg-black/[0.02] border-black/[0.08]"
      }`}>
        <div className="overflow-x-auto max-h-[600px]">
          {auditLoading ? (
            <div className="p-16 text-center flex flex-col items-center justify-center font-sans">
              <Activity className="w-10 h-10 text-[#117FDA] dark:text-sky-400 mb-3 stroke-1 animate-pulse" />
              <p className={`text-xs font-black uppercase tracking-wider ${theme === 'dark' ? 'text-stone-300' : 'text-[#111827]'}`}>Loading activity log...</p>
            </div>
          ) : auditEntries.length === 0 ? (
            hasActiveAuditFilter ? (
              <div className="p-16 text-center flex flex-col items-center justify-center font-sans">
                <Search className="w-10 h-10 text-amber-500 mb-3 stroke-1 animate-pulse" />
                <p className={`text-xs font-black uppercase tracking-wider ${theme === 'dark' ? 'text-stone-300' : 'text-[#111827]'}`}>No matching audit trail logs.</p>
                <p className={`text-[11px] mt-1.5 font-semibold ${theme === 'dark' ? 'text-stone-450' : 'text-stone-605'}`}>Try adjusting or clearing your active filter options to view historical matches.</p>
              </div>
            ) : (
              <div className="p-16 text-center flex flex-col items-center justify-center font-sans">
                <Activity className="w-10 h-10 text-[#117FDA] dark:text-sky-400 mb-3 stroke-1 animate-pulse" />
                <p className={`text-xs font-black uppercase tracking-wider ${theme === 'dark' ? 'text-stone-300' : 'text-[#111827]'}`}>Audit trail ledger is empty.</p>
                <p className={`text-[11px] mt-1.5 font-semibold ${theme === 'dark' ? 'text-stone-450' : 'text-stone-605'}`}>Matched lookup declarations are kept recorded here dynamically.</p>
              </div>
            )
          ) : (
            <table className="w-full text-left border-collapse text-xs">
              {/* bg-inherit on each <th> used to rely on inheriting the
                  <thead>'s background — with border-collapse: collapse,
                  <thead>/<tr> backgrounds don't reliably paint in every
                  browser, so in light theme the sticky header ended up
                  effectively see-through and scrolled row content (e.g. an
                  expanded mapping explanation) bled through it. Every <th>
                  now carries its own explicit opaque background instead,
                  matching the safer pattern already used in
                  AnnouncementLogPage.tsx/AnnouncementArchivePage.tsx. Dark
                  theme's solid hex background never had this problem, which
                  is why only light theme showed it. */}
              <thead>
                <tr>
                  {/* Explicit widths: without them the browser sizes columns
                      by content, which let a long medical condition stretch
                      that column and squeeze everything else. */}
                  <th className={`py-3.5 px-5 w-14 text-center text-[11px] font-extrabold uppercase tracking-wider sticky top-0 z-20 border-b ${auditThBg}`}>No.</th>
                  <SortableTh label="Adviser" sortKey="adviser" activeSort={auditLogsSort} onSort={toggleAuditLogsSort} className={`py-3.5 px-5 w-52 text-[11px] font-extrabold uppercase tracking-wider sticky top-0 z-20 border-b ${auditThBg}`} />
                  <SortableTh label="Date & Time" sortKey="timestamp" activeSort={auditLogsSort} onSort={toggleAuditLogsSort} className={`py-3.5 px-5 w-44 text-[11px] font-extrabold uppercase tracking-wider sticky top-0 z-20 border-b ${auditThBg}`} />
                  <SortableTh label="Plan Name" sortKey="planName" activeSort={auditLogsSort} onSort={toggleAuditLogsSort} className={`py-3.5 px-5 w-36 text-[11px] font-extrabold uppercase tracking-wider sticky top-0 z-20 border-b ${auditThBg}`} />
                  <SortableTh label="Medical Condition" sortKey="pedInput" activeSort={auditLogsSort} onSort={toggleAuditLogsSort} className={`py-3.5 px-5 w-40 text-[11px] font-extrabold uppercase tracking-wider sticky top-0 z-20 border-b ${auditThBg}`} />
                  <SortableTh label="Mapping Status" sortKey="matchType" activeSort={auditLogsSort} onSort={toggleAuditLogsSort} className={`py-3.5 px-5 w-32 text-[11px] font-extrabold uppercase tracking-wider sticky top-0 z-20 border-b ${auditThBg}`} />
                  <SortableTh label="Matched Question" sortKey="matchedQuestion" activeSort={auditLogsSort} onSort={toggleAuditLogsSort} className={`py-3.5 px-5 text-[11px] font-extrabold uppercase tracking-wider sticky top-0 z-20 border-b ${auditThBg}`} />
                  <SortableTh label="Source" sortKey="source" activeSort={auditLogsSort} onSort={toggleAuditLogsSort} className={`py-3.5 px-5 w-32 text-[11px] font-extrabold uppercase tracking-wider sticky top-0 z-20 border-b ${auditThBg}`} />
                </tr>
              </thead>
              <tbody className={`divide-y font-semibold ${
                theme === "dark" ? "divide-stone-800 text-stone-300" : "divide-stone-200 text-stone-900"
              }`}>
                {auditEntries.map((log, index) => {
                  const adviser = resolveAdviser(log.userEmail);
                  const isExpanded = expandedRows.has(index);
                  return (
                  <Fragment key={index}>
                  <tr
                    onClick={() => toggleRow(index)}
                    title={isExpanded ? "Hide mapping explanation" : "Show mapping explanation"}
                    className="hover:bg-stone-500/5 transition-colors cursor-pointer"
                  >
                    <td className="py-3 px-5 text-center font-mono text-[10px] opacity-60">{index + 1}</td>
                    {/* TACT ID first, then the advisor's real name from the
                        user directory. Normal weight — this is reference
                        data, not a heading. */}
                    <td className={`py-3 px-5 text-[11px] font-medium ${
                      theme === "dark" ? "text-stone-300" : "text-[#111827]"
                    }`}>
                      <span className="min-w-0">
                        <span className={`font-mono text-[10px] mr-1.5 ${theme === "dark" ? "text-stone-500" : "text-stone-500"}`}>
                          {adviser.tactId}
                        </span>
                        <span className="break-words">{adviser.name}</span>
                      </span>
                    </td>
                    <td className="py-3 px-5 text-[11px] whitespace-nowrap font-sans font-medium">
                      <span className={`flex items-center gap-1.5 ${theme === "dark" ? "text-stone-400" : "text-stone-550"}`}>
                        <Clock className="w-3.5 h-3.5 shrink-0 text-stone-400" />
                        {formatDisplayTimestamp(log.timestamp)}
                      </span>
                    </td>
                    <td className={`py-3 px-5 font-extrabold ${
                      theme === "dark" ? "text-stone-200" : "text-[#111827]"
                    }`}>{log.planName}</td>
                    {/* Plain text, wrapping. The blue badge treatment is
                        reserved for status columns — using it here made an
                        ordinary data value look like a state, and
                        whitespace-nowrap forced the column wide. */}
                    <td className={`py-3 px-5 text-[11px] font-medium break-words ${
                      theme === "dark" ? "text-stone-200" : "text-[#111827]"
                    }`}>
                      {log.pedInput}
                    </td>
                    <td className="py-3 px-5">
                      {(() => {
                        // Shared taxonomy (src/utils/matchTier.ts) — same
                        // Level 1/2/3 + Needs Clarification / Not a Medical
                        // Ailment scheme as the live Declaration Assistant
                        // results screen and My Activity Journal.
                        const tier = getMatchTierInfo(log.matchType);
                        const badgeClass =
                          tier.level === 1
                            ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30 font-sans"
                            : tier.level === 2
                              ? "bg-blue-500/15 text-sky-400 border-blue-500/30 font-sans"
                              : tier.level === 3
                                ? "bg-amber-500/15 text-amber-400 border-amber-500/30 font-sans"
                                : "bg-stone-500/15 text-stone-400 border-stone-500/30 font-sans";
                        return (
                          <span className={`px-2.5 py-1 rounded-lg text-[10px] font-black uppercase border whitespace-nowrap ${badgeClass}`}>
                            {tier.levelLabel}
                          </span>
                        );
                      })()}
                    </td>
                    {/* Wraps rather than truncating, and carries the
                        expand affordance for the explanation below. */}
                    <td className={`py-3 px-5 font-semibold ${
                      theme === "dark" ? "text-stone-200" : "text-[#111827]"
                    }`}>
                      <div className="flex items-start gap-1.5">
                        <ChevronRight
                          className={`w-3.5 h-3.5 shrink-0 mt-0.5 transition-transform ${
                            isExpanded ? "rotate-90" : ""
                          } ${theme === "dark" ? "text-stone-500" : "text-stone-500"}`}
                        />
                        <span className="break-words">{log.matchedQuestion}</span>
                      </div>
                    </td>
                    <td className="py-3 px-5 text-[10px] font-sans font-bold text-sky-455 pr-4 whitespace-nowrap">
                      {translateSourceToLayman(log.source)}
                    </td>
                  </tr>

                  {/* Expanded detail — the engine's reasoning for this
                      mapping. Previously only reachable as a `title`
                      tooltip on a truncated cell, so it was effectively
                      invisible. */}
                  {isExpanded && (
                    <tr className={theme === "dark" ? "bg-white/[0.02]" : "bg-stone-50"}>
                      <td />
                      <td colSpan={7} className="px-5 pb-4 pt-0 align-top">
                        <div className={`rounded-lg border p-3 ${
                          theme === "dark"
                            ? "bg-white/[0.02] border-white/[0.06]"
                            : "bg-white border-[#D2DFEC]"
                        }`}>
                          <span className={`block text-[9px] font-black uppercase tracking-wider mb-1 ${
                            theme === "dark" ? "text-stone-500" : "text-stone-500"
                          }`}>
                            Why this mapping
                          </span>
                          <p className={`text-[11px] leading-relaxed font-sans font-medium ${
                            theme === "dark" ? "text-stone-300" : "text-stone-700"
                          }`}>
                            {log.explanation || "No explanation was recorded for this lookup."}
                          </p>
                        </div>
                      </td>
                    </tr>
                  )}
                  </Fragment>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {!auditLoading && auditEntries.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-[10.5px] font-semibold text-content-muted">
            Showing {(auditPage - 1) * PAGE_SIZE + 1}
            {"–"}
            {Math.min(auditPage * PAGE_SIZE, auditTotal)} of {auditTotal.toLocaleString()} entries.
          </p>
          <Pagination theme={theme} page={auditPage} totalPages={auditTotalPages} onPageChange={setAuditPage} />
        </div>
      )}
      </>
      )}

      {/* MODIFICATION HISTORY SUB-PAGE VIEW */}
      {auditSubTab === "modification" && (
        <div className="space-y-4">

          {/* Control Bar: Filters, Search, CSV Exporter */}
          <div className={`rounded-xl border p-4 flex flex-col md:flex-row justify-between items-start md:items-center gap-4 ${
            theme === 'dark' ? 'bg-white/[0.03] border-white/[0.08]' : 'bg-black/[0.02] border-black/[0.08]'
          }`}>
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 w-full md:w-auto">
              {/* Search Log Input */}
              <div className="relative">
                {/* Self-centering (top-1/2 + -translate-y-1/2), matching every
                    other search input in the app, instead of a hardcoded
                    top-3 offset that assumed one exact input height. */}
                <Search className="w-4 h-4 text-stone-500 absolute left-3.5 top-1/2 -translate-y-1/2 select-none" />
                <input
                  id="search-history-input"
                  type="text"
                  value={historySearch}
                  onChange={(e) => setHistorySearch(e.target.value)}
                  placeholder="Search Modification History..."
                  className={`w-full sm:w-64 pl-10 pr-4 py-2 text-xs rounded-xl outline-none focus:border-[#117FDA] font-semibold border ${
                    theme === 'dark'
                      ? 'bg-[#060a12] border-stone-800 text-stone-200'
                      : 'bg-white border-stone-200 text-stone-800'
                  }`}
                />
              </div>

              {/* Filter Change Type */}
              <div className="w-auto min-w-[180px]">
                <CustomSelect
                  id="filter-change-type-select"
                  theme={theme === "dark" ? "dark" : "light"}
                  value={historyActionFilter}
                  onChange={setHistoryActionFilter}
                  triggerClassName={`w-full flex items-center justify-between gap-2 pl-3.5 pr-8 py-2 rounded-xl text-xs font-bold border cursor-pointer relative ${
                    theme === 'dark'
                      ? 'bg-stone-950 border-stone-850 text-stone-300'
                      : 'bg-white border-stone-200 text-stone-800'
                  }`}
                  options={[
                    // Values are matched with startsWith against
                    // log.actionType, so each is a prefix of the action
                    // names the server writes.
                    { value: "All", label: "All Actions" },
                    { value: "Announcement", label: "Announcement Activity" },
                    { value: "Flagged Response", label: "Flagged Response Activity" },
                    { value: "User", label: "User Directory Activity" },
                    { value: "PED Repository", label: "PED Repository Activity" },
                    { value: "Page Visibility", label: "Page Visibility Activity" },
                  ]}
                />
              </div>
            </div>

            {/* Dynamic CSV Downloader button */}
            <button
              id="export-csv-button"
              onClick={exportChangeLogsCsv}
              disabled={historyExporting || changeLogTotal === 0}
              className="w-full md:w-auto px-4 py-2 border border-blue-500/40 text-blue-400 bg-blue-500/5 hover:bg-blue-500/10 hover:border-blue-500 hover:text-blue-300 rounded-xl text-xs font-black uppercase tracking-wider transition-all flex items-center justify-center gap-2 cursor-pointer shadow-md select-none disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Download className="w-4 h-4" /> {historyExporting ? "Exporting..." : "Export"}
            </button>
          </div>

          {/* Audit Logs Table Ledger layout */}
          <div className={`rounded-2xl border overflow-hidden ${
            theme === "dark" ? "bg-white/[0.03] border-white/[0.08]" : "bg-black/[0.02] border-black/[0.08]"
          }`}>
            <div className="overflow-x-auto max-h-[600px]">
              <table id="change-history-table" className="w-full text-left border-collapse text-xs">
                {/* See the Audit Logs table's <thead> comment above — same
                    fix, explicit per-<th> background instead of relying on
                    <thead>'s (which border-collapse doesn't reliably paint). */}
                <thead>
                  <tr>
                    <SortableTh label="Timestamp" sortKey="timestamp" activeSort={changeLogsSort} onSort={toggleChangeLogsSort} className={`py-3.5 px-5 text-[11px] font-extrabold uppercase tracking-wider sticky top-0 z-20 border-b ${changeLogThBg}`} />
                    <SortableTh label="User" sortKey="userName" activeSort={changeLogsSort} onSort={toggleChangeLogsSort} className={`py-3.5 px-5 text-[11px] font-extrabold uppercase tracking-wider sticky top-0 z-20 border-b ${changeLogThBg}`} />
                    <SortableTh label="Role" sortKey="role" activeSort={changeLogsSort} onSort={toggleChangeLogsSort} className={`py-3.5 px-5 text-[11px] font-extrabold uppercase tracking-wider sticky top-0 z-20 border-b ${changeLogThBg}`} />
                    <SortableTh label="Action Event" sortKey="actionType" activeSort={changeLogsSort} onSort={toggleChangeLogsSort} className={`py-3.5 px-5 text-[11px] font-extrabold uppercase tracking-wider sticky top-0 z-20 border-b ${changeLogThBg}`} />
                    <SortableTh label="Plan" sortKey="planName" activeSort={changeLogsSort} onSort={toggleChangeLogsSort} className={`py-3.5 px-5 text-[11px] font-extrabold uppercase tracking-wider sticky top-0 z-20 border-b ${changeLogThBg}`} />
                    <SortableTh label="Description Record" sortKey="description" activeSort={changeLogsSort} onSort={toggleChangeLogsSort} className={`py-3.5 px-5 text-[11px] font-extrabold uppercase tracking-wider sticky top-0 z-20 border-b ${changeLogThBg}`} />
                  </tr>
                </thead>
                <tbody className={`divide-y font-semibold ${
                  theme === "dark" ? "divide-stone-800 text-stone-300" : "divide-stone-200 text-stone-900"
                }`}>
                  {changeLogLoading ? (
                    <tr>
                      <td colSpan={6} className="p-16 text-center text-stone-500 font-bold font-sans">
                        Loading modification history...
                      </td>
                    </tr>
                  ) : changeLogEntries.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="p-16 text-center text-stone-500 font-bold font-sans">
                        No auditable records found matching query filter.
                      </td>
                    </tr>
                  ) : (
                    changeLogEntries.map((log) => {
                      const isAddedVal = log.actionType.includes("Added");
                      const isResolvedVal = log.actionType.includes("Resolved");
                      const isEditedVal = log.actionType.includes("Edited");
                      const isIgnoredVal = log.actionType.includes("Ignored");
                      const isDeletedVal = log.actionType.includes("Deleted");

                      return (
                        <tr
                          key={log.id}
                          className="hover:bg-stone-500/5 transition-colors text-xs font-semibold"
                        >
                          <td className="py-3.5 px-5 font-mono text-[10px] opacity-70">
                            {new Date(log.timestamp).toLocaleString("en-US", {
                              month: "short",
                              day: "2-digit",
                              hour: "2-digit",
                              minute: "2-digit",
                              second: "2-digit",
                              hour12: false
                            })}
                          </td>
                          <td className="py-3.5 px-5 font-extrabold">{log.userName}</td>
                          <td className="py-3.5 px-5">
                            <span className={`px-2 py-0.5 rounded text-[8.5px] uppercase font-black ${
                              log.role === "Owner" || log.role === "Developer"
                                ? "bg-red-500/10 text-red-400 border border-red-500/20"
                                : log.role === "Admin"
                                ? "bg-amber-500/10 text-amber-300 border border-amber-500/20"
                                : "bg-sky-500/10 text-sky-455 border border-sky-500/10"
                            }`}>
                              {log.role || "Admin"}
                            </span>
                          </td>
                          <td className="py-3.5 px-5">
                            <span className={`px-2 py-0.5 rounded text-[8.5px] uppercase font-black ${
                              isAddedVal
                                ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                                : isResolvedVal
                                ? "bg-cyan-500/10 text-cyan-400 border border-cyan-500/25"
                                : isEditedVal
                                ? "bg-blue-500/10 text-blue-400 border border-blue-500/20"
                                : isIgnoredVal
                                ? "bg-amber-500/10 text-amber-300 border border-amber-500/20"
                                : isDeletedVal
                                ? "bg-rose-500/10 text-rose-450 border border-rose-500/20"
                                : "bg-stone-500/10 text-stone-400 border border-stone-500/20"
                            }`}>
                              {log.actionType}
                            </span>
                          </td>
                          <td className="py-3.5 px-5 font-mono text-xs font-extrabold">{log.planName}</td>
                          <td className="py-3.5 px-5 leading-relaxed font-sans font-medium opacity-95 max-w-sm whitespace-normal">
                            {log.description}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {!changeLogLoading && changeLogEntries.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-[10.5px] font-semibold text-content-muted">
                Showing {(historyPage - 1) * PAGE_SIZE + 1}
                {"–"}
                {Math.min(historyPage * PAGE_SIZE, changeLogTotal)} of {changeLogTotal.toLocaleString()} entries.
              </p>
              <Pagination theme={theme} page={historyPage} totalPages={changeLogTotalPages} onPageChange={setHistoryPage} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
