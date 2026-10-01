/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Fragment, useMemo, useState } from "react";
import { Pencil, Save, X, Plus, ShieldCheck, AlertTriangle, Building2, Power, Search, Trash2, ChevronDown, ChevronRight } from "lucide-react";
import { Department } from "../types/permissions";
import { UserProfile } from "../types/user";
import { ClippedButton } from "./ClippedButton";
import { useDialog } from "../hooks/useDialog";

interface DepartmentsManagementProps {
  theme: "light" | "dark";
  effectiveTier: "General" | "Admin" | "Platform Admin" | "Developer";
  departments: Department[];
  /** Full directory member count is only meaningful if the caller has it —
   * ProfileAccessPage passes App.tsx's usersList cache. This is a secondary,
   * best-effort count (usersList isn't guaranteed to include everyone once
   * the directory is large), so it's labelled accordingly below. */
  usersList: UserProfile[];
  onChanged: () => void;
  logAction: (actionType: string, description: string) => void;
}

/**
 * "Departments" tab — pure organizational metadata (see schema.ts's doc
 * comment on the `departments` table for why this deliberately carries zero
 * access implications). Developer can create, rename, deactivate/reactivate,
 * and (Access Control Center Phase 4) permanently delete; Admin gets a
 * read-only view, same posture as every other tab on this page. A delete is
 * dependency-checked server-side before it happens — see
 * catalogDependencies.ts — so a department a rule or the Product Assist
 * eligibility setting still references can't silently vanish out from under
 * them; deactivating remains the safer default removal path.
 *
 * Assigning a user TO a department happens on the Directory tab's add/edit
 * form (the one place membership is set), not here — this tab only manages
 * the department list itself.
 */
