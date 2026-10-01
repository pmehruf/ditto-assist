/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { UserProfile, LoggedUser } from "../types/user";
import { FeatureAccessOverride, Department, OrgTeam, AppRole } from "../types/permissions";
import { ChangeLogEntry } from "../types/changeLog";
import { ProfileAccessManagement } from "../components/ProfileAccessManagement";
import { QaDashboardAccessManagement } from "../components/QaDashboardAccessManagement";
import { FeatureAccessManagement } from "../components/FeatureAccessManagement";
import { OrganizationManagement } from "../components/OrganizationManagement";
import { GroupsManagement } from "../components/GroupsManagement";
import { CustomGrantsManagement } from "../components/CustomGrantsManagement";
import { AccessRulesManagement } from "../components/AccessRulesManagement";
import { AccessControlChangeHistory } from "../components/AccessControlChangeHistory";
import { MasterAdvisorsManagement } from "../components/MasterAdvisorsManagement";

interface ProfileAccessPageProps {
  theme: "light" | "dark";
  usersList: UserProfile[];
  setUsersList: Dispatch<SetStateAction<UserProfile[]>>;
  effectiveTier: "General" | "Admin" | "Platform Admin" | "Developer";
  currentUser: LoggedUser | null;
  setChangeLogs: Dispatch<SetStateAction<ChangeLogEntry[]>>;
  featureAccessOverrides: FeatureAccessOverride[];
  onFeatureAccessChanged: () => void;
  departments: Department[];
  onDepartmentsChanged: () => void;
  orgTeams: OrgTeam[];
  onOrgTeamsChanged: () => void;
  roles: AppRole[];
  onRolesChanged: () => void;
  hiddenPages: string[];
  /** True when App.tsx's hasAccess("group_management", "Editor") passes —
   * Platform Admin/Developer always, plus anyone else holding an explicit
   * Custom Grant for it (see featurePermissions.ts's "group_management"
   * entry for why this is its own narrower capability, not "profile_access"
   * Editor). Threaded down to the Groups tab so its canEdit gate respects
   * the grant instead of only ever checking tier. */
  canManageGroups: boolean;
  /** True when App.tsx's hasAccess("master_advisors", "Editor") passes —
   * same delegation pattern as canManageGroups above, threaded to the
   * Master Advisors tab so its edit/delete gate respects a Custom Grant
   * instead of only ever checking tier. */
  canManageMasterAdvisors: boolean;
  /** True when App.tsx's hasAccess("group_management", "Viewer") passes.
   * Unlike canManageGroups above, this decides whether the "Groups" sub-tab
   * is shown at all — 2026-09 permission architecture fix: previously this
   * sub-tab was always visible to anyone who could open the Access Control
   * Center, so setting group_management to "None" in Permissions had no
   * client-side effect (the server's own routes already enforced Viewer
   * correctly, so nothing leaked, but the tab itself didn't hide). */
  canViewGroups: boolean;
  /** True when App.tsx's hasAccess("master_advisors", "Viewer") passes —
   * same "does the tab even show" fix as canViewGroups above, for the
   * "Master Advisors" tab. */
  canViewMasterAdvisors: boolean;
  /** True when App.tsx's hasAccess("profile_access_directory", "Viewer")
   * passes — 2026-09g: whether the "Directory" top-level tab itself is
   * visible (distinct from "profile_access", which gates whether Access
   * Control Center is reachable at all). */
  canViewDirectory: boolean;
  /** True when App.tsx's hasAccess("profile_access_permissions", "Viewer")
   * passes — 2026-09g, same pattern as canViewDirectory above, for the
   * "Permissions" top-level tab. */
  canViewPermissions: boolean;
  /** True when App.tsx's hasAccess("qa_access_groups", "Viewer") passes —
   * 2026-09g, same pattern, for the "QA Access Groups" top-level tab
   * (renamed and promoted out of Permissions at the user's explicit
   * request). */
  canViewQaAccessGroups: boolean;
  /** True when App.tsx's hasAccess("profile_access_change_history", "Viewer")
   * passes — same pattern as canViewGroups/canViewMasterAdvisors above, for
   * the "Change History" tab, promoted out of the Permissions sub-nav to
   * its own top-level tab (next to Master Advisors) at the user's explicit
   * request. */
  canViewChangeHistory: boolean;
}

