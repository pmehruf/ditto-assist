/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { Pencil, Save, X, Trash2, UserPlus, RefreshCw, ShieldCheck, AlertTriangle, Search, Download, Filter, Calendar } from "lucide-react";
import { UserProfile, LoggedUser } from "../types/user";
import { ChangeLogEntry } from "../types/changeLog";
import { ClippedButton } from "./ClippedButton";
import { CustomSelect } from "./CustomSelect";
import { AdvisorTagCheckboxes, ADVISOR_TAG_OPTIONS } from "./AdvisorTagCheckboxes";
import { TactIdInput } from "./TactIdInput";
import { formatDisplayTimestamp } from "../utils/timestamps";
import { SortableTh } from "./SortableTh";
import { Pagination } from "./Pagination";
import { DateInputDMY } from "./DateInputDMY";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import { useServerSort } from "../hooks/useServerSort";
import { downloadCSV } from "../utils/csvExport";

const PAGE_SIZE = 25;

interface ProfileAccessManagementProps {
  theme: "light" | "dark";
  usersList: UserProfile[];
  setUsersList: Dispatch<SetStateAction<UserProfile[]>>;
  effectiveTier: "General" | "Admin" | "Developer";
  currentUser: LoggedUser | null;
  setChangeLogs: Dispatch<SetStateAction<ChangeLogEntry[]>>;
}

const TIERS: UserProfile["tier"][] = ["General", "Admin", "Developer"];
// Admin can add users, but can't mint a new Developer from this form — matches
// the server-side check in POST /api/users.
const ADMIN_ADDABLE_TIERS: UserProfile["tier"][] = ["General", "Admin"];
const STATUSES: UserProfile["status"][] = ["Active", "Disabled"];

const emptyDraft = (): UserProfile => ({
  email: "",
  name: "",
  tactId: "",
  tier: "General",
  status: "Active",
  tags: [],
});

/**
 * Developer-editable, Admin-visible directory of every advisor account. This
 * is the UI for the server-backed "User Directory" feature: this component
 * self-fetches its own paginated/searched/sorted page from
 * GET /api/users?paginated=1 (25/page) rather than loading the full
 * directory, and Developer edits are saved via single-row PATCH/DELETE
 * (`/api/users/:email`) so a save from any page only ever touches the one
 * row being edited — the old full-array PUT is no longer safe to use here
 * once the client only holds one page at a time.
 *
 * `usersList` / `setUsersList` (App.tsx's usePersistentState-backed state)
 * are a SEPARATE, smaller cache used elsewhere in the app (e.g. to keep the
 * signed-in user's own profile fields in sync — see App.tsx). This component
 * doesn't read `usersList` for its own display, but does patch `setUsersList`
 * after every create/edit/delete so that cache stays correct too.
 */
