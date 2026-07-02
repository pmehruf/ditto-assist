/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from "react";
import { Search, Clock, History, ChevronDown } from "lucide-react";
import { PLANS } from "../types";
import { AuditLogEntry } from "../types/announcements";
import { LoggedUser } from "../types/user";
import { parseGlobalLogTimestamp } from "../utils/timestamps";

interface MyActivityPageProps {
  auditLogs: AuditLogEntry[];
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
  auditLogs,
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
  const myLogs = auditLogs.filter(log => log.userEmail === (currentUser?.email || "advisor@joinditto.in"));

  const filteredMyLogs = myLogs.filter(log => {
    const matchesSearch = !myActivitySearch.trim() ||
      (log.pedInput || "").toLowerCase().includes(myActivitySearch.toLowerCase()) ||
      (log.matchedQuestion || "").toLowerCase().includes(myActivitySearch.toLowerCase()) ||
      (log.explanation || "").toLowerCase().includes(myActivitySearch.toLowerCase());

    const matchesPlan = myActivityPlanFilter === "All" || log.planName === myActivityPlanFilter;

    let matchesDate = true;
    const logDate = parseGlobalLogTimestamp(log.timestamp);
    if (logDate) {
      const logTime = logDate.getTime();
      if (myActivityStartDate) {
        const startDateObj = new Date(myActivityStartDate);
        startDateObj.setHours(0, 0, 0, 0);
        if (logTime < startDateObj.getTime()) {
          matchesDate = false;
        }
      }
      if (myActivityEndDate) {
        const endDateObj = new Date(myActivityEndDate);
        endDateObj.setHours(23, 59, 59, 999);
        if (logTime > endDateObj.getTime()) {
          matchesDate = false;
        }
      }
    }

    return matchesSearch && matchesPlan && matchesDate;
  });

