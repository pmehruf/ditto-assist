/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * QA DASHBOARD — ROLE HELPERS
 * ---------------------------------------------------------------
 * Four roles, checked in this priority order — Admin, then Guide, then
 * Mentor, then plain Advisor. Guide and Mentor are independent: nobody
 * holds both (enforced by qa_dashboard_roles.role being a single column,
 * not a set of flags).
 *
 *   Admin   — full access: sees every advisor in the allowlist.
 *   Guide   — sees only their team, matched against the "Guide" column of
 *             master_advisors.
 *   Mentor  — sees only their mentees, matched against the "Mentor Name"
 *             column (column E) of master_advisors.
 *   Advisor — everyone else. Sees only their own record (if any).
 *
 * Source of truth for who holds which role: the `qa_dashboard_roles`
 * Postgres table, managed from the "QA Dashboard Access" tab in User
 * Directory & Management (see src/components/QaDashboardAccessManagement.tsx
 * and the /api/qa-dashboard/roles routes in server.ts). This replaced the
 * former QA_ADMIN_EMAILS/QA_GUIDE_EMAILS/QA_MENTOR_EMAILS env vars (and
 * their _NAME_MAP counterparts) as of the 2026-07-30 cutover migration
 * (drizzle/0022_qa_dashboard_roles.sql), which backfilled the exact
 * membership those env vars held at the time. The env vars are no longer
 * read anywhere in this file.
 */

import { getDb } from "../db/client.js";
import { createRepositories } from "../db/repositories/index.js";

export interface QaCallerRole {
  isAdmin: boolean;
  isGuide: boolean;
  isMentor: boolean;
  /** Guide/Mentor display name as it should appear in master_advisors
   * (the row's stored displayName), or a name derived from the Admin's own
   * email — whichever role applies. Empty for a plain Advisor with no
   * elevated role. */
  callerName: string;
}

function displayNameFromEmail(email: string): string {
  const prefix = email.split("@")[0]?.split(".")[0] || email;
  return prefix.charAt(0).toUpperCase() + prefix.slice(1);
}

/** Resolves a caller's QA Dashboard role from their verified app-login
 * email by looking up `qa_dashboard_roles`. Priority order Admin > Guide >
 * Mentor > (none) is moot in practice since each row holds exactly one
 * role, but kept as the same shape BackendAPI.gs's role-priority comment
 * described, for continuity with the rest of this port. */
export async function resolveQaCallerRole(email: string): Promise<QaCallerRole> {
  const { qaDashboardRoles } = createRepositories(getDb());
  const row = await qaDashboardRoles.getByEmail(email);
  if (!row) {
    return { isAdmin: false, isGuide: false, isMentor: false, callerName: "" };
  }
  const callerName = row.displayName?.trim() || displayNameFromEmail(row.email);
  return {
    isAdmin: row.role === "admin",
    isGuide: row.role === "guide",
    isMentor: row.role === "mentor",
    callerName,
  };
}
