/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { FeaturePermission } from "../types/permissions";

export const DEFAULT_FEATURE_PERMISSIONS: FeaturePermission[] = [
  {
    id: "lookup",
    name: "Declaration Assistant",
    description: "Search and medical policy category mapping assistant",
    defaultTier: "General",
    generalAccess: "Editor",
    adminAccess: "Editor"
  },
  {
    id: "my_activity",
    name: "My Activity Log",
    description: "Personal lookup search tracker and history log",
    defaultTier: "General",
    generalAccess: "Editor",
    adminAccess: "Editor"
  },
  {
    id: "resources",
    name: "Workspace Resources",
    description: "Helpful external documents, links, and training resources",
    defaultTier: "General",
    generalAccess: "Editor",
    adminAccess: "Editor"
  },
  {
    id: "audit",
    name: "Activity Log",
    description: "Comprehensive audits of all searches, reported illness mapping discrepancies, and mismatches",
    defaultTier: "Admin",
    generalAccess: "None",
    adminAccess: "Editor"
  },
  {
    id: "profile_access",
    name: "User Management",
    description: "Governs systemic user directory logs, security passcodes, and active permissions overrides list",
    defaultTier: "Admin",
    generalAccess: "None",
    adminAccess: "Viewer"
  },
  {
    id: "plan_scope",
    name: "Specific Illness Ledger",
    description: "Advanced mapping schema configurations, question exclusions, and custom clinical exception flags",
    defaultTier: "Admin",
    generalAccess: "None",
    adminAccess: "Editor"
  },
  {
    id: "qa_announcement_log",
    name: "Announcement Manager",
    description: "Publish and manage live QA payment and compliance notices with effective dates",
    defaultTier: "Admin",
    generalAccess: "None",
    adminAccess: "Editor"
  },
  {
    id: "flagged_responses",
    name: "Flagged Responses",
    description: "Dedicated page to review and resolve advisor-flagged mapping discrepancies and mismatch reports",
    defaultTier: "Admin",
    generalAccess: "None",
    adminAccess: "Editor"
  },
  {
    id: "clear_activity",
    name: "Clear Activity & Mismatch Logs",
    description: "Erase history of user lookups and resolve/purge active mismatch records",
    defaultTier: "Owner",
    generalAccess: "None",
    adminAccess: "None"
  }
];
