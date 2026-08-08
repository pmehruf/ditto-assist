/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from "react";
import { Search, Clock, History, ChevronDown, Download } from "lucide-react";
import { PLANS } from "../types";
import { AuditLogEntry } from "../types/announcements";
import { LoggedUser } from "../types/user";
import { getMatchTierInfo } from "../utils/matchTier";
import { translateSourceToLayman } from "../utils/labelTranslation";
import { CustomSelect } from "../components/CustomSelect";
import { SortableTh } from "../components/SortableTh";
import { Pagination } from "../components/Pagination";
import { DateInputDMY } from "../components/DateInputDMY";
import { ClippedButton } from "../components/ClippedButton";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import { useServerSort } from "../hooks/useServerSort";
import { downloadCSV } from "../utils/csvExport";

const PAGE_SIZE = 50;

/** My Activity's sortKeys -> the server-side search_history column each
 * maps to (searchHistoryRepository.ts). */
const MY_ACTIVITY_SORT_KEY_MAP: Record<string, string> = {
  pedInput: "pedInput",
  timestamp: "timestamp",
  planName: "planName",
  matchedQuestion: "matchedQuestion",
  matchType: "matchType",
};

interface MyActivityPageProps {
  currentUser: LoggedUser | null;
  theme: "light" | "dark";
  myActivitySearch: string;
  setMyActivitySearch: (value: string) => void;
  myActivityPlanFilter: string;
  setMyActivityPlanFilter: (value: string) => void;
  myActivityStartDate: string;
  setMyActivityStartDate: (value: string) => void;
  myActivityEndDate: string;
  setMyActivityEndDate: (value: string) => void;
  expandedLogIndex: string | null;
  setExpandedLogIndex: (value: string | null) => void;
}

/**
 * "My Activity Journal" tab content. Extracted verbatim from App.tsx
 * (Phase 1.3) — same filtering/parsing logic, same markup. The
 * `activeTab === "my_activity"` condition and wrapping
 * `<motion.div key="my_activity">` deliberately stay in App.tsx (see
 * ResourcesPage.tsx for why).
 */
