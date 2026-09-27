/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useMemo, useState } from "react";
import { Pencil, ShieldCheck, AlertTriangle, Link2, Trash2, RefreshCw, Search, Plus } from "lucide-react";
import { RelationshipGroup, UserRelationship, Department, OrgTeam, AppRole } from "../types/permissions";
import { UserProfile } from "../types/user";
import { ClippedButton } from "./ClippedButton";
import { GroupEditorModal } from "./GroupEditorModal";

interface GroupsManagementProps {
  theme: "light" | "dark";
  effectiveTier: "General" | "Admin" | "Platform Admin" | "Developer";
  /** For resolving a mapping's owner/subject email into a display name —
   * best-effort, same caveat as every other tab that reads App.tsx's
   * usersList cache. */
  usersList: UserProfile[];
  /** For scoping a group's owner picker to one department. */
  departments: Department[];
  /** For the editor modal's Target Filters (Business Unit -> Department ->
   * Role) — purely UI selection aids, same read-only role departments plays
   * here. */
  orgTeams: OrgTeam[];
  roles: AppRole[];
  logAction: (actionType: string, description: string) => void;
  /** hasAccess("group_management", "Editor") from App.tsx — true for
   * Platform Admin/Developer always, plus anyone holding an explicit Custom
   * Grant for the narrower "group_management" capability (see
   * featurePermissions.ts). OR'd into canEdit below alongside the tier
   * check, never replacing it. */
  canManageGroups: boolean;
}

/**
 * "Groups" tab (Access Control Center) — 2026-09, re-unifies what used to be
 * two separate tabs (Relationships + Group Access) into one screen: an
 * overview table of every group, and one unified Create/Edit configuration
 * experience (GroupEditorModal.tsx) covering everything about a single
 * group in a fixed order — Group -> Ownership -> Target Filters -> Members
 * -> Access -> Status. "Open Group -> See Everything -> Edit Anything
 * Relevant."
 *
 * This file is now intentionally thin: it owns the groups/mappings/access
 * data fetch (shared by the table and, via props, the modal) and the table
 * itself. Every per-group editing concern — catalog fields, ownership,
 * target-filter-scoped member management, tool access, active/inactive
 * status — lives in GroupEditorModal.tsx, opened here for both creating a
 * new group and editing an existing one, rather than as an inline
 * row-expansion below the table (the previous design this replaces).
 *
 * Pure UI reorganization: the underlying data model and every server route
 * are unchanged (still relationship_groups, user_relationships,
 * group_tool_access — see schema.ts). PERMISSIONS ARE GROUP-LEVEL, NOT
 * OWNER-LEVEL (migration 0081, 2026-09): Group Access is configured per
 * group, not per owner.
 *
 * The Guide/Mentor -> Advisor mapping table synced from the Advisor
 * Directory sheet lives on its own top-level page, Master Advisors — see
 * MasterAdvisorsManagement.tsx; it was never really a "relationship" in the
 * group/mapping sense above (no owner/subject/group triple).
 */
