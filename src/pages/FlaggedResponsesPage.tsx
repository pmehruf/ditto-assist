/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useMemo } from "react";
import type { Dispatch, SetStateAction } from "react";
import { Flag, CheckCircle2, Check, Trash2 } from "lucide-react";
import { ReportedIssue } from "../types/announcements";
import { translateMatchTypeToLayman, translateSourceToLayman } from "../utils/labelTranslation";

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
 * "Flagged Responses" tab content. Extracted verbatim from App.tsx
 * (Phase 1.3), including the `filteredIssues` `useMemo` that used to live in
 * App() and was only ever consumed here. The `activeTab ===
 * "flagged_responses"` condition and wrapping `<motion.div
 * key="flagged_responses">` deliberately stay in App.tsx (see
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

  return (
    <div className="space-y-6 text-left">
      {/* Header Box */}
      <div className={`p-6 rounded-2xl border transition-all ${
        theme === "dark" ? "bg-[#091520]/80 border-white/[0.08]" : "bg-white border-stone-200 shadow-sm"
      }`}>
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div className="space-y-1">
            <h2 className={`text-xl font-extrabold tracking-tight font-sans flex items-center gap-2.5 ${theme === "dark" ? "text-white" : "text-stone-900"}`}>
              <Flag className="w-5 h-5 text-red-500 shrink-0" />
              Flagged Responses
            </h2>
            <p className={`text-xs font-medium font-sans ${theme === "dark" ? "text-stone-400" : "text-stone-500"}`}>
              Review and resolve advisor-flagged policy mapping discrepancies, medical code differences, and underwriting exceptions.
            </p>
          </div>
          <div className={`text-xs font-black uppercase tracking-wider px-3 py-1.5 rounded-xl font-mono ${
            theme === 'dark' ? 'text-red-400 bg-red-950/20' : 'text-red-700 bg-red-50 border border-red-200'
          }`}>
            Unresolved: {reportedIssues.filter(issue => issue.status === "Pending" || issue.status === "Urgent").length}
          </div>
        </div>
      </div>

      {/* SECTION: REPORTED MISMATCH CHALLENGES */}
      <div className={`rounded-2xl border p-5 transition-all ${
        theme === "dark" ? "bg-[#0b1328]/90 border-white/[0.04]" : "bg-white border-stone-200 shadow-xs"
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
                      : theme === 'dark'
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

          {/* List container */}
          {filteredIssues.length === 0 ? (
            <div className="py-20 text-center rounded-xl border border-dashed border-stone-200 dark:border-stone-850 flex flex-col items-center justify-center font-sans">
              <CheckCircle2 className="w-10 h-10 text-emerald-400 mb-3 animate-bounce" />
              <p className={`text-[12px] font-black uppercase tracking-wider ${theme === 'dark' ? 'text-stone-300' : 'text-[#111827]'}`}>
                No flagged responses found.
              </p>
              <p className="text-xs text-stone-500 dark:text-stone-400 font-semibold mt-1 max-w-md mx-auto">
                Adviser feedback aligns perfectly with the standard underwriting question matrix. There are no pending mismatch reports for the selected filter.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 font-sans">
              {filteredIssues.map((issue) => {
                return (
                  <div
                    key={issue.id}
                    className={`p-4 rounded-xl border transition-all text-left space-y-3.5 relative overflow-hidden ${
                      issue.status === "Urgent"
                        ? theme === "dark" ? "bg-red-950/10 border-red-500/30 text-stone-200" : "bg-red-500/5 border-red-105 text-stone-900"
                        : issue.status === "Resolved"
                          ? theme === "dark" ? "bg-emerald-950/10 border-emerald-500/20" : "bg-emerald-500/5 border-emerald-105 text-stone-900"
                          : theme === "dark" ? "bg-stone-900/40 border-stone-850 text-stone-300" : "bg-stone-50 border-stone-205 text-stone-900"
                    }`}
                  >
                    {/* Inner soft glow line for visual accent */}
                    <div className={`absolute left-0 top-0 bottom-0 w-1 ${
                      issue.status === "Urgent" ? "bg-red-500" : issue.status === "Resolved" ? "bg-emerald-500" : "bg-stone-500"
                    }`} />

                    {/* Top Row: Reporter and Status */}
                    <div className="flex flex-wrap justify-between items-center gap-2 pl-2">
                      <div className="flex items-center gap-2">
                        <span className={`w-2 h-2 rounded-full shrink-0 ${issue.status === 'Urgent'? 'bg-red-500 animate-pulse' : 'bg-amber-400'}`} />
                        <div className={`text-xs font-black ${theme === 'dark' ? 'text-white' : 'text-stone-900'}`}>
                          {issue.userName} <span className="opacity-60 text-[10px] font-mono font-bold">({issue.userTactId})</span>
                        </div>
                        <span className="text-[10px] text-stone-400 font-mono">
                          • {new Date(issue.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} ({new Date(issue.timestamp).toLocaleDateString()})
                        </span>
                      </div>

                      <div className="flex items-center gap-2">
                        {/* Status Badge */}
                        <span className={`px-2 py-0.5 rounded text-[9.5px] font-black uppercase border ${
                          issue.status === "Urgent"
                            ? "bg-red-500/15 text-red-400 border-red-500/30"
                            : issue.status === "Pending"
                              ? "bg-amber-500/15 text-amber-500 border-amber-500/30"
                              : issue.status === "Resolved"
                                ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30"
                                : "bg-stone-500/15 text-stone-400 border-stone-500/30"
                        }`}>
                          {issue.status === "Pending" ? "⏳ Review" : issue.status === "Urgent" ? "🔥 Urgent" : issue.status}
                        </span>
                      </div>
                    </div>

                    {/* Condition & Question Details row */}
                    <div className="pl-2 grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                      <div className={`space-y-1 p-3 rounded-xl border ${theme === 'dark' ? 'bg-[#060a12] border-stone-850' : 'bg-white border-stone-200'}`}>
                        <span className="text-[9px] font-black uppercase tracking-wider text-stone-450 block font-mono">Condition Check Parameters</span>
                        <div className="font-bold flex items-center gap-1">
                          <span className="font-mono text-[10px] bg-[#117FDA]/15 text-[#117FDA] dark:text-sky-305 px-1.5 py-0.5 rounded border border-[#117FDA]/25">{issue.pedInput}</span>
                          <span className={`font-sans text-[10.5px] ${theme === 'dark' ? 'text-stone-305' : 'text-stone-600'}`}>on <span className="text-[#117FDA] font-extrabold">{issue.planName}</span></span>
                        </div>
                        <div className="text-[10px] text-stone-500 font-semibold mt-1">
                          System match category was <span className="font-bold text-red-400 uppercase">{translateMatchTypeToLayman(issue.matchType)}</span>
                        </div>
                      </div>

                      <div className={`space-y-1 p-3 rounded-xl border ${theme === 'dark' ? 'bg-[#060a12] border-stone-850' : 'bg-white border-stone-200'}`}>
                        <span className="text-[9px] font-black uppercase tracking-wider text-stone-450 block font-mono">Matched Question in Policy</span>
                        <p className={`text-[12px] font-semibold line-clamp-1 italic ${theme === 'dark' ? 'text-stone-200' : 'text-stone-800'}`} title={issue.matchedQuestion}>
                          "{issue.matchedQuestion}"
                        </p>
                        <p className="text-[10px] text-stone-500 font-bold block">
                          Source: {translateSourceToLayman(issue.source)}
                        </p>
                      </div>
                    </div>

                    {/* Advisor Feedback Notes */}
                    <div className={`pl-2 py-2.5 px-3 border-l-2 rounded-r-xl space-y-1 ${
                      theme === 'dark' ? 'bg-red-500/5 dark:bg-red-500/10 border-red-500/40' : 'bg-red-500/5 border-red-500/25'
                    }`}>
                      <span className="text-[10px] font-black text-red-500 dark:text-red-400 uppercase tracking-wider block font-mono">Advisor Discrepancy Note</span>
                      <p className={`text-xs font-bold leading-relaxed ${theme === 'dark' ? 'text-slate-100' : 'text-stone-800'}`}>
                        {issue.issueNotes}
                      </p>
                    </div>

                    {/* Owner Resolution and Response Controls */}
                    <div className="pl-2 pt-2.5 border-t border-dashed border-stone-200 dark:border-stone-850 flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
                      {issue.status !== "Resolved" && issue.status !== "Ignored" ? (
                        <>
                          <div className="flex-grow flex items-center gap-2">
                            <textarea
                              rows={1}
                              placeholder="Write resolution steps, advisor notes resolution verdict..."
                              value={ownerResolutionNotes[issue.id] || ""}
                              onChange={(e) => setOwnerResolutionNotes(prev => ({ ...prev, [issue.id]: e.target.value }))}
                              className={`flex-grow text-xs px-3 py-1.5 rounded-lg border outline-none font-semibold ${
                                theme === 'dark'
                                  ? 'bg-[#060a12] border-stone-850 text-white focus:border-red-500'
                                  : 'bg-white border-stone-200 text-stone-900 focus:border-red-400'
                              }`}
                            />
                          </div>

                          <div className="flex flex-wrap items-center gap-2 shrink-0 animate-fade-in">
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
                              className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-[10.5px] font-extrabold uppercase tracking-widest rounded-lg flex items-center gap-1 cursor-pointer transition-all active:scale-95 select-none hover:scale-102"
                            >
                              <Check className="w-3.5 h-3.5 shrink-0 text-white" />
                              <span>Resolve</span>
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
                              className="px-3.5 py-1.5 bg-stone-700 hover:bg-stone-600 text-stone-200 text-[10.5px] font-extrabold uppercase tracking-widest rounded-lg cursor-pointer transition-all active:scale-95 select-none"
                            >
                              <span>Ignore</span>
                            </button>
                            {effectiveTier === "Owner" && (
                              <button
                                onClick={() => {
                                  requestOwnerPasscode(`Delete mismatch report for "${issue.pedInput}" permanently`, () => {
                                    setReportedIssues(prev => prev.filter(item => item.id !== issue.id));
                                  });
                                }}
                                className="p-1.5 bg-transparent border border-stone-200 dark:border-stone-850 hover:border-red-500 hover:bg-red-500/15 text-stone-500 hover:text-red-400 rounded-lg cursor-pointer transition-colors"
                                title="Delete Mismatch Report permanently"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        </>
                      ) : (
                        <div className={`flex-grow p-3 rounded-xl border text-xs flex flex-col md:flex-row justify-between items-start md:items-center gap-3 ${
                          theme === 'dark' ? 'bg-stone-900/55 border-stone-850' : 'bg-stone-50 border-stone-205'
                        }`}>
                          <div>
                            <span className={`text-[10px] font-black uppercase tracking-wider block ${issue.status === 'Resolved' ? 'text-emerald-500' : 'text-stone-450'}`}>Resolution Verdict</span>
                            <p className={`font-bold mt-0.5 leading-relaxed ${theme === 'dark' ? 'text-stone-305' : 'text-stone-750'}`}>{issue.ownerNotes}</p>
                          </div>
                          {effectiveTier === "Owner" && (
                            <button
                              onClick={() => {
                                requestOwnerPasscode(`Delete mismatch record for "${issue.pedInput}" permanently`, () => {
                                  setReportedIssues(prev => prev.filter(item => item.id !== issue.id));
                                });
                              }}
                              className="px-2.5 py-1 text-[10px] font-extrabold text-red-400 bg-red-500/10 hover:bg-red-500/20 rounded border border-red-500/20 cursor-pointer self-end md:self-auto uppercase tracking-wide select-none active:scale-95"
                            >
                              Delete Record
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
