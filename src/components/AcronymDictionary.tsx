/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useMemo, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import { Plus, Pencil, Trash2, Search, X, Power } from "lucide-react";
import { LoggedUser } from "../types/user";
import { ChangeLogEntry } from "../types/changeLog";
import { ClippedButton } from "./ClippedButton";

interface AcronymEntry {
  id: number;
  acronym: string;
  expansion: string;
  notes: string | null;
  isActive: boolean;
  createdBy: string;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
}

function statusBadge(isActive: boolean, dark: boolean) {
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded text-[9.5px] font-bold uppercase tracking-wide border whitespace-nowrap ${
        isActive
          ? dark ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/30" : "bg-emerald-50 text-emerald-700 border-emerald-200"
          : dark ? "bg-white/[0.06] text-stone-400 border-white/[0.1]" : "bg-stone-100 text-stone-600 border-stone-200"
      }`}
    >
      {isActive ? "Active" : "Inactive"}
    </span>
  );
}

function ModalShell({ theme, onClose, children }: { theme: "light" | "dark"; onClose: () => void; children: ReactNode }) {
  const dark = theme === "dark";
  return (
    <div className="fixed inset-0 z-[190] flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <div className={`absolute inset-0 backdrop-blur-md ${dark ? "bg-black/60" : "bg-stone-900/40"}`} onClick={onClose} />
      <div
        className={`relative w-full max-w-lg rounded-2xl border shadow-2xl overflow-hidden max-h-[85vh] flex flex-col ${
          dark ? "bg-[#12151A] border-[#252A34]" : "bg-[#ffffff] border-stone-200"
        }`}
      >
        {children}
      </div>
    </div>
  );
}

interface FormState {
  id: number | null;
  acronym: string;
  expansion: string;
  notes: string;
}

const EMPTY_FORM: FormState = { id: null, acronym: "", expansion: "", notes: "" };

interface AcronymDictionaryProps {
  theme: "light" | "dark";
  effectiveTier: "General" | "Admin" | "Platform Admin" | "Developer";
  currentUser: LoggedUser | null;
  setChangeLogs: Dispatch<SetStateAction<ChangeLogEntry[]>>;
  /** Health/Term (2026-09) — which vertical this admin view is currently
   * scoped to, owned by KnowledgeBaseManagementPage's toggle. See
   * kb_acronyms.domain's schema.ts comment. */
  domain: "Health" | "Term";
}

/**
 * Knowledge Hub -> "Acronym Dictionary" section. Same permission split as
 * Special Instructions: every tier that can see the Knowledge Hub may view
 * the list (a shared reference need), but only Developer/Platform Admin can
 * create/edit/activate-deactivate/delete an entry, since these directly
 * steer Product Assist's retrieval and plan detection.
 *
 * Purely a CRUD + reference UI — the actual matching (word-boundary string
 * match, not embedding similarity — an acronym is a short exact token, not
 * a phrase) lives server-side in src/server/knowledgeBase/acronyms.ts and is
 * invoked from productAssist.ts for every question, feeding retrieval, plan
 * detection, and a small reference block in the prompt.
 */
export function AcronymDictionary({ theme, effectiveTier, currentUser, setChangeLogs, domain }: AcronymDictionaryProps) {
  const dark = theme === "dark";
  const canManage = effectiveTier === "Platform Admin" || effectiveTier === "Developer";

  const logAction = (actionType: string, description: string) => {
    setChangeLogs(prev => [
      {
        id: `log-${Date.now()}`,
        timestamp: new Date().toISOString(),
        userName: currentUser?.name || currentUser?.email || "Unknown",
        role: effectiveTier,
        actionType,
        planName: "Knowledge Base",
        description,
      },
      ...prev,
    ]);
  };

  const [entries, setEntries] = useState<AcronymEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch(`/api/kb/acronyms?domain=${domain}`);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Failed to load the Acronym Dictionary (HTTP ${res.status}).`);
      setEntries(body.entries || []);
    } catch (err: any) {
      setLoadError(err.message || "Failed to load the Acronym Dictionary.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [domain]);

  // ── Search / filter ───────────────────────────────────────────────────────
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("all");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return entries.filter(e => {
      if (statusFilter === "active" && !e.isActive) return false;
      if (statusFilter === "inactive" && e.isActive) return false;
      if (!q) return true;
      return e.acronym.toLowerCase().includes(q) || e.expansion.toLowerCase().includes(q) || (e.notes || "").toLowerCase().includes(q);
    });
  }, [entries, search, statusFilter]);

  // ── Add/Edit modal ────────────────────────────────────────────────────────
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const openAdd = () => { setForm(EMPTY_FORM); setSaveError(null); setFormOpen(true); };
  const openEdit = (e: AcronymEntry) => {
    setForm({ id: e.id, acronym: e.acronym, expansion: e.expansion, notes: e.notes || "" });
    setSaveError(null);
    setFormOpen(true);
  };

  const submitForm = async () => {
    const acronym = form.acronym.trim();
    const expansion = form.expansion.trim();
    if (!acronym) { setSaveError("Acronym is required."); return; }
    if (/\s/.test(acronym)) { setSaveError("Acronym should be a single token, no spaces (e.g. \"CBB\", not \"C B B\")."); return; }
    if (!expansion) { setSaveError("Full form / meaning is required."); return; }
    setSaving(true);
    setSaveError(null);
    try {
      const isEdit = form.id !== null;
      // domain is set once at creation only — never editable afterward (see
      // kb_categories.domain's schema.ts comment on the same design
      // decision), so it's omitted entirely from an edit's payload.
      const payload = { acronym, expansion, notes: form.notes.trim() || null, ...(isEdit ? {} : { domain }) };
      const res = await fetch(isEdit ? `/api/kb/acronyms/${form.id}` : "/api/kb/acronyms", {
        method: isEdit ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Failed to save (HTTP ${res.status}).`);
      logAction(isEdit ? "Acronym Dictionary Entry Edited" : "Acronym Dictionary Entry Created", `${isEdit ? "Updated" : "Added"} "${acronym}" -> "${expansion}".`);
      setFormOpen(false);
      await load();
    } catch (err: any) {
      setSaveError(err.message || "Failed to save this acronym. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  // ── Activate/Deactivate + Delete ─────────────────────────────────────────
  const [busyId, setBusyId] = useState<number | null>(null);

  const toggleActive = async (e: AcronymEntry) => {
    setBusyId(e.id);
    try {
      const res = await fetch(`/api/kb/acronyms/${e.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !e.isActive }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Failed to update (HTTP ${res.status}).`);
      logAction(e.isActive ? "Acronym Dictionary Entry Deactivated" : "Acronym Dictionary Entry Activated", `"${e.acronym}" is now ${e.isActive ? "inactive" : "active"}.`);
      await load();
    } catch (err: any) {
      window.alert(err.message || "Failed to update this acronym.");
    } finally {
      setBusyId(null);
    }
  };

  const deleteEntry = async (e: AcronymEntry) => {
    if (!window.confirm(`Delete "${e.acronym}" from the Acronym Dictionary? This can't be undone.`)) return;
    setBusyId(e.id);
    try {
      const res = await fetch(`/api/kb/acronyms/${e.id}`, { method: "DELETE" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Failed to delete (HTTP ${res.status}).`);
      logAction("Acronym Dictionary Entry Deleted", `Deleted "${e.acronym}".`);
      await load();
    } catch (err: any) {
      window.alert(err.message || "Failed to delete this acronym.");
    } finally {
      setBusyId(null);
    }
  };

  const inputClass =
    "w-full px-3 py-2 rounded-lg text-xs font-medium border outline-none transition-colors bg-[var(--input-bg)] border-[var(--input-border)] text-[var(--input-text)] placeholder:text-[var(--text-disabled)] focus:border-[var(--focus-ring)]";
  const cardClass = dark ? "bg-white/[0.03] border-white/[0.08]" : "bg-white border-stone-200";

  return (
    <div className="space-y-4">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-3">
        <p className={`text-xs font-semibold max-w-2xl ${dark ? "text-stone-400" : "text-stone-600"}`}>
          Shorthand advisors habitually type (e.g. "OS" for Optima Secure, "CBB" for Cumulative Bonus Booster) so Product Assist

          recognizes it instead of under-retrieving or asking what it means.
          {!canManage && " Read-only — Developer or Platform Admin clearance is required to make changes."}
        </p>
        {canManage && (
          <ClippedButton size="md" onClick={openAdd} className="bg-[var(--tab-active-bg)] text-[var(--tab-active-text)] px-4 py-2 text-[11px] font-black uppercase tracking-wider whitespace-nowrap">
            <Plus className="w-3.5 h-3.5 mr-1.5 inline" />
            Add Acronym
          </ClippedButton>
        )}
      </div>

      {/* Toolbar */}
      <div className={`flex flex-wrap items-center gap-2 p-3 rounded-xl border ${cardClass}`}>
        <div className="relative flex-1 min-w-[200px]">
          <Search className={`w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 ${dark ? "text-stone-500" : "text-stone-400"}`} />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search acronym, full form, notes…"
            className={`${inputClass} pl-8`}
          />
        </div>
        <div className="flex items-center gap-1 rounded-lg border p-0.5 text-[10.5px] font-bold uppercase tracking-wide" style={{ borderColor: "var(--input-border)" }}>
          {(["all", "active", "inactive"] as const).map(v => (
            <button
              key={v}
              type="button"
              onClick={() => setStatusFilter(v)}
              className={`px-2.5 py-1 rounded-md cursor-pointer transition-colors ${
                statusFilter === v
                  ? "bg-[var(--tab-active-bg)] text-[var(--tab-active-text)]"
                  : dark ? "text-stone-400 hover:text-white" : "text-stone-500 hover:text-stone-800"
              }`}
            >
              {v === "all" ? "All" : v === "active" ? "Active" : "Inactive"}
            </button>
          ))}
        </div>
      </div>

      {loadError && <p className="text-xs font-semibold text-red-500">{loadError}</p>}

      {/* Table */}
      <div className={`rounded-xl border overflow-hidden ${cardClass}`}>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className={dark ? "bg-white/[0.04]" : "bg-[var(--table-header-bg)]"}>
              <tr>
                {["Acronym", "Full Form", "Notes", "Status", "Last Updated", "Updated By", "Actions"].map(h => (
                  <th key={h} className={`px-3 py-2 font-bold uppercase tracking-wide text-[10px] whitespace-nowrap ${dark ? "text-stone-400" : "text-stone-500"}`}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7} className={`px-3 py-6 text-center text-xs font-semibold ${dark ? "text-stone-500" : "text-stone-400"}`}>Loading…</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={7} className={`px-3 py-6 text-center text-xs font-semibold ${dark ? "text-stone-500" : "text-stone-400"}`}>
                  {entries.length === 0 ? "No acronyms yet." : "No acronyms match your search/filters."}
                </td></tr>
              ) : (
                filtered.map(e => (
                  <tr key={e.id} className={`border-t ${dark ? "border-white/[0.06]" : "border-stone-100"} ${!e.isActive ? "opacity-60" : ""}`}>
                    <td className={`px-3 py-2.5 font-black whitespace-nowrap ${dark ? "text-white" : "text-stone-900"}`}>{e.acronym}</td>
                    <td className={`px-3 py-2.5 font-semibold ${dark ? "text-stone-300" : "text-stone-700"}`}>{e.expansion}</td>
                    <td className={`px-3 py-2.5 max-w-[260px] truncate ${dark ? "text-stone-400" : "text-stone-500"}`} title={e.notes || ""}>
                      {e.notes || <span className={dark ? "text-stone-600" : "text-stone-300"}>—</span>}
                    </td>
                    <td className="px-3 py-2.5">{statusBadge(e.isActive, dark)}</td>
                    <td className={`px-3 py-2.5 whitespace-nowrap ${dark ? "text-stone-400" : "text-stone-500"}`}>
                      {new Date(e.updatedAt).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })}
                    </td>
                    <td className={`px-3 py-2.5 whitespace-nowrap max-w-[160px] truncate ${dark ? "text-stone-400" : "text-stone-500"}`} title={e.updatedBy}>
                      {e.updatedBy}
                    </td>
                    <td className="px-3 py-2.5">
                      {canManage ? (
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => openEdit(e)}
                            title="Edit"
                            className={`p-1.5 rounded-lg cursor-pointer transition-colors ${dark ? "text-stone-400 hover:text-white hover:bg-white/[0.08]" : "text-stone-500 hover:text-stone-900 hover:bg-stone-200"}`}
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => toggleActive(e)}
                            disabled={busyId === e.id}
                            title={e.isActive ? "Deactivate" : "Activate"}
                            className={`p-1.5 rounded-lg cursor-pointer transition-colors disabled:opacity-40 ${dark ? "text-stone-400 hover:text-white hover:bg-white/[0.08]" : "text-stone-500 hover:text-stone-900 hover:bg-stone-200"}`}
                          >
                            <Power className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => deleteEntry(e)}
                            disabled={busyId === e.id}
                            title="Delete"
                            className={`p-1.5 rounded-lg cursor-pointer transition-colors disabled:opacity-40 ${dark ? "text-stone-400 hover:text-red-400 hover:bg-red-500/10" : "text-stone-500 hover:text-red-600 hover:bg-red-50"}`}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ) : (
                        <span className={dark ? "text-stone-600" : "text-stone-300"}>—</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add/Edit modal */}
      {formOpen && (
        <ModalShell theme={theme} onClose={() => setFormOpen(false)}>
          <div className={`px-5 pt-4 pb-3 border-b flex items-center justify-between ${dark ? "border-stone-800" : "border-stone-200"}`}>
            <h2 className={`text-sm font-bold uppercase tracking-wider ${dark ? "text-white" : "text-stone-900"}`}>
              {form.id !== null ? "Edit Acronym" : "Add Acronym"}
            </h2>
            <button type="button" onClick={() => setFormOpen(false)} className={dark ? "text-stone-400 hover:text-white cursor-pointer" : "text-stone-400 hover:text-stone-800 cursor-pointer"}>
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="px-5 py-4 space-y-3 overflow-y-auto">
            {saveError && <p className="text-[11px] font-semibold text-red-500">{saveError}</p>}
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-wide text-content-muted mb-1">Acronym <span className="text-red-500">*</span></label>
              <input className={inputClass} value={form.acronym} onChange={e => setForm(f => ({ ...f, acronym: e.target.value }))} placeholder='e.g. "OS"' autoFocus />
            </div>
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-wide text-content-muted mb-1">Full Form / Meaning <span className="text-red-500">*</span></label>
              <input
                className={inputClass}
                value={form.expansion}
                onChange={e => setForm(f => ({ ...f, expansion: e.target.value }))}
                placeholder='e.g. "Optima Secure"'
              />
              <p className={`text-[10.5px] font-medium mt-1 ${dark ? "text-stone-500" : "text-stone-400"}`}>
                If this exactly matches a plan's name, questions using the acronym will also get that plan's grounding automatically —
                same as if the advisor typed the full plan name.
              </p>
            </div>
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-wide text-content-muted mb-1">Notes (optional)</label>
              <textarea
                className={`${inputClass} min-h-[70px] resize-y`}
                value={form.notes}
                onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                placeholder="e.g. HDFC ERGO only — a different insurer may use the same acronym for something else."
              />
            </div>
          </div>
          <div className={`px-5 py-3 border-t flex items-center justify-end gap-2 ${dark ? "border-stone-800" : "border-stone-200"}`}>
            <ClippedButton size="md" onClick={() => setFormOpen(false)} className={dark ? "bg-white/[0.06] text-stone-300 px-4 py-2 text-[11px] font-black uppercase tracking-wider" : "bg-stone-100 text-stone-600 px-4 py-2 text-[11px] font-black uppercase tracking-wider"}>
              Cancel
            </ClippedButton>
            <ClippedButton size="md" onClick={submitForm} disabled={saving} className="bg-[var(--tab-active-bg)] text-[var(--tab-active-text)] px-4 py-2 text-[11px] font-black uppercase tracking-wider">
              {saving ? "Saving…" : form.id !== null ? "Save Changes" : "Add"}
            </ClippedButton>
          </div>
        </ModalShell>
      )}
    </div>
  );
}
