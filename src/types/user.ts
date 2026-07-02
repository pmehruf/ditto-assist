/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface LoggedUser {
  email: string;
  name: string;
  tactId: string;
  tier: "General" | "Admin" | "Owner";
  avatarUrl?: string;
  photoUrl?: string;
}

export interface UserProfile {
  email: string;
  name: string;
  tactId: string;
  tier: "General" | "Admin" | "Owner";
  status: "Active" | "Pending First Login";
  avatarUrl?: string;
  photoUrl?: string;
}
