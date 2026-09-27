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
    adminAccess: "Viewer"
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
    adminAccess: "Viewer"
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
    adminAccess: "Editor"
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
    adminAccess: "Viewer"
  },
  {
    // Read-only calculator — Viewer-only like advisory_zone, visible to
    // every tier including General advisors (no persisted data to edit).
    id: "coverage_projection",
    name: "Cover Projection Assist",
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
    name: "Specific Illness Assist",
    description: "Check whether a declared medical condition falls under a plan's 2-year specific illness waiting period",
    defaultTier: "General",
    generalAccess: "Viewer",
    adminAccess: "Viewer"
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
    adminAccess: "Viewer"
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
    adminAccess: "None"
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
    adminAccess: "Editor"
  },
  {
    id: "clear_activity",
    name: "Clear Activity & Mismatch Logs",
    description: "Erase history of user lookups and resolve/purge active mismatch records",
    defaultTier: "Developer",
    generalAccess: "None",
    adminAccess: "None"
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
    adminAccess: "None"
  }
];

/**
 * The features an admin can restrict a relationship group's members to,
 * via the Groups tab (Access Control Center) and the `group_tool_access`
 * table (schema.ts) — 2026-09, originally built for the Training
 * Department's trainer/trainee cohorts and later generalized to any
 * relationship group (see relationship_groups.usedForGroupAccess).
 *
 * DERIVED FROM THE REGISTRY, NOT A FIXED "ADVISOR ZONE" LIST (2026-09c, at
 * the user's explicit request): this used to be a hand-picked list of 11
 * "Advisor Zone" product/reference/QA tools (same grouping App.tsx's
 * navZonesRaw uses for its `advisorWorkspace`/`quality`/`reference`
 * groups), which made sense back when Group Tier could only ever target
 * General-tier members. Now that a group's `groupTier` can also target
 * Admin or Platform Admin members (migration 0082), a fixed Advisor-Zone-
 * only list no longer makes sense — Group Tier's actual purpose is
 * "which tier's feature access am I configuring?", not "only ever show
 * Advisor Zone features". This Set is now every feature id in
 * DEFAULT_FEATURE_PERMISSIONS above, with one deliberate exclusion below —
 * see featuresApplicableToTier() for the per-tier subset the Groups tab's
 * Access step (GroupEditorModal.tsx) actually offers, which is what changed
 * user-facing behavior; this Set itself stays the same kind of thing it
 * always was (the outer eligibility boundary the evaluator and the
 * `/api/group-access/:groupId` validation check against), just wider.
 *
 * Widening this Set doesn't change *how* or *when* the Group Access
 * Restriction gate applies for a General-tier caller — resolveAccess() and
 * evaluateAccess.ts's getGroupAllowedFeatureIds() only ever populate
 * `groupAllowedFeatureIds` from groups whose own `groupTier` already
 * matches the caller's tier (see that function's own doc comment), so the
 * tier-scoping was never this Set's job. Widening it only makes the exact
 * same existing gate reachable for Admin-tier and Platform-Admin-tier
 * callers too, which is exactly the gap being closed here.
 *
 * EXCLUDES "profile_access" (Access Control Center) — deliberately, the
 * same self-escalation boundary server.ts's requireFeatureAccess() comment
 * documents for Custom Grants: profile_access's own effective level is
 * never allowed to be raised by anything other than someone's Security
 * Tier itself, because a careless or malicious grant on it (Custom Grant,
 * Access Rule, or — as of this widening — Group Access) could hand a
 * lower-tier member the ability to grant further access to themselves.
 * Group Access Restriction is architecturally the same "raise to Editor"
 * class of mechanism as a Custom Grant, so that boundary applies here too.
 * Every other feature here is already Custom-Grant-raisable today, so
 * letting Group Access reach the same ones is not a new escalation
 * surface — see this file's own history for how each of those became
 * ordinary, reassignable features.
 *
 * A feature id in this Set that a group owner HAS granted (and whose
 * `groupTier` matches the member's own tier) resolves to complete
 * ("Editor") access for that member, not just whatever the feature's own
 * generalAccess/adminAccess default would otherwise give. See
 * resolveAccess()'s own comment on `groupAllowedFeatureIds` for how the
 * restriction itself is applied.
 */
