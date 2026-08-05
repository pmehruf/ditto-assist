/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { FeaturePermission } from "../types/permissions";

export const DEFAULT_FEATURE_PERMISSIONS: FeaturePermission[] = [
  {
    id: "lookup",
    name: "Ditto Assist",
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
    // ADVISORY ZONE — read-only reference, visible to every tier including
    // General advisors (unlike Admin Zone features below, which are
    // generalAccess: "None"). Viewer-only on purpose: there is nothing to
    // edit on this page for any tier.
    id: "advisory_zone",
    name: "Plan Reference",
    description: "Read-only reference of every plan's payment journey questions and specific illness list",
    defaultTier: "General",
    generalAccess: "Viewer",
    adminAccess: "Viewer"
  },
  {
    // ANNOUNCEMENTS ARCHIVE — read-only history of every posted announcement
    // (both QA and General), visible to every tier just like advisory_zone
    // above. The lookup page's carousel only ever shows the latest ~10; this
    // is the full searchable/filterable backlog.
    id: "announcement_archive",
    name: "Announcements",
    description: "Full searchable archive of every posted announcement, with a date filter",
    defaultTier: "General",
    generalAccess: "Viewer",
    adminAccess: "Viewer"
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
    // Read-only calculator — Viewer-only like advisory_zone, visible to
    // every tier including General advisors (no persisted data to edit).
    id: "coverage_projection",
    name: "Coverage Projection Studio",
    description: "Illustrate Base Cover, Bonus, and Restoration Benefit projections across policy years for supported plans",
    defaultTier: "General",
    generalAccess: "Viewer",
    adminAccess: "Viewer"
  },
  {
    // QA DASHBOARD — read-only advisor QA scorecard, ported from the
    // standalone Apps Script tool. Visible to every tier (Viewer for both,
    // like coverage_projection above), matching that tool's "Anyone within
    // Ditto" deployment access — the page's own Admin/Guide/Mentor/Advisor
    // role logic (src/server/qaDashboard/qaRoles.ts, sourced from the
    // qa_dashboard_roles DB table — managed via User Directory & Management's
    // "QA Dashboard Access" tab, NOT this app's General/Admin/Developer
    // tiers) decides what each signed-in person actually sees, exactly as it
    // did in the original tool.
    id: "qa_dashboard",
    name: "QA Dashboard",
    description: "Read-only advisor QA scorecard (Lead Score, Payments QA, feedback and dispute/escalation history) sourced live from the QA team's Google Sheet",
    defaultTier: "General",
    generalAccess: "Viewer",
    adminAccess: "Viewer"
  },
  {
    id: "smoke_test",
    name: "Smoke Test",
    description: "Run the deterministic mapping engine against a curated list of common PEDs, per plan, to catch classification regressions",
    defaultTier: "Admin",
    generalAccess: "None",
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
    name: "Plan Management",
    description: "Add or edit insurance plans' declaration questionnaires and category-to-question mappings",
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
    id: "ped_suggestions",
    name: "PED Repository",
    description: "Manage the application's PED repository and review AI-assisted mapping recommendations before they become part of the knowledge base",
    defaultTier: "Admin",
    generalAccess: "None",
    adminAccess: "Editor"
  },
  {
    // OWNER CONTROLS — page visibility kill switch. Developer-only in every
    // sense: hasAccess() returns true for Developer before any other check,
    // and both General and Admin are "None" here, so no other tier can reach it.
    // (Internal feature id "owner_controls" kept as-is — it's a stored DB key,
    // not a UI label; renaming it would require migrating page_visibility rows.)
    id: "owner_controls",
    name: "Developer Controls",
    description: "Show or hide individual pages from everyone except the Developer",
    defaultTier: "Developer",
    generalAccess: "None",
    adminAccess: "None"
  },
  {
    id: "clear_activity",
    name: "Clear Activity & Mismatch Logs",
    description: "Erase history of user lookups and resolve/purge active mismatch records",
    defaultTier: "Developer",
    generalAccess: "None",
    adminAccess: "None"
  }
];
