/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { Pencil, Save, X, Trash2, UserPlus, RefreshCw, ShieldCheck, AlertTriangle, Search, Download, Filter, Calendar, ShieldQuestion, CheckSquare, Square, Layers } from "lucide-react";
import { UserProfile, LoggedUser } from "../types/user";
import { Department, FeatureAccessOverride, OrgTeam, AppRole } from "../types/permissions";
import { ChangeLogEntry } from "../types/changeLog";
import { ClippedButton } from "./ClippedButton";
import { CustomSelect } from "./CustomSelect";
import { EffectiveAccessModal } from "./EffectiveAccessModal";
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
  effectiveTier: "General" | "Admin" | "Platform Admin" | "Developer";
  currentUser: LoggedUser | null;
  setChangeLogs: Dispatch<SetStateAction<ChangeLogEntry[]>>;
  /** Organizational metadata only — see types/permissions.ts's doc comment
   * on Department. Only Active departments are offered in the assignment
   * dropdown below; an already-assigned-but-now-inactive department still
   * displays correctly on existing rows (see departmentLabel). */
  departments: Department[];
  /** Foundation-only Team/Role catalogs (see types/permissions.ts's doc
   * comments on OrgTeam/AppRole) — same "Active only in the dropdown,
   * inactive-but-assigned still displays" posture as departments above. */
  orgTeams: OrgTeam[];
  roles: AppRole[];
  /** For the "Effective Access" panel — see EffectiveAccessModal. Both are
   * already live App.tsx state (the same values hasAccess() itself reads),
   * so the panel always reflects the current, real access rules. */
  featureAccessOverrides: FeatureAccessOverride[];
  hiddenPages: string[];
}

const TIERS: UserProfile["tier"][] = ["General", "Admin", "Platform Admin", "Developer"];
// Admin can add users, but can't mint a new Developer or Platform Admin from
// this form — matches the server-side check in POST /api/users.
const ADMIN_ADDABLE_TIERS: UserProfile["tier"][] = ["General", "Admin"];
// Platform Admin can add users up to and including another Platform Admin,
// but never a Developer — matches server.ts's POST /api/users check
// (`tier === "Platform Admin" && callerTier === "Admin"` is the only block;
// Platform Admin itself is still blocked from minting a Developer by the
// separate `tier === "Developer" && callerTier !== "Developer"` check).
const PLATFORM_ADMIN_ADDABLE_TIERS: UserProfile["tier"][] = ["General", "Admin", "Platform Admin"];
const STATUSES: UserProfile["status"][] = ["Active", "Disabled"];

