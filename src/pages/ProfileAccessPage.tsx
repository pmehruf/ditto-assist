/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Dispatch, SetStateAction } from "react";
import ProfileAccessManagement from "../components/ProfileAccessManagement";
import { DEFAULT_FEATURE_PERMISSIONS } from "../constants/featurePermissions";
import { LoggedUser, UserProfile } from "../types/user";
import { FeaturePermission } from "../types/permissions";

interface ProfileAccessPageProps {
  currentUser: LoggedUser | null;
  effectiveTier: "General" | "Admin" | "Owner";
  usersList: UserProfile[];
  setUsersList: Dispatch<SetStateAction<UserProfile[]>>;
  ownerPasscode: string;
  setOwnerPasscode: (code: string) => void;
  featurePermissions: FeaturePermission[];
  setFeaturePermissions: Dispatch<SetStateAction<FeaturePermission[]>>;
  hasAccess: (featureId: string, actionType: "Viewer" | "Editor") => boolean;
}

/**
 * "Profile & Access Management" tab content. Extracted verbatim from
 * App.tsx (Phase 1.3). The `activeTab === "profile_access" && currentUser`
 * condition and wrapping `<motion.div key="profile_access">` deliberately
 * stay in App.tsx so the parent `<AnimatePresence>` can still see the tab
 * mount/unmount directly and play its exit animation (see ResourcesPage.tsx
 * for the full explanation of why).
 */
export function ProfileAccessPage({
  currentUser,
  effectiveTier,
  usersList,
  setUsersList,
  ownerPasscode,
  setOwnerPasscode,
  featurePermissions,
  setFeaturePermissions,
  hasAccess,
}: ProfileAccessPageProps) {
  return (
    <ProfileAccessManagement
      usersList={usersList}
      setUsersList={setUsersList}
      currentUser={currentUser ? { ...currentUser, tier: effectiveTier } : currentUser}
      ownerPasscode={ownerPasscode}
      setOwnerPasscode={setOwnerPasscode}
      featurePermissions={featurePermissions}
      setFeaturePermissions={setFeaturePermissions}
      defaultFeaturePermissions={DEFAULT_FEATURE_PERMISSIONS}
      hasAccess={hasAccess}
    />
  );
}
