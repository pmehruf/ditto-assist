/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { Plus, Trash2, Pencil, AlertTriangle, Megaphone } from "lucide-react";
import { LoggedUser } from "../types/user";
import { ChangeLogEntry } from "../types/changeLog";
import { ClippedButton } from "./ClippedButton";
import { CustomSelect } from "./CustomSelect";
import { isoDateToDMY } from "../utils/dateFormat";

interface KbCategory {
  id: number;
  name: string;
  type: "insurer" | "general";
}

interface KbAnnouncement {
  id: number;
  categoryId: number | null;
  title: string;
  body: string;
  effectiveDate: string;
  isActive: boolean;
  createdBy: string;
  createdAt: string;
}

interface KnowledgeBaseAnnouncementsProps {
  theme: "light" | "dark";
  effectiveTier: "General" | "Admin" | "Developer";
  currentUser: LoggedUser | null;
  setChangeLogs: Dispatch<SetStateAction<ChangeLogEntry[]>>;
}

const GENERAL_OPTION_VALUE = "__general__";

/**
 * Dated product-team announcements — the source-of-truth override channel
 * per the user's stated precedence rule ("if a resource says something and
 * a latest announcement from product team says otherwise, it should follow
 * the latest announcement"). Always injected into the query-time prompt
 * (kb_announcements is never vector-searched) once the chat endpoint is
 * built — see kbAnnouncementsRepository.ts's listActiveFor().
 */
