/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { Pencil, Save, X, Trash2, UserPlus, RefreshCw, ShieldCheck, AlertTriangle, Search } from "lucide-react";
import { UserProfile, LoggedUser } from "../types/user";
import { ChangeLogEntry } from "../types/changeLog";
import { ClippedButton } from "./ClippedButton";
import { CustomSelect } from "./CustomSelect";
import { formatDisplayTimestamp } from "../utils/timestamps";
import { SortableTh } from "./SortableTh";
import { useSortableData, stringComparator, dateComparator } from "../utils/useSortableData";

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
  status: "Active"
});

/**
 * Developer-editable, Admin-visible directory of every advisor account. This is
 * the UI for the server-backed "User Directory" feature: reads come from
 * GET /api/users on mount (so the directory reflects the shared source of
 * truth rather than a stale local cache), and Developer edits are saved via
 * PUT /api/users so the change is picked up by every other user's session —
 * not just persisted to the editor's own localStorage.
 *
 * `usersList` / `setUsersList` (App.tsx's usePersistentState-backed state)
 * are still kept in sync here as a fast local cache / offline fallback, but
 * the server is authoritative.
 */
export function ProfileAccessManagement({ theme, usersList, setUsersList, effectiveTier, currentUser, setChangeLogs }: ProfileAccessManagementProps) {
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

  const [loading, setLoading] = useState(true);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  const [editingEmail, setEditingEmail] = useState<string | null>(null);
  const [draft, setDraft] = useState<UserProfile | null>(null);
  const [addingNew, setAddingNew] = useState(false);
  const [newDraft, setNewDraft] = useState<UserProfile>(emptyDraft());
  const [searchQuery, setSearchQuery] = useState("");

  const filteredUsersList = usersList
    .filter(user => {
      const q = searchQuery.trim().toLowerCase();
      if (!q) return true;
      return (
        user.name.toLowerCase().includes(q) ||
        user.email.toLowerCase().includes(q) ||
        user.tactId.toLowerCase().includes(q) ||
        user.tier.toLowerCase().includes(q) ||
        user.status.toLowerCase().includes(q)
      );
    })
    // Latest to oldest by join time (users.created_at, set by the DB on
    // insert). Entries with no createdAt (shouldn't normally happen — the
    // column defaults to now() on insert — but the field is optional on the
    // type since older/local-only records may predate this being wired up)
    // sort to the end rather than crashing the comparator.
    .sort((a, b) => {
      const aTime = a.createdAt ? new Date(a.createdAt).getTime() : -Infinity;
      const bTime = b.createdAt ? new Date(b.createdAt).getTime() : -Infinity;
      return bTime - aTime;
    });

  // Click-to-sort layered on top of the default latest-to-oldest order
  // above: with no column clicked (sort === null), useSortableData passes
  // filteredUsersList through unchanged, so the existing "newest join first"
  // default is preserved exactly. Clicking a header overrides it.
  const { sorted: sortedUsersList, sort: usersSort, toggleSort: toggleUsersSort } = useSortableData(
    filteredUsersList,
    {
      name: stringComparator((user: UserProfile) => user.name),
      email: stringComparator((user: UserProfile) => user.email),
      tactId: stringComparator((user: UserProfile) => user.tactId),
      tier: stringComparator((user: UserProfile) => user.tier),
      status: stringComparator((user: UserProfile) => user.status),
      createdAt: dateComparator((user: UserProfile) => user.createdAt),
    }
  );

  // Pull the server's copy of the directory on mount so this view (and the
  // shared usersList state) reflects whatever the Developer last saved, even if
  // that edit happened from a different browser/device.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/users");
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || `Failed to load user directory (HTTP ${res.status}).`);
        }
        const data = await res.json();
        if (!cancelled && Array.isArray(data.users)) {
          setUsersList(data.users);
        }
      } catch (err: any) {
        if (!cancelled) {
          setSyncError(err.message || "Could not reach the server. Showing the last locally cached directory.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // Intentionally run once on mount — subsequent edits go through
    // persistDirectory below, which updates usersList locally in lockstep.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const persistDirectory = async (nextUsers: UserProfile[]) => {
    setSaving(true);
    setSaveError(null);
    setSaveSuccess(false);
    try {
      const res = await fetch("/api/users", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ users: nextUsers })
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(body.error || `Failed to save the user directory (HTTP ${res.status}).`);
      }
      setUsersList(body.users || nextUsers);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 2500);
      return true;
    } catch (err: any) {
      setSaveError(err.message || "Failed to save changes. Please try again.");
      return false;
    } finally {
      setSaving(false);
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
    if (!draft) return;
    const nextUsers = usersList.map(u => (u.email === editingEmail ? draft : u));
    const ok = await persistDirectory(nextUsers);
    if (ok) {
      logAction("User Edited", `Updated directory entry for ${draft.name} (${draft.email}) — Tier: ${draft.tier}, Status: ${draft.status}.`);
      setEditingEmail(null);
      setDraft(null);
    }
  };

  const deleteUser = async (email: string) => {
    if (!window.confirm(`Remove ${email} from the user directory? This cannot be undone.`)) return;
    const removedUser = usersList.find(u => u.email === email);
    const nextUsers = usersList.filter(u => u.email !== email);
    const ok = await persistDirectory(nextUsers);
    if (ok) {
      logAction("User Deleted", `Removed ${removedUser?.name || email} (${email}) from the user directory.`);
    }
  };

  const saveNewUser = async () => {
    if (!newDraft.email.trim() || !newDraft.name.trim() || !newDraft.tactId.trim()) {
      setSaveError("Email, name, and TACT ID are required to add a user.");
      return;
    }
    if (usersList.some(u => u.email.toLowerCase() === newDraft.email.toLowerCase().trim())) {
      setSaveError("A user with that email already exists in the directory.");
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      // Single-row create — works for both Admin and Developer (unlike the
      // Developer-only, full-array PUT used for editing/removing an existing
      // user). See server.ts's POST /api/users for why this is safe to
      // expose to Admin.
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
                {usersList.length.toLocaleString()} {usersList.length === 1 ? "user" : "users"}
              </span>
            )}

            <div className="relative w-56 shrink-0">
              <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-stone-400 pointer-events-none" />
              <input
                type="text"
                placeholder="Search the directory..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className={`w-full py-1.5 pl-8 pr-4 text-xs font-semibold rounded-lg border outline-none transition-all ${
                  dark
                    ? "bg-[#060A10] border-stone-850 text-white focus:border-sky-500"
                    : "bg-white border-stone-250 text-stone-900 focus:border-sky-400 shadow-inner"
                }`}
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery("")}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold text-stone-400 hover:text-stone-100"
                  title="Clear search"
                >
                  &times;
                </button>
              )}
            </div>
          </div>

          {canManage && !addingNew && (
            <ClippedButton
              type="button"
              onClick={() => { setAddingNew(true); setSaveError(null); }}
              cornerBg={dark ? "#0e2236" : "#ffffff"}
              // Solid primary blue (var(--accent-solid), the app's
              // theme-aware "solid button" color — deep blue in light mode,
              // cyan in dark mode, same variable PrimaryCtaButton uses)
              // rather than the previous pastel/muted chip look, per design
              // feedback.
              style={{
                backgroundColor: "var(--accent-solid)",
                borderColor: "var(--accent-solid)",
                color: "var(--on-accent)",
              }}
              className="flex items-center gap-1.5 text-[10px] font-mono font-bold uppercase tracking-[0.15em] px-3 py-2 border hover:brightness-110 shrink-0"
            >
              <UserPlus className="w-3.5 h-3.5 shrink-0" />
              Add User
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
          <table className="w-full border-collapse min-w-[820px]">
            <thead>
              <tr className={`border-b ${dark ? "bg-white/[0.02] border-stone-850" : "bg-stone-50 border-stone-200"}`}>
                <SortableTh label="Name" sortKey="name" activeSort={usersSort} onSort={toggleUsersSort} className={thClass} />
                <SortableTh label="Email" sortKey="email" activeSort={usersSort} onSort={toggleUsersSort} className={thClass} />
                <SortableTh label="TACT ID" sortKey="tactId" activeSort={usersSort} onSort={toggleUsersSort} className={thClass} />
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
                    <input className={inputClass} placeholder="e.g. TACT128" value={newDraft.tactId} onChange={e => setNewDraft(d => ({ ...d, tactId: e.target.value }))} />
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

              {searchQuery && filteredUsersList.length === 0 && (
                <tr>
                  <td colSpan={canManage ? 7 : 6} className="py-10 text-center text-xs font-semibold text-stone-400">
                    No directory entries match "{searchQuery}".
                  </td>
                </tr>
              )}

              {sortedUsersList.map((user, idx) => {
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
                        <input className={inputClass} value={row.tactId} onChange={e => setDraft(d => d && { ...d, tactId: e.target.value })} />
                      ) : (
                        <span className={`font-mono text-[10.5px] ${dark ? "text-stone-300" : "text-stone-700"}`}>{user.tactId}</span>
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

        <p className="text-[10.5px] font-semibold text-content-muted">
          {isDeveloper
            ? "Changes are saved to the server."
            : canManage
              ? "Admin clearance lets you add new users. Editing or removing an existing user requires Developer clearance."
              : "Admin clearance grants read-only visibility into the directory. Developer clearance is required to add, edit, or remove users."}
        </p>
      </div>
    </div>
  );
}