/**
 * "Access Control Center" tab content — thin wrapper page (renamed from
 * "User Management" 2026-08-19 once its scope grew past the directory to
 * also cover feature access permissions and departments — see
 * featurePermissions.ts's "profile_access" entry). The
 * `activeTab === "profile_access"` condition and wrapping
 * `<motion.div key="profile_access">` deliberately stay in App.tsx
 * (see the AnimatePresence block in App.tsx for why).
 *
 * Admin+ only (gated in App.tsx's sidebar/hasAccess via the "profile_access"
 * feature id). Developer can edit; Admin sees a read-only view on every tab.
 * All reads/writes go through the server so a Developer's edit is reflected
 * for every user immediately, not just the editor's own browser/localStorage.
 */
// Top level: "Directory" (the people), "Permissions" (everything that
// configures or audits access), "QA Access Groups", "Master Advisors", and
// "Change History" — 2026-09g, at the user's explicit request ("Pick up -
// QA dashboard access, and master advisors sections from permissions
// section and place it as main section along with directory and
// permissions"), later joined by Change History (moved next to Master
// Advisors, same request pattern): those sections were promoted out of the
// Permissions sub-nav (where 2026-09e had collapsed them) back up to their
// own top-level tabs, since none of them is really "configuring access" the
// way the remaining Permissions sub-sections are — QA Access Groups manages
// a completely separate
// QA-Dashboard-only role axis, and Master Advisors isn't an access setting
// at all. Every REMAINING section that used to be its own top-level tab
// stays a PermSection, switched via the second nav row that appears once
// "Permissions" is selected.
type TopTab = "directory" | "permissions" | "qa_access" | "master_advisors" | "change_history";
type PermSection = "feature_defaults" | "organization" | "access_rules" | "groups" | "custom_grants";

const PERM_SECTION_BLURBS: Record<PermSection, string> = {
  feature_defaults: "Which tier can view or edit each feature — the Developer-editable override of this app's shipped access defaults.",
  organization: "Business Units, Departments, and Roles — organizational metadata. On its own, none of these grant anything; they can affect access only if an Access Rule or Product Assist eligibility setting is configured to key off them.",
  access_rules: "Population-level grants keyed off Business Unit/Department/Role/Product Tag — everyone matching a rule gets its level, on top of their tier's default access.",
  groups: "Person-to-person mappings (e.g. a Mentor's mentees), grouped under a named group — pick or create a group to manage its roster and, if enabled, restrict its members to specific tools.",
  custom_grants: "Per-individual, add-only access overrides — the flexibility valve for when Business Unit/Department/Role structure doesn't fit someone. Can only raise access, never lower it.",
};

const PERM_SECTIONS: { id: PermSection; label: string }[] = [
  { id: "feature_defaults", label: "Feature Defaults" },
  { id: "organization", label: "Organization" },
  { id: "access_rules", label: "Access Rules" },
  { id: "groups", label: "Groups" },
  { id: "custom_grants", label: "Custom Grants" },
];

// Renamed from "QA Dashboard Access" (2026-09g, at the user's explicit
// request) — same underlying tab/data, clearer name now that it sits
// alongside "Master Advisors" as its own top-level tab rather than buried
// in a "QA Dashboard" vs "Access Control Center" naming collision.
//
// "change_history" promoted out of the Permissions sub-nav to sit next to
// "master_advisors" as its own top-level tab, at the user's explicit
// request — same promotion Master Advisors/QA Access Groups already went
// through in 2026-09g.
const TOP_TAB_BLURBS: Record<Exclude<TopTab, "directory" | "permissions">, string> = {
  qa_access: "Who holds Admin/Guide/Mentor access on the QA Dashboard, separate from the WebApp tiers above.",
  master_advisors: "Every advisor's Guide/Mentor assignment and Tact ID/status/employment snapshot, synced from the Advisor Directory sheet.",
  change_history: "Every change made across Access Control Center, including the Directory — who changed what, and when.",
};

