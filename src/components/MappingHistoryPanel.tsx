/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useState } from "react";
import { changeStatusLabel, changeTypeLabel } from "../utils/mappingTerms";

/**
 * Mapping Control > History: every admin mapping change (who, what, why, how much it affected) with Undo.
 * Undo restores the exact rows and is refused — never forced — if they have been changed since.
 */

interface Entry {
  id: number;
  kind: string;
  summary: string;
  status: string;
  performedBy: string;
  performedAt: string;
  reason: string | null;
  changeCategory: string | null;
  impactTier: string | null;
  undoneBy: string | null;
  undoNote: string | null;
}

export function MappingHistoryPanel({ theme, canManage }: { theme: "light" | "dark"; canManage: boolean }) {
  const dark = theme === "dark";
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/mapping-changes");
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      setEntries(body.entries);
      setError(null);
    } catch (e: any) {
      setError(e.message || "Failed to load history.");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const undo = async (id: number) => {
    setBusy(id);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/mapping-changes/${id}/undo`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      if (body.reverted) setNotice(`Change #${id} was undone and is live.`);
      else setError(body.reason || "That change could not be undone.");
      await load();
    } catch (e: any) {
      setError(e.message || "Undo failed.");
    } finally {
      setBusy(null);
    }
  };

  const muted = dark ? "text-stone-400" : "text-stone-500";
  const tierClass = (t: string | null) => (t === "high" ? "bg-red-500/20" : t === "elevated" ? "bg-amber-500/20" : "bg-stone-500/20");

  return (
    <div className="space-y-4 text-left">
      <div>
        <h2 className={`text-lg font-black ${dark ? "text-white" : "text-[#111827]"}`}>Change history</h2>
        <p className={`text-xs mt-1 font-semibold ${muted}`}>The 50 most recent changes to conditions, plans, categories and decision steps.{!canManage && " Read-only — you can't undo changes."}</p>
      </div>
      {(error || notice) && <div className={`rounded-lg p-3 text-sm ${error ? (dark ? "bg-red-900/30 text-red-200" : "bg-red-50 text-red-800") : dark ? "bg-emerald-900/30 text-emerald-200" : "bg-emerald-50 text-emerald-800"}`}>{error ?? notice}</div>}
      {loading ? (
        <p className={muted}>Loading…</p>
      ) : entries.length === 0 ? (
        <p className={muted}>No changes recorded yet.</p>
      ) : (
        <ul className={`rounded-xl border divide-y ${dark ? "border-white/[0.08] divide-white/[0.06]" : "border-stone-200 divide-stone-100"}`}>
          {entries.map((e) => (
            <li key={e.id} className="p-3 flex flex-wrap items-start gap-3">
              <span className={`text-xs font-mono w-12 ${muted}`}>#{e.id}</span>
              <div className="flex-1 min-w-[14rem]">
                <div className="text-sm font-semibold">
                  {e.summary}{" "}
                  {e.impactTier && <span className={`text-[10px] px-1.5 py-0.5 rounded ${tierClass(e.impactTier)}`}>{e.impactTier === "high" ? "High" : e.impactTier === "elevated" ? "Elevated" : e.impactTier === "low" ? "Low" : e.impactTier} impact</span>}{" "}
                  {e.status !== "applied" && <span className="text-[10px] px-1.5 py-0.5 rounded bg-stone-500/20">{changeStatusLabel(e.status)}</span>}
                </div>
                <div className={`text-xs ${muted}`}>
                  {e.performedBy} · {new Date(e.performedAt).toLocaleString()}
                  {e.changeCategory ? ` · ${changeTypeLabel(e.changeCategory)}` : ""}
                </div>
                {e.reason && <div className="text-xs mt-0.5">“{e.reason}”</div>}
                {e.status === "undone" && <div className={`text-xs ${muted}`}>Undone by {e.undoneBy}{e.undoNote ? ` — ${e.undoNote}` : ""}</div>}
              </div>
              {canManage && e.status === "applied" && (
                <button className={`px-3 py-1.5 rounded-lg text-xs font-bold disabled:opacity-40 ${dark ? "bg-white/[0.06] hover:bg-white/[0.12]" : "bg-stone-100 hover:bg-stone-200"}`} disabled={busy === e.id} onClick={() => undo(e.id)}>
                  {busy === e.id ? "Undoing…" : "Undo"}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
