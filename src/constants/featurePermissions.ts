/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { FeaturePermission } from "../types/permissions";

/**
 * Historically held "owner_controls"/"connections"/"smoke_test"/
 * "product_assist_quota" as a hard, un-overridable Developer-only gate
 * (checked before the featurePermissions registry in both
 * accessRuleEvaluator.ts's resolveAccess() and server.ts's
 * requireFeatureAccess()). Emptied (2026-09) at the user's explicit request
 * — those four are now ordinary governed features: they resolve through the
 * exact same registry/override/Access-Rule/Custom-Grant pipeline as every
 * other feature, and their rows in the Permissions tab
 * (FeatureAccessManagement.tsx) are editable rather than locked. Every
 * server route those four features' pages depend on was rewired from its
 * old hardcoded tier check to requireFeatureAccess(featureId, ...) so a
 * Permissions-tab grant actually takes effect end to end, not just in the
 * UI. Kept as an exported (now-empty) Set rather than deleted outright, so
 * every existing `DEVELOPER_ONLY_FEATURES.has(...)` call site across the
 * app keeps compiling and behaves correctly (always false) with no further
 * changes needed at those sites — re-populate it here if a genuinely
 * code-level (not policy-level) Developer-only feature is ever needed
 * again.
 */
export const DEVELOPER_ONLY_FEATURES = new Set<string>([]);

