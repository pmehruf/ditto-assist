/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Fragment, useEffect, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import {
  Pencil, Save, X, Trash2, Plus, RefreshCw, ShieldCheck, AlertTriangle, Search, Download,
  ChevronDown, ChevronRight, Eye, EyeOff, Star,
} from "lucide-react";
import { LoggedUser } from "../types/user";
import { ChangeLogEntry } from "../types/changeLog";
import { ClippedButton } from "./ClippedButton";
import { CustomSelect } from "./CustomSelect";
import { SortableTh } from "./SortableTh";
import { Pagination } from "./Pagination";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import { useServerSort } from "../hooks/useServerSort";
import { formatDateDMY } from "../utils/dateFormat";

interface CategoryEntry {
  categoryKey: string;
  label: string;
}

interface PedEntry {
  id: number;
  pedCode: string;
  canonicalName: string;
  categoryKey: string | null;
  status: "draft" | "approved" | "deprecated";
  notes: string | null;
  addedBy: string;
  createdAt: string;
}

interface AliasEntry {
  id: number;
  pedId: number;
  aliasText: string;
  normalizedAlias: string;
  isPrimary: boolean;
  isVisible: boolean;
  addedBy: string;
  createdAt: string;
}

interface PedRepositoryManagementProps {
  theme: "light" | "dark";
  effectiveTier: "General" | "Admin" | "Platform Admin" | "Developer";
  currentUser: LoggedUser | null;
  setChangeLogs: Dispatch<SetStateAction<ChangeLogEntry[]>>;
}

const PAGE_SIZE = 50;

const STATUS_OPTIONS: { value: PedEntry["status"]; label: string }[] = [
  { value: "draft", label: "Draft" },
  { value: "approved", label: "Approved" },
  { value: "deprecated", label: "Deprecated" },
];

