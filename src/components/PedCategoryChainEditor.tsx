/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from "react";
import { mappingFetch } from "../utils/mappingFetch";

/**
 * Mapping Control > PED Library > a PED > "Category fallback order" (Phase 4 / R11).
 *
 * A PED keeps its primary category; this edits the ORDERED fallbacks after it. When the selected plan has no real
 * question for the primary category, the next category is tried, and so on — the first one the plan has a real question
 * for is used, and only that one. Saving goes through the same impact preview / confirmation / undo as every other
 * mapping change.
 */

let engineModeCache: Promise<string> | null = null;
const engineMode = (): Promise<string> => (engineModeCache ??= fetch("/api/mapping-engine").then((r) => (r.ok ? r.json() : null)).then((j) => j?.mode ?? "unknown").catch(() => "unknown"));

export interface ChainCategory {
  categoryKey: string;
  label: string;
}

export function PedCategoryChainEditor({
  pedId,
  pedName,
  primary,
  chain,
  categories,
  canManage,
  dark,
  onSaved,
}: {
  pedId: number;
  pedName: string;
  primary: string | null;
  chain: string[] | null | undefined;
  categories: ChainCategory[];
  canManage: boolean;
  dark: boolean;
  onSaved: () => void | Promise<void>;
}) {
  const saved = chain ?? [];
  const [draft, setDraft] = useState<string[]>(saved);
  const [pick, setPick] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [mode, setMode] = useState("db");

  useEffect(() => {
    setDraft(chain ?? []);
  }, [pedId, JSON.stringify(chain ?? [])]);
  useEffect(() => {
    void engineMode().then(setMode);
  }, []);

  const label = (key: string) => categories.find((c) => c.categoryKey === key)?.label || key;
  const changed = JSON.stringify(draft) !== JSON.stringify(saved);
  const available = categories.filter((c) => c.categoryKey !== primary && !draft.includes(c.categoryKey));
  const muted = dark ? "text-stone-400" : "text-stone-500";
  const btn = `px-2 py-1 rounded-md text-[10.5px] font-bold disabled:opacity-40 disabled:cursor-not-allowed ${dark ? "bg-white/[0.06] hover:bg-white/[0.12] text-stone-200" : "bg-stone-200 hover:bg-stone-300 text-stone-700"}`;

  const move = (i: number, d: -1 | 1) => {
    const next = [...draft];
    const j = i + d;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    setDraft(next);
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await mappingFetch(`/api/ped-repository/${pedId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ categoryChain: draft }) }, `Changed the fallback categories of "${pedName}"`);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Failed to save (HTTP ${res.status}).`);
      setNotice(body.mappingChange ? `Saved and live. Change #${body.mappingChange.id} can be undone from History.` : "Saved and live.");
      await onSaved();
    } catch (e: any) {
      setError(e.message || "Failed to save.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`rounded-lg border px-2.5 py-2 space-y-1.5 ${dark ? "border-stone-850 bg-white/[0.02]" : "border-stone-200 bg-white"}`}>
      <p className={`text-[10px] font-black uppercase tracking-wider ${muted}`}>Category fallback order</p>
      <p className={`text-[10.5px] leading-snug ${muted}`}>
        If a plan has no question for this PED's first category, the next one is tried, and so on. The first category the plan has a real question for is used — only that one, so there is still just one declaration. Plan-specific mappings for this PED
        always win over this list.
      </p>
      {!primary ? (
        <p className={`text-[11px] font-semibold ${muted}`}>Give this PED a primary category first.</p>
      ) : (
        <>
          <ol className="space-y-1">
            <li className="flex items-center gap-2 text-[11.5px] font-semibold">
              <span className={`w-5 text-center ${muted}`}>1</span>
              <span className="flex-1">{label(primary)}</span>
              <span className={`text-[10px] ${muted}`}>primary</span>
            </li>
            {draft.map((key, i) => (
              <li key={key} className="flex items-center gap-2 text-[11.5px] font-semibold">
                <span className={`w-5 text-center ${muted}`}>{i + 2}</span>
                <span className="flex-1">{label(key)}</span>
                {canManage && (
                  <span className="flex gap-1">
                    <button className={btn} disabled={busy || i === 0} onClick={() => move(i, -1)} title="Try earlier">
                      ↑
                    </button>
                    <button className={btn} disabled={busy || i === draft.length - 1} onClick={() => move(i, 1)} title="Try later">
                      ↓
                    </button>
                    <button className={btn} disabled={busy} onClick={() => setDraft(draft.filter((k) => k !== key))} title="Remove from the list">
                      ✕
                    </button>
                  </span>
                )}
              </li>
            ))}
          </ol>
          {draft.length === 0 && <p className={`text-[11px] ${muted}`}>No fallback categories: this PED uses its primary category only.</p>}
          {canManage && (
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <select
                className={`rounded-md border px-2 py-1 text-[11px] ${dark ? "bg-slate-900 border-slate-600 text-slate-100" : "bg-white border-slate-300 text-slate-900"}`}
                value={pick}
                onChange={(e) => setPick(e.target.value)}
                disabled={mode !== "db" || busy}
              >
                <option value="">Add a fallback category…</option>
                {available.map((c) => (
                  <option key={c.categoryKey} value={c.categoryKey}>
                    {c.label}
                  </option>
                ))}
              </select>
              <button
                className={btn}
                disabled={!pick || busy || mode !== "db"}
                onClick={() => {
                  setDraft([...draft, pick]);
                  setPick("");
                }}
              >
                Add
              </button>
              {changed && (
                <>
                  <button className={`${btn} !bg-blue-600 !text-white hover:!bg-blue-700`} disabled={busy} onClick={save}>
                    Preview &amp; save
                  </button>
                  <button className={btn} disabled={busy} onClick={() => setDraft(saved)}>
                    Reset
                  </button>
                </>
              )}
            </div>
          )}
          {mode !== "db" && <p className={`text-[10.5px] ${muted}`}>Fallback categories only take effect with the database-backed engine, which is not active here.</p>}
        </>
      )}
      {error && <p className="text-[11px] font-semibold text-red-400">{error}</p>}
      {notice && <p className="text-[11px] font-semibold text-emerald-400">{notice}</p>}
    </div>
  );
}
