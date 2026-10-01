/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Fragment, useEffect, useMemo, useState } from "react";
import { Pencil, Save, X, AlertTriangle, RefreshCw, Search, Users2, History, Trash2 } from "lucide-react";
import {
  GuideMentorAdvisorMapping,
  GuideMentorAdvisorMappingSyncResult,
  GuideMentorRelationshipHistoryRow,
  GuideMentorRelationshipHistoryResponse,
  Department,
} from "../types/permissions";
import { UserProfile } from "../types/user";
import { ClippedButton } from "./ClippedButton";
import { CustomSelect } from "./CustomSelect";
import { DateInputDMY } from "./DateInputDMY";
import { useDialog } from "../hooks/useDialog";

interface MasterAdvisorsManagementProps {
  theme: "light" | "dark";
  effectiveTier: "General" | "Admin" | "Platform Admin" | "Developer";
  /** For resolving a mapping's owner/subject email into a display name —
   * best-effort, same caveat as every other tab that reads App.tsx's
   * usersList cache. */
  usersList: UserProfile[];
  /** Source of truth for the Guide/Mentor dropdown options below (members
   * of the "Guide"/"Mentor Excellence" departments). */
  departments: Department[];
  logAction: (actionType: string, description: string) => void;
  /** True when App.tsx's hasAccess("master_advisors", "Editor") passes —
   * Platform Admin/Developer always, plus anyone else holding an explicit
   * Custom Grant for it. Threaded down (2026-09 permission-architecture fix)
   * so this tab's edit/delete gate respects a Custom Grant instead of only
   * ever checking tier — same pattern as GroupsManagement's
   * canManageGroups. */
  canManage: boolean;
}

/**
 * "Master Advisors" — originally split out of Access Control Center's
 * Relationships tab into its own top-level sidebar page (2026-09), then
 * moved back into the Access Control Center as one of its tabs (also
 * 2026-09, Organization/Master Advisors consolidation) — see
 * ProfileAccessPage.tsx, which now renders this component directly under
 * its "Master Advisors" sub-tab instead of a dedicated MasterAdvisorsPage
 * wrapper. This is every advisor's real Guide/Mentor assignment plus their
 * own Tact ID/status/employment/skill-domain snapshot, grouped under the
 * Guide or Mentor's name — populated by a manual sync of the same
 * master_advisors sheet the Connections page's Advisor Directory Sync
 * already reads (see guideMentorRelationshipsSync.ts), editable by hand in
 * between syncs.
 *
 * Both moves are pure UI relocations: the sync route
 * (/api/relationship-mappings/guide-mentor-advisors*) and the underlying
 * `guide_mentor_advisor_mappings`/`guide_mentor_relationship_history`
 * tables are completely unchanged, so QA Dashboard and Team Tracker — both
 * of which read those same tables directly via qaDataEngine.ts, not
 * through this component — are unaffected either time.
 */
