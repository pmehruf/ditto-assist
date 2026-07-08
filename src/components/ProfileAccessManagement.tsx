/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { Pencil, Save, X, Trash2, UserPlus, RefreshCw, ShieldCheck, AlertTriangle } from "lucide-react";
import { UserProfile } from "../types/user";

interface ProfileAccessManagementProps {
  theme: "light" | "dark";
  usersList: UserProfile[];
  setUsersList: Dispatch<SetStateAction<UserProfile[]>>;
  effectiveTier: "General" | "Admin" | "Owner";
}

const TIERS: UserProfile["tier"][] = ["General", "Admin", "Owner"];
const STATUSES: UserProfile["status"][] = ["Active", "Pending First Login"];

const emptyDraft = (): UserProfile => ({
  email: "",
  name: "",
  tactId: "",
  tier: "General",
  status: "Pending First Login"
});

/**
 * Owner-editable, Admin-visible directory of every advisor account. This is
 * the UI for the server-backed "User Directory" feature: reads come from
 * GET /api/users on mount (so the directory reflects the shared source of
 * truth rather than a stale local cache), and Owner edits are saved via
 * PUT /api/users so the change is picked up by every other user's session —
 * not just persisted to the editor's own localStorage.
 *
 * `usersList` / `setUsersList` (App.tsx's usePersistentState-backed state)
 * are still kept in sync here as a fast local cache / offline fallback, but
 * the server is authoritative.
 */
