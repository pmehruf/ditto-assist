/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useState } from "react";
import { Plus, Trash2, Pencil, X, Check, Power, PowerOff } from "lucide-react";
import type { PlanRestriction } from "../types.js";
import { useCategoryLabels, useLiveCategories } from "../utils/categoryLabels";
import { ClippedButton } from "./ClippedButton";
import { CustomSelect } from "./CustomSelect";
import { useDialog } from "../hooks/useDialog";
import { mappingFetch } from "../utils/mappingFetch";

/** Live DB row shape, as returned by GET /api/plan-restrictions/:planName —
 * PlanRestriction (types.ts) plus the id/audit fields the CRUD UI needs. */
export interface PlanRestrictionRowEntry extends PlanRestriction {
  id: number;
  planName: string;
  createdBy: string;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
}

const MODE_OPTIONS = [
  { value: "require_keywords", label: "Only accept conditions that mention a keyword — all others go to the plan's “any other condition” question" },
  { value: "exclude_keywords", label: "Do not accept conditions that mention a keyword — they go to the plan's “any other condition” question" },
  { value: "block_category", label: "Do not accept this category at all — every condition in it goes to the plan's “any other condition” question" },
] as const;

function modeLabel(mode: string): string {
  return MODE_OPTIONS.find((m) => m.value === mode)?.label.split(" — ")[0] || mode;
}

interface DraftState {
  id: number | null; // null = creating a new one
  categoryKey: string;
  mode: "require_keywords" | "exclude_keywords" | "block_category";
  keywordsText: string; // comma-separated, edited as free text
  explanation: string;
}

const emptyDraft = (): DraftState => ({ id: null, categoryKey: "", mode: "require_keywords", keywordsText: "", explanation: "" });

interface PlanRestrictionsEditorProps {
  theme: "light" | "dark";
  /** The plan these restrictions belong to. Restrictions live in their own
   * `plan_restrictions` table keyed by plan name text (not a foreign key to
   * plan_configs.id), so this works for a plan that's still 100% on the
   * hardcoded getPlanConfig() bootstrap seed too — not just DB-authored
   * ones. Empty/undefined means the plan hasn't been saved yet (a brand-new
   * plan in the Add wizard), in which case restrictions can't be created
   * until a save gives it a stable name. */
  planName: string | undefined;
  /** Read-only viewers still see the list, just not the edit controls —
   * mirrors SpecificIllnessLedger's canEdit prop. */
  canEdit: boolean;
  /** "view" shows a compact read-only summary of active restrictions only
   * (matches the old checkbox block's view-mode list this replaces).
   * "edit" shows the full CRUD list + add/edit forms. */
  mode: "view" | "edit";
}

/**
 * Plan-Specific Restrictions editor (2026-08) — the live database/UI-
 * controlled replacement for the old 3-checkbox `PlanOverrides` block this
 * component was swapped in for (see PlanManagementPage.tsx's Add/Edit Plan
 * form). Talks directly to /api/plan-restrictions/:planName's own CRUD
 * routes (server.ts) rather than being bundled into the plan's own
 * save/PUT flow — a restriction takes effect immediately on
 * create/edit/delete/toggle, same as the Add/Edit Plan wizard is a separate
 * concern from this. See the routing engine's restriction handling /
 * isCategoryRestrictedForPed for how these rows are evaluated by the
 * Declaration Assistant at match time — deterministic keyword logic, no AI
 * involved anywhere.
 */