export const DEFAULT_FEATURE_PERMISSIONS: FeaturePermission[] = [
  {
    // DECLARATION ASSIST — Viewer, not Editor (corrected 2026-09, permission
    // architecture fix): entering PED/medical details, editing input fields,
    // selecting plans, running the mapping, and viewing results are all
    // normal feature USE, not administration — this page has no
    // configuration/admin action of its own (mapping/plan configuration
    // lives entirely in separate governed features: plan_scope,
    // ped_suggestions, knowledge_base). Nothing anywhere in the app ever
    // checks `hasAccess("lookup", "Editor")`/`requireFeatureAccess(...,
    // "lookup", "Editor", ...)`, so this was a mislabeled default with zero
    // behavioral effect either way — corrected to Viewer so the Permissions
    // tab's label actually reflects what the level means, per the
    // Viewer=normal-use/Editor=administration distinction now enforced
    // app-wide.
    id: "lookup",
    name: "Declaration Assist",
    description: "Search and medical policy category mapping assistant",
    defaultTier: "General",
    generalAccess: "Viewer",
    adminAccess: "Viewer",
    zone: "advisor"
  },
  {
    // MY ACTIVITY LOG — Viewer, not Editor (same 2026-09 correction as
    // "lookup" above): viewing one's own search history is normal use, not
    // administration. "Clear Activity" is a separate, distinct governed
    // feature (`clear_activity`, gated on its own Editor check in App.tsx),
    // not an action gated by my_activity's own Editor level — so my_activity
    // itself has no admin action to reserve Editor for. No code anywhere
    // checks `hasAccess("my_activity", "Editor")`.
    id: "my_activity",
    name: "My Activity Log",
    description: "Personal lookup search tracker and history log",
    defaultTier: "General",
    generalAccess: "Viewer",
    adminAccess: "Viewer",
    zone: "advisor"
  },
  {
    // ADVISORY ZONE — read-only reference, visible to every tier including
    // General advisors (unlike Admin Zone features below, which are
    // generalAccess: "None"). Viewer-only on purpose: there is nothing to
    // edit on this page for any tier.
    id: "advisory_zone",
    name: "Payment Journey",
    description: "Read-only reference of every plan's payment journey questions and specific illness list",
    defaultTier: "General",
    generalAccess: "Viewer",
    adminAccess: "Viewer",
    zone: "advisor"
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
    adminAccess: "Viewer",
    zone: "advisor"
  },
  {
    id: "resources",
    name: "Workspace Resources",
    description: "Helpful external documents, links, and training resources",
    defaultTier: "General",
    // Registry/route mismatch fixed (2026-08): this was "Editor", but the
    // actual mutation routes (add/edit/delete/reorder, in App.tsx's
    // Workspace Controls drawer + /api/external-resources) have always been
    // gated to Admin/Developer/Platform Admin only — see schema.ts's
    // external_resources doc comment ("Read by everyone; writable by
    // Admin/Developer only") and App.tsx's own comment on the
    // externalResources state. General was never actually able to write
    // here; "Editor" was a stale label with no matching route. Corrected to
    // "Viewer" to match the real, unchanged behavior — General still reads
    // and clicks resource links exactly as before.
    generalAccess: "Viewer",
    adminAccess: "Editor",
    zone: "advisor"
  },
  {
    // Read-only calculator — Viewer-only like coverage_projection below,
    // visible to every tier including General advisors. Entirely
    // client-side/input-driven (see portingAssistEngine.ts) — no persisted
    // data of its own to edit.
    id: "porting_assist",
    name: "Porting Assist",
    description: "Calculate and visually explain waiting-period carry-forward for a health-insurance porting case",
    defaultTier: "General",
    generalAccess: "Viewer",
    adminAccess: "Viewer",
    zone: "advisor"
  },
  {
    // Read-only calculator — Viewer-only like advisory_zone, visible to
    // every tier including General advisors (no persisted data to edit).
    id: "coverage_projection",
    name: "Cover Projection Assist",
    description: "Illustrate Base Cover, Bonus, and Restoration Benefit projections across policy years for supported plans",
    defaultTier: "General",
    generalAccess: "Viewer",
    adminAccess: "Viewer",
    zone: "advisor"
  },
  {
    // Read-only checker — Viewer-only like coverage_projection/advisory_zone
    // above, visible to every tier including General advisors (no persisted
    // data to edit; this reads the same specificIllnessEngine.ts logic as
    // the Admin Zone's Specific Illness Ledger sandbox, minus its editor).
    id: "specific_illness_check",
    name: "Specific Illness Assist",
    description: "Check whether a declared medical condition falls under a plan's 2-year specific illness waiting period",
    defaultTier: "General",
    generalAccess: "Viewer",
    adminAccess: "Viewer",
    zone: "advisor"
  },
  {
    // PRODUCT ASSIST — Viewer, not Editor (corrected 2026-09, permission
    // architecture fix): asking questions and reading verified answers is
    // normal use, even though it's interactive and creates conversation
    // history — that's still using the feature, not administering it. This
    // page has no admin/configuration action of its own (credit/quota
    // administration is the separate `product_assist_quota` feature; content
    // administration is `knowledge_base`). Nothing checks
    // `hasAccess("product_assist", "Editor")` anywhere.
    id: "product_assist",
    name: "Product Assist",
    description: "Ask questions about insurer plans and get verified answers grounded in the Knowledge Base's documents and announcements",
    defaultTier: "General",
    generalAccess: "Viewer",
    adminAccess: "Viewer",
    zone: "advisor"
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
    adminAccess: "Viewer",
    zone: "advisor"
  },
  {
    // TEAM TRACKER — month-by-month QA performance view for a Guide's team
    // or a Mentor's mentees (Admin picks either). Same "Viewer for every
    // tier" posture as qa_dashboard above: this app's General/Admin/
    // Developer tiers don't gate it at all — the real gate is the QA
    // Dashboard Admin/Guide/Mentor role (qa_dashboard_roles DB table,
    // src/server/qaDashboard/teamTrackerService.ts), which decides both
    // whether the sidebar link even shows (App.tsx's qaTeamTrackerAllowed
    // probe) and whether the page's own data routes answer at all.
    id: "team_tracker",
    name: "Team Tracker",
    description: "Month-by-month QA performance tracker for a Guide's team or a Mentor's mentees, reusing the QA Dashboard's own scoring",
    defaultTier: "General",
    generalAccess: "Viewer",
    adminAccess: "Viewer",
    zone: "advisor"
  },
  {
    // QIP EXCEPTION REQUEST — builds the Word (.docx) QIP exception request.
    // Same posture as team_tracker above: Viewer for every tier here, the
    // real gate is the QA Dashboard Admin/Guide/Mentor role (sidebar link via
    // App.tsx's qaTeamTrackerAllowed probe; /api/qip-exception/draft checks
    // the role again server-side).
    id: "qip_exception",
    name: "QIP Exception Request",
    description: "Helps you create a QIP exception request document for your advisors, based on the details you enter",
    defaultTier: "General",
    generalAccess: "Viewer",
    adminAccess: "Viewer",
    zone: "advisor"
  },
  {
    id: "smoke_test",
    name: "Smoke Test",
    description: "Run the deterministic mapping engine against a curated list of common PEDs, per plan, to catch classification regressions",
    defaultTier: "Developer",
    generalAccess: "None",
    adminAccess: "None",
    zone: "developer"
  },
  {
    id: "audit",
    name: "Activity Log",
    description: "Comprehensive audits of all searches, reported illness mapping discrepancies, and mismatches",
    defaultTier: "Admin",
    generalAccess: "None",
    adminAccess: "Editor",
    zone: "admin"
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
    adminAccess: "Viewer",
    zone: "administrative"
  },
  {
    // DIRECTORY — 2026-09g, at the user's explicit request ("add rows to
    // control tier based access for all main sections individually...
    // Directory, Permissions, QA Access Groups, and Master Advisors"): the
    // Access Control Center's own top-level tabs got their own individually
    // governable featureId, mirroring the pattern group_management/
    // master_advisors already established for their own sub-tabs.
    // "profile_access" (above) still gates whether the Access Control
    // Center is reachable at all (the sidebar entry); this one gates
    // whether the "Directory" tab specifically is visible once inside it —
    // see ProfileAccessPage.tsx's canViewDirectory. Deliberately Viewer-only
    // in practice: WHO can edit a directory entry is governed by
    // effectiveTier directly (Developer/Platform Admin edit, Admin
    // read-only), unchanged by this featureId's own Editor level.
    id: "profile_access_directory",
    name: "Access Control Center — Directory",
    description: "View the organization-wide user directory tab inside Access Control Center",
    defaultTier: "Admin",
    generalAccess: "None",
    adminAccess: "Viewer",
    zone: "administrative"
  },
  {
    // PERMISSIONS — 2026-09g, same reasoning as profile_access_directory
    // above, for the "Permissions" top-level tab (Feature Defaults,
    // Organization, Access Rules, Groups, Custom Grants, Change History —
    // each of those sub-sections still has its own finer-grained gate
    // where one already exists, e.g. group_management for the Groups
    // sub-tab; this featureId is the coarser "can this tab be opened at
    // all" gate for the rest).
    id: "profile_access_permissions",
    name: "Access Control Center — Permissions",
    description: "View the Permissions tab (Feature Defaults, Organization, Access Rules, Groups, Custom Grants) inside Access Control Center",
    defaultTier: "Admin",
    generalAccess: "None",
    adminAccess: "Viewer",
    zone: "administrative"
  },
  {
    // CHANGE HISTORY — promoted out of the Permissions sub-nav to its own
    // top-level tab, next to Master Advisors, at the user's explicit
    // request, and given its own individually governable featureId, same
    // pattern as profile_access_directory/profile_access_permissions/
    // qa_access_groups above (rather than continuing to piggyback on
    // profile_access_permissions once it's no longer nested under that
    // tab). Deliberately Viewer-only in practice — Change History is a
    // read-only audit log, there's nothing here for an Editor level to mean.
    id: "profile_access_change_history",
    name: "Access Control Center — Change History",
    description: "View the audit log of every change made across Access Control Center, including the Directory",
    defaultTier: "Admin",
    generalAccess: "None",
    adminAccess: "Viewer",
    zone: "administrative"
  },
  {
    // QA ACCESS GROUPS — 2026-09g, renamed from "QA Dashboard Access" and
    // promoted to its own top-level tab (previously a Permissions
    // sub-section) at the user's explicit request. Governs who holds
    // Admin/Guide/Mentor access ON the QA Dashboard — a completely
    // separate axis from this app's own General/Admin/Developer tiers, and
    // separate from the "qa_dashboard" featureId above (which gates the
    // read-only QA Dashboard page itself, not who administers its roles).
    id: "qa_access_groups",
    name: "QA Access Groups",
    description: "Manage who holds Admin/Guide/Mentor access on the QA Dashboard, separate from the WebApp tiers",
    defaultTier: "Admin",
    generalAccess: "None",
    adminAccess: "Viewer",
    zone: "administrative"
  },
  {
    // GROUP MANAGEMENT — 2026-09, the Group Level Access redesign's
    // delegated-permission answer to "an Admin who owns/administers groups
    // needs to actually edit Relationships/Group Access, not just view
    // them, without becoming Platform Admin." Deliberately its OWN featureId
    // rather than reusing "profile_access" Editor: profile_access gates
    // custom_access_grants/access_rules/departments/teams/roles/the user
    // directory too — server.ts's requireFeatureAccess() comment explains
    // why THOSE routes deliberately stay off the Custom-Grant-aware path
    // (a grant on something that can itself grant further access is a
    // self-escalation hole). group_management is narrower by construction:
    // it only gates relationship-groups/user-relationships/group-access
    // routes, whose only effect is restricting/unrestricting a member's own
    // access to GROUP_RESTRICTABLE_FEATURES (ordinary workspace tools) —
    // there is no path from holding this to granting oneself or anyone else
    // more than that, so it's safe to let a Custom Grant raise it, same as
    // any ordinary feature. Admin gets Viewer by default (can see the
    // Groups tab read-only, matching profile_access's own default posture)
    // but needs an explicit Editor-level grant here to actually manage
    // groups — see this app's Custom Grants tab, which lists this by its
    // `name` below.
    //
    // GROUP TIER WIDENED WHO CAN BE AFFECTED (2026-09, migration 0082,
    // superseding this comment's original "General-tier member" framing):
    // a relationship_groups row now has its own `groupTier`
    // (General/Admin/Platform Admin, default General — see schema.ts),
    // selecting which tier of MEMBER its restriction ceiling applies to.
    // The safety argument above still holds unchanged — this can still
    // never grant more than GROUP_RESTRICTABLE_FEATURES, and never raises
    // anyone past their own tier's normal ceiling on those features — but
    // an Admin holding only a Custom Grant for group_management (not
    // Platform Admin) can now configure a group that restricts OTHER
    // Admin- or Platform-Admin-tier members' access to those tools, not
    // just General-tier ones as before. That's a wider "who can be
    // affected" surface than this permission originally had, though still
    // not a privilege-escalation path (it restricts, never grants beyond
    // the ceiling above) — noted here rather than left silently stale, and
    // deliberately NOT paired with a new privilege check on `groupTier`
    // itself: `groupTier` is independent of the group owner's/editor's own
    // tier by design (see schema.ts), and nothing in that design calls for
    // gating it beyond the existing group_management Editor boundary.
    id: "group_management",
    name: "Group Management",
    description: "Create/edit relationship groups, map members to a group owner, and configure a group's workspace-tool access",
    defaultTier: "Admin",
    generalAccess: "None",
    adminAccess: "Viewer",
    zone: "administrative"
  },
  {
    // MASTER ADVISORS — 2026-09, split out of Access Control Center's
    // Relationships tab (the "Guide/Mentor -> Advisor mapping" section,
    // synced from the Advisor Directory sheet) into its own top-level page,
    // since it was never really a "relationship" in the group/mapping
    // sense used by the rest of that tab (since renamed to the Groups tab)
    // — see MasterAdvisorsManagement.tsx's own doc comment. Admin sees
    // read-only by default (Viewer), same posture as profile_access/
    // group_management — but as of the 2026-09 permission-architecture fix,
    // editing/removing an individual mapping is a genuinely ordinary
    // feature-management action (not part of the authorization system
    // itself), so it now centralizes through this Editor level exactly like
    // group_management: an Admin holding an explicit Custom Grant here can
    // edit/delete mappings, not just Developer/Platform Admin. (Corrected
    // from an earlier hardcoded Developer/Platform-Admin-only client+server
    // check that ignored this registry entry entirely.) The Advisor
    // Directory sheet SYNC action stays a distinct "connections" Editor
    // capability, unchanged — pulling from Google Sheets is a Connections
    // action, not a Master-Advisors-data-editing one.
    id: "master_advisors",
    name: "Master Advisors",
    description: "Every advisor's Guide/Mentor assignment and Tact ID/status/employment snapshot, synced from the Advisor Directory sheet",
    defaultTier: "Admin",
    generalAccess: "None",
    adminAccess: "Viewer",
    zone: "administrative"
  },
  {
    id: "plan_scope",
    name: "Plan Management",
    description: "Add or edit insurance plans' declaration questionnaires and category-to-question mappings",
    defaultTier: "Admin",
    generalAccess: "None",
    adminAccess: "Editor",
    zone: "admin"
  },
  {
    id: "qa_announcement_log",
    name: "Announcement Manager",
    description: "Publish and manage live QA payment and compliance notices with effective dates",
    defaultTier: "Admin",
    generalAccess: "None",
    adminAccess: "Editor",
    zone: "admin"
  },
  {
    id: "flagged_responses",
    name: "Flagged Responses",
    description: "Dedicated page to review and resolve advisor-flagged mapping discrepancies and mismatch reports",
    defaultTier: "Admin",
    generalAccess: "None",
    adminAccess: "Editor",
    zone: "admin"
  },
  {
    id: "ped_suggestions",
    name: "PED Repository",
    description: "Manage the application's PED repository and review AI-assisted mapping recommendations before they become part of the knowledge base",
    defaultTier: "Admin",
    generalAccess: "None",
    adminAccess: "Editor",
    zone: "admin"
  },
  {
    id: "knowledge_base",
    name: "Knowledge Base",
    description: "Manage the documents and announcements that power \"Ask the Playbook\" — per-insurer PDF resources plus a dated announcement override channel",
    defaultTier: "Admin",
    generalAccess: "None",
    adminAccess: "Editor",
    zone: "admin"
  },
  {
    // FEATURE VISIBILITY — page visibility kill switch. Shipped defaults
    // keep it Developer/Platform-Admin-reachable only (General and Admin
    // both "None" — Platform Admin still gets Editor by default through
    // resolveAccess()'s separate platformAdminAccess branch, matching what
    // its old hardcoded isDeveloperPower check already allowed), but as of
    // 2026-09 this is no longer a hard, un-overridable gate (see
    // DEVELOPER_ONLY_FEATURES's doc comment) — a Developer can now raise
    // General/Admin access here from the Permissions tab like any other
    // feature. (Internal feature id "owner_controls" kept as-is — it's a
    // stored DB key, not a UI label; renaming it would require migrating
    // page_visibility rows. Display name renamed Developer Controls ->
    // Access Controls -> Feature Visibility as this page's scope narrowed —
    // the QA Dashboard/Playbook connection settings that used to also live
    // here moved to their own Connections page below.)
    id: "owner_controls",
    name: "Feature Visibility",
    description: "Show or hide individual pages from everyone except the Developer",
    defaultTier: "Developer",
    generalAccess: "None",
    adminAccess: "None",
    zone: "developer"
  },
  {
    // CONNECTIONS — Google Sheets integrations (QA Dashboard, Product
    // Playbook, Health FAQ, Term FAQ) plus the Advisor Directory Sync and
    // Product Assist Log Export actions that live on the same Connections
    // page. adminAccess defaults to "Editor" (not "None") specifically to
    // preserve this feature's actual pre-2026-09 behavior: every one of its
    // server routes was gated by requireAdminOrDeveloper (Admin OR
    // Platform Admin OR Developer), not Developer-only like Feature
    // Visibility/AI Usage & Limits below — DEVELOPER_ONLY_FEATURES only
    // ever controlled whether a plain Admin could SEE the page, never
    // whether their server calls succeeded. Un-hardcoding it (2026-09,
    // Connections routes rewired from requireAdminOrDeveloper to
    // requireFeatureAccess) without this default would have silently
    // dropped every existing Admin's access to "None" the moment
    // DEVELOPER_ONLY_FEATURES emptied. Split out into its own page rather
    // than living inside any one connected feature's own management page,
    // since all of this is "backend plumbing, not a permission" setting.
    id: "connections",
    name: "Connections",
    description: "Connect and manage the Google Sheets integrations (QA Dashboard, Product Playbook, Health FAQ, Term FAQ) and the Advisor Directory Sync / Product Assist Log Export actions",
    defaultTier: "Developer",
    generalAccess: "None",
    adminAccess: "Editor",
    zone: "admin"
  },
  {
    id: "clear_activity",
    name: "Clear Activity & Mismatch Logs",
    description: "Erase history of user lookups and resolve/purge active mismatch records",
    defaultTier: "Developer",
    generalAccess: "None",
    adminAccess: "None",
    zone: "developer"
  },
  {
    // AI USAGE & LIMITS — Product Assist credit/quota management. Shipped
    // defaults keep it Developer/Platform-Admin-reachable only (same
    // reasoning as Feature Visibility above — its own server routes were
    // isDeveloperPower-only, i.e. Developer or Platform Admin, never plain
    // Admin, so "adminAccess: None" here preserves that exactly). No longer
    // a hard, un-overridable gate as of 2026-09 — see DEVELOPER_ONLY_
    // FEATURES's doc comment.
    id: "product_assist_quota",
    name: "AI Usage & Limits",
    description: "Manage Product Assist credit allowances and usage limits",
    defaultTier: "Developer",
    generalAccess: "None",
    adminAccess: "None",
    zone: "admin"
  },
  {
    // PRODUCT PLAYBOOK MIRROR — CONTROL TOOLS (2026-10): connecting the
    // read-only Google access, fetching, verifying, rejecting and rolling back
    // snapshots, accepting structure changes, and the admin review screen.
    // Platform Admin (and Developer) only for now (decision 2026-10-30):
    // general and Admin tiers have no access by default. Enforced server-side
    // through requireFeatureAccess on every control route.
    id: "product_playbook_admin",
    name: "Product Playbook Mirror (Controls)",
    description: "Connect, fetch, verify, reject or roll back the Product Playbook mirror's snapshots",
    defaultTier: "Platform Admin",
    generalAccess: "None",
    adminAccess: "None",
    zone: "admin"
  },
  {
    // PRODUCT PLAYBOOK — the advisor tool (2026-10): read-only view of the
    // Product Playbook sheet's visible content (latest verified snapshot), like
    // any other general advisor tool. Every tier can view it; there is nothing
    // to edit, so Viewer is the whole feature.
    id: "product_playbook",
    name: "Product Playbook",
    description: "Read-only view of the Product Playbook: compare plans by feature and see recommendation specifics",
    defaultTier: "General",
    generalAccess: "Viewer",
    adminAccess: "Viewer",
    zone: "advisor"
  }
];