export function ProfileAccessManagement({ theme, setUsersList, effectiveTier, currentUser, setChangeLogs }: ProfileAccessManagementProps) {
  const dark = theme === "dark";
  const isDeveloper = effectiveTier === "Developer";
  // Admin can see and use "Add User" (same pattern as "Add Plan" on the
  // Plan Management page); Edit/Delete stay visible for Admin but render
  // disabled — Developer clearance is required to actually edit or remove an
  // existing directory entry.
  const canManage = effectiveTier === "Admin" || isDeveloper;

  const logAction = (actionType: string, description: string) => {
    setChangeLogs(prev => [
      {
        id: `log-${Date.now()}`,
        timestamp: new Date().toISOString(),
        userName: currentUser?.name || currentUser?.email || "Mehruf P (Developer)",
        role: effectiveTier,
        actionType,
        planName: "User Directory",
        description,
      },
      ...prev,
    ]);
  };

  // `entries` holds only the CURRENT PAGE — search/filter/sort/paging all
  // happen server-side (GET /api/users?paginated=1&...) rather than loading
  // the full directory into the browser. `usersList`/`setUsersList` (the
  // App.tsx-level cache used to keep the signed-in user's own profile in
  // sync — see App.tsx) is left untouched here except after a create/edit/
  // delete, where the one affected row is patched into it too so that cache
  // stays correct without ever needing a full-directory re-fetch.
  const [entries, setEntries] = useState<UserProfile[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  const [editingEmail, setEditingEmail] = useState<string | null>(null);
  const [draft, setDraft] = useState<UserProfile | null>(null);
  const [addingNew, setAddingNew] = useState(false);
  const [newDraft, setNewDraft] = useState<UserProfile>(emptyDraft());
  const [searchInput, setSearchInput] = useState("");
  const searchQuery = useDebouncedValue(searchInput, 350);
  const { sort: usersSort, toggleSort: toggleUsersSort } = useServerSort();

  // Filter row — tag/tier/status/joined-date, all server-side (same
  // paginated /api/users endpoint the search box already used). "" means
  // "All" for every one of these.
  const [tagFilter, setTagFilter] = useState("");
  const [tierFilter, setTierFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [joinedFrom, setJoinedFrom] = useState("");
  const [joinedTo, setJoinedTo] = useState("");
  const hasActiveFilters = Boolean(tagFilter || tierFilter || statusFilter || joinedFrom || joinedTo);
  const resetFilters = () => {
    setTagFilter("");
    setTierFilter("");
    setStatusFilter("");
    setJoinedFrom("");
    setJoinedTo("");
  };

  const buildFilterParams = (params: URLSearchParams) => {
    if (tagFilter) params.set("tag", tagFilter);
    if (tierFilter) params.set("tier", tierFilter);
    if (statusFilter) params.set("status", statusFilter);
    if (joinedFrom) params.set("dateFrom", joinedFrom);
    if (joinedTo) params.set("dateTo", joinedTo);
  };

  const loadEntries = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ paginated: "1", page: String(page), pageSize: String(PAGE_SIZE) });
      if (searchQuery) params.set("search", searchQuery);
      if (usersSort) {
        params.set("sortBy", usersSort.key);
        params.set("sortDir", usersSort.direction);
      }
      buildFilterParams(params);
      const res = await fetch(`/api/users?${params.toString()}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Failed to load user directory (HTTP ${res.status}).`);
      }
      const data = await res.json();
      if (Array.isArray(data.entries)) {
        setEntries(data.entries);
        setTotal(data.total ?? 0);
        setTotalPages(data.totalPages ?? 1);
        // Server clamps an out-of-range page (e.g. right after a delete
        // empties the last page) — mirror that back so Previous/Next agree.
        if (typeof data.page === "number" && data.page !== page) setPage(data.page);
        setSyncError(null);
      }
    } catch (err: any) {
      setSyncError(err.message || "Could not reach the server. Showing the last loaded list.");
    } finally {
      setLoading(false);
    }
  };

  // Search/sort/filter changes jump back to page 1; the fetch effect below
  // re-runs regardless (it depends on all of these plus `page`).
  useEffect(() => {
    setPage(1);
  }, [searchQuery, usersSort?.key, usersSort?.direction, tagFilter, tierFilter, statusFilter, joinedFrom, joinedTo]);

  useEffect(() => {
    loadEntries();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, searchQuery, usersSort?.key, usersSort?.direction, tagFilter, tierFilter, statusFilter, joinedFrom, joinedTo]);

  const [exporting, setExporting] = useState(false);
  const exportCsv = async () => {
    setExporting(true);
    try {
      const params = new URLSearchParams({ paginated: "1", pageSize: "10000" });
      if (searchQuery) params.set("search", searchQuery);
      if (usersSort) {
        params.set("sortBy", usersSort.key);
        params.set("sortDir", usersSort.direction);
      }
      buildFilterParams(params);
      const res = await fetch(`/api/users?${params.toString()}&export=1`);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Failed to export (HTTP ${res.status}).`);
      const rows = (Array.isArray(body.entries) ? body.entries : []) as UserProfile[];
      downloadCSV(
        rows.map((u) => ({
          ...u,
          // Plain "Health + Term" instead of downloadCSV's default
          // JSON.stringify(...) for array fields, which reads as raw
          // ["Health","Term"] escaped-quote noise in a spreadsheet cell.
          tags: u.tags && u.tags.length > 0 ? u.tags.join(" + ") : "Unassigned",
        })),
        "user-directory.csv"
      );
    } catch (err) {
      console.error("Failed to export the user directory:", err);
    } finally {
      setExporting(false);
    }
  };

  const startEdit = (user: UserProfile) => {
    setEditingEmail(user.email);
    setDraft({ ...user });
    setSaveError(null);
  };

  const cancelEdit = () => {
    setEditingEmail(null);
    setDraft(null);
  };

  const saveEdit = async () => {
    if (!draft || !editingEmail) return;
    setSaving(true);
    setSaveError(null);
    setSaveSuccess(false);
    try {
      // Single-row PATCH, not the old full-array PUT — see
      // usersRepository.ts's updateUser doc comment for why a full-array
      // replace is no longer safe now that this table is paginated.
      const res = await fetch(`/api/users/${encodeURIComponent(editingEmail)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: draft.name, tactId: draft.tactId, tier: draft.tier, status: draft.status, tags: draft.tags || [] }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Failed to save changes (HTTP ${res.status}).`);
      const saved: UserProfile = body.user;
      setEntries(prev => prev.map(u => (u.email === editingEmail ? saved : u)));
      setUsersList(prev => prev.map(u => (u.email === editingEmail ? saved : u)));
      logAction("User Edited", `Updated directory entry for ${saved.name} (${saved.email}) — Tier: ${saved.tier}, Status: ${saved.status}.`);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 2500);
      setEditingEmail(null);
      setDraft(null);
    } catch (err: any) {
      setSaveError(err.message || "Failed to save changes. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const deleteUser = async (email: string) => {
    if (!window.confirm(`Remove ${email} from the user directory? This cannot be undone.`)) return;
    const removedUser = entries.find(u => u.email === email);
    setSaving(true);
    setSaveError(null);
    try {
      // Single-row DELETE, not the old filter-then-PUT-the-whole-array flow
      // — see usersRepository.ts's deleteUser doc comment.
      const res = await fetch(`/api/users/${encodeURIComponent(email)}`, { method: "DELETE" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Failed to remove this user (HTTP ${res.status}).`);
      setUsersList(prev => prev.filter(u => u.email !== email));
      logAction("User Deleted", `Removed ${removedUser?.name || email} (${email}) from the user directory.`);
      // Deleting the last row on a page (other than page 1) would otherwise
      // leave the view stuck on a now-empty page — loadEntries() re-fetches
      // page `page`, and the server clamps it back into range if needed.
      await loadEntries();
    } catch (err: any) {
      setSaveError(err.message || "Failed to remove this user. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const saveNewUser = async () => {
    if (!newDraft.email.trim() || !newDraft.name.trim() || !newDraft.tactId.trim()) {
      setSaveError("Email, name, and TACT ID are required to add a user.");
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      // Single-row create — works for both Admin and Developer (unlike the
      // Developer-only PATCH/DELETE used for editing/removing an existing
      // user). See server.ts's POST /api/users for why this is safe to
      // expose to Admin. The server rejects a duplicate email (409) rather
      // than relying on a client-side pre-check against the full directory,
      // which is no longer loaded in memory now that this list is paginated.
      const res = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...newDraft, email: newDraft.email.trim().toLowerCase() }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Failed to add this user (HTTP ${res.status}).`);
      setUsersList(prev => [...prev, body.user]);
      logAction("User Added", `Added ${newDraft.name} (${newDraft.email}) to the user directory — Tier: ${newDraft.tier}.`);
      setAddingNew(false);
      setNewDraft(emptyDraft());
      setSearchInput("");
      setPage(1);
      await loadEntries();
    } catch (err: any) {
      setSaveError(err.message || "Failed to add this user. Please try again.");
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
  // Same look as inputClass, adapted for CustomSelect's trigger button
  // (flex layout + room on the right for the chevron) so the Tier/Status
  // dropdowns in this table match inputClass-styled text fields exactly.
  const selectTriggerClass = `w-full flex items-center justify-between gap-1 text-[11px] pl-2 pr-6 py-1 rounded-lg border outline-none font-semibold relative ${
    dark ? "bg-[#060a12] border-stone-850 text-white focus:border-sky-500" : "bg-white border-stone-200 text-stone-900 focus:border-sky-400"
  }`;

  const tierBadgeClass = (tier: UserProfile["tier"]) =>
    tier === "Developer"
      ? "bg-amber-500/15 text-amber-400 border-amber-500/30"
      : tier === "Admin"
        ? "bg-sky-500/15 text-sky-400 border-sky-500/30"
        // "General" text-stone-400 measured ~1.82:1 in Light theme — two
        // shades of the same gray, essentially unreadable (Issue 14). Dark
        // theme already passes, so only the light-theme text darkens here.
        : dark
          ? "bg-stone-500/15 text-stone-400 border-stone-500/30"
          : "bg-stone-500/15 text-stone-700 border-stone-500/30";

  const statusBadgeClass = (status: UserProfile["status"]) =>
    status === "Active"
      ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30"
      : "bg-stone-500/15 text-stone-400 border-stone-500/30";

  // Deliberately avoids blue/sky (Admin tier) and green/emerald (Active
  // status) since those hues are already spoken for elsewhere in this same
  // table — Health gets rose, Term gets violet, so the two tags stay clearly
  // distinct from each other AND from the Tier/Status columns next to them.
  const tagBadgeClass = (tag: string) =>
    tag === "Term"
      ? dark
        ? "bg-violet-500/15 text-violet-400 border-violet-500/30"
        : "bg-violet-50 text-violet-700 border-violet-200"
      : dark
        ? "bg-rose-500/15 text-rose-400 border-rose-500/30"
        : "bg-rose-50 text-rose-700 border-rose-200";

  return (
    <div className={`rounded-2xl border p-5 transition-all ${
      dark ? "bg-white/[0.03] border-white/[0.08]" : "bg-black/[0.02] border-black/[0.08]"
    }`}>
      <div className="space-y-4">
        {/* Title row: sync state + count + search field on the left,
            add-user action pinned to the far right via justify-between.
            Search is now a fixed, normal-sized field rather than stretching
            to fill the row. */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2 shrink-0">
              {loading ? (
                <span className={`text-[11px] font-bold flex items-center gap-1.5 whitespace-nowrap ${dark ? "text-stone-400" : "text-stone-500"}`}>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  Loading directory from server...
                </span>
              ) : syncError ? (
                <span className="text-[11px] font-bold flex items-center gap-1.5 whitespace-nowrap text-amber-500">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                  {syncError}
                </span>
              ) : (
                <span className="text-[11px] font-bold flex items-center gap-1.5 whitespace-nowrap text-emerald-500">
                  <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
                  Synced with server directory
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

            {!loading && (
              <span className={`text-[11px] font-bold whitespace-nowrap px-2 py-1 rounded-lg border shrink-0 ${
                dark ? "bg-white/5 border-stone-800 text-stone-300" : "bg-stone-100 border-stone-200 text-stone-700"
              }`}>
                {total.toLocaleString()} {total === 1 ? "user" : "users"}
              </span>
            )}

            <div className="relative w-56 shrink-0">
              <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-stone-400 pointer-events-none" />
              <input
                type="text"
                placeholder="Search the directory..."
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                className={`w-full py-1.5 pl-8 pr-4 text-xs font-semibold rounded-lg border outline-none transition-all ${
                  dark
                    ? "bg-[#060A10] border-stone-850 text-white focus:border-sky-500"
                    : "bg-white border-stone-250 text-stone-900 focus:border-sky-400 shadow-inner"
                }`}
              />
              {searchInput && (
                <button
                  onClick={() => setSearchInput("")}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold text-stone-400 hover:text-stone-100"
                  title="Clear search"
                >
                  &times;
                </button>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <ClippedButton
              onClick={exportCsv}
              disabled={exporting || total === 0}
              size="sm"
              title="Export the filtered user directory as a CSV file"
              className="flex items-center gap-1.5 px-3 py-2 text-white text-[10px] font-black uppercase tracking-wider bg-[#117FDA] hover:bg-[#0d6dbb] shrink-0"
            >
              <Download className="w-3.5 h-3.5 shrink-0" />
              <span>Export CSV</span>
            </ClippedButton>
            {canManage && !addingNew && (
            <ClippedButton
              type="button"
              onClick={() => { setAddingNew(true); setSaveError(null); }}
              cornerBg={dark ? "#0e2236" : "#ffffff"}
              // Solid brand navy (var(--action-navy)) — the app's
              // theme-independent primary/neutral action color (same one
              // PrimaryCtaButton and every other primary CTA uses) rather
              // than the previous pastel/muted chip look, per design
              // feedback.
              style={{
                backgroundColor: "var(--action-navy)",
                borderColor: "var(--action-navy)",
                color: "var(--on-action-navy)",
              }}
              className="flex items-center gap-1.5 text-[10px] font-mono font-bold uppercase tracking-[0.15em] px-3 py-2 border hover:brightness-110 shrink-0"
            >
              <UserPlus className="w-3.5 h-3.5 shrink-0" />
              Add User
            </ClippedButton>
            )}
          </div>
        </div>

        {/* Filter row — Role / Tier / Status / Joined date range, all
            server-side (same /api/users?paginated=1 endpoint search already
            used). Label-above-control, matching the filter pattern used on
            My Activity / QA Dashboard / Coverage Projection Studio. */}
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-40 shrink-0">
            <label className={`block text-[10px] font-bold uppercase tracking-wider mb-1 ${dark ? "text-stone-400" : "text-stone-500"}`}>
              <span className="inline-flex items-center gap-1"><Filter className="w-3 h-3" /> Tag</span>
            </label>
            <CustomSelect
              theme={theme}
              value={tagFilter}
              onChange={setTagFilter}
              triggerClassName={selectTriggerClass}
              options={[
                { value: "", label: "All Tags" },
                { value: "Unassigned", label: "Unassigned" },
                ...ADVISOR_TAG_OPTIONS.map((t) => ({ value: t, label: t })),
              ]}
            />
          </div>
          <div className="w-36 shrink-0">
            <label className={`block text-[10px] font-bold uppercase tracking-wider mb-1 ${dark ? "text-stone-400" : "text-stone-500"}`}>Tier</label>
            <CustomSelect
              theme={theme}
              value={tierFilter}
              onChange={setTierFilter}
              triggerClassName={selectTriggerClass}
              options={[{ value: "", label: "All Tiers" }, ...TIERS.map((t) => ({ value: t, label: t }))]}
            />
          </div>
          <div className="w-36 shrink-0">
            <label className={`block text-[10px] font-bold uppercase tracking-wider mb-1 ${dark ? "text-stone-400" : "text-stone-500"}`}>Status</label>
            <CustomSelect
              theme={theme}
              value={statusFilter}
              onChange={setStatusFilter}
              triggerClassName={selectTriggerClass}
              options={[{ value: "", label: "All Statuses" }, ...STATUSES.map((s) => ({ value: s, label: s }))]}
            />
          </div>
          <div className="shrink-0">
            <label className={`block text-[10px] font-bold uppercase tracking-wider mb-1 ${dark ? "text-stone-400" : "text-stone-500"}`}>
              <span className="inline-flex items-center gap-1"><Calendar className="w-3 h-3" /> Joined From</span>
            </label>
            <DateInputDMY
              value={joinedFrom}
              onChange={setJoinedFrom}
              max={joinedTo || undefined}
              displayClassName={`min-w-[128px] px-2.5 py-1.5 rounded-lg border text-xs font-semibold flex items-center ${
                dark ? "bg-[#060a12] border-stone-850 text-white" : "bg-white border-stone-200 text-stone-900"
              }`}
            />
          </div>
          <div className="shrink-0">
            <label className={`block text-[10px] font-bold uppercase tracking-wider mb-1 ${dark ? "text-stone-400" : "text-stone-500"}`}>Joined To</label>
            <DateInputDMY
              value={joinedTo}
              onChange={setJoinedTo}
              min={joinedFrom || undefined}
              displayClassName={`min-w-[128px] px-2.5 py-1.5 rounded-lg border text-xs font-semibold flex items-center ${
                dark ? "bg-[#060a12] border-stone-850 text-white" : "bg-white border-stone-200 text-stone-900"
              }`}
            />
          </div>
          {hasActiveFilters && (
            <button
              onClick={resetFilters}
              className={`text-[10px] font-bold px-2.5 py-1.5 rounded-lg cursor-pointer shrink-0 ${
                dark ? "text-red-400 hover:bg-stone-800 bg-stone-900/40 border border-red-500/10" : "text-red-650 hover:bg-red-50 bg-red-50/40 border border-red-100"
              }`}
            >
              Reset Filters
            </button>
          )}
        </div>

        {saveError && (
          <div className="px-3 py-2 rounded-lg text-[11px] font-bold text-red-400 bg-red-500/10 border border-red-500/25 flex items-center gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
            {saveError}
          </div>
        )}

        <div className={`rounded-xl border overflow-x-auto ${dark ? "border-stone-850" : "border-stone-200"}`}>
          <table className="w-full border-collapse min-w-[820px]">
            <thead>
              <tr className={`border-b ${dark ? "bg-white/[0.02] border-stone-850" : "bg-stone-50 border-stone-200"}`}>
                <SortableTh label="Name" sortKey="name" activeSort={usersSort} onSort={toggleUsersSort} className={thClass} />
                <SortableTh label="Email" sortKey="email" activeSort={usersSort} onSort={toggleUsersSort} className={thClass} />
                <SortableTh label="TACT ID" sortKey="tactId" activeSort={usersSort} onSort={toggleUsersSort} className={thClass} />
                <th className={thClass}>Tags</th>
                <SortableTh label="Tier" sortKey="tier" activeSort={usersSort} onSort={toggleUsersSort} className={thClass} />
                <SortableTh label="Status" sortKey="status" activeSort={usersSort} onSort={toggleUsersSort} className={thClass} />
                <SortableTh label="Joined" sortKey="createdAt" activeSort={usersSort} onSort={toggleUsersSort} className={thClass} />
                {canManage && <th className={`${thClass} text-right`}>Actions</th>}
              </tr>
            </thead>
            <tbody>
              {addingNew && (
                <tr className={`border-b ${dark ? "border-stone-850 bg-sky-950/10" : "border-stone-150 bg-sky-50/60"}`}>
                  <td className={tdClass}>
                    <input className={inputClass} placeholder="Full name" value={newDraft.name} onChange={e => setNewDraft(d => ({ ...d, name: e.target.value }))} />
                  </td>
                  <td className={tdClass}>
                    <input className={inputClass} placeholder="name@joinditto.in" value={newDraft.email} onChange={e => setNewDraft(d => ({ ...d, email: e.target.value }))} />
                  </td>
                  <td className={tdClass}>
                    <TactIdInput
                      theme={theme}
                      value={newDraft.tactId}
                      onChange={(val) => setNewDraft(d => ({ ...d, tactId: val }))}
                      placeholder="e.g. 128"
                      className={inputClass}
                    />
                  </td>
                  <td className={tdClass}>
                    <AdvisorTagCheckboxes
                      theme={theme}
                      value={newDraft.tags || []}
                      onChange={(tags) => setNewDraft(d => ({ ...d, tags }))}
                    />
                  </td>
                  <td className={tdClass}>
                    <CustomSelect
                      theme={theme}
                      value={newDraft.tier}
                      onChange={(val) => setNewDraft(d => ({ ...d, tier: val as UserProfile["tier"] }))}
                      triggerClassName={selectTriggerClass}
                      options={(isDeveloper ? TIERS : ADMIN_ADDABLE_TIERS).map(t => ({ value: t, label: t }))}
                    />
                  </td>
                  <td className={tdClass}>
                    <CustomSelect
                      theme={theme}
                      value={newDraft.status}
                      onChange={(val) => setNewDraft(d => ({ ...d, status: val as UserProfile["status"] }))}
                      triggerClassName={selectTriggerClass}
                      options={STATUSES.map(s => ({ value: s, label: s }))}
                    />
                  </td>
                  <td className={`${tdClass} text-[10.5px] italic ${dark ? "text-stone-500" : "text-stone-400"}`}>
                    Not yet saved
                  </td>
                  <td className={`${tdClass} text-right`}>
                    <div className="flex items-center justify-end gap-1.5">
                      <ClippedButton onClick={saveNewUser} disabled={saving} cornerBg={dark ? "#0e2236" : "#f0f9ff"} className="p-1.5 bg-emerald-600 hover:bg-emerald-700 text-white" title="Save new user">
                        <Save className="w-3.5 h-3.5" />
                      </ClippedButton>
                      <ClippedButton onClick={() => { setAddingNew(false); setNewDraft(emptyDraft()); setSaveError(null); }} cornerBg={dark ? "#0e2236" : "#f0f9ff"} className="p-1.5 bg-stone-700 hover:bg-stone-600 text-stone-50" title="Cancel">
                        <X className="w-3.5 h-3.5" />
                      </ClippedButton>
                    </div>
                  </td>
                </tr>
              )}

              {!loading && entries.length === 0 && (
                <tr>
                  <td colSpan={canManage ? 8 : 7} className="py-10 text-center text-xs font-semibold text-stone-400">
                    {searchQuery ? `No directory entries match "${searchQuery}".` : "No directory entries yet."}
                  </td>
                </tr>
              )}

              {entries.map((user, idx) => {
                const isEditing = isDeveloper && editingEmail === user.email;
                const row = isEditing && draft ? draft : user;
                return (
                  <tr
                    key={user.email}
                    className={`border-b last:border-b-0 align-top ${dark ? "border-stone-850" : "border-stone-150"} ${
                      idx % 2 === 1 ? (dark ? "bg-white/[0.015]" : "bg-stone-50/60") : ""
                    }`}
                  >
                    <td className={tdClass}>
                      {isEditing ? (
                        <input className={inputClass} value={row.name} onChange={e => setDraft(d => d && { ...d, name: e.target.value })} />
                      ) : (
                        <span className={`font-black ${dark ? "text-white" : "text-stone-900"}`}>{user.name}</span>
                      )}
                    </td>
                    <td className={`${tdClass} font-mono text-[10.5px] text-content-muted`}>
                      {user.email}
                    </td>
                    <td className={tdClass}>
                      {isEditing ? (
                        <TactIdInput
                          theme={theme}
                          value={row.tactId}
                          onChange={(val) => setDraft(d => d && { ...d, tactId: val })}
                          placeholder="e.g. 128"
                          className={inputClass}
                        />
                      ) : (
                        <span className={`font-mono text-[10.5px] ${dark ? "text-stone-300" : "text-stone-700"}`}>{user.tactId}</span>
                      )}
                    </td>
                    <td className={tdClass}>
                      {isEditing ? (
                        <AdvisorTagCheckboxes
                          theme={theme}
                          value={row.tags || []}
                          onChange={(tags) => setDraft(d => d && { ...d, tags })}
                        />
                      ) : user.tags && user.tags.length > 0 ? (
                        <div className="flex items-center gap-1 flex-wrap">
                          {user.tags.map((tag) => (
                            <span
                              key={tag}
                              className={`px-2 py-0.5 rounded text-[10px] font-black uppercase border whitespace-nowrap ${tagBadgeClass(tag)}`}
                            >
                              {tag}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className={`px-2 py-0.5 rounded text-[10px] font-black uppercase border whitespace-nowrap ${
                          dark ? "bg-stone-500/15 text-stone-400 border-stone-500/30" : "bg-stone-500/15 text-stone-500 border-stone-500/30"
                        }`}>
                          Unassigned
                        </span>
                      )}
                    </td>
                    <td className={tdClass}>
                      {isEditing ? (
                        <CustomSelect
                          theme={theme}
                          value={row.tier}
                          onChange={(val) => setDraft(d => d && { ...d, tier: val as UserProfile["tier"] })}
                          triggerClassName={selectTriggerClass}
                          options={TIERS.map(t => ({ value: t, label: t }))}
                        />
                      ) : (
                        <span className={`px-2 py-0.5 rounded text-[10px] font-black uppercase border whitespace-nowrap ${tierBadgeClass(user.tier)}`}>
                          {user.tier}
                        </span>
                      )}
                    </td>
                    <td className={tdClass}>
                      {isEditing ? (
                        <CustomSelect
                          theme={theme}
                          value={row.status}
                          onChange={(val) => setDraft(d => d && { ...d, status: val as UserProfile["status"] })}
                          triggerClassName={selectTriggerClass}
                          options={STATUSES.map(s => ({ value: s, label: s }))}
                        />
                      ) : (
                        <span className={`px-2 py-0.5 rounded text-[10px] font-black uppercase border whitespace-nowrap ${statusBadgeClass(user.status)}`}>
                          {user.status}
                        </span>
                      )}
                    </td>
                    <td className={`${tdClass} text-[10.5px] whitespace-nowrap ${dark ? "text-stone-400" : "text-stone-500"}`}>
                      {user.createdAt ? formatDisplayTimestamp(user.createdAt) : "—"}
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
                              onClick={() => startEdit(user)}
                              disabled={!isDeveloper}
                              cornerBg={dark ? "#0e2236" : "#ffffff"}
                              className={`p-1.5 ${dark ? "hover:bg-sky-500/15 text-stone-400 hover:text-sky-400" : "hover:bg-sky-500/10 text-stone-500 hover:text-sky-600"}`}
                              title={isDeveloper ? "Edit user" : "Developer clearance required to edit users"}
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </ClippedButton>
                            <ClippedButton
                              onClick={() => deleteUser(user.email)}
                              disabled={!isDeveloper}
                              cornerBg={dark ? "#0e2236" : "#ffffff"}
                              className={`p-1.5 ${dark ? "hover:bg-red-500/15 text-stone-400 hover:text-red-400" : "hover:bg-red-500/10 text-stone-500 hover:text-red-600"}`}
                              title={isDeveloper ? "Remove user" : "Developer clearance required to remove users"}
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
            {searchQuery ? " matching users" : " users"}. {isDeveloper
              ? "Changes are saved to the server."
              : canManage
                ? "Admin clearance lets you add new users. Editing or removing an existing user requires Developer clearance."
                : "Admin clearance grants read-only visibility into the directory. Developer clearance is required to add, edit, or remove users."}
          </p>
          <Pagination theme={theme} page={page} totalPages={totalPages} onPageChange={setPage} />
        </div>
      </div>
    </div>
  );
}