export function MasterAdvisorsManagement({ theme, effectiveTier, usersList, departments, logAction, canManage }: MasterAdvisorsManagementProps) {
  const dark = theme === "dark";
  const { confirm } = useDialog();
  // Corrected 2026-09 (permission architecture fix): this used to hardcode
  // canEdit to Developer/Platform Admin only, which silently ignored the
  // "master_advisors" featurePermissions entry's Editor level and any
  // Custom Grant for it — Admin could never manage mappings no matter what
  // the Permissions tab or Custom Grants said. Now delegates to the same
  // centralized evaluator every other governed feature uses.
  const canEdit = canManage;

  const [advisorMappings, setAdvisorMappings] = useState<GuideMentorAdvisorMapping[]>([]);
  const [advisorMappingsLoading, setAdvisorMappingsLoading] = useState(true);
  const [lastSyncResult, setLastSyncResult] = useState<GuideMentorAdvisorMappingSyncResult | null>(null);
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const loadAdvisorMappings = async () => {
    setAdvisorMappingsLoading(true);
    try {
      const [entriesRes, lastRunRes] = await Promise.all([
        fetch("/api/relationship-mappings/guide-mentor-advisors"),
        fetch("/api/relationship-mappings/guide-mentor-advisors/last-run"),
      ]);
      const entriesBody = await entriesRes.json().catch(() => ({}));
      const lastRunBody = await lastRunRes.json().catch(() => ({}));
      if (entriesRes.ok) setAdvisorMappings(entriesBody.entries || []);
      if (lastRunRes.ok) {
        setLastSyncResult(lastRunBody.result || null);
        setLastSyncAt(lastRunBody.syncedAt || null);
      }
    } catch (_) {
      // Best-effort — leaves whatever was last successfully loaded.
    } finally {
      setAdvisorMappingsLoading(false);
    }
  };

  useEffect(() => {
    loadAdvisorMappings();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const runAdvisorMappingSync = async () => {
    setSyncing(true);
    setSyncError(null);
    try {
      const res = await fetch("/api/relationship-mappings/guide-mentor-advisors/sync", { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Sync failed (HTTP ${res.status}).`);
      logAction(
        "Guide/Mentor Advisor Mappings Synced",
        `Guide/Mentor Advisor Mapping Sync: ${body.mappingsWritten} mapped, ${body.withGuide} Guide only, ${body.withMentor} Mentor only, ${body.withBoth} both, ${body.withNeither} neither.`
      );
      await loadAdvisorMappings();
    } catch (err: any) {
      setSyncError(err.message || "Sync failed.");
    } finally {
      setSyncing(false);
    }
  };

  const [advisorMappingSearch, setAdvisorMappingSearch] = useState("");
  // "All" (unmapped pushed to the bottom, see filteredAdvisorMappings),
  // "By Guide"/"By Mentor" (reveal a multi-select chip picker to narrow to
  // one or more specific Guides'/Mentors' own advisors), "Unmapped"
  // (advisors with neither a Guide nor a Mentor at all).
  const [filterView, setFilterView] = useState<"all" | "guide" | "mentor" | "unmapped">("all");
  const [selectedGuideFilters, setSelectedGuideFilters] = useState<string[]>([]);
  const [selectedMentorFilters, setSelectedMentorFilters] = useState<string[]>([]);
  // Table-level Status filter — independent of, and applied on top of,
  // filterView (e.g. "By Guide" + "Resigned" together).
  const [selectedStatusFilter, setSelectedStatusFilter] = useState("");
  const [editingMappingId, setEditingMappingId] = useState<number | null>(null);
  const [draftMapping, setDraftMapping] = useState<{
    name: string;
    guideName: string;
    mentorName: string;
    status: string;
    skillDomain: string;
    batchNumber: string;
    // Single editable "Active Till" date rather than the two separate
    // sheet-sourced dates it's computed from (see activeTillOf) — editing
    // used to show both dateOfMovingOut and lastWorkingDay as two stacked
    // date pickers, which read as a duplicated/buggy control since nothing
    // in the UI distinguished them. Saving writes this into
    // dateOfMovingOut and clears lastWorkingDay, so the single value the
    // person edits is guaranteed to be the one "Active Till" reflects.
    activeTill: string;
    // Effective date for a Mentor/Guide CHANGE recorded on save (only sent
    // to the server, and only meaningful, when the respective field's
    // value actually differs from what was loaded — see the Mentor/Guide
    // table cells below). Defaults to today; editable, per this feature's
    // "Editable effective date" design choice — see
    // guide_mentor_relationship_history's schema.ts comment for why this
    // is a different concept from "activeTill" above.
    guideEffectiveDate: string;
    mentorEffectiveDate: string;
  }>({ name: "", guideName: "", mentorName: "", status: "", skillDomain: "", batchNumber: "", activeTill: "", guideEffectiveDate: "", mentorEffectiveDate: "" });

  const startEditMapping = (m: GuideMentorAdvisorMapping) => {
    setEditingMappingId(m.id);
    setDraftMapping({
      name: m.name,
      guideName: m.guideName || "",
      mentorName: m.mentorName || "",
      status: m.status || "",
      skillDomain: m.skillDomain || "",
      batchNumber: m.batchNumber || "",
      activeTill: activeTillOf(m) || "",
      guideEffectiveDate: todayIso(),
      mentorEffectiveDate: todayIso(),
    });
    setSyncError(null);
  };
  const cancelEditMapping = () => setEditingMappingId(null);

  const saveEditMapping = async (m: GuideMentorAdvisorMapping) => {
    if (!draftMapping.name.trim()) {
      setSyncError("Name cannot be empty.");
      return;
    }
    setSaving(true);
    setSyncError(null);
    try {
      const guideChanged = draftMapping.guideName.trim() !== (m.guideName || "").trim();
      const mentorChanged = draftMapping.mentorName.trim() !== (m.mentorName || "").trim();
      const res = await fetch(`/api/relationship-mappings/guide-mentor-advisors/${m.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: draftMapping.name.trim(),
          guideName: draftMapping.guideName.trim() || null,
          mentorName: draftMapping.mentorName.trim() || null,
          status: draftMapping.status.trim() || null,
          skillDomain: draftMapping.skillDomain.trim() || null,
          batchNumber: draftMapping.batchNumber.trim() || null,
          dateOfMovingOut: draftMapping.activeTill.trim() || null,
          lastWorkingDay: null,
          ...(guideChanged ? { guideEffectiveDate: draftMapping.guideEffectiveDate || todayIso() } : {}),
          ...(mentorChanged ? { mentorEffectiveDate: draftMapping.mentorEffectiveDate || todayIso() } : {}),
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Failed to save changes (HTTP ${res.status}).`);
      logAction("Guide/Mentor Advisor Mapping Edited", `Edited the Guide/Mentor mapping for "${m.name}" (Tact ID ${m.tactId}).`);
      setEditingMappingId(null);
      // A saved Mentor/Guide change invalidates any cached history for
      // this advisor so the History panel refetches instead of showing a
      // stale timeline if reopened.
      if (guideChanged || mentorChanged) {
        setHistoryByMappingId((prev) => {
          const next = { ...prev };
          delete next[m.id];
          return next;
        });
      }
      await loadAdvisorMappings();
    } catch (err: any) {
      setSyncError(err.message || "Failed to save changes.");
    } finally {
      setSaving(false);
    }
  };

  const deleteAdvisorMapping = async (m: GuideMentorAdvisorMapping) => {
    if (!(await confirm(`Remove the mapping for ${m.name} (Tact ID ${m.tactId})?`))) return;
    setSaving(true);
    setSyncError(null);
    try {
      const res = await fetch(`/api/relationship-mappings/guide-mentor-advisors/${m.id}`, { method: "DELETE" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Failed to remove this mapping (HTTP ${res.status}).`);
      logAction("Guide/Mentor Advisor Mapping Removed", `Removed the Guide/Mentor mapping for "${m.name}" (Tact ID ${m.tactId}).`);
      await loadAdvisorMappings();
    } catch (err: any) {
      setSyncError(err.message || "Failed to remove this mapping.");
    } finally {
      setSaving(false);
    }
  };

  // ── Per-advisor Mentor/Guide relationship history (2026-09) — fetched on
  // demand when a row's History toggle is opened, cached by mapping id so
  // re-opening doesn't re-fetch. See guide_mentor_relationship_history's
  // schema.ts comment; the panel itself is rendered further down. ───────
  const todayIso = () => new Date().toISOString().slice(0, 10);
  const [historyOpenId, setHistoryOpenId] = useState<number | null>(null);
  const [historyByMappingId, setHistoryByMappingId] = useState<Record<number, GuideMentorRelationshipHistoryResponse>>({});
  const [historyLoadingId, setHistoryLoadingId] = useState<number | null>(null);

  const toggleHistory = async (m: GuideMentorAdvisorMapping) => {
    if (historyOpenId === m.id) {
      setHistoryOpenId(null);
      return;
    }
    setHistoryOpenId(m.id);
    if (historyByMappingId[m.id]) return;
    setHistoryLoadingId(m.id);
    try {
      const res = await fetch(`/api/relationship-mappings/guide-mentor-advisors/${m.id}/history`);
      const body = await res.json().catch(() => ({}));
      if (res.ok) setHistoryByMappingId((prev) => ({ ...prev, [m.id]: { guide: body.guide || [], mentor: body.mentor || [] } }));
    } catch (_) {
      // Best-effort — the panel simply shows nothing if this fails.
    } finally {
      setHistoryLoadingId(null);
    }
  };

  /** Renders one advisor's Guide or Mentor timeline (newest first, as
   * returned by the API) as a small list of assignment chips — "Active"/
   * "Ended" badge, the person, and the date range. Used inside the
   * expandable History row below the table. */
  const renderHistoryTimeline = (label: "Mentor" | "Guide", rows: GuideMentorRelationshipHistoryRow[]) => (
    <div>
      <p className={`text-[10px] font-black uppercase tracking-wider mb-1.5 ${dark ? "text-stone-400" : "text-stone-500"}`}>{label} history</p>
      {rows.length === 0 ? (
        <p className={`text-[10.5px] font-semibold ${dark ? "text-stone-500" : "text-stone-400"}`}>No {label.toLowerCase()} changes recorded yet.</p>
      ) : (
        <ul className="space-y-1.5">
          {rows.map((r) => (
            <li
              key={r.id}
              className={`flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-[11px] px-2.5 py-1.5 rounded-lg border ${
                dark ? "border-stone-800 bg-white/[0.02]" : "border-stone-200 bg-white"
              }`}
            >
              <span className={`font-bold ${dark ? "text-white" : "text-stone-900"}`}>{r.personName}</span>
              <span className="flex items-center gap-1.5 whitespace-nowrap">
                <span
                  className={`px-1.5 py-0.5 rounded text-[8.5px] font-black uppercase border ${
                    r.isActive
                      ? dark
                        ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30"
                        : "bg-emerald-50 text-emerald-700 border-emerald-200"
                      : dark
                        ? "bg-stone-500/15 text-stone-400 border-stone-500/30"
                        : "bg-stone-100 text-stone-500 border-stone-200"
                  }`}
                >
                  {r.isActive ? "Active" : "Ended"}
                </span>
                <span className={dark ? "text-stone-400" : "text-stone-500"}>
                  {formatActiveTill(r.startDate)} – {r.endDate ? formatActiveTill(r.endDate) : "present"}
                </span>
                <span className={`text-[9px] uppercase font-bold ${dark ? "text-stone-600" : "text-stone-400"}`} title={`Recorded by ${r.recordedBy}`}>
                  {r.source === "sync" ? "Synced" : "Manual"}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );

  /** True when an advisor has neither a Guide nor a Mentor assigned. */
  const isUnmappedAdvisor = (m: GuideMentorAdvisorMapping) => !(m.guideName || "").trim() && !(m.mentorName || "").trim();

  /** The earlier of dateOfMovingOut/lastWorkingDay — the point past which
   * this advisor is no longer considered active (see schema.ts's table
   * comment). Both are "yyyy-MM-dd", so a plain string comparison is a
   * correct chronological one. */
  const activeTillOf = (m: GuideMentorAdvisorMapping): string | null => {
    const dates = [m.dateOfMovingOut, m.lastWorkingDay].filter((d): d is string => !!d);
    if (dates.length === 0) return null;
    return dates.sort()[0];
  };
  const formatActiveTill = (iso: string) => {
    const [y, mo, d] = iso.split("-").map(Number);
    if (!y || !mo || !d) return iso;
    return new Date(Date.UTC(y, mo - 1, d)).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });
  };

  const guideFilterOptions = useMemo(
    () => Array.from(new Set(advisorMappings.map((m) => (m.guideName || "").trim()).filter(Boolean))).sort(),
    [advisorMappings]
  );
  const mentorFilterOptions = useMemo(
    () => Array.from(new Set(advisorMappings.map((m) => (m.mentorName || "").trim()).filter(Boolean))).sort(),
    [advisorMappings]
  );
  const statusFilterOptions = useMemo(
    () => Array.from(new Set(advisorMappings.map((m) => (m.status || "").trim()).filter(Boolean))).sort(),
    [advisorMappings]
  );
  const productOptions = useMemo(
    () => Array.from(new Set(advisorMappings.map((m) => (m.skillDomain || "").trim()).filter(Boolean))).sort(),
    [advisorMappings]
  );

  // Guide/Mentor edit dropdowns (Mentor/Product/Status/Guide should be
  // fixed selections, not free text) are sourced from department
  // membership rather than the sheet sync, so the list grows automatically
  // as people are added to these departments on the Directory tab — see
  // this component's own doc comment and DepartmentsManagement.tsx.
  const guideDept = useMemo(() => departments.find((d) => d.name.trim().toLowerCase() === "guide"), [departments]);
  const mentorDept = useMemo(() => departments.find((d) => d.name.trim().toLowerCase() === "mentor excellence"), [departments]);
  // The QA data dump's own Guide column only ever carries a first name
  // (e.g. "Mehruf", never "Mehruf Patel") — matching that convention here
  // so a selection made from this dropdown reads the same as the synced
  // sheet data instead of introducing a second, incompatible format.
  const firstNameOf = (fullName: string) => fullName.trim().split(/\s+/)[0] || fullName;
  const guideDeptOptions = useMemo(
    () => (guideDept ? Array.from(new Set(usersList.filter((u) => u.departmentId === guideDept.id).map((u) => firstNameOf(u.name)))).sort() : []),
    [usersList, guideDept]
  );
  const mentorDeptOptions = useMemo(
    () => (mentorDept ? Array.from(new Set(usersList.filter((u) => u.departmentId === mentorDept.id).map((u) => u.name.trim()))).sort() : []),
    [usersList, mentorDept]
  );
  // Department membership is usually sparse (few people have actually been
  // added to the "Guide"/"Mentor Excellence" departments on the Directory
  // tab), so using *DeptOptions alone left these dropdowns showing almost
  // nobody even though the sheet sync already carries hundreds of distinct
  // Guide/Mentor names (see guideFilterOptions/mentorFilterOptions above,
  // the same data source the "By Guide"/"By Mentor" filter chips use).
  // Union the two so every name already in use across the roster is
  // selectable, while department membership still keeps growing this list
  // automatically as people are added there per this component's own doc
  // comment.
  const guideOptionsUnion = useMemo(
    () => Array.from(new Set([...guideDeptOptions, ...guideFilterOptions])).sort(),
    [guideDeptOptions, guideFilterOptions]
  );
  const mentorOptionsUnion = useMemo(
    () => Array.from(new Set([...mentorDeptOptions, ...mentorFilterOptions])).sort(),
    [mentorDeptOptions, mentorFilterOptions]
  );
  /** Keeps a row's already-saved value selectable even if it doesn't (or no
   * longer) match a department member — e.g. sheet-synced data from before
   * departments existed, or someone who's since left the department. */
  const withCurrentValueFallback = (base: string[], current: string) =>
    current.trim() && !base.includes(current.trim()) ? [...base, current.trim()].sort() : base;

  const toggleGuideFilter = (name: string) =>
    setSelectedGuideFilters((prev) => (prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name]));
  const toggleMentorFilter = (name: string) =>
    setSelectedMentorFilters((prev) => (prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name]));

  const viewFilteredMappings = useMemo(() => {
    let base: GuideMentorAdvisorMapping[];
    switch (filterView) {
      case "guide":
        base = selectedGuideFilters.length > 0 ? advisorMappings.filter((m) => selectedGuideFilters.includes((m.guideName || "").trim())) : [];
        break;
      case "mentor":
        base = selectedMentorFilters.length > 0 ? advisorMappings.filter((m) => selectedMentorFilters.includes((m.mentorName || "").trim())) : [];
        break;
      case "unmapped":
        base = advisorMappings.filter(isUnmappedAdvisor);
        break;
      default:
        base = advisorMappings;
    }
    // Table-level Status filter — an additional narrowing applied on top
    // of whichever filterView is active (e.g. "By Guide" + "Resigned").
    return selectedStatusFilter ? base.filter((m) => (m.status || "").trim() === selectedStatusFilter) : base;
  }, [advisorMappings, filterView, selectedGuideFilters, selectedMentorFilters, selectedStatusFilter]);

  const filteredAdvisorMappings = useMemo(() => {
    const q = advisorMappingSearch.trim().toLowerCase();
    const base = q
      ? viewFilteredMappings.filter((m) =>
          [m.name, m.tactId, m.email, m.guideName, m.mentorName, m.status, m.skillDomain, m.batchNumber].some((v) => (v || "").toLowerCase().includes(q))
        )
      : viewFilteredMappings;
    // Unmapped advisors sort to the bottom — meaningful in "All" (a mixed
    // list); a no-op in the other views, which are already homogeneous.
    return [...base].sort((a, b) => {
      const aUn = isUnmappedAdvisor(a);
      const bUn = isUnmappedAdvisor(b);
      if (aUn !== bUn) return aUn ? 1 : -1;
      return a.name.localeCompare(b.name);
    });
  }, [viewFilteredMappings, advisorMappingSearch]);

  const inputClass = `w-full text-[11px] px-2 py-1.5 rounded-lg border outline-none font-semibold ${
    dark ? "bg-[#060a12] border-stone-850 text-white focus:border-sky-500" : "bg-white border-stone-200 text-stone-900 focus:border-sky-400"
  }`;
  const selectTriggerClass = `w-full flex items-center justify-between gap-1 text-[11px] pl-2 pr-6 py-1.5 rounded-lg border outline-none font-semibold relative ${
    dark ? "bg-[#060a12] border-stone-850 text-white focus:border-sky-500" : "bg-white border-stone-200 text-stone-900 focus:border-sky-400"
  }`;

  return (
    <div className={`rounded-2xl border p-5 transition-all ${dark ? "bg-white/[0.03] border-white/[0.08]" : "bg-black/[0.02] border-black/[0.08]"}`}>
      <div className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <span className="text-[11px] font-bold flex items-center gap-1.5 whitespace-nowrap text-emerald-500">
              <Users2 className="w-3.5 h-3.5 shrink-0" />
              {/* Dynamic — reflects the currently applied search/view/
                  status filters, not the unfiltered total, so the count
                  actually answers "how many rows am I looking at". Shows
                  the total alongside once a filter narrows the list. */}
              {filteredAdvisorMappings.length} mapped {filteredAdvisorMappings.length === 1 ? "advisor" : "advisors"}
              {filteredAdvisorMappings.length !== advisorMappings.length && (
                <span className={`font-semibold ${dark ? "text-stone-500" : "text-stone-400"}`}> (of {advisorMappings.length} total)</span>
              )}
            </span>
            <p className={`text-[10.5px] ${dark ? "text-stone-500" : "text-stone-400"}`}>
              {lastSyncAt
                ? `Last synced ${new Date(lastSyncAt).toLocaleString()}${lastSyncResult ? ` — ${lastSyncResult.mappingsWritten} advisor(s) mapped` : ""}.`
                : "Not yet synced from the Advisor Directory sheet."}
            </p>
          </div>
          {canEdit && (
            <ClippedButton
              type="button"
              onClick={runAdvisorMappingSync}
              disabled={syncing}
              cornerBg={dark ? "#0e2236" : "#ffffff"}
              style={{ backgroundColor: "var(--action-navy)", borderColor: "var(--action-navy)", color: "var(--on-action-navy)" }}
              className="flex items-center gap-1.5 text-[10px] font-mono font-bold uppercase tracking-[0.15em] px-3 py-2 border hover:brightness-110 shrink-0"
            >
              <RefreshCw className={`w-3.5 h-3.5 shrink-0 ${syncing ? "animate-spin" : ""}`} />
              {syncing ? "Syncing..." : "Sync From Advisor Directory"}
            </ClippedButton>
          )}
        </div>

        {syncError && (
          <div className="px-3 py-2 rounded-lg text-[11px] font-bold text-red-400 bg-red-500/10 border border-red-500/25 flex items-center gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
            {syncError}
          </div>
        )}

        {advisorMappingsLoading ? (
          <span className={`text-[11px] font-bold flex items-center gap-1.5 whitespace-nowrap ${dark ? "text-stone-400" : "text-stone-500"}`}>
            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
            Loading advisor mappings...
          </span>
        ) : advisorMappings.length === 0 ? (
          <p className={`px-3 py-6 text-center text-xs font-semibold ${dark ? "text-stone-500" : "text-stone-400"}`}>
            No advisor mappings yet. {canEdit ? 'Run "Sync From Advisor Directory" to pull Guide/Mentor mappings from the sheet.' : "The Developer hasn't synced any yet."}
          </p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative flex-1 min-w-[180px]">
                <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-content-faint pointer-events-none" />
                <input
                  type="text"
                  value={advisorMappingSearch}
                  onChange={(e) => setAdvisorMappingSearch(e.target.value)}
                  placeholder="Search by advisor, Tact ID, status…"
                  className={`w-full pl-7 pr-2.5 py-1.5 rounded-lg border text-[11px] font-semibold outline-none ${
                    dark ? "bg-[#060a12] border-stone-850 text-white focus:border-sky-500" : "bg-white border-stone-200 text-stone-900 focus:border-sky-400"
                  }`}
                />
              </div>
              <div className="flex items-center gap-1">
                {([
                  { key: "all", label: "All" },
                  { key: "guide", label: "By Guide" },
                  { key: "mentor", label: "By Mentor" },
                  { key: "unmapped", label: "Unmapped" },
                ] as const).map((f) => (
                  <button
                    key={f.key}
                    type="button"
                    onClick={() => setFilterView(f.key)}
                    className={`px-2.5 py-1.5 rounded-lg border text-[10.5px] font-bold cursor-pointer whitespace-nowrap ${
                      filterView === f.key
                        ? "border-[var(--accent)] text-[var(--accent)]"
                        : dark ? "border-stone-850 text-stone-400 hover:bg-white/[0.04]" : "border-stone-200 text-stone-500 hover:bg-stone-50"
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
              {/* Table-level Status filter — a plain single-select
                  dropdown (unlike Guide/Mentor below) since it's an
                  additional narrowing on top of any filterView, not a
                  view of its own. */}
              <div className="w-[170px] shrink-0">
                <CustomSelect
                  theme={theme}
                  value={selectedStatusFilter}
                  onChange={setSelectedStatusFilter}
                  triggerClassName={selectTriggerClass}
                  options={[{ value: "", label: "All statuses" }, ...statusFilterOptions.map((s) => ({ value: s, label: s }))]}
                />
              </div>
            </div>

            {/* Guide/Mentor selection — multi-select chips (click to
                toggle) rather than a single-value dropdown, so someone
                covering several Guides/Mentors can see all of their
                advisors in one table instead of switching one at a
                time. */}
            {filterView === "guide" && (
              <div className="flex flex-wrap items-center gap-1.5">
                {guideFilterOptions.length === 0 ? (
                  <span className={`text-[11px] font-semibold ${dark ? "text-stone-500" : "text-stone-400"}`}>No advisors have a Guide mapped yet.</span>
                ) : (
                  <>
                    {guideFilterOptions.map((name) => {
                      const active = selectedGuideFilters.includes(name);
                      return (
                        <button
                          key={name}
                          type="button"
                          onClick={() => toggleGuideFilter(name)}
                          className={`px-2.5 py-1 rounded-full border text-[10.5px] font-bold cursor-pointer whitespace-nowrap transition-colors ${
                            active
                              ? "border-[var(--accent)] bg-[var(--accent-subtle-bg)] text-[var(--accent)]"
                              : dark ? "border-stone-850 text-stone-400 hover:bg-white/[0.04]" : "border-stone-200 text-stone-500 hover:bg-stone-50"
                          }`}
                        >
                          {name}
                        </button>
                      );
                    })}
                    {selectedGuideFilters.length > 0 && (
                      <button type="button" onClick={() => setSelectedGuideFilters([])} className={`text-[10.5px] font-bold underline cursor-pointer ${dark ? "text-stone-400 hover:text-stone-300" : "text-stone-500 hover:text-stone-700"}`}>
                        Clear
                      </button>
                    )}
                  </>
                )}
              </div>
            )}
            {filterView === "mentor" && (
              <div className="flex flex-wrap items-center gap-1.5">
                {mentorFilterOptions.length === 0 ? (
                  <span className={`text-[11px] font-semibold ${dark ? "text-stone-500" : "text-stone-400"}`}>No advisors have a Mentor mapped yet.</span>
                ) : (
                  <>
                    {mentorFilterOptions.map((name) => {
                      const active = selectedMentorFilters.includes(name);
                      return (
                        <button
                          key={name}
                          type="button"
                          onClick={() => toggleMentorFilter(name)}
                          className={`px-2.5 py-1 rounded-full border text-[10.5px] font-bold cursor-pointer whitespace-nowrap transition-colors ${
                            active
                              ? "border-[var(--accent)] bg-[var(--accent-subtle-bg)] text-[var(--accent)]"
                              : dark ? "border-stone-850 text-stone-400 hover:bg-white/[0.04]" : "border-stone-200 text-stone-500 hover:bg-stone-50"
                          }`}
                        >
                          {name}
                        </button>
                      );
                    })}
                    {selectedMentorFilters.length > 0 && (
                      <button type="button" onClick={() => setSelectedMentorFilters([])} className={`text-[10.5px] font-bold underline cursor-pointer ${dark ? "text-stone-400 hover:text-stone-300" : "text-stone-500 hover:text-stone-700"}`}>
                        Clear
                      </button>
                    )}
                  </>
                )}
              </div>
            )}

            {filteredAdvisorMappings.length === 0 ? (
              <p className={`px-3 py-6 text-center text-xs font-semibold ${dark ? "text-stone-500" : "text-stone-400"}`}>
                {filterView === "guide" && selectedGuideFilters.length === 0
                  ? "Select one or more Guides above to see their mapped advisors."
                  : filterView === "mentor" && selectedMentorFilters.length === 0
                    ? "Select one or more Mentors above to see their mapped advisors."
                    : "No advisor mappings match the current search/filters."}
              </p>
            ) : (
              /* Caps at 70vh and scrolls internally (both axes — the
                 table can overflow horizontally on narrow viewports too)
                 instead of letting the whole page scroll through a long
                 roster. Same convention as the QA Dashboard's advisor
                 roster/QIP tables. The header uses sticky top-0 with an
                 OPAQUE per-theme background (not the translucent
                 bg-white/[0.03] it used before scrolling was possible) —
                 translucent would let scrolled-past rows show through it. */
              <div className={`rounded-xl border overflow-auto max-h-[70vh] ${dark ? "border-stone-850" : "border-stone-200"}`}>
                <table className="w-full border-collapse text-[11px]">
                  <thead>
                    <tr className="text-left">
                      {["Tact ID", "Name", "Email ID", "Batch", "Mentor", "Product", "Status", "Guide", "Active Till", "History"].map((h) => (
                        <th
                          key={h}
                          className={`sticky top-0 z-10 px-2 py-2 text-[10px] font-black uppercase tracking-wider whitespace-nowrap border-b ${
                            dark ? "bg-[#0d1420] border-stone-850 text-stone-400" : "bg-stone-50 border-stone-200 text-stone-500"
                          }`}
                        >
                          {h}
                        </th>
                      ))}
                      {canEdit && (
                        <th className={`sticky top-0 z-10 px-2 py-2 w-8 border-b ${dark ? "bg-[#0d1420] border-stone-850" : "bg-[var(--table-header-bg)] border-stone-200"}`} />
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredAdvisorMappings.map((m, idx) => {
                      const isEditing = canEdit && editingMappingId === m.id;
                      const till = activeTillOf(m);
                      const unmapped = isUnmappedAdvisor(m);
                      return (
                        <Fragment key={m.id}>
                        <tr
                          className={`border-t align-top ${dark ? "border-stone-850" : "border-stone-150"} ${idx % 2 === 1 ? (dark ? "bg-white/[0.015]" : "bg-surface-solid") : ""} ${
                            unmapped ? "opacity-70" : ""
                          }`}
                        >
                          <td className="px-2 py-2 whitespace-nowrap">
                            <span className={`px-1.5 py-0.5 rounded text-[9px] font-black uppercase border ${dark ? "bg-sky-500/15 text-sky-400 border-sky-500/30" : "bg-sky-50 text-sky-700 border-sky-200"}`}>
                              {m.tactId}
                            </span>
                          </td>
                          <td className="px-2 py-2 min-w-[110px]">
                            {isEditing ? (
                              <input className={inputClass} value={draftMapping.name} onChange={(e) => setDraftMapping((d) => ({ ...d, name: e.target.value }))} placeholder="Name" />
                            ) : (
                              <div className="flex items-center gap-1.5">
                                <span className={`font-bold ${dark ? "text-white" : "text-stone-900"}`}>{m.name}</span>
                                {unmapped && (
                                  <span className={`px-1 py-0.5 rounded text-[8px] font-black uppercase border whitespace-nowrap ${dark ? "bg-stone-500/15 text-stone-400 border-stone-500/30" : "bg-stone-100 text-stone-500 border-stone-200"}`}>
                                    Unmapped
                                  </span>
                                )}
                              </div>
                            )}
                          </td>
                          <td className={`px-2 py-2 min-w-[130px] ${dark ? "text-stone-400" : "text-stone-500"}`}>{m.email || "—"}</td>
                          <td className="px-2 py-2 min-w-[60px]">
                            {isEditing ? (
                              <input className={inputClass} value={draftMapping.batchNumber} onChange={(e) => setDraftMapping((d) => ({ ...d, batchNumber: e.target.value }))} placeholder="Batch" />
                            ) : (
                              m.batchNumber || "—"
                            )}
                          </td>
                          <td className="px-2 py-2 min-w-[110px]">
                            {isEditing ? (
                              <div className="space-y-1">
                                <CustomSelect
                                  theme={theme}
                                  value={draftMapping.mentorName}
                                  onChange={(v) => setDraftMapping((d) => ({ ...d, mentorName: v }))}
                                  triggerClassName={selectTriggerClass}
                                  options={[
                                    { value: "", label: "— None —" },
                                    ...withCurrentValueFallback(mentorOptionsUnion, draftMapping.mentorName).map((n) => ({ value: n, label: n })),
                                  ]}
                                />
                                {draftMapping.mentorName.trim() !== (m.mentorName || "").trim() && (
                                  <DateInputDMY
                                    theme={theme}
                                    value={draftMapping.mentorEffectiveDate}
                                    onChange={(v) => setDraftMapping((d) => ({ ...d, mentorEffectiveDate: v }))}
                                    displayClassName={inputClass}
                                    title="Effective date for this Mentor change — the old Mentor relationship ends and the new one starts on this date"
                                  />
                                )}
                              </div>
                            ) : (
                              m.mentorName || "—"
                            )}
                          </td>
                          <td className="px-2 py-2 min-w-[80px]">
                            {isEditing ? (
                              <CustomSelect
                                theme={theme}
                                value={draftMapping.skillDomain}
                                onChange={(v) => setDraftMapping((d) => ({ ...d, skillDomain: v }))}
                                triggerClassName={selectTriggerClass}
                                options={[
                                  { value: "", label: "— None —" },
                                  ...withCurrentValueFallback(productOptions, draftMapping.skillDomain).map((n) => ({ value: n, label: n })),
                                ]}
                              />
                            ) : (
                              m.skillDomain || "—"
                            )}
                          </td>
                          <td className="px-2 py-2 min-w-[130px]">
                            {isEditing ? (
                              <CustomSelect
                                theme={theme}
                                value={draftMapping.status}
                                onChange={(v) => setDraftMapping((d) => ({ ...d, status: v }))}
                                triggerClassName={selectTriggerClass}
                                options={[
                                  { value: "", label: "— None —" },
                                  ...withCurrentValueFallback(statusFilterOptions, draftMapping.status).map((n) => ({ value: n, label: n })),
                                ]}
                              />
                            ) : (
                              m.status || "—"
                            )}
                          </td>
                          <td className="px-2 py-2 min-w-[90px]">
                            {isEditing ? (
                              <div className="space-y-1">
                                <CustomSelect
                                  theme={theme}
                                  value={draftMapping.guideName}
                                  onChange={(v) => setDraftMapping((d) => ({ ...d, guideName: v }))}
                                  triggerClassName={selectTriggerClass}
                                  options={[
                                    { value: "", label: "— None —" },
                                    ...withCurrentValueFallback(guideOptionsUnion, draftMapping.guideName).map((n) => ({ value: n, label: n })),
                                  ]}
                                />
                                {draftMapping.guideName.trim() !== (m.guideName || "").trim() && (
                                  <DateInputDMY
                                    theme={theme}
                                    value={draftMapping.guideEffectiveDate}
                                    onChange={(v) => setDraftMapping((d) => ({ ...d, guideEffectiveDate: v }))}
                                    displayClassName={inputClass}
                                    title="Effective date for this Guide change — the old Guide relationship ends and the new one starts on this date"
                                  />
                                )}
                              </div>
                            ) : (
                              m.guideName || "—"
                            )}
                          </td>
                          <td className="px-2 py-2 min-w-[110px]">
                            {isEditing ? (
                              <DateInputDMY
                                theme={theme}
                                value={draftMapping.activeTill}
                                onChange={(v) => setDraftMapping((d) => ({ ...d, activeTill: v }))}
                                displayClassName={inputClass}
                                title="Active Till — the point past which this advisor is no longer considered active"
                              />
                            ) : till ? (
                              formatActiveTill(till)
                            ) : (
                              "—"
                            )}
                          </td>
                          <td className="px-2 py-2 whitespace-nowrap">
                            <ClippedButton
                              onClick={() => toggleHistory(m)}
                              cornerBg={dark ? "#0e2236" : "#ffffff"}
                              className={`p-1.5 ${
                                historyOpenId === m.id
                                  ? dark
                                    ? "bg-sky-500/15 text-sky-400"
                                    : "bg-sky-500/10 text-sky-600"
                                  : dark
                                    ? "hover:bg-white/5 text-stone-400 hover:text-stone-200"
                                    : "hover:bg-stone-100 text-stone-500 hover:text-stone-700"
                              }`}
                              title="View this advisor's Mentor/Guide relationship history"
                            >
                              <History className="w-3.5 h-3.5" />
                            </ClippedButton>
                          </td>
                          {canEdit && (
                            <td className="px-2 py-2 whitespace-nowrap">
                              {isEditing ? (
                                <div className="flex items-center gap-1">
                                  <ClippedButton onClick={() => saveEditMapping(m)} disabled={saving} cornerBg={dark ? "#0e2236" : "#ffffff"} className="p-1.5 bg-emerald-600 hover:bg-emerald-700 text-white" title="Save">
                                    <Save className="w-3.5 h-3.5" />
                                  </ClippedButton>
                                  <ClippedButton onClick={cancelEditMapping} cornerBg={dark ? "#0e2236" : "#ffffff"} className="p-1.5 bg-stone-700 hover:bg-stone-600 text-stone-50" title="Cancel">
                                    <X className="w-3.5 h-3.5" />
                                  </ClippedButton>
                                </div>
                              ) : (
                                <div className="flex items-center gap-1">
                                  <ClippedButton
                                    onClick={() => startEditMapping(m)}
                                    cornerBg={dark ? "#0e2236" : "#ffffff"}
                                    className={`p-1.5 ${dark ? "hover:bg-sky-500/15 text-stone-400 hover:text-sky-400" : "hover:bg-sky-500/10 text-stone-500 hover:text-sky-600"}`}
                                    title="Edit mapping"
                                  >
                                    <Pencil className="w-3.5 h-3.5" />
                                  </ClippedButton>
                                  <ClippedButton
                                    onClick={() => deleteAdvisorMapping(m)}
                                    disabled={saving}
                                    cornerBg={dark ? "#0e2236" : "#ffffff"}
                                    className={`p-1.5 ${dark ? "hover:bg-red-500/15 text-stone-400 hover:text-red-400" : "hover:bg-red-500/10 text-stone-500 hover:text-red-600"}`}
                                    title="Remove mapping"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </ClippedButton>
                                </div>
                              )}
                            </td>
                          )}
                        </tr>
                        {historyOpenId === m.id && (
                          <tr className={`border-t ${dark ? "border-stone-850 bg-white/[0.02]" : "border-stone-150 bg-stone-50/80"}`}>
                            <td colSpan={10 + (canEdit ? 1 : 0)} className="px-4 py-3">
                              {historyLoadingId === m.id ? (
                                <p className="text-[10.5px] font-semibold text-content-muted">Loading history…</p>
                              ) : (
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                  {renderHistoryTimeline("Mentor", historyByMappingId[m.id]?.mentor || [])}
                                  {renderHistoryTimeline("Guide", historyByMappingId[m.id]?.guide || [])}
                                </div>
                              )}
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
          Synced from master_advisors (the same sheet the Advisor Directory Sync under Connections reads) — a source of truth for each Guide/Mentor's
          mapped advisors going forward. Re-run the sync any time the sheet changes; a hand edit here is overwritten by the next sync. "Active Till" is
          the point past which this advisor is no longer considered active — from the sync, the earlier of the sheet's "Date of moving out to a
          different role" and "Last working day"; editing it by hand sets this single date directly.
        </p>
      </div>
    </div>
  );
}
