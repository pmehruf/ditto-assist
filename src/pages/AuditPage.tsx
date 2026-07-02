/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useMemo } from "react";
import { Filter, Search, Calendar, Activity, Download, User, Clock } from "lucide-react";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell } from "recharts";
import { AuditLogEntry } from "../types/announcements";
import { ChangeLogEntry } from "../types/changeLog";
import { parseGlobalLogTimestamp, formatDisplayTimestamp } from "../utils/timestamps";
import { translateMatchTypeToLayman, translateSourceToLayman } from "../utils/labelTranslation";

interface AuditPageProps {
  theme: "light" | "dark";
  auditSubTab: "user" | "modification";
  setAuditSubTab: (value: "user" | "modification") => void;
  auditLogs: AuditLogEntry[];
  auditSearch: string;
  setAuditSearch: (value: string) => void;
  auditPlanFilter: string;
  setAuditPlanFilter: (value: string) => void;
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
  changeLogs: ChangeLogEntry[];
}

/**
 * "Activity Log" (audit) tab content. Extracted verbatim from App.tsx
 * (Phase 1.3), including the two `useMemo` derivations (`filteredAuditLogs`,
 * `auditChartData`) that used to live in App() and were only ever consumed
 * here. The `activeTab === "audit"` condition and wrapping
 * `<motion.div key="audit">` deliberately stay in App.tsx (see
 * ResourcesPage.tsx for why).
 */
