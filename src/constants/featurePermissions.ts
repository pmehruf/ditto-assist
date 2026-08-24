/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { FeaturePermission } from "../types/permissions";

/**
 * Features that are Developer-only as a matter of code, not configuration.
 * These bypass the featurePermissions registry entirely (see App.tsx's
 * hasAccess()) and can never be overridden via feature_access_overrides —
 * see server.ts's PUT /api/feature-access/:featureId, which explicitly
 * rejects writes to any id in this set. Shared here so the Access Control
 * Center's Permissions tab (FeatureAccessManagement.tsx) can render these
 * three rows as visibly locked instead of silently omitting them.
 */
export const DEVELOPER_ONLY_FEATURES = new Set(["owner_controls", "connections", "smoke_test", "product_assist_quota"]);

export const DEFAULT_FEATURE_PERMISSIONS: FeaturePermission[] = [
  {
    id: "lookup",
    name: "Declaration Assist",
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
    // Read-only checker — Viewer-only like coverage_projection/advisory_zone
    // above, visible to every tier including General advisors (no persisted
    // data to edit; this reads the same specificIllnessEngine.ts logic as
    // the Admin Zone's Specific Illness Ledger sandbox, minus its editor).
    id: "specific_illness_check",
    name: "Specific Illness Check",
    description: "Check whether a declared medical condition falls under a plan's 2-year specific illness waiting period",
    defaultTier: "General",
    generalAccess: "Viewer",
    adminAccess: "Viewer"
  },
  {
    // Interactive (asks questions, creates conversation history), so
    // Editor like lookup/resources above rather than the Viewer-only
    // read-only tools — every tier including General can use it.
    id: "product_assist",
    name: "Product Assist",
    description: "Ask questions about insurer plans and get verified answers grounded in the Knowledge Base's documents and announcements",
    defaultTier: "General",
    generalAccess: "Editor",
    adminAccess: "Editor"
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
    defaultTier: "Developer",
    generalAccess: "None",
    adminAccess: "None"
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
    // ACCESS CONTROL CENTER — renamed from "User Management" 2026-08-19 as
    // its scope broadened past the user directory to also cover the
    // Developer-editable feature-access override table (Permissions tab)
    // and departments (Departments tab), alongside the pre-existing
    // Directory and QA Dashboard Access tabs. Internal feature id
    // "profile_access" kept as-is — it's a stored key (page_visibility rows,
    // this constant's own id), not a UI label; renaming it would require a
    // migration for no user-visible benefit.
    id: "profile_access",
    name: "Access Control Center",
    description: "Manage the user directory, feature access permissions, departments, and QA Dashboard roles",
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
    id: "knowledge_base",
    name: "Knowledge Base",
    description: "Manage the documents and announcements that power \"Ask the Playbook\" — per-insurer PDF resources plus a dated announcement override channel",
    defaultTier: "Admin",
    generalAccess: "None",
    adminAccess: "Editor"
  },
  {
    // FEATURE VISIBILITY — page visibility kill switch. Developer-only in
    // every sense: hasAccess() returns true for Developer before any other
    // check, and both General and Admin are "None" here, so no other tier
    // can reach it. (Internal feature id "owner_controls" kept as-is — it's
    // a stored DB key, not a UI label; renaming it would require migrating
    // page_visibility rows. Display name renamed Developer Controls ->
    // Access Controls -> Feature Visibility as this page's scope narrowed —
    // the QA Dashboard/Playbook connection settings that used to also live
    // here moved to their own Connections page below.)
    id: "owner_controls",
    name: "Feature Visibility",
    description: "Show or hide individual pages from everyone except the Developer",
    defaultTier: "Developer",
    generalAccess: "None",
    adminAccess: "None"
  },
  {
    // CONNECTIONS — Google Sheets integrations (QA Dashboard workbook,
    // Product Playbook workbook). Developer-only, same reasoning as Feature
    // Visibility above; split out into its own page rather than living inside
    // either connected feature's own management page since both are
    // "backend plumbing, not a permission" settings.
    id: "connections",
    name: "Connections",
    description: "Connect and manage the Google Sheets integrations (QA Dashboard, Product Playbook)",
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
