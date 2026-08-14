/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useRef, useState, type ChangeEvent } from "react";
import type { Dispatch, SetStateAction } from "react";
import { Plus, Trash2, Upload, ChevronDown, ChevronRight, FileText, RefreshCw, AlertTriangle, CheckCircle2, X, Tag } from "lucide-react";
import { LoggedUser } from "../types/user";
import { ChangeLogEntry } from "../types/changeLog";
import { ClippedButton } from "./ClippedButton";
import { CustomSelect } from "./CustomSelect";

interface KbCategory {
  id: number;
  name: string;
  type: "insurer" | "general";
  sortOrder: number;
  planNames: string[];
}

interface KbResource {
  id: number;
  categoryId: number;
  type: "pdf" | "web" | "sheet";
  title: string;
  sourceUrl: string | null;
  status: "processing" | "active" | "error" | "archived";
  chunkCount: number;
  errorMessage: string | null;
  planTags: string[];
  updatedAt: string;
}

interface KnowledgeBaseResourceManagementProps {
  theme: "light" | "dark";
  effectiveTier: "General" | "Admin" | "Developer";
  currentUser: LoggedUser | null;
  setChangeLogs: Dispatch<SetStateAction<ChangeLogEntry[]>>;
}

function statusBadge(status: KbResource["status"], dark: boolean) {
  const map: Record<KbResource["status"], string> = {
    active: dark ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/30" : "bg-emerald-50 text-emerald-700 border-emerald-200",
    processing: dark ? "bg-amber-500/15 text-amber-300 border-amber-500/30" : "bg-amber-50 text-amber-700 border-amber-200",
    error: dark ? "bg-red-500/15 text-red-300 border-red-500/30" : "bg-red-50 text-red-700 border-red-200",
    archived: dark ? "bg-white/[0.06] text-stone-400 border-white/[0.1]" : "bg-stone-100 text-stone-600 border-stone-200",
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-[9.5px] font-bold uppercase tracking-wide border whitespace-nowrap ${map[status]}`}>
      {status}
    </span>
  );
}

/**
 * "Ask the Playbook" Knowledge Base — category + resource (PDF) admin UI.
 * Categories are per-insurer or "general" (the user's requested category-
 * wise resource organization); resources today are PDFs only (each upload
 * is extracted, chunked, and embedded server-side via
 * src/server/knowledgeBase/pdfIngest.ts). Web-page and live Google Sheet
 * ingestion are a later phase — see the KB task list.
 */
export function KnowledgeBaseResourceManagement({ theme, effectiveTier, currentUser, setChangeLogs }: KnowledgeBaseResourceManagementProps) {
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
  const [resources, setResources] = useState<KbResource[]>([]);
  // insurerName (lowercased/trimmed) -> plan names, sourced live from
  // /api/plan-configs (the same DB-backed source Plan Management edits) —
  // used only to suggest quick-add tag chips per insurer category; admins
  // can still type any custom tag (insurers sell plans beyond this app's 6
  // deterministic-engine plans, e.g. HDFC ERGO's "my:health Medisure").
  const [plansByInsurer, setPlansByInsurer] = useState<Record<string, string[]>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [expandedCategoryId, setExpandedCategoryId] = useState<number | null>(null);

  const load = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [catRes, resRes, planRes] = await Promise.all([
        fetch("/api/kb/categories"),
        fetch("/api/kb/resources"),
        fetch("/api/plan-configs"),
      ]);
      const catBody = await catRes.json().catch(() => ({}));
      const resBody = await resRes.json().catch(() => ({}));
      const planBody = await planRes.json().catch(() => ({}));
      if (!catRes.ok) throw new Error(catBody.error || `Failed to load categories (HTTP ${catRes.status}).`);
      if (!resRes.ok) throw new Error(resBody.error || `Failed to load resources (HTTP ${resRes.status}).`);
      setCategories(catBody.entries || []);
      setResources(resBody.entries || []);
      const grouped: Record<string, string[]> = {};
      for (const p of (planBody.entries || []) as { planName: string; insurerName?: string }[]) {
        if (!p.insurerName) continue;
        const key = p.insurerName.trim().toLowerCase();
        if (!grouped[key]) grouped[key] = [];
        if (!grouped[key].includes(p.planName)) grouped[key].push(p.planName);
      }
      setPlansByInsurer(grouped);
    } catch (err: any) {
      setLoadError(err.message || "Failed to load the Knowledge Base.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  // ── Add category ──────────────────────────────────────────────────────
  const [addingCategory, setAddingCategory] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [newCategoryType, setNewCategoryType] = useState<"insurer" | "general">("insurer");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const addCategory = async () => {
    const name = newCategoryName.trim();
    if (!name) { setSaveError("Enter a category name before adding it."); return; }
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch("/api/kb/categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, type: newCategoryType, sortOrder: newCategoryType === "general" ? 999 : 0 }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Failed to add category (HTTP ${res.status}).`);
      logAction("Knowledge Base Category Added", `Added "${body.category.name}" (${body.category.type}).`);
      setAddingCategory(false);
      setNewCategoryName("");
      setNewCategoryType("insurer");
      await load();
    } catch (err: any) {
      setSaveError(err.message || "Failed to add category. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const deleteCategory = async (category: KbCategory) => {
    const inCategory = resources.filter(r => r.categoryId === category.id);
    if (inCategory.length > 0) {
      window.alert(`"${category.name}" has ${inCategory.length} resource(s) in it. Delete or move those first.`);
      return;
    }
    if (!window.confirm(`Delete the "${category.name}" category?`)) return;
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch(`/api/kb/categories/${category.id}`, { method: "DELETE" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Failed to delete category (HTTP ${res.status}).`);
      logAction("Knowledge Base Category Deleted", `Deleted "${category.name}".`);
      await load();
    } catch (err: any) {
      setSaveError(err.message || "Failed to delete category. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  // ── Manage this category's plan-name roster (the suggestion source for
  //    tagging its documents below) ───────────────────────────────────────
  const [categoryPlanInputById, setCategoryPlanInputById] = useState<Record<number, string>>({});
  const [categoryPlanSavingId, setCategoryPlanSavingId] = useState<number | null>(null);

  const saveCategoryPlanNames = async (category: KbCategory, nextNames: string[]) => {
    setCategoryPlanSavingId(category.id);
    setSaveError(null);
    try {
      const res = await fetch(`/api/kb/categories/${category.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planNames: nextNames }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Failed to update plan names (HTTP ${res.status}).`);
      setCategories(prev => prev.map(c => (c.id === category.id ? body.category : c)));
    } catch (err: any) {
      setSaveError(err.message || "Failed to update plan names. Please try again.");
    } finally {
      setCategoryPlanSavingId(null);
    }
  };

  const addCategoryPlanName = (category: KbCategory, rawName: string) => {
    const name = rawName.trim();
    if (!name) return;
    if (category.planNames.some(n => n.toLowerCase() === name.toLowerCase())) {
      setCategoryPlanInputById(prev => ({ ...prev, [category.id]: "" }));
      return;
    }
    const nextNames = [...category.planNames, name];
    logAction("Knowledge Base Plan Added", `Added plan "${name}" under "${category.name}".`);
    setCategoryPlanInputById(prev => ({ ...prev, [category.id]: "" }));
    saveCategoryPlanNames(category, nextNames);
  };

  const removeCategoryPlanName = (category: KbCategory, name: string) => {
    const nextNames = category.planNames.filter(n => n !== name);
    logAction("Knowledge Base Plan Removed", `Removed plan "${name}" from "${category.name}".`);
    saveCategoryPlanNames(category, nextNames);
  };

  // ── Upload PDF ─────────────────────────────────────────────────────────
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadTargetCategoryId, setUploadTargetCategoryId] = useState<number | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadSuccess, setUploadSuccess] = useState<string | null>(null);

  const triggerUpload = (categoryId: number) => {
    setUploadTargetCategoryId(categoryId);
    setUploadError(null);
    setUploadSuccess(null);
    fileInputRef.current?.click();
  };

  const handleFileChosen = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file later
    if (!file || uploadTargetCategoryId === null) return;
    setUploading(true);
    setUploadError(null);
    setUploadSuccess(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("categoryId", String(uploadTargetCategoryId));
      formData.append("title", file.name);
      const res = await fetch("/api/kb/resources/upload", { method: "POST", body: formData });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Failed to process "${file.name}" (HTTP ${res.status}).`);
      const category = categories.find(c => c.id === uploadTargetCategoryId);
      logAction("Knowledge Base Document Added", `Uploaded "${file.name}" to "${category?.name || "a category"}" — ${body.chunkCount} chunk(s) embedded.`);
      setUploadSuccess(`"${file.name}" processed — ${body.chunkCount} chunk(s) embedded.`);
      await load();
    } catch (err: any) {
      setUploadError(err.message || `Failed to process "${file.name}".`);
    } finally {
      setUploading(false);
    }
  };

  const [movingResourceId, setMovingResourceId] = useState<number | null>(null);

  const moveResource = async (resource: KbResource, newCategoryId: number) => {
    if (newCategoryId === resource.categoryId) return;
    const fromName = categories.find(c => c.id === resource.categoryId)?.name || "Unknown";
    const toName = categories.find(c => c.id === newCategoryId)?.name || "Unknown";
    setMovingResourceId(resource.id);
    setSaveError(null);
    try {
      const res = await fetch(`/api/kb/resources/${resource.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ categoryId: newCategoryId }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Failed to move resource (HTTP ${res.status}).`);
      logAction("Knowledge Base Document Moved", `Moved "${resource.title}" from "${fromName}" to "${toName}".`);
      await load();
    } catch (err: any) {
      setSaveError(err.message || "Failed to move document. Please try again.");
    } finally {
      setMovingResourceId(null);
    }
  };

  // ── Plan tags (multi-plan tagging within an insurer category) ──────────
  const [tagInputByResource, setTagInputByResource] = useState<Record<number, string>>({});
  const [tagSavingResourceId, setTagSavingResourceId] = useState<number | null>(null);

  const saveTags = async (resource: KbResource, nextTags: string[]) => {
    setTagSavingResourceId(resource.id);
    setSaveError(null);
    try {
      const res = await fetch(`/api/kb/resources/${resource.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planTags: nextTags }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Failed to update tags (HTTP ${res.status}).`);
      setResources(prev => prev.map(r => (r.id === resource.id ? body.resource : r)));
    } catch (err: any) {
      setSaveError(err.message || "Failed to update plan tags. Please try again.");
    } finally {
      setTagSavingResourceId(null);
    }
  };

  const addPlanTag = (resource: KbResource, rawTag: string) => {
    const tag = rawTag.trim();
    if (!tag) return;
    if (resource.planTags.some(t => t.toLowerCase() === tag.toLowerCase())) {
      setTagInputByResource(prev => ({ ...prev, [resource.id]: "" }));
      return;
    }
    const nextTags = [...resource.planTags, tag];
    logAction("Knowledge Base Document Tagged", `Tagged "${resource.title}" with "${tag}".`);
    setTagInputByResource(prev => ({ ...prev, [resource.id]: "" }));
    saveTags(resource, nextTags);
  };

  const removePlanTag = (resource: KbResource, tag: string) => {
    const nextTags = resource.planTags.filter(t => t !== tag);
    logAction("Knowledge Base Document Untagged", `Removed "${tag}" from "${resource.title}".`);
    saveTags(resource, nextTags);
  };

  const deleteResource = async (resource: KbResource) => {
    if (!window.confirm(`Delete "${resource.title}" from the Knowledge Base? This cannot be undone.`)) return;
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch(`/api/kb/resources/${resource.id}`, { method: "DELETE" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Failed to delete resource (HTTP ${res.status}).`);
      logAction("Knowledge Base Document Deleted", `Deleted "${resource.title}".`);
      await load();
    } catch (err: any) {
      setSaveError(err.message || "Failed to delete resource. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const inputClass = `w-full px-3 py-2 rounded-lg text-xs font-medium border outline-none transition-colors ${
    dark ? "bg-white/[0.04] border-white/[0.1] text-white placeholder:text-stone-500 focus:border-sky-500/50" : "bg-white border-stone-300 text-stone-900 placeholder:text-stone-400 focus:border-sky-500"
  }`;
  const cardClass = dark ? "bg-white/[0.03] border-white/[0.08]" : "bg-white border-stone-200";

  if (loading) {
    return <div className="text-xs font-semibold text-content-muted py-8 text-center">Loading Knowledge Base…</div>;
  }

  return (
    <div className="space-y-5 pb-6">
      <input ref={fileInputRef} type="file" accept="application/pdf" className="hidden" onChange={handleFileChosen} />

      {loadError && (
        <div className={`text-xs font-semibold px-3 py-2 rounded-lg border flex items-center gap-2 ${dark ? "bg-red-500/10 border-red-500/30 text-red-300" : "bg-red-50 border-red-200 text-red-700"}`}>
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" /> {loadError}
        </div>
      )}
      {saveError && (
        <div className={`text-xs font-semibold px-3 py-2 rounded-lg border flex items-center gap-2 ${dark ? "bg-red-500/10 border-red-500/30 text-red-300" : "bg-red-50 border-red-200 text-red-700"}`}>
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" /> {saveError}
        </div>
      )}
      {uploadError && (
        <div className={`text-xs font-semibold px-3 py-2 rounded-lg border flex items-center gap-2 ${dark ? "bg-red-500/10 border-red-500/30 text-red-300" : "bg-red-50 border-red-200 text-red-700"}`}>
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" /> {uploadError}
        </div>
      )}
      {uploadSuccess && (
        <div className={`text-xs font-semibold px-3 py-2 rounded-lg border flex items-center gap-2 ${dark ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-300" : "bg-emerald-50 border-emerald-200 text-emerald-700"}`}>
          <CheckCircle2 className="w-3.5 h-3.5 shrink-0" /> {uploadSuccess}
        </div>
      )}
      {uploading && (
        <div className={`text-xs font-semibold px-3 py-2 rounded-lg border flex items-center gap-2 ${dark ? "bg-sky-500/10 border-sky-500/30 text-sky-300" : "bg-sky-50 border-sky-200 text-sky-700"}`}>
          <RefreshCw className="w-3.5 h-3.5 shrink-0 animate-spin" /> Extracting, chunking, and embedding — this can take a minute for a long policy wording PDF.
        </div>
      )}

      {canManage && (
        <div className={`rounded-xl border p-4 ${cardClass}`}>
          {!addingCategory ? (
            <ClippedButton size="md" onClick={() => setAddingCategory(true)} className="bg-[var(--tab-active-bg)] text-[var(--tab-active-text)] px-4 py-2 text-[11px] font-black uppercase tracking-wider flex items-center gap-2">
              <Plus className="w-3.5 h-3.5" /> Add Category
            </ClippedButton>
          ) : (
            <div className="flex flex-col sm:flex-row items-stretch sm:items-end gap-3">
              <div className="flex-1 min-w-[180px]">
                <label className="block text-[10px] font-bold uppercase tracking-wide text-content-muted mb-1">Category name</label>
                <input className={inputClass} value={newCategoryName} onChange={e => setNewCategoryName(e.target.value)} placeholder='e.g. "Bajaj Allianz" or "General / Others"' autoFocus />
              </div>
              <div className="w-full sm:w-40">
                <label className="block text-[10px] font-bold uppercase tracking-wide text-content-muted mb-1">Type</label>
                <CustomSelect
                  theme={theme}
                  value={newCategoryType}
                  onChange={v => setNewCategoryType(v as "insurer" | "general")}
                  options={[{ value: "insurer", label: "Insurer" }, { value: "general", label: "General / Others" }]}
                />
              </div>
              <div className="flex gap-2">
                <ClippedButton size="md" onClick={addCategory} disabled={saving} className="bg-[var(--tab-active-bg)] text-[var(--tab-active-text)] px-4 py-2 text-[11px] font-black uppercase tracking-wider">
                  {saving ? "Adding…" : "Add"}
                </ClippedButton>
                <ClippedButton size="md" onClick={() => { setAddingCategory(false); setNewCategoryName(""); setSaveError(null); }} className={dark ? "bg-white/[0.06] text-stone-300 px-4 py-2 text-[11px] font-black uppercase tracking-wider" : "bg-stone-100 text-stone-600 px-4 py-2 text-[11px] font-black uppercase tracking-wider"}>
                  Cancel
                </ClippedButton>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="space-y-3">
        {categories.length === 0 && (
          <div className="text-xs font-semibold text-content-muted py-8 text-center">No categories yet — add one above to start uploading documents.</div>
        )}
        {categories.map(category => {
          const catResources = resources.filter(r => r.categoryId === category.id);
          const expanded = expandedCategoryId === category.id;
          return (
            <div key={category.id} className={`rounded-xl border overflow-hidden ${cardClass}`}>
              <button
                type="button"
                onClick={() => setExpandedCategoryId(expanded ? null : category.id)}
                className={`w-full flex items-center justify-between px-4 py-3 text-left cursor-pointer transition-colors ${dark ? "hover:bg-white/[0.03]" : "hover:bg-stone-50"}`}
              >
                <div className="flex items-center gap-2.5">
                  {expanded ? <ChevronDown className="w-4 h-4 shrink-0 text-content-muted" /> : <ChevronRight className="w-4 h-4 shrink-0 text-content-muted" />}
                  <span className={`text-sm font-bold ${dark ? "text-white" : "text-stone-900"}`}>{category.name}</span>
                  <span className={`text-[9.5px] font-bold uppercase tracking-wide px-2 py-0.5 rounded border ${dark ? "bg-white/[0.06] text-stone-400 border-white/[0.1]" : "bg-stone-100 text-stone-600 border-stone-200"}`}>
                    {category.type === "insurer" ? "Insurer" : "General"}
                  </span>
                  <span className="text-[10.5px] font-semibold text-content-muted">{catResources.length} document{catResources.length === 1 ? "" : "s"}</span>
                </div>
                {canManage && (
                  <span className="flex items-center gap-1.5" onClick={e => e.stopPropagation()}>
                    <ClippedButton size="sm" title="Upload a PDF to this category" onClick={() => triggerUpload(category.id)} className={dark ? "bg-sky-500/15 text-sky-300 px-2.5 py-1.5" : "bg-sky-50 text-sky-700 px-2.5 py-1.5"}>
                      <Upload className="w-3.5 h-3.5" />
                    </ClippedButton>
                    <ClippedButton size="sm" title="Delete category" onClick={() => deleteCategory(category)} className={dark ? "bg-red-500/15 text-red-300 px-2.5 py-1.5" : "bg-red-50 text-red-700 px-2.5 py-1.5"}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </ClippedButton>
                  </span>
                )}
              </button>
              {expanded && (
                <div className={`px-4 pb-4 pt-1 border-t ${dark ? "border-white/[0.06]" : "border-stone-100"}`}>
                  {category.type === "insurer" && (
                    <div className={`mt-3 mb-1 p-3 rounded-lg border ${dark ? "bg-white/[0.02] border-white/[0.06]" : "bg-stone-50 border-stone-100"}`}>
                      <div className="flex items-center gap-1.5 mb-1.5">
                        <Tag className="w-3 h-3 shrink-0 text-content-muted" />
                        <span className="text-[10px] font-bold uppercase tracking-wide text-content-muted">Plans under {category.name}</span>
                        <span className="text-[10px] font-semibold text-content-muted">— the suggestions offered when tagging a document below</span>
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5">
                        {category.planNames.length === 0 && (
                          <span className="text-[10.5px] font-semibold text-content-muted italic">No plans added yet.</span>
                        )}
                        {category.planNames.map(name => (
                          <span key={name} className={`inline-flex items-center gap-1 pl-2 pr-1 py-0.5 rounded text-[10.5px] font-bold border ${dark ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/30" : "bg-emerald-50 text-emerald-700 border-emerald-200"}`}>
                            {name}
                            {canManage && (
                              <button type="button" onClick={() => removeCategoryPlanName(category, name)} disabled={categoryPlanSavingId === category.id} className="hover:opacity-70 cursor-pointer" title={`Remove "${name}"`}>
                                <X className="w-2.5 h-2.5" />
                              </button>
                            )}
                          </span>
                        ))}
                        {canManage && (
                          <>
                            <input
                              value={categoryPlanInputById[category.id] || ""}
                              onChange={e => setCategoryPlanInputById(prev => ({ ...prev, [category.id]: e.target.value }))}
                              onKeyDown={e => {
                                if (e.key === "Enter") { e.preventDefault(); addCategoryPlanName(category, categoryPlanInputById[category.id] || ""); }
                              }}
                              placeholder="Add plan name…"
                              disabled={categoryPlanSavingId === category.id}
                              className={`w-32 px-1.5 py-0.5 rounded text-[10.5px] font-semibold border outline-none ${
                                dark ? "bg-white/[0.04] border-white/[0.1] text-white placeholder:text-stone-500" : "bg-white border-stone-300 text-stone-900 placeholder:text-stone-400"
                              }`}
                            />
                            {(plansByInsurer[category.name.trim().toLowerCase()] || [])
                              .filter(p => !category.planNames.some(n => n.toLowerCase() === p.toLowerCase()))
                              .map(s => (
                                <button
                                  key={s}
                                  type="button"
                                  onClick={() => addCategoryPlanName(category, s)}
                                  disabled={categoryPlanSavingId === category.id}
                                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10.5px] font-semibold border border-dashed cursor-pointer transition-colors ${
                                    dark ? "text-stone-400 border-white/[0.15] hover:bg-white/[0.06]" : "text-stone-500 border-stone-300 hover:bg-stone-100"
                                  }`}
                                  title={`Quick-add "${s}" (from Plan Management)`}
                                >
                                  <Plus className="w-2.5 h-2.5" /> {s}
                                </button>
                              ))}
                          </>
                        )}
                      </div>
                    </div>
                  )}
                  {catResources.length === 0 ? (
                    <div className="text-[11px] font-semibold text-content-muted py-4 text-center">No documents yet — click the upload icon above to add one.</div>
                  ) : (
                    <div className="space-y-1.5 mt-2">
                      {catResources.map(resource => {
                        const suggestions = category.planNames.filter(
                          p => !resource.planTags.some(t => t.toLowerCase() === p.toLowerCase())
                        );
                        return (
                        <div key={resource.id} className={`px-3 py-2 rounded-lg space-y-1.5 ${dark ? "bg-white/[0.02]" : "bg-stone-50"}`}>
                          <div className="flex items-center justify-between gap-3">
                            <div className="flex items-center gap-2.5 min-w-0">
                              <FileText className="w-3.5 h-3.5 shrink-0 text-content-muted" />
                              <span className={`text-xs font-semibold truncate ${dark ? "text-stone-200" : "text-stone-800"}`} title={resource.title}>{resource.title}</span>
                              {statusBadge(resource.status, dark)}
                              {resource.status === "active" && <span className="text-[10px] font-semibold text-content-muted whitespace-nowrap">{resource.chunkCount} chunks</span>}
                              {resource.status === "error" && resource.errorMessage && (
                                <span className="text-[10px] font-semibold text-red-400 truncate" title={resource.errorMessage}>{resource.errorMessage}</span>
                              )}
                            </div>
                            {canManage && (
                              <div className="flex items-center gap-1.5 shrink-0">
                                <div className="w-40">
                                  <CustomSelect
                                    theme={theme}
                                    value={String(resource.categoryId)}
                                    onChange={v => moveResource(resource, Number(v))}
                                    options={categories.map(c => ({ value: String(c.id), label: c.name }))}
                                    disabled={movingResourceId === resource.id}
                                    triggerClassName={`w-full px-2 py-1 rounded-lg text-[10.5px] font-semibold border flex items-center justify-between gap-1 cursor-pointer ${
                                      dark ? "bg-white/[0.04] border-white/[0.1] text-stone-300" : "bg-white border-stone-300 text-stone-700"
                                    }`}
                                  />
                                </div>
                                <ClippedButton size="sm" title="Delete document" onClick={() => deleteResource(resource)} className={dark ? "bg-red-500/10 text-red-300 px-2 py-1 shrink-0" : "bg-red-50 text-red-600 px-2 py-1 shrink-0"}>
                                  <Trash2 className="w-3 h-3" />
                                </ClippedButton>
                              </div>
                            )}
                          </div>

                          {/* Plan tags — only meaningful within an insurer
                              category; a document with no tags is treated
                              (by the future query endpoint) as applying
                              broadly to every plan under this insurer. */}
                          {category.type === "insurer" && (
                            <div className="flex flex-wrap items-center gap-1.5 pl-6">
                              <Tag className="w-3 h-3 shrink-0 text-content-muted" />
                              {resource.planTags.length === 0 && (
                                <span className="text-[10px] font-semibold text-content-muted italic">No plan tags — applies to all {category.name} plans</span>
                              )}
                              {resource.planTags.map(tag => (
                                <span key={tag} className={`inline-flex items-center gap-1 pl-2 pr-1 py-0.5 rounded text-[10px] font-bold border ${dark ? "bg-sky-500/15 text-sky-300 border-sky-500/30" : "bg-sky-50 text-sky-700 border-sky-200"}`}>
                                  {tag}
                                  {canManage && (
                                    <button type="button" onClick={() => removePlanTag(resource, tag)} disabled={tagSavingResourceId === resource.id} className="hover:opacity-70 cursor-pointer" title={`Remove "${tag}"`}>
                                      <X className="w-2.5 h-2.5" />
                                    </button>
                                  )}
                                </span>
                              ))}
                              {canManage && (
                                <>
                                  <input
                                    value={tagInputByResource[resource.id] || ""}
                                    onChange={e => setTagInputByResource(prev => ({ ...prev, [resource.id]: e.target.value }))}
                                    onKeyDown={e => {
                                      if (e.key === "Enter") { e.preventDefault(); addPlanTag(resource, tagInputByResource[resource.id] || ""); }
                                    }}
                                    placeholder="Add plan tag…"
                                    disabled={tagSavingResourceId === resource.id}
                                    className={`w-28 px-1.5 py-0.5 rounded text-[10px] font-semibold border outline-none ${
                                      dark ? "bg-white/[0.04] border-white/[0.1] text-white placeholder:text-stone-500" : "bg-white border-stone-300 text-stone-900 placeholder:text-stone-400"
                                    }`}
                                  />
                                  {suggestions.map(s => (
                                    <button
                                      key={s}
                                      type="button"
                                      onClick={() => addPlanTag(resource, s)}
                                      disabled={tagSavingResourceId === resource.id}
                                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold border border-dashed cursor-pointer transition-colors ${
                                        dark ? "text-stone-400 border-white/[0.15] hover:bg-white/[0.06]" : "text-stone-500 border-stone-300 hover:bg-stone-100"
                                      }`}
                                      title={`Quick-add "${s}"`}
                                    >
                                      <Plus className="w-2.5 h-2.5" /> {s}
                                    </button>
                                  ))}
                                </>
                              )}
                            </div>
                          )}
                        </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