export function PlanRestrictionsEditor({ theme, planName, canEdit, mode }: PlanRestrictionsEditorProps) {
  const dark = theme === "dark";
  const { confirm } = useDialog();
  const categoryLabel = useCategoryLabels();
  const { labels: liveCategories } = useLiveCategories();
  const categoryOptions = Object.entries(liveCategories).map(([value, label]) => ({ value, label }));
  const [entries, setEntries] = useState<PlanRestrictionRowEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [draft, setDraft] = useState<DraftState | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const load = async () => {
    if (!planName) {
      setEntries([]);
      return;
    }
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch(`/api/plan-restrictions/${encodeURIComponent(planName)}`);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Failed to load restrictions (HTTP ${res.status}).`);
      setEntries(body.entries || []);
    } catch (err: unknown) {
      setLoadError(err instanceof Error ? err.message : "Could not load restrictions.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    setDraft(null);
    setSaveError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planName]);

  const inputClass = `w-full px-2.5 py-2 rounded-lg text-xs font-medium outline-none transition-colors ${
    dark ? "bg-white/[0.03] border border-white/[0.08] text-white placeholder:text-stone-500 focus:border-blue-400/40" : "bg-white border border-stone-200 text-stone-900 placeholder:text-stone-400 focus:border-blue-400"
  }`;

  const startCreate = () => {
    setSaveError(null);
    setDraft(emptyDraft());
  };
  const startEdit = (entry: PlanRestrictionRowEntry) => {
    setSaveError(null);
    setDraft({
      id: entry.id,
      categoryKey: entry.categoryKey,
      mode: entry.mode,
      keywordsText: (entry.keywords || []).join(", "),
      explanation: entry.explanation,
    });
  };
  const cancelDraft = () => {
    setDraft(null);
    setSaveError(null);
  };

  const saveDraft = async () => {
    if (!planName || !draft) return;
    const categoryKey = draft.categoryKey.trim();
    const explanation = draft.explanation.trim();
    const keywords = draft.keywordsText.split(",").map((k) => k.trim()).filter(Boolean);
    if (!categoryKey) return setSaveError("Choose a category.");
    if (!explanation) return setSaveError("An explanation is required — it is what the advisor reads when a condition is sent to the “any other condition” question.");
    if (draft.mode !== "block_category" && keywords.length === 0) {
      return setSaveError("At least one keyword is required for this mode.");
    }

    setSaving(true);
    setSaveError(null);
    try {
      const isCreate = draft.id === null;
      const url = isCreate ? `/api/plan-restrictions/${encodeURIComponent(planName)}` : `/api/plan-restrictions/${draft.id}`;
      const res = await mappingFetch(url, {
        method: isCreate ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ categoryKey, mode: draft.mode, keywords, explanation }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Failed to save (HTTP ${res.status}).`);
      await load();
      setDraft(null);
    } catch (err: unknown) {
      setSaveError(err instanceof Error ? err.message : "Failed to save this restriction.");
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (entry: PlanRestrictionRowEntry) => {
    setSaveError(null);
    try {
      const res = await mappingFetch(`/api/plan-restrictions/${entry.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !entry.isActive }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Failed to update (HTTP ${res.status}).`);
      await load();
    } catch (err: unknown) {
      setSaveError(err instanceof Error ? err.message : "Failed to toggle this restriction.");
    }
  };

  const deleteEntry = async (entry: PlanRestrictionRowEntry) => {
    if (!(await confirm(`Delete the restriction on the "${entry.categoryKey}" category on ${entry.planName}? This can't be undone.`))) return;
    setSaveError(null);
    try {
      const res = await mappingFetch(`/api/plan-restrictions/${entry.id}`, { method: "DELETE" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Failed to delete (HTTP ${res.status}).`);
      await load();
    } catch (err: unknown) {
      setSaveError(err instanceof Error ? err.message : "Failed to delete this restriction.");
    }
  };

  // ── VIEW MODE — compact read-only summary, mirrors the old checkbox
  // block's view state exactly (same card styling, same "None" fallback). ──
  if (mode === "view") {
    const active = entries.filter((e) => e.isActive);
    if (!planName) return <p className={`text-xs font-semibold px-2 py-2 ${dark ? "text-stone-400" : "text-stone-500"}`}>—</p>;
    if (loading) return <p className={`text-xs font-semibold px-2 py-2 ${dark ? "text-stone-400" : "text-stone-500"}`}>Loading…</p>;
    if (active.length === 0) {
      return <p className={`text-xs font-semibold px-2 py-2 ${dark ? "text-stone-400" : "text-stone-500"}`}>None — this plan's questions apply exactly as written above.</p>;
    }
    return (
      <ul className="space-y-1">
        {active.map((e) => (
          <li key={e.id} className={`text-xs px-2 py-1.5 rounded-lg border ${dark ? "bg-white/[0.015] border-white/[0.05] text-stone-200" : "bg-stone-50 border-stone-150 text-stone-800"}`}>
            <span className="font-bold">{categoryLabel(e.categoryKey)}</span>: {e.explanation}
          </li>
        ))}
      </ul>
    );
  }

  // ── EDIT MODE — full CRUD list + add/edit form. ──
  if (!planName) {
    return <p className={`text-xs font-semibold px-2 py-2 ${dark ? "text-stone-400" : "text-stone-500"}`}>Save this plan first, then add restrictions.</p>;
  }

  return (
    <div className="space-y-2">
      {loadError && <p className="text-xs font-semibold text-rose-400">{loadError}</p>}
      {loading && entries.length === 0 && <p className={`text-xs ${dark ? "text-stone-400" : "text-stone-500"}`}>Loading…</p>}

      {entries.length > 0 && (
        <ul className="space-y-1.5">
          {entries.map((e) => (
            <li
              key={e.id}
              className={`flex items-start gap-2 p-2 rounded-lg border text-xs ${
                e.isActive
                  ? dark ? "bg-white/[0.015] border-white/[0.05] text-stone-200" : "bg-stone-50 border-stone-150 text-stone-800"
                  : dark ? "bg-white/[0.01] border-white/[0.04] text-stone-500 opacity-60" : "bg-stone-50/50 border-stone-100 text-stone-400 opacity-70"
              }`}
            >
              <div className="flex-1 min-w-0">
                <div className="font-bold">
                  {categoryLabel(e.categoryKey)}
                  <span className="font-normal opacity-70"> — {modeLabel(e.mode)}</span>
                  {!e.isActive && <span className="ml-1.5 text-[10px] uppercase tracking-wide font-bold text-amber-500">Disabled</span>}
                </div>
                {e.keywords.length > 0 && <div className="mt-0.5 opacity-80">Keywords: {e.keywords.join(", ")}</div>}
                <div className="mt-0.5 opacity-80">{e.explanation}</div>
              </div>
              {canEdit && (
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={() => toggleActive(e)}
                    title={e.isActive ? "Disable" : "Enable"}
                    className={`p-1 rounded cursor-pointer ${dark ? "hover:bg-white/10 text-stone-300" : "hover:bg-stone-200 text-stone-600"}`}
                  >
                    {e.isActive ? <PowerOff className="w-3.5 h-3.5" /> : <Power className="w-3.5 h-3.5" />}
                  </button>
                  <button
                    type="button"
                    onClick={() => startEdit(e)}
                    title="Edit"
                    className={`p-1 rounded cursor-pointer ${dark ? "hover:bg-white/10 text-stone-300" : "hover:bg-stone-200 text-stone-600"}`}
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => deleteEntry(e)}
                    title="Delete"
                    className="p-1 rounded cursor-pointer hover:bg-rose-500/15 text-rose-400"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {canEdit && draft && (
        <div className={`p-2.5 rounded-lg border space-y-2 ${dark ? "bg-white/[0.02] border-white/[0.08]" : "bg-stone-50 border-stone-200"}`}>
          <CustomSelect
            theme={theme}
            value={draft.categoryKey}
            onChange={(v) => setDraft((d) => (d ? { ...d, categoryKey: v } : d))}
            options={categoryOptions}
            placeholder="Which category does this apply to?"
          />
          <CustomSelect
            theme={theme}
            value={draft.mode}
            onChange={(v) => setDraft((d) => (d ? { ...d, mode: v as DraftState["mode"] } : d))}
            options={MODE_OPTIONS.map((m) => ({ value: m.value, label: m.label }))}
          />
          {draft.mode !== "block_category" && (
            <input
              value={draft.keywordsText}
              onChange={(e) => setDraft((d) => (d ? { ...d, keywordsText: e.target.value } : d))}
              placeholder="Keywords, separated by commas — e.g. type 1, insulin, blindness, chronic foot ulcer"
              className={inputClass}
            />
          )}
          <textarea
            value={draft.explanation}
            onChange={(e) => setDraft((d) => (d ? { ...d, explanation: e.target.value } : d))}
            placeholder="What the advisor reads when a condition is sent to the “any other condition” question, e.g. &quot;This plan's diabetes question covers only Type 1 / insulin-dependent diabetes.&quot;"
            rows={2}
            className={inputClass}
          />
          {saveError && <p className="text-xs font-semibold text-rose-400">{saveError}</p>}
          <div className="flex items-center gap-2">
            <ClippedButton size="sm" onClick={saveDraft} disabled={saving} className={dark ? "bg-blue-500/20 text-blue-200" : "bg-blue-500 text-white"}>
              <Check className="w-3.5 h-3.5 mr-1" /> {saving ? "Saving…" : "Save"}
            </ClippedButton>
            <ClippedButton size="sm" onClick={cancelDraft} disabled={saving} className={dark ? "bg-white/[0.05] text-stone-300" : "bg-stone-200 text-stone-700"}>
              <X className="w-3.5 h-3.5 mr-1" /> Cancel
            </ClippedButton>
          </div>
        </div>
      )}

      {canEdit && !draft && (
        <ClippedButton size="sm" onClick={startCreate} className={dark ? "bg-white/[0.05] text-stone-200" : "bg-stone-200 text-stone-800"}>
          <Plus className="w-3.5 h-3.5 mr-1" /> Add restriction
        </ClippedButton>
      )}
    </div>
  );
}

export default PlanRestrictionsEditor;
