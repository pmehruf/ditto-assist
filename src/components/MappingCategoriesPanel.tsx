/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useState } from "react";
import { mappingFetch } from "../utils/mappingFetch";

/**
 * Mapping Control > Categories (Phase 3B-ii): the single category list the engine uses. Add, rename (the label — the
 * key is permanent because plans, PEDs and rules refer to it) and remove categories. A category that anything still
 * uses cannot be deleted; the server says exactly what uses it.
 */

interface Usage {
  peds: number;
  aliasOverrides: number;
  aliasFallbacks: number;
  planMappings: number;
  planOverrides: number;
  restrictions: number;
  rules: number;
  total: number;
}
interface Category {
  categoryKey: string;
  label: string;
  description: string | null;
  usage: Usage;
}

export function MappingCategoriesPanel({ theme, canManage }: { theme: "light" | "dark"; canManage: boolean }) {
  const dark = theme === "dark";
  const [cats, setCats] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [newKey, setNewKey] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [editKey, setEditKey] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState("");
  const [filter, setFilter] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/mapping-categories");
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      setCats(body.categories);
      setError(null);
    } catch (e: any) {
      setError(e.message || "Failed to load categories.");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const write = async (url: string, method: string, body: unknown, description: string) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await mappingFetch(url, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) }, description);
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setNotice(json.mappingChange ? `Saved and live. Change #${json.mappingChange.id} can be undone from History.` : "Saved and live.");
      await load();
      return true;
    } catch (e: any) {
      setError(e.message || "Failed.");
      return false;
    } finally {
      setBusy(false);
    }
  };

  const input = `rounded-lg border px-3 py-2 text-sm ${dark ? "bg-slate-900 border-slate-600 text-slate-100" : "bg-white border-slate-300 text-slate-900"}`;
  const btn = (primary = false) =>
    `px-3 py-1.5 rounded-lg text-xs font-bold disabled:opacity-40 disabled:cursor-not-allowed ${primary ? "bg-blue-600 text-white hover:bg-blue-700" : dark ? "bg-white/[0.06] hover:bg-white/[0.12] text-stone-200" : "bg-stone-100 hover:bg-stone-200 text-stone-700"}`;
  const muted = dark ? "text-stone-400" : "text-stone-500";
  const shown = cats.filter((c) => !filter.trim() || c.categoryKey.includes(filter.trim().toLowerCase()) || c.label.toLowerCase().includes(filter.trim().toLowerCase()));
  const usageText = (u: Usage) =>
    u.total === 0
      ? "Not used"
      : [u.peds && `${u.peds} PEDs`, u.aliasOverrides + u.aliasFallbacks && `${u.aliasOverrides + u.aliasFallbacks} alias settings`, u.planMappings && `${u.planMappings} plan questions`, u.planOverrides && `${u.planOverrides} plan-specific mappings`, u.restrictions && `${u.restrictions} restrictions`, u.rules && `${u.rules} rules`]
          .filter(Boolean)
          .join(", ");

  return (
    <div className="space-y-4 text-left">
      <div>
        <h2 className={`text-lg font-black ${dark ? "text-white" : "text-[#111827]"}`}>Categories</h2>
        <p className={`text-xs mt-1 font-semibold ${muted}`}>
          The one category list for the whole engine. A new category only routes something once it is assigned to PEDs and mapped to a plan question (Plans &amp; Questions).{!canManage && " Read-only — you don't have permission to make changes."}
        </p>
      </div>
      {(error || notice) && <div className={`rounded-lg p-3 text-sm ${error ? (dark ? "bg-red-900/30 text-red-200" : "bg-red-50 text-red-800") : dark ? "bg-emerald-900/30 text-emerald-200" : "bg-emerald-50 text-emerald-800"}`}>{error ?? notice}</div>}

      {canManage && (
        <div className="flex flex-col md:flex-row gap-2">
          <input className={input} placeholder="key (e.g. sleep_disorders)" value={newKey} onChange={(e) => setNewKey(e.target.value)} />
          <input className={`${input} flex-1`} placeholder="Label shown to admins" value={newLabel} onChange={(e) => setNewLabel(e.target.value)} />
          <button
            className={btn(true)}
            disabled={busy || !newKey.trim() || !newLabel.trim()}
            onClick={async () => {
              if (await write("/api/mapping-categories", "POST", { categoryKey: newKey.trim(), label: newLabel.trim() }, `Added category ${newKey.trim()}`)) {
                setNewKey("");
                setNewLabel("");
              }
            }}
          >
            Add category
          </button>
        </div>
      )}
      <input className={`${input} max-w-xs`} placeholder="Filter…" value={filter} onChange={(e) => setFilter(e.target.value)} />

      {loading ? (
        <p className={muted}>Loading…</p>
      ) : (
        <ul className={`rounded-xl border divide-y ${dark ? "border-white/[0.08] divide-white/[0.06]" : "border-stone-200 divide-stone-100"}`}>
          {shown.map((c) => (
            <li key={c.categoryKey} className="p-3 flex flex-wrap items-center gap-2">
              <code className="text-xs w-48 shrink-0 break-all">{c.categoryKey}</code>
              {editKey === c.categoryKey ? (
                <input className={`${input} flex-1`} value={editLabel} onChange={(e) => setEditLabel(e.target.value)} />
              ) : (
                <span className="flex-1 min-w-[10rem] text-sm font-semibold">{c.label}</span>
              )}
              <span className={`text-[11px] ${muted} w-full md:w-72`}>{usageText(c.usage)}</span>
              {canManage && (
                <div className="flex gap-1">
                  {editKey === c.categoryKey ? (
                    <>
                      <button
                        className={btn(true)}
                        disabled={busy || !editLabel.trim()}
                        onClick={async () => {
                          if (await write(`/api/mapping-categories/${encodeURIComponent(c.categoryKey)}`, "PATCH", { label: editLabel }, `Renamed category ${c.categoryKey}`)) setEditKey(null);
                        }}
                      >
                        Save
                      </button>
                      <button className={btn()} onClick={() => setEditKey(null)}>
                        Cancel
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        className={btn()}
                        onClick={() => {
                          setEditKey(c.categoryKey);
                          setEditLabel(c.label);
                        }}
                      >
                        Rename
                      </button>
                      <button className={btn()} disabled={busy || c.usage.total > 0} title={c.usage.total > 0 ? "Still in use — move what uses it first" : "Delete this category"} onClick={() => write(`/api/mapping-categories/${encodeURIComponent(c.categoryKey)}`, "DELETE", undefined, `Deleted category ${c.categoryKey}`)}>
                        Delete
                      </button>
                    </>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
