/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useRef, useState } from "react";
import { Plus, Trash2, Pencil, X, Check, Search, ArrowRight } from "lucide-react";
import { useCategoryLabels } from "../utils/categoryLabels";
import { ClippedButton } from "./ClippedButton";
import { CustomSelect } from "./CustomSelect";
import { useDialog } from "../hooks/useDialog";
import { mappingFetch } from "../utils/mappingFetch";

/** Row shape returned by GET /api/plan-ped-overrides/:planName
 * (PlanOverridesRepository.listDetailed). */
interface PlanPedOverrideRowEntry {
  id: number;
  planName: string;
  pedId: number;
  pedName: string;
  pedCode: string;
  pedCategoryKey: string | null;
  categoryKey: string | null;
  targetQuestion: string | null;
  reason: string | null;
  addedBy: string;
  createdAt: string;
}

interface PedSearchResult {
  id: number;
  pedCode: string;
  canonicalName: string;
  categoryKey: string | null;
  status: string;
}

interface DraftState {
  ped: { id: number; name: string; code: string; categoryKey: string | null } | null;
  targetQuestion: string;
  reason: string;
  isEdit: boolean;
}

interface PlanPedOverridesEditorProps {
  theme: "light" | "dark";
  /** Empty/undefined for a brand-new, never-saved plan. */
  planName: string | undefined;
  /** The plan's question texts (specific + catch-all, no umbrella) — the
   * choices a PED can be pinned to. */
  questions: string[];
  canEdit: boolean;
  mode: "view" | "edit";
}

/**
 * Plan-Specific PED Mappings — pins one PED to an exact question on this
 * plan only, taking precedence over the PED's category mapping (e.g.
 * Obstructive Sleep Apnea → "Nervous, Psychiatric or Mental or Sleep
 * disorder?" on Optima Secure, while every other plan keeps routing it by
 * its Respiratory category). Saves straight to `plan_overrides` via
 * /api/plan-ped-overrides; takes effect for every advisor on their next
 * lookup. Evaluated by src/mapping/helpers.ts's applyPlanPedOverride.
 */