export function AuditPage({
  theme,
  auditSubTab,
  setAuditSubTab,
  auditLogs,
  auditSearch,
  setAuditSearch,
  auditPlanFilter,
  setAuditPlanFilter,
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
  changeLogs,
}: AuditPageProps) {
  const filteredAuditLogs = useMemo(() => {
    return auditLogs.filter(log => {
      const matchSearch =
        !auditSearch ||
        (log.userEmail || "").toLowerCase().includes(auditSearch.toLowerCase()) ||
        (log.pedInput || "").toLowerCase().includes(auditSearch.toLowerCase()) ||
        (log.matchedQuestion || "").toLowerCase().includes(auditSearch.toLowerCase());

      const matchPlan =
        auditPlanFilter === "All" ||
        log.planName === auditPlanFilter;

      // "System Rule" = resolved by the deterministic engine (source contains
      // "Deterministic", e.g. "Deterministic Underwriting Rule" / "Deterministic
      // Engine"); "AI Fallback" = everything else (Gemini API calls and their
      // own error-path fallbacks, e.g. "Live Gemini API" / "Disaster Recovery
      // Local Rules"). This mirrors the source-based bucketing convention
      // already used elsewhere in the app (see translateSourceToLayman).
      const isSystemRuleMatch = (log.source || "").toLowerCase().includes("deterministic");
      const matchType =
        auditTypeFilter === "All" ||
        (auditTypeFilter === "System Rule" && isSystemRuleMatch) ||
        (auditTypeFilter === "AI Fallback" && !isSystemRuleMatch);

      let matchDate = true;
      const logDate = parseGlobalLogTimestamp(log.timestamp);
      if (logDate) {
        const logTime = logDate.getTime();
        if (auditStartDate) {
          const startDateObj = new Date(auditStartDate);
          startDateObj.setHours(0, 0, 0, 0);
          if (logTime < startDateObj.getTime()) {
            matchDate = false;
          }
        }
        if (auditEndDate) {
          const endDateObj = new Date(auditEndDate);
          endDateObj.setHours(23, 59, 59, 999);
          if (logTime > endDateObj.getTime()) {
            matchDate = false;
          }
        }
      }

      return matchSearch && matchPlan && matchType && matchDate;
    });
  }, [auditLogs, auditSearch, auditPlanFilter, auditTypeFilter, auditStartDate, auditEndDate]);

  const auditChartData = useMemo(() => {
    let p0Count = 0;
    let p1Count = 0;
    let p2Count = 0;
    let fallbackCount = 0;
    let escalateCount = 0;
    let nonAilmentCount = 0;
    let otherCount = 0;

    filteredAuditLogs.forEach(log => {
      const type = String(log.matchType || "").toUpperCase();
      if (type === "P0" || type === "EXACT") p0Count++;
      else if (type === "P1" || type === "LIVE_MATCH" || type === "LIVE MATCH") p1Count++;
      else if (type === "P2") p2Count++;
      else if (type === "FALLBACK") fallbackCount++;
      else if (type === "ESCALATE") escalateCount++;
      else if (type === "NON_AILMENT") nonAilmentCount++;
      else otherCount++;
    });

    const data = [
      { name: "P0 (Exact)", count: p0Count, color: "#14B8A6" },
      { name: "P1 (Category)", count: p1Count, color: "#3B82F6" },
      { name: "P2 (Umbrella)", count: p2Count, color: "#F59E0B" },
      { name: "Fallback", count: fallbackCount, color: "#8B5CF6" },
      { name: "Officer Review", count: escalateCount, color: "#EF4444" },
      { name: "Non-Medical", count: nonAilmentCount, color: "#10B981" }
    ];

    if (otherCount > 0) {
      data.push({ name: "Other", count: otherCount, color: "#6B7280" });
    }

    return data;
  }, [filteredAuditLogs]);

  const filteredChangeLogs = useMemo(() => {
    return changeLogs.filter((log) => {
      const matchSearch =
        (log.planName || "").toLowerCase().includes(historySearch.toLowerCase()) ||
        (log.description || "").toLowerCase().includes(historySearch.toLowerCase()) ||
        (log.userName || "").toLowerCase().includes(historySearch.toLowerCase());
      const matchType = historyActionFilter === "All" || log.actionType === historyActionFilter;
      return matchSearch && matchType;
    });
  }, [changeLogs, historySearch, historyActionFilter]);

  return (
    <div className="space-y-6">
      {/* PAGE-LEVEL HEADER */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 pb-4 border-b border-stone-200 dark:border-stone-800">
        <div className="space-y-1">
          <h1 className={`text-xl md:text-2xl font-black tracking-tight flex items-center gap-2 ${
            theme === "dark" ? "text-white" : "text-[#111827]"
          }`}>
            <div className="w-8 h-0.5 flex-shrink-0" style={{ backgroundColor: theme === "dark" ? "#00D3F3" : "#4673a9" }} />
            <span>Activity Log</span>
          </h1>
          <p className={`text-xs font-semibold ${
            theme === "dark" ? "text-stone-400" : "text-stone-600"
          }`}>
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
                ? "bg-blue-600 text-white shadow-md font-extrabold"
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
                ? "bg-blue-600 text-white shadow-md font-extrabold"
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
        <div className="flex flex-wrap items-center gap-3 shrink-0 self-end md:self-auto justify-end w-full">
          <button
            onClick={() => downloadCSV(filteredAuditLogs, "ped-audit-history-crm.csv")}
            disabled={filteredAuditLogs.length === 0}
            className="px-4 py-2 text-xs font-extrabold bg-[#117FDA] hover:bg-[#0d6dbb] disabled:opacity-30 disabled:cursor-not-allowed text-white rounded-xl flex items-center gap-1.5 transition-all shadow-sm cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            Export Journal
          </button>
        </div>

      {/* CHARTS & FILTERS GRID */}
      {auditLogs.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Filters Card */}
          <div className={`lg:col-span-4 rounded-2xl border p-5 space-y-4 ${
            theme === "dark" ? "bg-[#14161a]/95 border-stone-800/80" : "bg-white border-stone-200/80 shadow-xs"
          }`}>
            <div className="flex items-center gap-2 pb-2.5 border-b border-stone-200 dark:border-stone-850">
              <Filter className="w-4 h-4 text-[#117FDA] dark:text-sky-400" />
              <h3 className={`text-xs font-black uppercase tracking-wider ${theme === 'dark' ? 'text-white' : 'text-[#111827]'}`}>
                Filter Logs
              </h3>
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
              <select
                value={auditPlanFilter}
                onChange={(e) => setAuditPlanFilter(e.target.value)}
                className={`w-full text-xs px-3 py-2 rounded-xl border outline-none font-semibold cursor-pointer ${
                  theme === 'dark'
                    ? 'bg-[#060a12] border-stone-800 text-white'
                    : 'bg-white border-stone-200 text-stone-900'
                }`}
              >
                <option value="All">All Plans</option>
                <option value="Optima Secure">Optima Secure</option>
                <option value="Care Supreme">Care Supreme</option>
                <option value="Activ One Max">Activ One Max</option>
                <option value="Activ Fit Preferred">Activ Fit Preferred</option>
              </select>
            </div>

            {/* Match Type Filter */}
            <div className="space-y-1.5">
              <label className="text-[10px] font-black uppercase tracking-wider text-stone-450 block font-mono">
                Match Type Category
              </label>
              <select
                value={auditTypeFilter}
                onChange={(e) => setAuditTypeFilter(e.target.value)}
                className={`w-full text-xs px-3 py-2 rounded-xl border outline-none font-semibold cursor-pointer ${
                  theme === 'dark'
                    ? 'bg-[#060a12] border-stone-800 text-white'
                    : 'bg-white border-stone-200 text-stone-900'
                }`}
              >
                <option value="All">All</option>
                <option value="System Rule">System Rule</option>
                <option value="AI Fallback">AI Fallback</option>
              </select>
            </div>

            {/* Date filter inputs */}
            <div className="grid grid-cols-2 gap-2 pt-1">
              <div className="space-y-1.5">
                <label className="text-[10px] font-black uppercase tracking-wider text-stone-500 dark:text-stone-300 block font-mono flex items-center gap-1">
                  <Calendar className="w-3 h-3 text-cyan-500 dark:text-cyan-400" />
                  Start Date
                </label>
                <input
                  type="date"
                  value={auditStartDate}
                  onChange={(e) => setAuditStartDate(e.target.value)}
                  onClick={(e) => {
                    try {
                      e.currentTarget.showPicker();
                    } catch (_) {}
                  }}
                  className={`w-full text-xs px-2 py-2 rounded-xl border outline-none font-semibold cursor-pointer ${
                    theme === 'dark'
                      ? 'bg-[#060a12] border-stone-800 text-white focus:border-[#117FDA]'
                      : 'bg-white border-stone-200 text-stone-900 focus:border-[#117FDA]'
                  }`}
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] font-black uppercase tracking-wider text-stone-500 dark:text-stone-300 block font-mono flex items-center gap-1">
                  <Calendar className="w-3 h-3 text-cyan-500 dark:text-cyan-400" />
                  End Date
                </label>
                <input
                  type="date"
                  value={auditEndDate}
                  onChange={(e) => setAuditEndDate(e.target.value)}
                  onClick={(e) => {
                    try {
                      e.currentTarget.showPicker();
                    } catch (_) {}
                  }}
                  className={`w-full text-xs px-2 py-2 rounded-xl border outline-none font-semibold cursor-pointer ${
                    theme === 'dark'
                      ? 'bg-[#060a12] border-stone-800 text-white focus:border-[#117FDA]'
                      : 'bg-white border-stone-200 text-stone-900 focus:border-[#117FDA]'
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

          {/* Distribution Chart Card */}
          <div className={`lg:col-span-8 rounded-2xl border p-5 flex flex-col justify-between ${
            theme === "dark" ? "bg-[#14161a]/95 border-stone-800/80" : "bg-white border-stone-200/80 shadow-xs"
          }`}>
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
                Filtered Entries: {filteredAuditLogs.length}
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
        theme === "dark" ? "bg-[#14161a] border-stone-800" : "bg-white border-stone-200 shadow-sm"
      }`}>
        <div className="overflow-x-auto max-h-[600px]">
          {auditLogs.length === 0 ? (
            <div className="p-16 text-center flex flex-col items-center justify-center font-sans">
              <Activity className="w-10 h-10 text-[#117FDA] dark:text-sky-400 mb-3 stroke-1 animate-pulse" />
              <p className={`text-xs font-black uppercase tracking-wider ${theme === 'dark' ? 'text-stone-300' : 'text-[#111827]'}`}>Audit trail ledger is empty.</p>
              <p className={`text-[11px] mt-1.5 font-semibold ${theme === 'dark' ? 'text-stone-450' : 'text-stone-605'}`}>Matched lookup declarations are kept recorded here dynamically.</p>
            </div>
          ) : filteredAuditLogs.length === 0 ? (
            <div className="p-16 text-center flex flex-col items-center justify-center font-sans">
              <Search className="w-10 h-10 text-amber-500 mb-3 stroke-1 animate-pulse" />
              <p className={`text-xs font-black uppercase tracking-wider ${theme === 'dark' ? 'text-stone-300' : 'text-[#111827]'}`}>No matching audit trail logs.</p>
              <p className={`text-[11px] mt-1.5 font-semibold ${theme === 'dark' ? 'text-stone-450' : 'text-stone-605'}`}>Try adjusting or clearing your active filter options to view historical matches.</p>
            </div>
          ) : (
            <table className="w-full text-left border-collapse text-xs">
              <thead className={`text-[11px] font-extrabold uppercase tracking-wider sticky top-0 z-20 border-b ${
                theme === "dark"
                  ? "bg-[#14161a] text-stone-300 border-stone-800"
                  : "bg-stone-50 text-[#111827] border-stone-300"
              }`}>
                <tr>
                  <th className="py-3.5 px-5 w-14 text-center bg-inherit">No.</th>
                  <th className="py-3.5 px-5 bg-inherit">Adviser</th>
                  <th className="py-3.5 px-5 bg-inherit">Date & Time</th>
                  <th className="py-3.5 px-5 bg-inherit">Plan Name</th>
                  <th className="py-3.5 px-5 bg-inherit">Medical Condition</th>
                  <th className="py-3.5 px-5 bg-inherit">Mapping Status</th>
                  <th className="py-3.5 px-5 bg-inherit">Matched Question</th>
                  <th className="py-3.5 px-5 bg-inherit">Source</th>
                </tr>
              </thead>
              <tbody className={`divide-y font-semibold ${
                theme === "dark" ? "divide-stone-800 text-stone-300" : "divide-stone-200 text-stone-900"
              }`}>
                {filteredAuditLogs.map((log, index) => (
                  <tr key={index} className="hover:bg-stone-550/5 transition-colors">
                    <td className="py-3 px-5 text-center font-mono text-[10px] opacity-60">{index + 1}</td>
                    <td className={`py-3 px-5 font-bold text-[11px] flex items-center gap-1.5 ${
                      theme === "dark" ? "text-[#1cbbf2]" : "text-[#111827]"
                    }`}>
                      <User className={`w-3.5 h-3.5 ${theme === "dark" ? "text-stone-500" : "text-stone-600"}`} />
                      <span className="truncate max-w-32">{log.userEmail.split("@")[0]}</span>
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
                    <td className="py-3 px-5 font-mono">
                      <span className="text-[#117FDA] bg-[#117FDA]/5 dark:bg-[#117FDA]/10 px-2 py-0.5 rounded font-extrabold whitespace-nowrap">
                        {log.pedInput}
                      </span>
                    </td>
                    <td className="py-3 px-5">
                      <span className={`px-2.5 py-1 rounded-lg text-[10px] font-black uppercase border whitespace-nowrap ${
                        log.matchType === "P1" || log.matchType === "P0" || log.matchType === "EXACT" || log.matchType === "LIVE_MATCH" || log.matchType === "LIVE MATCH"
                          ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30 font-sans"
                          : log.matchType === "ESCALATE"
                            ? "bg-amber-500/15 text-amber-400 border-amber-500/30 font-sans"
                            : "bg-blue-500/15 text-sky-400 border-blue-500/30 font-sans"
                      }`}>
                        {translateMatchTypeToLayman(log.matchType)}
                      </span>
                    </td>
                    <td className={`py-3 px-5 max-w-xs truncate font-bold ${
                      theme === "dark" ? "text-stone-200" : "text-[#111827]"
                    }`} title={log.matchedQuestion}>
                      {log.matchedQuestion}
                    </td>
                    <td className="py-3 px-5 text-[10px] font-sans font-bold text-sky-455 pr-4 whitespace-nowrap">
                      {translateSourceToLayman(log.source)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
      </>
      )}

      {/* MODIFICATION HISTORY SUB-PAGE VIEW */}
      {auditSubTab === "modification" && (
        <div className="space-y-4">

          {/* Control Bar: Filters, Search, CSV Exporter */}
          <div className={`rounded-xl border p-4 flex flex-col md:flex-row justify-between items-start md:items-center gap-4 ${
            theme === 'dark' ? 'bg-[#14161a] border-stone-800' : 'bg-white border-stone-200 shadow-sm'
          }`}>
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 w-full md:w-auto">
              {/* Search Log Input */}
              <div className="relative">
                <Search className="w-4 h-4 text-stone-500 absolute left-3.5 top-3 select-none" />
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
              <select
                id="filter-change-type-select"
                value={historyActionFilter}
                onChange={(e) => setHistoryActionFilter(e.target.value)}
                className={`px-3.5 py-2 rounded-xl text-xs font-bold focus:ring-0 focus:border-[#117FDA] border cursor-pointer ${
                  theme === 'dark'
                    ? 'bg-stone-950 border-stone-850 text-stone-300'
                    : 'bg-white border-stone-200 text-stone-800'
                }`}
              >
                <option value="All">All Actions</option>
                <option value="Draft Created">Draft Created</option>
                <option value="Insurer Edited">Insurer Edited</option>
                <option value="Draft Approved">Draft Approved</option>
                <option value="Draft Rejected">Draft Rejected</option>
                <option value="New Draft Mock Verified">Verified Runs</option>
                <option value="Change Restored">Restored Actions</option>
              </select>
            </div>

            {/* Dynamic CSV Downloader button */}
            <button
              id="export-csv-button"
              onClick={() => {
                const filteredLogs = filteredChangeLogs;

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
                  "Specific Waiting Period Count"
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
                  log.snapshot?.specificIllnesses ? `${Object.keys(log.snapshot.specificIllnesses).length} schedules` : "Default schedules"
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
              }}
              className="w-full md:w-auto px-4 py-2 border border-blue-500/40 text-blue-400 bg-blue-500/5 hover:bg-blue-500/10 hover:border-blue-500 hover:text-blue-300 rounded-xl text-xs font-black uppercase tracking-wider transition-all flex items-center justify-center gap-2 cursor-pointer shadow-md select-none"
            >
              <Download className="w-4 h-4" /> Export CSV Spreadsheet
            </button>
          </div>

          {/* Audit Logs Table Ledger layout */}
          <div className={`rounded-2xl border overflow-hidden ${
            theme === "dark" ? "bg-[#14161a] border-stone-800" : "bg-white border-stone-200 shadow-sm"
          }`}>
            <div className="overflow-x-auto max-h-[600px]">
              <table id="change-history-table" className="w-full text-left border-collapse text-xs">
                <thead className={`text-[11px] font-extrabold uppercase tracking-wider sticky top-0 z-20 border-b ${
                  theme === "dark"
                    ? "bg-[#14161a] text-stone-300 border-stone-800"
                    : "bg-stone-50 text-[#111827] border-stone-200"
                }`}>
                  <tr>
                    <th className="py-3.5 px-5">Timestamp</th>
                    <th className="py-3.5 px-5">User</th>
                    <th className="py-3.5 px-5">Role</th>
                    <th className="py-3.5 px-5">Action Event</th>
                    <th className="py-3.5 px-5">Plan</th>
                    <th className="py-3.5 px-5">Description Record</th>
                  </tr>
                </thead>
                <tbody className={`divide-y font-semibold ${
                  theme === "dark" ? "divide-stone-800 text-stone-300" : "divide-stone-200 text-stone-900"
                }`}>
                  {filteredChangeLogs.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="p-16 text-center text-stone-500 font-bold font-sans">
                        No auditable records found matching query filter.
                      </td>
                    </tr>
                  ) : (
                    filteredChangeLogs.map((log) => {
                      const isPromotedVal = log.actionType === "Draft Approved";
                      const isRejectedVal = log.actionType === "Draft Rejected";
                      const isCreatedVal = log.actionType === "Draft Created" || log.actionType === "New Draft Mock Verified";
                      const isRestoredVal = log.actionType === "Change Restored";

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
                              log.role === "Owner"
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
                              isPromotedVal
                                ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                                : isRejectedVal
                                ? "bg-rose-500/10 text-rose-450 border border-rose-500/20"
                                : isCreatedVal
                                ? "bg-violet-500/10 text-violet-400 border border-violet-500/20"
                                : isRestoredVal
                                ? "bg-cyan-500/10 text-cyan-400 border border-cyan-500/25"
                                : "bg-blue-500/10 text-blue-400 border border-blue-500/20"
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
        </div>
      )}
    </div>
  );
}