function statusBadge(status: PedEntry["status"], dark: boolean) {
  const cls =
    status === "approved"
      ? dark ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/30" : "bg-emerald-50 text-emerald-700 border-emerald-200"
      : status === "draft"
      ? dark ? "bg-amber-500/15 text-amber-300 border-amber-500/30" : "bg-amber-50 text-amber-700 border-amber-200"
      : dark ? "bg-white/[0.06] text-stone-400 border-white/[0.1]" : "bg-stone-100 text-stone-600 border-stone-200";
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-[9.5px] font-bold uppercase tracking-wide border whitespace-nowrap ${cls}`}>
      {status}
    </span>
  );
}

/**
 * Admin management UI for `ped_repository` / `ped_aliases` — the tables the
 * deterministic matching engine actually reads when PED_SOURCE=db (see
 * server.ts's getDbSource, src/server/pedRuntimeCache.ts). This REPLACES
 * PedSuggestionsManagement (the old `ped_directory`-backed page) as the tab
 * an admin reaches under "PED Repository": edits made here are the live
 * source of truth the engine classifies against, not a separate directory
 * that needs a further promotion step.
 *
 * Each PED has a canonical name + category + workflow status, plus a list
 * of aliases (every searchable text variant). An alias can be hidden
 * (isVisible=false) — a misspelling/OCR-variant/verb-form entry that keeps
 * matching silently but is never shown as if it were real terminology
 * (PED_REPOSITORY_GOVERNANCE.md's 3-layer model). Hidden aliases are always
 * rendered in a clearly separate, visually muted group for that reason.
 *
 * Every write here also mirrors into the legacy ped_mapping_overrides table
 * (server-side, see pedRepositoryLive.ts) purely as PED_SOURCE=legacy
 * rollback insurance — nothing in this component needs to know that.
 */
export function PedRepositoryManagement({ theme, effectiveTier, currentUser, setChangeLogs }: PedRepositoryManagementProps) {
  const dark = theme === "dark";
  const canManage = effectiveTier === "Admin" || effectiveTier === "Platform Admin" || effectiveTier === "Developer";

  const logAction = (actionType: string, description: string) => {
    setChangeLogs(prev => [
      {
        id: `log-${Date.now()}`,
        timestamp: new Date().toISOString(),
        userName: currentUser?.name || currentUser?.email || "Mehruf P (Developer)",
        role: effectiveTier,
        actionType,
        planName: "PED Repository",
        description,
      },
      ...prev,
    ]);
  };

  const [entries, setEntries] = useState<PedEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  const [categories, setCategories] = useState<CategoryEntry[]>([]);
  useEffect(() => {
    fetch("/api/ped-repository/categories")
      .then(res => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then(data => {
        const list = (Array.isArray(data.entries) ? data.entries : [])
          .map((c: any) => ({ categoryKey: c.categoryKey, label: c.label }))
          .sort((a: CategoryEntry, b: CategoryEntry) => a.label.localeCompare(b.label));
        setCategories(list);
      })
      .catch(() => { /* non-critical — dropdowns just stay empty */ });
  }, []);
  const categoryLabel = (key: string | null) => (key ? categories.find(c => c.categoryKey === key)?.label || key : null);
  const CATEGORY_OPTIONS = categories.map(c => ({ value: c.categoryKey, label: c.label }));

  const [editingId, setEditingId] = useState<number | null>(null);
  const [draftName, setDraftName] = useState("");
  const [draftCategory, setDraftCategory] = useState("");
  const [draftStatus, setDraftStatus] = useState<PedEntry["status"]>("approved");
  const [addingNew, setAddingNew] = useState(false);
  const [newName, setNewName] = useState("");
  const [newCategory, setNewCategory] = useState("");
  const [newStatus, setNewStatus] = useState<PedEntry["status"]>("approved");
  const [searchInput, setSearchInput] = useState("");
  const searchQuery = useDebouncedValue(searchInput, 350);
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [page, setPage] = useState(1);
  const { sort: entriesSort, toggleSort: toggleEntriesSort } = useServerSort();

  const hasActiveFilter = Boolean(searchQuery) || categoryFilter !== "all" || statusFilter !== "all";

  const loadEntries = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ paginated: "1", page: String(page), pageSize: String(PAGE_SIZE) });
      if (searchQuery) params.set("search", searchQuery);
      if (categoryFilter !== "all") params.set("categoryKey", categoryFilter);
      if (statusFilter !== "all") params.set("status", statusFilter);
      if (entriesSort) {
        params.set("sortBy", entriesSort.key);
        params.set("sortDir", entriesSort.direction);
      }
      const res = await fetch(`/api/ped-repository?${params.toString()}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Failed to load the PED repository (HTTP ${res.status}).`);
      }
      const data = await res.json();
      if (Array.isArray(data.entries)) {
        setEntries(data.entries);
        setTotal(data.total ?? 0);
        setTotalPages(data.totalPages ?? 1);
        if (typeof data.page === "number" && data.page !== page) setPage(data.page);
        setSyncError(null);
      }
    } catch (err: any) {
      setSyncError(err.message || "Could not reach the server. Showing the last loaded list.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setPage(1);
  }, [searchQuery, categoryFilter, statusFilter, entriesSort?.key, entriesSort?.direction]);

  useEffect(() => {
    loadEntries();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, searchQuery, categoryFilter, statusFilter, entriesSort?.key, entriesSort?.direction]);

  const downloadCsv = async () => {
    setExporting(true);
    setSaveError(null);
    try {
      const params = new URLSearchParams({ paginated: "1", export: "1" });
      if (searchQuery) params.set("search", searchQuery);
      if (categoryFilter !== "all") params.set("categoryKey", categoryFilter);
      if (statusFilter !== "all") params.set("status", statusFilter);
      const res = await fetch(`/api/ped-repository?${params.toString()}`);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Failed to export the PED repository (HTTP ${res.status}).`);
      const exportRows: PedEntry[] = Array.isArray(body.entries) ? body.entries : [];

      const escapeCell = (value: string) => {
        const s = String(value ?? "");
        return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      };
      const header = ["PED Code", "Canonical Name", "Category", "Status", "Added By", "Created At"];
      const rows = exportRows.map(e => [
        e.pedCode,
        e.canonicalName,
        e.categoryKey ? (categoryLabel(e.categoryKey) || e.categoryKey) : "Uncategorized",
        e.status,
        e.addedBy,
        e.createdAt ? formatDateDMY(e.createdAt) : "",
      ]);
      const csv = [header, ...rows].map(row => row.map(escapeCell).join(",")).join("\n");
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `ped-repository-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      logAction("PED Repository Exported", `Downloaded a CSV of ${exportRows.length.toLocaleString()} PED ${exportRows.length === 1 ? "entry" : "entries"}${hasActiveFilter ? " (filtered)" : ""}.`);
    } catch (err: any) {
      setSaveError(err.message || "Failed to export the PED repository. Please try again.");
    } finally {
      setExporting(false);
    }
  };

  const startEdit = (entry: PedEntry) => {
    setEditingId(entry.id);
    setDraftName(entry.canonicalName);
    setDraftCategory(entry.categoryKey || "");
    setDraftStatus(entry.status);
    setSaveError(null);
  };
  const cancelEdit = () => { setEditingId(null); setDraftName(""); setDraftCategory(""); };

  const saveEdit = async () => {
    if (editingId === null || !draftName.trim()) return;
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch(`/api/ped-repository/${editingId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ canonicalName: draftName.trim(), categoryKey: draftCategory || null, status: draftStatus }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Failed to update this PED (HTTP ${res.status}).`);
      const previousName = entries.find(e => e.id === editingId)?.canonicalName;
      logAction("PED Repository Entry Edited", `Updated "${previousName}" (now "${body.ped.canonicalName}", category: ${body.ped.categoryKey ? categoryLabel(body.ped.categoryKey) || body.ped.categoryKey : "none"}, status: ${body.ped.status}).`);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 2500);
      cancelEdit();
      await loadEntries();
    } catch (err: any) {
      setSaveError(err.message || "Failed to update this PED. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const deleteEntry = async (entry: PedEntry) => {
    if (!window.confirm(`Delete "${entry.canonicalName}" and all of its aliases from the PED Repository? This cannot be undone.`)) return;
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch(`/api/ped-repository/${entry.id}`, { method: "DELETE" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Failed to delete this PED (HTTP ${res.status}).`);
      logAction("PED Repository Entry Deleted", `Deleted "${entry.canonicalName}" and all of its aliases.`);
      if (expandedId === entry.id) setExpandedId(null);
      await loadEntries();
    } catch (err: any) {
      setSaveError(err.message || "Failed to delete this PED. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const addEntry = async () => {
    const name = newName.trim();
    if (!name) { setSaveError("Enter a canonical name before adding it."); return; }
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch("/api/ped-repository", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ canonicalName: name, categoryKey: newCategory || null, status: newStatus }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Failed to add this PED (HTTP ${res.status}).`);
      logAction("PED Repository Entry Added", `Added "${body.ped.canonicalName}"${body.ped.categoryKey ? ` (category: ${categoryLabel(body.ped.categoryKey) || body.ped.categoryKey})` : ""} — status ${body.ped.status}.`);
      setAddingNew(false);
      setNewName("");
      setNewCategory("");
      setNewStatus("approved");
      setSearchInput("");
      setPage(1);
      await loadEntries();
    } catch (err: any) {
      setSaveError(err.message || "Failed to add this PED. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  // ── Alias management (per-PED expandable panel) ──────────────────────
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [aliasesByPed, setAliasesByPed] = useState<Record<number, AliasEntry[]>>({});
  const [aliasLoading, setAliasLoading] = useState<Record<number, boolean>>({});
  const [aliasError, setAliasError] = useState<string | null>(null);
  const [newAliasText, setNewAliasText] = useState("");
  const [newAliasVisible, setNewAliasVisible] = useState(true);
  const [editingAliasId, setEditingAliasId] = useState<number | null>(null);
  const [draftAliasText, setDraftAliasText] = useState("");

  const loadAliases = async (pedId: number) => {
    setAliasLoading(prev => ({ ...prev, [pedId]: true }));
    setAliasError(null);
    try {
      const res = await fetch(`/api/ped-repository/${pedId}/aliases`);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Failed to load aliases (HTTP ${res.status}).`);
      setAliasesByPed(prev => ({ ...prev, [pedId]: Array.isArray(body.entries) ? body.entries : [] }));
    } catch (err: any) {
      setAliasError(err.message || "Failed to load aliases for this PED.");
    } finally {
      setAliasLoading(prev => ({ ...prev, [pedId]: false }));
    }
  };

  const toggleExpand = (pedId: number) => {
    if (expandedId === pedId) {
      setExpandedId(null);
      return;
    }
    setExpandedId(pedId);
    setNewAliasText("");
    setNewAliasVisible(true);
    setEditingAliasId(null);
    if (!aliasesByPed[pedId]) loadAliases(pedId);
  };

  const addAlias = async (ped: PedEntry) => {
    const text = newAliasText.trim();
    if (!text) return;
    setSaving(true);
    setAliasError(null);
    try {
      const res = await fetch(`/api/ped-repository/${ped.id}/aliases`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ aliasText: text, isVisible: newAliasVisible }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Failed to add this alias (HTTP ${res.status}).`);
      logAction("PED Alias Added", `Added alias "${body.entry.aliasText}" to "${ped.canonicalName}"${body.entry.isVisible ? "" : " (hidden)"}.`);
      setNewAliasText("");
      setNewAliasVisible(true);
      await loadAliases(ped.id);
    } catch (err: any) {
      setAliasError(err.message || "Failed to add this alias. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const toggleAliasVisibility = async (ped: PedEntry, alias: AliasEntry) => {
    setSaving(true);
    setAliasError(null);
    try {
      const res = await fetch(`/api/ped-repository/aliases/${alias.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isVisible: !alias.isVisible }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Failed to update this alias (HTTP ${res.status}).`);
      logAction("PED Alias Edited", `${alias.isVisible ? "Hid" : "Unhid"} alias "${alias.aliasText}" on "${ped.canonicalName}".`);
      await loadAliases(ped.id);
    } catch (err: any) {
      setAliasError(err.message || "Failed to update this alias. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const setPrimaryAlias = async (ped: PedEntry, alias: AliasEntry) => {
    setSaving(true);
    setAliasError(null);
    try {
      const res = await fetch(`/api/ped-repository/aliases/${alias.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isPrimary: true }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Failed to set this alias primary (HTTP ${res.status}).`);
      logAction("PED Alias Edited", `Set "${alias.aliasText}" as the primary alias for "${ped.canonicalName}".`);
      await loadAliases(ped.id);
    } catch (err: any) {
      setAliasError(err.message || "Failed to update this alias. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const startEditAlias = (alias: AliasEntry) => { setEditingAliasId(alias.id); setDraftAliasText(alias.aliasText); };
  const cancelEditAlias = () => { setEditingAliasId(null); setDraftAliasText(""); };

  const saveEditAlias = async (ped: PedEntry, alias: AliasEntry) => {
    if (!draftAliasText.trim()) return;
    setSaving(true);
    setAliasError(null);
    try {
      const res = await fetch(`/api/ped-repository/aliases/${alias.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ aliasText: draftAliasText.trim() }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Failed to update this alias (HTTP ${res.status}).`);
      logAction("PED Alias Edited", `Renamed alias "${alias.aliasText}" to "${body.entry.aliasText}" on "${ped.canonicalName}".`);
      cancelEditAlias();
      await loadAliases(ped.id);
    } catch (err: any) {
      setAliasError(err.message || "Failed to update this alias. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const deleteAlias = async (ped: PedEntry, alias: AliasEntry) => {
    if (!window.confirm(`Remove alias "${alias.aliasText}" from "${ped.canonicalName}"?`)) return;
    setSaving(true);
    setAliasError(null);
    try {
      const res = await fetch(`/api/ped-repository/aliases/${alias.id}`, { method: "DELETE" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Failed to delete this alias (HTTP ${res.status}).`);
      logAction("PED Alias Deleted", `Removed alias "${alias.aliasText}" from "${ped.canonicalName}".`);
      await loadAliases(ped.id);
    } catch (err: any) {
      setAliasError(err.message || "Failed to delete this alias. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const thClass = `px-3 py-2.5 text-left text-[9.5px] font-black uppercase tracking-wider whitespace-nowrap ${dark ? "text-stone-400" : "text-stone-500"}`;
  const tdClass = "px-3 py-2.5 align-top text-xs";
  const inputClass = `w-full text-[11px] px-2 py-1 rounded-lg border outline-none font-semibold ${
    dark ? "bg-[#060a12] border-stone-850 text-white focus:border-sky-500" : "bg-white border-stone-200 text-stone-900 focus:border-sky-400"
  }`;
  const selectTriggerClass = `w-full flex items-center justify-between gap-1 text-[11px] pl-2 pr-6 py-1 rounded-lg border outline-none font-semibold relative ${
    dark ? "bg-[#060a12] border-stone-850 text-white focus:border-sky-500" : "bg-white border-stone-200 text-stone-900 focus:border-sky-400"
  }`;
  const columnCount = canManage ? 6 : 5;

  return (
    <div className={`rounded-2xl border p-5 transition-all ${dark ? "bg-white/[0.03] border-white/[0.08]" : "bg-black/[0.02] border-black/[0.08]"}`}>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 shrink-0">
            {loading ? (
              <span className={`text-[11px] font-bold flex items-center gap-1.5 whitespace-nowrap ${dark ? "text-stone-400" : "text-stone-500"}`}>
                <RefreshCw className="w-3.5 h-3.5 animate-spin" /> Loading PED repository...
              </span>
            ) : syncError ? (
              <span className="text-[11px] font-bold flex items-center gap-1.5 whitespace-nowrap text-amber-500">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0" /> {syncError}
              </span>
            ) : (
              <span className="text-[11px] font-bold flex items-center gap-1.5 whitespace-nowrap text-emerald-500">
                <ShieldCheck className="w-3.5 h-3.5 shrink-0" /> {total.toLocaleString()} {hasActiveFilter ? "matching PEDs" : "PEDs synced"}
              </span>
            )}
            {saving && (
              <span className={`text-[11px] font-bold flex items-center gap-1.5 whitespace-nowrap ${dark ? "text-stone-400" : "text-stone-500"}`}>
                <RefreshCw className="w-3.5 h-3.5 animate-spin" /> Saving...
              </span>
            )}
            {saveSuccess && <span className="text-[11px] font-bold whitespace-nowrap text-emerald-500">Saved.</span>}
          </div>

          <div className="relative flex-1 min-w-[180px]">
            <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-stone-400 pointer-events-none" />
            <input
              type="text"
              placeholder="Search PEDs..."
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              className={`w-full py-2 pl-10 pr-4 text-xs font-semibold rounded-lg border outline-none transition-all ${
                dark ? "bg-[#060A10] border-stone-850 text-white focus:border-sky-500" : "bg-white border-stone-250 text-stone-900 focus:border-sky-400 shadow-inner"
              }`}
            />
            {searchInput && (
              <button onClick={() => setSearchInput("")} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-xs font-bold text-stone-400 hover:text-stone-100" title="Clear search">&times;</button>
            )}
          </div>

          <div className="shrink-0 w-52">
            <CustomSelect
              theme={theme}
              value={categoryFilter}
              onChange={setCategoryFilter}
              triggerClassName={`w-full flex items-center justify-between gap-2 py-2 pl-3 pr-8 text-xs font-semibold rounded-lg border outline-none transition-all relative ${
                dark ? "bg-[#060A10] border-stone-850 text-white focus:border-sky-500" : "bg-white border-stone-250 text-stone-900 focus:border-sky-400 shadow-inner"
              }`}
              options={[{ value: "all", label: "All categories" }, ...categories.map(c => ({ value: c.categoryKey, label: c.label }))]}
            />
          </div>

          <div className="shrink-0 w-40">
            <CustomSelect
              theme={theme}
              value={statusFilter}
              onChange={setStatusFilter}
              triggerClassName={`w-full flex items-center justify-between gap-2 py-2 pl-3 pr-8 text-xs font-semibold rounded-lg border outline-none transition-all relative ${
                dark ? "bg-[#060A10] border-stone-850 text-white focus:border-sky-500" : "bg-white border-stone-250 text-stone-900 focus:border-sky-400 shadow-inner"
              }`}
              options={[{ value: "all", label: "All statuses" }, ...STATUS_OPTIONS]}
            />
          </div>

          <ClippedButton
            type="button"
            onClick={downloadCsv}
            disabled={total === 0 || exporting}
            cornerBg={dark ? "#0e2236" : "#ffffff"}
            style={{ background: dark ? "#2A303C" : "#E7E5E4", color: dark ? "#F4F4F5" : "#292524" }}
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
              style={{ backgroundColor: "var(--action-navy)", borderColor: "var(--action-navy)", color: "var(--on-action-navy)" }}
              className="flex items-center gap-1.5 text-[10px] font-mono font-bold uppercase tracking-[0.15em] px-3 py-2 border hover:brightness-110 shrink-0"
            >
              <Plus className="w-3.5 h-3.5 shrink-0" /> Add PED
            </ClippedButton>
          )}
        </div>

        {saveError && (
          <div className="px-3 py-2 rounded-lg text-[11px] font-bold text-red-400 bg-red-500/10 border border-red-500/25 flex items-center gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0" /> {saveError}
          </div>
        )}

        <div className={`rounded-xl border overflow-x-auto ${dark ? "border-stone-850" : "border-stone-200"}`}>
          <table className="w-full border-collapse min-w-[760px]">
            <thead>
              <tr className={`border-b ${dark ? "bg-white/[0.02] border-stone-850" : "bg-stone-50 border-stone-200"}`}>
                <th className={`${thClass} w-8`}></th>
                <SortableTh label="Canonical Name" sortKey="canonicalName" activeSort={entriesSort} onSort={toggleEntriesSort} className={thClass} />
                <SortableTh label="Category" sortKey="categoryKey" activeSort={entriesSort} onSort={toggleEntriesSort} className={thClass} />
                <SortableTh label="Status" sortKey="status" activeSort={entriesSort} onSort={toggleEntriesSort} className={thClass} />
                <th className={thClass}>Added By</th>
                {canManage && <th className={`${thClass} text-right`}>Actions</th>}
              </tr>
            </thead>
            <tbody>
              {addingNew && (
                <tr className={`border-b ${dark ? "border-stone-850 bg-sky-950/10" : "border-stone-150 bg-sky-50/60"}`}>
                  <td className={tdClass}></td>
                  <td className={tdClass}>
                    <input
                      className={inputClass}
                      placeholder="e.g. Hypothyroidism"
                      value={newName}
                      onChange={e => setNewName(e.target.value)}
                      onKeyDown={e => { if (e.key === "Enter") addEntry(); }}
                      autoFocus
                    />
                  </td>
                  <td className={tdClass}>
                    <CustomSelect theme={theme} value={newCategory} onChange={setNewCategory} placeholder="— No category —" triggerClassName={selectTriggerClass} options={CATEGORY_OPTIONS} />
                  </td>
                  <td className={tdClass}>
                    <CustomSelect theme={theme} value={newStatus} onChange={(v) => setNewStatus(v as PedEntry["status"])} triggerClassName={selectTriggerClass} options={STATUS_OPTIONS} />
                  </td>
                  <td className={`${tdClass} text-[10.5px] ${dark ? "text-stone-400" : "text-stone-500"}`}>Set on save</td>
                  <td className={`${tdClass} text-right`}>
                    <div className="flex items-center justify-end gap-1.5">
                      <ClippedButton onClick={addEntry} disabled={saving} cornerBg={dark ? "#0e2236" : "#f0f9ff"} className="p-1.5 bg-emerald-600 hover:bg-emerald-700 text-white" title="Save new PED">
                        <Save className="w-3.5 h-3.5" />
                      </ClippedButton>
                      <ClippedButton onClick={() => { setAddingNew(false); setNewName(""); setNewCategory(""); setSaveError(null); }} cornerBg={dark ? "#0e2236" : "#f0f9ff"} className="p-1.5 bg-stone-700 hover:bg-stone-600 text-stone-50" title="Cancel">
                        <X className="w-3.5 h-3.5" />
                      </ClippedButton>
                    </div>
                  </td>
                </tr>
              )}

              {!loading && entries.length === 0 && (
                <tr>
                  <td colSpan={columnCount} className="py-10 text-center text-xs font-semibold text-stone-400">
                    {hasActiveFilter ? (searchQuery ? `No PEDs match "${searchQuery}".` : "No PEDs match this filter.") : "No PEDs yet."}
                  </td>
                </tr>
              )}

              {entries.map((entry, idx) => {
                const isEditing = editingId === entry.id;
                const isExpanded = expandedId === entry.id;
                const rowAliases = aliasesByPed[entry.id] || [];
                const visibleAliases = rowAliases.filter(a => a.isVisible);
                const hiddenAliases = rowAliases.filter(a => !a.isVisible);
                return (
                  <Fragment key={entry.id}>
                    <tr
                      className={`border-b last:border-b-0 align-top cursor-pointer ${dark ? "border-stone-850" : "border-stone-150"} ${
                        idx % 2 === 1 ? (dark ? "bg-white/[0.015]" : "bg-stone-50/60") : ""
                      }`}
                      onClick={() => !isEditing && toggleExpand(entry.id)}
                    >
                      <td className={`${tdClass} text-stone-400`}>
                        {isExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                      </td>
                      <td className={tdClass} onClick={e => isEditing && e.stopPropagation()}>
                        {isEditing ? (
                          <input className={inputClass} value={draftName} onChange={e => setDraftName(e.target.value)} onKeyDown={e => { if (e.key === "Enter") saveEdit(); }} autoFocus />
                        ) : (
                          <div>
                            <span className={`font-black ${dark ? "text-white" : "text-stone-900"}`}>{entry.canonicalName}</span>
                            <div className={`text-[9.5px] font-mono ${dark ? "text-stone-500" : "text-stone-400"}`}>{entry.pedCode}</div>
                          </div>
                        )}
                      </td>
                      <td className={tdClass} onClick={e => isEditing && e.stopPropagation()}>
                        {isEditing ? (
                          <CustomSelect theme={theme} value={draftCategory} onChange={setDraftCategory} placeholder="— No category —" triggerClassName={selectTriggerClass} options={CATEGORY_OPTIONS} />
                        ) : entry.categoryKey ? (
                          <span className={`px-2 py-0.5 rounded text-[10px] font-black uppercase border whitespace-nowrap ${
                            dark ? "bg-sky-500/15 text-sky-400 border-sky-500/30" : "bg-sky-500/10 text-sky-700 border-sky-500/25"
                          }`}>
                            {categoryLabel(entry.categoryKey) || entry.categoryKey}
                          </span>
                        ) : (
                          <span className={`text-[10.5px] italic ${dark ? "text-stone-500" : "text-stone-400"}`}>Uncategorized</span>
                        )}
                      </td>
                      <td className={tdClass} onClick={e => isEditing && e.stopPropagation()}>
                        {isEditing ? (
                          <CustomSelect theme={theme} value={draftStatus} onChange={(v) => setDraftStatus(v as PedEntry["status"])} triggerClassName={selectTriggerClass} options={STATUS_OPTIONS} />
                        ) : (
                          statusBadge(entry.status, dark)
                        )}
                      </td>
                      <td className={`${tdClass} text-[10.5px] ${dark ? "text-stone-400" : "text-stone-500"}`}>{entry.addedBy}</td>
                      {canManage && (
                        <td className={`${tdClass} text-right`} onClick={e => e.stopPropagation()}>
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
                              <ClippedButton onClick={() => startEdit(entry)} cornerBg={dark ? "#0e2236" : "#ffffff"} className={`p-1.5 ${dark ? "hover:bg-sky-500/15 text-stone-400 hover:text-sky-400" : "hover:bg-sky-500/10 text-stone-500 hover:text-sky-600"}`} title="Edit PED">
                                <Pencil className="w-3.5 h-3.5" />
                              </ClippedButton>
                              <ClippedButton onClick={() => deleteEntry(entry)} cornerBg={dark ? "#0e2236" : "#ffffff"} className={`p-1.5 ${dark ? "hover:bg-red-500/15 text-stone-400 hover:text-red-400" : "hover:bg-red-500/10 text-stone-500 hover:text-red-600"}`} title="Delete PED">
                                <Trash2 className="w-3.5 h-3.5" />
                              </ClippedButton>
                            </div>
                          )}
                        </td>
                      )}
                    </tr>

                    {isExpanded && (
                      <tr className={`border-b last:border-b-0 ${dark ? "border-stone-850 bg-black/20" : "border-stone-150 bg-stone-100/60"}`}>
                        <td></td>
                        <td colSpan={columnCount - 1} className="px-3 py-3">
                          <div className="space-y-2.5">
                            <p className={`text-[10px] font-black uppercase tracking-wider ${dark ? "text-stone-400" : "text-stone-500"}`}>
                              Aliases — every searchable variant of this PED
                            </p>
                            {aliasError && (
                              <div className="px-2.5 py-1.5 rounded-lg text-[10.5px] font-bold text-red-400 bg-red-500/10 border border-red-500/25">{aliasError}</div>
                            )}
                            {aliasLoading[entry.id] ? (
                              <p className={`text-[11px] font-semibold ${dark ? "text-stone-400" : "text-stone-500"}`}>Loading aliases...</p>
                            ) : (
                              <div className="space-y-1.5">
                                {visibleAliases.map(alias => (
                                  <div key={alias.id} className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg border ${dark ? "border-stone-850 bg-white/[0.02]" : "border-stone-200 bg-white"}`}>
                                    {editingAliasId === alias.id ? (
                                      <input className={`${inputClass} flex-1`} value={draftAliasText} onChange={e => setDraftAliasText(e.target.value)} onKeyDown={e => { if (e.key === "Enter") saveEditAlias(entry, alias); }} autoFocus />
                                    ) : (
                                      <span className={`flex-1 text-xs font-semibold ${dark ? "text-white" : "text-stone-900"}`}>{alias.aliasText}</span>
                                    )}
                                    {alias.isPrimary && (
                                      <span title="Primary alias"><Star className="w-3.5 h-3.5 text-amber-400 fill-amber-400 shrink-0" /></span>
                                    )}
                                    {canManage && (
                                      <div className="flex items-center gap-1 shrink-0">
                                        {editingAliasId === alias.id ? (
                                          <>
                                            <ClippedButton onClick={() => saveEditAlias(entry, alias)} disabled={saving} cornerBg={dark ? "#0e2236" : "#ffffff"} className="p-1 bg-emerald-600 hover:bg-emerald-700 text-white" title="Save"><Save className="w-3 h-3" /></ClippedButton>
                                            <ClippedButton onClick={cancelEditAlias} cornerBg={dark ? "#0e2236" : "#ffffff"} className="p-1 bg-stone-700 hover:bg-stone-600 text-stone-50" title="Cancel"><X className="w-3 h-3" /></ClippedButton>
                                          </>
                                        ) : (
                                          <>
                                            {!alias.isPrimary && (
                                              <ClippedButton onClick={() => setPrimaryAlias(entry, alias)} cornerBg={dark ? "#0e2236" : "#ffffff"} className={`p-1 ${dark ? "hover:bg-amber-500/15 text-stone-400 hover:text-amber-400" : "hover:bg-amber-500/10 text-stone-500 hover:text-amber-600"}`} title="Make primary"><Star className="w-3 h-3" /></ClippedButton>
                                            )}
                                            <ClippedButton onClick={() => toggleAliasVisibility(entry, alias)} cornerBg={dark ? "#0e2236" : "#ffffff"} className={`p-1 ${dark ? "hover:bg-sky-500/15 text-stone-400 hover:text-sky-400" : "hover:bg-sky-500/10 text-stone-500 hover:text-sky-600"}`} title="Hide (normalization-only)"><EyeOff className="w-3 h-3" /></ClippedButton>
                                            <ClippedButton onClick={() => startEditAlias(alias)} cornerBg={dark ? "#0e2236" : "#ffffff"} className={`p-1 ${dark ? "hover:bg-sky-500/15 text-stone-400 hover:text-sky-400" : "hover:bg-sky-500/10 text-stone-500 hover:text-sky-600"}`} title="Rename"><Pencil className="w-3 h-3" /></ClippedButton>
                                            <ClippedButton onClick={() => deleteAlias(entry, alias)} cornerBg={dark ? "#0e2236" : "#ffffff"} className={`p-1 ${dark ? "hover:bg-red-500/15 text-stone-400 hover:text-red-400" : "hover:bg-red-500/10 text-stone-500 hover:text-red-600"}`} title="Delete"><Trash2 className="w-3 h-3" /></ClippedButton>
                                          </>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                ))}

                                {hiddenAliases.length > 0 && (
                                  <div className="pt-1.5 space-y-1.5">
                                    <p className={`text-[9.5px] font-bold uppercase tracking-wider flex items-center gap-1 ${dark ? "text-stone-500" : "text-stone-400"}`}>
                                      <EyeOff className="w-3 h-3" /> Hidden — normalization only, never shown as real terminology
                                    </p>
                                    {hiddenAliases.map(alias => (
                                      <div key={alias.id} className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg border border-dashed opacity-70 ${dark ? "border-stone-800 bg-white/[0.01]" : "border-stone-300 bg-stone-50"}`}>
                                        {editingAliasId === alias.id ? (
                                          <input className={`${inputClass} flex-1`} value={draftAliasText} onChange={e => setDraftAliasText(e.target.value)} onKeyDown={e => { if (e.key === "Enter") saveEditAlias(entry, alias); }} autoFocus />
                                        ) : (
                                          <span className={`flex-1 text-xs font-semibold italic ${dark ? "text-stone-400" : "text-stone-500"}`}>{alias.aliasText}</span>
                                        )}
                                        {canManage && (
                                          <div className="flex items-center gap-1 shrink-0">
                                            {editingAliasId === alias.id ? (
                                              <>
                                                <ClippedButton onClick={() => saveEditAlias(entry, alias)} disabled={saving} cornerBg={dark ? "#0e2236" : "#ffffff"} className="p-1 bg-emerald-600 hover:bg-emerald-700 text-white" title="Save"><Save className="w-3 h-3" /></ClippedButton>
                                                <ClippedButton onClick={cancelEditAlias} cornerBg={dark ? "#0e2236" : "#ffffff"} className="p-1 bg-stone-700 hover:bg-stone-600 text-stone-50" title="Cancel"><X className="w-3 h-3" /></ClippedButton>
                                              </>
                                            ) : (
                                              <>
                                                <ClippedButton onClick={() => toggleAliasVisibility(entry, alias)} cornerBg={dark ? "#0e2236" : "#ffffff"} className={`p-1 ${dark ? "hover:bg-emerald-500/15 text-stone-400 hover:text-emerald-400" : "hover:bg-emerald-500/10 text-stone-500 hover:text-emerald-600"}`} title="Unhide"><Eye className="w-3 h-3" /></ClippedButton>
                                                <ClippedButton onClick={() => startEditAlias(alias)} cornerBg={dark ? "#0e2236" : "#ffffff"} className={`p-1 ${dark ? "hover:bg-sky-500/15 text-stone-400 hover:text-sky-400" : "hover:bg-sky-500/10 text-stone-500 hover:text-sky-600"}`} title="Rename"><Pencil className="w-3 h-3" /></ClippedButton>
                                                <ClippedButton onClick={() => deleteAlias(entry, alias)} cornerBg={dark ? "#0e2236" : "#ffffff"} className={`p-1 ${dark ? "hover:bg-red-500/15 text-stone-400 hover:text-red-400" : "hover:bg-red-500/10 text-stone-500 hover:text-red-600"}`} title="Delete"><Trash2 className="w-3 h-3" /></ClippedButton>
                                              </>
                                            )}
                                          </div>
                                        )}
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            )}

                            {canManage && (
                              <div className="flex items-center gap-2 pt-1">
                                <input
                                  className={`${inputClass} flex-1`}
                                  placeholder="Add an alias (e.g. a misspelling or synonym)..."
                                  value={newAliasText}
                                  onChange={e => setNewAliasText(e.target.value)}
                                  onKeyDown={e => { if (e.key === "Enter") addAlias(entry); }}
                                />
                                <label className={`flex items-center gap-1.5 text-[10.5px] font-bold whitespace-nowrap ${dark ? "text-stone-400" : "text-stone-500"}`}>
                                  <input type="checkbox" checked={newAliasVisible} onChange={e => setNewAliasVisible(e.target.checked)} />
                                  Visible
                                </label>
                                <ClippedButton onClick={() => addAlias(entry)} disabled={saving || !newAliasText.trim()} cornerBg={dark ? "#0e2236" : "#ffffff"} className="p-1.5 bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-40" title="Add alias">
                                  <Plus className="w-3.5 h-3.5" />
                                </ClippedButton>
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
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
            {hasActiveFilter ? " matching PEDs" : " PEDs"}. {canManage ? "Changes here are the live source of truth for the matching engine and feed the Lookup page's dropdown immediately." : "Admin or Developer clearance is required to add, edit, or remove entries."}
          </p>
          <Pagination theme={theme} page={page} totalPages={totalPages} onPageChange={setPage} />
        </div>
      </div>
    </div>
  );
}
