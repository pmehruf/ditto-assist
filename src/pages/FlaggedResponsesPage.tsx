/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useMemo } from "react";
import type { Dispatch, SetStateAction } from "react";
import { Flag, CheckCircle2, Check, Trash2 } from "lucide-react";
import { ReportedIssue } from "../types/announcements";
import { GridTexture } from "../components/GridTexture";

interface FlaggedResponsesPageProps {
  theme: "light" | "dark";
  reportedIssues: ReportedIssue[];
  setReportedIssues: Dispatch<SetStateAction<ReportedIssue[]>>;
  reportedIssuesFilter: string;
  setReportedIssuesFilter: (value: string) => void;
  ownerResolutionNotes: Record<string, string>;
  setOwnerResolutionNotes: Dispatch<SetStateAction<Record<string, string>>>;
  effectiveTier: "General" | "Admin" | "Owner";
  requestOwnerPasscode: (actionDescription: string, onSuccess: () => void) => void;
}

/**
 * "Flagged Responses" tab content — table view (Phase: Flag button revamp).
 * The `activeTab === "flagged_responses"` condition and wrapping
 * `<motion.div key="flagged_responses">` deliberately stay in App.tsx (see
 * ResourcesPage.tsx for why).
 */
export function FlaggedResponsesPage({
  theme,
  reportedIssues,
  setReportedIssues,
  reportedIssuesFilter,
  setReportedIssuesFilter,
  ownerResolutionNotes,
  setOwnerResolutionNotes,
  effectiveTier,
  requestOwnerPasscode,
}: FlaggedResponsesPageProps) {
  const dark = theme === "dark";

  const filteredIssues = useMemo(() => {
    return reportedIssues.filter(issue => {
      if (reportedIssuesFilter === "All Open") {
        return issue.status === "Pending" || issue.status === "Urgent";
      }
      if (reportedIssuesFilter === "Urgent") {
        return issue.status === "Urgent";
      }
      if (reportedIssuesFilter === "Pending") {
        return issue.status === "Pending";
      }
      if (reportedIssuesFilter === "Resolved") {
        return issue.status === "Resolved";
      }
      if (reportedIssuesFilter === "Ignored") {
        return issue.status === "Ignored";
      }
      return true; // "All"
    });
  }, [reportedIssues, reportedIssuesFilter]);

  const thClass = `px-3 py-2.5 text-left text-[9.5px] font-black uppercase tracking-wider whitespace-nowrap ${
    dark ? "text-stone-400" : "text-stone-500"
  }`;
  const tdClass = "px-3 py-2.5 align-top text-xs";

  return (
    <div className="space-y-6 text-left">
      {/* Header Box */}
      <div className={`relative overflow-hidden p-6 rounded-2xl border transition-all ${
        dark ? "bg-[#091520]/80 border-white/[0.08]" : "bg-white border-stone-200 shadow-sm"
      }`}>
        <GridTexture theme={theme} />
        <div className="relative z-10 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div className="space-y-1">
            <h2 className={`text-xl font-extrabold tracking-tight font-sans flex items-center gap-2.5 ${dark ? "text-white" : "text-stone-900"}`}>
              <Flag className="w-5 h-5 text-red-500 shrink-0" />
              Flagged Responses
            </h2>
            <p className={`text-xs font-medium font-sans ${dark ? "text-stone-400" : "text-stone-500"}`}>
              Review and resolve advisor-flagged policy mapping discrepancies, medical code differences, and underwriting exceptions.
            </p>
          </div>
          <div className={`text-xs font-black uppercase tracking-wider px-3 py-1.5 rounded-xl font-mono ${
            dark ? 'text-red-400 bg-red-950/20' : 'text-red-700 bg-red-50 border border-red-200'
          }`}>
            Unresolved: {reportedIssues.filter(issue => issue.status === "Pending" || issue.status === "Urgent").length}
          </div>
        </div>
      </div>

      {/* SECTION: REPORTED MISMATCH CHALLENGES */}
      <div className={`rounded-2xl border p-5 transition-all ${
        dark ? "bg-[#0b1328]/90 border-white/[0.04]" : "bg-white border-stone-200 shadow-xs"
      }`}>
        <div className="space-y-4">
          {/* Filter Pills with numbers */}
          <div className="flex flex-wrap items-center gap-1.5">
            {[
              { key: "All Open", label: "Open Issues" },
              { key: "Urgent", label: "Urgent" },
              { key: "Pending", label: "Under Review" },
              { key: "Resolved", label: "Resolved" },
              { key: "Ignored", label: "Ignored" },
              { key: "All", label: "Show All" }
            ].map((btn) => {
              const count = reportedIssues.filter(issue => {
                if (btn.key === "All Open") return issue.status === "Pending" || issue.status === "Urgent";
                if (btn.key === "All") return true;
                return issue.status === btn.key;
              }).length;

              const isSelected = reportedIssuesFilter === btn.key;
              return (
                <button
                  key={btn.key}
                  onClick={() => {
                    setReportedIssuesFilter(btn.key);
                  }}
                  className={`px-3 py-1.5 text-[10px] font-black uppercase tracking-wider rounded-lg transition-all flex items-center gap-1.5 cursor-pointer select-none active:scale-95 ${
                    isSelected
                      ? "bg-red-500 text-white font-extrabold shadow-xs"
                      : dark
                        ? "bg-stone-500/5 hover:bg-stone-500/10 text-stone-400 font-bold border border-stone-850"
                        : "bg-stone-50 hover:bg-stone-100 text-stone-600 font-bold border border-stone-250"
                  }`}
                >
                  <span>{btn.label}</span>
                  <span className={`px-1.5 py-0.2 rounded font-mono text-[9px] ${
                    isSelected ? "bg-white/20 text-white" : "bg-stone-500/15 text-stone-300"
                  }`}>
                    {count}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Table container */}
          {filteredIssues.length === 0 ? (
            <div className="py-20 text-center rounded-xl border border-dashed border-stone-200 dark:border-stone-850 flex flex-col items-center justify-center font-sans">
              <CheckCircle2 className="w-10 h-10 text-emerald-400 mb-3 animate-bounce" />
              <p className={`text-[12px] font-black uppercase tracking-wider ${dark ? 'text-stone-300' : 'text-[#111827]'}`}>
                No flagged responses found.
              </p>
              <p className="text-xs text-stone-500 dark:text-stone-400 font-semibold mt-1 max-w-md mx-auto">
                Adviser feedback aligns perfectly with the standard underwriting question matrix. There are no pending mismatch reports for the selected filter.
              </p>
            </div>
          ) : (
            <div className={`rounded-xl border overflow-x-auto ${dark ? "border-stone-850" : "border-stone-200"}`}>
              <table className="w-full border-collapse min-w-[950px]">
                <thead>
                  <tr className={`border-b ${dark ? "bg-[#060a12] border-stone-850" : "bg-stone-50 border-stone-200"}`}>
                    <th className={thClass}>Flagged By</th>
                    <th className={thClass}>Plan</th>
                    <th className={thClass}>Timestamp</th>
                    <th className={thClass}>PED</th>
                    <th className={thClass}>Matched Question</th>
                    <th className={thClass}>Category</th>
                    <th className={thClass}>Comment</th>
                    <th className={`${thClass} text-right`}>Status / Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredIssues.map((issue, idx) => {
                    const isOpen = issue.status !== "Resolved" && issue.status !== "Ignored";
                    return (
                      <tr
                        key={issue.id}
                        className={`border-b last:border-b-0 align-top ${
                          dark ? "border-stone-850" : "border-stone-150"
                        } ${
                          issue.status === "Urgent"
                            ? dark ? "bg-red-950/10" : "bg-red-500/5"
                            : issue.status === "Resolved"
                              ? dark ? "bg-emerald-950/10" : "bg-emerald-500/5"
                              : idx % 2 === 1
                                ? dark ? "bg-white/[0.015]" : "bg-stone-50/60"
                                : ""
                        }`}
                      >
                        <td className={tdClass}>
                          <div className={`font-black ${dark ? "text-white" : "text-stone-900"}`}>{issue.userName}</div>
                          <div className="text-[10px] text-stone-400 font-mono truncate max-w-[160px]" title={issue.userEmail}>
                            {issue.userEmail}
                          </div>
                        </td>
                        <td className={`${tdClass} font-bold whitespace-nowrap`}>{issue.planName}</td>
                        <td className={`${tdClass} font-mono text-[10.5px] whitespace-nowrap ${dark ? "text-stone-400" : "text-stone-500"}`}>
                          {new Date(issue.timestamp).toLocaleDateString()}
                          <br />
                          {new Date(issue.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                        </td>
                        <td className={tdClass}>
                          <span className="font-mono text-[10px] bg-[#117FDA]/15 text-[#117FDA] dark:text-sky-300 px-1.5 py-0.5 rounded border border-[#117FDA]/25 whitespace-nowrap">
                            {issue.pedInput}
                          </span>
                        </td>
                        <td className={`${tdClass} max-w-[340px]`}>
                          <p className="italic font-semibold line-clamp-2" title={issue.matchedQuestion}>
                            "{issue.matchedQuestion}"
                          </p>
                        </td>
                        <td className={tdClass}>
                          <span className="px-2 py-0.5 rounded text-[10px] font-black uppercase border bg-red-500/10 text-red-400 border-red-500/25 whitespace-nowrap">
                            {issue.matchType}
                          </span>
                        </td>
                        <td className={`${tdClass} max-w-[360px]`}>
                          <p className={`font-semibold leading-relaxed line-clamp-3 ${dark ? "text-slate-100" : "text-stone-800"}`} title={issue.issueNotes}>
                            {issue.issueNotes}
                          </p>
                        </td>
                        <td className={`${tdClass} text-right min-w-[220px]`}>
                          {isOpen ? (
                            <div className="flex flex-col items-end gap-1.5">
                              <textarea
                                rows={1}
                                placeholder="Resolution notes..."
                                value={ownerResolutionNotes[issue.id] || ""}
                                onChange={(e) => setOwnerResolutionNotes(prev => ({ ...prev, [issue.id]: e.target.value }))}
                                className={`w-full text-[11px] px-2 py-1 rounded-lg border outline-none font-semibold text-left ${
                                  dark
                                    ? 'bg-[#060a12] border-stone-850 text-white focus:border-red-500'
                                    : 'bg-white border-stone-200 text-stone-900 focus:border-red-400'
                                }`}
                              />
                              <div className="flex flex-wrap items-center justify-end gap-1.5">
                                <button
                                  onClick={() => {
                                    const note = ownerResolutionNotes[issue.id] || "Resolved discrepancy feedback. System mapping aligned.";
                                    setReportedIssues(prev => prev.map(item => item.id === issue.id ? {
                                      ...item,
                                      status: "Resolved",
                                      ownerNotes: note,
                                      resolvedAt: new Date().toISOString()
                                    } : item));
                                  }}
                                  className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white text-[9.5px] font-extrabold uppercase tracking-widest rounded-lg flex items-center gap-1 cursor-pointer transition-all active:scale-95 select-none"
                                >
                                  <Check className="w-3 h-3 shrink-0 text-white" />
                                  Resolve
                                </button>
                                <button
                                  onClick={() => {
                                    const note = ownerResolutionNotes[issue.id] || "Marked as ignored/not a mismatch.";
                                    setReportedIssues(prev => prev.map(item => item.id === issue.id ? {
                                      ...item,
                                      status: "Ignored",
                                      ownerNotes: note
                                    } : item));
                                  }}
                                  className="px-2.5 py-1 bg-stone-700 hover:bg-stone-600 text-stone-50 text-[9.5px] font-extrabold uppercase tracking-widest rounded-lg cursor-pointer transition-all active:scale-95 select-none"
                                >
                                  Ignore
                                </button>
                                {effectiveTier === "Owner" && (
                                  <button
                                    onClick={() => {
                                      requestOwnerPasscode(`Delete mismatch report for "${issue.pedInput}" permanently`, () => {
                                        setReportedIssues(prev => prev.filter(item => item.id !== issue.id));
                                      });
                                    }}
                                    className="p-1 bg-transparent border border-stone-200 dark:border-stone-850 hover:border-red-500 hover:bg-red-500/15 text-stone-500 hover:text-red-400 rounded-lg cursor-pointer transition-colors"
                                    title="Delete Mismatch Report permanently"
                                  >
                                    <Trash2 className="w-3 h-3" />
                                  </button>
                                )}
                              </div>
                            </div>
                          ) : (
                            <div className="flex flex-col items-end gap-1">
                              <span className={`px-2 py-0.5 rounded text-[9.5px] font-black uppercase border ${
                                issue.status === "Resolved"
                                  ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30"
                                  : "bg-stone-500/15 text-stone-400 border-stone-500/30"
                              }`}>
                                {issue.status}
                              </span>
                              <p className={`text-[10.5px] font-semibold text-right max-w-[200px] line-clamp-2 ${dark ? "text-stone-305" : "text-stone-600"}`} title={issue.ownerNotes}>
                                {issue.ownerNotes}
                              </p>
                              {effectiveTier === "Owner" && (
                                <button
                                  onClick={() => {
                                    requestOwnerPasscode(`Delete mismatch record for "${issue.pedInput}" permanently`, () => {
                                      setReportedIssues(prev => prev.filter(item => item.id !== issue.id));
                                    });
                                  }}
                                  className="px-2 py-0.5 text-[9.5px] font-extrabold text-red-400 bg-red-500/10 hover:bg-red-500/20 rounded border border-red-500/20 cursor-pointer uppercase tracking-wide select-none active:scale-95"
                                >
                                  Delete
                                </button>
                              )}
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
