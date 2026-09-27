/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useMemo, useRef, useState, type ReactNode, Fragment } from "react";
import {
  X,
  Save,
  Plus,
  Trash2,
  Power,
  ArrowRightLeft,
  ArrowLeft,
  ArrowRight,
  ChevronRight,
  Users2,
  Tags,
  Filter,
  Search,
  CheckSquare,
  Square,
  AlertTriangle,
} from "lucide-react";
import { RelationshipGroup, UserRelationship, Department, OrgTeam, AppRole } from "../types/permissions";
import { UserProfile } from "../types/user";
import { featuresApplicableToTier } from "../constants/featurePermissions";
import { ClippedButton } from "./ClippedButton";
import { CustomSelect } from "./CustomSelect";
import { isOwnerValidForPool } from "./groupOwnerValidation";

const MAX_CANDIDATE_ROWS = 50;

type WizardStep = 1 | 2 | 3;

const STEPS: { id: WizardStep; label: string }[] = [
  { id: 1, label: "Group & Ownership" },
  { id: 2, label: "Audience & Members" },
  { id: 3, label: "Access" },
];

interface GroupEditorModalProps {
  theme: "light" | "dark";
  mode: "create" | "edit";
  /** null only in "create" mode before the group has been saved for the
   * first time. Once created, the parent flips `mode` to "edit" and passes
   * the real row here — see onCreated below. */
  group: RelationshipGroup | null;
  /** Every mapping across every group — filtered down to this group's own
   * rows internally. Owned by the parent (GroupsManagement.tsx), which
   * already fetches it for the overview table; passing it down avoids a
   * second, duplicate fetch here. */
  mappings: UserRelationship[];
  allowedFeatureIdsByGroup: Map<number, string[]>;
  usersList: UserProfile[];
  departments: Department[];
  orgTeams: OrgTeam[];
  roles: AppRole[];
  canEdit: boolean;
  logAction: (actionType: string, description: string) => void;
  onClose: () => void;
  /** Re-fetches groups/mappings/allowedFeatureIdsByGroup in the parent —
   * called after every mutation so this modal's own props refresh with the
   * new state on the next render (this modal holds no server data of its
   * own, it's a view over the parent's). */
  onReload: (opts?: { silent?: boolean }) => Promise<void>;
  /** Fired once the initial "Create Group" POST succeeds — the parent
   * reloads and switches this same modal instance from create mode to edit
   * mode for the new group's real id, so the rest of the steps (Audience &
   * Members / Access) unlock in place without closing and reopening
   * anything. */
  onCreated: (groupId: number) => void;
}

function SectionCard({ title, icon, disabledNote, children }: { title: string; icon: ReactNode; disabledNote?: string; children: ReactNode }) {
  return (
    <div className="space-y-2">
      <h3 className="text-[11px] font-black uppercase tracking-wider flex items-center gap-1.5 text-content-muted">
        {icon}
        {title}
      </h3>
      {disabledNote ? (
        <p className="text-[10.5px] font-semibold text-content-faint italic">{disabledNote}</p>
      ) : (
        children
      )}
    </div>
  );
}

/**
 * The unified Group Level Access editor — "Open Group -> See Everything ->
 * Edit Anything Relevant" (2026-09), reworked into a fixed-size 3-step
 * wizard (2026-09b) after the single long scrolling form regularly grew
 * taller than the app viewport: 1. Group & Ownership, 2. Audience &
 * Members, 3. Access. The modal's own outer dimensions (width/height) never
 * change across steps — only the content inside the scrollable body swaps —
 * so the window never resizes or jumps when moving between steps.
 *
 * This is a UI/interaction reorganization only — every mutation below calls
 * the exact same server routes and repository methods that already existed
 * (group CRUD, /api/user-relationships CRUD, the reassign-owner action, the
 * group-access PUT, and the usedForGroupAccess/active PATCH toggles). No
 * new backend behavior, no schema change. The one behavioral nuance: Access
 * no longer has its own separate "restrict this group's members" checkbox
 * (per 2026-09b's explicit removal) — the tool checklist is always visible
 * on step 3, and `usedForGroupAccess` is now derived automatically from
 * whether any tool is checked (at least one checked -> restriction enabled;
 * none checked -> disabled) rather than toggled by hand. That still writes
 * through the identical PATCH the old checkbox used; only the UI decision
 * of when to send it changed.
 *
 * Step 1 saves Group+Ownership (one PATCH plus, if the owner changed, the
 * existing reassign-owner action) before advancing — in "create" mode this
 * IS the group-creation call, so Next on step 1 is what actually creates
 * the group. Step 2's Members add/remove buttons stay immediate actions,
 * same as a roster always worked; step 2's Next is pure navigation, nothing
 * to save. Step 3's "Save Group" persists the tool list (and the derived
 * usedForGroupAccess flag, and any pending Status change is already
 * immediate via its own button) and then closes the modal — the wizard's
 * terminal action.
 */