export function ProfileAccessPage({
  theme,
  usersList,
  setUsersList,
  effectiveTier,
  currentUser,
  setChangeLogs,
  featureAccessOverrides,
  onFeatureAccessChanged,
  departments,
  onDepartmentsChanged,
  orgTeams,
  onOrgTeamsChanged,
  roles,
  onRolesChanged,
  hiddenPages,
  canManageGroups,
  canManageMasterAdvisors,
  canViewGroups,
  canViewMasterAdvisors,
  canViewDirectory,
  canViewPermissions,
  canViewQaAccessGroups,
  canViewChangeHistory,
}: ProfileAccessPageProps) {
  const [activeTopTab, setActiveTopTab] = useState<TopTab>("directory");
  // Persists across switching back and forth to Directory, so returning to
  // Permissions lands back on whichever section was open before.
  const [activePermSection, setActivePermSection] = useState<PermSection>("feature_defaults");
  const dark = theme === "dark";

  const visiblePermSections = PERM_SECTIONS.filter((s) => (s.id === "groups" ? canViewGroups : true));
  // Falls back to Feature Defaults if the caller's access to the previously-
  // selected section (Groups) is revoked while this page is open, rather
  // than rendering a section with no matching nav item selected.
  const effectivePermSection: PermSection = visiblePermSections.some((s) => s.id === activePermSection) ? activePermSection : "feature_defaults";

  // 2026-09g: which top-level tabs this caller can even see — see each
  // prop's own doc comment above. Directory/Permissions default to visible
  // (their gating featureIds ship Admin-tier Viewer by default, same as
  // profile_access itself always has), filtered defensively the same way
  // Groups/Master Advisors already were, in case a Developer narrows one of
  // them from the Permissions tab.
  const TOP_TABS: { id: TopTab; label: string }[] = [
    { id: "directory", label: "Directory" },
    { id: "permissions", label: "Permissions" },
    { id: "qa_access", label: "QA Access Groups" },
    { id: "master_advisors", label: "Master Advisors" },
    { id: "change_history", label: "Change History" },
  ];
  const visibleTopTabs = TOP_TABS.filter((t) =>
    t.id === "directory" ? canViewDirectory
    : t.id === "permissions" ? canViewPermissions
    : t.id === "qa_access" ? canViewQaAccessGroups
    : t.id === "master_advisors" ? canViewMasterAdvisors
    : canViewChangeHistory
  );
  // Falls back to the first still-visible top tab if the caller's access to
  // the previously-selected one is revoked while this page is open (same
  // pattern as effectivePermSection above) — defaults to "directory" itself
  // in the pathological case where nothing is visible, so the page never
  // renders with literally no tab selected.
  const effectiveTopTab: TopTab = visibleTopTabs.some((t) => t.id === activeTopTab) ? activeTopTab : (visibleTopTabs[0]?.id ?? "directory");

  // Shared local-state audit entry, same pattern used by every admin page on
  // this app. Pushing onto setChangeLogs is not merely local: App.tsx wraps
  // setChangeLogs so every entry pushed here is also durably POSTed to
  // /api/change-logs (see App.tsx's setChangeLogs wrapper) — this IS how
  // Created/Edited actions on the Permissions/Departments/Teams/Roles/
  // Relationships/Custom Grants tabs get their durable audit record; those
  // routes don't separately call changeLogs.create() server-side. (Access
  // Rule Created/Edited, Delete actions on Departments/Teams/Roles, and all
  // User Directory mutations, are exceptions — those write server-side via
  // changeLogs.create()/describeUserAccessChanges() directly and don't use
  // this function, to avoid a duplicate entry — see AccessRulesManagement,
  // ProfileAccessManagement, and describeUserAccessChanges.ts.)
  const logAction = (actionType: string, description: string) => {
    setChangeLogs(prev => [
      {
        id: `log-${Date.now()}`,
        timestamp: new Date().toISOString(),
        userName: currentUser?.name || currentUser?.email || "Mehruf P (Developer)",
        role: effectiveTier,
        actionType,
        planName: "Access Control Center",
        description,
      },
      ...prev,
    ]);
  };

  return (
    <div className="space-y-5 text-left">
      {/* PAGE-LEVEL HEADER — standardized app-wide (see Coverage Projection
          Studio, the reference implementation): flat, no card surface,
          accent line + title sitting directly on the page. */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 pb-3 border-b border-stone-200 dark:border-stone-800">
        <div>
          <h1 className={`text-page-title tracking-tight flex items-center gap-2 ${
            theme === "dark" ? "text-white" : "text-[#111827]"
          }`}>
            <div className="w-8 h-0.5 flex-shrink-0" style={{ backgroundColor: theme === "dark" ? "#00D3F3" : "#4673a9" }} />
            <span>Access Control Center</span>
          </h1>
          <p className="text-xs mt-1 font-semibold text-content-muted">
            {effectiveTopTab === "directory"
              ? <>Organization-wide record of advisor accounts, TACT IDs, and clearance tiers.{(effectiveTier === "Developer" || effectiveTier === "Platform Admin") ? " Edits here apply to every user immediately." : " Read-only — Developer clearance is required to make changes."}</>
              : effectiveTopTab === "permissions"
              ? PERM_SECTION_BLURBS[effectivePermSection]
              : TOP_TAB_BLURBS[effectiveTopTab]}
          </p>
        </div>
      </div>

      <nav className={`flex gap-1 border-b-2 ${dark ? "border-white/10" : "border-stone-200"}`}>
        {visibleTopTabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTopTab(tab.id)}
            className={`px-4 py-2 text-xs font-bold rounded-t-lg -mb-0.5 border-b-[3px] cursor-pointer transition-colors ${
              effectiveTopTab === tab.id
                ? "border-[var(--accent)] text-[var(--accent)]"
                : "border-transparent text-content-muted hover:text-content"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      {/* Second-level nav — every section that used to be its own top-level
          tab now lives here, under Permissions (2026-09e; QA Access Groups
          and Master Advisors were promoted back OUT to their own top-level
          tabs in 2026-09g — see the TopTab type's own comment above). */}
      {effectiveTopTab === "permissions" && (
        <nav className={`flex flex-wrap gap-1 -mt-2 pb-2 border-b ${dark ? "border-white/[0.06]" : "border-stone-150"}`}>
          {visiblePermSections.map((section) => (
            <button
              key={section.id}
              onClick={() => setActivePermSection(section.id)}
              className={`px-3 py-1.5 rounded-lg text-[11px] font-bold cursor-pointer transition-colors ${
                effectivePermSection === section.id
                  ? dark ? "bg-white/[0.08] text-white" : "bg-stone-900/[0.06] text-stone-900"
                  : "text-content-muted hover:text-content"
              }`}
            >
              {section.label}
            </button>
          ))}
        </nav>
      )}

      <div className="space-y-5 pb-6">
        {effectiveTopTab === "directory" && (
          <ProfileAccessManagement theme={theme} usersList={usersList} setUsersList={setUsersList} effectiveTier={effectiveTier} departments={departments} orgTeams={orgTeams} roles={roles} featureAccessOverrides={featureAccessOverrides} hiddenPages={hiddenPages} />
        )}
        {effectiveTopTab === "permissions" && effectivePermSection === "feature_defaults" && (
          <FeatureAccessManagement theme={theme} effectiveTier={effectiveTier} overrides={featureAccessOverrides} onChanged={onFeatureAccessChanged} logAction={logAction} />
        )}
        {effectiveTopTab === "permissions" && effectivePermSection === "organization" && (
          <OrganizationManagement
            theme={theme}
            effectiveTier={effectiveTier}
            orgTeams={orgTeams}
            departments={departments}
            roles={roles}
            usersList={usersList}
            onOrgTeamsChanged={onOrgTeamsChanged}
            onDepartmentsChanged={onDepartmentsChanged}
            onRolesChanged={onRolesChanged}
            logAction={logAction}
          />
        )}
        {effectiveTopTab === "permissions" && effectivePermSection === "access_rules" && (
          <AccessRulesManagement theme={theme} effectiveTier={effectiveTier} departments={departments} orgTeams={orgTeams} roles={roles} />
        )}
        {effectiveTopTab === "permissions" && effectivePermSection === "groups" && canViewGroups && (
          <GroupsManagement theme={theme} effectiveTier={effectiveTier} usersList={usersList} departments={departments} orgTeams={orgTeams} roles={roles} logAction={logAction} canManageGroups={canManageGroups} currentUserEmail={currentUser?.email || ""} />
        )}
        {effectiveTopTab === "permissions" && effectivePermSection === "custom_grants" && (
          <CustomGrantsManagement theme={theme} effectiveTier={effectiveTier} usersList={usersList} logAction={logAction} />
        )}
        {effectiveTopTab === "qa_access" && (
          <QaDashboardAccessManagement theme={theme} effectiveTier={effectiveTier} />
        )}
        {effectiveTopTab === "master_advisors" && (
          <MasterAdvisorsManagement theme={theme} effectiveTier={effectiveTier} usersList={usersList} departments={departments} logAction={logAction} canManage={canManageMasterAdvisors} />
        )}
        {effectiveTopTab === "change_history" && (
          <AccessControlChangeHistory theme={theme} />
        )}
      </div>
    </div>
  );
}
