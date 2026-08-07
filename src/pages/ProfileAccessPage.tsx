/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { UserProfile, LoggedUser } from "../types/user";
import { ChangeLogEntry } from "../types/changeLog";
import { ProfileAccessManagement } from "../components/ProfileAccessManagement";
import { QaDashboardAccessManagement } from "../components/QaDashboardAccessManagement";

interface ProfileAccessPageProps {
  theme: "light" | "dark";
  usersList: UserProfile[];
  setUsersList: Dispatch<SetStateAction<UserProfile[]>>;
  effectiveTier: "General" | "Admin" | "Developer";
  currentUser: LoggedUser | null;
  setChangeLogs: Dispatch<SetStateAction<ChangeLogEntry[]>>;
}

/**
 * "User Management" tab content — thin wrapper page. The
 * `activeTab === "profile_access"` condition and wrapping
 * `<motion.div key="profile_access">` deliberately stay in App.tsx
 * (see ResourcesPage.tsx for why).
 *
 * Admin+ only (gated in App.tsx's sidebar/hasAccess via the "profile_access"
 * feature id). Developer can edit; Admin sees a read-only view. All reads/writes
 * go through the server (GET/PUT /api/users in server.ts) so an Developer's edit
 * is reflected for every user, not just the editor's own browser/localStorage.
 */
export function ProfileAccessPage({ theme, usersList, setUsersList, effectiveTier, currentUser, setChangeLogs }: ProfileAccessPageProps) {
  const [activeSubTab, setActiveSubTab] = useState<"directory" | "qa_access">("directory");
  const dark = theme === "dark";

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
            <span>User Management</span>
          </h1>
          <p className="text-xs mt-1 font-semibold text-content-muted">
            {activeSubTab === "directory"
              ? <>Organization-wide record of advisor accounts, TACT IDs, and clearance tiers.{effectiveTier === "Developer" ? " Edits here apply to every user immediately." : " Read-only — Developer clearance is required to make changes."}</>
              : "Who holds Admin/Guide/Mentor access on the QA Dashboard, separate from the WebApp tiers above."}
          </p>
        </div>
      </div>

      <nav className={`flex gap-1 border-b-2 ${dark ? "border-white/10" : "border-stone-200"}`}>
        {([
          { id: "directory", label: "Directory" },
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
        {activeSubTab === "directory" ? (
          <ProfileAccessManagement theme={theme} usersList={usersList} setUsersList={setUsersList} effectiveTier={effectiveTier} currentUser={currentUser} setChangeLogs={setChangeLogs} />
        ) : (
          <QaDashboardAccessManagement theme={theme} effectiveTier={effectiveTier} />
        )}
      </div>
    </div>
  );
}
