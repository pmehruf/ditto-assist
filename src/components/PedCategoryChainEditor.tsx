/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef, useState } from "react";
import { mappingFetch, type MappingSavePhase } from "../utils/mappingFetch";

/**
 * Mapping Control > PED Library > a PED > "Which category should be used?" (Phase 4 / R11).
 *
 * Plain-language editor for a PED's Primary category and its ordered Fallback categories:
 *   Primary: Sleep Disorder
 *   Fallback 1: Respiratory
 * "The Primary category is used first. If the selected plan has no declaration question for it, the system tries the next
 * fallback." Saving goes through the same impact check / confirmation / undo as every other mapping change, shows real
 * progress, updates this screen from the server's answer immediately, and can be undone on the spot.
 */

export interface ChainCategory {
  categoryKey: string;
  label: string;
}

/** What the server returns for a PED after a save (only the fields this screen needs). */
export interface SavedPed {
  id: number;
  categoryKey: string | null;
  categoryChain?: string[] | null;
}

interface Banner {
  kind: "success" | "error" | "undone";
  text: string;
  changeId?: number;
}

const PHASE_TEXT: Record<MappingSavePhase, string> = {
  checking: "Checking which lookups this will affect…",
  confirming: "Waiting for your confirmation…",
  saving: "Saving…",
};

