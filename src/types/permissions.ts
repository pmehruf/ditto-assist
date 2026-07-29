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
