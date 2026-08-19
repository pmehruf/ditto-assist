/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface LoggedUser {
  email: string;
  name: string;
  tactId: string;
  tier: "General" | "Admin" | "Platform Admin" | "Developer";
  avatarUrl?: string;
  photoUrl?: string;
}

export interface UserProfile {
  email: string;
  name: string;
  tactId: string;
  tier: "General" | "Admin" | "Platform Admin" | "Developer";
  status: "Active" | "Disabled";
  avatarUrl?: string;
  photoUrl?: string;
  // Set by the DB on insert (users.created_at) and already included in GET
  // /api/users's response — just wasn't previously declared here or used by
  // the directory UI. ISO timestamp string once JSON-serialized.
  createdAt?: string;
  lastLogin?: string | null;
  // Skill-domain tags — any subset of "Health" and "Term" (empty/undefined
  // = unassigned). Real, persisted, directly editable via a multi-select —
  // see drizzle/0026_advisor_tags.sql for why this isn't live-joined from
  // the QA sheet.
  tags?: string[];
  // Organizational metadata only — zero effect on access (see schema.ts's
  // doc comment on the `departments` table). null/undefined = unassigned.
  departmentId?: number | null;
  // Foundation-only Team/Role assignment (see schema.ts's doc comments on
  // `org_teams`/`roles`) — captured now for future data-scoping enforcement,
  // zero effect on access today. null/undefined = unassigned.
  orgTeamId?: number | null;
  roleId?: number | null;
}