export function MyActivityPage({
  currentUser,
  theme,
  myActivitySearch,
  setMyActivitySearch,
  myActivityPlanFilter,
  setMyActivityPlanFilter,
  myActivityStartDate,
  setMyActivityStartDate,
  myActivityEndDate,
  setMyActivityEndDate,
  expandedLogIndex,
  setExpandedLogIndex,
}: MyActivityPageProps) {
  const userEmail = currentUser?.email || "advisor@joinditto.in";
  const debouncedSearch = useDebouncedValue(myActivitySearch, 350);
  const [page, setPage] = useState(1);
  const { sort: myLogsSort, toggleSort: toggleMyLogsSort } = useServerSort({ key: "timestamp", direction: "desc" });

  const [myLogs, setMyLogs] = useState<AuditLogEntry[]>([]);
  const [filteredTotal, setFilteredTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [totalLookups, setTotalLookups] = useState(0);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, myActivityPlanFilter, myActivityStartDate, myActivityEndDate, myLogsSort?.key, myLogsSort?.direction]);

  // Shared between the paginated fetch and CSV export, so the export always
  // reflects the exact same filters currently applied to the table (not
  // just whatever's visible on the current page).
  const buildParams = (forExport: boolean) => {
    const params = new URLSearchParams({ paginated: "1", userEmail });
    if (!forExport) params.set("page", String(page));
    params.set("pageSize", forExport ? "10000" : String(PAGE_SIZE));
    if (debouncedSearch) params.set("search", debouncedSearch);
    if (myActivityPlanFilter !== "All") params.set("planName", myActivityPlanFilter);
    if (myActivityStartDate) params.set("from", myActivityStartDate);
    if (myActivityEndDate) params.set("to", myActivityEndDate);
    if (myLogsSort) {
      params.set("sortBy", MY_ACTIVITY_SORT_KEY_MAP[myLogsSort.key] || myLogsSort.key);
      params.set("sortDir", myLogsSort.direction);
    }
    return params;
  };

  const exportCsv = async () => {
    setExporting(true);
    try {
      const res = await fetch(`/api/search-history?${buildParams(true).toString()}&export=1`);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      downloadCSV(Array.isArray(body.entries) ? body.entries : [], "my-activity-journal.csv");
    } catch (err) {
      console.error("Failed to export My Activity:", err);
    } finally {
      setExporting(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/search-history?${buildParams(false).toString()}`)
      .then(async (res) => {
        const body = await res.json();
        if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
        if (cancelled) return;
        setMyLogs(body.entries || []);
        setFilteredTotal(body.total ?? 0);
        setTotalPages(body.totalPages ?? 1);
        if (typeof body.page === "number" && body.page !== page) setPage(body.page);
      })
      .catch((err) => console.error("Failed to load My Activity from the server:", err))
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userEmail, page, debouncedSearch, myActivityPlanFilter, myActivityStartDate, myActivityEndDate, myLogsSort?.key, myLogsSort?.direction]);

  // "Total Lookups" stat — this user's grand total, unaffected by the
  // current search/filter. A separate lightweight COUNT-only request
  // (pageSize=1) rather than deriving it from a fully-loaded array.
  useEffect(() => {
    fetch(`/api/search-history?${new URLSearchParams({ paginated: "1", userEmail, page: "1", pageSize: "1" }).toString()}`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then((body) => setTotalLookups(body.total ?? 0))
      .catch((err) => console.error("Failed to load lookup total:", err));
  }, [userEmail]);

  const hasActiveFilter = Boolean(myActivitySearch || myActivityPlanFilter !== "All" || myActivityStartDate || myActivityEndDate);

  return (
    <div className="space-y-5 animate-fade-in">
      {/* PAGE-LEVEL HEADER */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 pb-3 border-b border-stone-200 dark:border-stone-800">
        <div>
          <h1 className={`text-page-title tracking-tight flex items-center gap-2 ${
            theme === "dark" ? "text-white" : "text-[#111827]"
          }`}>
            <div className="w-8 h-0.5 flex-shrink-0" style={{ backgroundColor: theme === "dark" ? "#00D3F3" : "#4673a9" }} />
            <span>My Activity Journal</span>
          </h1>
          <p className="text-xs mt-1 font-semibold text-content-muted">
            Analyze and search your history of medical declaration lookups and underwriting decisions.
          </p>
        </div>
        <ClippedButton
          onClick={exportCsv}
          disabled={exporting || filteredTotal === 0}
          size="sm"
          title="Export the filtered activity log as a CSV file"
          className="shrink-0 gap-1.5 pl-2 pr-2.5 py-1.5 text-white text-[10px] font-black uppercase tracking-wider bg-[#117FDA] hover:bg-[#0d6dbb]"
        >
          <Download className="w-3.5 h-3.5 shrink-0" />
          <span>Export CSV</span>
        </ClippedButton>
      </div>

      {/* SEARCH + STATS — merged into one card. Flat transparent-grey glass
          card (was a teal/blue gradient wash) matching the neutral card
          treatment from an earlier version of this page. The quick-stat
          numbers used to live in their own separate row of cards with a
          mismatched gradient direction (bg-gradient-to-br vs this card's
          bg-gradient-to-r) — folded in here as a compact stat row instead,
          with the Advisor Profile card dropped (the signed-in email is
          already shown in the top nav bar). */}
      <div
        className={`p-4 rounded-2xl border ${
          theme === "dark"
            ? "bg-white/[0.03] border-white/[0.08]"
            : "bg-surface-elevated border-[var(--border-strong)]"
        }`}
      >
        {/* Quick stats row */}
        <div className={`flex items-center gap-6 pb-3 mb-3 border-b ${theme === "dark" ? "border-white/[0.06]" : "border-stone-200/70"}`}>
          <div>
            <p className={`text-[10px] font-bold uppercase tracking-wider ${theme === "dark" ? "text-zinc-400" : "text-stone-600"}`}>Total Lookups</p>
            <p className="text-xl font-black mt-0.5" style={{ color: theme === "dark" ? "#22d3ee" : "#0284c7" }}>{totalLookups.toLocaleString()}</p>
          </div>
          <div className={`w-px self-stretch ${theme === "dark" ? "bg-white/[0.06]" : "bg-stone-200/70"}`} />
          <div>
            <p className={`text-[10px] font-bold uppercase tracking-wider ${theme === "dark" ? "text-zinc-400" : "text-stone-600"}`}>Filtered Matches</p>
            <p className="text-xl font-black mt-0.5" style={{ color: theme === "dark" ? "#22d3ee" : "#0284c7" }}>{filteredTotal.toLocaleString()}</p>
          </div>
        </div>

        {/* Search + filters row — one row, label-above-control (matches the
            filter pattern used on QA Dashboard / Coverage Projection Studio /
            Plan Reference / Announcements), search widest, plan medium,
            dates equal-width, all controls sharing the same py-1.5 height. */}
        <div className="flex flex-wrap items-end gap-3">
          {/* Search — widest control */}
          <div className="flex-1 min-w-[220px]">
            <label className={`block text-[10px] font-bold uppercase tracking-wider mb-1 ${theme === "dark" ? "text-stone-400" : "text-stone-500"}`}>
              Search Logs
            </label>
            <div className="relative">
              <Search className={`w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none ${theme === "dark" ? "text-stone-500" : "text-stone-400"}`} />
              <input
                type="text"
                placeholder="Search your search logs..."
                value={myActivitySearch}
                onChange={(e) => setMyActivitySearch(e.target.value)}
                className={`w-full py-1.5 pl-8 pr-8 text-xs font-semibold rounded-lg border outline-none transition-all ${
                  theme === "dark"
                    ? "bg-[#060A10] border-[#252A34] text-white focus:border-[#3B82F6]"
                    : "bg-white border-stone-250 text-stone-900 focus:border-[#3B82F6] focus:ring-1 focus:ring-[#3B82F6]/50 shadow-inner"
                }`}
              />
              {myActivitySearch && (
                <button
                  onClick={() => setMyActivitySearch("")}
                  className={`absolute right-2.5 top-1/2 -translate-y-1/2 text-xs font-bold ${theme === "dark" ? "text-stone-400 hover:text-stone-100" : "text-stone-400 hover:text-stone-700"}`}
                  title="Clear search"
                >
                  &times;
                </button>
              )}
            </div>
          </div>

          {/* Plan — medium width */}
          <div className="w-36 shrink-0">
            <label className={`block text-[10px] font-bold uppercase tracking-wider mb-1 ${theme === "dark" ? "text-stone-400" : "text-stone-500"}`}>
              Plan
            </label>
            <CustomSelect
              theme={theme}
              value={myActivityPlanFilter}
              onChange={setMyActivityPlanFilter}
              triggerClassName={`w-full flex items-center justify-between gap-2 text-xs font-semibold pl-2.5 pr-7 py-1.5 rounded-lg border outline-none cursor-pointer relative ${
                theme === "dark"
                  ? "bg-[#060A10] border-[#252A34] text-white focus:border-[#3B82F6]"
                  : "bg-white border-stone-250 text-stone-850 shadow-xs"
              }`}
              options={[
                { value: "All", label: "All Plans" },
                ...PLANS.map((p) => ({ value: p, label: p })),
              ]}
            />
          </div>

          {/* From Date */}
          <div className="shrink-0">
            <label className={`block text-[10px] font-bold uppercase tracking-wider mb-1 ${theme === "dark" ? "text-stone-400" : "text-stone-500"}`}>
              From Date
            </label>
            <DateInputDMY
              value={myActivityStartDate || ""}
              onChange={setMyActivityStartDate}
              displayClassName={`text-xs font-mono font-semibold py-1.5 px-2.5 rounded-lg border flex items-center gap-1.5 select-none min-w-[115px] justify-between ${
                theme === "dark"
                  ? "bg-[#14181D] border-[#252A34] text-white"
                  : "bg-white border-stone-250 text-stone-850 shadow-xs"
              }`}
              icon={<Clock className="w-3 h-3 text-stone-400 shrink-0" />}
            />
          </div>

          {/* To Date */}
          <div className="shrink-0">
            <label className={`block text-[10px] font-bold uppercase tracking-wider mb-1 ${theme === "dark" ? "text-stone-400" : "text-stone-500"}`}>
              To Date
            </label>
            <DateInputDMY
              value={myActivityEndDate || ""}
              onChange={setMyActivityEndDate}
              displayClassName={`text-xs font-mono font-semibold py-1.5 px-2.5 rounded-lg border flex items-center gap-1.5 select-none min-w-[115px] justify-between ${
                theme === "dark"
                  ? "bg-[#14181D] border-[#252A34] text-white"
                  : "bg-white border-stone-250 text-stone-850 shadow-xs"
              }`}
              icon={<Clock className="w-3 h-3 text-stone-400 shrink-0" />}
            />
          </div>

          {(myActivityStartDate || myActivityEndDate) && (
            <button
              onClick={() => {
                setMyActivityStartDate("");
                setMyActivityEndDate("");
              }}
              className={`text-[10px] font-bold px-2.5 py-1.5 rounded-lg cursor-pointer shrink-0 ${
                theme === "dark"
                  ? "text-red-400 hover:bg-stone-800 bg-stone-900/40 border border-red-500/10"
                  : "text-red-650 hover:bg-red-50 bg-red-50/40 border border-red-100"
              }`}
            >
              Reset
            </button>
          )}
        </div>
      </div>

      {/* ACTIVITIES TABLE / ACCORDION — same flat transparent-grey card. */}
      <div className={`rounded-xl border overflow-hidden ${
        theme === "dark" ? "bg-white/[0.03] border-white/[0.08]" : "bg-surface-elevated border-[var(--border-strong)]"
      }`}>
        {loading ? (
          <div className="p-16 text-center font-sans">
            <History className="w-10 h-10 text-stone-400 mx-auto mb-3 stroke-1 animate-pulse" />
            <p className={`text-sm font-bold ${theme === "dark" ? "text-white" : "text-stone-850"}`}>Loading your activity...</p>
          </div>
        ) : myLogs.length === 0 ? (
          <div className="p-16 text-center font-sans">
            <History className="w-10 h-10 text-stone-400 mx-auto mb-3 stroke-1 animate-pulse" />
            <p className={`text-sm font-bold ${theme === "dark" ? "text-white" : "text-stone-850"}`}>
              No activity history found
            </p>
            <p className="text-xs text-stone-500 mt-1">
              {!hasActiveFilter
                ? "Initiate a medical term lookup in the Declaration Assistant page to populate this history."
                : "Try relaxing your search terms or filters to reveal matching logs."}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead className={`text-[11px] font-bold uppercase tracking-wider border-b ${
                theme === "dark"
                  ? "bg-white/[0.02] text-[#9CA3AF] border-white/[0.08]"
                  : "bg-stone-100 text-stone-700 border-stone-200"
              }`}>
                <tr>
                  <SortableTh label="Medical Term / PED Query" sortKey="pedInput" activeSort={myLogsSort} onSort={toggleMyLogsSort} className="py-2 px-4" />
                  <SortableTh label="Time" sortKey="timestamp" activeSort={myLogsSort} onSort={toggleMyLogsSort} className="py-2 px-4" />
                  <SortableTh label="Insurance Plan" sortKey="planName" activeSort={myLogsSort} onSort={toggleMyLogsSort} className="py-2 px-4" />
                  <SortableTh label="Matched Question" sortKey="matchedQuestion" activeSort={myLogsSort} onSort={toggleMyLogsSort} className="py-2 px-4" />
                  <SortableTh label="Match Outcome" sortKey="matchType" activeSort={myLogsSort} onSort={toggleMyLogsSort} className="py-2 px-4" />
                  <th className="py-2 px-4 text-right">Action</th>
                </tr>
              </thead>
              <tbody className={`divide-y text-sm font-semibold ${
                theme === "dark" ? "divide-[#252A34] text-stone-200" : "divide-stone-200 text-stone-800"
              }`}>
                {myLogs.map((log) => {
                  const isExpanded = expandedLogIndex === log.timestamp;

                  // Shared taxonomy (src/utils/matchTier.ts) — same Level
                  // 1/2/3 + Needs Clarification / Not a Medical Ailment
                  // scheme as the live Declaration Assistant results screen
                  // and the admin Audit page. This replaces a previous
                  // lookup keyed on "perfect"/"approx"/"not matched" —
                  // values that never actually occur in real match_type
                  // data (the real values are P0/P1/P2/FALLBACK/etc.), so
                  // it always missed and silently printed the raw code
                  // ("P1", "P2"...) instead of a readable label.
                  const tier = getMatchTierInfo(log.matchType);
                  const matchBadgeClass =
                    tier.level === 1
                      ? (theme === "dark"
                          ? "bg-green-500/10 text-green-400 border border-green-500/10"
                          : "bg-green-50 text-green-750 border border-green-200/50")
                      : tier.level === 2
                        ? (theme === "dark"
                            ? "bg-sky-500/10 text-sky-400 border border-sky-500/10"
                            : "bg-sky-50 text-sky-750 border border-sky-200/50")
                        : tier.level === 3
                          ? (theme === "dark"
                              ? "bg-amber-500/10 text-amber-400 border border-amber-500/10"
                              : "bg-amber-50 text-amber-750 border border-amber-200/50")
                          : (theme === "dark"
                              ? "bg-stone-500/10 text-stone-400 border border-stone-500/10"
                              : "bg-stone-100 text-stone-600 border border-stone-200/50");

                  return (
                    <React.Fragment key={log.timestamp}>
                      <tr
                        className={`transition-colors duration-155 cursor-pointer ${
                          theme === "dark"
                            ? "hover:bg-stone-800/15"
                            : "hover:bg-stone-50"
                        } ${
                          isExpanded
                            ? theme === "dark" ? "bg-stone-800/25" : "bg-[#3B82F6]/5"
                            : ""
                        }`}
                        onClick={() => setExpandedLogIndex(isExpanded ? null : log.timestamp)}
                      >
                        <td
                          className="py-4 px-4 font-bold text-[13.5px] max-w-xs truncate"
                        >
                          <div className="flex items-center gap-2">
                            <ChevronDown
                              className={`w-4 h-4 text-stone-400 shrink-0 transition-transform duration-200 ${
                                isExpanded ? "rotate-180" : ""
                              }`}
                            />
                            <span className="truncate">{log.pedInput}</span>
                          </div>
                        </td>
                        <td
                          className="py-4 px-4 font-mono text-[12px]"
                        >
                          {(() => {
                            try {
                              const d = new Date(log.timestamp);
                              if (isNaN(d.getTime())) return log.timestamp;
                              return d.toLocaleString("en-US", {
                                month: "short",
                                day: "2-digit",
                                hour: "2-digit",
                                minute: "2-digit",
                                second: "2-digit",
                                hour12: false
                              });
                            } catch (_) {
                              return log.timestamp;
                            }
                          })()}
                        </td>
                        <td
                          className="py-4 px-4 font-extrabold text-[12.5px] text-sky-500"
                        >
                          {log.planName}
                        </td>
                        <td
                          className="py-4 px-4 max-w-xs truncate font-medium text-[12.5px]"
                          title={log.matchedQuestion || undefined}
                        >
                          {log.matchedQuestion || <span className="text-stone-400 font-normal">—</span>}
                        </td>
                        <td
                          className="py-4 px-4"
                        >
                          <span
                            className={`px-2.5 py-1 rounded-lg text-[10px] font-black uppercase whitespace-nowrap ${matchBadgeClass}`}
                          >
                            {tier.levelLabel}
                          </span>
                        </td>
                        <td
                          className="py-4 px-4 text-right"
                        >
                          <button
                            className={`text-[11px] font-bold px-2 py-1 rounded transition-all cursor-pointer ${
                              theme === "dark"
                                ? "text-[#3B82F6] hover:bg-[#3B82F6]/10"
                                : "text-blue-600 hover:bg-blue-50"
                            }`}
                          >
                            {isExpanded ? "Hide Details" : "View Details"}
                          </button>
                        </td>
                      </tr>

                      {isExpanded && (
                        <tr>
                          <td colSpan={6} className={`p-5 font-sans whitespace-pre-wrap ${
                            theme === "dark" ? "bg-stone-900/30" : "bg-stone-50/40"
                          }`}>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-5 text-sm text-left leading-relaxed">

                              {/* Left details pane */}
                              <div className="space-y-3.5">
                                <div>
                                  <p className="font-extrabold text-[10.5px] uppercase tracking-wider text-stone-400 mb-1">
                                    Tested Medical Term
                                  </p>
                                  <p className={`text-sm font-bold ${
                                    theme === "dark" ? "text-white" : "text-stone-900"
                                  }`}>
                                    {log.pedInput}
                                  </p>
                                </div>

                                <div>
                                  <p className="font-extrabold text-[10.5px] uppercase tracking-wider text-stone-500 mb-1">
                                    Matched Policy Clause / Proposal Question
                                  </p>
                                  <div className={`p-3 rounded-lg border leading-relaxed font-bold ${
                                    theme === "dark"
                                      ? "bg-[#171B22] border-[#252A34] text-stone-200"
                                      : "bg-white border-stone-200 text-stone-850"
                                  }`}>
                                    {log.matchedQuestion || "No direct question mapped."}
                                  </div>
                                </div>
                              </div>

                              {/* Right clinical explanation details pane */}
                              <div className="space-y-3.5">
                                <div>
                                  <p className="font-extrabold text-[10.5px] uppercase tracking-wider text-stone-500 mb-1">
                                    Clinical Underwriting Guidance & Explanation
                                  </p>
                                  <div className={`p-4 rounded-lg border font-medium ${
                                    theme === "dark"
                                      ? "bg-[#171B22] border-[#1f242e] text-stone-300"
                                      : "bg-white border-stone-150 text-stone-750"
                                  }`}>
                                    {log.explanation || "No explanation recorded."}
                                  </div>
                                </div>

                                <div className="flex select-none flex-wrap gap-4 pt-1 font-mono text-[11px] text-stone-400">
                                  <div>
                                    <span className="font-bold uppercase tracking-wider">Engine: </span>
                                    <span className="font-semibold text-stone-550">{translateSourceToLayman(log.source)}</span>
                                  </div>
                                </div>
                              </div>

                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {!loading && myLogs.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-[10.5px] font-semibold text-content-muted">
            Showing {(page - 1) * PAGE_SIZE + 1}
            {"–"}
            {Math.min(page * PAGE_SIZE, filteredTotal)} of {filteredTotal.toLocaleString()} entries.
          </p>
          <Pagination theme={theme} page={page} totalPages={totalPages} onPageChange={setPage} />
        </div>
      )}
    </div>
  );
}
