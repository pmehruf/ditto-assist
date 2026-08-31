/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useMemo, useState } from "react";
import { Pencil, Save, X, Plus, ShieldCheck, AlertTriangle, Users, Power, Search } from "lucide-react";
import { OrgTeam } from "../types/permissions";
import { UserProfile } from "../types/user";
import { ClippedButton } from "./ClippedButton";

interface TeamsManagementProps {
  theme: "light" | "dark";
  effectiveTier: "General" | "Admin" | "Platform Admin" | "Developer";
  orgTeams: OrgTeam[];
  /** Best-effort member count from App.tsx's usersList cache — same caveat
   * as DepartmentsManagement's memberCount (not guaranteed to include
   * everyone once the directory is large). */
  usersList: UserProfile[];
  onChanged: () => void;
  logAction: (actionType: string, description: string) => void;
}

/**
 * "Teams" tab — the Bliss / Falcon / Central org-team catalog (see
 * schema.ts's doc comment on `org_teams` for why this is a freely managed
 * catalog rather than a hardcoded enum, and why it's foundation-only:
 * assigning a user to a team currently has zero effect on what they can
 * access, pending a later data-scoping enforcement phase). Developer or
 * Platform Admin can create, rename, and deactivate/reactivate; Admin gets
 * a read-only view, same posture as the Departments tab next to this one.
 *
 * Assigning a user TO a team happens on the Directory tab's add/edit form,
 * not here — this tab only manages the team list itself.
 */
