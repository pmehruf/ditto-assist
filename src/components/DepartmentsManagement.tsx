/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState } from "react";
import { Pencil, Save, X, Plus, ShieldCheck, AlertTriangle, Building2, Power } from "lucide-react";
import { Department } from "../types/permissions";
import { UserProfile } from "../types/user";
import { ClippedButton } from "./ClippedButton";

interface DepartmentsManagementProps {
  theme: "light" | "dark";
  effectiveTier: "General" | "Admin" | "Developer";
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
 * access implications). Developer can create, rename, and deactivate/
 * reactivate; Admin gets a read-only view, same posture as every other tab
 * on this page. No hard-delete is exposed here — deactivating is the only
 * removal path, so a department already assigned to users never silently
 * vanishes from their records (see departmentsRepository.ts).
 *
 * Assigning a user TO a department happens on the Directory tab's add/edit
 * form (the one place membership is set), not here — this tab only manages
 * the department list itself.
 */
export function DepartmentsManagement({ theme, effectiveTier, departments, usersList, onChanged, logAction }: DepartmentsManagementProps) {
  const dark = theme === "dark";
  const canEdit = effectiveTier === "Developer";

  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [draftName, setDraftName] = useState("");
  const [draftDescription, setDraftDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const memberCount = (deptId: number) => usersList.filter((u) => u.departmentId === deptId).length;

  const resetCreateForm = () => {
    setCreating(false);
    setNewName("");
    setNewDescription("");
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
        body: JSON.stringify({ name: newName.trim(), description: newDescription.trim() || null }),
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
    setDraftDescription(dept.description || "");
    setActionError(null);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setDraftName("");
    setDraftDescription("");
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
        body: JSON.stringify({ name: draftName.trim(), description: draftDescription.trim() || null }),
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
          <div className={`rounded-xl border p-4 space-y-3 ${dark ? "border-white/[0.08] bg-white/[0.02]" : "border-stone-200 bg-stone-50/60"}`}>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <label className="flex flex-col gap-1 text-[10.5px] font-bold text-content-muted">
                Name
                <input className={inputClass} placeholder="e.g. Advisory" value={newName} onChange={(e) => setNewName(e.target.value)} />
              </label>
              <label className="flex flex-col gap-1 text-[10.5px] font-bold text-content-muted">
                Description (optional)
                <input className={inputClass} placeholder="Short description" value={newDescription} onChange={(e) => setNewDescription(e.target.value)} />
              </label>
            </div>
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
          <div className={`rounded-xl border overflow-hidden ${dark ? "border-stone-850" : "border-stone-200"}`}>
            <table className="w-full border-collapse">
              <tbody>
                {departments.map((dept, idx) => {
                  const isEditing = canEdit && editingId === dept.id;
                  return (
                    <tr key={dept.id} className={`border-b last:border-b-0 align-top ${dark ? "border-stone-850" : "border-stone-150"} ${idx % 2 === 1 ? (dark ? "bg-white/[0.015]" : "bg-stone-50/60") : ""}`}>
                      <td className="px-3 py-2.5 w-8">
                        <Building2 className={`w-3.5 h-3.5 mt-0.5 ${dark ? "text-stone-500" : "text-stone-400"}`} />
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
                              <span className={`font-black text-xs ${dark ? "text-white" : "text-stone-900"}`}>{dept.name}</span>
                              <span className={`px-1.5 py-0.5 rounded text-[9px] font-black uppercase border whitespace-nowrap ${
                                dept.active
                                  ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30"
                                  : "bg-stone-500/15 text-stone-400 border-stone-500/30"
                              }`}>
                                {dept.active ? "Active" : "Inactive"}
                              </span>
                            </div>
                            {dept.description && (
                              <p className={`text-[10.5px] mt-0.5 ${dark ? "text-stone-500" : "text-stone-400"}`}>{dept.description}</p>
                            )}
                          </>
                        )}
                      </td>
                      <td className={`px-3 py-2.5 text-[10.5px] whitespace-nowrap ${dark ? "text-stone-400" : "text-stone-500"}`}>
                        {memberCount(dept.id)} {memberCount(dept.id) === 1 ? "member" : "members"}
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

        <p className="text-[10.5px] font-semibold text-content-muted">
          {canEdit
            ? "Departments are organizational metadata only — they have no effect on what anyone can access. Assign a user to a department from the Directory tab. Deactivating hides a department from the assignment dropdown without deleting it or unassigning existing members."
            : "Admin clearance grants read-only visibility into departments. Developer clearance is required to create or edit them."}
        </p>
      </div>
    </div>
  );
}
