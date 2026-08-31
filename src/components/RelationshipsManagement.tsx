/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useMemo, useState } from "react";
import { Pencil, Save, X, Plus, ShieldCheck, AlertTriangle, Link2, Power, Trash2, RefreshCw, Search } from "lucide-react";
import { RelationshipType, UserRelationship } from "../types/permissions";
import { UserProfile } from "../types/user";
import { ClippedButton } from "./ClippedButton";
import { CustomSelect } from "./CustomSelect";

interface RelationshipsManagementProps {
  theme: "light" | "dark";
  effectiveTier: "General" | "Admin" | "Platform Admin" | "Developer";
  /** For resolving a mapping's owner/subject email into a display name —
   * best-effort, same caveat as every other tab that reads App.tsx's
   * usersList cache. */
  usersList: UserProfile[];
  logAction: (actionType: string, description: string) => void;
}

/**
 * "Relationships" tab — two independent, self-fetched sections:
 *
 * 1. Relationship Types: the vocabulary catalog (Mentor / Guide / ...),
 *    same catalog CRUD pattern as Teams/Roles/Departments.
 * 2. Mappings: explicit person-to-person rows (owner -> subject, e.g. a
 *    Mentor's mentees) — see schema.ts's doc comment on `user_relationships`
 *    for why this is a generic (owner, subject, type) table rather than a
 *    single "reports to" field, so one person can hold multiple
 *    relationship kinds at once without another migration.
 *
 * Foundation-only, like Teams/Roles above: these mappings currently have
 * zero effect on what anyone can access, pending a later data-scoping
 * enforcement phase.
 */