  return (
    <div className="space-y-6 animate-fade-in">
      {/* PAGE-LEVEL HEADER */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 pb-4 border-b border-stone-200 dark:border-stone-800">
        <div>
          <h1 className="text-xl md:text-2xl font-black tracking-tight flex items-center gap-2">
            <div className="w-8 h-0.5 flex-shrink-0" style={{ backgroundColor: theme === "dark" ? "#00D3F3" : "#4673a9" }} />
            <span className={`bg-gradient-to-r ${
              theme === "dark"
                ? "from-cyan-400 via-sky-450 to-teal-400"
                : "from-cyan-605 via-sky-505 to-indigo-600"
            } bg-clip-text text-transparent`}>
              My Activity Journal
            </span>
          </h1>
          <p className={`text-xs mt-1.5 font-semibold ${
            theme === "dark" ? "text-stone-400" : "text-stone-600"
          }`}>
            Analyze and search your history of medical declaration lookups and underwriting decisions.
          </p>
        </div>
      </div>

      {/* QUICK STATS CARDS */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div
          style={{ backgroundColor: "#13487a" }}
          className={`p-4 rounded-xl border ${
            theme === "dark" ? "border-[#252A34]" : "border-stone-200 shadow-xs"
          }`}
        >
          <p style={{ color: "#dcedf8" }} className="text-[10px] font-bold uppercase tracking-wider">Total Lookups</p>
          <p style={{ color: "#00caff" }} className="text-xl font-black mt-1">{myLogs.length}</p>
        </div>
        <div
          style={{ backgroundColor: "#13487a" }}
          className={`p-4 rounded-xl border ${
            theme === "dark" ? "border-[#252A34]" : "border-stone-200 shadow-xs"
          }`}
        >
          <p style={{ color: "#dcedf8" }} className="text-[10px] font-bold uppercase tracking-wider">Filtered Matches</p>
          <p style={{ color: "#00caff" }} className="text-xl font-black mt-1">{filteredMyLogs.length}</p>
        </div>
        <div
          style={{ backgroundColor: "#13487a" }}
          className={`p-4 rounded-xl border ${
            theme === "dark" ? "border-[#252A34]" : "border-stone-200 shadow-xs"
          }`}
        >
          <p style={{ color: "#dcedf8" }} className="text-[10px] font-bold uppercase tracking-wider">Advisor Profile</p>
          <p style={{ color: "#00caff" }} className={`text-xs font-bold mt-2 truncate`}>
            {currentUser?.email || "advisor@joinditto.in"}
          </p>
        </div>
      </div>

      {/* SEARCH AND FILTERS */}
      <div
        style={{ backgroundColor: "#50697e" }}
        className={`p-4 rounded-xl border flex flex-col md:flex-row gap-4 items-center justify-between ${
          theme === "dark" ? "border-[#252A34]" : "border-stone-200 shadow-sm"
        }`}
      >
        {/* Live Filter Search Input */}
        <div className="relative w-full md:w-80 shrink-0">
          <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-stone-400 pointer-events-none" />
          <input
            type="text"
            placeholder="Search your search logs..."
            value={myActivitySearch}
            onChange={(e) => setMyActivitySearch(e.target.value)}
            className={`w-full py-2 pl-10 pr-4 text-xs font-semibold rounded-lg border outline-none transition-all ${
              theme === "dark"
                ? "bg-[#060A10] border-[#252A34] text-white focus:border-[#3B82F6]"
                : "bg-white border-stone-250 text-stone-900 focus:border-[#3B82F6] focus:ring-1 focus:ring-[#3B82F6]/50 shadow-inner"
            }`}
          />
          {myActivitySearch && (
            <button
              onClick={() => setMyActivitySearch("")}
              className="absolute right-3.5 top-1/2 -translate-y-1/2 text-xs font-bold text-stone-400 hover:text-stone-100"
              title="Clear search"
            >
              &times;
            </button>
          )}
        </div>

        {/* Filter Dropdowns container */}
        <div style={{ color: "#de7c44" }} className="w-full flex flex-col sm:flex-row gap-3 items-center md:justify-end">
          {/* Plan Filter */}
          <div className="flex items-center gap-2">
            <span style={{ color: "#dcedf8" }} className="text-[10px] font-bold uppercase tracking-wider">Plan:</span>
            <select
              value={myActivityPlanFilter}
              onChange={(e) => setMyActivityPlanFilter(e.target.value)}
              className={`text-xs font-bold p-1.5 rounded-lg border outline-none cursor-pointer ${
                theme === "dark"
                  ? "bg-[#060A10] border-[#252A34] text-white focus:border-[#3B82F6]"
                  : "bg-white border-stone-250 text-stone-850 shadow-xs"
              }`}
            >
              <option value="All">All Plans</option>
              {PLANS.map(p => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </div>

          {/* Date Range Filter */}
          <div className="flex flex-col sm:flex-row gap-2.5 items-start sm:items-center">
            <div className="flex items-center gap-1.5">
              <span style={{ color: "#dcedf8" }} className="text-[10px] font-bold uppercase tracking-wider">From:</span>
              <div className="relative">
                <input
                  type="date"
                  value={myActivityStartDate || ""}
                  onChange={(e) => setMyActivityStartDate(e.target.value)}
                  onClick={(e) => {
                    try {
                      e.currentTarget.showPicker();
                    } catch (_) {}
                  }}
                  className="absolute inset-0 opacity-0 cursor-pointer w-full h-full z-10"
                />
                <div
                  className={`text-xs font-mono font-bold py-1 px-2.5 rounded-lg border flex items-center gap-1.5 select-none min-w-[115px] justify-between ${
                    theme === "dark"
                      ? "bg-[#14181D] border-[#252A34] text-white"
                      : "bg-white border-stone-250 text-stone-850 shadow-xs"
                  }`}
                >
                  <span>{myActivityStartDate ? (() => {
                    const parts = myActivityStartDate.split("-");
                    if (parts.length === 3) return `${parts[2]}-${parts[1]}-${parts[0]}`;
                    return myActivityStartDate;
                  })() : "dd-mm-yyyy"}</span>
                  <Clock className="w-3 h-3 text-stone-400 shrink-0" />
                </div>
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              <span style={{ color: "#dcedf8" }} className="text-[10px] font-bold uppercase tracking-wider">To:</span>
              <div className="relative">
                <input
                  type="date"
                  value={myActivityEndDate || ""}
                  onChange={(e) => setMyActivityEndDate(e.target.value)}
                  onClick={(e) => {
                    try {
                      e.currentTarget.showPicker();
                    } catch (_) {}
                  }}
                  className="absolute inset-0 opacity-0 cursor-pointer w-full h-full z-10"
                />
                <div
                  className={`text-xs font-mono font-bold py-1 px-2.5 rounded-lg border flex items-center gap-1.5 select-none min-w-[115px] justify-between ${
                    theme === "dark"
                      ? "bg-[#14181D] border-[#252A34] text-white"
                      : "bg-white border-stone-250 text-stone-850 shadow-xs"
                  }`}
                >
                  <span>{myActivityEndDate ? (() => {
                    const parts = myActivityEndDate.split("-");
                    if (parts.length === 3) return `${parts[2]}-${parts[1]}-${parts[0]}`;
                    return myActivityEndDate;
                  })() : "dd-mm-yyyy"}</span>
                  <Clock className="w-3 h-3 text-stone-400 shrink-0" />
                </div>
              </div>
            </div>
            {(myActivityStartDate || myActivityEndDate) && (
              <button
                onClick={() => {
                  setMyActivityStartDate("");
                  setMyActivityEndDate("");
                }}
                className={`text-[10px] font-bold px-2 py-1 rounded-lg cursor-pointer ${
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
      </div>

      {/* ACTIVITIES TABLE / ACCORDION */}
      <div className={`rounded-xl border overflow-hidden ${
        theme === "dark" ? "bg-[#12151A] border-[#252A34]" : "bg-white border-stone-200 shadow-sm"
      }`}>
        {filteredMyLogs.length === 0 ? (
          <div className="p-16 text-center font-sans">
            <History className="w-10 h-10 text-stone-400 mx-auto mb-3 stroke-1 animate-pulse" />
            <p className={`text-sm font-bold ${theme === "dark" ? "text-white" : "text-stone-850"}`}>
              No activity history found
            </p>
            <p className="text-xs text-stone-500 mt-1">
              {myLogs.length === 0
                ? "Initiate a medical term lookup in the Declaration Assistant page to populate this history."
                : "Try relaxing your search terms or filters to reveal matching logs."}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead className={`text-[10px] font-bold uppercase tracking-wider border-b ${
                theme === "dark"
                  ? "bg-[#171B22] text-[#9CA3AF] border-[#252A34]"
                  : "bg-stone-100 text-stone-600 border-stone-200"
              }`}>
                <tr>
                  <th style={{ backgroundColor: "#106671", color: "#d0e3ed" }} className="py-3.5 px-4">Medical Term / PED Query</th>
                  <th style={{ backgroundColor: "#106671", color: "#d0e3ed" }} className="py-3.5 px-4">Time</th>
                  <th style={{ backgroundColor: "#106671", color: "#d0e3ed" }} className="py-3.5 px-4">Insurance Plan</th>
                  <th style={{ backgroundColor: "#106671", color: "#d0e3ed" }} className="py-3.5 px-4">Match Outcome</th>
                  <th style={{ backgroundColor: "#106671", color: "#d0e3ed" }} className="py-3.5 px-4 text-right">Action</th>
                </tr>
              </thead>
              <tbody className={`divide-y text-xs font-semibold ${
                theme === "dark" ? "divide-[#252A34] text-stone-200" : "divide-stone-200 text-stone-800"
              }`}>
                {filteredMyLogs.map((log, idx) => {
                  const isExpanded = expandedLogIndex === log.timestamp;

                  // Visual status for map Types
                  const matchColors: Record<string, string> = {
                    perfect: theme === "dark"
                      ? "bg-green-500/10 text-green-400 border border-green-500/10"
                      : "bg-green-50 text-green-750 border border-green-200/50",
                    approx: theme === "dark"
                      ? "bg-amber-500/10 text-amber-400 border border-amber-500/10"
                      : "bg-amber-50 text-amber-750 border border-amber-200/50",
                    "not matched": theme === "dark"
                      ? "bg-red-500/10 text-red-400 border border-red-500/10"
                      : "bg-red-50 text-red-750 border border-red-200/50"
                  };
                  const matchLabel: Record<string, string> = {
                    perfect: "Perfect Match",
                    approx: "Approx Match",
                    "not matched": "No Direct Match"
                  };

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
                          style={idx === 0 ? { backgroundColor: "#b3dae0", color: "#151e25" } : idx < 6 ? { backgroundColor: "#b3dae0" } : undefined}
                          className="py-4 px-4 font-bold text-[12px] max-w-xs truncate"
                        >
                          <div className="flex items-center gap-2">
                            <ChevronDown
                              style={idx < 5 ? { color: "#106671" } : undefined}
                              className={`w-4 h-4 text-stone-400 shrink-0 transition-transform duration-200 ${
                                isExpanded ? "rotate-180" : ""
                              }`}
                            />
                            <span className="truncate">{log.pedInput}</span>
                          </div>
                        </td>
                        <td
                          style={idx < 6 ? { backgroundColor: "#b3dae0" } : undefined}
                          className="py-4 px-4 font-mono text-[10.5px] opacity-75"
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
                          style={idx < 6 ? { backgroundColor: "#b3dae0" } : undefined}
                          className="py-4 px-4 font-extrabold text-[11px] text-sky-500"
                        >
                          {log.planName}
                        </td>
                        <td
                          style={idx < 6 ? { backgroundColor: "#b3dae0" } : undefined}
                          className="py-4 px-4"
                        >
                          <span
                            style={idx < 5 ? { backgroundColor: "#94b06c", color: "#000000", borderColor: "#106671" } : undefined}
                            className={`px-2 py-0.5 rounded text-[9.5px] font-bold uppercase tracking-wider ${
                              matchColors[log.matchType] || matchColors.approx
                            }`}
                          >
                            {matchLabel[log.matchType] || log.matchType}
                          </span>
                        </td>
                        <td
                          style={idx < 6 ? { backgroundColor: "#b3dae0" } : undefined}
                          className="py-4 px-4 text-right"
                        >
                          <button
                            className={`text-[10px] font-bold px-2 py-1 rounded transition-all cursor-pointer ${
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
                          <td colSpan={5} className={`p-5 font-sans whitespace-pre-wrap ${
                            theme === "dark" ? "bg-stone-900/30" : "bg-stone-50/40"
                          }`}>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-5 text-xs text-left leading-relaxed">

                              {/* Left details pane */}
                              <div className="space-y-3.5">
                                <div>
                                  <p className="font-extrabold text-[9.5px] uppercase tracking-wider text-stone-400 mb-1">
                                    Tested Medical Term
                                  </p>
                                  <p className={`text-sm font-bold ${
                                    theme === "dark" ? "text-white" : "text-stone-900"
                                  }`}>
                                    {log.pedInput}
                                  </p>
                                </div>

                                <div>
                                  <p className="font-extrabold text-[9.5px] uppercase tracking-wider text-stone-500 mb-1">
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
                                  <p className="font-extrabold text-[9.5px] uppercase tracking-wider text-stone-500 mb-1">
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

                                <div className="flex select-none flex-wrap gap-4 pt-1 font-mono text-[10px] text-stone-400">
                                  <div>
                                    <span className="font-bold uppercase tracking-wider">Engine: </span>
                                    <span className="font-semibold text-stone-550">{log.source || "Deterministic Engine"}</span>
                                  </div>
                                  <div>
                                    <span className="font-bold uppercase tracking-wider">Consulted By: </span>
                                    <span className="font-semibold text-stone-550">{log.userEmail}</span>
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
    </div>
  );
}