/**
 * DERIVED FROM THE REGISTRY (2026-09h, at the user's explicit request:
 * "Automatically include all applicable sidebar pages and features from
 * the existing registry, covering Advisor Zone, Admin Zone, and
 * administrative sections. Avoid maintaining a separate hardcoded list
 * that becomes outdated when new features are added"). These three Sets
 * used to be independently hand-maintained string-literal arrays — easy to
 * forget to update when a feature was added, renamed, or reclassified
 * (exactly what happened to "flagged_responses" in 2026-09g, caught only
 * because the user pointed it out). Every DEFAULT_FEATURE_PERMISSIONS
 * entry now declares its own `zone` field (see FeaturePermission's own doc
 * comment in types/permissions.ts) right alongside its id/name/tier — a
 * NEW feature literally cannot be added to the registry without the
 * TypeScript compiler forcing a zone choice, so these three Sets can never
 * again silently drift out of sync with the registry the way three
 * separate Set literals could. "Preserve existing Group Tier behavior and
 * Developer protections" — isFeatureGroupGrantableForTier() and
 * isFeatureGroupRestrictableForTier() below are UNCHANGED by this: they
 * still consume these three Sets exactly as before, and "developer"-zone
 * features (Feature Visibility, Smoke Test, Clear Activity) are still
 * entirely absent from all three, so they remain completely out of Group
 * Access's reach in either direction, exactly as before.
 *
 * ADVISOR_ZONE_FEATURES — reachable by every tier (General and up); a
 * group's grant on one of these applies to every member regardless of
 * their own tier.
 */