export function ProfileAccessManagement({ theme, usersList, setUsersList, effectiveTier }: ProfileAccessManagementProps) {
  const dark = theme === "dark";
  const isOwner = effectiveTier === "Owner";

  const [loading, setLoading] = useState(true);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  const [editingEmail, setEditingEmail] = useState<string | null>(null);
  const [draft, setDraft] = useState<UserProfile | null>(null);
  const [addingNew, setAddingNew] = useState(false);
  const [newDraft, setNewDraft] = useState<UserProfile>(emptyDraft());

  // Pull the server's copy of the directory on mount so this view (and the
  // shared usersList state) reflects whatever the Owner last saved, even if
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
      setEditingEmail(null);
      setDraft(null);
    }
  };

  const deleteUser = async (email: string) => {
    if (!window.confirm(`Remove ${email} from the user directory? This cannot be undone.`)) return;
    const nextUsers = usersList.filter(u => u.email !== email);
    await persistDirectory(nextUsers);
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
    const nextUsers = [...usersList, { ...newDraft, email: newDraft.email.trim().toLowerCase() }];
    const ok = await persistDirectory(nextUsers);
    if (ok) {
      setAddingNew(false);
      setNewDraft(emptyDraft());
    }
  };

  const thClass = `px-3 py-2.5 text-left text-[9.5px] font-black uppercase tracking-wider whitespace-nowrap ${
    dark ? "text-stone-400" : "text-stone-500"
  }`;
  const tdClass = "px-3 py-2.5 align-top text-xs";
  const inputClass = `w-full text-[11px] px-2 py-1 rounded-lg border outline-none font-semibold ${
    dark ? "bg-[#060a12] border-stone-850 text-white focus:border-sky-500" : "bg-white border-stone-200 text-stone-900 focus:border-sky-400"
  }`;

  const tierBadgeClass = (tier: UserProfile["tier"]) =>
    tier === "Owner"
      ? "bg-amber-500/15 text-amber-400 border-amber-500/30"
      : tier === "Admin"
        ? "bg-sky-500/15 text-sky-400 border-sky-500/30"
        : "bg-stone-500/15 text-stone-400 border-stone-500/30";

  const statusBadgeClass = (status: UserProfile["status"]) =>
    status === "Active"
      ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30"
      : "bg-orange-500/15 text-orange-400 border-orange-500/30";

  return (
    <div className={`rounded-2xl border p-5 transition-all ${
      dark ? "bg-[#0b1328]/90 border-white/[0.04]" : "bg-white border-stone-200 shadow-xs"
    }`}>
      <div className="space-y-4">
        {/* Status row: sync state + add-user action */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            {loading ? (
              <span className={`text-[11px] font-bold flex items-center gap-1.5 ${dark ? "text-stone-400" : "text-stone-500"}`}>
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                Loading directory from server...
              </span>
            ) : syncError ? (
              <span className="text-[11px] font-bold flex items-center gap-1.5 text-amber-500">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                {syncError}
              </span>
            ) : (
              <span className="text-[11px] font-bold flex items-center gap-1.5 text-emerald-500">
                <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
                Synced with server directory
              </span>
            )}
            {saving && (
              <span className={`text-[11px] font-bold flex items-center gap-1.5 ${dark ? "text-stone-400" : "text-stone-500"}`}>
                <RefreshCw className="w-3.5 h-3.5 animate-spin" /> Saving...
              </span>
            )}
            {saveSuccess && (
              <span className="text-[11px] font-bold text-emerald-500">Saved.</span>
            )}
          </div>

          {isOwner && !addingNew && (
            <button
              onClick={() => { setAddingNew(true); setSaveError(null); }}
              className="px-3 py-1.5 text-[10px] font-black uppercase tracking-wider rounded-lg flex items-center gap-1.5 cursor-pointer transition-all active:scale-95 bg-sky-600 hover:bg-sky-700 text-white"
            >
              <UserPlus className="w-3.5 h-3.5 shrink-0" />
              Add User
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
              <tr className={`border-b ${dark ? "bg-[#060a12] border-stone-850" : "bg-stone-50 border-stone-200"}`}>
                <th className={thClass}>Name</th>
                <th className={thClass}>Email</th>
                <th className={thClass}>TACT ID</th>
                <th className={thClass}>Tier</th>
                <th className={thClass}>Status</th>
                {isOwner && <th className={`${thClass} text-right`}>Actions</th>}
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
                    <select className={inputClass} value={newDraft.tier} onChange={e => setNewDraft(d => ({ ...d, tier: e.target.value as UserProfile["tier"] }))}>
                      {TIERS.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </td>
                  <td className={tdClass}>
                    <select className={inputClass} value={newDraft.status} onChange={e => setNewDraft(d => ({ ...d, status: e.target.value as UserProfile["status"] }))}>
                      {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </td>
                  <td className={`${tdClass} text-right`}>
                    <div className="flex items-center justify-end gap-1.5">
                      <button onClick={saveNewUser} disabled={saving} className="p-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg cursor-pointer transition-all active:scale-95 disabled:opacity-50" title="Save new user">
                        <Save className="w-3.5 h-3.5" />
                      </button>
                      <button onClick={() => { setAddingNew(false); setNewDraft(emptyDraft()); setSaveError(null); }} className="p-1.5 bg-stone-700 hover:bg-stone-600 text-stone-50 rounded-lg cursor-pointer transition-all active:scale-95" title="Cancel">
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              )}

              {usersList.map((user, idx) => {
                const isEditing = isOwner && editingEmail === user.email;
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
                    <td className={`${tdClass} font-mono text-[10.5px] ${dark ? "text-stone-400" : "text-stone-500"}`}>
                      {user.email}
                    </td>
                    <td className={tdClass}>
                      {isEditing ? (
                        <input className={inputClass} value={row.tactId} onChange={e => setDraft(d => d && { ...d, tactId: e.target.value })} />
                      ) : (
                        <span className="font-mono text-[10.5px]">{user.tactId}</span>
                      )}
                    </td>
                    <td className={tdClass}>
                      {isEditing ? (
                        <select className={inputClass} value={row.tier} onChange={e => setDraft(d => d && { ...d, tier: e.target.value as UserProfile["tier"] })}>
                          {TIERS.map(t => <option key={t} value={t}>{t}</option>)}
                        </select>
                      ) : (
                        <span className={`px-2 py-0.5 rounded text-[10px] font-black uppercase border whitespace-nowrap ${tierBadgeClass(user.tier)}`}>
                          {user.tier}
                        </span>
                      )}
                    </td>
                    <td className={tdClass}>
                      {isEditing ? (
                        <select className={inputClass} value={row.status} onChange={e => setDraft(d => d && { ...d, status: e.target.value as UserProfile["status"] })}>
                          {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                        </select>
                      ) : (
                        <span className={`px-2 py-0.5 rounded text-[10px] font-black uppercase border whitespace-nowrap ${statusBadgeClass(user.status)}`}>
                          {user.status}
                        </span>
                      )}
                    </td>
                    {isOwner && (
                      <td className={`${tdClass} text-right`}>
                        {isEditing ? (
                          <div className="flex items-center justify-end gap-1.5">
                            <button onClick={saveEdit} disabled={saving} className="p-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg cursor-pointer transition-all active:scale-95 disabled:opacity-50" title="Save">
                              <Save className="w-3.5 h-3.5" />
                            </button>
                            <button onClick={cancelEdit} className="p-1.5 bg-stone-700 hover:bg-stone-600 text-stone-50 rounded-lg cursor-pointer transition-all active:scale-95" title="Cancel">
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center justify-end gap-1.5">
                            <button onClick={() => startEdit(user)} className={`p-1.5 rounded-lg cursor-pointer transition-all active:scale-95 border ${dark ? "border-stone-800 hover:border-sky-500 hover:bg-sky-500/15 text-stone-400 hover:text-sky-400" : "border-stone-200 hover:border-sky-400 hover:bg-sky-500/10 text-stone-500 hover:text-sky-600"}`} title="Edit user">
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                            <button onClick={() => deleteUser(user.email)} className={`p-1.5 rounded-lg cursor-pointer transition-all active:scale-95 border ${dark ? "border-stone-800 hover:border-red-500 hover:bg-red-500/15 text-stone-400 hover:text-red-400" : "border-stone-200 hover:border-red-400 hover:bg-red-500/10 text-stone-500 hover:text-red-600"}`} title="Remove user">
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
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

        <p className={`text-[10.5px] font-semibold ${dark ? "text-stone-500" : "text-stone-500"}`}>
          {isOwner
            ? "Changes are saved to the server and apply to every advisor's session immediately."
            : "Admin clearance grants read-only visibility into the directory. Owner clearance is required to add, edit, or remove users."}
        </p>
      </div>
    </div>
  );
}
