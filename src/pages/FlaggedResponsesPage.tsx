/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useMemo, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { CheckCircle2, Check, Trash2, ArrowUpCircle, RotateCcw } from "lucide-react";
import { ReportedIssue } from "../types/announcements";
import { LoggedUser } from "../types/user";
import { ChangeLogEntry } from "../types/changeLog";
import { ClippedButton } from "../components/ClippedButton";
import { SortableTh } from "../components/SortableTh";
import { useSortableData, stringComparator, dateComparator } from "../utils/useSortableData";

interface FlaggedResponsesPageProps {
  theme: "light" | "dark";
  reportedIssues: ReportedIssue[];
  setReportedIssues: Dispatch<SetStateAction<ReportedIssue[]>>;
  reportedIssuesFilter: string;
  setReportedIssuesFilter: (value: string) => void;
  ownerResolutionNotes: Record<string, string>;
  setOwnerResolutionNotes: Dispatch<SetStateAction<Record<string, string>>>;
  effectiveTier: "General" | "Admin" | "Owner";
  /** Shows an "are you sure?" confirmation before running a destructive, Owner-tier action. */
  confirmDestructiveAction: (actionDescription: string, onConfirm: () => void) => void;
  currentUser: LoggedUser | null;
  setChangeLogs: Dispatch<SetStateAction<ChangeLogEntry[]>>;
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
  confirmDestructiveAction,
  currentUser,
  setChangeLogs,
}: FlaggedResponsesPageProps) {
  const dark = theme === "dark";

  const [loading, setLoading] = useState(true);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // Pull the server's copy on mount — see Production_Readiness_Audit.md
  // Finding 3: this used to be a hardcoded/localStorage-only seed, so a
  // report only ever existed in the reporting advisor's own browser, and an
  // Owner's resolve/ignore/delete never reached anyone else's session.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/flagged-issues");
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error || `Failed to load flagged responses (HTTP ${res.status}).`);
        if (!cancelled && Array.isArray(body.entries)) {
          setReportedIssues(body.entries.map((row: any): ReportedIssue => ({
            id: String(row.id),
            timestamp: row.timestamp,
            userEmail: row.userEmail,
            userName: row.userName,
            userTactId: row.userTactId,
            planName: row.planName,
            pedInput: row.pedInput,
            matchedQuestion: row.matchedQuestion,
            matchType: row.matchType,
            source: row.source,
            explanation: row.explanation,
            issueNotes: row.issueNotes,
            status: row.status,
            ownerNotes: row.ownerNotes ?? undefined,
            resolvedAt: row.resolvedAt ?? undefined,
          })));
        }
      } catch (err: unknown) {
        if (!cancelled) setSyncError(err instanceof Error ? err.message : "Could not load flagged responses from the server.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // Runs once on mount only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const updateIssueStatus = async (id: string, status: "Urgent" | "Pending" | "Resolved" | "Ignored", ownerNotes?: string) => {
    setActionError(null);
    try {
      const res = await fetch(`/api/flagged-issues/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(ownerNotes === undefined ? { status } : { status, ownerNotes }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Failed to update this report (HTTP ${res.status}).`);
      const row = body.entry;
      setReportedIssues(prev => prev.map(item => item.id === id ? {
        ...item,
        status: row.status,
        ownerNotes: row.ownerNotes ?? undefined,
        resolvedAt: row.resolvedAt ?? undefined,
      } : item));
      return true;
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : "Failed to update this report. Please try again.");
      return false;
    }
  };

  const deleteIssue = async (id: string) => {
    setActionError(null);
    try {
      const res = await fetch(`/api/flagged-issues/${id}`, { method: "DELETE" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Failed to delete this report (HTTP ${res.status}).`);
      setReportedIssues(prev => prev.filter(item => item.id !== id));
      return true;
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : "Failed to delete this report. Please try again.");
      return false;
    }
  };

  const logAction = (actionType: string, description: string, planName: string) => {
    setChangeLogs(prev => [
      {
        id: `log-${Date.now()}`,
        timestamp: new Date().toISOString(),
        userName: currentUser?.name || currentUser?.email || "Mehruf P (Owner)",
        role: effectiveTier,
        actionType,
        planName,
        description,
      },
      ...prev,
    ]);
  };

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

  const { sorted: sortedIssues, sort: issuesSort, toggleSort: toggleIssuesSort } = useSortableData(
    filteredIssues,
    {
      userName: stringComparator((issue: ReportedIssue) => issue.userName),
      planName: stringComparator((issue: ReportedIssue) => issue.planName),
      timestamp: dateComparator((issue: ReportedIssue) => issue.timestamp),
      pedInput: stringComparator((issue: ReportedIssue) => issue.pedInput),
      matchedQuestion: stringComparator((issue: ReportedIssue) => issue.matchedQuestion),
      matchType: stringComparator((issue: ReportedIssue) => issue.matchType),
      issueNotes: stringComparator((issue: ReportedIssue) => issue.issueNotes),
      status: stringComparator((issue: ReportedIssue) => issue.status),
    }
  );

  const thClass = `px-3 py-2.5 text-left text-[9.5px] font-black uppercase tracking-wider whitespace-nowrap ${
    dark ? "text-stone-400" : "text-stone-500"
  }`;
  const tdClass = "px-3 py-2.5 align-top text-xs";

  return (
    <div className="space-y-5 text-left">
      {/* PAGE-LEVEL HEADER — standardized app-wide (see Coverage Projection
          Studio, the reference implementation): flat, no card surface,
          accent line + title sitting directly on the page. */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 pb-3 border-b border-stone-200 dark:border-stone-800">
        <div>
          <h1 className={`text-page-title tracking-tight flex items-center gap-2 ${
            dark ? "text-white" : "text-[#111827]"
          }`}>
            <div className="w-8 h-0.5 flex-shrink-0" style={{ backgroundColor: dark ? "#00D3F3" : "#4673a9" }} />
            <span>Flagged Responses</span>
          </h1>
          <p className="text-xs mt-1 font-semibold text-content-muted">
            Review and resolve advisor-flagged policy mapping discrepancies, medical code differences, and underwriting exceptions.
          </p>
        </div>
        <div className={`text-xs font-black uppercase tracking-wider px-3 py-1.5 rounded-xl font-mono ${
          dark ? 'text-red-400 bg-red-950/20' : 'text-red-700 bg-red-50 border border-red-200'
        }`}>
          Unresolved: {reportedIssues.filter(issue => issue.status === "Pending" || issue.status === "Urgent").length}
        </div>
      </div>

      {(syncError || actionError) && (
        <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-500 text-xs font-semibold">
          ⚠️ {syncError || actionError}
        </div>
      )}

      {/* SECTION: REPORTED MISMATCH CHALLENGES */}
      <div className={`rounded-2xl border p-5 transition-all ${
        dark ? "bg-[#0e2236]/90 border-white/[0.04]" : "bg-black/[0.02] border-black/[0.08] shadow-xs"
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
          {loading ? (
            <div className="py-20 text-center rounded-xl border border-dashed border-stone-200 dark:border-stone-850 flex flex-col items-center justify-center font-sans">
              <p className={`text-[11px] font-bold uppercase tracking-wider ${dark ? 'text-stone-400' : 'text-stone-500'}`}>
                Loading flagged responses...
              </p>
            </div>
          ) : filteredIssues.length === 0 ? (
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
                  <tr className={`border-b ${dark ? "bg-[#132c46] border-stone-850" : "bg-stone-50 border-stone-200"}`}>
                    <SortableTh label="Flagged By" sortKey="userName" activeSort={issuesSort} onSort={toggleIssuesSort} className={thClass} />
                    <SortableTh label="Plan" sortKey="planName" activeSort={issuesSort} onSort={toggleIssuesSort} className={thClass} />
                    <SortableTh label="Timestamp" sortKey="timestamp" activeSort={issuesSort} onSort={toggleIssuesSort} className={thClass} />
                    <SortableTh label="PED" sortKey="pedInput" activeSort={issuesSort} onSort={toggleIssuesSort} className={thClass} />
                    <SortableTh label="Matched Question" sortKey="matchedQuestion" activeSort={issuesSort} onSort={toggleIssuesSort} className={thClass} />
                    <SortableTh label="Category" sortKey="matchType" activeSort={issuesSort} onSort={toggleIssuesSort} className={thClass} />
                    <SortableTh label="Comment" sortKey="issueNotes" activeSort={issuesSort} onSort={toggleIssuesSort} className={thClass} />
                    <SortableTh label="Status / Actions" sortKey="status" activeSort={issuesSort} onSort={toggleIssuesSort} className={`${thClass} text-right`} align="right" />
                  </tr>
                </thead>
                <tbody>
                  {sortedIssues.map((issue, idx) => {
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
                          <span
                            className="font-mono text-[10px] bg-[#117FDA]/15 px-1.5 py-0.5 rounded border border-[#117FDA]/25 whitespace-nowrap"
                            style={{ color: dark ? "#7DC3FF" : "#054080" }}
                          >
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
                                {issue.status !== "Urgent" && (
                                  <ClippedButton
                                    onClick={async () => {
                                      const ok = await updateIssueStatus(issue.id, "Urgent");
                                      if (!ok) return;
                                      logAction(
                                        "Flagged Response Marked Urgent",
                                        `Escalated mismatch report for "${issue.pedInput}" to Urgent.`,
                                        issue.planName
                                      );
                                    }}
                                    cornerBg={dark ? "#0e2236" : "#ffffff"}
                                    className="px-2.5 py-1 bg-red-600 hover:bg-red-700 text-white text-[9.5px] font-extrabold uppercase tracking-widest gap-1"
                                  >
                                    <ArrowUpCircle className="w-3 h-3 shrink-0 text-white" />
                                    Mark Urgent
                                  </ClippedButton>
                                )}
                                {issue.status === "Urgent" && (
                                  <ClippedButton
                                    onClick={async () => {
                                      const ok = await updateIssueStatus(issue.id, "Pending");
                                      if (!ok) return;
                                      logAction(
                                        "Flagged Response Moved to Under Review",
                                        `De-escalated mismatch report for "${issue.pedInput}" back to Under Review.`,
                                        issue.planName
                                      );
                                    }}
                                    cornerBg={dark ? "#0e2236" : "#ffffff"}
                                    className={`px-2.5 py-1 text-[9.5px] font-extrabold uppercase tracking-widest gap-1 ${
                                      dark ? "bg-sky-600 hover:bg-sky-700 text-white" : "bg-sky-500 hover:bg-sky-600 text-white"
                                    }`}
                                  >
                                    <RotateCcw className="w-3 h-3 shrink-0 text-white" />
                                    Under Review
                                  </ClippedButton>
                                )}
                                <ClippedButton
                                  onClick={async () => {
                                    const note = ownerResolutionNotes[issue.id] || "Resolved discrepancy feedback. System mapping aligned.";
                                    const ok = await updateIssueStatus(issue.id, "Resolved", note);
                                    if (!ok) return;
                                    logAction(
                                      "Flagged Response Resolved",
                                      `Resolved mismatch report for "${issue.pedInput}": ${note}`,
                                      issue.planName
                                    );
                                  }}
                                  cornerBg={dark ? "#0e2236" : "#ffffff"}
                                  className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white text-[9.5px] font-extrabold uppercase tracking-widest gap-1"
                                >
                                  <Check className="w-3 h-3 shrink-0 text-white" />
                                  Resolve
                                </ClippedButton>
                                <ClippedButton
                                  onClick={async () => {
                                    const note = ownerResolutionNotes[issue.id] || "Marked as ignored/not a mismatch.";
                                    const ok = await updateIssueStatus(issue.id, "Ignored", note);
                                    if (!ok) return;
                                    logAction(
                                      "Flagged Response Ignored",
                                      `Ignored mismatch report for "${issue.pedInput}": ${note}`,
                                      issue.planName
                                    );
                                  }}
                                  cornerBg={dark ? "#0e2236" : "#ffffff"}
                                  className="px-2.5 py-1 bg-stone-700 hover:bg-stone-600 text-stone-50 text-[9.5px] font-extrabold uppercase tracking-widest"
                                >
                                  Ignore
                                </ClippedButton>
                                {effectiveTier === "Owner" && (
                                  <ClippedButton
                                    onClick={() => {
                                      confirmDestructiveAction(`Delete mismatch report for "${issue.pedInput}" permanently`, async () => {
                                        const ok = await deleteIssue(issue.id);
                                        if (!ok) return;
                                        logAction(
                                          "Flagged Response Deleted",
                                          `Permanently deleted mismatch report for "${issue.pedInput}"`,
                                          issue.planName
                                        );
                                      });
                                    }}
                                    cornerBg={dark ? "#0e2236" : "#ffffff"}
                                    className="p-1 hover:bg-red-500/15 text-stone-500 hover:text-red-400"
                                    title="Delete Mismatch Report permanently"
                                  >
                                    <Trash2 className="w-3 h-3" />
                                  </ClippedButton>
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
                                <ClippedButton
                                  onClick={() => {
                                    confirmDestructiveAction(`Delete mismatch record for "${issue.pedInput}" permanently`, async () => {
                                      const ok = await deleteIssue(issue.id);
                                      if (!ok) return;
                                      logAction(
                                        "Flagged Response Deleted",
                                        `Permanently deleted mismatch record for "${issue.pedInput}"`,
                                        issue.planName
                                      );
                                    });
                                  }}
                                  cornerBg={dark ? "#0e2236" : "#ffffff"}
                                  className="px-2 py-0.5 text-[9.5px] font-extrabold text-red-400 bg-red-500/10 hover:bg-red-500/20 uppercase tracking-wide"
                                >
                                  Delete
                                </ClippedButton>
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