export const ADVISOR_ZONE_FEATURES = new Set<string>(DEFAULT_FEATURE_PERMISSIONS.filter((p) => p.zone === "advisor").map((p) => p.id));

/**
 * ADMIN_ZONE_FEATURES — reachable only by Admin, Platform Admin, and
 * Developer; a group's grant on one of these has zero effect on any
 * General-tier member, even one belonging to the very same group (see
 * isFeatureGroupGrantableForTier() below). Deliberately EXCLUDES the
 * self-escalation-sensitive "administrative" zone (profile_access chief
 * among them) — see RESTRICT_ONLY_FEATURES's own doc comment for why:
 * profile_access's own effective level must never be raisable by anything
 * other than someone's Security Tier itself, because a careless or
 * malicious grant on it could hand a lower-tier member the ability to
 * grant further access to themselves. Group Access is architecturally the
 * same "raise above the tier default" class of mechanism as a Custom
 * Grant, so that boundary applies here too. Every other feature here is
 * already Custom-Grant-raisable today, so letting Group Access reach the
 * same ones is not a new escalation surface.
 */
export const ADMIN_ZONE_FEATURES = new Set<string>(DEFAULT_FEATURE_PERMISSIONS.filter((p) => p.zone === "admin").map((p) => p.id));

/**
 * RESTRICT_ONLY_FEATURES — 2026-09g, at the user's explicit request ("No
 * check box control for access control center. What if the group is not
 * supposed to have it?" / "if this was an admin tier feature, why was it
 * not in the control options"). These are the self-escalation-sensitive
 * "administrative" zone features that ADMIN_ZONE_FEATURES deliberately
 * excludes — raising them through Group Access remains permanently
 * blocked: a careless or malicious group grant must never be able to hand
 * a lower-tier member the ability to grant further access to themselves.
 *
 * What's new here is the RESTRICT direction only: an Admin-tier member of
 * an access-configured group can now have their (already-tier-granted)
 * access to one of these blocked, same as any Admin Zone feature, by simply
 * leaving it unchecked — this is what makes it possible to build a
 * genuinely locked-down "trainee"/"limited admin" group that can't reach
 * Access Control Center, Groups, or Master Advisors at all, not just the
 * ordinary Admin Zone tools. Checking one of these in the Groups tab does
 * NOT grant it (there is no raise), it only exempts that member from being
 * restricted on it — see resolveAccess()'s Group Access block and
 * isFeatureGroupRestrictableForTier() below for the exact mechanics.
 * General tier is never affected either way (every one of these already
 * defaults to "None" for General).
 */
