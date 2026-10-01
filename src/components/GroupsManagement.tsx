/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Pencil,
  ShieldCheck,
  AlertTriangle,
  Link2,
  Trash2,
  RefreshCw,
  Search,
  Plus,
  ArrowLeft,
  Save,
  Users2,
  Tags,
  Power,
  X,
} from "lucide-react";
import { RelationshipGroup, UserRelationship, Department, OrgTeam, AppRole, GroupToolAccessEntry } from "../types/permissions";
import { UserProfile } from "../types/user";
import { ADVISOR_ZONE_FEATURES, ADMIN_ZONE_FEATURES, RESTRICT_ONLY_FEATURES, DEFAULT_FEATURE_PERMISSIONS } from "../constants/featurePermissions";
import { ClippedButton } from "./ClippedButton";
import { CustomSelect } from "./CustomSelect";
import { isOwnerValidForPool } from "./groupOwnerValidation";
import { useDialog } from "../hooks/useDialog";

const MAX_CANDIDATE_ROWS = 100;
type Tier = "General" | "Admin" | "Platform Admin" | "Developer";
type Level = "Viewer" | "Editor";
const TIER_ABBREV: Record<Tier, string> = { General: "GEN", Admin: "ADM", "Platform Admin": "PA", Developer: "DEV" };

const ADVISOR_ZONE_TOOLS = DEFAULT_FEATURE_PERMISSIONS.filter((p) => ADVISOR_ZONE_FEATURES.has(p.id));
const ADMIN_ZONE_TOOLS = DEFAULT_FEATURE_PERMISSIONS.filter((p) => ADMIN_ZONE_FEATURES.has(p.id));
const ALL_CONFIGURABLE_IDS = [...ADVISOR_ZONE_TOOLS, ...ADMIN_ZONE_TOOLS].map((p) => p.id);
// RESTRICT_ONLY_TOOLS — 2026-09g, at the user's explicit request ("No check
// box control for access control center. What if the group is not supposed
// to have it?" / "Flagged responses... if this was an admin tier feature,
// why was it not in the control options"). Rendered as its own
// "Administrative Access" zone below, deliberately kept OUT of
// ALL_CONFIGURABLE_IDS/Select All — these checkboxes don't grant anything
// (see isFeatureGroupRestrictableForTier()'s doc comment in
// featurePermissions.ts), so lumping them into the same raise-oriented
// Select All would be misleading.
const RESTRICT_ONLY_TOOLS = DEFAULT_FEATURE_PERMISSIONS.filter((p) => RESTRICT_ONLY_FEATURES.has(p.id));

interface GroupsManagementProps {
  theme: "light" | "dark";
  effectiveTier: Tier;
  /** For resolving a mapping's owner/subject email into a display name, and
   * for the Members directory / Owner search — best-effort, same caveat as
   * every other tab that reads App.tsx's usersList cache. */
  usersList: UserProfile[];
  /** For resolving a group's legacy departmentId into a display name on the
   * overview table, and for the Add Members Department filter (dependent on
   * Business Unit — 2026-09e). */
  departments: Department[];
  /** For the Add Members Business Unit filter (2026-09e). */
  orgTeams: OrgTeam[];
  /** For the Add Members Role filter, dependent on Business Unit/Department
   * (2026-09e). */
  roles: AppRole[];
  logAction: (actionType: string, description: string) => void;
  /** hasAccess("group_management", "Editor") from App.tsx — true for
   * Platform Admin/Developer always, plus anyone holding an explicit Custom
   * Grant for the narrower "group_management" capability (see
   * featurePermissions.ts). This is the BLANKET grant — it lets someone
   * edit EVERY group. Since 2026-09h it's no longer the only way in: see
   * isOwnerOf()/canEditGroup() below for the per-group ownership carve-out
   * ("a group owner must be able to view and modify their own group...
   * Group owners must not be able to modify other owners' groups unless
   * they have separately authorized access" — the user's own framing;
   * canManageGroups IS that "separately authorized access"). */
  canManageGroups: boolean;
  /** The signed-in caller's own email (App.tsx's currentUser.email) — 2026-09h,
   * so this component can tell whether the caller is a mapped OWNER of a
   * given group and extend edit rights to it even without canManageGroups.
   * Mirrors the same ownership check server.ts's requireGroupAccessEditor()
   * enforces independently — this is a UX convenience (hide/disable
   * controls the backend would reject anyway), never the authority itself;
   * a direct API request is still checked server-side regardless of what
   * this component renders. */
  currentUserEmail: string;
}

/**
 * "Groups" tab (Access Control Center) — REDESIGNED 2026-09d, at the user's
 * explicit request: "Group access management is currently unnecessarily
 * complex and prone to errors." Replaces the old fixed-size 3-step modal
 * wizard (GroupEditorModal.tsx, now deleted) with a single inline page —
 * no pop-up windows anywhere. Clicking "New Group" or a row swaps this same
 * page's content from the overview table to an editor section, in place;
 * "Back to Groups" returns to the table. Every action lives on this one
 * scrollable page, top to bottom: Group Name -> Group Owner -> Group
 * Members -> Access Control -> Save Group.
 *
 * ACCESS CONTROL MODEL (2026-09f, revised from 2026-09d at the user's
 * explicit request): Group Access both raises AND restricts. There is no
 * per-group tier: a group can hold members of any tier at once, and each
 * checked item automatically raises only the members whose OWN tier can
 * reach that feature (see isFeatureGroupGrantableForTier(),
 * featurePermissions.ts) — an Admin Zone grant (e.g. Announcement Manager)
 * has zero effect on a General-tier member of the very same group, same as
 * always. What's new in 2026-09f: once a group is saved with at least one
 * item checked, General and Admin tier members ALSO get restricted — every
 * OTHER item they'd normally reach for their tier (within their own
 * restriction scope: Advisor Zone only for General, both zones for Admin)
 * is blocked, not left at their ordinary default. This is the "training
 * group" use case: a trainee should see only the one tool selected here,
 * and an Admin-tier trainer limited to Group Management shouldn't
 * incidentally keep every other Admin Zone tool they'd otherwise have.
 * Platform Admin and Developer members are exempt from restriction (still
 * only ever raised, never blocked) — deliberately, so this can never lock
 * out the app's highest-privilege operators. `profile_access` (Access
 * Control Center itself) and `group_management` are never touched by
 * either direction, for anyone — the self-escalation boundary that keeps a
 * restricted Admin-tier trainer able to reach the very Groups tab
 * restricting them. See schema.ts's doc comment on `group_tool_access` and
 * accessRuleEvaluator.ts's resolveAccess() for the full model.
 *
 * PERMISSIONS ARE GROUP-LEVEL, NOT OWNER-LEVEL (migration 0081, 2026-09):
 * Group Access is configured per group, not per owner.
 */
