/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useState, type ReactNode } from "react";
import { Clock, Layers, ArrowUpRight, Search } from "lucide-react";
import { AuditLogEntry } from "../types/announcements";
import { getPlanInsurerColor } from "../utils/planInsurerColors";

interface RecentSearchesPanelProps {
  theme: "light" | "dark";
  userEmail: string;
  onOpenActivity: () => void;
}

function formatRelativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const diffMs = Date.now() - then;
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "Just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay === 1) return "Yesterday";
  if (diffDay < 7) return `${diffDay}d ago`;
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

/**
 * "Recent Declaration Searches" + "Recently Used Plans" — real data (not
 * placeholder), sourced from the same /api/search-history endpoint
 * MyActivityPage.tsx already uses, just the latest 5 entries for the signed
 * -in advisor. Recently Used Plans is derived client-side from the same
 * response (distinct plans, first-seen order) rather than a second request.
 */
export function RecentSearchesPanel({ theme, userEmail, onOpenActivity }: RecentSearchesPanelProps) {
  const [entries, setEntries] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!userEmail) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const params = new URLSearchParams({
      paginated: "1",
      userEmail,
      page: "1",
      pageSize: "5",
      sortBy: "timestamp",
      sortDir: "desc",
    });
    fetch(`/api/search-history?${params.toString()}`)
      .then(async (res) => {
        const body = await res.json();
        if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
        if (cancelled) return;
        setEntries(body.entries || []);
      })
      .catch((err) => console.error("Failed to load recent searches:", err))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [userEmail]);

  const recentPlans: string[] = [];
  for (const e of entries) {
    if (e.planName && !recentPlans.includes(e.planName)) recentPlans.push(e.planName);
    if (recentPlans.length >= 4) break;
  }

  const cardClass = `rounded-2xl border p-5 flex flex-col ${
    theme === "dark" ? "bg-white/[0.03] border-white/[0.08]" : "bg-white/60 border-stone-300"
  }`;

  const headerRow = (label: string, icon: ReactNode) => (
    <div className="flex items-center justify-between mb-3.5">
      <div className="flex items-center gap-2 select-none">
        <div
          className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
          style={{ backgroundColor: "var(--accent-subtle-bg)", color: "var(--accent)" }}
        >
          {icon}
        </div>
        <span className={`text-[12.5px] font-black uppercase tracking-wide ${theme === "dark" ? "text-white" : "text-stone-900"}`}>
          {label}
        </span>
      </div>
      <button
        type="button"
        onClick={onOpenActivity}
        className={`flex items-center gap-0.5 text-[10.5px] font-bold uppercase tracking-wide cursor-pointer transition-colors ${
          theme === "dark" ? "text-stone-400 hover:text-white" : "text-stone-500 hover:text-stone-800"
        }`}
      >
        View all
        <ArrowUpRight className="w-3 h-3" />
      </button>
    </div>
  );

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {/* RECENT DECLARATION SEARCHES */}
      <div className={cardClass}>
        {headerRow("Recent Declaration Searches", <Clock className="w-3.5 h-3.5" />)}

        {loading ? (
          <div className="space-y-2.5 animate-pulse">
            {[0, 1, 2].map((i) => (
              <div key={i} className={`h-9 rounded-lg ${theme === "dark" ? "bg-white/[0.04]" : "bg-stone-200/60"}`} />
            ))}
          </div>
        ) : entries.length === 0 ? (
          <div className={`flex-1 flex flex-col items-center justify-center text-center py-4 gap-1.5 ${theme === "dark" ? "text-stone-500" : "text-stone-500"}`}>
            <Search className="w-5 h-5 opacity-50" />
            <span className="text-[11.5px] font-medium">No searches yet — your recent lookups will show up here.</span>
          </div>
        ) : (
          <div className="flex flex-col divide-y divide-dashed" style={{ borderColor: theme === "dark" ? "rgba(255,255,255,0.08)" : "rgba(168,162,158,0.35)" }}>
            {entries.map((entry, idx) => (
              <button
                type="button"
                key={`${entry.timestamp}-${idx}`}
                onClick={onOpenActivity}
                className={`flex items-center justify-between gap-3 py-2.5 text-left cursor-pointer transition-colors rounded-lg -mx-1 px-1 ${
                  theme === "dark" ? "hover:bg-white/[0.03]" : "hover:bg-stone-100/60"
                }`}
                title="Open in My Activity"
              >
                <div className="min-w-0 flex-1">
                  <div className={`text-[12.5px] font-bold truncate ${theme === "dark" ? "text-white" : "text-stone-900"}`}>
                    {entry.pedInput}
                  </div>
                  <div className={`text-[10.5px] font-medium truncate ${theme === "dark" ? "text-stone-400" : "text-stone-500"}`}>
                    {entry.planName || "—"}
                  </div>
                </div>
                <span className={`text-[10px] font-semibold shrink-0 ${theme === "dark" ? "text-stone-500" : "text-stone-450"}`}>
                  {formatRelativeTime(entry.timestamp)}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* RECENTLY USED PLANS */}
      <div className={cardClass}>
        {headerRow("Recently Used Plans", <Layers className="w-3.5 h-3.5" />)}

        {loading ? (
          <div className="flex flex-wrap gap-2 animate-pulse">
            {[0, 1, 2].map((i) => (
              <div key={i} className={`h-8 w-28 rounded-lg ${theme === "dark" ? "bg-white/[0.04]" : "bg-stone-200/60"}`} />
            ))}
          </div>
        ) : recentPlans.length === 0 ? (
          <div className={`flex-1 flex flex-col items-center justify-center text-center py-4 gap-1.5 ${theme === "dark" ? "text-stone-500" : "text-stone-500"}`}>
            <Layers className="w-5 h-5 opacity-50" />
            <span className="text-[11.5px] font-medium">Plans you've looked up recently will appear here.</span>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2 content-start">
            {recentPlans.map((plan) => {
              const insurerColor = getPlanInsurerColor(plan);
              const hex = theme === "dark" ? insurerColor.dark : insurerColor.light;
              return (
                <button
                  type="button"
                  key={plan}
                  onClick={onOpenActivity}
                  className="flex items-center gap-2 px-3 py-2 rounded-lg border text-[11.5px] font-bold cursor-pointer transition-transform hover:-translate-y-0.5"
                  style={{
                    backgroundColor: `${hex}1A`,
                    borderColor: `${hex}4D`,
                    color: theme === "dark" ? "#F5F7FA" : "#1E293B",
                  }}
                  title={plan}
                >
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: hex }} />
                  <span className="truncate max-w-[160px]">{plan}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