export function PedCategoryChainEditor({
  pedId,
  pedName,
  primary,
  chain,
  categories,
  canManage,
  dark,
  onChanged,
}: {
  pedId: number;
  pedName: string;
  primary: string | null;
  chain: string[] | null | undefined;
  categories: ChainCategory[];
  canManage: boolean;
  dark: boolean;
  /** Called with the server's saved PED so the table updates at once, and again so the page can re-read the list. */
  onChanged: (saved?: SavedPed) => void | Promise<void>;
}) {
  const savedFallbacks = chain ?? [];
  const [draftPrimary, setDraftPrimary] = useState<string>(primary ?? "");
  const [draftFallbacks, setDraftFallbacks] = useState<string[]>(savedFallbacks);
  const [phase, setPhase] = useState<MappingSavePhase | null>(null);
  const [undoing, setUndoing] = useState(false);
  const [banner, setBanner] = useState<Banner | null>(null);
  const [mode, setMode] = useState("db");
  const [cats, setCats] = useState<ChainCategory[]>(categories);
  const submitting = useRef(false);

  // Always show the current category list: re-read it whenever this panel opens, so a category created a moment ago is there.
  useEffect(() => {
    let live = true;
    fetch("/api/ped-repository/categories")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (live && Array.isArray(j?.entries)) setCats(j.entries.map((c: any) => ({ categoryKey: c.categoryKey, label: c.label })).sort((a: ChainCategory, b: ChainCategory) => a.label.localeCompare(b.label)));
      })
      .catch(() => undefined);
    fetch("/api/mapping-engine")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => live && setMode(j?.mode ?? "unknown"))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [pedId]);

  // The saved configuration is whatever the page was last told by the server; the editor follows it.
  const savedKey = JSON.stringify([primary ?? "", savedFallbacks]);
  useEffect(() => {
    setDraftPrimary(primary ?? "");
    setDraftFallbacks(chain ?? []);
  }, [pedId, savedKey]);

  const label = (key: string | null | undefined) => (key ? cats.find((c) => c.categoryKey === key)?.label || categories.find((c) => c.categoryKey === key)?.label || key.replace(/_/g, " ") : "none");
  const describe = (p: string | null, f: string[]) => [`Primary: ${label(p)}`, ...f.map((k, i) => `Fallback ${i + 1}: ${label(k)}`)];

  const busy = phase !== null || undoing;
  const changed = draftPrimary !== (primary ?? "") || JSON.stringify(draftFallbacks) !== JSON.stringify(savedFallbacks);
  const all = [draftPrimary, ...draftFallbacks];
  const problem = !draftPrimary
    ? draftFallbacks.length > 0
      ? "Choose a Primary category first."
      : null
    : draftFallbacks.some((k) => !k)
      ? "Choose a category for every fallback, or remove the empty one."
      : new Set(all.filter(Boolean)).size !== all.filter(Boolean).length
        ? "A category can only be used once for this PED."
        : null;

  const muted = dark ? "text-stone-400" : "text-stone-500";
  const btn = `px-2.5 py-1 rounded-md text-[11px] font-bold disabled:opacity-40 disabled:cursor-not-allowed ${dark ? "bg-white/[0.06] hover:bg-white/[0.12] text-stone-200" : "bg-stone-200 hover:bg-stone-300 text-stone-700"}`;
  const select = `rounded-md border px-2 py-1 text-[11.5px] min-w-[13rem] ${dark ? "bg-slate-900 border-slate-600 text-slate-100" : "bg-white border-slate-300 text-slate-900"} disabled:opacity-60`;
  const options = (exclude: string[]) => cats.filter((c) => !exclude.includes(c.categoryKey));

  const move = (i: number, d: -1 | 1) => {
    const next = [...draftFallbacks];
    const j = i + d;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    setDraftFallbacks(next);
  };

  const save = async () => {
    if (submitting.current || !changed || problem) return; // one request at a time: ignores double clicks
    submitting.current = true;
    setBanner(null);
    setPhase("checking");
    try {
      const body: Record<string, unknown> = { categoryChain: draftFallbacks };
      if (draftPrimary !== (primary ?? "")) body.categoryKey = draftPrimary || null;
      const res = await mappingFetch(`/api/ped-repository/${pedId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }, `Changed the categories used for "${pedName}"`, { onPhase: setPhase });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `The change could not be saved (HTTP ${res.status}). Nothing was changed.`);
      const saved: SavedPed = { id: pedId, categoryKey: json.ped?.categoryKey ?? (draftPrimary || null), categoryChain: json.ped ? (json.ped.categoryChain ?? null) : draftFallbacks.length ? draftFallbacks : null };
      // Show the saved result right now, from the server's own answer — no waiting for a reload.
      const fallbacks = saved.categoryChain ?? [];
      setDraftPrimary(saved.categoryKey ?? "");
      setDraftFallbacks(fallbacks);
      setBanner({ kind: "success", text: `Saved — live for every advisor now. ${describe(saved.categoryKey, fallbacks).join(" · ")}`, changeId: json.mappingChange?.id });
      await onChanged(saved);
    } catch (e: any) {
      setBanner({ kind: "error", text: `${e.message || "The change could not be saved."} Your saved setup is unchanged.` });
    } finally {
      setPhase(null);
      submitting.current = false;
    }
  };

  const undo = async (changeId: number) => {
    if (submitting.current) return;
    submitting.current = true;
    setUndoing(true);
    try {
      const res = await fetch(`/api/mapping-changes/${changeId}/undo`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.reverted) throw new Error(json.reason || json.error || "That change could not be undone.");
      setBanner({ kind: "undone", text: "Undone — the previous setup is live again." });
      await onChanged(); // page re-reads the list; this screen follows it
    } catch (e: any) {
      setBanner({ kind: "error", text: `${e.message} The current setup is unchanged.` });
    } finally {
      setUndoing(false);
      submitting.current = false;
    }
  };

  return (
    <div className={`rounded-lg border px-3 py-2.5 space-y-2 ${dark ? "border-stone-850 bg-white/[0.02]" : "border-stone-200 bg-white"}`}>
      <div>
        <p className={`text-[10px] font-black uppercase tracking-wider ${muted}`}>Which category should be used?</p>
        <p className={`text-[11px] leading-snug mt-0.5 ${muted}`}>The Primary category is used first. If the selected plan has no declaration question for it, the system tries the next fallback.</p>
      </div>

      <div className={`rounded-md px-2.5 py-1.5 text-[11.5px] ${dark ? "bg-black/20" : "bg-stone-100"}`} aria-live="polite">
        <span className={`font-bold ${muted}`}>Currently saved: </span>
        {primary ? <span className="font-semibold">{describe(primary, savedFallbacks).join("  →  ")}</span> : <span className={muted}>no category yet</span>}
        {primary && savedFallbacks.length === 0 && <span className={muted}> (no fallback)</span>}
      </div>

      {primary || canManage ? (
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="w-20 text-[11.5px] font-bold">Primary</span>
            <select className={select} value={draftPrimary} disabled={!canManage || busy} onChange={(e) => setDraftPrimary(e.target.value)} aria-label="Primary category">
              <option value="">Choose a category…</option>
              {options(draftFallbacks).map((c) => (
                <option key={c.categoryKey} value={c.categoryKey}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>
          {draftFallbacks.map((key, i) => (
            <div key={`${i}-${key}`} className="flex flex-wrap items-center gap-2">
              <span className="w-20 text-[11.5px] font-bold">Fallback {i + 1}</span>
              <select
                className={select}
                value={key}
                disabled={!canManage || busy}
                onChange={(e) => setDraftFallbacks(draftFallbacks.map((k, j) => (j === i ? e.target.value : k)))}
                aria-label={`Fallback ${i + 1} category`}
              >
                <option value="">Choose a category…</option>
                {options([draftPrimary, ...draftFallbacks.filter((_, j) => j !== i)]).map((c) => (
                  <option key={c.categoryKey} value={c.categoryKey}>
                    {c.label}
                  </option>
                ))}
              </select>
              {canManage && (
                <span className="flex gap-1">
                  <button className={btn} disabled={busy || i === 0} onClick={() => move(i, -1)} title="Move earlier (try this one sooner)">
                    ↑ Earlier
                  </button>
                  <button className={btn} disabled={busy || i === draftFallbacks.length - 1} onClick={() => move(i, 1)} title="Move later (try this one after the others)">
                    ↓ Later
                  </button>
                  <button className={btn} disabled={busy} onClick={() => setDraftFallbacks(draftFallbacks.filter((_, j) => j !== i))}>
                    Remove
                  </button>
                </span>
              )}
            </div>
          ))}
          {canManage && (
            <div className="flex flex-wrap items-center gap-2 pt-0.5">
              <button className={btn} disabled={busy || mode !== "db" || !draftPrimary || draftFallbacks.length >= 5 || draftFallbacks.includes("")} onClick={() => setDraftFallbacks([...draftFallbacks, ""])}>
                + Add a fallback category
              </button>
              {!draftPrimary && <span className={`text-[10.5px] ${muted}`}>Choose a Primary category first.</span>}
              {mode !== "db" && <span className={`text-[10.5px] ${muted}`}>Fallback categories are not available in this environment.</span>}
            </div>
          )}
          <p className={`text-[10.5px] ${muted}`}>Example — Sleep Apnea: Primary “Sleep Disorder”, Fallback 1 “Respiratory”. Only one category is ever used, so there is still one declaration. A plan-specific mapping for this PED always comes first.</p>
        </div>
      ) : (
        <p className={`text-[11px] ${muted}`}>This PED has no category yet.</p>
      )}

      {canManage && (changed || phase) && (
        <div className="flex flex-wrap items-center gap-2" aria-live="polite">
          {changed && !phase && <span className="text-[11px] font-bold text-amber-400">● Not saved yet</span>}
          <button className={`${btn} !bg-blue-600 !text-white hover:!bg-blue-700`} disabled={busy || !changed || !!problem} onClick={save}>
            {phase ? PHASE_TEXT[phase] : "Save changes"}
          </button>
          {phase && <span className="inline-block w-3.5 h-3.5 rounded-full border-2 border-blue-400 border-t-transparent animate-spin" role="status" aria-label={PHASE_TEXT[phase]} />}
          <button
            className={btn}
            disabled={busy || !changed}
            onClick={() => {
              setDraftPrimary(primary ?? "");
              setDraftFallbacks(savedFallbacks);
            }}
          >
            Discard changes
          </button>
          {problem && !phase && <span className="text-[11px] font-semibold text-red-400">{problem}</span>}
        </div>
      )}

      {banner && (
        <div
          role={banner.kind === "error" ? "alert" : "status"}
          className={`flex flex-wrap items-center gap-2 rounded-md px-2.5 py-1.5 text-[11.5px] font-semibold ${banner.kind === "error" ? "bg-red-500/10 text-red-400" : "bg-emerald-500/10 text-emerald-400"}`}
        >
          <span className="flex-1 min-w-[12rem]">{banner.text}</span>
          {banner.kind === "success" && banner.changeId && canManage && (
            <button className={btn} disabled={busy} onClick={() => undo(banner.changeId!)}>
              {undoing ? "Undoing…" : "Undo this change"}
            </button>
          )}
          <button className={btn} onClick={() => setBanner(null)} aria-label="Dismiss">
            ✕
          </button>
        </div>
      )}
    </div>
  );
}
