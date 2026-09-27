/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Fragment, useMemo, useState } from "react";
import { Pencil, Save, X, Plus, ShieldCheck, AlertTriangle, IdCard, Power, Search, Trash2, ChevronDown, ChevronRight } from "lucide-react";
import { AppRole } from "../types/permissions";
import { UserProfile } from "../types/user";
import { ClippedButton } from "./ClippedButton";

interface RolesManagementProps {
  theme: "light" | "dark";
  effectiveTier: "General" | "Admin" | "Platform Admin" | "Developer";
  roles: AppRole[];
  /** Best-effort member count from App.tsx's usersList cache — same caveat
   * as DepartmentsManagement's memberCount. */
  usersList: UserProfile[];
  onChanged: () => void;
  logAction: (actionType: string, description: string) => void;
}

/**
 * "Roles" tab — the Advisor / Mentor / Guide role catalog (see schema.ts's
 * doc comment on `roles` for why this is independent of both `tier` and QA
 * Dashboard's own admin/guide/mentor role, and why it's foundation-only for
 * now). Developer or Platform Admin can create, rename, and deactivate/
 * reactivate; Admin gets a read-only view, same posture as the other
 * catalog tabs on this page.
 *
 * Assigning a user TO a role happens on the Directory tab's add/edit form,
 * not here — this tab only manages the role list itself.
 */
