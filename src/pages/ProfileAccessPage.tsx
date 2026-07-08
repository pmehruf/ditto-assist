/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Dispatch, SetStateAction } from "react";
import { User } from "lucide-react";
import { UserProfile } from "../types/user";
import { ProfileAccessManagement } from "../components/ProfileAccessManagement";

interface ProfileAccessPageProps {
  theme: "light" | "dark";
  usersList: UserProfile[];
  setUsersList: Dispatch<SetStateAction<UserProfile[]>>;
  effectiveTier: "General" | "Admin" | "Owner";
}

/**
 * "User Directory" tab content — thin wrapper page. The
 * `activeTab === "profile_access"` condition and wrapping
 * `<motion.div key="profile_access">` deliberately stay in App.tsx
 * (see ResourcesPage.tsx for why).
 *
 * Admin+ only (gated in App.tsx's sidebar/hasAccess via the "profile_access"
 * feature id). Owner can edit; Admin sees a read-only view. All reads/writes
 * go through the server (GET/PUT /api/users in server.ts) so an Owner's edit
 * is reflected for every user, not just the editor's own browser/localStorage.
 */
export function ProfileAccessPage({ theme, usersList, setUsersList, effectiveTier }: ProfileAccessPageProps) {
  return (
    <>
      {/* PAGE-LEVEL HEADER */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 pb-4 border-b border-stone-200 dark:border-stone-800">
        <div>
          <h1 className={`text-xl md:text-2xl font-black tracking-tight flex items-center gap-2 ${
            theme === "dark" ? "text-white" : "text-[#111827]"
          }`}>
            <User className="w-5 h-5 shrink-0" style={{ color: theme === "dark" ? "#00D3F3" : "#4673a9" }} />
            <span>User Directory</span>
          </h1>
          <p className={`text-xs mt-1.5 font-semibold ${
            theme === "dark" ? "text-stone-400" : "text-stone-600"
          }`}>
            Organization-wide record of advisor accounts, TACT IDs, and clearance tiers.
            {effectiveTier === "Owner" ? " Edits here apply to every user immediately." : " Read-only — Owner clearance is required to make changes."}
          </p>
        </div>
      </div>

      <div className="space-y-6 pb-6">
        <ProfileAccessManagement theme={theme} usersList={usersList} setUsersList={setUsersList} effectiveTier={effectiveTier} />
      </div>
    </>
  );
}