export function KnowledgeBaseAnnouncements({ theme, effectiveTier, currentUser, setChangeLogs }: KnowledgeBaseAnnouncementsProps) {
  const dark = theme === "dark";
  const canManage = effectiveTier === "Admin" || effectiveTier === "Developer";

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

  const [categories, setCategories] = useState<KbCategory[]>([]);
  const [announcements, setAnnouncements] = useState<KbAnnouncement[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [catRes, annRes] = await Promise.all([fetch("/api/kb/categories"), fetch("/api/kb/announcements")]);
      const catBody = await catRes.json().catch(() => ({}));
      const annBody = await annRes.json().catch(() => ({}));
      if (!catRes.ok) throw new Error(catBody.error || `Failed to load categories (HTTP ${catRes.status}).`);
      if (!annRes.ok) throw new Error(annBody.error || `Failed to load announcements (HTTP ${annRes.status}).`);
      setCategories(catBody.entries || []);
      setAnnouncements(annBody.entries || []);
    } catch (err: any) {
      setLoadError(err.message || "Failed to load announcements.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const categoryName = (id: number | null) => (id === null ? "General (all)" : categories.find(c => c.id === id)?.name || "Unknown category");

  // ── Add/edit form ────────────────────────────────────────────────────
  const emptyDraft = { title: "", body: "", effectiveDate: new Date().toISOString().slice(0, 10), categoryId: GENERAL_OPTION_VALUE, isActive: true };
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [draft, setDraft] = useState(emptyDraft);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const openAddForm = () => {
    setEditingId(null);
    setDraft(emptyDraft);
    setSaveError(null);
    setFormOpen(true);
  };

  const openEditForm = (a: KbAnnouncement) => {
    setEditingId(a.id);
    setDraft({
      title: a.title,
      body: a.body,
      effectiveDate: a.effectiveDate,
      categoryId: a.categoryId === null ? GENERAL_OPTION_VALUE : String(a.categoryId),
      isActive: a.isActive,
    });
    setSaveError(null);
    setFormOpen(true);
  };

  const closeForm = () => { setFormOpen(false); setEditingId(null); setDraft(emptyDraft); setSaveError(null); };

  const saveDraft = async () => {
    if (!draft.title.trim() || !draft.body.trim()) { setSaveError("Title and announcement text are required."); return; }
    setSaving(true);
    setSaveError(null);
    try {
      const payload = {
        title: draft.title.trim(),
        body: draft.body.trim(),
        effectiveDate: draft.effectiveDate,
        categoryId: draft.categoryId === GENERAL_OPTION_VALUE ? null : Number(draft.categoryId),
        isActive: draft.isActive,
      };
      const res = await fetch(editingId ? `/api/kb/announcements/${editingId}` : "/api/kb/announcements", {
        method: editingId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Failed to save announcement (HTTP ${res.status}).`);
      logAction(editingId ? "Knowledge Base Announcement Edited" : "Knowledge Base Announcement Added", `${editingId ? "Updated" : "Added"} "${payload.title}" (${categoryName(payload.categoryId)}, effective ${payload.effectiveDate}).`);
      closeForm();
      await load();
    } catch (err: any) {
      setSaveError(err.message || "Failed to save announcement. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const deleteAnnouncement = async (a: KbAnnouncement) => {
    if (!window.confirm(`Delete the announcement "${a.title}"?`)) return;
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch(`/api/kb/announcements/${a.id}`, { method: "DELETE" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Failed to delete announcement (HTTP ${res.status}).`);
      logAction("Knowledge Base Announcement Deleted", `Deleted "${a.title}".`);
      await load();
    } catch (err: any) {
      setSaveError(err.message || "Failed to delete announcement. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const inputClass = `w-full px-3 py-2 rounded-lg text-xs font-medium border outline-none transition-colors ${
    dark ? "bg-white/[0.04] border-white/[0.1] text-white placeholder:text-stone-500 focus:border-sky-500/50" : "bg-white border-stone-300 text-stone-900 placeholder:text-stone-400 focus:border-sky-500"
  }`;
  const cardClass = dark ? "bg-white/[0.03] border-white/[0.08]" : "bg-white border-stone-200";

  if (loading) {
    return <div className="text-xs font-semibold text-content-muted py-8 text-center">Loading announcements…</div>;
  }

  const categoryOptions = [{ value: GENERAL_OPTION_VALUE, label: "General (applies to all insurers)" }, ...categories.map(c => ({ value: String(c.id), label: c.name }))];

  return (
    <div className="space-y-5 pb-6">
      {loadError && (
        <div className={`text-xs font-semibold px-3 py-2 rounded-lg border flex items-center gap-2 ${dark ? "bg-red-500/10 border-red-500/30 text-red-300" : "bg-red-50 border-red-200 text-red-700"}`}>
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" /> {loadError}
        </div>
      )}

      {canManage && !formOpen && (
        <ClippedButton size="md" onClick={openAddForm} className="bg-[var(--tab-active-bg)] text-[var(--tab-active-text)] px-4 py-2 text-[11px] font-black uppercase tracking-wider flex items-center gap-2">
          <Plus className="w-3.5 h-3.5" /> Add Announcement
        </ClippedButton>
      )}

      {formOpen && (
        <div className={`rounded-xl border p-4 space-y-3 ${cardClass}`}>
          {saveError && (
            <div className={`text-xs font-semibold px-3 py-2 rounded-lg border flex items-center gap-2 ${dark ? "bg-red-500/10 border-red-500/30 text-red-300" : "bg-red-50 border-red-200 text-red-700"}`}>
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" /> {saveError}
            </div>
          )}
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wide text-content-muted mb-1">Title</label>
            <input className={inputClass} value={draft.title} onChange={e => setDraft(d => ({ ...d, title: e.target.value }))} placeholder='e.g. "Moratorium period reduced from 8 years to 5 years"' autoFocus />
          </div>
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wide text-content-muted mb-1">Announcement text</label>
            <textarea className={`${inputClass} min-h-[90px] resize-y`} value={draft.body} onChange={e => setDraft(d => ({ ...d, body: e.target.value }))} placeholder="What changed, and what should override in older resources." />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-wide text-content-muted mb-1">Applies to</label>
              <CustomSelect theme={theme} value={draft.categoryId} onChange={v => setDraft(d => ({ ...d, categoryId: v }))} options={categoryOptions} />
            </div>
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-wide text-content-muted mb-1">Effective date</label>
              <input type="date" className={inputClass} value={draft.effectiveDate} onChange={e => setDraft(d => ({ ...d, effectiveDate: e.target.value }))} />
            </div>
          </div>
          <label className="flex items-center gap-2 text-xs font-semibold cursor-pointer w-fit">
            <input type="checkbox" checked={draft.isActive} onChange={e => setDraft(d => ({ ...d, isActive: e.target.checked }))} />
            Active (injected into answers)
          </label>
          <div className="flex gap-2 pt-1">
            <ClippedButton size="md" onClick={saveDraft} disabled={saving} className="bg-[var(--tab-active-bg)] text-[var(--tab-active-text)] px-4 py-2 text-[11px] font-black uppercase tracking-wider">
              {saving ? "Saving…" : editingId ? "Save Changes" : "Add Announcement"}
            </ClippedButton>
            <ClippedButton size="md" onClick={closeForm} className={dark ? "bg-white/[0.06] text-stone-300 px-4 py-2 text-[11px] font-black uppercase tracking-wider" : "bg-stone-100 text-stone-600 px-4 py-2 text-[11px] font-black uppercase tracking-wider"}>
              Cancel
            </ClippedButton>
          </div>
        </div>
      )}

      <div className="space-y-2.5">
        {announcements.length === 0 && (
          <div className="text-xs font-semibold text-content-muted py-8 text-center">No announcements yet.</div>
        )}
        {announcements.map(a => (
          <div key={a.id} className={`rounded-xl border p-4 ${cardClass} ${a.isActive ? "" : "opacity-50"}`}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <Megaphone className="w-3.5 h-3.5 shrink-0 text-sky-400" />
                  <span className={`text-sm font-bold ${dark ? "text-white" : "text-stone-900"}`}>{a.title}</span>
                  {!a.isActive && (
                    <span className={`text-[9.5px] font-bold uppercase tracking-wide px-2 py-0.5 rounded border ${dark ? "bg-white/[0.06] text-stone-400 border-white/[0.1]" : "bg-stone-100 text-stone-600 border-stone-200"}`}>Inactive</span>
                  )}
                </div>
                <p className={`text-xs mt-1.5 whitespace-pre-wrap ${dark ? "text-stone-300" : "text-stone-700"}`}>{a.body}</p>
                <p className="text-[10.5px] font-semibold text-content-muted mt-2">
                  {categoryName(a.categoryId)} · Effective {isoDateToDMY(a.effectiveDate)} · Added by {a.createdBy}
                </p>
              </div>
              {canManage && (
                <div className="flex items-center gap-1.5 shrink-0">
                  <ClippedButton size="sm" title="Edit" onClick={() => openEditForm(a)} className={dark ? "bg-white/[0.06] text-stone-300 px-2 py-1.5" : "bg-stone-100 text-stone-600 px-2 py-1.5"}>
                    <Pencil className="w-3 h-3" />
                  </ClippedButton>
                  <ClippedButton size="sm" title="Delete" onClick={() => deleteAnnouncement(a)} className={dark ? "bg-red-500/10 text-red-300 px-2 py-1.5" : "bg-red-50 text-red-600 px-2 py-1.5"}>
                    <Trash2 className="w-3 h-3" />
                  </ClippedButton>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