const emptyDraft = (): UserProfile => ({
  email: "",
  name: "",
  tactId: "",
  tier: "General",
  status: "Active",
  tags: [],
  departmentId: null,
  orgTeamId: null,
  roleId: null,
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
export function ProfileAccessManagement({ theme, setUsersList, effectiveTier, currentUser, setChangeLogs, departments, orgTeams, roles, featureAccessOverrides, hiddenPages }: ProfileAccessManagementProps) {
  const dark = theme === "dark";
  const isDeveloper = effectiveTier === "Developer";
  // Platform Admin gets the same edit/delete/tier-assign rights as a real
  // Developer EXCEPT for the 3 Developer-record protections enforced
  // server-side (see server.ts's isDeveloperPower/blanket Developer-record
  // checks) — those are handled per-row below via canEditRow, not here.
  const isDeveloperPowerTier = isDeveloper || effectiveTier === "Platform Admin";
  // Admin can see and use "Add User" (same pattern as "Add Plan" on the
  // Plan Management page); Edit/Delete stay visible for Admin but render
  // disabled — Developer (or Platform Admin) clearance is required to
  // actually edit or remove an existing directory entry.
  const canManage = effectiveTier === "Admin" || isDeveloperPowerTier;
  // Tiers this caller may assign — mirrors server.ts's POST/PATCH
  // /api/users tier-clearance checks exactly.
  const assignableTiers: UserProfile["tier"][] = isDeveloper
    ? TIERS
    : effectiveTier === "Platform Admin"
      ? PLATFORM_ADMIN_ADDABLE_TIERS
      : ADMIN_ADDABLE_TIERS;
  // A Platform Admin (not a real Developer) may not edit/delete an existing
  // Developer's row at all — mirrors server.ts's blanket
  // `existing.tier === "Developer" && callerTier !== "Developer"` check.
  const canEditRow = (user: UserProfile) => isDeveloperPowerTier && !(user.tier === "Developer" && !isDeveloper);

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

  const [effectiveAccessUser, setEffectiveAccessUser] = useState<UserProfile | null>(null);
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

  // Bulk selection — `selectedEmails` persists across page changes (check
  // rows on page 1, flip to page 2, check more, then Apply once) since only
  // ONE page of the directory is ever loaded at a time (see the component
  // doc comment above). `selectAllMatching` is a SEPARATE flag for "every
  // row matching the current search/filters, not just what's loaded" — the
  // two are mutually exclusive, since the server has no notion of "every row
  // matching this filter EXCEPT these few explicitly-unchecked ones": turning
  // one on always clears the other, and toggling any individual checkbox
  // while selectAllMatching is on drops back into ordinary explicit selection
  // starting from the current page.
  const [selectedEmails, setSelectedEmails] = useState<Set<string>>(new Set());
  const [selectAllMatching, setSelectAllMatching] = useState(false);
  const selectionCount = selectAllMatching ? total : selectedEmails.size;
  const [bulkFields, setBulkFields] = useState({ tier: false, status: false, department: false, team: false, role: false, tags: false });
  const [bulkTier, setBulkTier] = useState<UserProfile["tier"]>("General");
  const [bulkStatus, setBulkStatus] = useState<UserProfile["status"]>("Active");
  const [bulkDepartmentId, setBulkDepartmentId] = useState<number | null>(null);
  const [bulkTeamId, setBulkTeamId] = useState<number | null>(null);
  const [bulkRoleId, setBulkRoleId] = useState<number | null>(null);
  const [bulkTags, setBulkTags] = useState<string[]>([]);
  const [bulkSaving, setBulkSaving] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [bulkResult, setBulkResult] = useState<string | null>(null);

  const clearSelection = () => {
    setSelectedEmails(new Set());
    setSelectAllMatching(false);
    setBulkFields({ tier: false, status: false, department: false, team: false, role: false, tags: false });
    setBulkError(null);
  };
  const toggleRowSelection = (email: string) => {
    setSelectAllMatching(false);
    setSelectedEmails(prev => {
      const next = new Set(prev);
      if (next.has(email)) next.delete(email); else next.add(email);
      return next;
    });
  };
  // Only rows this caller could edit one-by-one are selectable in bulk
  // either — same clearance the row's Pencil/Trash icons already require
  // (see canEditRow above), kept consistent rather than letting a checkbox
  // silently include a row the caller can't actually change.
  const selectableEntries = entries.filter(canEditRow);
  const allOnPageSelected = selectableEntries.length > 0 && selectableEntries.every(u => selectedEmails.has(u.email));
  const toggleSelectAllOnPage = () => {
    setSelectAllMatching(false);
    setSelectedEmails(prev => {
      const next = new Set(prev);
      if (allOnPageSelected) {
        selectableEntries.forEach(u => next.delete(u.email));
      } else {
        selectableEntries.forEach(u => next.add(u.email));
      }
      return next;
    });
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
        body: JSON.stringify({ name: draft.name, tactId: draft.tactId, tier: draft.tier, status: draft.status, tags: draft.tags || [], departmentId: draft.departmentId ?? null, orgTeamId: draft.orgTeamId ?? null, roleId: draft.roleId ?? null }),
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

  const anyBulkFieldEnabled = bulkFields.tier || bulkFields.status || bulkFields.department || bulkFields.team || bulkFields.role || bulkFields.tags;

  // Applies whichever fields are toggled ON in `bulkFields` to the whole
  // current selection in ONE request — either the explicit checked-email
  // list, or (when selectAllMatching) the active search/filter, which the
  // server re-resolves itself via PATCH /api/users/bulk rather than the
  // client ever needing to fetch every matching row just to list their
  // emails. Only enabled fields are sent, so leaving (say) Department off
  // never touches anyone's existing department.
  const applyBulkEdit = async () => {
    if (!anyBulkFieldEnabled || selectionCount === 0) return;
    const changes: Record<string, any> = {};
    const changedLabels: string[] = [];
    if (bulkFields.tier) { changes.tier = bulkTier; changedLabels.push(`Tier → ${bulkTier}`); }
    if (bulkFields.status) { changes.status = bulkStatus; changedLabels.push(`Status → ${bulkStatus}`); }
    if (bulkFields.department) { changes.departmentId = bulkDepartmentId; changedLabels.push(`Department → ${departmentLabel(bulkDepartmentId) || "Unassigned"}`); }
    if (bulkFields.team) { changes.orgTeamId = bulkTeamId; changedLabels.push(`Team → ${teamLabel(bulkTeamId) || "Unassigned"}`); }
    if (bulkFields.role) { changes.roleId = bulkRoleId; changedLabels.push(`Role → ${roleLabel(bulkRoleId) || "Unassigned"}`); }
    if (bulkFields.tags) { changes.tags = bulkTags; changedLabels.push(`Tags → ${bulkTags.length ? bulkTags.join(" + ") : "Unassigned"}`); }

    const confirmMsg = `Apply ${changedLabels.join(", ")} to ${selectionCount.toLocaleString()} ${selectionCount === 1 ? "user" : "users"}? This cannot be undone.`;
    if (!window.confirm(confirmMsg)) return;

    setBulkSaving(true);
    setBulkError(null);
    try {
      const body: Record<string, any> = { changes };
      if (selectAllMatching) {
        body.filter = {
          search: searchQuery || undefined,
          tag: tagFilter || undefined,
          tier: tierFilter || undefined,
          status: statusFilter || undefined,
          dateFrom: joinedFrom || undefined,
          dateTo: joinedTo || undefined,
        };
      } else {
        body.emails = Array.from(selectedEmails);
      }
      const res = await fetch("/api/users/bulk", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const resBody = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(resBody.error || `Failed to bulk-update users (HTTP ${res.status}).`);
      const updatedCount = resBody.updatedCount ?? 0;
      const skippedCount = resBody.skippedCount ?? 0;
      logAction(
        "Bulk Edit",
        `Bulk-updated ${updatedCount} ${updatedCount === 1 ? "user" : "users"} in the directory — ${changedLabels.join(", ")}.${
          skippedCount ? ` ${skippedCount} skipped (Developer-record protection).` : ""
        }`
      );
      setBulkResult(
        `Updated ${updatedCount.toLocaleString()} ${updatedCount === 1 ? "user" : "users"}.${
          skippedCount ? ` ${skippedCount.toLocaleString()} skipped (Developer-record protection).` : ""
        }`
      );
      setTimeout(() => setBulkResult(null), 5000);
      clearSelection();
      await loadEntries();
    } catch (err: any) {
      setBulkError(err.message || "Failed to bulk-update the selected users. Please try again.");
    } finally {
      setBulkSaving(false);
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
      : tier === "Platform Admin"
        ? "bg-violet-500/15 text-violet-400 border-violet-500/30"
        : tier === "Admin"
          ? "bg-sky-500/15 text-sky-400 border-sky-500/30"
          // "General" text-stone-400 measured ~1.82:1 in Light theme — two
          // shades of the same gray, essentially unreadable (Issue 14). Dark
          // theme already passes, so only the light-theme text darkens here.
          : dark
            ? "bg-stone-500/15 text-stone-400 border-stone-500/30"
            : "bg-stone-500/15 text-stone-700 border-stone-500/30";

  // Active departments plus, if given, one already-assigned-but-now-inactive
  // department — keeps an existing row's dropdown showing its real current
  // value even after a Developer deactivates that department elsewhere.
  const departmentOptions = (currentId?: number | null) => [
    { value: "", label: "Unassigned" },
    ...departments
      .filter((d) => d.active || d.id === currentId)
      .map((d) => ({ value: String(d.id), label: d.active ? d.name : `${d.name} (Inactive)` })),
  ];
  const departmentLabel = (id?: number | null) => departments.find((d) => d.id === id)?.name || null;

  // Same "active + already-assigned-but-now-inactive" pattern as
  // departmentOptions above — see types/permissions.ts's doc comments on
  // OrgTeam/AppRole for why these are currently foundation-only metadata.
  const teamOptions = (currentId?: number | null) => [
    { value: "", label: "Unassigned" },
    ...orgTeams
      .filter((t) => t.active || t.id === currentId)
      .map((t) => ({ value: String(t.id), label: t.active ? t.name : `${t.name} (Inactive)` })),
  ];
  const teamLabel = (id?: number | null) => orgTeams.find((t) => t.id === id)?.name || null;

  const roleOptions = (currentId?: number | null) => [
    { value: "", label: "Unassigned" },
    ...roles
      .filter((r) => r.active || r.id === currentId)
      .map((r) => ({ value: String(r.id), label: r.active ? r.name : `${r.name} (Inactive)` })),
  ];
  const roleLabel = (id?: number | null) => roles.find((r) => r.id === id)?.name || null;

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

        {bulkResult && (
          <div className="px-3 py-2 rounded-lg text-[11px] font-bold text-emerald-500 bg-emerald-500/10 border border-emerald-500/25 flex items-center gap-1.5">
            <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
            {bulkResult}
          </div>
        )}

        {/* "Select all N on this page" only offers the "select every N
            matching this filter" upsell once the page itself is fully
            checked AND there's more beyond this one page — otherwise the two
            numbers would be identical and the link would be pointless. */}
        {canManage && !selectAllMatching && allOnPageSelected && total > selectableEntries.length && (
          <div className={`px-3 py-2 rounded-lg text-[11px] font-bold flex items-center gap-1.5 ${dark ? "bg-sky-500/10 text-sky-300 border border-sky-500/25" : "bg-sky-50 text-sky-700 border border-sky-200"}`}>
            All {selectableEntries.length} users on this page are selected.
            <button onClick={() => setSelectAllMatching(true)} className="underline hover:no-underline">
              Select all {total.toLocaleString()} users matching your filters
            </button>
          </div>
        )}

        {canManage && selectionCount > 0 && (
          <div className={`rounded-xl border p-4 space-y-3 ${dark ? "bg-sky-950/10 border-sky-500/20" : "bg-sky-50/60 border-sky-200"}`}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Layers className={`w-4 h-4 shrink-0 ${dark ? "text-sky-400" : "text-sky-600"}`} />
                <span className={`text-[11.5px] font-black ${dark ? "text-white" : "text-stone-900"}`}>
                  {selectionCount.toLocaleString()} {selectionCount === 1 ? "user" : "users"} selected
                  {selectAllMatching ? " (every user matching your filters)" : ""}
                </span>
              </div>
              <button
                onClick={clearSelection}
                className={`text-[10.5px] font-bold px-2 py-1 rounded-lg ${dark ? "text-stone-400 hover:bg-stone-800" : "text-stone-500 hover:bg-stone-100"}`}
              >
                Clear selection
              </button>
            </div>

            {bulkError && (
              <div className="px-3 py-2 rounded-lg text-[11px] font-bold text-red-400 bg-red-500/10 border border-red-500/25 flex items-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                {bulkError}
              </div>
            )}

            <p className={`text-[10.5px] font-semibold ${dark ? "text-stone-400" : "text-stone-500"}`}>
              Turn on a field below to change it for everyone selected. Fields left off are untouched.
            </p>

            <div className="flex flex-wrap items-end gap-3">
              <label className="flex items-center gap-1.5 shrink-0 cursor-pointer select-none">
                <input type="checkbox" checked={bulkFields.tier} onChange={e => setBulkFields(f => ({ ...f, tier: e.target.checked }))} className="w-3.5 h-3.5 accent-sky-500" />
                <span className={`text-[10px] font-bold uppercase tracking-wider ${dark ? "text-stone-300" : "text-stone-600"}`}>Tier</span>
              </label>
              <div className="w-36 shrink-0">
                <CustomSelect
                  theme={theme}
                  value={bulkTier}
                  onChange={(val) => setBulkTier(val as UserProfile["tier"])}
                  triggerClassName={selectTriggerClass}
                  disabled={!bulkFields.tier}
                  options={assignableTiers.map(t => ({ value: t, label: t }))}
                />
              </div>

              <label className="flex items-center gap-1.5 shrink-0 cursor-pointer select-none">
                <input type="checkbox" checked={bulkFields.status} onChange={e => setBulkFields(f => ({ ...f, status: e.target.checked }))} className="w-3.5 h-3.5 accent-sky-500" />
                <span className={`text-[10px] font-bold uppercase tracking-wider ${dark ? "text-stone-300" : "text-stone-600"}`}>Status</span>
              </label>
              <div className="w-32 shrink-0">
                <CustomSelect
                  theme={theme}
                  value={bulkStatus}
                  onChange={(val) => setBulkStatus(val as UserProfile["status"])}
                  triggerClassName={selectTriggerClass}
                  disabled={!bulkFields.status}
                  options={STATUSES.map(s => ({ value: s, label: s }))}
                />
              </div>

              <label className="flex items-center gap-1.5 shrink-0 cursor-pointer select-none">
                <input type="checkbox" checked={bulkFields.team} onChange={e => setBulkFields(f => ({ ...f, team: e.target.checked }))} className="w-3.5 h-3.5 accent-sky-500" />
                <span className={`text-[10px] font-bold uppercase tracking-wider ${dark ? "text-stone-300" : "text-stone-600"}`}>Team</span>
              </label>
              <div className="w-36 shrink-0">
                <CustomSelect
                  theme={theme}
                  value={bulkTeamId != null ? String(bulkTeamId) : ""}
                  onChange={(val) => setBulkTeamId(val ? Number(val) : null)}
                  triggerClassName={selectTriggerClass}
                  disabled={!bulkFields.team}
                  options={teamOptions(bulkTeamId)}
                />
              </div>

              <label className="flex items-center gap-1.5 shrink-0 cursor-pointer select-none">
                <input type="checkbox" checked={bulkFields.department} onChange={e => setBulkFields(f => ({ ...f, department: e.target.checked }))} className="w-3.5 h-3.5 accent-sky-500" />
                <span className={`text-[10px] font-bold uppercase tracking-wider ${dark ? "text-stone-300" : "text-stone-600"}`}>Department</span>
              </label>
              <div className="w-36 shrink-0">
                <CustomSelect
                  theme={theme}
                  value={bulkDepartmentId != null ? String(bulkDepartmentId) : ""}
                  onChange={(val) => setBulkDepartmentId(val ? Number(val) : null)}
                  triggerClassName={selectTriggerClass}
                  disabled={!bulkFields.department}
                  options={departmentOptions(bulkDepartmentId)}
                />
              </div>

              <label className="flex items-center gap-1.5 shrink-0 cursor-pointer select-none">
                <input type="checkbox" checked={bulkFields.role} onChange={e => setBulkFields(f => ({ ...f, role: e.target.checked }))} className="w-3.5 h-3.5 accent-sky-500" />
                <span className={`text-[10px] font-bold uppercase tracking-wider ${dark ? "text-stone-300" : "text-stone-600"}`}>Role</span>
              </label>
              <div className="w-36 shrink-0">
                <CustomSelect
                  theme={theme}
                  value={bulkRoleId != null ? String(bulkRoleId) : ""}
                  onChange={(val) => setBulkRoleId(val ? Number(val) : null)}
                  triggerClassName={selectTriggerClass}
                  disabled={!bulkFields.role}
                  options={roleOptions(bulkRoleId)}
                />
              </div>

              <label className="flex items-center gap-1.5 shrink-0 cursor-pointer select-none self-center">
                <input type="checkbox" checked={bulkFields.tags} onChange={e => setBulkFields(f => ({ ...f, tags: e.target.checked }))} className="w-3.5 h-3.5 accent-sky-500" />
                <span className={`text-[10px] font-bold uppercase tracking-wider ${dark ? "text-stone-300" : "text-stone-600"}`}>Tags</span>
              </label>
              <div className={`shrink-0 ${bulkFields.tags ? "" : "opacity-40 pointer-events-none"}`}>
                <AdvisorTagCheckboxes theme={theme} value={bulkTags} onChange={setBulkTags} />
              </div>

              <ClippedButton
                onClick={applyBulkEdit}
                disabled={!anyBulkFieldEnabled || bulkSaving}
                cornerBg={dark ? "#0e2236" : "#ffffff"}
                style={{ backgroundColor: "var(--action-navy)", borderColor: "var(--action-navy)", color: "var(--on-action-navy)" }}
                className="flex items-center gap-1.5 text-[10px] font-mono font-bold uppercase tracking-[0.15em] px-3 py-2 border hover:brightness-110 shrink-0 ml-auto"
              >
                {bulkSaving ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                Apply to {selectionCount.toLocaleString()}
              </ClippedButton>
            </div>
          </div>
        )}

        <div className={`rounded-xl border overflow-x-auto ${dark ? "border-stone-850" : "border-stone-200"}`}>
          <table className="w-full border-collapse min-w-[1020px]">
            <thead>
              <tr className={`border-b ${dark ? "bg-white/[0.02] border-stone-850" : "bg-stone-50 border-stone-200"}`}>
                {canManage && (
                  <th className={`${thClass} w-8`}>
                    <button
                      onClick={toggleSelectAllOnPage}
                      disabled={selectableEntries.length === 0}
                      title={allOnPageSelected ? "Deselect all on this page" : "Select all on this page"}
                      className={`flex items-center justify-center ${selectableEntries.length === 0 ? "opacity-30 cursor-not-allowed" : "cursor-pointer"}`}
                    >
                      {allOnPageSelected || selectAllMatching ? (
                        <CheckSquare className={`w-4 h-4 ${dark ? "text-sky-400" : "text-sky-600"}`} />
                      ) : (
                        <Square className={`w-4 h-4 ${dark ? "text-stone-600" : "text-stone-400"}`} />
                      )}
                    </button>
                  </th>
                )}
                <SortableTh label="Name" sortKey="name" activeSort={usersSort} onSort={toggleUsersSort} className={thClass} />
                <SortableTh label="Email" sortKey="email" activeSort={usersSort} onSort={toggleUsersSort} className={thClass} />
                <SortableTh label="TACT ID" sortKey="tactId" activeSort={usersSort} onSort={toggleUsersSort} className={thClass} />
                <th className={thClass}>Tags</th>
                <th className={thClass}>Team</th>
                <th className={thClass}>Department</th>
                <th className={thClass}>Role</th>
                <SortableTh label="Tier" sortKey="tier" activeSort={usersSort} onSort={toggleUsersSort} className={thClass} />
                <SortableTh label="Status" sortKey="status" activeSort={usersSort} onSort={toggleUsersSort} className={thClass} />
                <SortableTh label="Joined" sortKey="createdAt" activeSort={usersSort} onSort={toggleUsersSort} className={thClass} />
                {canManage && (
                  // Sticky so Save/Cancel stay reachable without scrolling right —
                  // edit mode widens the row (TACT input, tag checkboxes, dropdowns)
                  // well past the viewport (2026-08-25 fix). Solid backing (matching
                  // this file's other "sunken surface" inputs) so scrolled-under
                  // cells don't show through.
                  <th className={`${thClass} text-right sticky right-0 z-20 border-l ${dark ? "bg-[#060a12] border-stone-850" : "bg-white border-stone-200"}`}>
                    Actions
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {addingNew && (
                <tr className={`border-b ${dark ? "border-stone-850 bg-sky-950/10" : "border-stone-150 bg-sky-50/60"}`}>
                  {canManage && <td className={tdClass} />}
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
                      value={newDraft.orgTeamId != null ? String(newDraft.orgTeamId) : ""}
                      onChange={(val) => setNewDraft(d => ({ ...d, orgTeamId: val ? Number(val) : null }))}
                      triggerClassName={selectTriggerClass}
                      options={teamOptions(newDraft.orgTeamId)}
                    />
                  </td>
                  <td className={tdClass}>
                    <CustomSelect
                      theme={theme}
                      value={newDraft.departmentId != null ? String(newDraft.departmentId) : ""}
                      onChange={(val) => setNewDraft(d => ({ ...d, departmentId: val ? Number(val) : null }))}
                      triggerClassName={selectTriggerClass}
                      options={departmentOptions(newDraft.departmentId)}
                    />
                  </td>
                  <td className={tdClass}>
                    <CustomSelect
                      theme={theme}
                      value={newDraft.roleId != null ? String(newDraft.roleId) : ""}
                      onChange={(val) => setNewDraft(d => ({ ...d, roleId: val ? Number(val) : null }))}
                      triggerClassName={selectTriggerClass}
                      options={roleOptions(newDraft.roleId)}
                    />
                  </td>
                  <td className={tdClass}>
                    <CustomSelect
                      theme={theme}
                      value={newDraft.tier}
                      onChange={(val) => setNewDraft(d => ({ ...d, tier: val as UserProfile["tier"] }))}
                      triggerClassName={selectTriggerClass}
                      options={assignableTiers.map(t => ({ value: t, label: t }))}
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
                  <td className={`${tdClass} text-right sticky right-0 z-10 border-l ${dark ? "bg-[#060a12] border-stone-850" : "bg-white border-stone-200"}`}>
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
                  <td colSpan={canManage ? 12 : 10} className="py-10 text-center text-xs font-semibold text-stone-400">
                    {searchQuery ? `No directory entries match "${searchQuery}".` : "No directory entries yet."}
                  </td>
                </tr>
              )}

              {entries.map((user, idx) => {
                const isEditing = canEditRow(user) && editingEmail === user.email;
                const row = isEditing && draft ? draft : user;
                const isChecked = selectAllMatching || selectedEmails.has(user.email);
                return (
                  <tr
                    key={user.email}
                    className={`border-b last:border-b-0 align-top ${dark ? "border-stone-850" : "border-stone-150"} ${
                      idx % 2 === 1 ? (dark ? "bg-white/[0.015]" : "bg-stone-50/60") : ""
                    }`}
                  >
                    {canManage && (
                      <td className={tdClass}>
                        <button
                          onClick={() => toggleRowSelection(user.email)}
                          disabled={!canEditRow(user)}
                          title={canEditRow(user) ? (isChecked ? "Deselect" : "Select for bulk edit") : "Developer (or Platform Admin) clearance required to include this row in a bulk edit"}
                          className={`flex items-center justify-center ${!canEditRow(user) ? "opacity-30 cursor-not-allowed" : "cursor-pointer"}`}
                        >
                          {isChecked ? (
                            <CheckSquare className={`w-4 h-4 ${dark ? "text-sky-400" : "text-sky-600"}`} />
                          ) : (
                            <Square className={`w-4 h-4 ${dark ? "text-stone-600" : "text-stone-400"}`} />
                          )}
                        </button>
                      </td>
                    )}
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
                          value={row.orgTeamId != null ? String(row.orgTeamId) : ""}
                          onChange={(val) => setDraft(d => d && { ...d, orgTeamId: val ? Number(val) : null })}
                          triggerClassName={selectTriggerClass}
                          options={teamOptions(row.orgTeamId)}
                        />
                      ) : teamLabel(user.orgTeamId) ? (
                        <span className={`text-[10.5px] font-semibold ${dark ? "text-stone-300" : "text-stone-700"}`}>{teamLabel(user.orgTeamId)}</span>
                      ) : (
                        <span className={`text-[10.5px] ${dark ? "text-stone-600" : "text-stone-400"}`}>—</span>
                      )}
                    </td>
                    <td className={tdClass}>
                      {isEditing ? (
                        <CustomSelect
                          theme={theme}
                          value={row.departmentId != null ? String(row.departmentId) : ""}
                          onChange={(val) => setDraft(d => d && { ...d, departmentId: val ? Number(val) : null })}
                          triggerClassName={selectTriggerClass}
                          options={departmentOptions(row.departmentId)}
                        />
                      ) : departmentLabel(user.departmentId) ? (
                        <span className={`text-[10.5px] font-semibold ${dark ? "text-stone-300" : "text-stone-700"}`}>{departmentLabel(user.departmentId)}</span>
                      ) : (
                        <span className={`text-[10.5px] ${dark ? "text-stone-600" : "text-stone-400"}`}>—</span>
                      )}
                    </td>
                    <td className={tdClass}>
                      {isEditing ? (
                        <CustomSelect
                          theme={theme}
                          value={row.roleId != null ? String(row.roleId) : ""}
                          onChange={(val) => setDraft(d => d && { ...d, roleId: val ? Number(val) : null })}
                          triggerClassName={selectTriggerClass}
                          options={roleOptions(row.roleId)}
                        />
                      ) : roleLabel(user.roleId) ? (
                        <span className={`text-[10.5px] font-semibold ${dark ? "text-stone-300" : "text-stone-700"}`}>{roleLabel(user.roleId)}</span>
                      ) : (
                        <span className={`text-[10.5px] ${dark ? "text-stone-600" : "text-stone-400"}`}>—</span>
                      )}
                    </td>
                    <td className={tdClass}>
                      {isEditing ? (
                        <CustomSelect
                          theme={theme}
                          value={row.tier}
                          onChange={(val) => setDraft(d => d && { ...d, tier: val as UserProfile["tier"] })}
                          triggerClassName={selectTriggerClass}
                          options={assignableTiers.map(t => ({ value: t, label: t }))}
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
                      <td className={`${tdClass} text-right sticky right-0 z-10 border-l ${dark ? "bg-[#060a12] border-stone-850" : "bg-white border-stone-200"}`}>
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
                              onClick={() => setEffectiveAccessUser(user)}
                              cornerBg={dark ? "#0e2236" : "#ffffff"}
                              className={`p-1.5 ${dark ? "hover:bg-violet-500/15 text-stone-400 hover:text-violet-400" : "hover:bg-violet-500/10 text-stone-500 hover:text-violet-600"}`}
                              title="What can this person actually access, and why?"
                            >
                              <ShieldQuestion className="w-3.5 h-3.5" />
                            </ClippedButton>
                            <ClippedButton
                              onClick={() => startEdit(user)}
                              disabled={!canEditRow(user)}
                              cornerBg={dark ? "#0e2236" : "#ffffff"}
                              className={`p-1.5 ${dark ? "hover:bg-sky-500/15 text-stone-400 hover:text-sky-400" : "hover:bg-sky-500/10 text-stone-500 hover:text-sky-600"}`}
                              title={canEditRow(user) ? "Edit user" : user.tier === "Developer" ? "Only a Developer can edit a Developer's account" : "Developer (or Platform Admin) clearance required to edit users"}
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </ClippedButton>
                            <ClippedButton
                              onClick={() => deleteUser(user.email)}
                              disabled={!canEditRow(user)}
                              cornerBg={dark ? "#0e2236" : "#ffffff"}
                              className={`p-1.5 ${dark ? "hover:bg-red-500/15 text-stone-400 hover:text-red-400" : "hover:bg-red-500/10 text-stone-500 hover:text-red-600"}`}
                              title={canEditRow(user) ? "Remove user" : user.tier === "Developer" ? "Only a Developer can remove a Developer's account" : "Developer (or Platform Admin) clearance required to remove users"}
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
            {searchQuery ? " matching users" : " users"}. {isDeveloperPowerTier
              ? "Changes are saved to the server."
              : canManage
                ? "Admin clearance lets you add new users. Editing or removing an existing user requires Developer or Platform Admin clearance."
                : "Admin clearance grants read-only visibility into the directory. Developer or Platform Admin clearance is required to add, edit, or remove users."}
          </p>
          <Pagination theme={theme} page={page} totalPages={totalPages} onPageChange={setPage} />
        </div>
      </div>

      {effectiveAccessUser && (
        <EffectiveAccessModal
          theme={theme}
          user={effectiveAccessUser}
          departments={departments}
          orgTeams={orgTeams}
          roles={roles}
          featureAccessOverrides={featureAccessOverrides}
          hiddenPages={hiddenPages}
          onClose={() => setEffectiveAccessUser(null)}
        />
      )}
    </div>
  );
}
