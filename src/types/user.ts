/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface LoggedUser {
  email: string;
  name: string;
  tactId: string;
  tier: "General" | "Admin" | "Developer";
  avatarUrl?: string;
  photoUrl?: string;
}

export interface UserProfile {
  email: string;
  name: string;
  tactId: string;
  tier: "General" | "Admin" | "Developer";
  status: "Active" | "Disabled";
  avatarUrl?: string;
  photoUrl?: string;
  // Set by the DB on insert (users.created_at) and already included in GET
  // /api/users's response — just wasn't previously declared here or used by
  // the directory UI. ISO timestamp string once JSON-serialized.
  createdAt?: string;
  lastLogin?: string | null;
  // "Health advisor" | "Term advisor" | "Both advisor" | "Manager" | null
  // (unassigned). Real, persisted, directly editable — see
  // drizzle/0024_add_advisor_role.sql for why this isn't live-joined from
  // the QA sheet the way it briefly was.
  advisorRole?: string | null;
}