export function GroupsManagement({ theme, effectiveTier, usersList, departments, orgTeams, roles, logAction, canManageGroups }: GroupsManagementProps) {
  const dark = theme === "dark";
  // Was `effectiveTier === "Developer" || "Platform Admin" || canManageGroups`
  // — the raw tier disjunct was redundant (hasAccess already grants
  // Developer/Platform Admin unconditionally, so canManageGroups covers
  // them too) and a stray tier-identity check per the 2026-09 permission
  // architecture fix. canManageGroups alone is equivalent.
  const canEdit = canManageGroups;

  const [groups, setGroups] = useState<RelationshipGroup[]>([]);
  const [mappings, setMappings] = useState<UserRelationship[]>([]);
  const [allowedFeatureIdsByGroup, setAllowedFeatureIdsByGroup] = useState<Map<number, string[]>>(new Map());
  const [loading, setLoading] = useState(true);
  const [actionError, setActionError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const loadAll = async (opts: { silent?: boolean } = {}) => {
    if (!opts.silent) setLoading(true);
    try {
      const [groupsRes, mappingsRes, accessRes] = await Promise.all([
        fetch("/api/relationship-groups"),
        fetch("/api/user-relationships"),
        fetch("/api/group-access/groups"),
      ]);
      const groupsBody = await groupsRes.json().catch(() => ({}));
      const mappingsBody = await mappingsRes.json().catch(() => ({}));
      const accessBody = await accessRes.json().catch(() => ({}));
      if (groupsRes.ok) setGroups(groupsBody.entries || []);
      if (mappingsRes.ok) setMappings(mappingsBody.entries || []);
      if (accessRes.ok) {
        const map = new Map<number, string[]>();
        for (const entry of accessBody.entries || []) map.set(entry.groupId, entry.allowedFeatureIds);
        setAllowedFeatureIdsByGroup(map);
      }
    } catch (_) {
      // Best-effort — leaves whatever was last successfully loaded.
    } finally {
      if (!opts.silent) setLoading(false);
    }
  };

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const departmentName = (id: number | null) => (id ? departments.find((d) => d.id === id)?.name || `#${id}` : null);

  const deleteGroup = async (group: RelationshipGroup) => {
    if (!window.confirm(`Delete group "${group.name}"? This cannot be undone.`)) return;
    setSaving(true);
    setActionError(null);
    try {
      const res = await fetch(`/api/relationship-groups/${group.id}`, { method: "DELETE" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Failed to delete this group (HTTP ${res.status}).`);
      logAction("Relationship Group Deleted", `Deleted group "${group.name}".`);
      await loadAll();
    } catch (err: any) {
      setActionError(err.message || "Failed to delete this group.");
    } finally {
      setSaving(false);
    }
  };

  // ── Editor modal — Create Group / Edit Group ───────────────────────────
  const [editorMode, setEditorMode] = useState<"create" | "edit" | null>(null);
  const [editorGroupId, setEditorGroupId] = useState<number | null>(null);
  const editorGroup = useMemo(() => (editorGroupId !== null ? groups.find((g) => g.id === editorGroupId) || null : null), [groups, editorGroupId]);

  const openCreate = () => {
    setEditorGroupId(null);
    setEditorMode("create");
  };
  const openEdit = (group: RelationshipGroup) => {
    setEditorGroupId(group.id);
    setEditorMode("edit");
  };
  const closeEditor = () => {
    setEditorMode(null);
    setEditorGroupId(null);
  };
  /** Fires once the modal's initial "Create Group" call succeeds — flips
   * this same modal instance from create mode into full edit mode for the
   * new group, in place, rather than closing and reopening anything. */
  const handleCreated = (groupId: number) => {
    setEditorGroupId(groupId);
    setEditorMode("edit");
    loadAll();
  };

  // ── Search / filter for the groups overview table ─────────────────────
  const [groupSearch, setGroupSearch] = useState("");
  const [groupStatusFilter, setGroupStatusFilter] = useState<"all" | "active" | "inactive">("all");

  const memberCountByGroup = useMemo(() => {
    const counts = new Map<number, number>();
    for (const m of mappings) counts.set(m.relationshipGroupId, (counts.get(m.relationshipGroupId) || 0) + 1);
    return counts;
  }, [mappings]);

  const visibleGroups = useMemo(() => {
    const q = groupSearch.trim().toLowerCase();
    return groups.filter((g) => {
      if (groupStatusFilter === "active" && !g.active) return false;
      if (groupStatusFilter === "inactive" && g.active) return false;
      if (q && !g.name.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [groups, groupSearch, groupStatusFilter]);

  return (
    <div className="space-y-5">
      {actionError && (
        <div className="px-3 py-2 rounded-lg text-[11px] font-bold text-red-400 bg-red-500/10 border border-red-500/25 flex items-center gap-1.5">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
          {actionError}
        </div>
      )}

      {/* The Guide/Mentor -> Advisor mapping table that used to live here
          (synced from the Advisor Directory sheet) lives on its own
          top-level page — see this component's doc comment above. */}
      <p className={`text-[11px] font-semibold ${dark ? "text-stone-500" : "text-stone-400"}`}>
        Looking for each advisor's Guide/Mentor assignment and Tact ID/status/employment snapshot? That's on{" "}
        <span className={dark ? "text-stone-300" : "text-stone-600"}>Master Advisors</span>, in the Admin Zone sidebar.
      </p>

      {loading ? (
        <span className={`text-[11px] font-bold flex items-center gap-1.5 whitespace-nowrap ${dark ? "text-stone-400" : "text-stone-500"}`}>
          <RefreshCw className="w-3.5 h-3.5 animate-spin" />
          Loading groups...
        </span>
      ) : (
        <>
          <div className={`rounded-2xl border p-5 transition-all ${dark ? "bg-white/[0.03] border-white/[0.08]" : "bg-black/[0.02] border-black/[0.08]"}`}>
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span className="text-[11px] font-bold flex items-center gap-1.5 whitespace-nowrap text-emerald-500">
                  <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
                  {groups.length} {groups.length === 1 ? "group" : "groups"}
                </span>
                {canEdit && (
                  <ClippedButton
                    type="button"
                    onClick={openCreate}
                    cornerBg={dark ? "#0e2236" : "#ffffff"}
                    style={{ backgroundColor: "var(--action-navy)", borderColor: "var(--action-navy)", color: "var(--on-action-navy)" }}
                    className="flex items-center gap-1.5 text-[10px] font-mono font-bold uppercase tracking-[0.15em] px-3 py-2 border hover:brightness-110 shrink-0"
                  >
                    <Plus className="w-3.5 h-3.5 shrink-0" />
                    New Group
                  </ClippedButton>
                )}
              </div>

              {groups.length === 0 ? (
                <p className={`px-3 py-6 text-center text-xs font-semibold ${dark ? "text-stone-500" : "text-stone-400"}`}>
                  No groups yet. {canEdit ? "Create one to get started." : "The Developer hasn't created any yet."}
                </p>
              ) : (
                <>
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="relative flex-1 min-w-[180px]">
                      <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-content-faint pointer-events-none" />
                      <input
                        type="text"
                        value={groupSearch}
                        onChange={(e) => setGroupSearch(e.target.value)}
                        placeholder="Search groups…"
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
                          onClick={() => setGroupStatusFilter(f)}
                          className={`px-2.5 py-1.5 rounded-lg border text-[10.5px] font-bold capitalize cursor-pointer ${
                            groupStatusFilter === f
                              ? "border-[var(--accent)] text-[var(--accent)]"
                              : dark ? "border-stone-850 text-stone-400 hover:bg-white/[0.04]" : "border-stone-200 text-stone-500 hover:bg-stone-50"
                          }`}
                        >
                          {f}
                        </button>
                      ))}
                    </div>
                  </div>

                  {visibleGroups.length === 0 ? (
                    <p className={`px-3 py-6 text-center text-xs font-semibold ${dark ? "text-stone-500" : "text-stone-400"}`}>
                      No groups match the current search/filters.
                    </p>
                  ) : (
                    <div className={`rounded-xl border overflow-hidden ${dark ? "border-stone-850" : "border-stone-200"}`}>
                      <table className="w-full border-collapse">
                        <thead>
                          <tr className={`border-b text-[9.5px] font-black uppercase tracking-wider ${dark ? "border-stone-850 text-stone-500" : "border-stone-200 text-stone-400"}`}>
                            <th className="px-3 py-2 w-8"></th>
                            <th className="px-3 py-2 text-left">Group</th>
                            <th className="px-3 py-2 text-left">Owner Department</th>
                            <th className="px-3 py-2 text-left">Members</th>
                            <th className="px-3 py-2 text-left">Status</th>
                            {canEdit && <th className="px-3 py-2 text-right">Actions</th>}
                          </tr>
                        </thead>
                        <tbody>
                          {visibleGroups.map((group, idx) => (
                            <tr
                              key={group.id}
                              onClick={() => canEdit && openEdit(group)}
                              className={`border-b last:border-b-0 align-top ${canEdit ? "cursor-pointer" : ""} ${dark ? "border-stone-850" : "border-stone-150"} ${
                                idx % 2 === 1 ? (dark ? "bg-white/[0.015]" : "bg-surface-solid") : ""
                              } ${canEdit ? (dark ? "hover:bg-white/[0.04]" : "hover:bg-stone-100/70") : ""}`}
                            >
                              <td className="px-3 py-2.5 w-8">
                                <Link2 className={`w-3.5 h-3.5 mt-0.5 ${dark ? "text-stone-500" : "text-stone-400"}`} />
                              </td>
                              <td className="px-3 py-2.5">
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  <span className={`font-black text-xs ${dark ? "text-white" : "text-stone-900"}`}>{group.name}</span>
                                  {group.usedForGroupAccess && (
                                    <span className={`px-1.5 py-0.5 rounded text-[9px] font-black uppercase border whitespace-nowrap ${dark ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30" : "bg-emerald-50 text-emerald-700 border-emerald-200"}`}>
                                      Access
                                    </span>
                                  )}
                                  {/* Group Tier (2026-09, migration 0082) — only shown when non-default,
                                      same "don't clutter the common case" convention as the Access badge
                                      above: nearly every group stays at "General" (the DB default), so a
                                      badge here draws the eye to the exceptional case that actually needs
                                      it — a group deliberately scoped to restrict Admin- or Platform-Admin-
                                      tier members instead. */}
                                  {group.usedForGroupAccess && group.groupTier !== "General" && (
                                    <span className={`px-1.5 py-0.5 rounded text-[9px] font-black uppercase border whitespace-nowrap ${dark ? "bg-sky-500/15 text-sky-400 border-sky-500/30" : "bg-sky-50 text-sky-700 border-sky-200"}`}>
                                      {group.groupTier} Tier
                                    </span>
                                  )}
                                </div>
                              </td>
                              <td className="px-3 py-2.5">
                                <span className={`text-[11px] font-semibold ${dark ? "text-stone-400" : "text-stone-500"}`}>
                                  {departmentName(group.departmentId) || "—"}
                                </span>
                              </td>
                              <td className="px-3 py-2.5">
                                <span className={`text-[11px] font-semibold ${dark ? "text-stone-400" : "text-stone-500"}`}>
                                  {memberCountByGroup.get(group.id) || 0}
                                </span>
                              </td>
                              <td className="px-3 py-2.5">
                                <span className={`px-1.5 py-0.5 rounded text-[9px] font-black uppercase border whitespace-nowrap ${
                                  group.active
                                    ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30"
                                    : "bg-stone-500/15 text-stone-400 border-stone-500/30"
                                }`}>
                                  {group.active ? "Active" : "Inactive"}
                                </span>
                              </td>
                              {canEdit && (
                                <td className="px-3 py-2.5 text-right" onClick={(e) => e.stopPropagation()}>
                                  <div className="flex items-center justify-end gap-1.5">
                                    <ClippedButton
                                      onClick={() => openEdit(group)}
                                      cornerBg={dark ? "#0e2236" : "#ffffff"}
                                      className={`p-1.5 ${dark ? "hover:bg-sky-500/15 text-stone-400 hover:text-sky-400" : "hover:bg-sky-500/10 text-stone-500 hover:text-sky-600"}`}
                                      title="Edit group"
                                    >
                                      <Pencil className="w-3.5 h-3.5" />
                                    </ClippedButton>
                                    <ClippedButton
                                      onClick={() => deleteGroup(group)}
                                      disabled={saving}
                                      cornerBg={dark ? "#0e2236" : "#ffffff"}
                                      className={`p-1.5 ${dark ? "hover:bg-red-500/15 text-stone-400 hover:text-red-400" : "hover:bg-red-500/10 text-stone-500 hover:text-red-600"}`}
                                      title="Delete permanently"
                                    >
                                      <Trash2 className="w-3.5 h-3.5" />
                                    </ClippedButton>
                                  </div>
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
              ? "Most groups (Mentor/Guide included) have no effect on what anyone can access unless Access is turned on for that group. Click a row, or Edit, to open its full configuration."
              : "Admin clearance grants read-only visibility into groups. Developer or Platform Admin clearance is required to create or edit them."}
          </p>
        </>
      )}

      {editorMode && (
        <GroupEditorModal
          theme={theme}
          mode={editorMode}
          group={editorGroup}
          mappings={mappings}
          allowedFeatureIdsByGroup={allowedFeatureIdsByGroup}
          usersList={usersList}
          departments={departments}
          orgTeams={orgTeams}
          roles={roles}
          canEdit={canEdit}
          logAction={logAction}
          onClose={closeEditor}
          onReload={loadAll}
          onCreated={handleCreated}
        />
      )}
    </div>
  );
}