export function DepartmentsManagement({ theme, effectiveTier, departments, usersList, onChanged, logAction }: DepartmentsManagementProps) {
  const dark = theme === "dark";
  const { confirm } = useDialog();
  const canEdit = effectiveTier === "Developer" || effectiveTier === "Platform Admin";

  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [draftName, setDraftName] = useState("");
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("all");

  const memberCount = (deptId: number) => usersList.filter((u) => u.departmentId === deptId).length;
  const membersOf = (deptId: number) => usersList.filter((u) => u.departmentId === deptId).sort((a, b) => a.name.localeCompare(b.name));

  // Which department's member list is expanded open below its row —
  // click-to-expand instead of always rendering every member (some
  // departments have 100+ people, per the Advisory row's own count).
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const visibleDepartments = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return departments.filter((d) => {
      if (statusFilter === "active" && !d.active) return false;
      if (statusFilter === "inactive" && d.active) return false;
      if (q && !d.name.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [departments, searchQuery, statusFilter]);

  const resetCreateForm = () => {
    setCreating(false);
    setNewName("");
    setActionError(null);
  };

  const createDepartment = async () => {
    if (!newName.trim()) {
      setActionError("A department name is required.");
      return;
    }
    setSaving(true);
    setActionError(null);
    try {
      const res = await fetch("/api/departments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName.trim() }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Failed to create this department (HTTP ${res.status}).`);
      logAction("Department Created", `Created department "${body.entry.name}".`);
      resetCreateForm();
      onChanged();
    } catch (err: any) {
      setActionError(err.message || "Failed to create this department.");
    } finally {
      setSaving(false);
    }
  };

  const startEdit = (dept: Department) => {
    setEditingId(dept.id);
    setDraftName(dept.name);
    setActionError(null);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setDraftName("");
  };

  const saveEdit = async (dept: Department) => {
    if (!draftName.trim()) {
      setActionError("A department name is required.");
      return;
    }
    setSaving(true);
    setActionError(null);
    try {
      const res = await fetch(`/api/departments/${dept.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: draftName.trim() }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Failed to save changes (HTTP ${res.status}).`);
      logAction("Department Edited", `Updated department "${dept.name}"${draftName.trim() !== dept.name ? ` (renamed to "${draftName.trim()}")` : ""}.`);
      cancelEdit();
      onChanged();
    } catch (err: any) {
      setActionError(err.message || "Failed to save changes.");
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (dept: Department) => {
    setSaving(true);
    setActionError(null);
    try {
      const res = await fetch(`/api/departments/${dept.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: !dept.active }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Failed to update this department (HTTP ${res.status}).`);
      logAction("Department Edited", `${dept.active ? "Deactivated" : "Reactivated"} department "${dept.name}".`);
      onChanged();
    } catch (err: any) {
      setActionError(err.message || "Failed to update this department.");
    } finally {
      setSaving(false);
    }
  };

  // Access Control Center Phase 4 (docs/ACCESS_CONTROL_CENTER_PHASE_PLAN.md)
  // — see TeamsManagement.tsx's deleteTeam for the identical two-step
  // confirm/block reasoning.
  const deleteDepartment = async (dept: Department) => {
    setSaving(true);
    setActionError(null);
    try {
      let res = await fetch(`/api/departments/${dept.id}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmed: false }),
      });
      let body = await res.json().catch(() => ({}));
      if (!res.ok && body.requiresConfirmation) {
        if (!(await confirm(`${body.error} Delete "${dept.name}" anyway?`))) return;
        res = await fetch(`/api/departments/${dept.id}`, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ confirmed: true }),
        });
        body = await res.json().catch(() => ({}));
      }
      if (!res.ok) throw new Error(body.error || `Failed to delete this department (HTTP ${res.status}).`);
      onChanged();
    } catch (err: any) {
      setActionError(err.message || "Failed to delete this department.");
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
            {departments.length} {departments.length === 1 ? "department" : "departments"}
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
              New Department
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
              <input className={inputClass} placeholder="e.g. Advisory" value={newName} onChange={(e) => setNewName(e.target.value)} />
            </label>
            <div className="flex items-center gap-2">
              <ClippedButton onClick={createDepartment} disabled={saving} cornerBg={dark ? "#0e2236" : "#f0f9ff"} className="px-3 py-1.5 text-[11px] font-bold bg-emerald-600 hover:bg-emerald-700 text-white">
                {saving ? "Saving..." : "Save"}
              </ClippedButton>
              <ClippedButton onClick={resetCreateForm} cornerBg={dark ? "#0e2236" : "#f0f9ff"} className="px-3 py-1.5 text-[11px] font-bold bg-stone-700 hover:bg-stone-600 text-stone-50">
                Cancel
              </ClippedButton>
            </div>
          </div>
        )}

        {departments.length === 0 && !creating ? (
          <p className={`px-3 py-8 text-center text-xs font-semibold ${dark ? "text-stone-500" : "text-stone-400"}`}>
            No departments yet. {canEdit ? "Create one to get started." : "The Developer hasn't created any yet."}
          </p>
        ) : (
          <>
          {departments.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative flex-1 min-w-[180px]">
                <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-content-faint pointer-events-none" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search departments…"
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
          {visibleDepartments.length === 0 ? (
            <p className={`px-3 py-8 text-center text-xs font-semibold ${dark ? "text-stone-500" : "text-stone-400"}`}>
              No departments match the current search/filters.
            </p>
          ) : (
          <div className={`rounded-xl border vp-table-wrap ${dark ? "border-stone-850" : "border-stone-200"}`}>
            <table className="w-full border-collapse">
              <tbody>
                {visibleDepartments.map((dept, idx) => {
                  const isEditing = canEdit && editingId === dept.id;
                  const count = memberCount(dept.id);
                  const expanded = expandedId === dept.id;
                  return (
                    <Fragment key={dept.id}>
                    <tr className={`border-b align-top ${expanded ? "" : "last:border-b-0"} ${dark ? "border-stone-850" : "border-stone-150"} ${idx % 2 === 1 ? (dark ? "bg-white/[0.015]" : "bg-surface-solid") : ""}`}>
                      <td className="px-3 py-2.5 w-8">
                        <Building2 className={`w-3.5 h-3.5 mt-0.5 ${dark ? "text-stone-500" : "text-stone-400"}`} />
                      </td>
                      <td className="px-3 py-2.5">
                        {isEditing ? (
                          <input className={inputClass} value={draftName} onChange={(e) => setDraftName(e.target.value)} placeholder="Name" />
                        ) : (
                          <div className="flex items-center gap-1.5">
                            <span className={`font-black text-xs ${dark ? "text-white" : "text-stone-900"}`}>{dept.name}</span>
                            <span className={`px-1.5 py-0.5 rounded text-[9px] font-black uppercase border whitespace-nowrap ${
                              dept.active
                                ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30"
                                : "bg-stone-500/15 text-stone-400 border-stone-500/30"
                            }`}>
                              {dept.active ? "Active" : "Inactive"}
                            </span>
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        {/* Click-to-expand the member list below this row —
                            was static text; a department with 100+ people
                            (e.g. Advisory) gave no way to actually see who
                            was in it without going to the Directory tab
                            and filtering by hand. */}
                        <button
                          type="button"
                          onClick={() => setExpandedId(expanded ? null : dept.id)}
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
                              <ClippedButton onClick={() => saveEdit(dept)} disabled={saving} cornerBg={dark ? "#0e2236" : "#ffffff"} className="p-1.5 bg-emerald-600 hover:bg-emerald-700 text-white" title="Save">
                                <Save className="w-3.5 h-3.5" />
                              </ClippedButton>
                              <ClippedButton onClick={cancelEdit} cornerBg={dark ? "#0e2236" : "#ffffff"} className="p-1.5 bg-stone-700 hover:bg-stone-600 text-stone-50" title="Cancel">
                                <X className="w-3.5 h-3.5" />
                              </ClippedButton>
                            </div>
                          ) : (
                            <div className="flex items-center justify-end gap-1.5">
                              <ClippedButton
                                onClick={() => startEdit(dept)}
                                cornerBg={dark ? "#0e2236" : "#ffffff"}
                                className={`p-1.5 ${dark ? "hover:bg-sky-500/15 text-stone-400 hover:text-sky-400" : "hover:bg-sky-500/10 text-stone-500 hover:text-sky-600"}`}
                                title="Edit department"
                              >
                                <Pencil className="w-3.5 h-3.5" />
                              </ClippedButton>
                              <ClippedButton
                                onClick={() => toggleActive(dept)}
                                disabled={saving}
                                cornerBg={dark ? "#0e2236" : "#ffffff"}
                                className={`p-1.5 ${dark ? "hover:bg-amber-500/15 text-stone-400 hover:text-amber-400" : "hover:bg-amber-500/10 text-stone-500 hover:text-amber-600"}`}
                                title={dept.active ? "Deactivate" : "Reactivate"}
                              >
                                <Power className="w-3.5 h-3.5" />
                              </ClippedButton>
                              <ClippedButton
                                onClick={() => deleteDepartment(dept)}
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
                            {membersOf(dept.id).map((u) => (
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
            ? "Departments are organizational metadata only — they have no effect on what anyone can access. Assign a user to a department from the Directory tab. Deactivating hides a department from the assignment dropdown without deleting it or unassigning existing members. Deleting permanently removes it — blocked if an Access Rule or Product Assist's eligibility setting still references it."
            : "Admin clearance grants read-only visibility into departments. Developer clearance is required to create, edit, or delete them."}
        </p>
      </div>
    </div>
  );
}
