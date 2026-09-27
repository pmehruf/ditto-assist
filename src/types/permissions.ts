/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface FeaturePermission {
  id: string;
  name: string;
  description: string;
  defaultTier: "General" | "Admin" | "Platform Admin" | "Developer";
  generalAccess: "None" | "Viewer" | "Editor";
  adminAccess: "None" | "Viewer" | "Editor";
}

/** One row of the Developer-editable `feature_access_overrides` table — a
 * null level means "no override for this tier, use the shipped default
 * from DEFAULT_FEATURE_PERMISSIONS". See App.tsx's hasAccess() for how this
 * overlays the shipped defaults.
 *
 * platformAdminAccess has no shipped per-feature default in
 * DEFAULT_FEATURE_PERMISSIONS (unlike general/admin) — a null value there
 * resolves to "Editor" directly in hasAccess()/requireFeatureAccess(), not
 * through a registry lookup, since Platform Admin previously had an
 * unconditional bypass and this preserves that until explicitly narrowed. */
export interface FeatureAccessOverride {
  featureId: string;
  generalAccess: "None" | "Viewer" | "Editor" | null;
  adminAccess: "None" | "Viewer" | "Editor" | null;
  platformAdminAccess: "None" | "Viewer" | "Editor" | null;
}

/** One row of the `departments` table — pure organizational metadata, zero
 * effect on access (see schema.ts's doc comment on the table). */
export interface Department {
  id: number;
  name: string;
  description: string | null;
  active: boolean;
}

/** One row of the `org_teams` table (Bliss / Falcon / Central) — foundation
 * only for now, zero effect on access until a later data-scoping
 * enforcement phase (see schema.ts's doc comment on the table). */
export interface OrgTeam {
  id: number;
  name: string;
  description: string | null;
  active: boolean;
}

/** One row of the `roles` table (Advisor / Mentor / Guide / ...) —
 * independent of both `tier` and QA Dashboard's own admin/guide/mentor
 * role. Foundation only for now, zero effect on access. */
export interface AppRole {
  id: number;
  name: string;
  description: string | null;
  active: boolean;
}

/** One row of the `relationship_groups` table (Mentor / Guide / ...) — the
 * vocabulary usable in user_relationships. Renamed from RelationshipType
 * (2026-09) — same shape, "group" instead of "type" throughout. */
export interface RelationshipGroup {
  id: number;
  name: string;
  description: string | null;
  active: boolean;
  /** Optionally scopes this group to one Department — when set, the
   * Groups tab's roster builder narrows its "owner" picker to that
   * department's members. null = unscoped (every user is a valid owner). */
  departmentId: number | null;
  /** Whether this group's owner->subject rows count toward the Groups
   * tab's tool-visibility restriction. Admin-toggled there, not
   * derived from the group's name — see schema.ts's own comment on this
   * column for why. */
  usedForGroupAccess: boolean;
  /** Which tier of MEMBER this group's `usedForGroupAccess` ceiling
   * restricts (2026-09, migration 0082) — independent of the group's
   * owner's own tier/permissions; setting this to "Admin" does not promote
   * the owner, and a member whose own tier doesn't match this value is
   * entirely unaffected by this group's restriction. Deliberately excludes
   * "Developer" — a group can never be configured to restrict Developer,
   * see schema.ts's comment on `groupTierEnum`. Defaults to "General". */
  groupTier: "General" | "Admin" | "Platform Admin";
}

/** One row of the `user_relationships` table — an explicit person-to-person
 * mapping (e.g. a Mentor's mentees). */
export interface UserRelationship {
  id: number;
  ownerEmail: string;
  subjectEmail: string;
  relationshipGroupId: number;
  createdBy: string;
  createdAt: string;
}

/** One row of the `custom_access_grants` table — a per-individual, add-only
 * access override. Only `grantType === "feature_access"` is functional
 * today (see App.tsx's hasAccess() and schema.ts's doc comment on the
 * table for the max-of, grant-only merge semantics). */
export interface CustomAccessGrant {
  id: number;
  userEmail: string;
  grantType: string;
  targetId: string;
  level: "None" | "Viewer" | "Editor" | null;
  note: string | null;
  active: boolean;
  grantedBy: string;
  grantedAt: string;
}

/** One row of the `access_rules` table — a population-level (not
 * per-individual, unlike CustomAccessGrant) grant: "anyone whose Team/
 * Department/Role/Product Tag matches every non-null condition here gets
 * grantedLevel on resourceKey." See schema.ts's doc comment on the table
 * and docs/ACCESS_CONTROL_CENTER_PHASE_PLAN.md's Phase 1 for the full
 * reasoning. Inert until Phase 3 wires the evaluator into real enforcement. */
export interface AccessRule {
  id: number;
  resourceKey: string;
  name: string;
  active: boolean;
  orgTeamId: number | null;
  departmentId: number | null;
  roleId: number | null;
  productTag: string | null;
  grantedLevel: "None" | "Viewer" | "Editor";
  createdBy: string;
  createdAt: string;
}

/** One row of the `guide_mentor_advisor_mappings` table — an advisor's
 * Guide/Mentor assignment plus their own sheet snapshot (Tact ID, status,
 * etc.), mirrored from master_advisors by the Master Advisors page's own sync.
 * Keyed by tactId, not a user account — see schema.ts's table comment. */
export interface GuideMentorAdvisorMapping {
  id: number;
  tactId: string;
  name: string;
  email: string | null;
  guideName: string | null;
  mentorName: string | null;
  status: string | null;
  skillDomain: string | null;
  batchNumber: string | null;
  /** "yyyy-MM-dd", or null. See MasterAdvisorsManagement.tsx's "Active
   * Till" calculation (earliest of this and lastWorkingDay). */
  dateOfMovingOut: string | null;
  lastWorkingDay: string | null;
  manuallyEdited: boolean;
  lastSyncedAt: string;
  lastSyncedBy: string;
  lastEditedAt: string | null;
  lastEditedBy: string | null;
}

/** One row of the `guide_mentor_relationship_history` table — one past or
 * current Mentor/Guide assignment for an advisor. Guide and Mentor are
 * independent timelines (see `kind`); at most one row per (tactId, kind)
 * has isActive true. `endDate` marks when THIS relationship ended — a
 * different concept from GuideMentorAdvisorMapping's own "Active Till"
 * (when the advisor themselves stops being active), see
 * MasterAdvisorsManagement.tsx. */
export interface GuideMentorRelationshipHistoryRow {
  id: number;
  tactId: string;
  kind: "guide" | "mentor";
  personName: string;
  /** "yyyy-MM-dd" */
  startDate: string;
  /** "yyyy-MM-dd", or null while isActive is true. */
  endDate: string | null;
  isActive: boolean;
  source: "manual" | "sync";
  recordedBy: string;
  recordedAt: string;
}

/** Response shape of GET .../guide-mentor-advisors/:id/history. */
export interface GuideMentorRelationshipHistoryResponse {
  guide: GuideMentorRelationshipHistoryRow[];
  mentor: GuideMentorRelationshipHistoryRow[];
}

/** Response shape of both .../guide-mentor-advisors/sync and .../last-run —
 * see guideMentorRelationshipsSync.ts's GuideMentorRelationshipsSyncResult. */
export interface GuideMentorAdvisorMappingSyncResult {
  recordsRead: number;
  skippedNoTactId: number;
  mappingsWritten: number;
  withGuide: number;
  withMentor: number;
  withBoth: number;
  withNeither: number;
  syncedAt: string;
}
