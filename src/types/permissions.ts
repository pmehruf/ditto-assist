/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface FeaturePermission {
  id: string;
  name: string;
  description: string;
  defaultTier: "General" | "Admin" | "Developer";
  generalAccess: "None" | "Viewer" | "Editor";
  adminAccess: "None" | "Viewer" | "Editor";
}

/** One row of the Developer-editable `feature_access_overrides` table — a
 * null level means "no override for this tier, use the shipped default
 * from DEFAULT_FEATURE_PERMISSIONS". See App.tsx's hasAccess() for how this
 * overlays the shipped defaults. */
export interface FeatureAccessOverride {
  featureId: string;
  generalAccess: "None" | "Viewer" | "Editor" | null;
  adminAccess: "None" | "Viewer" | "Editor" | null;
}

/** One row of the `departments` table — pure organizational metadata, zero
 * effect on access (see schema.ts's doc comment on the table). */
export interface Department {
  id: number;
  name: string;
  description: string | null;
  active: boolean;
}