export function GroupsManagement({ theme, effectiveTier, usersList, departments, orgTeams, roles, logAction, canManageGroups, currentUserEmail }: GroupsManagementProps) {
  const dark = theme === "dark";
  const { confirm } = useDialog();
  // "canEdit" (blanket) now means "can manage groups it doesn't own" —
  // used for New Group (creation has no owner yet). Per-group edit rights
  // are canEditGroup() below, computed once ownersByGroup exists.
  const canEdit = canManageGroups;
  // Delete is hardcoded Developer/Platform Admin-only, at the user's
  // explicit request — deliberately independent of canManageGroups (which
  // an Admin can also reach via a group_management Custom Grant). Mirrors
  // server.ts's own hardcoded isDeveloperPower() check on
  // DELETE /api/relationship-groups/:id.
  const isDeveloperPowerTier = effectiveTier === "Developer" || effectiveTier === "Platform Admin";

  const [groups, setGroups] = useState<RelationshipGroup[]>([]);
  const [mappings, setMappings] = useState<UserRelationship[]>([]);
  const [grantsByGroup, setGrantsByGroup] = useState<Map<number, GroupToolAccessEntry[]>>(new Map());
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
        const map = new Map<number, GroupToolAccessEntry[]>();
        for (const entry of accessBody.entries || []) map.set(entry.groupId, entry.grants || []);
        setGrantsByGroup(map);
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

  const deleteGroup = async (group: RelationshipGroup) => {
    if (!(await confirm(`Delete group "${group.name}"? This cannot be undone.`))) return;
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

  // Disable/Reactivate directly from the overview table, beside Edit and
  // Delete — at the user's explicit request, so a group's tool-access
  // restrictions can be switched off (back to ordinary tier-based access)
  // once a training activity is over, without opening the editor. Mirrors
  // GroupEditor's own toggleActive() below (same PATCH, same active-flip),
  // kept as a separate copy here since this one acts on a row in the list
  // rather than the single group loaded into the editor.
  const [togglingActiveGroupId, setTogglingActiveGroupId] = useState<number | null>(null);
  const toggleGroupActiveFromList = async (group: RelationshipGroup) => {
    if (togglingActiveGroupId !== null) return;
    setTogglingActiveGroupId(group.id);
    setActionError(null);
    try {
      const res = await fetch(`/api/relationship-groups/${group.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: !group.active }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Failed to update this group (HTTP ${res.status}).`);
      logAction("Relationship Group Edited", `${group.active ? "Deactivated" : "Reactivated"} group "${group.name}".`);
      await loadAll({ silent: true });
    } catch (err: any) {
      setActionError(err.message || "Failed to update this group.");
    } finally {
      setTogglingActiveGroupId(null);
    }
  };

  // ── Inline editor (no modal) — Create Group / Edit Group ──────────────
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

  // Owner column (2026-09g, at the user's explicit request — "add a column
  // for owner right after group and remove the department column"):
  // distinct owner email(s) per group, derived from its mappings the same
  // way GroupEditor's own distinctOwners already does — a group's owner
  // isn't a column on the group row itself, it's implicit in who its
  // user_relationships rows are mapped under.
  const ownersByGroup = useMemo(() => {
    const map = new Map<number, string[]>();
    for (const m of mappings) {
      const list = map.get(m.relationshipGroupId) || [];
      if (!list.includes(m.ownerEmail)) list.push(m.ownerEmail);
      map.set(m.relationshipGroupId, list);
    }
    return map;
  }, [mappings]);
  const ownerNameFor = (email: string) => usersList.find((u) => u.email === email)?.name || email;
  const ownerDisplayForGroup = (groupId: number): string | null => {
    const owners = ownersByGroup.get(groupId);
    if (!owners || owners.length === 0) return null;
    const first = ownerNameFor(owners[0]);
    // A group can (unusually) have members mapped under more than one
    // owner at once — see GroupEditor's own "mixed owners" warning banner.
    // Shown compactly here rather than listing every name.
    return owners.length > 1 ? `${first} +${owners.length - 1} more` : first;
  };

  // Ownership-aware edit rights (2026-09h, at the user's explicit request).
  // isOwnerOf() mirrors server.ts's requireGroupAccessEditor() exactly:
  // true iff currentUserEmail is a mapped OWNER (not merely a subject) of
  // that specific group's roster. canEditGroup() is the same OR the
  // backend applies — blanket canManageGroups, OR ownership of this one
  // group — so a group owner sees Edit/manage controls on their own
  // group(s) without needing the sledgehammer "edit every group" grant,
  // while remaining unable to touch a group they don't own or manage.
  // Deliberately does NOT gate Delete — deleting a group is permanent and
  // stays canManageGroups-only, same as group creation (see server.ts's own
  // comment on why those two routes were left on the blanket-only check).
  const isOwnerOf = (group: RelationshipGroup) => {
    if (!currentUserEmail) return false;
    const owners = ownersByGroup.get(group.id);
    return !!owners && owners.some((email) => email.toLowerCase() === currentUserEmail.toLowerCase());
  };
  const canEditGroup = (group: RelationshipGroup) => canManageGroups || isOwnerOf(group);

  const visibleGroups = useMemo(() => {
    const q = groupSearch.trim().toLowerCase();
    return groups.filter((g) => {
      if (groupStatusFilter === "active" && !g.active) return false;
      if (groupStatusFilter === "inactive" && g.active) return false;
      if (q && !g.name.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [groups, groupSearch, groupStatusFilter]);

  // Whether the overview table should show an Actions column/Edit
  // affordance at all — true for the blanket-Editor case, or when at least
  // one currently-visible group is one the caller owns (2026-09h).
  const anyGroupEditable = canManageGroups || visibleGroups.some((g) => isOwnerOf(g));

  // The inline editor replaces this page's content entirely while open —
  // "keeping all actions within the page without using pop-up windows".
  if (editorMode) {
    // 2026-09h: creating a brand-new group has no owner yet, so that stays
    // gated on the blanket canManageGroups (matches server.ts's POST
    // /api/relationship-groups, deliberately left Editor-only). Editing an
    // EXISTING group extends to its owner too — canEditGroup() OR's in
    // ownership, mirroring requireGroupAccessEditor() server-side. Passing
    // one resolved boolean down means every internal `canEdit`-gated
    // control inside GroupEditor (rename, roster add/remove, Access
    // Control checkboxes, reassign-owner, Save Group) automatically
    // respects ownership with no further changes needed in that component.
    const effectiveCanEdit = editorMode === "create" ? canManageGroups : editorGroup ? canEditGroup(editorGroup) : canManageGroups;
    return (
      <GroupEditor
        theme={theme}
        mode={editorMode}
        group={editorGroup}
        allGroups={groups}
        mappings={mappings}
        grantsByGroup={grantsByGroup}
        usersList={usersList}
        departments={departments}
        orgTeams={orgTeams}
        roles={roles}
        canEdit={effectiveCanEdit}
        logAction={logAction}
        onClose={closeEditor}
        onReload={loadAll}
        onCreated={handleCreated}
      />
    );
  }

  return (
    <div className="space-y-5">
      {actionError && (
        <div className="px-3 py-2 rounded-lg text-[11px] font-bold text-red-400 bg-red-500/10 border border-red-500/25 flex items-center gap-1.5">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
          {actionError}
        </div>
      )}

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
                    <div className={`rounded-xl border vp-table-wrap ${dark ? "border-stone-850" : "border-stone-200"}`}>
                      <table className="w-full border-collapse">
                        <thead>
                          <tr className={`border-b text-[9.5px] font-black uppercase tracking-wider ${dark ? "border-stone-850 text-stone-500" : "border-stone-200 text-stone-400"}`}>
                            <th className="px-3 py-2 w-8"></th>
                            <th className="px-3 py-2 text-left">Group</th>
                            <th className="px-3 py-2 text-left">Owner</th>
                            <th className="px-3 py-2 text-left">Members</th>
                            <th className="px-3 py-2 text-left">Status</th>
                            {anyGroupEditable && <th className="px-3 py-2 text-right">Actions</th>}
                          </tr>
                        </thead>
                        <tbody>
                          {visibleGroups.map((group, idx) => {
                            // Own-group edit rights (2026-09h) — blanket
                            // canManageGroups, or ownership of THIS row's
                            // group specifically (never another owner's).
                            const rowEditable = canEditGroup(group);
                            return (
                            <tr
                              key={group.id}
                              onClick={() => rowEditable && openEdit(group)}
                              className={`border-b last:border-b-0 align-top ${rowEditable ? "cursor-pointer" : ""} ${dark ? "border-stone-850" : "border-stone-150"} ${
                                idx % 2 === 1 ? (dark ? "bg-white/[0.015]" : "bg-surface-solid") : ""
                              } ${rowEditable ? (dark ? "hover:bg-white/[0.04]" : "hover:bg-stone-100/70") : ""}`}
                            >
                              <td className="px-3 py-2.5 w-8">
                                <Link2 className={`w-3.5 h-3.5 mt-0.5 ${dark ? "text-stone-500" : "text-stone-400"}`} />
                              </td>
                              <td className="px-3 py-2.5">
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  <span className={`font-black text-xs ${dark ? "text-white" : "text-stone-900"}`}>{group.name}</span>
                                </div>
                              </td>
                              <td className="px-3 py-2.5">
                                <span className={`text-[11px] font-semibold ${dark ? "text-stone-400" : "text-stone-500"}`}>
                                  {ownerDisplayForGroup(group.id) || "—"}
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
                              {anyGroupEditable && (
                                <td className="px-3 py-2.5 text-right" onClick={(e) => e.stopPropagation()}>
                                  <div className="flex items-center justify-end gap-1.5">
                                    {rowEditable && (
                                      <ClippedButton
                                        onClick={() => toggleGroupActiveFromList(group)}
                                        disabled={togglingActiveGroupId !== null}
                                        cornerBg={dark ? "#0e2236" : "#ffffff"}
                                        className={`p-1.5 disabled:opacity-50 ${dark ? "hover:bg-amber-500/15 text-stone-400 hover:text-amber-400" : "hover:bg-amber-500/10 text-stone-500 hover:text-amber-600"}`}
                                        title={group.active ? "Deactivate group (back to ordinary tier-based access)" : "Reactivate group"}
                                      >
                                        <Power className="w-3.5 h-3.5" />
                                      </ClippedButton>
                                    )}
                                    {rowEditable && (
                                      <ClippedButton
                                        onClick={() => openEdit(group)}
                                        cornerBg={dark ? "#0e2236" : "#ffffff"}
                                        className={`p-1.5 ${dark ? "hover:bg-sky-500/15 text-stone-400 hover:text-sky-400" : "hover:bg-sky-500/10 text-stone-500 hover:text-sky-600"}`}
                                        title="Edit group"
                                      >
                                        <Pencil className="w-3.5 h-3.5" />
                                      </ClippedButton>
                                    )}
                                    {/* Delete is hardcoded Developer/Platform Admin-only, at
                                        the user's explicit request — independent of both
                                        canManageGroups (an Admin can reach that via a
                                        group_management Custom Grant) and the 2026-09h
                                        ownership carve-out. Mirrors server.ts's own
                                        hardcoded isDeveloperPower() check on
                                        DELETE /api/relationship-groups/:id. */}
                                    {isDeveloperPowerTier && (
                                      <ClippedButton
                                        onClick={() => deleteGroup(group)}
                                        disabled={saving}
                                        cornerBg={dark ? "#0e2236" : "#ffffff"}
                                        className={`p-1.5 ${dark ? "hover:bg-red-500/15 text-stone-400 hover:text-red-400" : "hover:bg-red-500/10 text-stone-500 hover:text-red-600"}`}
                                        title="Delete permanently"
                                      >
                                        <Trash2 className="w-3.5 h-3.5" />
                                      </ClippedButton>
                                    )}
                                  </div>
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

          <p className="text-[10.5px] font-semibold text-content-muted">
            {canEdit
              ? "Most groups (Mentor/Guide included) have no effect on what anyone can access unless Access is configured for that group. Click a row, or Edit, to open its full configuration."
              : "Admin clearance grants read-only visibility into groups. Developer or Platform Admin clearance is required to create or edit them."}
          </p>
        </>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════
// Inline editor — replaces GroupEditorModal.tsx (2026-09d). No dialog, no
// backdrop, no fixed-size window, no step wizard: one flowing page, top to
// bottom, matching the user's own ordering — Group Name -> Group Owner ->
// Group Members -> Access Control -> Save Group.
// ══════════════════════════════════════════════════════════════════════

interface GroupEditorProps {
  theme: "light" | "dark";
  mode: "create" | "edit";
  group: RelationshipGroup | null;
  allGroups: RelationshipGroup[];
  mappings: UserRelationship[];
  grantsByGroup: Map<number, GroupToolAccessEntry[]>;
  usersList: UserProfile[];
  departments: Department[];
  orgTeams: OrgTeam[];
  roles: AppRole[];
  canEdit: boolean;
  logAction: (actionType: string, description: string) => void;
  onClose: () => void;
  onReload: (opts?: { silent?: boolean }) => Promise<void>;
  onCreated: (groupId: number) => void;
}

function GroupEditor({ theme, group, allGroups, mappings, grantsByGroup, usersList, departments, orgTeams, roles, canEdit, logAction, onClose, onReload, onCreated }: GroupEditorProps) {
  const dark = theme === "dark";
  const [error, setError] = useState<string | null>(null);

  // ── 1. Group Name ───────────────────────────────────────────────────
  const [groupName, setGroupName] = useState(group?.name || "");
  const [creating, setCreating] = useState(false);

  // Client-side duplicate check (case-insensitive, trimmed) — immediate
  // feedback before the round trip; the server's own unique index +
  // 409 handling (POST/PATCH /api/relationship-groups) is still the
  // authoritative check, this just avoids a wasted request for the common
  // typo/re-click case. Excludes the group being edited itself.
  const nameConflict = useMemo(() => {
    const trimmed = groupName.trim().toLowerCase();
    if (!trimmed) return false;
    return allGroups.some((g) => g.id !== group?.id && g.name.trim().toLowerCase() === trimmed);
  }, [groupName, allGroups, group?.id]);

  const createGroup = async () => {
    if (!groupName.trim()) {
      setError("A group name is required.");
      return;
    }
    if (nameConflict) {
      setError("A group with that name already exists — choose a different name.");
      return;
    }
    setCreating(true);
    setError(null);
    try {
      const res = await fetch("/api/relationship-groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: groupName.trim(), description: null, departmentId: null }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Failed to create this group (HTTP ${res.status}).`);
      logAction("Relationship Group Created", `Created group "${body.entry.name}".`);
      onCreated(body.entry.id);
    } catch (err: any) {
      setError(err.message || "Failed to create this group.");
    } finally {
      setCreating(false);
    }
  };

  const nameDirty = group ? groupName.trim() !== group.name : false;

  // ── 2. Group Owner — search box, dynamic username matches ──────────
  const groupMappings = useMemo(() => (group ? mappings.filter((m) => m.relationshipGroupId === group.id) : []), [mappings, group]);
  const distinctOwners = useMemo(() => Array.from(new Set(groupMappings.map((m) => m.ownerEmail))), [groupMappings]);
  const [selectedOwnerEmail, setSelectedOwnerEmail] = useState("");

  useEffect(() => {
    setSelectedOwnerEmail(distinctOwners[0] || "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [group?.id]);

  const nameFor = (email: string) => usersList.find((u) => u.email === email)?.name || null;
  const tierFor = (email: string): Tier => usersList.find((u) => u.email === email)?.tier || "General";

  const ownerPool = useMemo(() => [...usersList].sort((a, b) => a.name.localeCompare(b.name)), [usersList]);

  // Belt-and-suspenders — same reasoning as before: never act on an owner
  // that isn't a real, current user.
  useEffect(() => {
    if (!isOwnerValidForPool(selectedOwnerEmail, ownerPool)) setSelectedOwnerEmail("");
  }, [ownerPool, selectedOwnerEmail]);

  const ownershipDirty = !!(group && selectedOwnerEmail && distinctOwners.length > 0 && distinctOwners.some((o) => o !== selectedOwnerEmail));

  // ── 3. Group Members — filterable directory + bulk-add ──────────────
  const existingMemberEmails = useMemo(() => new Set(groupMappings.map((m) => m.subjectEmail)), [groupMappings]);
  const [selectedCandidateEmails, setSelectedCandidateEmails] = useState<Set<string>>(new Set());
  const [addingMembers, setAddingMembers] = useState(false);
  const [removingMemberId, setRemovingMemberId] = useState<number | null>(null);
  const [memberSearch, setMemberSearch] = useState("");
  // Business Unit / Department / Role filters — Department's options depend
  // on the selected Business Unit, Role's on both, derived from which
  // combinations actually occur in the directory (there is no schema-level
  // BU→Dept→Role hierarchy — see OrgTeam/Department/AppRole in
  // types/permissions.ts, each a flat, independent list). "" means "All".
  const [businessUnitFilter, setBusinessUnitFilter] = useState("");
  const [departmentFilter, setDepartmentFilter] = useState("");
  const [roleFilter, setRoleFilter] = useState("");

  useEffect(() => {
    setSelectedCandidateEmails(new Set());
    setMemberSearch("");
    setBusinessUnitFilter("");
    setDepartmentFilter("");
    setRoleFilter("");
  }, [group?.id]);

  const businessUnitOptions = useMemo(() => [...orgTeams].sort((a, b) => a.name.localeCompare(b.name)), [orgTeams]);
  const departmentOptions = useMemo(() => {
    const buId = businessUnitFilter ? Number(businessUnitFilter) : null;
    const present = new Set(
      usersList.filter((u) => buId === null || u.orgTeamId === buId).map((u) => u.departmentId).filter((id): id is number => id != null)
    );
    return departments.filter((d) => present.has(d.id)).sort((a, b) => a.name.localeCompare(b.name));
  }, [usersList, businessUnitFilter, departments]);
  const roleOptions = useMemo(() => {
    const buId = businessUnitFilter ? Number(businessUnitFilter) : null;
    const deptId = departmentFilter ? Number(departmentFilter) : null;
    const present = new Set(
      usersList
        .filter((u) => (buId === null || u.orgTeamId === buId) && (deptId === null || u.departmentId === deptId))
        .map((u) => u.roleId)
        .filter((id): id is number => id != null)
    );
    return roles.filter((r) => present.has(r.id)).sort((a, b) => a.name.localeCompare(b.name));
  }, [usersList, businessUnitFilter, departmentFilter, roles]);

  // Cascade: if a parent filter changes and the child's current selection no
  // longer has any matching people, reset the child back to "All" instead of
  // silently showing zero results for a now-invalid combination.
  useEffect(() => {
    if (departmentFilter && !departmentOptions.some((d) => String(d.id) === departmentFilter)) setDepartmentFilter("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [departmentOptions]);
  useEffect(() => {
    if (roleFilter && !roleOptions.some((r) => String(r.id) === roleFilter)) setRoleFilter("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roleOptions]);

  const candidatePool = useMemo(() => {
    const q = memberSearch.trim().toLowerCase();
    const buId = businessUnitFilter ? Number(businessUnitFilter) : null;
    const deptId = departmentFilter ? Number(departmentFilter) : null;
    const roleId = roleFilter ? Number(roleFilter) : null;
    return usersList.filter((u) => {
      if (u.email === selectedOwnerEmail || existingMemberEmails.has(u.email)) return false;
      if (buId !== null && u.orgTeamId !== buId) return false;
      if (deptId !== null && u.departmentId !== deptId) return false;
      if (roleId !== null && u.roleId !== roleId) return false;
      if (!q) return true;
      return u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q) || u.tactId.toLowerCase().includes(q);
    });
  }, [usersList, selectedOwnerEmail, existingMemberEmails, memberSearch, businessUnitFilter, departmentFilter, roleFilter]);
  const visibleCandidates = candidatePool.slice(0, MAX_CANDIDATE_ROWS);

  // Select All acts on every currently filtered/visible person, not the
  // whole directory — independent of the render cap above, so it's correct
  // even when more than MAX_CANDIDATE_ROWS people match the current filters.
  const allFilteredSelected = candidatePool.length > 0 && candidatePool.every((u) => selectedCandidateEmails.has(u.email));
  const someFilteredSelected = !allFilteredSelected && candidatePool.some((u) => selectedCandidateEmails.has(u.email));
  const selectAllCandidatesRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (selectAllCandidatesRef.current) selectAllCandidatesRef.current.indeterminate = someFilteredSelected;
  }, [someFilteredSelected]);
  const toggleSelectAllFiltered = () => {
    setSelectedCandidateEmails((prev) => {
      const next = new Set(prev);
      if (allFilteredSelected) {
        for (const u of candidatePool) next.delete(u.email);
      } else {
        for (const u of candidatePool) next.add(u.email);
      }
      return next;
    });
  };
  const toggleCandidateSelected = (email: string) => {
    setSelectedCandidateEmails((prev) => {
      const next = new Set(prev);
      if (next.has(email)) next.delete(email);
      else next.add(email);
      return next;
    });
  };

  const removeMember = async (mappingId: number, subjectEmail: string) => {
    setRemovingMemberId(mappingId);
    setError(null);
    try {
      const res = await fetch(`/api/user-relationships/${mappingId}`, { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Failed to remove this person (HTTP ${res.status}).`);
      }
      logAction("User Relationship Removed", `Removed ${nameFor(subjectEmail) || subjectEmail} from "${group?.name || ""}".`);
      await onReload();
    } catch (err: any) {
      setError(err.message || "Failed to remove this person.");
    } finally {
      setRemovingMemberId(null);
    }
  };

  const addSelectedMembers = async () => {
    if (!group || !selectedOwnerEmail || selectedCandidateEmails.size === 0) return;
    setAddingMembers(true);
    setError(null);
    try {
      const emails = Array.from(selectedCandidateEmails);
      const results = await Promise.all(
        emails.map((subjectEmail) =>
          fetch("/api/user-relationships", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ownerEmail: selectedOwnerEmail, subjectEmail, relationshipGroupId: group.id }),
          }).then(async (res) => {
            const body = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
            return body;
          })
        )
      );
      logAction(
        "User Relationship Created",
        `Added ${results.length} ${results.length === 1 ? "person" : "people"} to "${group.name}" under ${nameFor(selectedOwnerEmail) || selectedOwnerEmail}.`
      );
      setSelectedCandidateEmails(new Set());
      await onReload();
    } catch (err: any) {
      setError(`${err.message || "Failed to add the selected people."} Some may have already been added — the list below reflects what actually saved.`);
      await onReload();
    } finally {
      setAddingMembers(false);
    }
  };

  // Tier breakdown of this group's current roster — feeds the note above
  // Access Control explaining why an Admin Zone grant won't reach everyone.
  const memberTierCounts = useMemo(() => {
    const counts: Record<Tier, number> = { General: 0, Admin: 0, "Platform Admin": 0, Developer: 0 };
    for (const email of existingMemberEmails) counts[tierFor(email)]++;
    return counts;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [existingMemberEmails, usersList]);
  const hasMixedTiers = (Object.values(memberTierCounts) as number[]).filter((n) => n > 0).length > 1;
  const adminEligibleCount = memberTierCounts.Admin + memberTierCounts["Platform Admin"] + memberTierCounts.Developer;

  // ── 4 & 5. Access Control — bifurcated list + per-row access level ──
  const [draftGrants, setDraftGrants] = useState<Map<string, Level>>(new Map());
  const [savingAccess, setSavingAccess] = useState(false);

  useEffect(() => {
    const next = new Map<string, Level>();
    if (group) for (const g of grantsByGroup.get(group.id) || []) next.set(g.featureId, g.level);
    setDraftGrants(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [group?.id]);

  const toggleFeature = (id: string) => {
    setDraftGrants((prev) => {
      const next = new Map(prev);
      if (next.has(id)) next.delete(id);
      else next.set(id, "Editor");
      return next;
    });
  };
  const setFeatureLevel = (id: string, level: Level) => {
    setDraftGrants((prev) => {
      const next = new Map(prev);
      next.set(id, level);
      return next;
    });
  };
  // Restrict-only toggle (2026-09g) — deliberately always stores "Viewer",
  // never "Editor": the level is never actually read for these featureIds
  // (isFeatureGroupGrantableForTier() always returns false for
  // RESTRICT_ONLY_FEATURES, so resolveAccess() never raises off it — see
  // accessRuleEvaluator.ts), a row here means "checked = don't restrict",
  // full stop. "Viewer" is just a valid, non-alarming placeholder to satisfy
  // GroupToolAccessEntry's level field.
  const toggleRestrictOnlyFeature = (id: string) => {
    setDraftGrants((prev) => {
      const next = new Map(prev);
      if (next.has(id)) next.delete(id);
      else next.set(id, "Viewer");
      return next;
    });
  };

  // Scoped to ALL_CONFIGURABLE_IDS (Advisor + Admin Zone) only — deliberately
  // excludes the Administrative Access zone's own checks (2026-09g), whose
  // draftGrants entries live in the same Map but shouldn't count toward, or
  // be touched by, this raise-oriented Select All (see RESTRICT_ONLY_TOOLS's
  // own comment above).
  const checkedCount = ALL_CONFIGURABLE_IDS.filter((id) => draftGrants.has(id)).length;
  const allChecked = checkedCount === ALL_CONFIGURABLE_IDS.length;
  const someChecked = checkedCount > 0 && !allChecked;
  const selectAllRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (selectAllRef.current) selectAllRef.current.indeterminate = someChecked;
  }, [someChecked]);
  const toggleSelectAll = () => {
    setDraftGrants((prev) => {
      const next = new Map(prev);
      if (allChecked) {
        for (const id of ALL_CONFIGURABLE_IDS) next.delete(id);
      } else {
        for (const id of ALL_CONFIGURABLE_IDS) if (!next.has(id)) next.set(id, "Editor");
      }
      return next;
    });
  };

  const isAccessDirty = useMemo(() => {
    if (!group) return false;
    const current = grantsByGroup.get(group.id) || [];
    if (current.length !== draftGrants.size) return true;
    return current.some((g) => draftGrants.get(g.featureId) !== g.level);
  }, [group, grantsByGroup, draftGrants]);

  // ── Status (Active/Inactive) ────────────────────────────────────────
  const [togglingActive, setTogglingActive] = useState(false);
  const toggleActive = async () => {
    if (!group || togglingActive) return;
    setTogglingActive(true);
    setError(null);
    try {
      const res = await fetch(`/api/relationship-groups/${group.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: !group.active }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Failed to update this group (HTTP ${res.status}).`);
      logAction("Relationship Group Edited", `${group.active ? "Deactivated" : "Reactivated"} group "${group.name}".`);
      await onReload({ silent: true });
    } catch (err: any) {
      setError(err.message || "Failed to update this group.");
    } finally {
      setTogglingActive(false);
    }
  };

  // ── 6. Save Group ────────────────────────────────────────────────────
  // Persists this group's configuration — name change, owner reassignment,
  // and access grants — in one action. Roster add/remove above are their
  // own immediate actions (same as a bulk-add always was), since they act
  // on individual people rather than the group's own configuration.
  const saveGroup = async () => {
    if (!group) return;
    if (nameConflict) {
      setError("A group with that name already exists — choose a different name.");
      return;
    }
    setSavingAccess(true);
    setError(null);
    try {
      if (nameDirty) {
        const res = await fetch(`/api/relationship-groups/${group.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: groupName.trim() }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error || `Failed to save changes (HTTP ${res.status}).`);
        logAction("Relationship Group Edited", `Renamed group "${group.name}" to "${groupName.trim()}".`);
      }

      if (ownershipDirty) {
        const ownersToMove = distinctOwners.filter((o) => o && o !== selectedOwnerEmail);
        const results = await Promise.all(
          ownersToMove.map((fromOwnerEmail) =>
            fetch(`/api/relationship-groups/${group.id}/reassign-owner`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ fromOwnerEmail, toOwnerEmail: selectedOwnerEmail }),
            }).then(async (res) => {
              const body = await res.json().catch(() => ({}));
              if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
              return body;
            })
          )
        );
        const totalReassigned = results.reduce((sum, r) => sum + (r.reassigned || 0), 0);
        logAction(
          "User Relationships Reassigned",
          `Reassigned ${totalReassigned} mapping${totalReassigned === 1 ? "" : "s"} in "${group.name}" to ${nameFor(selectedOwnerEmail) || selectedOwnerEmail}.`
        );
      }

      if (isAccessDirty) {
        const grants = Array.from(draftGrants.entries()).map(([featureId, level]) => ({ featureId, level }));
        const res = await fetch(`/api/group-access/${group.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ grants }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error || `Failed to save (HTTP ${res.status}).`);
        logAction("Group Tool Access Updated", `Set "${group.name}"'s access grants to: ${grants.length ? grants.map((g) => `${g.featureId} (${g.level})`).join(", ") : "(none)"}.`);

        const nextUsedForGroupAccess = grants.length > 0;
        if (nextUsedForGroupAccess !== group.usedForGroupAccess) {
          const res2 = await fetch(`/api/relationship-groups/${group.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ usedForGroupAccess: nextUsedForGroupAccess }),
          });
          const body2 = await res2.json().catch(() => ({}));
          if (!res2.ok) throw new Error(body2.error || `Failed to update (HTTP ${res2.status}).`);
        }
      }

      await onReload();
      onClose();
    } catch (err: any) {
      setError(err.message || "Failed to save this group.");
    } finally {
      setSavingAccess(false);
    }
  };

  const anyDirty = nameDirty || ownershipDirty || isAccessDirty;

  const inputClass = `w-full text-[11px] px-2.5 py-1.5 rounded-lg border outline-none font-semibold ${
    dark ? "bg-[#060a12] border-stone-850 text-white focus:border-sky-500" : "bg-white border-stone-200 text-stone-900 focus:border-sky-400"
  }`;
  const selectTriggerClass = `w-full flex items-center justify-between gap-1 text-[11px] pl-2.5 pr-6 py-1.5 rounded-lg border outline-none font-semibold relative ${
    dark ? "bg-[#060a12] border-stone-850 text-white focus:border-sky-500" : "bg-white border-stone-200 text-stone-900 focus:border-sky-400"
  }`;
  const rowClass = `flex items-center gap-2 px-2.5 py-1.5 text-[11px] font-semibold border-b last:border-b-0 ${dark ? "border-stone-850" : "border-stone-150"}`;
  const cardClass = `rounded-2xl border p-5 space-y-3 ${dark ? "bg-white/[0.03] border-white/[0.08]" : "bg-black/[0.02] border-black/[0.08]"}`;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={onClose}
          className={`flex items-center gap-1.5 text-[10.5px] font-black uppercase tracking-wider cursor-pointer ${dark ? "text-stone-400 hover:text-white" : "text-stone-500 hover:text-stone-900"}`}
        >
          <ArrowLeft className="w-3.5 h-3.5 shrink-0" />
          Back to Groups
        </button>
        {group && (
          <div className="flex items-center gap-2">
            <span className={`px-1.5 py-0.5 rounded text-[9px] font-black uppercase border whitespace-nowrap ${group.active ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30" : "bg-stone-500/15 text-stone-400 border-stone-500/30"}`}>
              {group.active ? "Active" : "Inactive"}
            </span>
            {canEdit && (
              <ClippedButton
                onClick={toggleActive}
                disabled={togglingActive}
                cornerBg={dark ? "#12151A" : "#ffffff"}
                className={`flex items-center gap-1.5 text-[10px] font-mono font-bold uppercase tracking-[0.15em] px-2.5 py-1.5 border disabled:opacity-50 ${dark ? "border-stone-700 text-stone-300 hover:bg-white/[0.04]" : "border-stone-300 text-stone-600 hover:bg-stone-50"}`}
              >
                <Power className="w-3 h-3" />
                {togglingActive ? "Updating..." : group.active ? "Deactivate" : "Reactivate"}
              </ClippedButton>
            )}
          </div>
        )}
      </div>

      {error && (
        <div className="px-3 py-2 rounded-lg text-[11px] font-bold text-red-400 bg-red-500/10 border border-red-500/25 flex items-center gap-1.5">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
          {error}
        </div>
      )}

      {/* ── 1 & 2. Group Name + Group Owner, side by side ──────────── */}
      <div className={cardClass}>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {/* Group Name */}
          <div className="space-y-3">
            <h3 className="text-[11px] font-black uppercase tracking-wider flex items-center gap-1.5 text-content-muted">
              <Tags className="w-3.5 h-3.5" />
              Group Name
            </h3>
            <div className="max-w-sm space-y-1">
              <input className={inputClass} placeholder="e.g. Mentor" value={groupName} onChange={(e) => setGroupName(e.target.value)} disabled={!canEdit || !!group} autoFocus={!group} />
              {nameConflict && (
                <p className="text-[10.5px] font-bold text-red-400 flex items-center gap-1.5">
                  <AlertTriangle className="w-3 h-3 shrink-0" />
                  A group with that name already exists.
                </p>
              )}
            </div>
            {!group && (
              <ClippedButton
                onClick={createGroup}
                disabled={creating || !groupName.trim() || nameConflict}
                cornerBg={dark ? "#12151A" : "#ffffff"}
                style={{ backgroundColor: "var(--action-navy)", borderColor: "var(--action-navy)", color: "var(--on-action-navy)" }}
                className="flex items-center gap-1.5 text-[10px] font-mono font-bold uppercase tracking-[0.15em] px-3 py-2 border hover:brightness-110 disabled:opacity-50"
              >
                <Plus className="w-3.5 h-3.5 shrink-0" />
                {creating ? "Creating..." : "Create Group"}
              </ClippedButton>
            )}
            {group && (
              <p className={`text-[10.5px] ${dark ? "text-stone-500" : "text-stone-400"}`}>
                {nameDirty ? "Renaming — click Save Group below to apply." : "Editing an existing group's name is saved along with the rest of this page via Save Group below."}
              </p>
            )}
          </div>

          {/* Group Owner — needs the group to exist first */}
          <fieldset
            disabled={!group}
            className={`space-y-3 md:pl-5 md:border-l ${dark ? "md:border-stone-850" : "md:border-stone-200"} ${!group ? "opacity-50 pointer-events-none" : ""}`}
          >
            <h3 className="text-[11px] font-black uppercase tracking-wider flex items-center gap-1.5 text-content-muted">
              <Users2 className="w-3.5 h-3.5" />
              Group Owner
            </h3>
            {distinctOwners.length > 1 && (
              <p className={`flex items-start gap-1.5 text-[10.5px] font-semibold px-2.5 py-2 rounded-lg border ${dark ? "bg-amber-500/10 border-amber-500/25 text-amber-400" : "bg-amber-50 border-amber-200 text-amber-700"}`}>
                <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                This group currently has members under {distinctOwners.length} different owners: {distinctOwners.map((o) => nameFor(o) || o).join(", ")}. Saving moves everyone under whichever owner is selected here.
              </p>
            )}
            <label className="flex flex-col gap-1 text-[10.5px] font-bold text-content-muted max-w-sm">
              Search for an owner by name or email
              <CustomSelect
                theme={theme}
                value={selectedOwnerEmail}
                onChange={setSelectedOwnerEmail}
                triggerClassName={selectTriggerClass}
                disabled={!canEdit}
                options={[{ value: "", label: "Select an owner..." }, ...ownerPool.map((u) => ({ value: u.email, label: `${u.name} (${u.email})` }))]}
                searchable
                searchPlaceholder="Search people…"
              />
            </label>
            {ownershipDirty && (
              <p className={`text-[10.5px] flex items-center gap-1.5 ${dark ? "text-stone-500" : "text-stone-400"}`}>
                Owner changed — click Save Group below to move every existing member onto the new owner.
              </p>
            )}
          </fieldset>
        </div>
      </div>

      {/* Everything below requires the group to exist first. */}
      <fieldset disabled={!group} className={!group ? "opacity-50 pointer-events-none space-y-5" : "space-y-5"}>
        {/* ── 3. Group Members ───────────────────────────────────── */}
        <div className={`rounded-2xl border p-4 space-y-2.5 ${dark ? "bg-white/[0.03] border-white/[0.08]" : "bg-black/[0.02] border-black/[0.08]"}`}>
          <h3 className="text-[11px] font-black uppercase tracking-wider flex items-center gap-1.5 text-content-muted">
            <Users2 className="w-3.5 h-3.5" />
            Group Members
          </h3>

          {/* Current members — compact removable chips, no separate bulk-select UI */}
          <div>
            <span className={`text-[10.5px] font-bold uppercase tracking-wider ${dark ? "text-stone-400" : "text-stone-500"}`}>
              Current members ({groupMappings.length})
            </span>
            {groupMappings.length === 0 ? (
              <p className={`mt-1.5 px-2.5 py-2 text-[11px] font-semibold rounded-lg border ${dark ? "text-stone-500 border-stone-850" : "text-stone-400 border-stone-200"}`}>No members yet.</p>
            ) : (
              <div className={`mt-1.5 flex flex-wrap gap-1.5 p-2 rounded-lg border max-h-28 overflow-y-auto ${dark ? "border-stone-850 bg-white/[0.015]" : "border-stone-200 bg-white"}`}>
                {groupMappings.map((m) => (
                  <span
                    key={m.id}
                    title={m.subjectEmail}
                    className={`inline-flex items-center gap-1.5 pl-2.5 pr-1 py-1 rounded-full border text-[10.5px] font-bold whitespace-nowrap ${dark ? "bg-white/[0.05] border-stone-800 text-white" : "bg-stone-50 border-stone-200 text-stone-900"}`}
                  >
                    {nameFor(m.subjectEmail) || m.subjectEmail}
                    <span className={`px-1 py-0.5 rounded text-[8.5px] font-black ${dark ? "bg-white/[0.06] text-stone-400" : "bg-stone-200 text-stone-500"}`}>{TIER_ABBREV[tierFor(m.subjectEmail)]}</span>
                    {canEdit && (
                      <button
                        type="button"
                        onClick={() => removeMember(m.id, m.subjectEmail)}
                        disabled={removingMemberId === m.id}
                        title="Remove from group"
                        className={`flex items-center justify-center w-4 h-4 rounded-full cursor-pointer disabled:opacity-40 ${dark ? "hover:bg-red-500/20 text-stone-500 hover:text-red-400" : "hover:bg-red-100 text-stone-400 hover:text-red-600"}`}
                      >
                        <X className="w-3 h-3" />
                      </button>
                    )}
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Add Members — Search / Business Unit / Department / Role, all combined */}
          {canEdit && (
            <div>
              <div className="flex items-center justify-between gap-2 mb-1.5">
                <span className={`text-[10.5px] font-bold uppercase tracking-wider ${dark ? "text-stone-400" : "text-stone-500"}`}>Add Members</span>
                <ClippedButton
                  onClick={addSelectedMembers}
                  disabled={addingMembers || !selectedOwnerEmail || selectedCandidateEmails.size === 0}
                  cornerBg={dark ? "#12151A" : "#ffffff"}
                  style={{ backgroundColor: "var(--action-navy)", borderColor: "var(--action-navy)", color: "var(--on-action-navy)" }}
                  className="flex items-center gap-1.5 text-[10px] font-mono font-bold uppercase tracking-[0.15em] px-2.5 py-1.5 border hover:brightness-110 disabled:opacity-50 shrink-0"
                >
                  <Plus className="w-3 h-3" />
                  Add Selected ({selectedCandidateEmails.size})
                </ClippedButton>
              </div>
              {!selectedOwnerEmail && (
                <p className={`text-[10.5px] font-semibold mb-1.5 ${dark ? "text-amber-400" : "text-amber-700"}`}>Select an Owner above first — every member is mapped to that owner.</p>
              )}

              {/* Compact horizontal filter row — 4 columns on wider screens, wraps on narrower ones */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 mb-1.5">
                <div className="relative">
                  <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-content-faint pointer-events-none" />
                  <input
                    type="text"
                    value={memberSearch}
                    onChange={(e) => setMemberSearch(e.target.value)}
                    placeholder="Search name, email, or employee ID…"
                    className={`w-full pl-7 pr-2.5 py-1.5 rounded-lg border text-[11px] font-semibold outline-none ${dark ? "bg-[#060a12] border-stone-850 text-white focus:border-sky-500" : "bg-white border-stone-200 text-stone-900 focus:border-sky-400"}`}
                  />
                </div>
                <CustomSelect
                  theme={theme}
                  value={businessUnitFilter}
                  onChange={setBusinessUnitFilter}
                  triggerClassName={selectTriggerClass}
                  options={[{ value: "", label: "All Business Units" }, ...businessUnitOptions.map((t) => ({ value: String(t.id), label: t.name }))]}
                />
                <CustomSelect
                  theme={theme}
                  value={departmentFilter}
                  onChange={setDepartmentFilter}
                  triggerClassName={selectTriggerClass}
                  options={[{ value: "", label: "All Departments" }, ...departmentOptions.map((d) => ({ value: String(d.id), label: d.name }))]}
                />
                <CustomSelect
                  theme={theme}
                  value={roleFilter}
                  onChange={setRoleFilter}
                  triggerClassName={selectTriggerClass}
                  options={[{ value: "", label: "All Roles" }, ...roleOptions.map((r) => ({ value: String(r.id), label: r.name }))]}
                />
              </div>

              {/* Matching count + Select All, immediately above the scrollable list */}
              <div className="flex items-center justify-between gap-2 mb-1">
                <label className="flex items-center gap-1.5 cursor-pointer select-none">
                  <input ref={selectAllCandidatesRef} type="checkbox" checked={allFilteredSelected} onChange={toggleSelectAllFiltered} disabled={candidatePool.length === 0} className="w-3.5 h-3.5 accent-sky-500" />
                  <span className={`text-[10px] font-black uppercase tracking-wide ${dark ? "text-stone-400" : "text-stone-500"}`}>Select All</span>
                </label>
                <span className={`text-[10.5px] font-semibold ${dark ? "text-stone-500" : "text-stone-400"}`}>
                  {candidatePool.length} matching · {selectedCandidateEmails.size} selected
                </span>
              </div>

              {/* Fixed-height scrollable candidate list */}
              {candidatePool.length === 0 ? (
                <p className={`px-2.5 py-3 text-[11px] font-semibold rounded-lg border ${dark ? "text-stone-500 border-stone-850" : "text-stone-400 border-stone-200"}`}>No matching users.</p>
              ) : (
                <div className={`rounded-lg border overflow-hidden max-h-56 overflow-y-auto ${dark ? "border-stone-850" : "border-stone-200"}`}>
                  {visibleCandidates.map((u) => (
                    <label key={u.email} className={`${rowClass} cursor-pointer select-none ${dark ? "hover:bg-white/[0.03]" : "hover:bg-stone-50"}`}>
                      <input type="checkbox" checked={selectedCandidateEmails.has(u.email)} onChange={() => toggleCandidateSelected(u.email)} className="w-3.5 h-3.5 accent-sky-500 shrink-0" />
                      <span className={`font-bold ${dark ? "text-white" : "text-stone-900"}`}>{u.name}</span>
                      <span className={dark ? "text-stone-500" : "text-stone-400"}>{u.email}</span>
                      <span className={`ml-auto px-1.5 py-0.5 rounded text-[9px] font-black uppercase border whitespace-nowrap ${dark ? "bg-white/[0.04] text-stone-400 border-stone-800" : "bg-stone-100 text-stone-500 border-stone-200"}`}>
                        {u.tier}
                      </span>
                    </label>
                  ))}
                  {candidatePool.length > MAX_CANDIDATE_ROWS && (
                    <p className={`px-2.5 py-1.5 text-[10.5px] font-semibold ${dark ? "text-stone-500" : "text-stone-400"}`}>
                      Showing the first {MAX_CANDIDATE_ROWS} of {candidatePool.length} matches — search or filter to narrow (Select All still applies to all {candidatePool.length}).
                    </p>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── 4 & 5. Access Control + Access Level ───────────────── */}
        <div className={cardClass}>
          <h3 className="text-[11px] font-black uppercase tracking-wider flex items-center gap-1.5 text-content-muted">
            <ShieldCheck className="w-3.5 h-3.5" />
            Access Control
          </h3>
          <p className={`text-[10.5px] font-semibold max-w-2xl ${dark ? "text-stone-500" : "text-stone-400"}`}>
            Checking an item RAISES this group's members to at least that level, above their tier's normal default — never lower. Once this group is
            saved with any item checked, it also RESTRICTS: for General and Admin tier members, everything left unchecked is blocked instead of left at
            their usual default. General members are restricted within the Advisor Zone only (Admin Zone was never reachable for them anyway). Admin
            members are restricted across both zones — so a trainer limited to just one Admin Zone item here loses access to every other Admin Zone item
            too, not only the ones they didn't already have. Platform Admin and Developer members are exempt from restriction — grants can still raise
            their access, but nothing here can ever block them. The Administrative Access section below (Access Control Center, Master Advisors, and
            related sections) works differently — see its own note.
          </p>
          {hasMixedTiers && (
            <p className={`flex items-start gap-1.5 text-[10.5px] font-semibold px-2.5 py-2 rounded-lg border ${dark ? "bg-sky-500/10 border-sky-500/25 text-sky-400" : "bg-sky-50 border-sky-200 text-sky-700"}`}>
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              This group has mixed tiers ({memberTierCounts.General} General, {memberTierCounts.Admin} Admin, {memberTierCounts["Platform Admin"]} Platform Admin, {memberTierCounts.Developer} Developer)
              — General members here are restricted to only the Advisor Zone items checked below; Admin members are restricted to only the items checked
              below across both zones; Platform Admin/Developer members are unaffected either way.
            </p>
          )}

          <label className={`flex items-center gap-2 px-3 py-1.5 -mb-1 cursor-pointer select-none ${!canEdit ? "opacity-70 pointer-events-none" : ""}`}>
            <input ref={selectAllRef} type="checkbox" checked={allChecked} onChange={toggleSelectAll} disabled={!canEdit} className="w-3.5 h-3.5 accent-sky-500" />
            <span className={`text-[10px] font-black uppercase tracking-wide ${dark ? "text-stone-400" : "text-stone-500"}`}>
              Select All ({checkedCount}/{ALL_CONFIGURABLE_IDS.length})
            </span>
          </label>

          <AccessZoneList title="Advisor Zone" subtitle="Every tier can use these." tools={ADVISOR_ZONE_TOOLS} draftGrants={draftGrants} canEdit={canEdit} dark={dark} onToggle={toggleFeature} onLevel={setFeatureLevel} />
          <AccessZoneList title="Admin Zone" subtitle="Only Admin, Platform Admin, and Developer members are ever affected by these." tools={ADMIN_ZONE_TOOLS} draftGrants={draftGrants} canEdit={canEdit} dark={dark} onToggle={toggleFeature} onLevel={setFeatureLevel} />

          {/* Administrative Access — 2026-09g, at the user's explicit
              request. Deliberately separate from Select All / the two zones
              above: these checkboxes never GRANT anything (an Admin already
              has their own default access to these, same as always), they
              only decide whether this group's configuration takes that
              default access AWAY. */}
          <div className="space-y-1.5 pt-1">
            <div className="flex items-baseline gap-2">
              <span className={`text-[10px] font-black uppercase tracking-wider ${dark ? "text-stone-300" : "text-stone-600"}`}>Administrative Access</span>
              <span className={`text-[10px] font-semibold ${dark ? "text-stone-500" : "text-stone-400"}`}>
                Restrict-only — Admin-tier members only. Checking one does NOT grant it; it only keeps their existing tier access from being restricted.
              </span>
            </div>
            <p className={`text-[10.5px] font-semibold max-w-2xl ${dark ? "text-stone-500" : "text-stone-400"}`}>
              These are the Access Control Center's own sections plus Master Advisors — self-escalation-sensitive, so a group can never RAISE anyone's
              access to them (an Admin who doesn't already have Master Advisors access, for example, can't get it from a group). But once this group
              restricts its Admin-tier members (any box checked anywhere on this page), leaving one of these unchecked blocks it for them too — so a
              tightly-scoped "limited admin" group can lock these out completely, not just the ordinary Advisor/Admin Zone tools above.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {RESTRICT_ONLY_TOOLS.map((tool) => {
                const checked = draftGrants.has(tool.id);
                return (
                  <label
                    key={tool.id}
                    className={`flex items-center gap-2 px-3 py-2 rounded-lg border cursor-pointer select-none ${dark ? "border-stone-850 bg-white/[0.02]" : "border-stone-200 bg-white"} ${!canEdit ? "opacity-70 pointer-events-none" : ""}`}
                  >
                    <input type="checkbox" checked={checked} onChange={() => toggleRestrictOnlyFeature(tool.id)} disabled={!canEdit} className="w-3.5 h-3.5 accent-sky-500 shrink-0" />
                    <span className={`text-[11px] font-bold ${dark ? "text-white" : "text-stone-900"}`}>{tool.name}</span>
                  </label>
                );
              })}
            </div>
          </div>
        </div>
      </fieldset>

      {/* ── 6. Save Group ───────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-2">
        <ClippedButton onClick={onClose} className={dark ? "bg-white/[0.06] text-stone-300 px-4 py-2 text-[11px] font-black uppercase tracking-wider" : "bg-stone-100 text-stone-600 px-4 py-2 text-[11px] font-black uppercase tracking-wider"}>
          <X className="w-3.5 h-3.5 shrink-0 inline mr-1.5 -mt-0.5" />
          Close
        </ClippedButton>
        {group && canEdit && (
          <ClippedButton
            onClick={saveGroup}
            disabled={savingAccess || !anyDirty || nameConflict}
            cornerBg={dark ? "#12151A" : "#ffffff"}
            style={{ backgroundColor: "var(--action-navy)", borderColor: "var(--action-navy)", color: "var(--on-action-navy)" }}
            className="flex items-center gap-1.5 text-[10px] font-mono font-bold uppercase tracking-[0.15em] px-4 py-2.5 border hover:brightness-110 disabled:opacity-50"
          >
            <Save className="w-3.5 h-3.5 shrink-0" />
            {savingAccess ? "Saving..." : "Save Group"}
          </ClippedButton>
        )}
      </div>
    </div>
  );
}

/** One zone's section of the Access Control list — Advisor Zone or Admin
 * Zone, bifurcated per the user's explicit request ("Display all menu
 * items from Advisor Zone and Admin Zone in a single list, with clear
 * bifurcation"). Each row is a checkbox (grant on/off) plus, once checked,
 * a Viewer/Editor level toggle — items 4 and 5 of the user's spec,
 * combined into one row since a level only makes sense once the item is
 * granted at all. */
function AccessZoneList({
  title,
  subtitle,
  tools,
  draftGrants,
  canEdit,
  dark,
  onToggle,
  onLevel,
}: {
  title: string;
  subtitle: string;
  tools: { id: string; name: string }[];
  draftGrants: Map<string, Level>;
  canEdit: boolean;
  dark: boolean;
  onToggle: (id: string) => void;
  onLevel: (id: string, level: Level) => void;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline gap-2">
        <span className={`text-[10px] font-black uppercase tracking-wider ${dark ? "text-stone-300" : "text-stone-600"}`}>{title}</span>
        <span className={`text-[10px] font-semibold ${dark ? "text-stone-500" : "text-stone-400"}`}>{subtitle}</span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {tools.map((tool) => {
          const level = draftGrants.get(tool.id);
          const checked = level !== undefined;
          return (
            <div key={tool.id} className={`flex items-center justify-between gap-2 px-3 py-2 rounded-lg border ${dark ? "border-stone-850 bg-white/[0.02]" : "border-stone-200 bg-white"} ${!canEdit ? "opacity-70" : ""}`}>
              <label className={`flex items-center gap-2 cursor-pointer select-none ${!canEdit ? "pointer-events-none" : ""}`}>
                <input type="checkbox" checked={checked} onChange={() => onToggle(tool.id)} disabled={!canEdit} className="w-3.5 h-3.5 accent-sky-500 shrink-0" />
                <span className={`text-[11px] font-bold ${dark ? "text-white" : "text-stone-900"}`}>{tool.name}</span>
              </label>
              {checked && (
                <div className="flex items-center gap-0.5 shrink-0">
                  {(["Viewer", "Editor"] as const).map((l) => (
                    <button
                      key={l}
                      type="button"
                      disabled={!canEdit}
                      onClick={() => onLevel(tool.id, l)}
                      className={`px-1.5 py-0.5 rounded text-[9px] font-black uppercase border cursor-pointer disabled:cursor-not-allowed ${
                        level === l
                          ? dark ? "bg-sky-500/20 text-sky-400 border-sky-500/40" : "bg-sky-50 text-sky-700 border-sky-300"
                          : dark ? "border-stone-800 text-stone-500 hover:bg-white/[0.04]" : "border-stone-200 text-stone-400 hover:bg-stone-50"
                      }`}
                    >
                      {l}
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