export const GROUP_RESTRICTABLE_FEATURES = new Set<string>(
  DEFAULT_FEATURE_PERMISSIONS.map((p) => p.id).filter((id) => id !== "profile_access")
);

/**
 * Which of GROUP_RESTRICTABLE_FEATURES a group whose Group Tier is `tier`
 * can actually offer on its Access checklist (GroupEditorModal.tsx, Step
 * 3) — "which tier's feature access am I configuring?" (2026-09c, see
 * GROUP_RESTRICTABLE_FEATURES's own doc comment above for the full
 * reasoning). "Applicable" means exactly what it means everywhere else in
 * this file: that tier gets at least Viewer by default.
 *
 * General and Admin read this straight off this registry's own
 * generalAccess/adminAccess columns — the same columns resolveAccess()
 * itself reads for that tier's ordinary (non-group) default — so the
 * Groups tab's notion of "applicable to this tier" never drifts from what
 * the Permissions tab's own defaults already say. Platform Admin has no
 * per-feature column of its own in this static registry (see
 * FeatureAccessOverride's doc comment in types/permissions.ts —
 * `platformAdminAccess` defaults to "Editor" for every feature absent an
 * explicit override, rather than having a shipped per-feature default
 * here), so its applicable set is simply every remaining
 * GROUP_RESTRICTABLE_FEATURES id.
 */
export function featuresApplicableToTier(tier: "General" | "Admin" | "Platform Admin"): FeaturePermission[] {
  return DEFAULT_FEATURE_PERMISSIONS.filter((p) => isFeatureGroupRestrictableForTier(p.id, tier));
}

/**
 * Whether `featureId` is one Group Access Restriction can actually gate
 * FOR A CALLER AT `tier` specifically — the tier-aware companion
 * `resolveAccess()` itself must use for its gate (accessRuleEvaluator.ts),
 * not just the flat `GROUP_RESTRICTABLE_FEATURES` membership check the
 * gate used before this widening.
 *
 * Why this exists as its own check rather than resolveAccess() calling
 * `GROUP_RESTRICTABLE_FEATURES.has(featureId)` directly (which is what it
 * did before 2026-09c): that Set is now the UNION across every tier — it
 * has to be, since a group's checklist must be able to offer
 * Admin/Platform-Admin-only features when `groupTier` is Admin/Platform
 * Admin. But the gate in resolveAccess() is evaluated once per (caller,
 * featureId) pair, for that caller's OWN tier — if it kept checking
 * against the flat union, a General-tier caller in a General-tier
 * restriction group would ALSO have their Admin/Platform-Admin-only
 * features (e.g. "plan_scope", "audit") swept under that same group's
 * ceiling, silently overriding any unrelated Access Rule or Custom Grant
 * they might separately hold on one of those — even though the group's own
 * checklist could never have offered them in the first place (General
 * tier's applicable list never includes them, see
 * featuresApplicableToTier()). That would be a real regression, not
 * cosmetic: a General-tier admin who's been individually granted, say,
 * Editor on "audit" via Custom Grant would lose it the moment they're
 * added to ANY active General-tier restriction group, regardless of what
 * that group's checklist actually contains. This function is what keeps
 * the gate scoped to exactly the features that tier's own checklist could
 * ever have offered — mirroring featuresApplicableToTier() exactly, so the
 * UI and the enforcement gate can never drift apart.
 */
export function isFeatureGroupRestrictableForTier(featureId: string, tier: "General" | "Admin" | "Platform Admin"): boolean {
  if (!GROUP_RESTRICTABLE_FEATURES.has(featureId)) return false;
  if (tier === "Platform Admin") return true;
  const perm = DEFAULT_FEATURE_PERMISSIONS.find((p) => p.id === featureId);
  if (!perm) return false;
  return tier === "Admin" ? perm.adminAccess !== "None" : perm.generalAccess !== "None";
}
