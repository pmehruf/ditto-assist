/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { UserProfile, LoggedUser } from "../types/user";
import { FeatureAccessOverride, Department } from "../types/permissions";
import { ChangeLogEntry } from "../types/changeLog";
import { ProfileAccessManagement } from "../components/ProfileAccessManagement";
import { QaDashboardAccessManagement } from "../components/QaDashboardAccessManagement";
import { FeatureAccessManagement } from "../components/FeatureAccessManagement";
import { DepartmentsManagement } from "../components/DepartmentsManagement";

interface ProfileAccessPageProps {
  theme: "light" | "dark";
  usersList: UserProfile[];
  setUsersList: Dispatch<SetStateAction<UserProfile[]>>;
  effectiveTier: "General" | "Admin" | "Developer";
  currentUser: LoggedUser | null;
  setChangeLogs: Dispatch<SetStateAction<ChangeLogEntry[]>>;
  featureAccessOverrides: FeatureAccessOverride[];
  onFeatureAccessChanged: () => void;
  departments: Department[];
  onDepartmentsChanged: () => void;
  hiddenPages: string[];
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
const SUB_TAB_BLURBS: Record<"directory" | "permissions" | "departments" | "qa_access", string> = {
  directory: "", // computed dynamically below (depends on effectiveTier)
  permissions: "Which tier can view or edit each feature — the Developer-editable override of this app's shipped access defaults.",
  departments: "Organizational metadata only — departments have no effect on what anyone can access.",
  qa_access: "Who holds Admin/Guide/Mentor access on the QA Dashboard, separate from the WebApp tiers above.",
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
  hiddenPages,
}: ProfileAccessPageProps) {
  const [activeSubTab, setActiveSubTab] = useState<"directory" | "permissions" | "departments" | "qa_access">("directory");
  const dark = theme === "dark";

  // Shared local-state audit entry, same pattern used by every admin page on
  // this app (see ProfileAccessManagement's own logAction) — the server
  // already durably records the change via changeLogs.create() in the
  // relevant route; this just gives the Audit tab an entry without a refetch.
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
              ? <>Organization-wide record of advisor accounts, TACT IDs, and clearance tiers.{effectiveTier === "Developer" ? " Edits here apply to every user immediately." : " Read-only — Developer clearance is required to make changes."}</>
              : SUB_TAB_BLURBS[activeSubTab]}
          </p>
        </div>
      </div>

      <nav className={`flex gap-1 border-b-2 ${dark ? "border-white/10" : "border-stone-200"}`}>
        {([
          { id: "directory", label: "Directory" },
          { id: "permissions", label: "Permissions" },
          { id: "departments", label: "Departments" },
          { id: "qa_access", label: "QA Dashboard Access" },
        ] as const).map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveSubTab(tab.id)}
            className={`px-4 py-2 text-xs font-bold rounded-t-lg -mb-0.5 border-b-[3px] cursor-pointer transition-colors ${
              activeSubTab === tab.id
                ? "border-blue-600 text-blue-600 dark:text-blue-400"
                : "border-transparent text-content-muted hover:text-content"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      <div className="space-y-5 pb-6">
        {activeSubTab === "directory" && (
          <ProfileAccessManagement theme={theme} usersList={usersList} setUsersList={setUsersList} effectiveTier={effectiveTier} currentUser={currentUser} setChangeLogs={setChangeLogs} departments={departments} featureAccessOverrides={featureAccessOverrides} hiddenPages={hiddenPages} />
        )}
        {activeSubTab === "permissions" && (
          <FeatureAccessManagement theme={theme} effectiveTier={effectiveTier} overrides={featureAccessOverrides} onChanged={onFeatureAccessChanged} logAction={logAction} />
        )}
        {activeSubTab === "departments" && (
          <DepartmentsManagement theme={theme} effectiveTier={effectiveTier} departments={departments} usersList={usersList} onChanged={onDepartmentsChanged} logAction={logAction} />
        )}
        {activeSubTab === "qa_access" && (
          <QaDashboardAccessManagement theme={theme} effectiveTier={effectiveTier} />
        )}
      </div>
    </div>
  );
}