export function TeamsManagement({ theme, effectiveTier, orgTeams, usersList, onChanged, logAction }: TeamsManagementProps) {
  const dark = theme === "dark";
  const canEdit = effectiveTier === "Developer" || effectiveTier === "Platform Admin";

  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [draftName, setDraftName] = useState("");
  const [draftDescription, setDraftDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("all");

  const memberCount = (teamId: number) => usersList.filter((u) => u.orgTeamId === teamId).length;

  const visibleTeams = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return orgTeams.filter((t) => {
      if (statusFilter === "active" && !t.active) return false;
      if (statusFilter === "inactive" && t.active) return false;
      if (q && !t.name.toLowerCase().includes(q) && !(t.description || "").toLowerCase().includes(q)) return false;
      return true;
    });
  }, [orgTeams, searchQuery, statusFilter]);

  const resetCreateForm = () => {
    setCreating(false);
    setNewName("");
    setNewDescription("");
    setActionError(null);
  };

  const createTeam = async () => {
    if (!newName.trim()) {
      setActionError("A team name is required.");
      return;
    }
    setSaving(true);
    setActionError(null);
    try {
      const res = await fetch("/api/org-teams", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName.trim(), description: newDescription.trim() || null }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Failed to create this team (HTTP ${res.status}).`);
      logAction("Team Created", `Created team "${body.entry.name}".`);
      resetCreateForm();
      onChanged();
    } catch (err: any) {
      setActionError(err.message || "Failed to create this team.");
    } finally {
      setSaving(false);
    }
  };

  const startEdit = (team: OrgTeam) => {
    setEditingId(team.id);
    setDraftName(team.name);
    setDraftDescription(team.description || "");
    setActionError(null);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setDraftName("");
    setDraftDescription("");
  };

  const saveEdit = async (team: OrgTeam) => {
    if (!draftName.trim()) {
      setActionError("A team name is required.");
      return;
    }
    setSaving(true);
    setActionError(null);
    try {
      const res = await fetch(`/api/org-teams/${team.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: draftName.trim(), description: draftDescription.trim() || null }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Failed to save changes (HTTP ${res.status}).`);
      logAction("Team Edited", `Updated team "${team.name}"${draftName.trim() !== team.name ? ` (renamed to "${draftName.trim()}")` : ""}.`);
      cancelEdit();
      onChanged();
    } catch (err: any) {
      setActionError(err.message || "Failed to save changes.");
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (team: OrgTeam) => {
    setSaving(true);
    setActionError(null);
    try {
      const res = await fetch(`/api/org-teams/${team.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: !team.active }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Failed to update this team (HTTP ${res.status}).`);
      logAction("Team Edited", `${team.active ? "Deactivated" : "Reactivated"} team "${team.name}".`);
      onChanged();
    } catch (err: any) {
      setActionError(err.message || "Failed to update this team.");
    } finally {
      setSaving(false);
    }
  };

  const inputClass = `w-full text-[11px] px-2 py-1.5 rounded-lg border outline-none font-semibold ${
    dark ? "bg-[#060a12] border-stone-850 text-white focus:border-sky-500" : "bg-white border-stone-200 text-stone-900 focus:border-sky-400"
  }`;

  return (
    <div className={`rounded-2xl border p-5 transition-all ${dark ? "bg-white/[0.03] border-white/[0.08]" : "bg-black/[0.02] border-black/[0.08]"}`}>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="text-[11px] font-bold flex items-center gap-1.5 whitespace-nowrap text-emerald-500">
            <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
            {orgTeams.length} {orgTeams.length === 1 ? "team" : "teams"}
          </span>
          {canEdit && !creating && (
            <ClippedButton
              type="button"
              onClick={() => setCreating(true)}
              cornerBg={dark ? "#0e2236" : "#ffffff"}
              style={{ backgroundColor: "var(--action-navy)", borderColor: "var(--action-navy)", color: "var(--on-action-navy)" }}
              className="flex items-center gap-1.5 text-[10px] font-mono font-bold uppercase tracking-[0.15em] px-3 py-2 border hover:brightness-110 shrink-0"
            >
              <Plus className="w-3.5 h-3.5 shrink-0" />
              New Team
            </ClippedButton>
          )}
        </div>

        {actionError && (
          <div className="px-3 py-2 rounded-lg text-[11px] font-bold text-red-400 bg-red-500/10 border border-red-500/25 flex items-center gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
            {actionError}
          </div>
        )}

        {creating && (
          <div className={`rounded-xl border p-4 space-y-3 ${dark ? "border-white/[0.08] bg-white/[0.02]" : "border-stone-200 bg-stone-50/60"}`}>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <label className="flex flex-col gap-1 text-[10.5px] font-bold text-content-muted">
                Name
                <input className={inputClass} placeholder="e.g. Bliss" value={newName} onChange={(e) => setNewName(e.target.value)} />
              </label>
              <label className="flex flex-col gap-1 text-[10.5px] font-bold text-content-muted">
                Description (optional)
                <input className={inputClass} placeholder="Short description" value={newDescription} onChange={(e) => setNewDescription(e.target.value)} />
              </label>
            </div>
            <div className="flex items-center gap-2">
              <ClippedButton onClick={createTeam} disabled={saving} cornerBg={dark ? "#0e2236" : "#f0f9ff"} className="px-3 py-1.5 text-[11px] font-bold bg-emerald-600 hover:bg-emerald-700 text-white">
                {saving ? "Saving..." : "Save"}
              </ClippedButton>
              <ClippedButton onClick={resetCreateForm} cornerBg={dark ? "#0e2236" : "#f0f9ff"} className="px-3 py-1.5 text-[11px] font-bold bg-stone-700 hover:bg-stone-600 text-stone-50">
                Cancel
              </ClippedButton>
            </div>
          </div>
        )}

        {orgTeams.length === 0 && !creating ? (
          <p className={`px-3 py-8 text-center text-xs font-semibold ${dark ? "text-stone-500" : "text-stone-400"}`}>
            No teams yet. {canEdit ? "Create one to get started." : "The Developer hasn't created any yet."}
          </p>
        ) : (
          <>
          {orgTeams.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative flex-1 min-w-[180px]">
                <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-content-faint pointer-events-none" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search teams…"
                  className={`w-full pl-7 pr-2.5 py-1.5 rounded-lg border text-[11px] font-semibold outline-none ${
                    dark ? "bg-[#060a12] border-stone-850 text-white focus:border-sky-500" : "bg-white border-stone-200 text-stone-900 focus:border-sky-400"
                  }`}
                />
              </div>
              <div className="flex items-center gap-1">
                {(["all", "active", "inactive"] as const).map((f) => (
                  <button
                    key={f}
                    type="button"
                    onClick={() => setStatusFilter(f)}
                    className={`px-2.5 py-1.5 rounded-lg border text-[10.5px] font-bold capitalize cursor-pointer ${
                      statusFilter === f
                        ? "border-[var(--accent)] text-[var(--accent)]"
                        : dark ? "border-stone-850 text-stone-400 hover:bg-white/[0.04]" : "border-stone-200 text-stone-500 hover:bg-stone-50"
                    }`}
                  >
                    {f}
                  </button>
                ))}
              </div>
            </div>
          )}
          {visibleTeams.length === 0 ? (
            <p className={`px-3 py-8 text-center text-xs font-semibold ${dark ? "text-stone-500" : "text-stone-400"}`}>
              No teams match the current search/filters.
            </p>
          ) : (
          <div className={`rounded-xl border overflow-hidden ${dark ? "border-stone-850" : "border-stone-200"}`}>
            <table className="w-full border-collapse">
              <tbody>
                {visibleTeams.map((team, idx) => {
                  const isEditing = canEdit && editingId === team.id;
                  return (
                    <tr key={team.id} className={`border-b last:border-b-0 align-top ${dark ? "border-stone-850" : "border-stone-150"} ${idx % 2 === 1 ? (dark ? "bg-white/[0.015]" : "bg-stone-50/60") : ""}`}>
                      <td className="px-3 py-2.5 w-8">
                        <Users className={`w-3.5 h-3.5 mt-0.5 ${dark ? "text-stone-500" : "text-stone-400"}`} />
                      </td>
                      <td className="px-3 py-2.5">
                        {isEditing ? (
                          <div className="space-y-1.5">
                            <input className={inputClass} value={draftName} onChange={(e) => setDraftName(e.target.value)} placeholder="Name" />
                            <input className={inputClass} value={draftDescription} onChange={(e) => setDraftDescription(e.target.value)} placeholder="Description (optional)" />
                          </div>
                        ) : (
                          <>
                            <div className="flex items-center gap-1.5">
                              <span className={`font-black text-xs ${dark ? "text-white" : "text-stone-900"}`}>{team.name}</span>
                              <span className={`px-1.5 py-0.5 rounded text-[9px] font-black uppercase border whitespace-nowrap ${
                                team.active
                                  ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30"
                                  : "bg-stone-500/15 text-stone-400 border-stone-500/30"
                              }`}>
                                {team.active ? "Active" : "Inactive"}
                              </span>
                            </div>
                            {team.description && (
                              <p className={`text-[10.5px] mt-0.5 ${dark ? "text-stone-500" : "text-stone-400"}`}>{team.description}</p>
                            )}
                          </>
                        )}
                      </td>
                      <td className={`px-3 py-2.5 text-[10.5px] whitespace-nowrap ${dark ? "text-stone-400" : "text-stone-500"}`}>
                        {memberCount(team.id)} {memberCount(team.id) === 1 ? "member" : "members"}
                      </td>
                      {canEdit && (
                        <td className="px-3 py-2.5 text-right">
                          {isEditing ? (
                            <div className="flex items-center justify-end gap-1.5">
                              <ClippedButton onClick={() => saveEdit(team)} disabled={saving} cornerBg={dark ? "#0e2236" : "#ffffff"} className="p-1.5 bg-emerald-600 hover:bg-emerald-700 text-white" title="Save">
                                <Save className="w-3.5 h-3.5" />
                              </ClippedButton>
                              <ClippedButton onClick={cancelEdit} cornerBg={dark ? "#0e2236" : "#ffffff"} className="p-1.5 bg-stone-700 hover:bg-stone-600 text-stone-50" title="Cancel">
                                <X className="w-3.5 h-3.5" />
                              </ClippedButton>
                            </div>
                          ) : (
                            <div className="flex items-center justify-end gap-1.5">
                              <ClippedButton
                                onClick={() => startEdit(team)}
                                cornerBg={dark ? "#0e2236" : "#ffffff"}
                                className={`p-1.5 ${dark ? "hover:bg-sky-500/15 text-stone-400 hover:text-sky-400" : "hover:bg-sky-500/10 text-stone-500 hover:text-sky-600"}`}
                                title="Edit team"
                              >
                                <Pencil className="w-3.5 h-3.5" />
                              </ClippedButton>
                              <ClippedButton
                                onClick={() => toggleActive(team)}
                                disabled={saving}
                                cornerBg={dark ? "#0e2236" : "#ffffff"}
                                className={`p-1.5 ${dark ? "hover:bg-amber-500/15 text-stone-400 hover:text-amber-400" : "hover:bg-amber-500/10 text-stone-500 hover:text-amber-600"}`}
                                title={team.active ? "Deactivate" : "Reactivate"}
                              >
                                <Power className="w-3.5 h-3.5" />
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
          )}
          </>
        )}

        <p className="text-[10.5px] font-semibold text-content-muted">
          {canEdit
            ? "Teams are foundation metadata for future access scoping — today, assigning a user to a team has no effect on what they can access. Assign a user to a team from the Directory tab. Deactivating hides a team from the assignment dropdown without deleting it or unassigning existing members."
            : "Admin clearance grants read-only visibility into teams. Developer or Platform Admin clearance is required to create or edit them."}
        </p>
      </div>
    </div>
  );
}
