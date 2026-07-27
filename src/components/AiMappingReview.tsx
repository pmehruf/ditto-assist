/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Check,
  X,
  Archive,
  Eye,
  Pencil,
  RefreshCw,
  AlertTriangle,
  Bot,
  Download,
} from "lucide-react";
import { ClippedButton } from "./ClippedButton";
import { CustomSelect } from "./CustomSelect";

export type AiMemoryStatus = "pending" | "approved" | "rejected" | "archived";

export interface AiMemoryEntry {
  id: number;
  condition: string;
  normalizedCondition: string;
  planName: string;
  engineVersion: string;
  promptVersion: string;
  geminiModel: string;
  aiResponse: {
    result?: {
      ped_input?: string;
      match_type?: string;
      matched_question?: string;
      explanation?: string;
      confused_questions?: string[];
    };
    raw?: Record<string, unknown>;
  } | null;
  status: AiMemoryStatus;
  createdAt: string;
  approvedAt?: string | null;
  approvedBy?: string | null;
  lastAccessedAt?: string | null;
  accessCount: number;
}

/**
 * AI Mapping Review — the human review surface over the AI Memory layer
 * (L2 of the three-level lookup: L1 deterministic engine → L2 AI memory →
 * L3 Gemini).
 *
 * Every answer Gemini produces for a PED the deterministic engine could not
 * classify lands here as `pending`. Approving an entry does two things: (1)
 * marks it trusted so future lookups for this exact (condition, plan) reuse
 * it without calling Gemini again, and (2) attempts to PROMOTE it into
 * ped_mapping_overrides — the same live table the PED Library tab and the
 * Lookup page's "teach it" flow write to — so the deterministic engine picks
 * it up for every plan going forward, not just this one cached pair.
 *
 * Promotion only happens when the AI's plan-specific answer can be traced
 * back to exactly one plan-agnostic categoryKey (see inferCategoryKeyForQuestion
 * in server.ts); ambiguous, fallback, or non-specific answers stay cache-only
 * and the response's `promotion.reason` explains why. Rejecting a
 * previously-approved entry un-promotes it, so correcting a mistake here
 * actually fixes live classification instead of leaving a stale override
 * behind. Usage Count still matters for anything that stayed cache-only: it
 * surfaces which unknown conditions are searched often enough to be worth a
 * manual category assignment.
 */
