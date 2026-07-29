/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Dispatch, SetStateAction } from "react";
import { UserProfile, LoggedUser } from "../types/user";
import { ChangeLogEntry } from "../types/changeLog";
import { ProfileAccessManagement } from "../components/ProfileAccessManagement";

interface ProfileAccessPageProps {
  theme: "light" | "dark";
  usersList: UserProfile[];
  setUsersList: Dispatch<SetStateAction<UserProfile[]>>;
  effectiveTier: "General" | "Admin" | "Developer";
  currentUser: LoggedUser | null;
  setChangeLogs: Dispatch<SetStateAction<ChangeLogEntry[]>>;
}

/**
 * "User Directory" tab content — thin wrapper page. The
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
            <span>User Directory & Management</span>
          </h1>
          <p className="text-xs mt-1 font-semibold text-content-muted">
            Organization-wide record of advisor accounts, TACT IDs, and clearance tiers.
            {effectiveTier === "Developer" ? " Edits here apply to every user immediately." : " Read-only — Developer clearance is required to make changes."}
          </p>
        </div>
      </div>

      <div className="space-y-5 pb-6">
        <ProfileAccessManagement theme={theme} usersList={usersList} setUsersList={setUsersList} effectiveTier={effectiveTier} currentUser={currentUser} setChangeLogs={setChangeLogs} />
      </div>
    </div>
  );
}
