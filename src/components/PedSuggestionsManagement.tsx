/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { Pencil, Save, X, Trash2, Plus, RefreshCw, ShieldCheck, AlertTriangle, Search, Download } from "lucide-react";
import { LoggedUser } from "../types/user";
import { ChangeLogEntry } from "../types/changeLog";
import { CATEGORY_LABELS } from "../types.js";
import { ClippedButton } from "./ClippedButton";
import { CustomSelect } from "./CustomSelect";
import { SortableTh } from "./SortableTh";
import { Pagination } from "./Pagination";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import { useServerSort } from "../hooks/useServerSort";
import { formatDateDMY } from "../utils/dateFormat";
import { useDialog } from "../hooks/useDialog";

interface PedSuggestionEntry {
  id: number;
  term: string;
  // categoryKey (e.g. "diabetes") or null if not yet assigned — see
  // CATEGORY_LABELS in types.ts for the full key -> human label map. LIVE:
  // setting this promotes the term into ped_mapping_overrides on the server,
  // which is merged into TOP_PED_DICTIONARY (types.ts) for every plan — see
  // promotePedMappingOverride in server.ts. Clearing it or deleting the
  // entry un-promotes it the same way.
  category: string | null;
  addedBy: string;
  createdAt: string;
}

interface PedSuggestionsManagementProps {
  theme: "light" | "dark";
  effectiveTier: "General" | "Admin" | "Platform Admin" | "Developer";
  currentUser: LoggedUser | null;
  setChangeLogs: Dispatch<SetStateAction<ChangeLogEntry[]>>;
  /** Whether the caller can add/edit/delete entries here — resolved from
   * hasAccess("ped_suggestions", "Editor") in App.tsx (2026-09 permission
   * architecture fix). This legacy page shares the same "ped_suggestions"
   * feature id and the same /api/ped-suggestions routes as
   * PedRepositoryManagement (which replaced it in the actual PED Repository
   * tab) — see that component's own doc comment. */
  canManage: boolean;
}

const PAGE_SIZE = 50;

// Same categoryKey set the live matching engine already resolves PEDs to
// (types.ts's CATEGORY_LABELS) — reused here as the dropdown's option list
// so a category assigned in the PED Directory is guaranteed to be a value
// the engine would recognize if a future pass promotes it into
// TOP_PED_DICTIONARY, rather than free text that could drift or typo.
const CATEGORY_OPTIONS = Object.entries(CATEGORY_LABELS)
  .map(([key, label]) => ({ key, label }))
  .sort((a, b) => a.label.localeCompare(b.label));

/**
 * Renders the "Added By" provenance as a labelled badge instead of the raw
 * stored string, so an entry's ORIGIN stays visible for its whole life:
 *
 *   System (Seed)          — original bulk-seeded directory terms
 *   System (Cleanup)       — added by a maintenance/cleanup migration
 *   AI Generated (Pending) — created from an AI answer, awaiting review
 *   AI Generated (Approved)— same entry after an admin approved it
 *   <name> (Admin/Developer)   — hand-added by a person
 *
 * The AI variants deliberately keep the "AI Generated" prefix after
 * approval: approval changes the review STATE, never the fact that the entry
 * originated from AI. The underlying stored value is untouched — this is a
 * presentation mapping only.
 */
function renderAddedBy(addedBy: string, dark: boolean) {
  const raw = String(addedBy || "").trim();
  const lower = raw.toLowerCase();

  let label = raw || "—";
  let tone: "system" | "ai-pending" | "ai-approved" | "human" = "human";

  if (lower.includes("ai generated") || lower.startsWith("ai ")) {
    if (lower.includes("approved")) {
      label = "AI Generated (Approved)";
      tone = "ai-approved";
    } else {
      label = "AI Generated (Pending)";
      tone = "ai-pending";
    }
  } else if (lower.includes("system")) {
    label = lower.includes("cleanup") ? "System (Cleanup)" : "System (Seed)";
    tone = "system";
  }

  const cls =
    tone === "ai-approved"
      ? dark
        ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/30"
        : "bg-emerald-50 text-emerald-700 border-emerald-200"
      : tone === "ai-pending"
      ? dark
        ? "bg-amber-500/15 text-amber-300 border-amber-500/30"
        : "bg-amber-50 text-amber-700 border-amber-200"
      : tone === "system"
      ? dark
        ? "bg-white/[0.06] text-stone-400 border-white/[0.1]"
        : "bg-stone-100 text-stone-600 border-stone-200"
      : dark
      ? "bg-sky-500/10 text-sky-300 border-sky-500/25"
      : "bg-sky-50 text-sky-700 border-sky-200";

  return (
    <span
      title={raw}
      className={`inline-flex items-center px-2 py-0.5 rounded text-[9.5px] font-bold uppercase tracking-wide border whitespace-nowrap ${cls}`}
    >
      {label}
    </span>
  );
}