export function PlanPedOverridesEditor({ theme, planName, questions, canEdit, mode }: PlanPedOverridesEditorProps) {
  const liveLabel = useCategoryLabels();
  const categoryLabel = (key: string | null): string => (key ? liveLabel(key) : "Uncategorized");
  const dark = theme === "dark";
  const { confirm } = useDialog();
  const [entries, setEntries] = useState<PlanPedOverrideRowEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [draft, setDraft] = useState<DraftState | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [searchResults, setSearchResults] = useState<PedSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const searchSeq = useRef(0);

  const load = async () => {
    if (!planName) {
      setEntries([]);
      return;
    }
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch(`/api/plan-ped-overrides/${encodeURIComponent(planName)}`);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Failed to load the condition mappings (HTTP ${res.status}).`);
      setEntries(body.entries || []);
    } catch (err: unknown) {
      setLoadError(err instanceof Error ? err.message : "Could not load the condition mappings.");
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

  // Debounced PED search (matches aliases/abbreviations too).
  useEffect(() => {
    const q = search.trim();
    if (!draft || draft.ped || q.length < 2) {
      setSearchResults([]);
      return;
    }
    const seq = ++searchSeq.current;
    setSearching(true);
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/plan-ped-overrides-ped-search?q=${encodeURIComponent(q)}`);
        const body = await res.json().catch(() => ({}));
        if (seq === searchSeq.current) setSearchResults(res.ok ? body.entries || [] : []);
      } finally {
        if (seq === searchSeq.current) setSearching(false);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [search, draft]);

  const inputClass = `w-full px-2.5 py-2 rounded-lg text-xs font-medium outline-none transition-colors ${
    dark ? "bg-white/[0.03] border border-white/[0.08] text-white placeholder:text-stone-500 focus:border-blue-400/40" : "bg-white border border-stone-200 text-stone-900 placeholder:text-stone-400 focus:border-blue-400"
  }`;
  const mutedText = dark ? "text-stone-400" : "text-stone-500";
  const cardClass = dark ? "bg-white/[0.015] border-white/[0.05] text-stone-200" : "bg-stone-50 border-stone-150 text-stone-800";

  const questionOptions = Array.from(new Set(questions.map((q) => q.trim()).filter(Boolean))).map((q) => ({ value: q, label: q }));

  const startCreate = () => {
    setSaveError(null);
    setSearch("");
    setDraft({ ped: null, targetQuestion: "", reason: "", isEdit: false });
  };
  const startEdit = (e: PlanPedOverrideRowEntry) => {
    setSaveError(null);
    setDraft({
      ped: { id: e.pedId, name: e.pedName, code: e.pedCode, categoryKey: e.pedCategoryKey },
      targetQuestion: e.targetQuestion || "",
      reason: e.reason || "",
      isEdit: true,
    });
  };
  const cancelDraft = () => {
    setDraft(null);
    setSaveError(null);
    setSearch("");
  };

  const saveDraft = async () => {
    if (!planName || !draft) return;
    if (!draft.ped) return setSaveError("Choose a condition.");
    if (!draft.targetQuestion) return setSaveError("Choose the question this condition should go to on this plan.");
    if (!draft.isEdit && entries.some((e) => e.pedId === draft.ped!.id)) {
      const ok = await confirm(`${draft.ped.name} already has a mapping on ${planName}. Replace it?`);
      if (!ok) return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      const res = await mappingFetch(`/api/plan-ped-overrides/${encodeURIComponent(planName)}/${draft.ped.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetQuestion: draft.targetQuestion, reason: draft.reason.trim() || null }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Failed to save (HTTP ${res.status}).`);
      await load();
      cancelDraft();
    } catch (err: unknown) {
      setSaveError(err instanceof Error ? err.message : "Failed to save this mapping.");
    } finally {
      setSaving(false);
    }
  };

  const deleteEntry = async (e: PlanPedOverrideRowEntry) => {
    if (!planName) return;
    if (!(await confirm(`Remove the ${planName} mapping for ${e.pedName}? It will go back to its normal ${categoryLabel(e.pedCategoryKey)} category mapping on this plan.`))) return;
    setSaveError(null);
    try {
      const res = await mappingFetch(`/api/plan-ped-overrides/${encodeURIComponent(planName)}/${e.pedId}`, { method: "DELETE" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Failed to delete (HTTP ${res.status}).`);
      await load();
    } catch (err: unknown) {
      setSaveError(err instanceof Error ? err.message : "Failed to delete this mapping.");
    }
  };

  const targetLabel = (e: PlanPedOverrideRowEntry) =>
    e.targetQuestion ? e.targetQuestion : e.categoryKey ? `${categoryLabel(e.categoryKey)} question (its category's question)` : "—";

  const staleTarget = (e: PlanPedOverrideRowEntry) =>
    !!e.targetQuestion && questionOptions.length > 0 && !questionOptions.some((o) => o.value === e.targetQuestion!.trim());

  const renderEntry = (e: PlanPedOverrideRowEntry, withActions: boolean) => (
    <li key={e.id} className={`flex items-start gap-2 p-2 rounded-lg border text-xs ${cardClass}`}>
      <div className="flex-1 min-w-0">
        <div className="font-bold">
          {e.pedName} <span className={`font-normal ${mutedText}`}>· {e.pedCode} · normally filed under {categoryLabel(e.pedCategoryKey)}</span>
        </div>
        <div className="mt-0.5 flex items-start gap-1">
          <ArrowRight className="w-3 h-3 mt-0.5 shrink-0 opacity-70" />
          <span>{targetLabel(e)}</span>
        </div>
        {staleTarget(e) && (
          <div className="mt-0.5 text-[11px] font-semibold text-amber-500">
            This question no longer exists on the plan — the mapping is ignored until you pick a current question.
          </div>
        )}
        {e.reason && <div className={`mt-0.5 ${mutedText}`}>{e.reason}</div>}
      </div>
      {withActions && (
        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={() => startEdit(e)}
            title="Edit"
            className={`p-1 rounded cursor-pointer ${dark ? "hover:bg-white/10 text-stone-300" : "hover:bg-stone-200 text-stone-600"}`}
          >
            <Pencil className="w-3.5 h-3.5" />
          </button>
          <button type="button" onClick={() => deleteEntry(e)} title="Delete" className="p-1 rounded cursor-pointer hover:bg-rose-500/15 text-rose-400">
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
    </li>
  );

  if (mode === "view") {
    if (!planName) return <p className={`text-xs font-semibold px-2 py-2 ${mutedText}`}>—</p>;
    if (loading) return <p className={`text-xs font-semibold px-2 py-2 ${mutedText}`}>Loading…</p>;
    if (entries.length === 0) {
      return <p className={`text-xs font-semibold px-2 py-2 ${mutedText}`}>None — every condition follows its normal category on this plan.</p>;
    }
    return <ul className="space-y-1">{entries.map((e) => renderEntry(e, false))}</ul>;
  }

  if (!planName) {
    return <p className={`text-xs font-semibold px-2 py-2 ${mutedText}`}>Save this plan first, then add condition mappings.</p>;
  }

  return (
    <div className="space-y-2">
      {loadError && <p className="text-xs font-semibold text-rose-400">{loadError}</p>}
      {loading && entries.length === 0 && <p className={`text-xs ${mutedText}`}>Loading…</p>}

      {entries.length > 0 && <ul className="space-y-1.5">{entries.map((e) => renderEntry(e, canEdit))}</ul>}

      {canEdit && draft && (
        <div className={`p-2.5 rounded-lg border space-y-2 ${dark ? "bg-white/[0.02] border-white/[0.08]" : "bg-stone-50 border-stone-200"}`}>
          {draft.ped ? (
            <div className={`flex items-center gap-2 px-2.5 py-2 rounded-lg border text-xs ${cardClass}`}>
              <div className="flex-1 min-w-0">
                <span className="font-bold">{draft.ped.name}</span>
                <span className={mutedText}> · {draft.ped.code} · normally filed under {categoryLabel(draft.ped.categoryKey)}</span>
              </div>
              {!draft.isEdit && (
                <button
                  type="button"
                  onClick={() => setDraft((d) => (d ? { ...d, ped: null } : d))}
                  title="Choose a different condition"
                  className={`p-1 rounded cursor-pointer ${dark ? "hover:bg-white/10 text-stone-300" : "hover:bg-stone-200 text-stone-600"}`}
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          ) : (
            <div>
              <div className="relative">
                <Search className={`w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 ${mutedText}`} />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search a condition by name, abbreviation or code — e.g. OSA"
                  className={`${inputClass} pl-8`}
                  autoFocus
                />
              </div>
              {search.trim().length >= 2 && (
                <ul className={`mt-1 max-h-56 overflow-y-auto rounded-lg border ${dark ? "border-white/[0.08] bg-black/20" : "border-stone-200 bg-white"}`}>
                  {searching && searchResults.length === 0 && <li className={`px-2.5 py-2 text-xs ${mutedText}`}>Searching…</li>}
                  {!searching && searchResults.length === 0 && <li className={`px-2.5 py-2 text-xs ${mutedText}`}>No conditions found.</li>}
                  {searchResults.map((r) => (
                    <li key={r.id}>
                      <button
                        type="button"
                        onClick={() => setDraft((d) => (d ? { ...d, ped: { id: r.id, name: r.canonicalName, code: r.pedCode, categoryKey: r.categoryKey } } : d))}
                        className={`w-full text-left px-2.5 py-1.5 text-xs cursor-pointer ${dark ? "hover:bg-white/[0.06] text-stone-200" : "hover:bg-stone-100 text-stone-800"}`}
                      >
                        <span className="font-semibold">{r.canonicalName}</span>
                        <span className={mutedText}> · {r.pedCode} · {categoryLabel(r.categoryKey)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <CustomSelect
            theme={theme}
            value={draft.targetQuestion}
            onChange={(v) => setDraft((d) => (d ? { ...d, targetQuestion: v } : d))}
            options={questionOptions}
            placeholder="Which question should it go to on this plan?"
          />
          <textarea
            value={draft.reason}
            onChange={(e) => setDraft((d) => (d ? { ...d, reason: e.target.value } : d))}
            placeholder="Reason (optional, shown to advisors), e.g. &quot;This plan has a dedicated Sleep disorder question.&quot;"
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

      {saveError && !draft && <p className="text-xs font-semibold text-rose-400">{saveError}</p>}

      {canEdit && !draft && (
        <ClippedButton size="sm" onClick={startCreate} className={dark ? "bg-white/[0.05] text-stone-200" : "bg-stone-200 text-stone-800"}>
          <Plus className="w-3.5 h-3.5 mr-1" /> Add PED mapping
        </ClippedButton>
      )}
    </div>
  );
}

export default PlanPedOverridesEditor;