export const RESTRICT_ONLY_FEATURES = new Set<string>(DEFAULT_FEATURE_PERMISSIONS.filter((p) => p.zone === "administrative").map((p) => p.id));

/** Every feature id the Groups tab's Access Control list can show at all
 * (any zone, including the restrict-only Administrative Access zone) — the
 * outer eligibility boundary the `/api/group-access/:groupId` validation
 * route checks a submitted featureId against, before per-member tier
 * eligibility is even considered. */
export const GROUP_CONFIGURABLE_FEATURES = new Set<string>([...ADVISOR_ZONE_FEATURES, ...ADMIN_ZONE_FEATURES, ...RESTRICT_ONLY_FEATURES]);

/**
 * Whether a grant on `featureId` can ever apply to a caller at `tier` —
 * "the selected permissions must respect each member's access tier" (the
 * user's own framing). This is what makes Group Access mixed-tier-safe:
 * a group can hold General, Admin, and Platform Admin members all at
 * once, and checking an Admin Zone item (e.g. Announcement Manager) only
 * ever raises the Admin-tier-and-up members of that group — a General-tier
 * member of the exact same group is completely unaffected by that row, as
 * if it didn't exist for them. See resolveAccess()'s own Group Access step
 * in accessRuleEvaluator.ts, which calls this before ever applying a
 * group's grant.
 */