export function AiMappingReview({
  theme,
  effectiveTier,
}: {
  theme: "light" | "dark";
  effectiveTier: "General" | "Admin" | "Owner";
}) {
  const dark = theme === "dark";
  const canReview = effectiveTier === "Admin" || effectiveTier === "Owner";

  const [entries, setEntries] = useState<AiMemoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("pending");
  const [search, setSearch] = useState("");
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  // Transient feedback from the last approve action's promotion attempt
  // (see setStatus below) — separate from `error` since this isn't a
  // failure, just information about whether the mapping went live.
  const [promotionNotice, setPromotionNotice] = useState<string | null>(null);

  // Inline edit state for the cached answer (details panel).
  const [editingId, setEditingId] = useState<number | null>(null);
  const [draftQuestion, setDraftQuestion] = useState("");
  const [draftExplanation, setDraftExplanation] = useState("");

  const fetchEntries = async () => {
    setLoading(true);
    try {
      const qs = statusFilter === "all" ? "" : `?status=${encodeURIComponent(statusFilter)}`;
      const res = await fetch(`/api/ai-memory${qs}`);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Failed to load queue (HTTP ${res.status}).`);
      setEntries(body.entries || []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load AI Mapping Review.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchEntries();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter]);

  const setStatus = async (id: number, status: AiMemoryStatus) => {
    setBusyId(id);
    setPromotionNotice(null);
    try {
      const res = await fetch(`/api/ai-memory/${id}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Failed to update (HTTP ${res.status}).`);
      if (status === "approved") {
        const promotion = body.promotion as { promoted?: boolean; categoryKey?: string; reason?: string } | undefined;
        if (promotion?.promoted) {
          setPromotionNotice(`Promoted to the live "${promotion.categoryKey}" category — this now applies for every plan.`);
        } else if (promotion?.reason) {
          setPromotionNotice(`Approved, but not promoted to a live mapping: ${promotion.reason}`);
        }
      }
      await fetchEntries();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update this entry.");
    } finally {
      setBusyId(null);
    }
  };

  const saveEdit = async (entry: AiMemoryEntry) => {
    setBusyId(entry.id);
    try {
      const nextResponse = {
        ...(entry.aiResponse || {}),
        result: {
          ...(entry.aiResponse?.result || {}),
          matched_question: draftQuestion,
          explanation: draftExplanation,
        },
      };
      const res = await fetch(`/api/ai-memory/${entry.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ aiResponse: nextResponse }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Failed to save (HTTP ${res.status}).`);
      setEditingId(null);
      await fetchEntries();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save this edit.");
    } finally {
      setBusyId(null);
    }
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter(
      (e) =>
        e.condition.toLowerCase().includes(q) ||
        e.planName.toLowerCase().includes(q) ||
        (e.aiResponse?.result?.matched_question || "").toLowerCase().includes(q)
    );
  }, [entries, search]);

  // Same CSV-building logic as the Activity Log's "Export CSV" (App.tsx's
  // downloadCSV) — kept local here rather than threaded down as a prop
  // since this component already owns and fetches its own entries.
  const downloadCSV = (data: Record<string, unknown>[], filename: string) => {
    if (data.length === 0) return;
    const headers = Object.keys(data[0]);
    const csvContent = [
      headers.join(","),
      ...data.map(row =>
        headers.map(field => {
          let val = row[field];
          if (typeof val === "object") val = JSON.stringify(val);
          return `"${String(val ?? "").replace(/"/g, '""')}"`;
        }).join(",")
      )
    ].join("\r\n");

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // Flattens the currently filtered entries (same set the table shows, not
  // the full unfiltered queue) into plain rows — the nested aiResponse/raw
  // JSON is reduced to just the fields already surfaced in the UI so the
  // export reads like the table, not a database dump.
  const exportRows = () =>
    filtered.map((e) => ({
      Condition: e.condition,
      "Normalized Condition": e.normalizedCondition,
      Plan: e.planName,
      "Match Type": e.aiResponse?.result?.match_type || "",
      "Matched Question": e.aiResponse?.result?.matched_question || "",
      Explanation: e.aiResponse?.result?.explanation || "",
      Status: e.status,
      "Gemini Model": e.geminiModel,
      "Prompt Version": e.promptVersion,
      "Engine Version": e.engineVersion,
      Created: fmtDate(e.createdAt),
      "Last Used": fmtDate(e.lastAccessedAt),
      "Usage Count": e.accessCount,
      "Approved By": e.approvedBy || "",
      "Approved At": fmtDate(e.approvedAt),
    }));

  const fmtDate = (iso?: string | null) => {
    if (!iso) return "—";
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "—";
    return d.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
  };

  const statusPill = (status: AiMemoryStatus) => {
    const map: Record<AiMemoryStatus, string> = {
      pending: dark
        ? "bg-amber-500/15 text-amber-300 border-amber-500/30"
        : "bg-amber-50 text-amber-700 border-amber-200",
      approved: dark
        ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/30"
        : "bg-emerald-50 text-emerald-700 border-emerald-200",
      rejected: dark
        ? "bg-red-500/15 text-red-300 border-red-500/30"
        : "bg-red-50 text-red-700 border-red-200",
      archived: dark
        ? "bg-white/[0.06] text-stone-400 border-white/[0.1]"
        : "bg-stone-100 text-stone-600 border-stone-200",
    };
    return (
      <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide border ${map[status]}`}>
        {status}
      </span>
    );
  };

  const cardClass = `rounded-2xl border ${dark ? "bg-white/[0.03] border-white/[0.08]" : "bg-black/[0.02] border-black/[0.08]"}`;
  const inputClass = `text-xs p-2 rounded-lg border outline-none transition-colors ${
    dark
      ? "bg-[#12151A] border-[#252A34] text-white focus:border-blue-500 placeholder-stone-600"
      : "bg-white border-stone-250 text-stone-900 focus:border-blue-400 placeholder-stone-400"
  }`;

  return (
    <div className={`p-5 space-y-4 ${cardClass}`}>
      {/* Toolbar */}
      <div className="flex flex-col lg:flex-row lg:items-center gap-3 justify-between">
        <div className="space-y-0.5">
          <h3 className={`text-sm font-black uppercase tracking-wider flex items-center gap-2 ${dark ? "text-white" : "text-stone-900"}`}>
            <Bot className="w-4 h-4 text-cyan-400 shrink-0" />
            AI Mapping Review
          </h3>
          <p className={`text-[11px] font-medium ${dark ? "text-stone-400" : "text-stone-500"}`}>
            AI answers for conditions the deterministic engine could not classify. Approving reuses the cached answer AND,
            when the mapping can be confidently generalized, promotes it into the live engine for every plan.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search condition, plan, question..."
            className={`${inputClass} w-56`}
          />
          <div className="w-40">
            <CustomSelect
              theme={theme}
              value={statusFilter}
              onChange={setStatusFilter}
              options={[
                { value: "pending", label: "Pending" },
                { value: "approved", label: "Approved" },
                { value: "rejected", label: "Rejected" },
                { value: "archived", label: "Archived" },
                { value: "all", label: "All Statuses" },
              ]}
              triggerClassName={`w-full flex items-center justify-between gap-2 text-xs font-semibold pl-2.5 pr-8 py-2 rounded-lg border outline-none cursor-pointer relative ${
                dark
                  ? "bg-[#12151A] border-[#252A34] text-white"
                  : "bg-white border-stone-250 text-stone-850"
              }`}
            />
          </div>
          {/* App-wide clipped-corner button (see ClippedButton.tsx) instead
              of a one-off rounded pill, so this matches every other
              function-performing button in the app (e.g. the Activity Log's
              Export CSV). */}
          <ClippedButton
            onClick={() => downloadCSV(exportRows(), "ai-mapping-review.csv")}
            disabled={filtered.length === 0}
            size="sm"
            title="Export the filtered queue as a CSV file"
            className="shrink-0 gap-1.5 pl-2 pr-2.5 py-1.5 text-white text-[10px] font-black uppercase tracking-wider bg-[#117FDA] hover:bg-[#0d6dbb]"
          >
            <Download className="w-3.5 h-3.5 shrink-0" />
            <span>Export CSV</span>
          </ClippedButton>
          <button
            type="button"
            onClick={fetchEntries}
            title="Refresh"
            className={`p-2 rounded-lg border transition-colors cursor-pointer ${
              dark ? "border-white/[0.08] hover:bg-white/[0.05] text-stone-300" : "border-stone-200 hover:bg-stone-100 text-stone-600"
            }`}
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {error && (
        <div className={`flex items-start gap-2 p-3 rounded-lg border text-xs font-semibold ${
          dark ? "bg-red-500/10 border-red-500/30 text-red-300" : "bg-red-50 border-red-200 text-red-700"
        }`}>
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {promotionNotice && (
        <div className={`flex items-start gap-2 p-3 rounded-lg border text-xs font-semibold ${
          dark ? "bg-sky-500/10 border-sky-500/30 text-sky-300" : "bg-sky-50 border-sky-200 text-sky-700"
        }`}>
          <Bot className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{promotionNotice}</span>
        </div>
      )}

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className={`text-[10px] font-black uppercase tracking-wider ${dark ? "text-stone-400" : "text-stone-500"}`}>
              <th className="py-2 pr-3">Condition</th>
              <th className="py-2 pr-3">Plan</th>
              <th className="py-2 pr-3">Suggested Route</th>
              <th className="py-2 pr-3">Status</th>
              <th className="py-2 pr-3 whitespace-nowrap">Created</th>
              <th className="py-2 pr-3 whitespace-nowrap">Last Used</th>
              <th className="py-2 pr-3 text-center whitespace-nowrap">Uses</th>
              <th className="py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={8} className="py-10 text-center text-xs italic text-stone-500">
                  Loading queue...
                </td>
              </tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={8} className="py-10 text-center text-xs italic text-stone-500">
                  No entries for this filter. Conditions appear here automatically when the AI fallback runs.
                </td>
              </tr>
            ) : (
              filtered.map((entry) => {
                const result = entry.aiResponse?.result;
                const isOpen = expandedId === entry.id;
                const isBusy = busyId === entry.id;
                return (
                  <tr
                    key={entry.id}
                    className={`align-top border-t ${dark ? "border-white/[0.06]" : "border-black/[0.06]"}`}
                  >
                    <td className="py-2.5 pr-3" colSpan={isOpen ? 8 : 1}>
                      {!isOpen ? (
                        <span className={`text-xs font-bold ${dark ? "text-white" : "text-stone-900"}`}>
                          {entry.condition}
                        </span>
                      ) : (
                        /* Expanded: full-width details panel replaces the row's cells */
                        <div className="space-y-3 py-1">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <span className={`text-sm font-black ${dark ? "text-white" : "text-stone-900"}`}>
                                {entry.condition}
                              </span>
                              <span className={`ml-2 text-[11px] font-mono ${dark ? "text-stone-500" : "text-stone-500"}`}>
                                normalized: {entry.normalizedCondition}
                              </span>
                            </div>
                            <button
                              type="button"
                              onClick={() => { setExpandedId(null); setEditingId(null); }}
                              className={`text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded border cursor-pointer ${
                                dark ? "border-white/[0.1] text-stone-300 hover:bg-white/[0.05]" : "border-stone-200 text-stone-600 hover:bg-stone-100"
                              }`}
                            >
                              Close
                            </button>
                          </div>

                          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-[11px]">
                            <Detail label="Plan" value={entry.planName} dark={dark} />
                            <Detail label="Gemini Model" value={entry.geminiModel} dark={dark} />
                            <Detail label="Prompt Version" value={entry.promptVersion} dark={dark} />
                            <Detail label="Engine Version" value={entry.engineVersion} dark={dark} />
                            <Detail label="Usage Count" value={String(entry.accessCount)} dark={dark} />
                            <Detail
                              label="Approved By"
                              value={entry.approvedBy ? `${entry.approvedBy} (${fmtDate(entry.approvedAt)})` : "—"}
                              dark={dark}
                            />
                          </div>

                          {editingId === entry.id ? (
                            <div className="space-y-2">
                              <label className={`block text-[10px] font-black uppercase tracking-wider ${dark ? "text-stone-400" : "text-stone-500"}`}>
                                Selected Declaration Question
                              </label>
                              <textarea
                                rows={2}
                                value={draftQuestion}
                                onChange={(e) => setDraftQuestion(e.target.value)}
                                className={`${inputClass} w-full resize-y`}
                              />
                              <label className={`block text-[10px] font-black uppercase tracking-wider ${dark ? "text-stone-400" : "text-stone-500"}`}>
                                Reasoning / Explanation
                              </label>
                              <textarea
                                rows={4}
                                value={draftExplanation}
                                onChange={(e) => setDraftExplanation(e.target.value)}
                                className={`${inputClass} w-full resize-y`}
                              />
                              <div className="flex gap-2">
                                <ClippedButton
                                  type="button"
                                  onClick={() => saveEdit(entry)}
                                  className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-[10px] font-extrabold uppercase tracking-widest gap-1.5"
                                >
                                  <Check className="w-3 h-3" /> Save
                                </ClippedButton>
                                <ClippedButton
                                  type="button"
                                  onClick={() => setEditingId(null)}
                                  className={`px-3 py-1.5 text-[10px] font-extrabold uppercase tracking-widest gap-1.5 ${
                                    dark ? "bg-white/[0.06] text-stone-300" : "bg-stone-100 text-stone-700"
                                  }`}
                                >
                                  Cancel
                                </ClippedButton>
                              </div>
                            </div>
                          ) : (
                            <>
                              <DetailBlock label="Suggested Declaration Route" dark={dark}>
                                <span className="font-semibold">{result?.match_type || "—"}</span>
                                {" → "}
                                <span>{result?.matched_question || "—"}</span>
                              </DetailBlock>

                              <DetailBlock label="Gemini Reasoning" dark={dark}>
                                <span className="whitespace-pre-wrap">{result?.explanation || "—"}</span>
                              </DetailBlock>

                              {!!result?.confused_questions?.length && (
                                <DetailBlock label="Rejected / Competing Alternatives" dark={dark}>
                                  <ul className="list-disc pl-4 space-y-0.5">
                                    {result.confused_questions.map((q, i) => (
                                      <li key={i}>{q}</li>
                                    ))}
                                  </ul>
                                </DetailBlock>
                              )}

                              <DetailBlock label="Full JSON Response" dark={dark}>
                                <pre className={`text-[10px] leading-relaxed overflow-x-auto p-2 rounded ${
                                  dark ? "bg-black/40 text-stone-300" : "bg-stone-50 text-stone-700"
                                }`}>
                                  {JSON.stringify(entry.aiResponse ?? {}, null, 2)}
                                </pre>
                              </DetailBlock>
                            </>
                          )}
                        </div>
                      )}
                    </td>

                    {!isOpen && (
                      <>
                        <td className={`py-2.5 pr-3 text-xs ${dark ? "text-stone-300" : "text-stone-700"}`}>
                          {entry.planName}
                        </td>
                        <td className={`py-2.5 pr-3 text-xs max-w-[280px] ${dark ? "text-stone-300" : "text-stone-700"}`}>
                          <span className="font-bold">{result?.match_type || "—"}</span>
                          <span className="block truncate opacity-80">{result?.matched_question || "—"}</span>
                        </td>
                        <td className="py-2.5 pr-3">{statusPill(entry.status)}</td>
                        <td className={`py-2.5 pr-3 text-[11px] whitespace-nowrap ${dark ? "text-stone-400" : "text-stone-500"}`}>
                          {fmtDate(entry.createdAt)}
                        </td>
                        <td className={`py-2.5 pr-3 text-[11px] whitespace-nowrap ${dark ? "text-stone-400" : "text-stone-500"}`}>
                          {fmtDate(entry.lastAccessedAt)}
                        </td>
                        <td className={`py-2.5 pr-3 text-xs text-center font-bold ${dark ? "text-cyan-300" : "text-cyan-700"}`}>
                          {entry.accessCount}
                        </td>
                        <td className="py-2.5">
                          <div className="flex items-center justify-end gap-1">
                            <IconBtn
                              title="View details"
                              dark={dark}
                              onClick={() => { setExpandedId(entry.id); setEditingId(null); }}
                            >
                              <Eye className="w-3.5 h-3.5" />
                            </IconBtn>
                            {canReview && (
                              <>
                                <IconBtn
                                  title="Edit cached answer"
                                  dark={dark}
                                  disabled={isBusy}
                                  onClick={() => {
                                    setExpandedId(entry.id);
                                    setEditingId(entry.id);
                                    setDraftQuestion(result?.matched_question || "");
                                    setDraftExplanation(result?.explanation || "");
                                  }}
                                >
                                  <Pencil className="w-3.5 h-3.5" />
                                </IconBtn>
                                {entry.status !== "approved" && (
                                  <IconBtn title="Approve" dark={dark} disabled={isBusy} tone="green" onClick={() => setStatus(entry.id, "approved")}>
                                    <Check className="w-3.5 h-3.5" />
                                  </IconBtn>
                                )}
                                {entry.status !== "rejected" && (
                                  <IconBtn title="Reject" dark={dark} disabled={isBusy} tone="red" onClick={() => setStatus(entry.id, "rejected")}>
                                    <X className="w-3.5 h-3.5" />
                                  </IconBtn>
                                )}
                                {entry.status !== "archived" && (
                                  <IconBtn title="Archive" dark={dark} disabled={isBusy} onClick={() => setStatus(entry.id, "archived")}>
                                    <Archive className="w-3.5 h-3.5" />
                                  </IconBtn>
                                )}
                              </>
                            )}
                          </div>
                        </td>
                      </>
                    )}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Detail({ label, value, dark }: { label: string; value: string; dark: boolean }) {
  return (
    <div>
      <span className={`block text-[9px] font-black uppercase tracking-wider ${dark ? "text-stone-500" : "text-stone-400"}`}>
        {label}
      </span>
      <span className={`text-[11px] font-semibold ${dark ? "text-stone-200" : "text-stone-800"}`}>{value}</span>
    </div>
  );
}

function DetailBlock({ label, dark, children }: { label: string; dark: boolean; children: ReactNode }) {
  return (
    <div className="space-y-1">
      <span className={`block text-[9px] font-black uppercase tracking-wider ${dark ? "text-stone-500" : "text-stone-400"}`}>
        {label}
      </span>
      <div className={`text-[11px] leading-relaxed ${dark ? "text-stone-200" : "text-stone-800"}`}>{children}</div>
    </div>
  );
}

function IconBtn({
  title,
  dark,
  onClick,
  children,
  disabled,
  tone,
}: {
  title: string;
  dark: boolean;
  onClick: () => void;
  children: ReactNode;
  disabled?: boolean;
  tone?: "green" | "red";
}) {
  const toneCls =
    tone === "green"
      ? dark
        ? "text-emerald-300 hover:bg-emerald-500/15 border-emerald-500/25"
        : "text-emerald-700 hover:bg-emerald-50 border-emerald-200"
      : tone === "red"
      ? dark
        ? "text-red-300 hover:bg-red-500/15 border-red-500/25"
        : "text-red-700 hover:bg-red-50 border-red-200"
      : dark
      ? "text-stone-300 hover:bg-white/[0.06] border-white/[0.08]"
      : "text-stone-600 hover:bg-stone-100 border-stone-200";
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      disabled={disabled}
      className={`p-1.5 rounded-lg border transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${toneCls}`}
    >
      {children}
    </button>
  );
}
