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

/** One row of the `relationship_types` table (Mentor / Guide / ...) — the
 * vocabulary usable in user_relationships. */
export interface RelationshipType {
  id: number;
  name: string;
  description: string | null;
  active: boolean;
}

/** One row of the `user_relationships` table — an explicit person-to-person
 * mapping (e.g. a Mentor's mentees). */
export interface UserRelationship {
  id: number;
  ownerEmail: string;
  subjectEmail: string;
  relationshipTypeId: number;
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
