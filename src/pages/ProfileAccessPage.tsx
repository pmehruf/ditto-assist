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
   * "Master Advisors" sub-tab. */
  canViewMasterAdvisors: boolean;
}

/**
 * "Access Control Center" tab content — thin wrapper page (renamed from
 * "User Management" 2026-08-19 once its scope grew past the directory to
 * also cover feature access permissions and departments — see
 * featurePermissions.ts's "profile_access" entry). The
 * `activeTab === "profile_access"` condition and wrapping
 * `<motion.div key="profile_access">` deliberately stay in App.tsx
 * (see ResourcesPage.tsx for why).
 *
 * Admin+ only (gated in App.tsx's sidebar/hasAccess via the "profile_access"
 * feature id). Developer can edit; Admin sees a read-only view on every tab.
 * All reads/writes go through the server so a Developer's edit is reflected
 * for every user immediately, not just the editor's own browser/localStorage.
 */
type SubTab = "directory" | "permissions" | "organization" | "access_rules" | "groups" | "custom_grants" | "qa_access" | "master_advisors" | "change_history";

const SUB_TAB_BLURBS: Record<SubTab, string> = {
  directory: "", // computed dynamically below (depends on effectiveTier)
  permissions: "Which tier can view or edit each feature — the Developer-editable override of this app's shipped access defaults.",
  organization: "Business Units, Departments, and Roles — organizational metadata. On its own, none of these grant anything; they can affect access only if an Access Rule or Product Assist eligibility setting is configured to key off them.",
  access_rules: "Population-level grants keyed off Business Unit/Department/Role/Product Tag — everyone matching a rule gets its level, on top of their tier's default access.",
  groups: "Person-to-person mappings (e.g. a Mentor's mentees), grouped under a named group — pick or create a group to manage its roster and, if enabled, restrict its members to specific tools.",
  custom_grants: "Per-individual, add-only access overrides — the flexibility valve for when Business Unit/Department/Role structure doesn't fit someone. Can only raise access, never lower it.",
  qa_access: "Who holds Admin/Guide/Mentor access on the QA Dashboard, separate from the WebApp tiers above.",
  master_advisors: "Every advisor's Guide/Mentor assignment and Tact ID/status/employment snapshot, synced from the Advisor Directory sheet.",
  change_history: "Every change made on the other tabs here, including the Directory — who changed what, and when.",
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
}: ProfileAccessPageProps) {
  const [activeSubTab, setActiveSubTab] = useState<SubTab>("directory");
  const dark = theme === "dark";

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
            {activeSubTab === "directory"
              ? <>Organization-wide record of advisor accounts, TACT IDs, and clearance tiers.{(effectiveTier === "Developer" || effectiveTier === "Platform Admin") ? " Edits here apply to every user immediately." : " Read-only — Developer clearance is required to make changes."}</>
              : SUB_TAB_BLURBS[activeSubTab]}
          </p>
        </div>
      </div>

      <nav className={`flex gap-1 border-b-2 ${dark ? "border-white/10" : "border-stone-200"}`}>
        {(
          [
            { id: "directory", label: "Directory" },
            { id: "permissions", label: "Permissions" },
            { id: "organization", label: "Organization" },
            { id: "access_rules", label: "Access Rules" },
            { id: "groups", label: "Groups" },
            { id: "custom_grants", label: "Custom Grants" },
            { id: "qa_access", label: "QA Dashboard Access" },
            { id: "master_advisors", label: "Master Advisors" },
            { id: "change_history", label: "Change History" },
          ] as { id: SubTab; label: string }[]
        )
          // Groups/Master Advisors sub-tabs only show when the caller holds
          // at least Viewer on that feature (2026-09 permission architecture
          // fix) — everything else on this page is Admin+'s own
          // administrative surface (deliberately un-gated by Permissions,
          // see this component's own doc comment), but these two are
          // ordinary governed features with their own Permissions row.
          .filter((tab) => (tab.id === "groups" ? canViewGroups : tab.id === "master_advisors" ? canViewMasterAdvisors : true))
          .map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveSubTab(tab.id)}
            className={`px-4 py-2 text-xs font-bold rounded-t-lg -mb-0.5 border-b-[3px] cursor-pointer transition-colors ${
              activeSubTab === tab.id
                ? "border-[var(--accent)] text-[var(--accent)]"
                : "border-transparent text-content-muted hover:text-content"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      <div className="space-y-5 pb-6">
        {activeSubTab === "directory" && (
          <ProfileAccessManagement theme={theme} usersList={usersList} setUsersList={setUsersList} effectiveTier={effectiveTier} departments={departments} orgTeams={orgTeams} roles={roles} featureAccessOverrides={featureAccessOverrides} hiddenPages={hiddenPages} />
        )}
        {activeSubTab === "permissions" && (
          <FeatureAccessManagement theme={theme} effectiveTier={effectiveTier} overrides={featureAccessOverrides} onChanged={onFeatureAccessChanged} logAction={logAction} />
        )}
        {activeSubTab === "organization" && (
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
        {activeSubTab === "access_rules" && (
          <AccessRulesManagement theme={theme} effectiveTier={effectiveTier} departments={departments} orgTeams={orgTeams} roles={roles} />
        )}
        {activeSubTab === "groups" && canViewGroups && (
          <GroupsManagement theme={theme} effectiveTier={effectiveTier} usersList={usersList} departments={departments} orgTeams={orgTeams} roles={roles} logAction={logAction} canManageGroups={canManageGroups} />
        )}
        {activeSubTab === "custom_grants" && (
          <CustomGrantsManagement theme={theme} effectiveTier={effectiveTier} usersList={usersList} logAction={logAction} />
        )}
        {activeSubTab === "qa_access" && (
          <QaDashboardAccessManagement theme={theme} effectiveTier={effectiveTier} />
        )}
        {activeSubTab === "master_advisors" && canViewMasterAdvisors && (
          <MasterAdvisorsManagement theme={theme} effectiveTier={effectiveTier} usersList={usersList} departments={departments} logAction={logAction} canManage={canManageMasterAdvisors} />
        )}
        {activeSubTab === "change_history" && (
          <AccessControlChangeHistory theme={theme} />
        )}
      </div>
    </div>
  );
}