export function isFeatureGroupGrantableForTier(featureId: string, tier: "General" | "Admin" | "Platform Admin" | "Developer"): boolean {
  if (ADVISOR_ZONE_FEATURES.has(featureId)) return true;
  if (ADMIN_ZONE_FEATURES.has(featureId)) return tier !== "General";
  // RESTRICT_ONLY_FEATURES deliberately excluded — never raisable through
  // Group Access, at any tier. See isFeatureGroupRestrictableForTier() below
  // for the separate (wider) question of whether it can be RESTRICTED.
  return false;
}

/**
 * Whether a caller at `tier` can have their access to `featureId` RESTRICTED
 * by Group Access — a strictly wider question than
 * isFeatureGroupGrantableForTier() above, since 2026-09g's
 * RESTRICT_ONLY_FEATURES can be restricted (if left unchecked) without ever
 * being raisable (if checked). Every raise-capable feature is also
 * restrict-capable (unchanged from 2026-09f), so this always returns true
 * wherever isFeatureGroupGrantableForTier() does; it additionally returns
 * true for RESTRICT_ONLY_FEATURES at Admin/Platform Admin/Developer tier
 * (resolveAccess() itself further narrows actual restriction to Admin only,
 * exempting Platform Admin/Developer — see its own doc comment). General
 * tier is never restrictable on a RESTRICT_ONLY_FEATURES entry since every
 * one of them already defaults to "None" for General regardless.
 */
export function isFeatureGroupRestrictableForTier(featureId: string, tier: "General" | "Admin" | "Platform Admin" | "Developer"): boolean {
  if (isFeatureGroupGrantableForTier(featureId, tier)) return true;
  if (RESTRICT_ONLY_FEATURES.has(featureId)) return tier !== "General";
  return false;
}