export function GroupEditorModal({
  theme,
  mode,
  group,
  mappings,
  allowedFeatureIdsByGroup,
  usersList,
  departments,
  orgTeams,
  roles,
  canEdit,
  logAction,
  onClose,
  onReload,
  onCreated,
}: GroupEditorModalProps) {
  const dark = theme === "dark";
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<WizardStep>(1);

  // ── Group + Ownership (Step 1) ─────────────────────────────────────────
  const [groupName, setGroupName] = useState(group?.name || "");
  const [ownerDepartmentId, setOwnerDepartmentId] = useState(group?.departmentId ? String(group.departmentId) : "");
  // Which tier of MEMBER this group's Access restriction applies to
  // (2026-09, migration 0082) — independent of the owner picked below; see
  // groupOwnerValidation.ts's sibling doc comments and schema.ts's comment
  // on relationshipGroups.groupTier for the full semantics. Defaults to
  // "General" for a new group, matching the column's own DB default.
  const [groupTier, setGroupTier] = useState<"General" | "Admin" | "Platform Admin">(group?.groupTier || "General");
  const [selectedOwnerEmail, setSelectedOwnerEmail] = useState("");
  // True exactly when the effect below has just cleared a previously-valid
  // Owner because Owner Department changed out from under it -- distinct
  // from "no owner picked yet" (e.g. a brand-new group) so the warning below
  // only shows when there's actually something for the user to redo.
  const [ownerClearedByDepartmentChange, setOwnerClearedByDepartmentChange] = useState(false);
  const [savingGroup, setSavingGroup] = useState(false);

  const groupMappings = useMemo(() => (group ? mappings.filter((m) => m.relationshipGroupId === group.id) : []), [mappings, group]);
  const distinctOwners = useMemo(() => Array.from(new Set(groupMappings.map((m) => m.ownerEmail))), [groupMappings]);

  // Seed the owner picker from whoever the group's roster is already under
  // — only once per group (not on every mapping change, or a bulk add/
  // remove mid-edit would keep yanking the selection back).
  useEffect(() => {
    setSelectedOwnerEmail(distinctOwners[0] || "");
    setOwnerClearedByDepartmentChange(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [group?.id]);

  const nameFor = (email: string) => usersList.find((u) => u.email === email)?.name || null;

  const ownerPool = useMemo(() => {
    const deptId = ownerDepartmentId ? Number(ownerDepartmentId) : null;
    const pool = deptId ? usersList.filter((u) => u.departmentId === deptId) : usersList;
    return [...pool].sort((a, b) => a.name.localeCompare(b.name));
  }, [usersList, ownerDepartmentId]);

  // Owner <-> Owner Department must never be left in an invalid combination
  // (2026-09 fix — see groupOwnerValidation.ts). Whenever Owner Department
  // changes (directly, or because `usersList` shifts who's in the currently
  // selected department) the previously selected Owner is re-checked against
  // the freshly recomputed `ownerPool`; if it's no longer in there, it's
  // cleared immediately rather than left sitting in state, invisible in the
  // now-blank Owner picker but still live enough to be silently submitted by
  // Next. `isOwnerValidForPool("", ...)` is always true, so this is a no-op
  // once the stale email has actually been cleared — no update loop.
  useEffect(() => {
    if (!isOwnerValidForPool(selectedOwnerEmail, ownerPool)) {
      setSelectedOwnerEmail("");
      setOwnerClearedByDepartmentChange(true);
    }
  }, [ownerPool, selectedOwnerEmail]);

  const departmentOptions = [{ value: "", label: "No department (unscoped)" }, ...departments.map((d) => ({ value: String(d.id), label: d.name }))];

  /** Returns whether the group now exists / is up to date — the gate Next
   * (step 1 -> 2) waits on. Returns false (and leaves `error` set) on any
   * failure, so the wizard stays put rather than advancing past a group
   * that didn't actually save. */
  const saveGroupAndOwnership = async (): Promise<boolean> => {
    if (!groupName.trim()) {
      setError("A group name is required.");
      return false;
    }
    // Defensive re-check, on top of the revalidation effect that already
    // clears a stale Owner the instant Owner Department changes — belt-and-
    // suspenders so this action can never act on an Owner that doesn't
    // belong to the currently selected Owner Department, however that
    // combination arose. Should be unreachable in practice (the effect
    // clears `selectedOwnerEmail` synchronously before this can be called
    // with a stale value), but this function must never silently reassign a
    // roster to an invalid owner even if that ever stops being true.
    if (!isOwnerValidForPool(selectedOwnerEmail, ownerPool)) {
      setError("The selected Owner isn't valid for this Owner Department. Please select a different Owner before saving.");
      return false;
    }
    setSavingGroup(true);
    setError(null);
    try {
      if (mode === "create") {
        const res = await fetch("/api/relationship-groups", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: groupName.trim(),
            description: null,
            departmentId: ownerDepartmentId ? Number(ownerDepartmentId) : null,
            groupTier,
          }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error || `Failed to create this group (HTTP ${res.status}).`);
        logAction("Relationship Group Created", `Created group "${body.entry.name}".`);
        onCreated(body.entry.id);
        return true;
      }

      if (!group) return false;
      const nameChanged = groupName.trim() !== group.name;
      const deptChanged = (ownerDepartmentId ? Number(ownerDepartmentId) : null) !== group.departmentId;
      const groupTierChanged = groupTier !== group.groupTier;
      if (nameChanged || deptChanged || groupTierChanged) {
        const res = await fetch(`/api/relationship-groups/${group.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: groupName.trim(), departmentId: ownerDepartmentId ? Number(ownerDepartmentId) : null, groupTier }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error || `Failed to save changes (HTTP ${res.status}).`);
        logAction("Relationship Group Edited", `Updated group "${group.name}".`);
      }

      // Consolidate onto the selected owner — reuses the exact same
      // reassign-owner action the standalone "Reassign Owner" button used
      // before the modal redesign, just triggered from this step's Next
      // instead of its own separate control. A no-op unless the roster's
      // existing owner(s) differ from what's selected here.
      const ownersToMove = distinctOwners.filter((o) => o && o !== selectedOwnerEmail);
      if (selectedOwnerEmail && ownersToMove.length > 0) {
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

      await onReload();
      return true;
    } catch (err: any) {
      setError(err.message || "Failed to save this group.");
      return false;
    } finally {
      setSavingGroup(false);
    }
  };

  const groupDirty =
    mode === "create" ||
    (group &&
      (groupName.trim() !== group.name ||
        (ownerDepartmentId ? Number(ownerDepartmentId) : null) !== group.departmentId ||
        groupTier !== group.groupTier));
  const ownershipDirty = group && selectedOwnerEmail && distinctOwners.some((o) => o !== selectedOwnerEmail) && distinctOwners.length > 0;

  // ── Target Filters — transient, UI-only narrowing for Members (Step 2) ─
  const [filterOrgTeamId, setFilterOrgTeamId] = useState("");
  const [filterDepartmentId, setFilterDepartmentId] = useState("");
  const [filterRoleId, setFilterRoleId] = useState("");
  const [memberSearch, setMemberSearch] = useState("");

  const handleFilterOrgTeamChange = (v: string) => {
    setFilterOrgTeamId(v);
    setFilterDepartmentId("");
    setFilterRoleId("");
  };
  const handleFilterDepartmentChange = (v: string) => {
    setFilterDepartmentId(v);
    setFilterRoleId("");
  };

  const poolAfterOrgTeam = useMemo(
    () => (filterOrgTeamId ? usersList.filter((u) => String(u.orgTeamId ?? "") === filterOrgTeamId) : usersList),
    [usersList, filterOrgTeamId]
  );
  const poolAfterDepartment = useMemo(
    () => (filterDepartmentId ? poolAfterOrgTeam.filter((u) => String(u.departmentId ?? "") === filterDepartmentId) : poolAfterOrgTeam),
    [poolAfterOrgTeam, filterDepartmentId]
  );
  const filteredPool = useMemo(
    () => (filterRoleId ? poolAfterDepartment.filter((u) => String(u.roleId ?? "") === filterRoleId) : poolAfterDepartment),
    [poolAfterDepartment, filterRoleId]
  );

  const filterOrgTeamOptions = useMemo(() => {
    const ids = new Set(usersList.map((u) => u.orgTeamId).filter((id): id is number => id != null));
    return orgTeams.filter((t) => ids.has(t.id)).sort((a, b) => a.name.localeCompare(b.name));
  }, [usersList, orgTeams]);
  const filterDepartmentOptions = useMemo(() => {
    const ids = new Set(poolAfterOrgTeam.map((u) => u.departmentId).filter((id): id is number => id != null));
    return departments.filter((d) => ids.has(d.id)).sort((a, b) => a.name.localeCompare(b.name));
  }, [poolAfterOrgTeam, departments]);
  const filterRoleOptions = useMemo(() => {
    const ids = new Set(poolAfterDepartment.map((u) => u.roleId).filter((id): id is number => id != null));
    return roles.filter((r) => ids.has(r.id)).sort((a, b) => a.name.localeCompare(b.name));
  }, [poolAfterDepartment, roles]);

  // ── Members (Step 2) ────────────────────────────────────────────────
  const existingMemberEmails = useMemo(() => new Set(groupMappings.map((m) => m.subjectEmail)), [groupMappings]);
  const [selectedExistingIds, setSelectedExistingIds] = useState<Set<number>>(new Set());
  const [selectedCandidateEmails, setSelectedCandidateEmails] = useState<Set<string>>(new Set());
  const [addingMembers, setAddingMembers] = useState(false);
  const [removingMembers, setRemovingMembers] = useState(false);

  useEffect(() => {
    setSelectedExistingIds(new Set());
    setSelectedCandidateEmails(new Set());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [group?.id]);

  const candidatePool = useMemo(() => {
    const q = memberSearch.trim().toLowerCase();
    return filteredPool.filter((u) => {
      if (u.email === selectedOwnerEmail || existingMemberEmails.has(u.email)) return false;
      if (!q) return true;
      return u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q) || u.tactId.toLowerCase().includes(q);
    });
  }, [filteredPool, selectedOwnerEmail, existingMemberEmails, memberSearch]);
  const visibleCandidates = candidatePool.slice(0, MAX_CANDIDATE_ROWS);

  const allVisibleCandidatesSelected = visibleCandidates.length > 0 && visibleCandidates.every((u) => selectedCandidateEmails.has(u.email));
  const toggleSelectAllVisibleCandidates = () => {
    setSelectedCandidateEmails((prev) => {
      if (allVisibleCandidatesSelected) {
        const next = new Set(prev);
        for (const u of visibleCandidates) next.delete(u.email);
        return next;
      }
      const next = new Set(prev);
      for (const u of visibleCandidates) next.add(u.email);
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

  const allExistingSelected = groupMappings.length > 0 && groupMappings.every((m) => selectedExistingIds.has(m.id));
  const toggleSelectAllExisting = () => {
    setSelectedExistingIds(allExistingSelected ? new Set() : new Set(groupMappings.map((m) => m.id)));
  };
  const toggleExistingSelected = (id: number) => {
    setSelectedExistingIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
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

  const removeSelectedMembers = async () => {
    if (selectedExistingIds.size === 0) return;
    const ids = Array.from(selectedExistingIds);
    if (!window.confirm(`Remove ${ids.length} selected ${ids.length === 1 ? "person" : "people"} from this group?`)) return;
    setRemovingMembers(true);
    setError(null);
    try {
      const results = await Promise.allSettled(ids.map((id) => fetch(`/api/user-relationships/${id}`, { method: "DELETE" })));
      const failed = results.filter((r) => r.status === "rejected" || (r.status === "fulfilled" && !r.value.ok)).length;
      logAction("User Relationship Removed", `Removed ${ids.length - failed} of ${ids.length} selected ${ids.length === 1 ? "person" : "people"} from "${group?.name || ""}".`);
      if (failed > 0) setError(`${failed} of ${ids.length} removals failed — the list below reflects what actually saved.`);
      setSelectedExistingIds(new Set());
      await onReload();
    } catch (err: any) {
      setError(err.message || "Failed to remove the selected people.");
      await onReload();
    } finally {
      setRemovingMembers(false);
    }
  };

  // ── Access (Step 3) ─────────────────────────────────────────────────
  const [draftFeatureIds, setDraftFeatureIds] = useState<string[]>([]);
  const [savingAccess, setSavingAccess] = useState(false);

  // The tool checklist follows Group Tier — "which tier's feature access am
  // I configuring?", not a fixed Advisor-Zone-only list (2026-09c, explicit
  // request; see featurePermissions.ts's featuresApplicableToTier() for the
  // full reasoning). Recomputed whenever the Step 1 Group Tier selector
  // changes, even before it's saved, so Step 3 always previews the tier
  // that's about to be saved.
  const restrictableTools = useMemo(
    () => featuresApplicableToTier(groupTier).map((p) => ({ id: p.id, name: p.name })),
    [groupTier]
  );
  const restrictableToolIds = useMemo(() => restrictableTools.map((t) => t.id), [restrictableTools]);

  useEffect(() => {
    const applicable = new Set(featuresApplicableToTier(groupTier).map((p) => p.id));
    setDraftFeatureIds(group ? (allowedFeatureIdsByGroup.get(group.id) || []).filter((id) => applicable.has(id)) : []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [group?.id]);

  // Re-prune whenever Group Tier itself changes (not just on group open) —
  // a tool checked while Group Tier was, say, Admin (e.g. "Plan
  // Management") has no business silently surviving in the draft once the
  // tier is switched back to General, where that tool isn't offered at
  // all: it would otherwise still be submitted on Save even though it's no
  // longer visible or checked anywhere in the UI. Anything outside the
  // newly-applicable set is dropped from the draft; everything else is
  // left exactly as the admin left it.
  useEffect(() => {
    const applicable = new Set(restrictableToolIds);
    setDraftFeatureIds((prev) => prev.filter((id) => applicable.has(id)));
  }, [restrictableToolIds]);

  const toggleFeature = (id: string) => setDraftFeatureIds((prev) => (prev.includes(id) ? prev.filter((f) => f !== id) : [...prev, id]));

  // Select All — scoped only to whatever's currently displayed for the
  // selected Group Tier (restrictableToolIds), never to anything else that
  // might still be sitting in draftFeatureIds.
  const checkedDisplayedCount = useMemo(
    () => restrictableToolIds.filter((id) => draftFeatureIds.includes(id)).length,
    [restrictableToolIds, draftFeatureIds]
  );
  const allDisplayedChecked = restrictableToolIds.length > 0 && checkedDisplayedCount === restrictableToolIds.length;
  const someDisplayedChecked = checkedDisplayedCount > 0 && !allDisplayedChecked;
  const selectAllRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (selectAllRef.current) selectAllRef.current.indeterminate = someDisplayedChecked;
  }, [someDisplayedChecked]);
  const toggleSelectAllTools = () => {
    setDraftFeatureIds((prev) => {
      if (allDisplayedChecked) {
        const displayed = new Set(restrictableToolIds);
        return prev.filter((id) => !displayed.has(id));
      }
      const next = new Set(prev);
      for (const id of restrictableToolIds) next.add(id);
      return Array.from(next);
    });
  };

  const isToolAccessDirty = useMemo(() => {
    if (!group) return false;
    const current = new Set(allowedFeatureIdsByGroup.get(group.id) || []);
    const draft = new Set(draftFeatureIds);
    if (current.size !== draft.size) return true;
    for (const id of current) if (!draft.has(id)) return true;
    return false;
  }, [group, allowedFeatureIdsByGroup, draftFeatureIds]);

  // ── Status ──────────────────────────────────────────────────────────
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

  /** Step 3's terminal action. Persists the tool checklist and, only if it
   * actually changed, the `usedForGroupAccess` flag it now implies (any
   * tool checked -> true, none checked -> false — see this file's doc
   * comment) — the exact same two existing endpoints the old checkbox +
   * Save button used, just combined into one action and fired from "Save
   * Group" instead. Closes the modal on success, same as the wizard's
   * other steps returning to the groups table once finished. */
  const saveAccessAndFinish = async () => {
    if (!group) {
      onClose();
      return;
    }
    setSavingAccess(true);
    setError(null);
    try {
      if (isToolAccessDirty) {
        const res = await fetch(`/api/group-access/${group.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ featureIds: draftFeatureIds }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error || `Failed to save (HTTP ${res.status}).`);
        logAction("Group Tool Access Updated", `Set "${group.name}"'s tools to: ${draftFeatureIds.length ? draftFeatureIds.join(", ") : "(none)"}.`);
      }

      const nextUsedForGroupAccess = draftFeatureIds.length > 0;
      if (nextUsedForGroupAccess !== group.usedForGroupAccess) {
        const res = await fetch(`/api/relationship-groups/${group.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ usedForGroupAccess: nextUsedForGroupAccess }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error || `Failed to update (HTTP ${res.status}).`);
        logAction(
          "Relationship Group Edited",
          `${nextUsedForGroupAccess ? "Enabled" : "Disabled"} Group Access for "${group.name}" (${draftFeatureIds.length} tool${draftFeatureIds.length === 1 ? "" : "s"} selected).`
        );
      }

      if (isToolAccessDirty || nextUsedForGroupAccess !== group.usedForGroupAccess) {
        await onReload();
      }
      onClose();
    } catch (err: any) {
      setError(err.message || "Failed to save this group's access.");
    } finally {
      setSavingAccess(false);
    }
  };

  // ── Wizard navigation ───────────────────────────────────────────────
  const goNextFromStep1 = async () => {
    if (canEdit) {
      const needsSave = mode === "create" || groupDirty || ownershipDirty;
      if (needsSave) {
        const ok = await saveGroupAndOwnership();
        if (!ok) return;
      }
    }
    setStep(2);
  };

  const inputClass = `w-full text-[11px] px-2.5 py-1.5 rounded-lg border outline-none font-semibold ${
    dark ? "bg-[#060a12] border-stone-850 text-white focus:border-sky-500" : "bg-white border-stone-200 text-stone-900 focus:border-sky-400"
  }`;
  const selectTriggerClass = `w-full flex items-center justify-between gap-1 text-[11px] pl-2.5 pr-6 py-1.5 rounded-lg border outline-none font-semibold relative ${
    dark ? "bg-[#060a12] border-stone-850 text-white focus:border-sky-500" : "bg-white border-stone-200 text-stone-900 focus:border-sky-400"
  }`;
  const rowClass = `flex items-center gap-2 px-2.5 py-1.5 text-[11px] font-semibold border-b last:border-b-0 ${dark ? "border-stone-850" : "border-stone-150"}`;

  return (
    <div className="fixed inset-0 z-[190] flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <div className={`absolute inset-0 backdrop-blur-md ${dark ? "bg-black/60" : "bg-stone-900/40"}`} onClick={onClose} />
      <div
        // Fixed outer dimensions — identical across all three steps, so the
        // window never resizes or jumps on Next/Back. `h-[min(640px,85vh)]`
        // targets a constant 640px on any normal screen while still
        // guaranteeing the modal never exceeds 85% of a short viewport;
        // only the body below scrolls internally when a step's content
        // doesn't fit.
        className={`relative w-full max-w-3xl h-[min(640px,85vh)] rounded-2xl border shadow-2xl flex flex-col ${
          dark ? "bg-[#12151A] border-[#252A34]" : "bg-[#ffffff] border-stone-200"
        }`}
      >
        <div className={`px-5 pt-4 pb-3 border-b shrink-0 space-y-2 ${dark ? "border-stone-800" : "border-stone-200"}`}>
          <div className="flex items-center justify-between">
            <h2 className={`text-sm font-bold uppercase tracking-wider ${dark ? "text-white" : "text-stone-900"}`}>
              {mode === "create" ? "New Group" : `Edit Group: ${group?.name}`}
            </h2>
            <button type="button" onClick={onClose} className={dark ? "text-stone-400 hover:text-white cursor-pointer" : "text-stone-400 hover:text-stone-800 cursor-pointer"}>
              <X className="w-4 h-4" />
            </button>
          </div>
          {/* Step indicator — "1. Group & Ownership -> 2. Audience & Members
              -> 3. Access". Display-only (navigation is via the Back/Next/
              Save Group buttons in the footer below), so its layout never
              shifts the header's height between steps. */}
          <div className="flex items-center flex-wrap gap-1">
            {STEPS.map((s, idx) => (
              <Fragment key={s.id}>
                {idx > 0 && <ChevronRight className={`w-3 h-3 shrink-0 ${dark ? "text-stone-700" : "text-stone-300"}`} />}
                <span
                  className={`text-[10.5px] font-black whitespace-nowrap ${
                    step === s.id
                      ? "text-[var(--accent)]"
                      : step > s.id
                        ? dark ? "text-stone-400" : "text-stone-500"
                        : dark ? "text-stone-700" : "text-stone-300"
                  }`}
                >
                  {s.id}. {s.label}
                </span>
              </Fragment>
            ))}
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4 space-y-6">
          {error && (
            <div className="px-3 py-2 rounded-lg text-[11px] font-bold text-red-400 bg-red-500/10 border border-red-500/25 flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
              {error}
            </div>
          )}

          {/* ── STEP 1 — Group & Ownership ──────────────────────────── */}
          {step === 1 && (
            <>
              <SectionCard title="Group" icon={<Tags className="w-3.5 h-3.5" />}>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <label className="flex flex-col gap-1 text-[10.5px] font-bold text-content-muted">
                    Group
                    <input className={inputClass} placeholder="e.g. Mentor" value={groupName} onChange={(e) => setGroupName(e.target.value)} disabled={!canEdit} autoFocus />
                  </label>
                  <label className="flex flex-col gap-1 text-[10.5px] font-bold text-content-muted">
                    Owner Department
                    <CustomSelect theme={theme} value={ownerDepartmentId} onChange={setOwnerDepartmentId} triggerClassName={selectTriggerClass} options={departmentOptions} disabled={!canEdit} />
                  </label>
                  <label className="flex flex-col gap-1 text-[10.5px] font-bold text-content-muted">
                    Group Tier
                    <CustomSelect
                      theme={theme}
                      value={groupTier}
                      onChange={(v) => setGroupTier(v as "General" | "Admin" | "Platform Admin")}
                      triggerClassName={selectTriggerClass}
                      options={[
                        { value: "General", label: "General" },
                        { value: "Admin", label: "Admin" },
                        { value: "Platform Admin", label: "Platform Admin" },
                      ]}
                      disabled={!canEdit}
                    />
                  </label>
                </div>
                <p className={`text-[10.5px] mt-1.5 ${dark ? "text-stone-500" : "text-stone-400"}`}>
                  Owner Department narrows who's eligible to be picked as this group's Owner below — e.g. a "Mentor" group linked to "Mentor Excellence"
                  only lets you pick a Mentor Excellence member as the owner.
                </p>
                <p className={`text-[10.5px] mt-1.5 ${dark ? "text-stone-500" : "text-stone-400"}`}>
                  Group Tier controls which tier of member this group's Access restriction (Step 3) applies to — e.g. leaving this at "General" (the
                  default) restricts this group's General-tier members exactly as before; setting it to "Admin" instead restricts its Admin-tier members,
                  and leaves General-tier members in this group completely unaffected. This has no effect on the group's Owner — it never changes anyone's
                  own tier or permissions, only which tier of member the restriction below targets.
                </p>
              </SectionCard>

              <SectionCard
                title="Ownership"
                icon={<Users2 className="w-3.5 h-3.5" />}
                disabledNote={mode === "create" && !group ? "Owner becomes selectable once this group is created — click Next below." : undefined}
              >
                {(group || mode === "create") && (
                  <div className="space-y-2">
                    {distinctOwners.length > 1 && (
                      <p className={`flex items-start gap-1.5 text-[10.5px] font-semibold px-2.5 py-2 rounded-lg border ${dark ? "bg-amber-500/10 border-amber-500/25 text-amber-400" : "bg-amber-50 border-amber-200 text-amber-700"}`}>
                        <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                        This group currently has members under {distinctOwners.length} different owners: {distinctOwners.map((o) => nameFor(o) || o).join(", ")}.
                        Saving moves everyone under whichever owner is selected here.
                      </p>
                    )}
                    {ownerClearedByDepartmentChange && (
                      <p className={`flex items-start gap-1.5 text-[10.5px] font-semibold px-2.5 py-2 rounded-lg border ${dark ? "bg-amber-500/10 border-amber-500/25 text-amber-400" : "bg-amber-50 border-amber-200 text-amber-700"}`}>
                        <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                        The previously selected Owner isn't in this Owner Department, so it's been cleared — select a new Owner before continuing.
                      </p>
                    )}
                    <label className="flex flex-col gap-1 text-[10.5px] font-bold text-content-muted max-w-sm">
                      Owner
                      <CustomSelect
                        theme={theme}
                        value={selectedOwnerEmail}
                        onChange={(v) => {
                          setSelectedOwnerEmail(v);
                          setOwnerClearedByDepartmentChange(false);
                        }}
                        triggerClassName={selectTriggerClass}
                        disabled={!canEdit || !group}
                        options={[{ value: "", label: "Select an owner..." }, ...ownerPool.map((u) => ({ value: u.email, label: u.name }))]}
                        searchable
                        searchPlaceholder="Search people…"
                      />
                    </label>
                    {group && (
                      <p className={`text-[10.5px] flex items-center gap-1.5 ${dark ? "text-stone-500" : "text-stone-400"}`}>
                        <ArrowRightLeft className="w-3 h-3 shrink-0" />
                        Changing Owner and clicking Next moves every existing member onto the new owner in one step.
                      </p>
                    )}
                  </div>
                )}
              </SectionCard>
            </>
          )}

          {/* ── STEP 2 — Audience & Members ─────────────────────────── */}
          {step === 2 && (
            <>
              <SectionCard
                title="Target Filters"
                icon={<Filter className="w-3.5 h-3.5" />}
                disabledNote={!group ? "Create the group first — go back to Step 1." : undefined}
              >
                {group && (
                  <>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                      <CustomSelect theme={theme} value={filterOrgTeamId} onChange={handleFilterOrgTeamChange} triggerClassName={selectTriggerClass} options={[{ value: "", label: "All Business Units" }, ...filterOrgTeamOptions.map((t) => ({ value: String(t.id), label: t.name }))]} />
                      <CustomSelect theme={theme} value={filterDepartmentId} onChange={handleFilterDepartmentChange} triggerClassName={selectTriggerClass} options={[{ value: "", label: "All Departments" }, ...filterDepartmentOptions.map((d) => ({ value: String(d.id), label: d.name }))]} />
                      <CustomSelect theme={theme} value={filterRoleId} onChange={setFilterRoleId} triggerClassName={selectTriggerClass} options={[{ value: "", label: "All Roles" }, ...filterRoleOptions.map((r) => ({ value: String(r.id), label: r.name }))]} />
                    </div>
                    <p className={`text-[10.5px] mt-1.5 ${dark ? "text-stone-500" : "text-stone-400"}`}>
                      Only narrows who's shown in Members below — this never adds, removes, or auto-manages membership on its own.
                    </p>
                  </>
                )}
              </SectionCard>

              <SectionCard
                title="Members"
                icon={<Users2 className="w-3.5 h-3.5" />}
                disabledNote={!group ? "Create the group first — go back to Step 1." : !selectedOwnerEmail ? "Select an Owner on Step 1 first — every member is mapped to that owner." : undefined}
              >
                {group && selectedOwnerEmail && (
                  <div className="space-y-4">
                    {/* Existing members */}
                    <div>
                      <div className="flex items-center justify-between gap-2 mb-1.5">
                        <span className={`text-[10.5px] font-bold uppercase tracking-wider ${dark ? "text-stone-400" : "text-stone-500"}`}>
                          Current members ({groupMappings.length})
                        </span>
                        {canEdit && groupMappings.length > 0 && (
                          <ClippedButton
                            onClick={removeSelectedMembers}
                            disabled={removingMembers || selectedExistingIds.size === 0}
                            cornerBg={dark ? "#12151A" : "#ffffff"}
                            className="flex items-center gap-1.5 text-[10px] font-mono font-bold uppercase tracking-[0.15em] px-2.5 py-1.5 border bg-red-600 hover:bg-red-700 text-white disabled:opacity-50"
                          >
                            <Trash2 className="w-3 h-3" />
                            Remove Selected ({selectedExistingIds.size})
                          </ClippedButton>
                        )}
                      </div>
                      {groupMappings.length === 0 ? (
                        <p className={`px-2.5 py-3 text-[11px] font-semibold rounded-lg border ${dark ? "text-stone-500 border-stone-850" : "text-stone-400 border-stone-200"}`}>No members yet.</p>
                      ) : (
                        <div className={`rounded-lg border overflow-hidden max-h-[150px] overflow-y-auto ${dark ? "border-stone-850" : "border-stone-200"}`}>
                          <div className={rowClass}>
                            {canEdit && (
                              <button type="button" onClick={toggleSelectAllExisting} className="flex items-center justify-center shrink-0 cursor-pointer">
                                {allExistingSelected ? <CheckSquare className={`w-4 h-4 ${dark ? "text-sky-400" : "text-sky-600"}`} /> : <Square className={`w-4 h-4 ${dark ? "text-stone-600" : "text-stone-400"}`} />}
                              </button>
                            )}
                            <span className={`font-black uppercase tracking-wide text-[10px] ${dark ? "text-stone-500" : "text-stone-400"}`}>Select all</span>
                          </div>
                          {groupMappings.map((m) => (
                            <label key={m.id} className={`${rowClass} cursor-pointer select-none ${dark ? "hover:bg-white/[0.03]" : "hover:bg-stone-50"}`}>
                              {canEdit && (
                                <input type="checkbox" checked={selectedExistingIds.has(m.id)} onChange={() => toggleExistingSelected(m.id)} className="w-3.5 h-3.5 accent-sky-500 shrink-0" />
                              )}
                              <span className={`font-bold ${dark ? "text-white" : "text-stone-900"}`}>{nameFor(m.subjectEmail) || m.subjectEmail}</span>
                              <span className={dark ? "text-stone-500" : "text-stone-400"}>{m.subjectEmail}</span>
                            </label>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Add members */}
                    {canEdit && (
                      <div>
                        <div className="flex items-center justify-between gap-2 mb-1.5">
                          <span className={`text-[10.5px] font-bold uppercase tracking-wider ${dark ? "text-stone-400" : "text-stone-500"}`}>
                            Add members {candidatePool.length > 0 ? `(${candidatePool.length} match${candidatePool.length === 1 ? "" : "es"})` : ""}
                          </span>
                          <ClippedButton
                            onClick={addSelectedMembers}
                            disabled={addingMembers || selectedCandidateEmails.size === 0}
                            cornerBg={dark ? "#12151A" : "#ffffff"}
                            style={{ backgroundColor: "var(--action-navy)", borderColor: "var(--action-navy)", color: "var(--on-action-navy)" }}
                            className="flex items-center gap-1.5 text-[10px] font-mono font-bold uppercase tracking-[0.15em] px-2.5 py-1.5 border hover:brightness-110 disabled:opacity-50"
                          >
                            <Plus className="w-3 h-3" />
                            Add Selected ({selectedCandidateEmails.size})
                          </ClippedButton>
                        </div>
                        <div className="relative mb-1.5">
                          <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-content-faint pointer-events-none" />
                          <input
                            type="text"
                            value={memberSearch}
                            onChange={(e) => setMemberSearch(e.target.value)}
                            placeholder="Refine by name, email, or Tact ID (optional)…"
                            className={`w-full pl-7 pr-2.5 py-1.5 rounded-lg border text-[11px] font-semibold outline-none ${dark ? "bg-[#060a12] border-stone-850 text-white focus:border-sky-500" : "bg-white border-stone-200 text-stone-900 focus:border-sky-400"}`}
                          />
                        </div>
                        {candidatePool.length === 0 ? (
                          <p className={`px-2.5 py-3 text-[11px] font-semibold rounded-lg border ${dark ? "text-stone-500 border-stone-850" : "text-stone-400 border-stone-200"}`}>
                            No matching users — adjust the Target Filters above.
                          </p>
                        ) : (
                          <div className={`rounded-lg border overflow-hidden max-h-[150px] overflow-y-auto ${dark ? "border-stone-850" : "border-stone-200"}`}>
                            <div className={rowClass}>
                              <button type="button" onClick={toggleSelectAllVisibleCandidates} className="flex items-center justify-center shrink-0 cursor-pointer">
                                {allVisibleCandidatesSelected ? <CheckSquare className={`w-4 h-4 ${dark ? "text-sky-400" : "text-sky-600"}`} /> : <Square className={`w-4 h-4 ${dark ? "text-stone-600" : "text-stone-400"}`} />}
                              </button>
                              <span className={`font-black uppercase tracking-wide text-[10px] ${dark ? "text-stone-500" : "text-stone-400"}`}>
                                Select all visible ({visibleCandidates.length}{candidatePool.length > MAX_CANDIDATE_ROWS ? ` of ${candidatePool.length}` : ""})
                              </span>
                            </div>
                            {visibleCandidates.map((u) => (
                              <label key={u.email} className={`${rowClass} cursor-pointer select-none ${dark ? "hover:bg-white/[0.03]" : "hover:bg-stone-50"}`}>
                                <input type="checkbox" checked={selectedCandidateEmails.has(u.email)} onChange={() => toggleCandidateSelected(u.email)} className="w-3.5 h-3.5 accent-sky-500 shrink-0" />
                                <span className={`font-bold ${dark ? "text-white" : "text-stone-900"}`}>{u.name}</span>
                                <span className={dark ? "text-stone-500" : "text-stone-400"}>{u.email}</span>
                              </label>
                            ))}
                            {candidatePool.length > MAX_CANDIDATE_ROWS && (
                              <p className={`px-2.5 py-1.5 text-[10.5px] font-semibold ${dark ? "text-stone-500" : "text-stone-400"}`}>
                                Showing the first {MAX_CANDIDATE_ROWS} of {candidatePool.length} matches — narrow the Target Filters or search to find more.
                              </p>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </SectionCard>
            </>
          )}

          {/* ── STEP 3 — Access ──────────────────────────────────────── */}
          {step === 3 && (
            <>
              <SectionCard title="Access" icon={<Tags className="w-3.5 h-3.5" />} disabledNote={!group ? "Create the group first — go back to Step 1." : undefined}>
                {group && (
                  <div className="space-y-3">
                    <p className={`text-[10.5px] font-semibold max-w-2xl ${dark ? "text-stone-500" : "text-stone-400"}`}>
                      Check every tool this group's <strong>{groupTier}</strong>-tier members should have access to, regardless of their tier's
                      normal defaults; everything left unchecked becomes invisible to them. Leaving every tool unchecked removes this group's access
                      restriction entirely (members fall back to their tier's normal defaults). This list follows the Group Tier selected on Step 1 —
                      change it there to configure a different tier's tools instead.
                    </p>
                    {restrictableTools.length === 0 ? (
                      <p className={`px-2.5 py-3 text-[11px] font-semibold rounded-lg border ${dark ? "text-stone-500 border-stone-850" : "text-stone-400 border-stone-200"}`}>
                        No tools are applicable to the {groupTier} tier.
                      </p>
                    ) : (
                      <>
                        <label className={`flex items-center gap-2 px-3 py-1.5 -mb-1 cursor-pointer select-none ${!canEdit ? "opacity-70 pointer-events-none" : ""}`}>
                          <input
                            ref={selectAllRef}
                            type="checkbox"
                            checked={allDisplayedChecked}
                            onChange={toggleSelectAllTools}
                            disabled={!canEdit}
                            className="w-3.5 h-3.5 accent-sky-500"
                          />
                          <span className={`text-[10px] font-black uppercase tracking-wide ${dark ? "text-stone-400" : "text-stone-500"}`}>
                            Select All ({checkedDisplayedCount}/{restrictableToolIds.length})
                          </span>
                        </label>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          {restrictableTools.map((tool) => (
                            <label key={tool.id} className={`flex items-center gap-2 px-3 py-2 rounded-lg border cursor-pointer select-none ${dark ? "border-stone-850 bg-white/[0.02] hover:bg-white/[0.04]" : "border-stone-200 bg-white hover:bg-stone-50"} ${!canEdit ? "opacity-70 pointer-events-none" : ""}`}>
                              <input type="checkbox" checked={draftFeatureIds.includes(tool.id)} onChange={() => toggleFeature(tool.id)} disabled={!canEdit} className="w-3.5 h-3.5 accent-sky-500" />
                              <span className={`text-[11px] font-bold ${dark ? "text-white" : "text-stone-900"}`}>{tool.name}</span>
                            </label>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                )}
              </SectionCard>

              <SectionCard title="Status" icon={<Power className="w-3.5 h-3.5" />} disabledNote={!group ? "Create the group first — go back to Step 1." : undefined}>
                {group && (
                  <div className="space-y-2">
                    <div className="flex items-center gap-3">
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
                    {!group.active && group.usedForGroupAccess && (
                      <div className={`flex items-start gap-2 px-3 py-2.5 rounded-lg border text-[11px] font-bold ${dark ? "bg-amber-500/10 border-amber-500/25 text-amber-400" : "bg-amber-50 border-amber-200 text-amber-700"}`}>
                        <Power className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                        <span>
                          This group is disabled, so its tool restriction is currently suspended — its members have their normal tier access. Reactivate
                          to enforce it again; nothing above needs to be reconfigured.
                        </span>
                      </div>
                    )}
                    <p className={`text-[10.5px] ${dark ? "text-stone-500" : "text-stone-400"}`}>
                      Deactivating never removes this group's members or its configured tool access — reactivating restores exactly what was configured.
                    </p>
                  </div>
                )}
              </SectionCard>
            </>
          )}
        </div>

        <div className={`px-5 py-3 border-t flex items-center justify-between gap-2 shrink-0 ${dark ? "border-stone-800" : "border-stone-200"}`}>
          <ClippedButton size="md" onClick={onClose} className={dark ? "bg-white/[0.06] text-stone-300 px-4 py-2 text-[11px] font-black uppercase tracking-wider" : "bg-stone-100 text-stone-600 px-4 py-2 text-[11px] font-black uppercase tracking-wider"}>
            Close
          </ClippedButton>

          <div className="flex items-center gap-2">
            {step > 1 && (
              <ClippedButton
                onClick={() => setStep((s) => (s - 1) as WizardStep)}
                cornerBg={dark ? "#12151A" : "#ffffff"}
                className={`flex items-center gap-1.5 text-[10px] font-mono font-bold uppercase tracking-[0.15em] px-3 py-2 border ${dark ? "border-stone-700 text-stone-300 hover:bg-white/[0.04]" : "border-stone-300 text-stone-600 hover:bg-stone-50"}`}
              >
                <ArrowLeft className="w-3.5 h-3.5 shrink-0" />
                Back
              </ClippedButton>
            )}

            {step === 1 && (
              <ClippedButton
                onClick={goNextFromStep1}
                disabled={savingGroup}
                cornerBg={dark ? "#12151A" : "#ffffff"}
                style={{ backgroundColor: "var(--action-navy)", borderColor: "var(--action-navy)", color: "var(--on-action-navy)" }}
                className="flex items-center gap-1.5 text-[10px] font-mono font-bold uppercase tracking-[0.15em] px-3 py-2 border hover:brightness-110 disabled:opacity-50"
              >
                {savingGroup ? "Saving..." : "Next"}
                {!savingGroup && <ArrowRight className="w-3.5 h-3.5 shrink-0" />}
              </ClippedButton>
            )}

            {step === 2 && (
              <ClippedButton
                onClick={() => setStep(3)}
                cornerBg={dark ? "#12151A" : "#ffffff"}
                style={{ backgroundColor: "var(--action-navy)", borderColor: "var(--action-navy)", color: "var(--on-action-navy)" }}
                className="flex items-center gap-1.5 text-[10px] font-mono font-bold uppercase tracking-[0.15em] px-3 py-2 border hover:brightness-110 disabled:opacity-50"
              >
                Next
                <ArrowRight className="w-3.5 h-3.5 shrink-0" />
              </ClippedButton>
            )}

            {step === 3 && canEdit && (
              <ClippedButton
                onClick={saveAccessAndFinish}
                disabled={savingAccess}
                cornerBg={dark ? "#12151A" : "#ffffff"}
                style={{ backgroundColor: "var(--action-navy)", borderColor: "var(--action-navy)", color: "var(--on-action-navy)" }}
                className="flex items-center gap-1.5 text-[10px] font-mono font-bold uppercase tracking-[0.15em] px-3 py-2 border hover:brightness-110 disabled:opacity-50"
              >
                <Save className="w-3.5 h-3.5 shrink-0" />
                {savingAccess ? "Saving..." : "Save Group"}
              </ClippedButton>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