export function RelationshipsManagement({ theme, effectiveTier, usersList, logAction }: RelationshipsManagementProps) {
  const dark = theme === "dark";
  const canEdit = effectiveTier === "Developer" || effectiveTier === "Platform Admin";

  const [types, setTypes] = useState<RelationshipType[]>([]);
  const [mappings, setMappings] = useState<UserRelationship[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionError, setActionError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const loadAll = async () => {
    setLoading(true);
    try {
      const [typesRes, mappingsRes] = await Promise.all([
        fetch("/api/relationship-types"),
        fetch("/api/user-relationships"),
      ]);
      const typesBody = await typesRes.json().catch(() => ({}));
      const mappingsBody = await mappingsRes.json().catch(() => ({}));
      if (typesRes.ok) setTypes(typesBody.entries || []);
      if (mappingsRes.ok) setMappings(mappingsBody.entries || []);
    } catch (_) {
      // Best-effort — leaves whatever was last successfully loaded.
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Relationship Types catalog ──────────────────────────────────────
  const [creatingType, setCreatingType] = useState(false);
  const [newTypeName, setNewTypeName] = useState("");
  const [newTypeDescription, setNewTypeDescription] = useState("");
  const [editingTypeId, setEditingTypeId] = useState<number | null>(null);
  const [draftTypeName, setDraftTypeName] = useState("");
  const [draftTypeDescription, setDraftTypeDescription] = useState("");

  const resetCreateTypeForm = () => {
    setCreatingType(false);
    setNewTypeName("");
    setNewTypeDescription("");
    setActionError(null);
  };

  const createType = async () => {
    if (!newTypeName.trim()) {
      setActionError("A relationship type name is required.");
      return;
    }
    setSaving(true);
    setActionError(null);
    try {
      const res = await fetch("/api/relationship-types", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newTypeName.trim(), description: newTypeDescription.trim() || null }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Failed to create this relationship type (HTTP ${res.status}).`);
      logAction("Relationship Type Created", `Created relationship type "${body.entry.name}".`);
      resetCreateTypeForm();
      await loadAll();
    } catch (err: any) {
      setActionError(err.message || "Failed to create this relationship type.");
    } finally {
      setSaving(false);
    }
  };

  const startEditType = (type: RelationshipType) => {
    setEditingTypeId(type.id);
    setDraftTypeName(type.name);
    setDraftTypeDescription(type.description || "");
    setActionError(null);
  };

  const cancelEditType = () => {
    setEditingTypeId(null);
    setDraftTypeName("");
    setDraftTypeDescription("");
  };

  const saveEditType = async (type: RelationshipType) => {
    if (!draftTypeName.trim()) {
      setActionError("A relationship type name is required.");
      return;
    }
    setSaving(true);
    setActionError(null);
    try {
      const res = await fetch(`/api/relationship-types/${type.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: draftTypeName.trim(), description: draftTypeDescription.trim() || null }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Failed to save changes (HTTP ${res.status}).`);
      logAction("Relationship Type Edited", `Updated relationship type "${type.name}".`);
      cancelEditType();
      await loadAll();
    } catch (err: any) {
      setActionError(err.message || "Failed to save changes.");
    } finally {
      setSaving(false);
    }
  };

  const toggleTypeActive = async (type: RelationshipType) => {
    setSaving(true);
    setActionError(null);
    try {
      const res = await fetch(`/api/relationship-types/${type.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: !type.active }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Failed to update this relationship type (HTTP ${res.status}).`);
      logAction("Relationship Type Edited", `${type.active ? "Deactivated" : "Reactivated"} relationship type "${type.name}".`);
      await loadAll();
    } catch (err: any) {
      setActionError(err.message || "Failed to update this relationship type.");
    } finally {
      setSaving(false);
    }
  };

  // ── Mappings ─────────────────────────────────────────────────────────
  const [addingMapping, setAddingMapping] = useState(false);
  const [ownerEmail, setOwnerEmail] = useState("");
  const [subjectEmail, setSubjectEmail] = useState("");
  const [mappingTypeId, setMappingTypeId] = useState<string>("");

  const resetMappingForm = () => {
    setAddingMapping(false);
    setOwnerEmail("");
    setSubjectEmail("");
    setMappingTypeId("");
    setActionError(null);
  };

  const createMapping = async () => {
    if (!ownerEmail.trim() || !subjectEmail.trim() || !mappingTypeId) {
      setActionError("Owner email, subject email, and relationship type are all required.");
      return;
    }
    setSaving(true);
    setActionError(null);
    try {
      const res = await fetch("/api/user-relationships", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ownerEmail: ownerEmail.trim().toLowerCase(),
          subjectEmail: subjectEmail.trim().toLowerCase(),
          relationshipTypeId: Number(mappingTypeId),
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Failed to create this mapping (HTTP ${res.status}).`);
      logAction("User Relationship Created", `Mapped ${subjectEmail.trim()} to ${ownerEmail.trim()}.`);
      resetMappingForm();
      await loadAll();
    } catch (err: any) {
      setActionError(err.message || "Failed to create this mapping.");
    } finally {
      setSaving(false);
    }
  };

  const deleteMapping = async (mapping: UserRelationship) => {
    if (!window.confirm(`Remove the mapping of ${mapping.subjectEmail} to ${mapping.ownerEmail}?`)) return;
    setSaving(true);
    setActionError(null);
    try {
      const res = await fetch(`/api/user-relationships/${mapping.id}`, { method: "DELETE" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Failed to remove this mapping (HTTP ${res.status}).`);
      logAction("User Relationship Removed", `Removed mapping of ${mapping.subjectEmail} to ${mapping.ownerEmail}.`);
      await loadAll();
    } catch (err: any) {
      setActionError(err.message || "Failed to remove this mapping.");
    } finally {
      setSaving(false);
    }
  };

  const inputClass = `w-full text-[11px] px-2 py-1.5 rounded-lg border outline-none font-semibold ${
    dark ? "bg-[#060a12] border-stone-850 text-white focus:border-sky-500" : "bg-white border-stone-200 text-stone-900 focus:border-sky-400"
  }`;
  const selectTriggerClass = `w-full flex items-center justify-between gap-1 text-[11px] pl-2 pr-6 py-1.5 rounded-lg border outline-none font-semibold relative ${
    dark ? "bg-[#060a12] border-stone-850 text-white focus:border-sky-500" : "bg-white border-stone-200 text-stone-900 focus:border-sky-400"
  }`;

  const nameFor = (email: string) => usersList.find((u) => u.email === email)?.name || null;
  const typeName = (id: number) => types.find((t) => t.id === id)?.name || `#${id}`;

  // ── Search / filter ─────────────────────────────────────────────────
  const [typeSearch, setTypeSearch] = useState("");
  const [typeStatusFilter, setTypeStatusFilter] = useState<"all" | "active" | "inactive">("all");
  const [mappingSearch, setMappingSearch] = useState("");
  const [mappingTypeFilter, setMappingTypeFilter] = useState<string>("");

  const visibleTypes = useMemo(() => {
    const q = typeSearch.trim().toLowerCase();
    return types.filter((t) => {
      if (typeStatusFilter === "active" && !t.active) return false;
      if (typeStatusFilter === "inactive" && t.active) return false;
      if (q && !t.name.toLowerCase().includes(q) && !(t.description || "").toLowerCase().includes(q)) return false;
      return true;
    });
  }, [types, typeSearch, typeStatusFilter]);

  const visibleMappings = useMemo(() => {
    const q = mappingSearch.trim().toLowerCase();
    return mappings.filter((m) => {
      if (mappingTypeFilter && String(m.relationshipTypeId) !== mappingTypeFilter) return false;
      if (q) {
        const ownerText = `${nameFor(m.ownerEmail) || ""} ${m.ownerEmail}`.toLowerCase();
        const subjectText = `${nameFor(m.subjectEmail) || ""} ${m.subjectEmail}`.toLowerCase();
        if (!ownerText.includes(q) && !subjectText.includes(q)) return false;
      }
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mappings, mappingSearch, mappingTypeFilter, usersList]);

  return (
    <div className="space-y-5">
      {actionError && (
        <div className="px-3 py-2 rounded-lg text-[11px] font-bold text-red-400 bg-red-500/10 border border-red-500/25 flex items-center gap-1.5">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
          {actionError}
        </div>
      )}

      {loading ? (
        <span className={`text-[11px] font-bold flex items-center gap-1.5 whitespace-nowrap ${dark ? "text-stone-400" : "text-stone-500"}`}>
          <RefreshCw className="w-3.5 h-3.5 animate-spin" />
          Loading relationships...
        </span>
      ) : (
        <>
          {/* Relationship Types catalog */}
          <div className={`rounded-2xl border p-5 transition-all ${dark ? "bg-white/[0.03] border-white/[0.08]" : "bg-black/[0.02] border-black/[0.08]"}`}>
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span className="text-[11px] font-bold flex items-center gap-1.5 whitespace-nowrap text-emerald-500">
                  <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
                  {types.length} relationship {types.length === 1 ? "type" : "types"}
                </span>
                {canEdit && !creatingType && (
                  <ClippedButton
                    type="button"
                    onClick={() => setCreatingType(true)}
                    cornerBg={dark ? "#0e2236" : "#ffffff"}
                    style={{ backgroundColor: "var(--action-navy)", borderColor: "var(--action-navy)", color: "var(--on-action-navy)" }}
                    className="flex items-center gap-1.5 text-[10px] font-mono font-bold uppercase tracking-[0.15em] px-3 py-2 border hover:brightness-110 shrink-0"
                  >
                    <Plus className="w-3.5 h-3.5 shrink-0" />
                    New Type
                  </ClippedButton>
                )}
              </div>

              {creatingType && (
                <div className={`rounded-xl border p-4 space-y-3 ${dark ? "border-white/[0.08] bg-white/[0.02]" : "border-stone-200 bg-stone-50/60"}`}>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <label className="flex flex-col gap-1 text-[10.5px] font-bold text-content-muted">
                      Name
                      <input className={inputClass} placeholder="e.g. Mentor" value={newTypeName} onChange={(e) => setNewTypeName(e.target.value)} />
                    </label>
                    <label className="flex flex-col gap-1 text-[10.5px] font-bold text-content-muted">
                      Description (optional)
                      <input className={inputClass} placeholder="Short description" value={newTypeDescription} onChange={(e) => setNewTypeDescription(e.target.value)} />
                    </label>
                  </div>
                  <div className="flex items-center gap-2">
                    <ClippedButton onClick={createType} disabled={saving} cornerBg={dark ? "#0e2236" : "#f0f9ff"} className="px-3 py-1.5 text-[11px] font-bold bg-emerald-600 hover:bg-emerald-700 text-white">
                      {saving ? "Saving..." : "Save"}
                    </ClippedButton>
                    <ClippedButton onClick={resetCreateTypeForm} cornerBg={dark ? "#0e2236" : "#f0f9ff"} className="px-3 py-1.5 text-[11px] font-bold bg-stone-700 hover:bg-stone-600 text-stone-50">
                      Cancel
                    </ClippedButton>
                  </div>
                </div>
              )}

              {types.length === 0 && !creatingType ? (
                <p className={`px-3 py-6 text-center text-xs font-semibold ${dark ? "text-stone-500" : "text-stone-400"}`}>
                  No relationship types yet. {canEdit ? "Create one to get started." : "The Developer hasn't created any yet."}
                </p>
              ) : (
                <>
                {types.length > 0 && (
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="relative flex-1 min-w-[180px]">
                      <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-content-faint pointer-events-none" />
                      <input
                        type="text"
                        value={typeSearch}
                        onChange={(e) => setTypeSearch(e.target.value)}
                        placeholder="Search relationship types…"
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
                          onClick={() => setTypeStatusFilter(f)}
                          className={`px-2.5 py-1.5 rounded-lg border text-[10.5px] font-bold capitalize cursor-pointer ${
                            typeStatusFilter === f
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
                {visibleTypes.length === 0 ? (
                  <p className={`px-3 py-6 text-center text-xs font-semibold ${dark ? "text-stone-500" : "text-stone-400"}`}>
                    No relationship types match the current search/filters.
                  </p>
                ) : (
                <div className={`rounded-xl border overflow-hidden ${dark ? "border-stone-850" : "border-stone-200"}`}>
                  <table className="w-full border-collapse">
                    <tbody>
                      {visibleTypes.map((type, idx) => {
                        const isEditing = canEdit && editingTypeId === type.id;
                        return (
                          <tr key={type.id} className={`border-b last:border-b-0 align-top ${dark ? "border-stone-850" : "border-stone-150"} ${idx % 2 === 1 ? (dark ? "bg-white/[0.015]" : "bg-stone-50/60") : ""}`}>
                            <td className="px-3 py-2.5 w-8">
                              <Link2 className={`w-3.5 h-3.5 mt-0.5 ${dark ? "text-stone-500" : "text-stone-400"}`} />
                            </td>
                            <td className="px-3 py-2.5">
                              {isEditing ? (
                                <div className="space-y-1.5">
                                  <input className={inputClass} value={draftTypeName} onChange={(e) => setDraftTypeName(e.target.value)} placeholder="Name" />
                                  <input className={inputClass} value={draftTypeDescription} onChange={(e) => setDraftTypeDescription(e.target.value)} placeholder="Description (optional)" />
                                </div>
                              ) : (
                                <>
                                  <div className="flex items-center gap-1.5">
                                    <span className={`font-black text-xs ${dark ? "text-white" : "text-stone-900"}`}>{type.name}</span>
                                    <span className={`px-1.5 py-0.5 rounded text-[9px] font-black uppercase border whitespace-nowrap ${
                                      type.active
                                        ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30"
                                        : "bg-stone-500/15 text-stone-400 border-stone-500/30"
                                    }`}>
                                      {type.active ? "Active" : "Inactive"}
                                    </span>
                                  </div>
                                  {type.description && (
                                    <p className={`text-[10.5px] mt-0.5 ${dark ? "text-stone-500" : "text-stone-400"}`}>{type.description}</p>
                                  )}
                                </>
                              )}
                            </td>
                            {canEdit && (
                              <td className="px-3 py-2.5 text-right">
                                {isEditing ? (
                                  <div className="flex items-center justify-end gap-1.5">
                                    <ClippedButton onClick={() => saveEditType(type)} disabled={saving} cornerBg={dark ? "#0e2236" : "#ffffff"} className="p-1.5 bg-emerald-600 hover:bg-emerald-700 text-white" title="Save">
                                      <Save className="w-3.5 h-3.5" />
                                    </ClippedButton>
                                    <ClippedButton onClick={cancelEditType} cornerBg={dark ? "#0e2236" : "#ffffff"} className="p-1.5 bg-stone-700 hover:bg-stone-600 text-stone-50" title="Cancel">
                                      <X className="w-3.5 h-3.5" />
                                    </ClippedButton>
                                  </div>
                                ) : (
                                  <div className="flex items-center justify-end gap-1.5">
                                    <ClippedButton
                                      onClick={() => startEditType(type)}
                                      cornerBg={dark ? "#0e2236" : "#ffffff"}
                                      className={`p-1.5 ${dark ? "hover:bg-sky-500/15 text-stone-400 hover:text-sky-400" : "hover:bg-sky-500/10 text-stone-500 hover:text-sky-600"}`}
                                      title="Edit relationship type"
                                    >
                                      <Pencil className="w-3.5 h-3.5" />
                                    </ClippedButton>
                                    <ClippedButton
                                      onClick={() => toggleTypeActive(type)}
                                      disabled={saving}
                                      cornerBg={dark ? "#0e2236" : "#ffffff"}
                                      className={`p-1.5 ${dark ? "hover:bg-amber-500/15 text-stone-400 hover:text-amber-400" : "hover:bg-amber-500/10 text-stone-500 hover:text-amber-600"}`}
                                      title={type.active ? "Deactivate" : "Reactivate"}
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
            </div>
          </div>

          {/* Mappings */}
          <div className={`rounded-2xl border p-5 transition-all ${dark ? "bg-white/[0.03] border-white/[0.08]" : "bg-black/[0.02] border-black/[0.08]"}`}>
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span className="text-[11px] font-bold flex items-center gap-1.5 whitespace-nowrap text-emerald-500">
                  <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
                  {mappings.length} {mappings.length === 1 ? "mapping" : "mappings"}
                </span>
                {canEdit && !addingMapping && (
                  <ClippedButton
                    type="button"
                    onClick={() => setAddingMapping(true)}
                    cornerBg={dark ? "#0e2236" : "#ffffff"}
                    style={{ backgroundColor: "var(--action-navy)", borderColor: "var(--action-navy)", color: "var(--on-action-navy)" }}
                    className="flex items-center gap-1.5 text-[10px] font-mono font-bold uppercase tracking-[0.15em] px-3 py-2 border hover:brightness-110 shrink-0"
                    disabled={types.length === 0}
                    title={types.length === 0 ? "Create a relationship type above first" : undefined}
                  >
                    <Plus className="w-3.5 h-3.5 shrink-0" />
                    New Mapping
                  </ClippedButton>
                )}
              </div>

              {addingMapping && (
                <div className={`rounded-xl border p-4 space-y-3 ${dark ? "border-white/[0.08] bg-white/[0.02]" : "border-stone-200 bg-stone-50/60"}`}>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <label className="flex flex-col gap-1 text-[10.5px] font-bold text-content-muted">
                      Owner email
                      <input className={inputClass} placeholder="mentor@joinditto.in" value={ownerEmail} onChange={(e) => setOwnerEmail(e.target.value)} />
                    </label>
                    <label className="flex flex-col gap-1 text-[10.5px] font-bold text-content-muted">
                      Subject email
                      <input className={inputClass} placeholder="mentee@joinditto.in" value={subjectEmail} onChange={(e) => setSubjectEmail(e.target.value)} />
                    </label>
                    <label className="flex flex-col gap-1 text-[10.5px] font-bold text-content-muted">
                      Relationship type
                      <CustomSelect
                        theme={theme}
                        value={mappingTypeId}
                        onChange={setMappingTypeId}
                        triggerClassName={selectTriggerClass}
                        options={[
                          { value: "", label: "Select..." },
                          ...types.filter((t) => t.active).map((t) => ({ value: String(t.id), label: t.name })),
                        ]}
                      />
                    </label>
                  </div>
                  <p className={`text-[10.5px] ${dark ? "text-stone-500" : "text-stone-400"}`}>
                    "Owner" is the person the relationship is held BY (e.g. the Mentor); "Subject" is who it applies TO (e.g. the mentee).
                  </p>
                  <div className="flex items-center gap-2">
                    <ClippedButton onClick={createMapping} disabled={saving} cornerBg={dark ? "#0e2236" : "#f0f9ff"} className="px-3 py-1.5 text-[11px] font-bold bg-emerald-600 hover:bg-emerald-700 text-white">
                      {saving ? "Saving..." : "Save"}
                    </ClippedButton>
                    <ClippedButton onClick={resetMappingForm} cornerBg={dark ? "#0e2236" : "#f0f9ff"} className="px-3 py-1.5 text-[11px] font-bold bg-stone-700 hover:bg-stone-600 text-stone-50">
                      Cancel
                    </ClippedButton>
                  </div>
                </div>
              )}

              {mappings.length === 0 && !addingMapping ? (
                <p className={`px-3 py-6 text-center text-xs font-semibold ${dark ? "text-stone-500" : "text-stone-400"}`}>
                  No mappings yet. {canEdit ? "Create one to get started." : "The Developer hasn't created any yet."}
                </p>
              ) : (
                <>
                {mappings.length > 0 && (
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="relative flex-1 min-w-[180px]">
                      <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-content-faint pointer-events-none" />
                      <input
                        type="text"
                        value={mappingSearch}
                        onChange={(e) => setMappingSearch(e.target.value)}
                        placeholder="Search by name or email…"
                        className={`w-full pl-7 pr-2.5 py-1.5 rounded-lg border text-[11px] font-semibold outline-none ${
                          dark ? "bg-[#060a12] border-stone-850 text-white focus:border-sky-500" : "bg-white border-stone-200 text-stone-900 focus:border-sky-400"
                        }`}
                      />
                    </div>
                    <div className="min-w-[160px]">
                      <CustomSelect
                        theme={theme}
                        value={mappingTypeFilter}
                        onChange={setMappingTypeFilter}
                        triggerClassName={selectTriggerClass}
                        options={[{ value: "", label: "All relationship types" }, ...types.map((t) => ({ value: String(t.id), label: t.name }))]}
                      />
                    </div>
                  </div>
                )}
                {visibleMappings.length === 0 ? (
                  <p className={`px-3 py-6 text-center text-xs font-semibold ${dark ? "text-stone-500" : "text-stone-400"}`}>
                    No mappings match the current search/filters.
                  </p>
                ) : (
                <div className={`rounded-xl border overflow-hidden ${dark ? "border-stone-850" : "border-stone-200"}`}>
                  <table className="w-full border-collapse">
                    <tbody>
                      {visibleMappings.map((m, idx) => (
                        <tr key={m.id} className={`border-b last:border-b-0 align-top ${dark ? "border-stone-850" : "border-stone-150"} ${idx % 2 === 1 ? (dark ? "bg-white/[0.015]" : "bg-stone-50/60") : ""}`}>
                          <td className="px-3 py-2.5 text-xs">
                            <span className={`font-black ${dark ? "text-white" : "text-stone-900"}`}>{nameFor(m.subjectEmail) || m.subjectEmail}</span>
                            <span className={`mx-1.5 ${dark ? "text-stone-500" : "text-stone-400"}`}>is</span>
                            <span className={`px-1.5 py-0.5 rounded text-[9px] font-black uppercase border whitespace-nowrap ${
                              dark ? "bg-sky-500/15 text-sky-400 border-sky-500/30" : "bg-sky-50 text-sky-700 border-sky-200"
                            }`}>{typeName(m.relationshipTypeId)}</span>
                            <span className={`mx-1.5 ${dark ? "text-stone-500" : "text-stone-400"}`}>of</span>
                            <span className={`font-black ${dark ? "text-white" : "text-stone-900"}`}>{nameFor(m.ownerEmail) || m.ownerEmail}</span>
                          </td>
                          {canEdit && (
                            <td className="px-3 py-2.5 text-right">
                              <ClippedButton
                                onClick={() => deleteMapping(m)}
                                disabled={saving}
                                cornerBg={dark ? "#0e2236" : "#ffffff"}
                                className={`p-1.5 ${dark ? "hover:bg-red-500/15 text-stone-400 hover:text-red-400" : "hover:bg-red-500/10 text-stone-500 hover:text-red-600"}`}
                                title="Remove mapping"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </ClippedButton>
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                )}
                </>
              )}
            </div>
          </div>

          <p className="text-[10.5px] font-semibold text-content-muted">
            {canEdit
              ? "Relationships are foundation metadata for future access scoping — today, a mapping has no effect on what anyone can access. Mappings are removed outright rather than deactivated, unlike the catalogs above."
              : "Admin clearance grants read-only visibility into relationships. Developer or Platform Admin clearance is required to create or edit them."}
          </p>
        </>
      )}
    </div>
  );
}