/**
 * Admin management UI for the `ped_directory` table (renamed from
 * `ped_suggestions` via migration 0010 to match this page's "PED
 * Directory" label), the dropdown/autocomplete source list on the Lookup
 * page (see App.tsx's fetchPedSuggestions), now also tracking an optional
 * mapping category per term, with category filtering and CSV export.
 *
 * Assigning a category here is LIVE: it's promoted into ped_mapping_overrides
 * and merged into TOP_PED_DICTIONARY (types.ts) for every plan, the same
 * live path as the Lookup page's "teach it" flow (see promotePedMappingOverride
 * in server.ts). Renaming a term or clearing/removing its category un-promotes
 * the old mapping. Leaving the category unset keeps an entry exactly what it
 * always was: a directory/autocomplete-only listing with no classification
 * effect.
 *
 * Read access is open to any signed-in user via GET /api/ped-suggestions;
 * writes go through requireFeatureAccess("ped_suggestions", "Editor", ...)
 * server-side (2026-09 permission architecture fix — previously
 * requireAdminOrDeveloper, a hardcoded tier check), matching this
 * component's own canManage prop.
 *
 * Seeded with ~1,223 terms, so this list is paginated (PAGE_SIZE) rather
 * than rendered flat like the much smaller User Directory table.
 */