export function RolesManagement({ theme, effectiveTier, roles, usersList, onChanged, logAction }: RolesManagementProps) {
  const dark = theme === "dark";
  const canEdit = effectiveTier === "Developer" || effectiveTier === "Platform Admin";

  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [draftName, setDraftName] = useState("");
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("all");

  const memberCount = (roleId: number) => usersList.filter((u) => u.roleId === roleId).length;
  const membersOf = (roleId: number) => usersList.filter((u) => u.roleId === roleId).sort((a, b) => a.name.localeCompare(b.name));

  // Which role's member list is expanded open below its row — see
  // DepartmentsManagement.tsx's identical pattern for why.
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const visibleRoles = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return roles.filter((r) => {
      if (statusFilter === "active" && !r.active) return false;
      if (statusFilter === "inactive" && r.active) return false;
      if (q && !r.name.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [roles, searchQuery, statusFilter]);

  const resetCreateForm = () => {
    setCreating(false);
    setNewName("");
    setActionError(null);
  };

  const createRole = async () => {
    if (!newName.trim()) {
      setActionError("A role name is required.");
      return;
    }
    setSaving(true);
    setActionError(null);
    try {
      const res = await fetch("/api/roles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName.trim() }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Failed to create this role (HTTP ${res.status}).`);
      logAction("Role Created", `Created role "${body.entry.name}".`);
      resetCreateForm();
      onChanged();
    } catch (err: any) {
      setActionError(err.message || "Failed to create this role.");
    } finally {
      setSaving(false);
    }
  };

  const startEdit = (role: AppRole) => {
    setEditingId(role.id);
    setDraftName(role.name);
    setActionError(null);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setDraftName("");
  };

  const saveEdit = async (role: AppRole) => {
    if (!draftName.trim()) {
      setActionError("A role name is required.");
      return;
    }
    setSaving(true);
    setActionError(null);
    try {
      const res = await fetch(`/api/roles/${role.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: draftName.trim() }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Failed to save changes (HTTP ${res.status}).`);
      logAction("Role Edited", `Updated role "${role.name}"${draftName.trim() !== role.name ? ` (renamed to "${draftName.trim()}")` : ""}.`);
      cancelEdit();
      onChanged();
    } catch (err: any) {
      setActionError(err.message || "Failed to save changes.");
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (role: AppRole) => {
    setSaving(true);
    setActionError(null);
    try {
      const res = await fetch(`/api/roles/${role.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: !role.active }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Failed to update this role (HTTP ${res.status}).`);
      logAction("Role Edited", `${role.active ? "Deactivated" : "Reactivated"} role "${role.name}".`);
      onChanged();
    } catch (err: any) {
      setActionError(err.message || "Failed to update this role.");
    } finally {
      setSaving(false);
    }
  };

  // Access Control Center Phase 4 (docs/ACCESS_CONTROL_CENTER_PHASE_PLAN.md)
  // — see TeamsManagement.tsx's deleteTeam for the identical two-step
  // confirm/block reasoning.
  const deleteRole = async (role: AppRole) => {
    setSaving(true);
    setActionError(null);
    try {
      let res = await fetch(`/api/roles/${role.id}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmed: false }),
      });
      let body = await res.json().catch(() => ({}));
      if (!res.ok && body.requiresConfirmation) {
        if (!window.confirm(`${body.error} Delete "${role.name}" anyway?`)) return;
        res = await fetch(`/api/roles/${role.id}`, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ confirmed: true }),
        });
        body = await res.json().catch(() => ({}));
      }
      if (!res.ok) throw new Error(body.error || `Failed to delete this role (HTTP ${res.status}).`);
      onChanged();
    } catch (err: any) {
      setActionError(err.message || "Failed to delete this role.");
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
            {roles.length} {roles.length === 1 ? "role" : "roles"}
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
              New Role
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
          <div className={`rounded-xl border p-4 space-y-3 ${dark ? "border-white/[0.08] bg-white/[0.02]" : "border-stone-200 bg-surface-solid"}`}>
            <label className="flex flex-col gap-1 text-[10.5px] font-bold text-content-muted max-w-sm">
              Name
              <input className={inputClass} placeholder="e.g. Mentor" value={newName} onChange={(e) => setNewName(e.target.value)} />
            </label>
            <div className="flex items-center gap-2">
              <ClippedButton onClick={createRole} disabled={saving} cornerBg={dark ? "#0e2236" : "#f0f9ff"} className="px-3 py-1.5 text-[11px] font-bold bg-emerald-600 hover:bg-emerald-700 text-white">
                {saving ? "Saving..." : "Save"}
              </ClippedButton>
              <ClippedButton onClick={resetCreateForm} cornerBg={dark ? "#0e2236" : "#f0f9ff"} className="px-3 py-1.5 text-[11px] font-bold bg-stone-700 hover:bg-stone-600 text-stone-50">
                Cancel
              </ClippedButton>
            </div>
          </div>
        )}

        {roles.length === 0 && !creating ? (
          <p className={`px-3 py-8 text-center text-xs font-semibold ${dark ? "text-stone-500" : "text-stone-400"}`}>
            No roles yet. {canEdit ? "Create one to get started." : "The Developer hasn't created any yet."}
          </p>
        ) : (
          <>
          {roles.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative flex-1 min-w-[180px]">
                <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-content-faint pointer-events-none" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search roles…"
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
          {visibleRoles.length === 0 ? (
            <p className={`px-3 py-8 text-center text-xs font-semibold ${dark ? "text-stone-500" : "text-stone-400"}`}>
              No roles match the current search/filters.
            </p>
          ) : (
          <div className={`rounded-xl border overflow-hidden ${dark ? "border-stone-850" : "border-stone-200"}`}>
            <table className="w-full border-collapse">
              <tbody>
                {visibleRoles.map((role, idx) => {
                  const isEditing = canEdit && editingId === role.id;
                  const count = memberCount(role.id);
                  const expanded = expandedId === role.id;
                  return (
                    <Fragment key={role.id}>
                    <tr className={`border-b align-top ${expanded ? "" : "last:border-b-0"} ${dark ? "border-stone-850" : "border-stone-150"} ${idx % 2 === 1 ? (dark ? "bg-white/[0.015]" : "bg-surface-solid") : ""}`}>
                      <td className="px-3 py-2.5 w-8">
                        <IdCard className={`w-3.5 h-3.5 mt-0.5 ${dark ? "text-stone-500" : "text-stone-400"}`} />
                      </td>
                      <td className="px-3 py-2.5">
                        {isEditing ? (
                          <input className={inputClass} value={draftName} onChange={(e) => setDraftName(e.target.value)} placeholder="Name" />
                        ) : (
                          <div className="flex items-center gap-1.5">
                            <span className={`font-black text-xs ${dark ? "text-white" : "text-stone-900"}`}>{role.name}</span>
                            <span className={`px-1.5 py-0.5 rounded text-[9px] font-black uppercase border whitespace-nowrap ${
                              role.active
                                ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30"
                                : "bg-stone-500/15 text-stone-400 border-stone-500/30"
                            }`}>
                              {role.active ? "Active" : "Inactive"}
                            </span>
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        {/* Click-to-expand the member list below this row —
                            see DepartmentsManagement.tsx's identical control. */}
                        <button
                          type="button"
                          onClick={() => setExpandedId(expanded ? null : role.id)}
                          disabled={count === 0}
                          className={`flex items-center gap-1 text-[10.5px] font-bold cursor-pointer disabled:cursor-default disabled:opacity-60 ${dark ? "text-stone-400 hover:text-sky-400" : "text-stone-500 hover:text-sky-600"}`}
                        >
                          {count > 0 && (expanded ? <ChevronDown className="w-3 h-3 shrink-0" /> : <ChevronRight className="w-3 h-3 shrink-0" />)}
                          {count} {count === 1 ? "member" : "members"}
                        </button>
                      </td>
                      {canEdit && (
                        <td className="px-3 py-2.5 text-right">
                          {isEditing ? (
                            <div className="flex items-center justify-end gap-1.5">
                              <ClippedButton onClick={() => saveEdit(role)} disabled={saving} cornerBg={dark ? "#0e2236" : "#ffffff"} className="p-1.5 bg-emerald-600 hover:bg-emerald-700 text-white" title="Save">
                                <Save className="w-3.5 h-3.5" />
                              </ClippedButton>
                              <ClippedButton onClick={cancelEdit} cornerBg={dark ? "#0e2236" : "#ffffff"} className="p-1.5 bg-stone-700 hover:bg-stone-600 text-stone-50" title="Cancel">
                                <X className="w-3.5 h-3.5" />
                              </ClippedButton>
                            </div>
                          ) : (
                            <div className="flex items-center justify-end gap-1.5">
                              <ClippedButton
                                onClick={() => startEdit(role)}
                                cornerBg={dark ? "#0e2236" : "#ffffff"}
                                className={`p-1.5 ${dark ? "hover:bg-sky-500/15 text-stone-400 hover:text-sky-400" : "hover:bg-sky-500/10 text-stone-500 hover:text-sky-600"}`}
                                title="Edit role"
                              >
                                <Pencil className="w-3.5 h-3.5" />
                              </ClippedButton>
                              <ClippedButton
                                onClick={() => toggleActive(role)}
                                disabled={saving}
                                cornerBg={dark ? "#0e2236" : "#ffffff"}
                                className={`p-1.5 ${dark ? "hover:bg-amber-500/15 text-stone-400 hover:text-amber-400" : "hover:bg-amber-500/10 text-stone-500 hover:text-amber-600"}`}
                                title={role.active ? "Deactivate" : "Reactivate"}
                              >
                                <Power className="w-3.5 h-3.5" />
                              </ClippedButton>
                              <ClippedButton
                                onClick={() => deleteRole(role)}
                                disabled={saving}
                                cornerBg={dark ? "#0e2236" : "#ffffff"}
                                className={`p-1.5 ${dark ? "hover:bg-red-500/15 text-stone-400 hover:text-red-400" : "hover:bg-red-500/10 text-stone-500 hover:text-red-600"}`}
                                title="Delete permanently"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </ClippedButton>
                            </div>
                          )}
                        </td>
                      )}
                    </tr>
                    {expanded && (
                      <tr className={`border-b last:border-b-0 ${dark ? "border-stone-850 bg-black/[0.15]" : "border-stone-150 bg-stone-100/70"}`}>
                        <td />
                        <td colSpan={canEdit ? 3 : 2} className="px-3 py-2.5">
                          <div className="flex flex-wrap gap-1.5">
                            {membersOf(role.id).map((u) => (
                              <span
                                key={u.email}
                                title={u.email}
                                className={`px-2 py-1 rounded-full border text-[10.5px] font-semibold whitespace-nowrap ${dark ? "bg-white/[0.03] border-stone-800 text-stone-300" : "bg-white border-stone-200 text-stone-700"}`}
                              >
                                {u.name}
                                <span className={`ml-1 font-mono text-[9px] ${dark ? "text-stone-500" : "text-stone-400"}`}>{u.tactId}</span>
                              </span>
                            ))}
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
          )}
          </>
        )}

        <p className="text-[10.5px] font-semibold text-content-muted">
          {canEdit
            ? "Roles are foundation metadata for future access scoping — today, assigning a user to a role has no effect on what they can access, and this is independent of the QA Dashboard's own Admin/Guide/Mentor role. Assign a user to a role from the Directory tab. Deactivating hides a role from the assignment dropdown without deleting it or unassigning existing members. Deleting permanently removes it — blocked if an Access Rule or Product Assist's eligibility setting still references it."
            : "Admin clearance grants read-only visibility into roles. Developer or Platform Admin clearance is required to create, edit, or delete them."}
        </p>
      </div>
    </div>
  );
}