export function PedSuggestionsManagement({ theme, effectiveTier, currentUser, setChangeLogs, canManage }: PedSuggestionsManagementProps) {
  const dark = theme === "dark";
  const { confirm } = useDialog();

  const logAction = (actionType: string, description: string) => {
    setChangeLogs(prev => [
      {
        id: `log-${Date.now()}`,
        timestamp: new Date().toISOString(),
        userName: currentUser?.name || currentUser?.email || "Mehruf P (Developer)",
        role: effectiveTier,
        actionType,
        planName: "PED Directory",
        description,
      },
      ...prev,
    ]);
  };

  // `entries` holds only the CURRENT PAGE now — search/filter/sort/paging
  // all happen server-side (GET /api/ped-suggestions?paginated=1&...), never
  // by loading the full ~1,223-row directory into the browser.
  const [entries, setEntries] = useState<PedSuggestionEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  const [editingId, setEditingId] = useState<number | null>(null);
  const [draftTerm, setDraftTerm] = useState("");
  const [draftCategory, setDraftCategory] = useState("");
  const [addingNew, setAddingNew] = useState(false);
  const [newTerm, setNewTerm] = useState("");
  const [newCategory, setNewCategory] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const searchQuery = useDebouncedValue(searchInput, 350);
  // "all" | "uncategorized" | a categoryKey (e.g. "diabetes") — combined
  // with searchQuery below rather than replacing it, so an admin can search
  // within a category.
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [page, setPage] = useState(1);
  const { sort: entriesSort, toggleSort: toggleEntriesSort } = useServerSort();

  // Distinct categories actually present in the directory (plus whether any
  // entry is uncategorized) — fetched once from a lightweight dedicated
  // endpoint rather than derived from a full table load, so the filter
  // dropdown never offers a category with zero matching entries.
  const [categoriesInUse, setCategoriesInUse] = useState<{ list: { key: string; label: string }[]; hasUncategorized: boolean }>({
    list: [],
    hasUncategorized: false,
  });

  const refreshCategoriesInUse = () => {
    fetch("/api/ped-suggestions/categories")
      .then(res => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then(data => {
        const list = (Array.isArray(data.categories) ? data.categories : [])
          .map((key: string) => ({ key, label: CATEGORY_LABELS[key] || key }))
          .sort((a: { label: string }, b: { label: string }) => a.label.localeCompare(b.label));
        setCategoriesInUse({ list, hasUncategorized: Boolean(data.hasUncategorized) });
      })
      .catch(() => {
        // Non-critical — the filter dropdown just falls back to whatever it
        // last had (or "All categories" only, on first load) if this fails.
      });
  };

  useEffect(() => {
    refreshCategoriesInUse();
    // Runs once on mount; also re-invoked after add/edit/delete below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const hasActiveFilter = Boolean(searchQuery) || categoryFilter !== "all";

  const loadEntries = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ paginated: "1", page: String(page), pageSize: String(PAGE_SIZE) });
      if (searchQuery) params.set("search", searchQuery);
      if (categoryFilter !== "all") params.set("category", categoryFilter);
      if (entriesSort) {
        params.set("sortBy", entriesSort.key);
        params.set("sortDir", entriesSort.direction);
      }
      const res = await fetch(`/api/ped-suggestions?${params.toString()}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Failed to load the PED directory (HTTP ${res.status}).`);
      }
      const data = await res.json();
      if (Array.isArray(data.entries)) {
        setEntries(data.entries);
        setTotal(data.total ?? 0);
        setTotalPages(data.totalPages ?? 1);
        // The server clamps an out-of-range page (e.g. right after a filter
        // shrinks the result set below the current page) — mirror that back
        // into local state so Previous/Next and the page indicator agree
        // with what's actually on screen.
        if (typeof data.page === "number" && data.page !== page) setPage(data.page);
        setSyncError(null);
      }
    } catch (err: any) {
      setSyncError(err.message || "Could not reach the server. Showing the last loaded list.");
    } finally {
      setLoading(false);
    }
  };

  // Filter/search/sort changes jump back to page 1; the fetch effect below
  // re-runs regardless (it depends on all of these plus `page`).
  useEffect(() => {
    setPage(1);
  }, [searchQuery, categoryFilter, entriesSort?.key, entriesSort?.direction]);

  useEffect(() => {
    loadEntries();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, searchQuery, categoryFilter, entriesSort?.key, entriesSort?.direction]);

  // Exports the currently filtered set (respects both search and the
  // category filter, NOT just the visible page) as a CSV — Term, Category,
  // Added By, Created At. Round-trips to the server since the client only
  // holds the current page.
  const downloadCsv = async () => {
    setExporting(true);
    setSaveError(null);
    try {
      const params = new URLSearchParams({ paginated: "1", export: "1" });
      if (searchQuery) params.set("search", searchQuery);
      if (categoryFilter !== "all") params.set("category", categoryFilter);
      if (entriesSort) {
        params.set("sortBy", entriesSort.key);
        params.set("sortDir", entriesSort.direction);
      }
      const res = await fetch(`/api/ped-suggestions?${params.toString()}`);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Failed to export the PED directory (HTTP ${res.status}).`);
      const exportRows: PedSuggestionEntry[] = Array.isArray(body.entries) ? body.entries : [];

      const escapeCell = (value: string) => {
        const s = String(value ?? "");
        return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      };
      const header = ["Term", "Category", "Added By", "Created At"];
      const rows = exportRows.map(e => [
        e.term,
        e.category ? (CATEGORY_LABELS[e.category] || e.category) : "Uncategorized",
        e.addedBy,
        e.createdAt ? formatDateDMY(e.createdAt) : "",
      ]);
      const csv = [header, ...rows].map(row => row.map(escapeCell).join(",")).join("\n");
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `ped-directory-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      logAction("PED Directory Exported", `Downloaded a CSV of ${exportRows.length.toLocaleString()} PED directory ${exportRows.length === 1 ? "entry" : "entries"}${hasActiveFilter ? " (filtered)" : ""}.`);
    } catch (err: any) {
      setSaveError(err.message || "Failed to export the PED directory. Please try again.");
    } finally {
      setExporting(false);
    }
  };

  const startEdit = (entry: PedSuggestionEntry) => {
    setEditingId(entry.id);
    setDraftTerm(entry.term);
    setDraftCategory(entry.category || "");
    setSaveError(null);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setDraftTerm("");
    setDraftCategory("");
  };

  const saveEdit = async () => {
    if (editingId === null || !draftTerm.trim()) return;
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch(`/api/ped-suggestions/${editingId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ term: draftTerm.trim(), category: draftCategory || null }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Failed to update this term (HTTP ${res.status}).`);
      const previousTerm = entries.find(e => e.id === editingId)?.term;
      logAction("PED Directory Entry Edited", `Updated "${previousTerm}" in the PED directory (now "${body.entry.term}", category: ${body.entry.category ? CATEGORY_LABELS[body.entry.category] || body.entry.category : "none"}).`);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 2500);
      setEditingId(null);
      setDraftTerm("");
      setDraftCategory("");
      // Refresh from the server rather than patching the in-memory page —
      // a category change can move this row out of the current filter/sort
      // position, and the category-filter dropdown's option list can change.
      await loadEntries();
      refreshCategoriesInUse();
    } catch (err: any) {
      setSaveError(err.message || "Failed to update this term. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const deleteEntry = async (entry: PedSuggestionEntry) => {
    if (!(await confirm(`Remove "${entry.term}" from the PED directory? This cannot be undone.`))) return;
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch(`/api/ped-suggestions/${entry.id}`, { method: "DELETE" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Failed to remove this term (HTTP ${res.status}).`);
      logAction("PED Directory Entry Deleted", `Removed "${entry.term}" from the PED directory.`);
      // Deleting the last row on a page (other than page 1) would otherwise
      // leave the view stuck on a now-empty page — loadEntries() re-fetches
      // page `page`, and the server clamps it back into range if needed.
      await loadEntries();
      refreshCategoriesInUse();
    } catch (err: any) {
      setSaveError(err.message || "Failed to remove this term. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const addEntry = async () => {
    const term = newTerm.trim();
    if (!term) {
      setSaveError("Enter a term before adding it to the directory.");
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch("/api/ped-suggestions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ term, category: newCategory || null }),
      });
      const body = await res.json().catch(() => ({}));
      // The server now returns a friendly 409 for a duplicate term (see
      // server.ts) — the old client-side pre-check relied on the full
      // directory being loaded in memory, which is no longer true now that
      // this list is server-paginated.
      if (!res.ok) throw new Error(body.error || `Failed to add this term (HTTP ${res.status}).`);
      logAction("PED Directory Entry Added", `Added "${body.entry.term}" to the PED directory${body.entry.category ? ` (category: ${CATEGORY_LABELS[body.entry.category] || body.entry.category})` : ""}.`);
      setAddingNew(false);
      setNewTerm("");
      setNewCategory("");
      setSearchInput("");
      setPage(1);
      await loadEntries();
      refreshCategoriesInUse();
    } catch (err: any) {
      setSaveError(err.message || "Failed to add this term. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const thClass = `px-3 py-2.5 text-left text-[9.5px] font-black uppercase tracking-wider whitespace-nowrap ${
    dark ? "text-stone-400" : "text-stone-500"
  }`;
  const tdClass = "px-3 py-2.5 align-top text-xs";
  const inputClass = `w-full text-[11px] px-2 py-1 rounded-lg border outline-none font-semibold ${
    dark ? "bg-[#060a12] border-stone-850 text-white focus:border-sky-500" : "bg-white border-stone-200 text-stone-900 focus:border-sky-400"
  }`;
  // Same look as inputClass, adapted for CustomSelect's trigger button.
  const selectTriggerClass = `w-full flex items-center justify-between gap-1 text-[11px] pl-2 pr-6 py-1 rounded-lg border outline-none font-semibold relative ${
    dark ? "bg-[#060a12] border-stone-850 text-white focus:border-sky-500" : "bg-white border-stone-200 text-stone-900 focus:border-sky-400"
  }`;
  const columnCount = canManage ? 4 : 3;

  return (
    <div className={`rounded-2xl border p-5 transition-all ${
      dark ? "bg-white/[0.03] border-white/[0.08]" : "bg-black/[0.02] border-black/[0.08]"
    }`}>
      <div className="space-y-4">
        {/* Title row: sync state | search field | add-term action — same
            single-line layout as ProfileAccessManagement's directory header. */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 shrink-0">
            {loading ? (
              <span className={`text-[11px] font-bold flex items-center gap-1.5 whitespace-nowrap ${dark ? "text-stone-400" : "text-stone-500"}`}>
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                Loading PED directory...
              </span>
            ) : syncError ? (
              <span className="text-[11px] font-bold flex items-center gap-1.5 whitespace-nowrap text-amber-500">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                {syncError}
              </span>
            ) : (
              <span className="text-[11px] font-bold flex items-center gap-1.5 whitespace-nowrap text-emerald-500">
                <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
                {total.toLocaleString()} {hasActiveFilter ? "matching terms" : "terms synced"}
              </span>
            )}
            {saving && (
              <span className={`text-[11px] font-bold flex items-center gap-1.5 whitespace-nowrap ${dark ? "text-stone-400" : "text-stone-500"}`}>
                <RefreshCw className="w-3.5 h-3.5 animate-spin" /> Saving...
              </span>
            )}
            {saveSuccess && (
              <span className="text-[11px] font-bold whitespace-nowrap text-emerald-500">Saved.</span>
            )}
          </div>

          <div className="relative flex-1 min-w-[180px]">
            <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-stone-400 pointer-events-none" />
            <input
              type="text"
              placeholder="Search PED terms..."
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              className={`w-full py-2 pl-10 pr-4 text-xs font-semibold rounded-lg border outline-none transition-all ${
                dark
                  ? "bg-[#060A10] border-stone-850 text-white focus:border-sky-500"
                  : "bg-white border-stone-250 text-stone-900 focus:border-sky-400 shadow-inner"
              }`}
            />
            {searchInput && (
              <button
                onClick={() => setSearchInput("")}
                className="absolute right-3.5 top-1/2 -translate-y-1/2 text-xs font-bold text-stone-400 hover:text-stone-100"
                title="Clear search"
              >
                &times;
              </button>
            )}
          </div>

          <div className="shrink-0 w-52">
            <CustomSelect
              theme={theme}
              value={categoryFilter}
              onChange={setCategoryFilter}
              triggerClassName={`w-full flex items-center justify-between gap-2 py-2 pl-3 pr-8 text-xs font-semibold rounded-lg border outline-none transition-all relative ${
                dark
                  ? "bg-[#060A10] border-stone-850 text-white focus:border-sky-500"
                  : "bg-white border-stone-250 text-stone-900 focus:border-sky-400 shadow-inner"
              }`}
              options={[
                { value: "all", label: "All categories" },
                ...(categoriesInUse.hasUncategorized ? [{ value: "uncategorized", label: "Uncategorized" }] : []),
                ...categoriesInUse.list.map(({ key, label }) => ({ value: key, label })),
              ]}
            />
          </div>

          <ClippedButton
            type="button"
            onClick={downloadCsv}
            disabled={total === 0 || exporting}
            cornerBg={dark ? "#0e2236" : "#ffffff"}
            style={{
              background: dark ? "#2A303C" : "#E7E5E4",
              color: dark ? "#F4F4F5" : "#292524",
            }}
            className="flex items-center gap-1.5 text-[10px] font-mono font-bold uppercase tracking-[0.15em] px-3 py-2 hover:brightness-110 shrink-0 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:brightness-100"
            title="Download the current list as CSV"
          >
            <Download className={`w-3.5 h-3.5 shrink-0 ${exporting ? "animate-pulse" : ""}`} />
            {exporting ? "Exporting..." : "Export"}
          </ClippedButton>

          {canManage && !addingNew && (
            <ClippedButton
              type="button"
              onClick={() => { setAddingNew(true); setSaveError(null); }}
              cornerBg={dark ? "#0e2236" : "#ffffff"}
              style={{
                backgroundColor: "var(--action-navy)",
                borderColor: "var(--action-navy)",
                color: "var(--on-action-navy)",
              }}
              className="flex items-center gap-1.5 text-[10px] font-mono font-bold uppercase tracking-[0.15em] px-3 py-2 border hover:brightness-110 shrink-0"
            >
              <Plus className="w-3.5 h-3.5 shrink-0" />
              Add PED
            </ClippedButton>
          )}
        </div>

        {saveError && (
          <div className="px-3 py-2 rounded-lg text-[11px] font-bold text-red-400 bg-red-500/10 border border-red-500/25 flex items-center gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
            {saveError}
          </div>
        )}

        <div className={`rounded-xl border overflow-x-auto ${dark ? "border-stone-850" : "border-stone-200"}`}>
          <table className="w-full border-collapse min-w-[640px]">
            <thead>
              <tr className={`border-b ${dark ? "bg-white/[0.02] border-stone-850" : "bg-[var(--table-header-bg)] border-stone-200"}`}>
                <SortableTh label="Term" sortKey="term" activeSort={entriesSort} onSort={toggleEntriesSort} className={thClass} />
                <SortableTh label="Category" sortKey="category" activeSort={entriesSort} onSort={toggleEntriesSort} className={thClass} />
                <SortableTh label="Added By" sortKey="addedBy" activeSort={entriesSort} onSort={toggleEntriesSort} className={thClass} />
                {canManage && <th className={`${thClass} text-right`}>Actions</th>}
              </tr>
            </thead>
            <tbody>
              {addingNew && (
                <tr className={`border-b ${dark ? "border-stone-850 bg-sky-950/10" : "border-stone-150 bg-accent-subtle"}`}>
                  <td className={tdClass}>
                    <input
                      className={inputClass}
                      placeholder="e.g. Hypothyroidism"
                      value={newTerm}
                      onChange={e => setNewTerm(e.target.value)}
                      onKeyDown={e => { if (e.key === "Enter") addEntry(); }}
                      autoFocus
                    />
                  </td>
                  <td className={tdClass}>
                    <CustomSelect
                      theme={theme}
                      value={newCategory}
                      onChange={setNewCategory}
                      placeholder="— No category —"
                      triggerClassName={selectTriggerClass}
                      options={CATEGORY_OPTIONS.map(({ key, label }) => ({ value: key, label }))}
                    />
                  </td>
                  <td className={`${tdClass} text-[10.5px] ${dark ? "text-stone-400" : "text-stone-500"}`}>
                    Set on save
                  </td>
                  <td className={`${tdClass} text-right`}>
                    <div className="flex items-center justify-end gap-1.5">
                      <ClippedButton onClick={addEntry} disabled={saving} cornerBg={dark ? "#0e2236" : "#f0f9ff"} className="p-1.5 bg-emerald-600 hover:bg-emerald-700 text-white" title="Save new term">
                        <Save className="w-3.5 h-3.5" />
                      </ClippedButton>
                      <ClippedButton onClick={() => { setAddingNew(false); setNewTerm(""); setNewCategory(""); setSaveError(null); }} cornerBg={dark ? "#0e2236" : "#f0f9ff"} className="p-1.5 bg-stone-700 hover:bg-stone-600 text-stone-50" title="Cancel">
                        <X className="w-3.5 h-3.5" />
                      </ClippedButton>
                    </div>
                  </td>
                </tr>
              )}

              {!loading && entries.length === 0 && (
                <tr>
                  <td colSpan={columnCount} className="py-10 text-center text-xs font-semibold text-stone-400">
                    {hasActiveFilter
                      ? searchQuery
                        ? `No directory entries match "${searchQuery}".`
                        : "No directory entries match this filter."
                      : "No directory entries yet."}
                  </td>
                </tr>
              )}

              {entries.map((entry, idx) => {
                const isEditing = editingId === entry.id;
                return (
                  <tr
                    key={entry.id}
                    className={`border-b last:border-b-0 align-top ${dark ? "border-stone-850" : "border-stone-150"} ${
                      idx % 2 === 1 ? (dark ? "bg-white/[0.015]" : "bg-surface-solid") : ""
                    }`}
                  >
                    <td className={tdClass}>
                      {isEditing ? (
                        <input
                          className={inputClass}
                          value={draftTerm}
                          onChange={e => setDraftTerm(e.target.value)}
                          onKeyDown={e => { if (e.key === "Enter") saveEdit(); }}
                          autoFocus
                        />
                      ) : (
                        <span className={`font-black ${dark ? "text-white" : "text-stone-900"}`}>{entry.term}</span>
                      )}
                    </td>
                    <td className={tdClass}>
                      {isEditing ? (
                        <CustomSelect
                          theme={theme}
                          value={draftCategory}
                          onChange={setDraftCategory}
                          placeholder="— No category —"
                          triggerClassName={selectTriggerClass}
                          options={CATEGORY_OPTIONS.map(({ key, label }) => ({ value: key, label }))}
                        />
                      ) : entry.category ? (
                        <span className={`px-2 py-0.5 rounded text-[10px] font-black uppercase border whitespace-nowrap ${
                          dark ? "bg-sky-500/15 text-sky-400 border-sky-500/30" : "bg-sky-500/10 text-sky-700 border-sky-500/25"
                        }`}>
                          {CATEGORY_LABELS[entry.category] || entry.category}
                        </span>
                      ) : (
                        <span className={`text-[10.5px] italic ${dark ? "text-stone-500" : "text-stone-400"}`}>Uncategorized</span>
                      )}
                    </td>
                    <td className={`${tdClass} text-[10.5px] ${dark ? "text-stone-400" : "text-stone-500"}`}>
                      {renderAddedBy(entry.addedBy, dark)}
                    </td>
                    {canManage && (
                      <td className={`${tdClass} text-right`}>
                        {isEditing ? (
                          <div className="flex items-center justify-end gap-1.5">
                            <ClippedButton onClick={saveEdit} disabled={saving} cornerBg={dark ? "#0e2236" : "#ffffff"} className="p-1.5 bg-emerald-600 hover:bg-emerald-700 text-white" title="Save">
                              <Save className="w-3.5 h-3.5" />
                            </ClippedButton>
                            <ClippedButton onClick={cancelEdit} cornerBg={dark ? "#0e2236" : "#ffffff"} className="p-1.5 bg-stone-700 hover:bg-stone-600 text-stone-50" title="Cancel">
                              <X className="w-3.5 h-3.5" />
                            </ClippedButton>
                          </div>
                        ) : (
                          <div className="flex items-center justify-end gap-1.5">
                            <ClippedButton
                              onClick={() => startEdit(entry)}
                              cornerBg={dark ? "#0e2236" : "#ffffff"}
                              className={`p-1.5 ${dark ? "hover:bg-sky-500/15 text-stone-400 hover:text-sky-400" : "hover:bg-sky-500/10 text-stone-500 hover:text-sky-600"}`}
                              title="Edit term"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </ClippedButton>
                            <ClippedButton
                              onClick={() => deleteEntry(entry)}
                              cornerBg={dark ? "#0e2236" : "#ffffff"}
                              className={`p-1.5 ${dark ? "hover:bg-red-500/15 text-stone-400 hover:text-red-400" : "hover:bg-red-500/10 text-stone-500 hover:text-red-600"}`}
                              title="Remove term"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </ClippedButton>
                          </div>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-[10.5px] font-semibold text-content-muted">
            Showing {total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1}
            {"–"}
            {Math.min(page * PAGE_SIZE, total)} of {total.toLocaleString()}
            {hasActiveFilter ? " matching entries" : " entries"}. {canManage ? "Changes are saved to the server, feed the Lookup page dropdown for every advisor, and — when a category is assigned — go live in classification for every plan." : "Admin or Developer clearance is required to add, edit, or remove entries."}
          </p>
          <Pagination theme={theme} page={page} totalPages={totalPages} onPageChange={setPage} />
        </div>
      </div>
    </div>
  );
}
