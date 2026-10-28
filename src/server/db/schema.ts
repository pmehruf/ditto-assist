/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Centralized database schema (Phase 4 — Production Infrastructure).
 *
 * This is the single source of truth for every table this app persists to
 * Postgres. Nothing outside `src/server/db/` should import `drizzle-orm`
 * directly or hold a raw DB client — all reads/writes go through the
 * repositories in `src/server/db/repositories/`, which import this schema.
 *
 * Table -> legacy localStorage key / client-side type mapping (see
 * PHASE4_DATA_MODEL.md for the full inventory this was designed from):
 *   searchHistory  <- ditto_ped_search_history / AuditLogEntry
 *                     (also powers the "My Activity" tab, which is just
 *                     this table filtered by user_email)
 *   changeLogs     <- ditto_change_logs / ChangeLogEntry
 *                     (the "Modification History" sub-tab under Audit, and
 *                     the workflow-approval trail: actionType values like
 *                     "Draft Approved" / "Draft Created" / "Insurer Edited")
 *   announcements  <- ditto_qa_announcements / QAAnnouncement
 *   flaggedIssues  <- ditto_reported_issues / ReportedIssue
 */

import {
  pgTable,
  serial,
  text,
  timestamp,
  integer,
  bigint,
  boolean,
  jsonb,
  varchar,
  date,
  numeric,
  pgEnum,
  uniqueIndex,
  index,
  vector,
} from "drizzle-orm/pg-core";

// ─────────────────────────────────────────────────────────────────────────
// search_history — one row per PED lookup performed. Append-only audit
// trail: never updated after insert, only ever inserted or (rarely, by a
// Developer) bulk-cleared. Unbounded growth in production (the old client-side
// code capped this at 400 in-memory entries; the DB has no such cap).
// ─────────────────────────────────────────────────────────────────────────
export const searchHistory = pgTable("search_history", {
  id: serial("id").primaryKey(),
  timestamp: timestamp("timestamp", { withTimezone: true }).notNull().defaultNow(),
  userEmail: varchar("user_email", { length: 320 }).notNull(),
  planName: text("plan_name").notNull(),
  pedInput: text("ped_input").notNull(),
  matchedQuestion: text("matched_question").notNull(),
  matchType: varchar("match_type", { length: 32 }).notNull(),
  source: text("source").notNull(),
  explanation: text("explanation").notNull(),
});

// ─────────────────────────────────────────────────────────────────────────
// change_logs — administrative/workflow action trail (plan drafts approved,
// insurer metadata edited, announcements added/edited/deleted, etc.).
// `snapshot` preserves the same loosely-typed point-in-time governance
// snapshot the client used to attach (draftPlans/productionPlans/etc.),
// stored as JSONB since its shape varies by actionType.
// ─────────────────────────────────────────────────────────────────────────
export const changeLogs = pgTable("change_logs", {
  id: serial("id").primaryKey(),
  timestamp: timestamp("timestamp", { withTimezone: true }).notNull().defaultNow(),
  userName: text("user_name").notNull(),
  role: varchar("role", { length: 32 }).notNull(),
  actionType: text("action_type").notNull(),
  planName: text("plan_name"),
  description: text("description").notNull(),
  snapshot: jsonb("snapshot"),
});

// ─────────────────────────────────────────────────────────────────────────
// announcements — small, admin-curated list of QA/general announcements.
// ─────────────────────────────────────────────────────────────────────────
// "General Announcement" is kept for legacy rows (Postgres can't drop an
// enum value in place, and reclassification in migration 0056 doesn't
// necessarily catch every historical row) but is no longer offered as a
// selectable Type in the Announcement Manager — "Product Announcement" and
// "Insurance Operations" replaced it as the two real, dedicated types.
export const announcementTypeEnum = pgEnum("announcement_type", [
  "QA Announcement",
  "General Announcement",
  "Product Announcement",
  "Insurance Operations",
  "Insight",
]);

// Which advisor audience an announcement is targeted at. Users tagged
// Health-only see only "Health" announcements, Term-only see only "Term",
// and everyone else (no tags, or tagged BOTH Health and Term) sees both.
// Defaults to "Health" so every pre-existing announcement (posted before
// this concept existed) is retroactively tagged Health, per spec.
//
// NOTE: this enum is also reused (unchanged, strictly binary) as the
// Health/Term "domain" column type on kb_categories, kb_playbook_plan_facts,
// special_instructions, product_assist_unresolved_queries, and kb_acronyms —
// all of which must never accept a "Both" value for Product Assist's
// domain-isolation logic (see productAssist.ts). That's why the "Both
// Advisors" audience option added below (2026-09) lives on a brand-new,
// dedicated enum instead of being added as a third value here.
export const announcementTeamEnum = pgEnum("announcement_team", ["Health", "Term"]);

// Dedicated to announcements.team only — see the note above for why this
// isn't just a third value on announcementTeamEnum. "Both" means the
// announcement is visible to Health advisors and Term advisors alike (in
// addition to advisors with no/mixed team tags, who already see
// everything), letting the Announcement Manager post one common
// announcement instead of two near-duplicates.
export const announcementAudienceEnum = pgEnum("announcement_audience", ["Health", "Term", "Both"]);

export const announcements = pgTable("announcements", {
  id: serial("id").primaryKey(),
  announcement: text("announcement").notNull(),
  effectiveDate: date("effective_date"),
  category: text("category").notNull(),
  addedBy: text("added_by").notNull(),
  rating: integer("rating"),
  type: announcementTypeEnum("type").default("QA Announcement"),
  validTillDate: date("valid_till_date"),
  title: text("title"),
  team: announcementAudienceEnum("team").notNull().default("Health"),
  // Distinct from effectiveDate (when the policy/rule described actually
  // kicks in — can be future-dated) and from createdAt (an exact server
  // timestamp). This is the admin-editable "posted on" date shown to
  // advisors, defaulting to today in the form but backdatable/postdatable.
  announcementDate: date("announcement_date"),
  // Renamed from the client-side `from` field to avoid the SQL keyword.
  fromTeam: text("from_team"),
  // Whether this announcement participates in the blocking read-and-
  // acknowledge flow (see announcementAcks below). Everything posted before
  // migration 0023 shipped was grandfathered to false; new rows default
  // true so every announcement from then on gates the app per-user until
  // acknowledged.
  requiresAck: boolean("requires_ack").notNull().default(true),
  // Stable QA ID from the "Bot Alert - QA Announcements" Google Sheet feed (e.g. QAH261009:
  // QA + H/T/B for Health/Term/Both + YYMM + running number). NULL for announcements
  // typed in by hand. Used to match sheet rows to app rows on every sync, so a
  // sync never creates duplicates.
  qaId: text("qa_id").unique(),
  // Fingerprint of the sheet row this announcement was last synced from, so a sync
  // only touches rows whose sheet content actually changed.
  sourceHash: text("source_hash"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// One-row table (id is always 1) remembering the last QA-sheet announcement sync.
export const announcementSyncState = pgTable("announcement_sync_state", {
  id: integer("id").primaryKey(),
  lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }),
  lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
  lastTrigger: text("last_trigger"),
  lastSummary: text("last_summary"),
  lastError: text("last_error"),
});
export type AnnouncementSyncStateRow = typeof announcementSyncState.$inferSelect;

// ─────────────────────────────────────────────────────────────────────────
// announcement_acks — one row per (announcement, user) "I have read this"
// acknowledgement, powering the mandatory read-and-acknowledge modal that
// blocks app usage until every applicable announcement is acked. Which
// announcements apply to a given user is decided at query time:
// requires_ack = true AND announcements.created_at >= users.created_at
// (new joiners are never asked to acknowledge history from before they
// joined). ON DELETE CASCADE keeps acks from outliving their announcement.
// ─────────────────────────────────────────────────────────────────────────
export const announcementAcks = pgTable(
  "announcement_acks",
  {
    id: serial("id").primaryKey(),
    announcementId: integer("announcement_id")
      .notNull()
      .references(() => announcements.id, { onDelete: "cascade" }),
    userEmail: varchar("user_email", { length: 320 }).notNull(),
    ackedAt: timestamp("acked_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("announcement_acks_announcement_user_unique").on(table.announcementId, table.userEmail)]
);

// ─────────────────────────────────────────────────────────────────────────
// flagged_issues — advisor-reported mismatches, triaged by Developers/Admins.
// ─────────────────────────────────────────────────────────────────────────
export const flaggedIssueStatusEnum = pgEnum("flagged_issue_status", [
  "Pending",
  "Urgent",
  "Resolved",
  "Ignored",
]);

export const flaggedIssues = pgTable("flagged_issues", {
  id: serial("id").primaryKey(),
  timestamp: timestamp("timestamp", { withTimezone: true }).notNull().defaultNow(),
  userEmail: varchar("user_email", { length: 320 }).notNull(),
  userName: text("user_name").notNull(),
  userTactId: varchar("user_tact_id", { length: 64 }).notNull(),
  planName: text("plan_name").notNull(),
  pedInput: text("ped_input").notNull(),
  matchedQuestion: text("matched_question").notNull(),
  matchType: varchar("match_type", { length: 32 }).notNull(),
  source: text("source").notNull(),
  explanation: text("explanation").notNull(),
  issueNotes: text("issue_notes").notNull(),
  status: flaggedIssueStatusEnum("status").notNull().default("Pending"),
  ownerNotes: text("owner_notes"),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
});

// ─────────────────────────────────────────────────────────────────────────
// users — the org's user directory (email, name, tactId, tier, status).
// Replaces the old data/users.json file (audit follow-up): a JSON file on
// the server's local disk doesn't survive redeploys/restarts on most hosts
// (ephemeral or read-only filesystems), so it was the one remaining piece
// of app state that wasn't actually durable in production. `email` is the
// primary key — every lookup in this app is keyed by the caller's verified
// Google session email, never by a synthetic id.
// ─────────────────────────────────────────────────────────────────────────
// "Platform Admin" added 2026-08 (Access Control system, Phase 2): a tier
// between Admin and Developer with every Developer capability EXCEPT the 4
// protections carved out for real Developer accounts specifically — see
// isDeveloperPower()/the Developer-record-protection checks in server.ts's
// PATCH/DELETE /api/users routes. Existing Postgres rows are untouched by
// adding an enum value; only a Developer (or a Platform Admin, per the same
// rule that lets Platform Admin promote another Platform Admin) can actually
// grant this tier to someone — see POST/PATCH /api/users.
export const userTierEnum = pgEnum("user_tier", ["General", "Admin", "Platform Admin", "Developer"]);
// "Disabled" replaces the old "Pending First Login" value — that used to
// mark a user a Developer pre-added who hadn't completed first-time setup yet;
// it's now a real deactivation flag a Developer can set to lock someone out
// without deleting their directory record.
export const userStatusEnum = pgEnum("user_status", ["Active", "Disabled"]);

export const users = pgTable("users", {
  email: varchar("email", { length: 320 }).primaryKey(),
  name: text("name").notNull(),
  tactId: varchar("tact_id", { length: 64 }).notNull(),
  tier: userTierEnum("tier").notNull().default("General"),
  status: userStatusEnum("status").notNull().default("Active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  // Stamped on every successful Google OAuth sign-in (server.ts's callback
  // route) — was schema-only/never wired until the same callback started
  // also persisting `picture` below (2026-09-02), at which point stamping
  // this in the same UPDATE cost nothing extra.
  lastLogin: timestamp("last_login", { withTimezone: true }),
  // The signed-in Google account's profile photo URL, captured from the ID
  // token's `picture` claim on every login (server.ts's OAuth callback) and
  // overwritten each time — so this is always that person's CURRENT Google
  // avatar as of their last sign-in, not a one-time snapshot. Null for a
  // user who has never signed in yet (e.g. an advisor added to the
  // directory but who hasn't logged in themselves), or whose Google account
  // has no photo — callers fall back to an initials avatar. Used by Team
  // Tracker's Guide/Mentor picker (MentorGuideList) to show a real photo
  // per person instead of a generic icon.
  picture: text("picture"),
  // Skill-domain tags — any subset of "Health" and "Term". Replaces the old
  // single-value advisor_role ("Health advisor"/"Term advisor"/"Both
  // advisor"/"Manager") — see drizzle/0026_advisor_tags.sql. Empty array =
  // unassigned (same effective behavior as the old null: not restricted to
  // either domain). Chosen via a real multi-select at first-time setup
  // ("Skill Domain") and editable afterward in User Management; validated
  // against the 2 allowed values in server.ts, not enforced at the DB level.
  tags: text("tags").array().notNull().default([]),
  // Organizational metadata only — see the departments table's own comment
  // below for why this deliberately has zero effect on what this user can
  // do. Null = unassigned (every user's default; nothing currently
  // populates this). Editable only where tier/status/tags already are
  // (Developer-only PATCH, or set at Admin+Developer creation time via
  // POST) — one place to assign membership, not duplicated elsewhere.
  departmentId: integer("department_id").references(() => departments.id, { onDelete: "set null" }),
  // Bliss / Falcon / Central (or whatever a Developer/Platform Admin names
  // them) — see the org_teams table's own comment below for why this is a
  // SEPARATE concept from department, and from the pre-existing
  // announcement_team enum (Health/Term skill-domain, unrelated). Nullable
  // for the same "don't fabricate historical org data" reason department_id
  // is nullable (see PED_REPOSITORY... no — see departments' comment above):
  // no existing user is assumed to belong to any team. Required going
  // forward only at the point of creating a NEW directory entry (enforced
  // in POST /api/users, not at the DB level) — editing an existing user
  // never forces a retroactive guess.
  orgTeamId: integer("org_team_id").references(() => orgTeams.id, { onDelete: "set null" }),
  // Job-function role (Advisor, Mentor, Guide, Ops, ...) — see the roles
  // table's own comment below for why this is deliberately independent of
  // both `tier` (access level) and QA Dashboard's own admin/guide/mentor
  // role (qa_dashboard_roles, unrelated, unchanged). Nullable, optional,
  // same reasoning as department_id.
  roleId: integer("role_id").references(() => roles.id, { onDelete: "set null" }),
});

export type UserRow = typeof users.$inferSelect;
export type NewUserRow = typeof users.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────
// product_assist_acks — one row per user recording the Product Assist daily
// AI-awareness warning's state SERVER-SIDE (not just browser localStorage),
// so it survives a cleared cache or a new device:
//  - ackedAt — set exactly once, the first time this advisor completes the
//    full first-ever warning's 10-second countdown + checkbox + Proceed
//    flow. Never cleared afterward.
//  - lastReminderDate — the advisor's own LOCAL calendar date (YYYY-MM-DD,
//    not the server's) the lightweight daily reminder was last shown (or
//    was subsumed by completing the first-ever flow that same day — see
//    ProductAssistAcksRepository.acknowledge).
// No row yet = this user has never seen either. Purely additive.
// ─────────────────────────────────────────────────────────────────────────
export const productAssistAcks = pgTable("product_assist_acks", {
  userEmail: varchar("user_email", { length: 320 }).primaryKey(),
  ackedAt: timestamp("acked_at", { withTimezone: true }),
  lastReminderDate: text("last_reminder_date"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type ProductAssistAckRow = typeof productAssistAcks.$inferSelect;

// ─────────────────────────────────────────────────────────────────────────
// external_resources — admin/developer-curated list of external links (SOPs,
// QA Dashboard, etc.) surfaced in the Workspace Controls drawer for every
// user. Read by everyone; writable by Admin/Developer only (enforced in the
// API route, same pattern as announcements).
// ─────────────────────────────────────────────────────────────────────────
export const externalResources = pgTable("external_resources", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  url: text("url").notNull(),
  addedBy: text("added_by").notNull(),
  // Manual display order (lower shows first) — Admin/Developer can reorder the
  // list via up/down controls in the Quick Access drawer. New rows default
  // to 0 and tie-break on id (creation order) until explicitly reordered.
  sortOrder: integer("sort_order").notNull().default(0),
  // Explicit icon choice (a lucide-react icon name, e.g. "DollarSign") made
  // by the admin who added/edited the resource. Null means "no explicit
  // choice" — the client falls back to its keyword-based guess
  // (getResourceIcon in App.tsx) so existing resources keep working
  // untouched after this column was added.
  icon: text("icon"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type ExternalResourceRow = typeof externalResources.$inferSelect;
export type NewExternalResourceRow = typeof externalResources.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────
// plan_configs — the declaration questionnaire for each insurance plan
// (questions, category->question routing map, umbrella/catch-all
// questions). Replaces the old hardcoded getPlanConfig() in types.ts as the
// *live* source of truth: /api/match reads from here first, falling back to
// the hardcoded defaults only as a bootstrap seed for the 4 original plans.
// `questions` is stored as JSONB (array of {text, tag}) rather than a join
// table since order matters and it's always read/written as a whole unit
// from the Add/Edit Plan wizard — never queried per-question.
// `categoryMap` is JSONB { [categoryKey]: questionText } — generated by the
// keyword auto-categorizer (and optionally refined by the Gemini-backed
// /api/ai-plan-workflow) when the plan is saved, then editable by the admin
// before it goes live. Admin/Developer write; readable by every authenticated
// user (needed for the plan dropdown + matching to work for General tier).
// ─────────────────────────────────────────────────────────────────────────
export const planConfigs = pgTable("plan_configs", {
  // Plan name is the natural key everywhere else in this app (search
  // history, flagged issues, audit logs all key by planName string, not a
  // synthetic id) — keeping it as the primary key here avoids a second
  // id<->name lookup on every read.
  planName: text("plan_name").primaryKey(),
  insurerName: text("insurer_name").notNull(),
  // Array of { text: string, tag: "Specific" | "Umbrella" | "Catch-all" }.
  questions: jsonb("questions").notNull(),
  // { [categoryKey: string]: string } — category key -> exact question text.
  categoryMap: jsonb("category_map").notNull().default({}),
  anyOther: text("any_other").notNull(),
  hasUmbrella: boolean("has_umbrella").notNull().default(false),
  umbrellaQuestions: jsonb("umbrella_questions").notNull().default([]),
  // Array of { category?: string, illness: string } — the plan's own
  // Specific Illness List, editable from the same Add/Edit Plan wizard as
  // `questions` above. Read by the client-side matching engine
  // (checkIllnessInPlanSpecificList / matchesPhrase in
  // specificIllnessEngine.ts) to flag a looked-up PED as "Specific Illness"
  // for this plan, the same way `questions` drives declaration routing.
  // Additive only: an admin-managed list here is checked *before* the
  // legacy hardcoded MASTER_ILLNESSES catalog, never instead of it, so
  // editing one of the 4 original built-in plans without touching this
  // field can't silently drop their existing specific-illness matches.
  specificIllnesses: jsonb("specific_illnesses").notNull().default([]),
  overrides: jsonb("overrides"),
  // Takes this plan out of service for advisors without deleting its
  // configuration — set from the DA Mapping Config page (formerly
  // "Declaration Assistant Control", formerly "Plan Management") while its
  // questions/mapping engine logic is being reworked. /api/match refuses to
  // run a lookup for a disabled
  // plan (see server.ts); the declaration dropdown (LookupPage.tsx) shows
  // disabledNote to the advisor once they select it. Both default to "not
  // disabled" so every existing plan is unaffected until an admin opts it
  // in.
  disabled: boolean("disabled").notNull().default(false),
  disabledNote: text("disabled_note"),
  // Genuine, permanent-looking removal — distinct from `disabled` above
  // (which is temporary/visible: advisors still see the plan with a note).
  // A "Delete" in Plan Management now always writes removed=true rather
  // than DELETE-ing the row, and applies to a built-in plan (Optima
  // Secure, Care Supreme, Activ One Max, Activ Fit Preferred) too — those
  // previously had no DB row at all to delete, so there was no way to
  // remove them short of a code change to types.ts's hardcoded
  // getPlanConfig(). The row now exists purely to record the removal;
  // every plan list (Plan Management, the Declaration Assistant picker,
  // /api/match) filters it out, even though its content may still be
  // sitting in the hardcoded bootstrap seed.
  removed: boolean("removed").notNull().default(false),
  addedBy: text("added_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type PlanConfigRow = typeof planConfigs.$inferSelect;
export type NewPlanConfigRow = typeof planConfigs.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────
// ped_mapping_overrides — admin corrections layered on top of the hardcoded
// TOP_PED_DICTIONARY (types.ts). When a PED isn't in the static dictionary,
// /api/match falls through to the Gemini classifier; when an admin uses the
// "teach it" flow (POST /api/add-ped-mapping) to pin a PED to a category,
// that correction is stored here so it (a) survives a server restart and
// (b) is checked *before* the static dictionary on every future /api/match
// call for that exact PED text, without needing a code change/redeploy.
// ─────────────────────────────────────────────────────────────────────────
export const pedMappingOverrides = pgTable("ped_mapping_overrides", {
  id: serial("id").primaryKey(),
  // Normalized (trim + lowercase) so "Diabetes" and "diabetes " collide into
  // one override rather than silently coexisting as separate rows.
  pedText: text("ped_text").notNull().unique(),
  category: text("category").notNull(),
  addedBy: text("added_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type PedMappingOverrideRow = typeof pedMappingOverrides.$inferSelect;
export type NewPedMappingOverrideRow = typeof pedMappingOverrides.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────
// categories — category (declaration-question-family) definitions. Source
// of truth for what used to be the hardcoded CATEGORY_LABELS object in
// types.ts (see PED_REPOSITORY_DB_MIGRATION_DESIGN.md). category_key is kept
// as the primary key, not a new integer id, because a large amount of
// existing application code already speaks in these exact string keys
// (engine.ts, plan_configs.categoryMap JSONB) — reusing the string avoids an
// app-wide int-id rewrite everywhere else.
// ─────────────────────────────────────────────────────────────────────────
export const categories = pgTable("categories", {
  categoryKey: text("category_key").primaryKey(),
  label: text("label").notNull(),
  description: text("description"),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type CategoryRow = typeof categories.$inferSelect;
export type NewCategoryRow = typeof categories.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────
// ped_repository — master disease registry
// (PED_REPOSITORY_DB_MIGRATION_DESIGN.md §1.2). Stable internal `id` /
// `ped_code` identity, independent of the display name, so renames or
// spelling corrections never break ped_aliases, plan_overrides,
// mapping_history, or collision_repository rows that point at this PED.
//
// No DB-level FK constraints on the integer/text reference columns below,
// consistent with the rest of this schema (plan_configs.planName,
// pedMappingOverrides.category, etc. are also unconstrained text) —
// relationships are documented in comments and enforced in the
// repository/route layer, not the database.
// ─────────────────────────────────────────────────────────────────────────
export const pedStatusEnum = pgEnum("ped_status", ["draft", "approved", "deprecated"]);

export const pedRepository = pgTable("ped_repository", {
  id: serial("id").primaryKey(),
  // "PED-000421" — formatted from `id` by the repository layer immediately
  // after insert (Postgres RETURNING gives us `id`, then a single UPDATE
  // sets pedCode = 'PED-' || lpad(id::text, 6, '0')). Stored, not computed
  // at read time, so it stays a stable, directly-queryable value.
  pedCode: text("ped_code").notNull().unique(),
  canonicalName: text("canonical_name").notNull(),
  // References categories.categoryKey. Nullable until reviewed/categorized.
  categoryKey: text("category_key"),
  // Phase 4 / R11 — ordered category fallback. The PED's PRIMARY category stays in `category_key`; this holds the
  // ordered list of further categories (secondary, tertiary, ...) tried only when the categories before them have no
  // real question on the selected plan. NULL (the default, and every existing row) = single-category PED, behaving
  // exactly as before. Read only by the database-backed engine (src/mapping/routingEngine.ts, dictionary stage).
  categoryChain: jsonb("category_chain"),
  status: pedStatusEnum("status").notNull().default("draft"),
  // Self-reference for future dedup/merge tooling (two rows later found to
  // be the same disease) — not used by any code path yet; included now so
  // the column exists before real data accumulates.
  mergedIntoId: integer("merged_into_id"),
  notes: text("notes"),
  addedBy: text("added_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type PedRepositoryRow = typeof pedRepository.$inferSelect;
export type NewPedRepositoryRow = typeof pedRepository.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────
// ped_aliases — every searchable text variant for a ped_repository row,
// including one is_primary row mirroring canonical_name. normalized_alias
// (via normalizeDictionaryKey, src/engine.ts) is the actual runtime lookup
// key the deterministic engine's dictionary stage queries; its uniqueness
// constraint is what enforces "Alias Collision" at the database level — two
// PEDs can never claim the same normalized text.
// ─────────────────────────────────────────────────────────────────────────
export const pedAliases = pgTable("ped_aliases", {
  id: serial("id").primaryKey(),
  pedId: integer("ped_id").notNull(),
  aliasText: text("alias_text").notNull(),
  normalizedAlias: text("normalized_alias").notNull().unique(),
  isPrimary: boolean("is_primary").notNull().default(false),
  // Governance rules (2026-07-28): the repository is a professional medical
  // terminology repository — misspellings, typing errors, and OCR mistakes
  // must still resolve via search (normalizeDictionaryKey lookup, unchanged),
  // but must never be shown in a dropdown, search suggestion, or lookup
  // result. `isVisible=false` marks an alias as a hidden normalization-only
  // entry: it stays in `normalizedAlias` for matching (classifyDeterministic
  // reads every alias regardless of this flag — see pedRuntimeCache.ts,
  // deliberately unfiltered), but any admin UI listing a PED's aliases
  // should filter this out. Defaults true so every existing/new alias is
  // visible unless explicitly hidden.
  isVisible: boolean("is_visible").notNull().default(true),
  // Compatibility controls (mapping-control Phase 2): let the DB-backed
  // engine reproduce production's day-one behaviour without deleting or
  // altering any existing PED/category data. Precedence (see
  // src/mapping/routingEngine.ts primDictionaryLookup): routing_enabled=false
  // → the alias has no dictionary entry; else category_key_override (when
  // set) replaces the PED's category; else the PED's category. They only
  // affect the dictionary stage — never exact wording, plan overrides,
  // shields or plan rules. fallback_category_key is a last-resort category
  // used only when the whole pipeline resolves nothing with the primary one.
  routingEnabled: boolean("routing_enabled").notNull().default(true),
  categoryKeyOverride: text("category_key_override"),
  fallbackCategoryKey: text("fallback_category_key"),
  addedBy: text("added_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type PedAliasRow = typeof pedAliases.$inferSelect;
export type NewPedAliasRow = typeof pedAliases.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────
// plan_overrides — per-plan category overrides for a specific PED,
// replacing the 4 hardcoded "0.4 PLAN-SPECIFIC OVERRIDES & INTERCEPTS"
// blocks in engine.ts (Activ Fit Preferred: OSA -> genetic, DVT/PE family
// -> heart; Care Supreme: Crohn's/colitis/IBD -> blood; Optima Secure:
// RA/ankylosing spondylitis -> musculoskeletal). One row per (planName,
// pedId) — a term FAMILY previously matched by a single regex becomes one
// row per distinct PED in that family, since they're clinically distinct
// conditions, not aliases of one PED.
// ─────────────────────────────────────────────────────────────────────────
export const planOverrides = pgTable(
  "plan_overrides",
  {
    id: serial("id").primaryKey(),
    planName: text("plan_name").notNull(),
    pedId: integer("ped_id").notNull(),
    // References categories.categoryKey — the category THIS plan uses for
    // this PED, which may differ from the PED's own default categoryKey.
    // Nullable since 0084: an admin-authored override (Plan Management's
    // "Plan-Specific PED Mappings") targets an exact question instead.
    categoryKey: text("category_key"),
    // The exact plan question this PED maps to on this plan (0084). Takes
    // precedence over categoryKey and over the PED's own category mapping —
    // see engine.ts's applyPlanPedOverride. Falls back to categoryKey if the
    // question text no longer exists on the plan (e.g. it was reworded).
    targetQuestion: text("target_question"),
    reason: text("reason"),
    addedBy: text("added_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("plan_overrides_plan_ped_idx").on(table.planName, table.pedId)]
);

export type PlanOverrideRow = typeof planOverrides.$inferSelect;
export type NewPlanOverrideRow = typeof planOverrides.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────
// routing_rules — the ordered routing pipeline as data (mapping-control
// Phase 2). Every hard-coded rule the legacy engine (src/engine.ts) applied
// — life-stage firewall, plan-specific rules, shields, disease-family
// sections, generic shields, post-guards — plus the named primitives'
// editable parameters. `position` is the evaluation order (ascending);
// `definition` is the JSON rule body described in src/mapping/ruleTypes.ts.
// Interpreted by src/mapping/routingEngine.ts. Seeded by
// scripts/seedMappingControl.ts from src/mapping/legacyRuleSeed.ts.
// ─────────────────────────────────────────────────────────────────────────
export const routingRules = pgTable(
  "routing_rules",
  {
    id: serial("id").primaryKey(),
    ruleKey: text("rule_key").notNull().unique(),
    kind: text("kind").notNull(),
    stage: text("stage").notNull(),
    primitive: text("primitive"),
    position: integer("position").notNull(),
    planScope: text("plan_scope"),
    enabled: boolean("enabled").notNull().default(true),
    description: text("description").notNull().default(""),
    definition: jsonb("definition").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("routing_rules_position_idx").on(table.position)]
);

export type RoutingRuleDbRow = typeof routingRules.$inferSelect;
export type NewRoutingRuleDbRow = typeof routingRules.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────
// mapping_state — single-row version counter. Every write that can change a
// routing result bumps `version` in the same transaction; each lookup reads
// this one row and reloads its in-memory snapshot only when the number
// changed, so an edit reaches every server instance on the very next lookup
// (no restart, no publish step, no cross-instance messaging).
// ─────────────────────────────────────────────────────────────────────────
export const mappingState = pgTable("mapping_state", {
  id: integer("id").primaryKey().default(1),
  version: bigint("version", { mode: "number" }).notNull().default(1),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type MappingStateRow = typeof mappingState.$inferSelect;

// ─────────────────────────────────────────────────────────────────────────
// mapping_change_sets — audit + undo for admin mapping actions that change
// several rows as one unit (Phase 3A: AI Mapping Review approve/reject). Each
// row records WHAT was applied (`ops`, with before/after values so it can be
// reversed), who did it, the live-lookup verification that confirmed it took
// effect, and — if undone — who undid it. Undo is refused when the affected
// rows have changed since (conflict), never forced. See
// src/server/aiMappingPromotion.ts.
// ─────────────────────────────────────────────────────────────────────────
export const mappingChangeSets = pgTable(
  "mapping_change_sets",
  {
    id: serial("id").primaryKey(),
    // "ai_approval" today; later admin mapping controls reuse this table.
    kind: text("kind").notNull(),
    summary: text("summary").notNull(),
    // "applied" | "undone" | "failed_verification" (applied then auto-reverted
    // because the live lookup did not reflect it).
    status: text("status").notNull().default("applied"),
    relatedAiMemoryId: integer("related_ai_memory_id"),
    // Forward operations with before/after values, e.g.
    // [{type:"create_ped",pedId,aliasId,category}, {type:"set_ped_category",pedId,before,after}]
    ops: jsonb("ops").notNull(),
    // { term, planName, expectedQuestion, expectedCategory, observed: {...trace}, snapshotVersion }
    verification: jsonb("verification"),
    performedBy: text("performed_by").notNull(),
    performedAt: timestamp("performed_at", { withTimezone: true }).notNull().defaultNow(),
    undoneBy: text("undone_by"),
    undoneAt: timestamp("undone_at", { withTimezone: true }),
    undoNote: text("undo_note"),
    // Phase 3B-i change-control fields (null on Phase 3A rows): the admin's reason, the
    // Constitution Part XIV change category, the Part XI step 4 Business-Decision check, and
    // the measured impact (src/mapping/impact.ts) the admin confirmed.
    reason: text("reason"),
    changeCategory: text("change_category"),
    businessDecision: text("business_decision"),
    impactTier: text("impact_tier"),
    impact: jsonb("impact"),
  },
  (table) => [index("mapping_change_sets_ai_memory_idx").on(table.relatedAiMemoryId)]
);

export type MappingChangeSetRow = typeof mappingChangeSets.$inferSelect;
export type NewMappingChangeSetRow = typeof mappingChangeSets.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────
// plan_restrictions — admin-authored, deterministic Plan-Specific
// Restrictions (2026-08), replacing the 3 hardcoded booleans on
// plan_configs.overrides (requiresInsulinForDiabetes / excludePrediabetes /
// bypassBenignTumors — PlanOverrides in types.ts) with a real Create/Edit/
// Delete/Enable-disable UI. No AI involved anywhere in evaluating these:
// `mode` + `keywords` below is read by a small, pure, plain-text
// word-boundary matcher in engine.ts (isCategoryRestrictedForPed) — the
// exact same mechanism the old hardcoded regex checks already used, just
// table-driven instead of code-hardcoded.
//
// One row narrows ONE category's question, on ONE plan:
//   - "require_keywords": the category's normal question only applies when
//     the advisor's PED text also matches at least one of `keywords` (e.g.
//     diabetes restricted to "type 1"/"insulin"/"blindness"/"foot ulcer").
//     A PED that DOESN'T match is diverted to the plan's catch-all.
//   - "exclude_keywords": the inverse — the category's normal question is
//     diverted to the catch-all whenever the PED text DOES match one of
//     `keywords` (e.g. "prediabetes"/"borderline diabetes" excluded from a
//     diabetes question that otherwise applies normally).
//   - "block_category": the category's question is always diverted to the
//     catch-all on this plan, regardless of PED text (e.g. benign tumors
//     never route to this plan's cancer/neoplasm question) — `keywords` is
//     ignored/empty for this mode.
// `categoryKey` is a CATEGORY_LABELS key (types.ts), same identifier space
// plan_configs.categoryMap already uses — not a new vocabulary.
// ─────────────────────────────────────────────────────────────────────────
export const planRestrictionModeEnum = pgEnum("plan_restriction_mode", ["require_keywords", "exclude_keywords", "block_category"]);

export const planRestrictions = pgTable(
  "plan_restrictions",
  {
    id: serial("id").primaryKey(),
    planName: text("plan_name").notNull(),
    categoryKey: text("category_key").notNull(),
    mode: planRestrictionModeEnum("mode").notNull(),
    // string[] — word-boundary, case-insensitive OR match against the PED's
    // own text. Empty/unused for "block_category".
    keywords: jsonb("keywords").notNull().default([]),
    // Shown to the advisor (in place of the old hardcoded per-site prose)
    // when this restriction diverts a PED to the plan's catch-all question.
    explanation: text("explanation").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    createdBy: text("created_by").notNull(),
    updatedBy: text("updated_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("plan_restrictions_plan_name_idx").on(table.planName),
    index("plan_restrictions_is_active_idx").on(table.isActive),
  ]
);

export type PlanRestrictionRow = typeof planRestrictions.$inferSelect;
export type NewPlanRestrictionRow = typeof planRestrictions.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────
// mapping_history — structured, queryable audit trail for PED/category/
// mapping changes specifically (distinct from change_logs above, which
// stays for plan/announcement/user admin actions). Stores structured
// before/after values rather than a free-text description, so it can
// answer "what was this PED's category on a given date" without parsing
// prose.
// ─────────────────────────────────────────────────────────────────────────
export const mappingHistoryEntityEnum = pgEnum("mapping_history_entity_type", [
  "ped",
  "alias",
  "category",
  "plan_override",
  "plan_config",
]);

export const mappingHistory = pgTable("mapping_history", {
  id: serial("id").primaryKey(),
  // Nullable — a category- or plan-level event has no single PED.
  pedId: integer("ped_id"),
  entityType: mappingHistoryEntityEnum("entity_type").notNull(),
  // e.g. "created" | "updated" | "category_changed" | "approved" |
  // "rejected" | "alias_added" | "alias_removed" | "unmapped".
  action: text("action").notNull(),
  previousValue: jsonb("previous_value"),
  newValue: jsonb("new_value"),
  reason: text("reason"),
  performedBy: text("performed_by").notNull(),
  performedAt: timestamp("performed_at", { withTimezone: true }).notNull().defaultNow(),
});

export type MappingHistoryRow = typeof mappingHistory.$inferSelect;
export type NewMappingHistoryRow = typeof mappingHistory.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────
// ped_directory — the Lookup page's autocomplete dropdown source list,
// admin-facing name "PED Directory" (renamed from ped_suggestions to match
// the UI; the exported TS binding/repository/API route path were left as
// pedSuggestions / /api/ped-suggestions to avoid an app-wide rename churn —
// only the physical table name changed, via a plain ALTER TABLE ... RENAME
// migration, so no data was touched).
// `category` is now LIVE (see /api/ped-suggestions routes in server.ts and
// promotePedMappingOverride): assigning it there also upserts a row into
// ped_mapping_overrides, which is merged into TOP_PED_DICTIONARY (types.ts)
// for every plan — this table itself is still just the directory/autocomplete
// listing and stays the display source of truth for term text; it is
// ped_mapping_overrides (below) that the engine actually reads at match
// time. Seeded once from the existing client-side computed suggestion list
// (see App.tsx's old dynamicSuggestions pipeline). Scoped with a real
// id/addedBy/createdAt so a future admin UI (add/edit/delete terms, like
// Plan Management) can be layered on without another schema change.
// ─────────────────────────────────────────────────────────────────────────
export const pedSuggestions = pgTable("ped_directory", {
  id: serial("id").primaryKey(),
  // Display-cased term exactly as shown in the dropdown (e.g. "Diabetes
  // Type 2", "COPD") — unique so the same term can't be added twice.
  term: text("term").notNull().unique(),
  // Optional categoryKey (e.g. "diabetes", "hypertension" — see
  // CATEGORY_LABELS in types.ts) an admin can assign from the PED
  // Directory UI. Nullable: most of the 1,223 seeded terms have no category
  // yet. When set, the server also promotes it into ped_mapping_overrides
  // so the live matching engine (TOP_PED_DICTIONARY) picks it up for every
  // plan — see promotePedMappingOverride in server.ts.
  category: text("category"),
  addedBy: text("added_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type PedSuggestionRow = typeof pedSuggestions.$inferSelect;
export type NewPedSuggestionRow = typeof pedSuggestions.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────
// smoke_test_peds — admin/developer-added custom entries for the Smoke Test
// page's PED list. The page's baseline 50+ common PEDs are a hardcoded
// constant (COMMON_SMOKE_TEST_PEDS in src/constants/commonSmokeTestPeds.ts)
// since they're a fixed regression list, not admin-editable data — this
// table only holds the ADDITIONAL custom terms an Admin/Developer appends on
// top of that baseline. Read by everyone (the Smoke Test page is visible to
// every tier), writes gated to Admin/Developer in the API route layer, same
// pattern as PedSuggestionsRepository/ExternalResourcesRepository.
// ─────────────────────────────────────────────────────────────────────────
export const smokeTestPeds = pgTable("smoke_test_peds", {
  id: serial("id").primaryKey(),
  term: text("term").notNull(),
  addedBy: text("added_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type SmokeTestPedRow = typeof smokeTestPeds.$inferSelect;
export type NewSmokeTestPedRow = typeof smokeTestPeds.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────
// ai_memory — Level 2 of the three-level lookup memory.
//
//   L1  Deterministic Engine (engine.ts + TOP_PED_DICTIONARY + plan config)
//   L2  AI Memory (this table)
//   L3  Gemini
//
// Purpose is strictly COST/CACHING + human governance. When the
// deterministic engine cannot classify a PED, /api/match consults this
// table before calling Gemini; a hit returns the stored response and Gemini
// is never called again for that (condition, plan, engineVersion) triple.
// A miss calls Gemini once, then records the full response here with status
// 'pending' so it enters AI Mapping Review for manual review.
//
// This table is still NOT the deterministic engine and an L1 result always
// wins — nothing here can override or bypass an L1 result, since L1 returns
// before this table is ever read. However, approving a row now DOES attempt
// to promote it into ped_mapping_overrides (merged into TOP_PED_DICTIONARY
// for every plan) when the AI's plan-specific answer can be confidently
// generalized into a single categoryKey — see PATCH /api/ai-memory/:id/status
// and inferCategoryKeyForQuestion in server.ts. Ambiguous or fallback answers
// stay cache-only; rejecting a previously-approved entry un-promotes it.
//
// engineVersion is part of the cache key so that when the deterministic
// engine changes, previously cached AI answers are naturally invalidated
// (a new key misses and re-asks) rather than silently serving a stale
// mapping that the updated engine might now resolve differently.
//
// Extended for the PED repository DB migration (see
// PED_REPOSITORY_DB_MIGRATION_DESIGN.md §1.6 — this table doubles as the
// "AI Mapping Review" workflow's backing store; extended in place rather
// than migrated to a separate table). `confidence` is meaningful for
// AI-generated suggestions only — an approved mapping is treated as
// authoritative and does not get an artificial confidence score.
// ─────────────────────────────────────────────────────────────────────────
export const aiMemory = pgTable(
  "ai_memory",
  {
    id: serial("id").primaryKey(),
    // Original user input, preserved verbatim for the queue's detail panel.
    condition: text("condition").notNull(),
    // trim + lowercase + collapsed whitespace — the actual cache key, so
    // "Gynecomastia " and "gynecomastia" share one entry.
    normalizedCondition: text("normalized_condition").notNull(),
    planName: text("plan_name").notNull(),
    engineVersion: text("engine_version").notNull(),
    promptVersion: text("prompt_version").notNull(),
    geminiModel: text("gemini_model").notNull(),
    // Complete, unmodified Gemini response (match_type, matched_question,
    // explanation, confused_questions, …) so a cache hit can reproduce the
    // original answer exactly and the detail panel can show the raw JSON.
    aiResponse: jsonb("ai_response").notNull(),
    // pending | approved | rejected | archived
    status: text("status").notNull().default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    approvedBy: text("approved_by"),
    lastAccessedAt: timestamp("last_accessed_at", { withTimezone: true }),
    // Bumped on every cache hit — surfaces which unknown conditions are
    // frequently searched and therefore worth promoting into L1 by hand.
    accessCount: integer("access_count").notNull().default(0),
    // "HIGH" | "MEDIUM" | "LOW" — set only for AI-generated suggestions,
    // never for manually-approved mappings (those have no score at all).
    confidence: text("confidence"),
    // Pulled out of the raw aiResponse JSON for clean filtering/joins,
    // rather than requiring a JSON path query on every read.
    suggestedCategoryKey: text("suggested_category_key"),
    // References ped_repository.id — linked once/if this suggestion is
    // approved and promoted; null while pending or if rejected.
    pedId: integer("ped_id"),
  },
  // Array form (drizzle-orm >= 0.44); the older object form is deprecated.
  (table) => [
    // One cached answer per condition + plan + engine version.
    uniqueIndex("ai_memory_condition_plan_version_idx").on(
      table.normalizedCondition,
      table.planName,
      table.engineVersion
    ),
  ]
);

export type AiMemoryRow = typeof aiMemory.$inferSelect;
export type NewAiMemoryRow = typeof aiMemory.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────
// collision_repository — institutional memory of alias/category/plan/AI/
// regression collisions (PED_REPOSITORY_DB_MIGRATION_DESIGN.md §1.8).
// Advisory-only for the initial PED repository DB migration: nothing in
// engine.ts consults this table at match time yet. `severity`/`active`
// already let a later change decide which rows to actively enforce against
// (block a known-bad mapping) without another schema change — see
// "Approved Decisions" #1 in the design doc.
//
// The 5 collision types share one table rather than 5, since they share
// the same shape (a PED, a rejected outcome, an optional approved outcome,
// a reason) — collisionType is the discriminator:
//   alias      - multiple aliases resolving to the same canonical PED
//   category   - multiple plausible categories for the same PED, one
//                approved and the others explicitly rejected with reasoning
//   plan       - different plans legitimately map the same PED differently
//                due to their own question wording (see plan_overrides)
//   ai         - an AI suggestion that differed from an already-approved
//                mapping; the suggestion stays in ai_memory history but
//                must never silently override the approved row
//   regression - a known-incorrect mapping that must never recur (e.g.
//                Migraine -> Stroke, DVT -> Heart Disease, OSA -> Blood
//                Disorder) — permanent guardrails
// ─────────────────────────────────────────────────────────────────────────
export const collisionTypeEnum = pgEnum("collision_type", [
  "alias",
  "category",
  "plan",
  "ai",
  "regression",
]);

export const collisionSeverityEnum = pgEnum("collision_severity", ["guardrail", "advisory"]);

export const collisionRepository = pgTable("collision_repository", {
  id: serial("id").primaryKey(),
  collisionType: collisionTypeEnum("collision_type").notNull(),
  // Nullable — a regression entry can describe a term that was rejected
  // before it ever became a real ped_repository row.
  pedId: integer("ped_id"),
  // References categories.categoryKey.
  rejectedCategoryKey: text("rejected_category_key"),
  approvedCategoryKey: text("approved_category_key"),
  // For collisionType "plan".
  relatedPlanName: text("related_plan_name"),
  // References ai_memory.id — for collisionType "ai".
  relatedAiMemoryId: integer("related_ai_memory_id"),
  description: text("description").notNull(),
  severity: collisionSeverityEnum("severity").notNull().default("advisory"),
  // Lets a stale guardrail be retired without deleting history.
  active: boolean("active").notNull().default(true),
  addedBy: text("added_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type CollisionRepositoryRow = typeof collisionRepository.$inferSelect;
export type NewCollisionRepositoryRow = typeof collisionRepository.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────
// page_visibility — Developer-only kill switch for hiding a page from everyone
// else while work on it is in progress.
//
// Deliberately dumb: one row per feature id, one boolean. It is NOT a
// permissions system and does not interact with tiers, roles, or the
// featurePermissions registry — those still govern who *may* use a page.
// This only answers "is this page currently shown at all".
//
// Invariant enforced in the client's hasAccess(): a hidden page is still
// fully visible to the Developer. The Developer must never be able to lock
// themselves out of a page, including this one.
//
// Absence of a row means visible — so a brand-new page is shown by default
// and nothing needs seeding.
// ─────────────────────────────────────────────────────────────────────────
export const pageVisibility = pgTable("page_visibility", {
  // featurePermissions id (e.g. "smoke_test", "advisory_zone").
  featureId: text("feature_id").primaryKey(),
  hidden: boolean("hidden").notNull().default(false),
  updatedBy: text("updated_by"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type PageVisibilityRow = typeof pageVisibility.$inferSelect;
export type NewPageVisibilityRow = typeof pageVisibility.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────
// feature_access_overrides — Developer-editable override of a feature's
// General/Admin access level (see DEFAULT_FEATURE_PERMISSIONS in
// src/constants/featurePermissions.ts), managed from the "Permissions" tab
// on the Access Control Center page. This is what makes the previously
// hardcoded featurePermissions matrix editable through the UI without a
// code change/deploy.
//
// Same "dumb override table, absence = shipped default" shape as
// page_visibility above, deliberately: generalAccess/adminAccess are each
// nullable — a null column means "no override for this tier on this
// feature, fall back to DEFAULT_FEATURE_PERMISSIONS" rather than every row
// needing both columns populated. A brand-new feature id therefore needs no
// seeding and behaves exactly as it does today until a Developer explicitly
// overrides it.
//
// Through 2026-08 this table deliberately did NOT cover the ids in
// constants/featurePermissions.ts's DEVELOPER_ONLY_FEATURES set
// ("owner_controls", "connections", "smoke_test", "product_assist_quota")
// — those stayed a hardcoded hard-gate checked before this table was ever
// consulted (see hasAccess() in App.tsx), specifically so they could never
// leak to a lower tier via a stale/incomplete permission list, and the PUT
// route below refused to write an override row for them.
//
// As of 2026-09, DEVELOPER_ONLY_FEATURES is an empty Set (see
// featurePermissions.ts's doc comment for why) — all four ids are now
// ordinary governed features whose General/Admin access this table can
// override like any other, and the PUT route no longer special-cases them.
// ─────────────────────────────────────────────────────────────────────────
export const featureAccessLevelEnum = pgEnum("feature_access_level", ["None", "Viewer", "Editor"]);

export const featureAccessOverrides = pgTable("feature_access_overrides", {
  // featurePermissions id (e.g. "smoke_test", "advisory_zone") — same
  // identifier space as page_visibility.featureId above.
  featureId: text("feature_id").primaryKey(),
  generalAccess: featureAccessLevelEnum("general_access"),
  adminAccess: featureAccessLevelEnum("admin_access"),
  // Platform Admin (migration 0050): before this column existed, Platform
  // Admin unconditionally bypassed feature-level access evaluation — see
  // hasAccess() in App.tsx / requireFeatureAccess() in server.ts. Null
  // means "not yet configured for this feature", which both of those
  // resolve to "Editor" (not to the shipped defaultTier), so every existing
  // Platform Admin keeps identical access immediately after this column is
  // added, until a Developer/Platform Admin explicitly narrows it here.
  platformAdminAccess: featureAccessLevelEnum("platform_admin_access"),
  updatedBy: text("updated_by").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type FeatureAccessOverrideRow = typeof featureAccessOverrides.$inferSelect;
export type NewFeatureAccessOverrideRow = typeof featureAccessOverrides.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────
// departments — purely organizational metadata (Advisory, QA, Operations,
// etc.), managed from the "Departments" tab on Access Control Center.
// Introduced with the Access Control system (2026-08) alongside
// feature_access_overrides above, but deliberately UNRELATED to it at the
// time: a user's department on its own has never granted or denied
// anything — assigning someone to a department doesn't imply a permission
// by itself. It exists so the org structure can be represented and evolve
// (Developer can add/rename/deactivate/delete departments, Admin+Developer
// can assign a user to one — see users.department_id below) independently
// of the authorization model.
//
// UPDATE (Access Control Center Phase 3, 2026-09): department-scoped
// permissions are now a real, deliberate, auditable feature — an Access
// Rule (see `accessRules` below) can condition on departmentId, and
// Product Assist's eligibility settings can require one. A department
// still grants nothing on its own; it only matters if something else
// (an Access Rule, Product Assist eligibility) is explicitly configured to
// key off it.
//
// No seed rows: every department a Developer hasn't explicitly created
// simply doesn't exist yet, and every existing user starts with
// department_id = null ("unassigned") — there is no current organizational
// data to migrate into this.
//
// Deactivating (active=false) was originally the only removal path exposed
// in the UI; Phase 4 (2026-09) added a real delete, gated behind a
// dependency check (src/server/accessControl/catalogDependencies.ts) since
// deleting a department a live Access Rule or Product Assist's eligibility
// setting still references would silently widen/break that configuration —
// see that module's header comment. Deactivating remains available and is
// still the safer default for a department with users still assigned to
// it. onDelete: "set null" on the FK below is the DB-level backstop either
// way (a delete can never corrupt a referencing row).
// ─────────────────────────────────────────────────────────────────────────
export const departments = pgTable("departments", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  active: boolean("active").notNull().default(true),
  createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  nameUnique: uniqueIndex("departments_name_unique").on(table.name),
}));

export type DepartmentRow = typeof departments.$inferSelect;
export type NewDepartmentRow = typeof departments.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────
// org_teams — Bliss / Falcon / Central (Access Control system, Phase 2,
// 2026-08). Deliberately named "org_teams" in the database (never "teams")
// to avoid any confusion with the pre-existing, completely unrelated
// announcement_team enum (Health/Term skill-domain, see the `announcements`
// table above). The UI called this "Team" through 2026-09; renamed to
// "Business Unit" in the UI only (2026-09) — column/table names, FKs, and
// every other identifier here are unchanged, so this comment block still
// applies verbatim.
//
// Same shape and same reasoning as `departments` above: a freely-managed
// catalog (Developer/Platform Admin can add/rename/deactivate/delete — see
// departments' comment for the Phase 4 delete note, identical here), no
// seed membership assumed for existing users. Seeded here with Bliss/
// Falcon/Central as convenience starting rows ONLY — still a real, editable
// table, not a hardcoded enum, specifically so a 4th team can be added
// later without a migration.
//
// This comment originally anticipated org_teams eventually participating
// in row-level data-scoping decisions (which OTHER users' records someone
// can see) — that specific mechanism is still unbuilt (still a proposal in
// DATA_SCOPING_ARCHITECTURE.md, deferred as Phase 6 of
// ACCESS_CONTROL_CENTER_PHASE_PLAN.md). Separately, and sooner than that:
// Access Control Center Phase 3 (2026-09) DID wire org_teams into
// feature-level access — an Access Rule (see `accessRules` below) can
// condition on orgTeamId, and Product Assist's eligibility settings can
// require one. Same caveat as departments: a team grants nothing on its
// own, only if something else is configured to key off it.
// ─────────────────────────────────────────────────────────────────────────
export const orgTeams = pgTable("org_teams", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  active: boolean("active").notNull().default(true),
  createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  nameUnique: uniqueIndex("org_teams_name_unique").on(table.name),
}));

export type OrgTeamRow = typeof orgTeams.$inferSelect;
export type NewOrgTeamRow = typeof orgTeams.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────
// roles — job-function role (Advisor, Mentor, Guide, Ops, ...), Access
// Control system Phase 2 (2026-08). Same shape/reasoning as departments and
// org_teams above (freely-managed catalog; Developer/Platform Admin can
// add/rename/deactivate, and Access Control Center Phase 4 added a real,
// dependency-checked delete — see departments' comment).
//
// Deliberately a NEW, independent field — NOT the same thing as `tier`
// (General/Admin/Platform Admin/Developer, an access level) and NOT the
// same thing as qa_dashboard_roles' admin/guide/mentor (a QA-Dashboard-
// specific role sourced from a Google Sheet name match, unchanged by this
// migration). Two people can hold the same `tier` but different `role` (an
// Admin who is a Mentor vs an Admin who is a plain Advisor), and this
// table's rows have no relationship to qa_dashboard_roles' rows.
//
// Seeded with "Advisor", "Mentor", "Guide" as convenience starting rows —
// matching the vocabulary already used by qa_dashboard_roles for
// familiarity, not because the two systems are linked.
// ─────────────────────────────────────────────────────────────────────────
export const roles = pgTable("roles", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  active: boolean("active").notNull().default(true),
  createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  nameUnique: uniqueIndex("roles_name_unique").on(table.name),
}));

export type RoleRow = typeof roles.$inferSelect;
export type NewRoleRow = typeof roles.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────
// relationship_types — the catalog of relationship kinds usable in
// user_relationships below (e.g. "Mentor", "Guide", "Manager"). A separate
// lookup table (rather than a hardcoded enum) so a Developer/Platform Admin
// can add a new relationship kind from the UI without a deploy — the same
// "extensible without another migration" reasoning as org_teams/roles.
// Seeded with "Mentor" and "Guide" to match the concrete example given when
// this system was designed (a mentor scoped to their mapped mentees).
//
// departmentId (added migration 0071) optionally scopes a group to one
// Department — e.g. "Mentor" linked to the "Mentor Excellence" department.
// When set, the Groups tab's roster builder narrows its "owner"
// picker to that department's members instead of showing everyone; purely a
// UI convenience, this has no effect on access. NULL (the default) means
// unscoped, the original behavior. ON DELETE SET NULL, matching every other
// FK onto departments — deleting a department un-links the group rather
// than blocking the delete.
//
// Renamed from relationship_types (migration 0078, 2026-09) — purely a
// naming change, same table/rows/FKs otherwise.
// ─────────────────────────────────────────────────────────────────────────
export const relationshipGroups = pgTable("relationship_groups", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  active: boolean("active").notNull().default(true),
  departmentId: integer("department_id").references(() => departments.id, { onDelete: "set null" }),
  // Group Access (2026-09, redesigned 2026-09d) — see group_tool_access
  // below. Whether THIS group's owner->subject rows count as group-owner ->
  // group-member mappings for that feature. Deliberately a flag an admin
  // opts each group into, not a match on the group's name: this table
  // already carries Mentor/Guide rows populated for nearly every advisor
  // via the Advisor Directory sync (for QA Dashboard/Team Tracker
  // attribution — see GroupsManagement.tsx), so if EVERY group
  // activated it, shipping this would have silently granted overrides for
  // most of the advisor base the moment it deployed. An admin can name a
  // group anything ("Trainer", "Coach", "New Hires") and flip this on for
  // it from the Groups tab; nothing activates until they do, and
  // Mentor/Guide stay inert unless someone deliberately opts them in too.
  usedForGroupAccess: boolean("used_for_group_access").notNull().default(false),
  createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  nameUnique: uniqueIndex("relationship_groups_name_unique").on(table.name),
}));

export type RelationshipGroupRow = typeof relationshipGroups.$inferSelect;
export type NewRelationshipGroupRow = typeof relationshipGroups.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────
// user_relationships — explicit person-to-person mappings (e.g. "this
// Mentor's mentees are exactly these advisors"), Access Control system
// Phase 2 (2026-08). This is the concrete answer to "mapped to that
// particular member" from the original spec: a generic (owner, subject,
// relationship group) triple rather than a single hardcoded "reports to"
// field, so one person can hold multiple relationship kinds at once (e.g.
// mentored by one person AND guided by another) without another migration.
//
// ownerEmail is the person the relationship is FROM (e.g. the mentor);
// subjectEmail is who it's TO (e.g. the mentee). Both cascade-delete with
// their user row — a mapping referencing a since-deleted account is
// meaningless to keep around, unlike departments/org_teams/roles, which
// intentionally survive their last member via set-null.
//
// Inert metadata as of this migration, exactly like org_teams/roles above —
// nothing reads this table yet to actually filter what anyone sees. It
// exists so that enforcement can be added to a specific page later without
// yet another schema change.
// ─────────────────────────────────────────────────────────────────────────
export const userRelationships = pgTable("user_relationships", {
  id: serial("id").primaryKey(),
  ownerEmail: varchar("owner_email", { length: 320 }).notNull().references(() => users.email, { onDelete: "cascade" }),
  subjectEmail: varchar("subject_email", { length: 320 }).notNull().references(() => users.email, { onDelete: "cascade" }),
  relationshipGroupId: integer("relationship_group_id").notNull().references(() => relationshipGroups.id, { onDelete: "restrict" }),
  createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  tripleUnique: uniqueIndex("user_relationships_triple_unique").on(table.ownerEmail, table.subjectEmail, table.relationshipGroupId),
}));

export type UserRelationshipRow = typeof userRelationships.$inferSelect;
export type NewUserRelationshipRow = typeof userRelationships.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────
// group_tool_access — the Groups tab's per-feature access override list.
// REDESIGNED 2026-09d (at the user's explicit request) from a fail-closed
// hard ceiling into a plain additive grant, the same shape/semantics as
// custom_access_grants and access_rules: a row here means "members of this
// group get AT LEAST `level` on `featureId`", and it can only ever RAISE a
// member's access above whatever their tier default (plus any Access Rule/
// Custom Grant) already gives them — never lower it, and it never touches
// any feature that has no row here at all. There is no more fail-closed
// "block everything not explicitly granted" behavior; a member of an
// access-configured group is otherwise completely ordinary. See
// resolveAccess()'s own Group Access step in accessRuleEvaluator.ts.
//
// FEATURE ELIGIBILITY RESPECTS THE MEMBER'S OWN TIER, AUTOMATICALLY — there
// is no more separate `groupTier` column on relationship_groups (removed
// this same migration). A group can now hold members of mixed tiers at
// once, and a row here only ever applies to a given member if the feature
// is one their OWN tier can reach at all: an "Admin Zone" featureId (e.g.
// qa_announcement_log/Announcement Manager) only ever raises Admin,
// Platform Admin, or Developer members — a General-tier member of the very
// same group is completely unaffected by that row, as if it didn't exist
// for them. "Advisor Zone" featureIds apply to every tier. See
// ADVISOR_ZONE_FEATURES/ADMIN_ZONE_FEATURES and
// isFeatureGroupGrantableForTier() in featurePermissions.ts for the exact
// two lists and the tier check itself. "profile_access" (Access Control
// Center) can never appear here at all — same self-escalation boundary
// Custom Grants already respect for it (see that feature's own registry
// comment).
//
// `level` — "Viewer" or "Editor" (reuses feature_access_level, though
// "None" is never a legal value for a row that exists here — an admin who
// doesn't want to grant a feature simply has no row for it, rather than a
// row explicitly set to "None"). Defaults to "Editor" for rows that predate
// this column (2026-09d migration) — preserving exactly what a checked box
// meant before this redesign, for every group that already had one.
//
// One row per (relationship group, feature) — a group with zero rows here
// grants nothing extra; its members are entirely ordinary.
//
// PERMISSIONS ARE GROUP-LEVEL, NOT OWNER-LEVEL (migration 0081, 2026-09):
// relationshipGroupId is the key, not who currently owns the group. An
// owner is purely a user_relationships-level attribute — the person who
// manages a group's roster (its Owner column on the Groups tab) — and has
// zero bearing on what that group's members can access. One owner can
// manage several distinct groups, each with its own, independently
// configured grant set. Every member under the same relationshipGroupId
// shares that one group-wide grant set; there is deliberately no
// per-member override within a group, matching this feature's original
// framing (a whole group, not individual members within it).
// ─────────────────────────────────────────────────────────────────────────
export const groupToolAccess = pgTable("group_tool_access", {
  id: serial("id").primaryKey(),
  relationshipGroupId: integer("relationship_group_id").notNull().references(() => relationshipGroups.id, { onDelete: "cascade" }),
  featureId: text("feature_id").notNull(),
  level: featureAccessLevelEnum("level").notNull().default("Editor"),
  createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  groupFeatureUnique: uniqueIndex("group_tool_access_group_feature_unique").on(table.relationshipGroupId, table.featureId),
}));

export type GroupToolAccessRow = typeof groupToolAccess.$inferSelect;
export type NewGroupToolAccessRow = typeof groupToolAccess.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────
// custom_access_grants — per-INDIVIDUAL access overrides for when the
// structured Team/Department/Role model doesn't fit someone (Access Control
// system Phase 2, 2026-08). Deliberately ADD-ONLY: a grant can give someone
// MORE than their tier/role would normally allow, but is never consulted to
// take anything away — the structured model always stays a safety floor
// (see hasAccess() in App.tsx, which takes the MAX of the tier-resolved
// level and any active grant's level, never the grant alone).
//
// `grantType` + `targetId` are deliberately free text, not a foreign key,
// so a new kind of grant (right now only "feature_access", where targetId
// is a featurePermissions id) can be introduced later without a migration —
// same "extensible" reasoning as relationship_types. `level` only has
// meaning for grant types that resolve to a None/Viewer/Editor level;
// reuses feature_access_level rather than inventing a parallel enum.
//
// active (not hard-delete) preserves a record of what WAS granted and to
// whom, for audit purposes, even after a grant is revoked.
// ─────────────────────────────────────────────────────────────────────────
export const customAccessGrants = pgTable("custom_access_grants", {
  id: serial("id").primaryKey(),
  userEmail: varchar("user_email", { length: 320 }).notNull().references(() => users.email, { onDelete: "cascade" }),
  grantType: text("grant_type").notNull(),
  targetId: text("target_id").notNull(),
  level: featureAccessLevelEnum("level"),
  note: text("note"),
  active: boolean("active").notNull().default(true),
  grantedBy: text("granted_by").notNull(),
  grantedAt: timestamp("granted_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  tripleUnique: uniqueIndex("custom_access_grants_triple_unique").on(table.userEmail, table.grantType, table.targetId),
}));

export type CustomAccessGrantRow = typeof customAccessGrants.$inferSelect;
export type NewCustomAccessGrantRow = typeof customAccessGrants.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────
// access_rules — the condition-based rule engine for feature access (Access
// Control Center Phase 3, 2026-09; see docs/ACCESS_CONTROL_CENTER_PHASE_PLAN.md
// Phase 1). Generalizes custom_access_grants' per-INDIVIDUAL model to
// per-POPULATION: "anyone whose Team/Department/Role/Product Tag matches
// gets this level", instead of naming one person's email.
//
// resourceKey reuses the existing featurePermissions id space (same
// identifier as feature_access_overrides.featureId/page_visibility.featureId)
// — deliberately NOT a new catalog, so an Access Rule targets the exact same
// resource a Developer already sees on the Permissions tab. This is
// different from DATA_SCOPING_ARCHITECTURE.md's proposed (still unbuilt)
// data_scope_rules.resource_key, which solves a different problem (row-level
// filtering of OTHER users' records, not "can I use this feature") and is
// kept on its own table by design — see that doc's §4.
//
// Each condition column is independently nullable = "don't care" for that
// dimension, exactly like DATA_SCOPING_ARCHITECTURE.md §3.2's caller-
// eligibility columns (structured columns, not a JSON condition tree — same
// decision, same reasoning: cheap admin UI, additive escape hatch later if
// ever needed). All non-null conditions on one rule are AND'd together;
// multiple active rules for the same resourceKey are OR'd (any matching rule
// grants its level) — the same "list of independently-active rows, any
// match wins" pattern feature_access_overrides/custom_access_grants already
// use, so this stays consistent with the rest of the admin surface rather
// than introducing a boolean-expression language.
//
// grantedLevel reuses feature_access_level (None/Viewer/Editor) — same
// bundle model as everywhere else in this app; Access Rules do not grant
// fine-grained capabilities beyond that, matching how custom_access_grants
// already works.
//
// Shipped inert in Phase 1; Access Control Center Phase 3 (2026-09) is what
// actually wired evaluateAccess()/resolveAccess() into hasAccess()/
// requireFeatureAccess(), so rows here are live, not inert. Effective level
// is additive/grant-only, same as custom_access_grants — an Access Rule can
// only RAISE a caller's level above their tier-resolved default, never
// lower it, and can never change `tier` itself (Team/Department/Role/
// Product Tag must never elevate someone to Admin/Platform Admin/
// Developer — see resolveAccess() in src/accessRuleEvaluator.ts).
//
// Unlike departments/org_teams/roles (which Phase 4 gave a real,
// dependency-checked delete endpoint — see departments' comment above),
// access_rules still has no delete endpoint as of Phase 5: `active=false`
// is the only removal path for a rule today. Deliberate, not an oversight
// — deactivating a rule is reversible and self-contained (no dependents to
// check, unlike deleting a department/team/role that other rows still
// reference).
// ─────────────────────────────────────────────────────────────────────────
export const accessRules = pgTable("access_rules", {
  id: serial("id").primaryKey(),
  resourceKey: text("resource_key").notNull(),
  name: text("name").notNull(),
  active: boolean("active").notNull().default(true),
  // Caller-eligibility conditions — null on any of these four means "don't
  // care about this dimension" for this rule. All non-null ones must match
  // simultaneously (AND).
  orgTeamId: integer("org_team_id").references(() => orgTeams.id, { onDelete: "set null" }),
  departmentId: integer("department_id").references(() => departments.id, { onDelete: "set null" }),
  roleId: integer("role_id").references(() => roles.id, { onDelete: "set null" }),
  // Matches against one entry of the caller's users.tags array (e.g.
  // "Health"). Free text, not a FK, mirroring how tags themselves are a
  // free text[] column on users, not a catalog table.
  productTag: text("product_tag"),
  grantedLevel: featureAccessLevelEnum("granted_level").notNull(),
  createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type AccessRuleRow = typeof accessRules.$inferSelect;
export type NewAccessRuleRow = typeof accessRules.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────
// qa_dashboard_google_connection — the QA Dashboard's stored Google OAuth
// grant (see src/server/qaDashboard/*). Single-row table (id is always the
// literal string "default") holding an encrypted refresh token obtained
// when someone with sheet access clicks "Connect Google Sheets" in
// Developer Controls, so the app can read the QA team's Sheet read-only as
// that person — no Workspace admin action or service account needed. The
// refresh token itself is encrypted at rest (see tokenCrypto.ts); this
// table never stores it in plaintext.
// ─────────────────────────────────────────────────────────────────────────
export const qaDashboardGoogleConnection = pgTable("qa_dashboard_google_connection", {
  id: text("id").primaryKey().default("default"),
  connectedEmail: text("connected_email").notNull(),
  encryptedRefreshToken: text("encrypted_refresh_token").notNull(),
  connectedBy: text("connected_by").notNull(),
  connectedAt: timestamp("connected_at", { withTimezone: true }).notNull().defaultNow(),
});

export type QaDashboardGoogleConnectionRow = typeof qaDashboardGoogleConnection.$inferSelect;
export type NewQaDashboardGoogleConnectionRow = typeof qaDashboardGoogleConnection.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────
// kb_playbook_connection — the Product Playbook Google Sheet's stored OAuth
// grant, same shape/purpose as qaDashboardGoogleConnection above but kept
// as its own table since the Playbook Sheet has a different owner/account
// than the QA workbook (see "Connect Google Sheets" in Knowledge Base
// Management, not Developer Controls). Encrypted at rest — see
// src/server/knowledgeBase/playbookTokenCrypto.ts.
// ─────────────────────────────────────────────────────────────────────────
export const kbPlaybookConnection = pgTable("kb_playbook_connection", {
  id: text("id").primaryKey().default("default"),
  connectedEmail: text("connected_email").notNull(),
  encryptedRefreshToken: text("encrypted_refresh_token").notNull(),
  connectedBy: text("connected_by").notNull(),
  connectedAt: timestamp("connected_at", { withTimezone: true }).notNull().defaultNow(),
});

export type KbPlaybookConnectionRow = typeof kbPlaybookConnection.$inferSelect;
export type NewKbPlaybookConnectionRow = typeof kbPlaybookConnection.$inferInsert;

// term_playbook_connection — the Term Product Playbook Google Sheet's stored
// OAuth grant (2026-09). Same shape/purpose as kb_playbook_connection above,
// kept as its own table since the Term Playbook Sheet has a different
// owner/account than the Health one — same reasoning as term_faq_connection
// vs kb_faq_connection. Encrypted at rest — see
// src/server/knowledgeBase/termPlaybookTokenCrypto.ts.
export const termPlaybookConnection = pgTable("term_playbook_connection", {
  id: text("id").primaryKey().default("default"),
  connectedEmail: text("connected_email").notNull(),
  encryptedRefreshToken: text("encrypted_refresh_token").notNull(),
  connectedBy: text("connected_by").notNull(),
  connectedAt: timestamp("connected_at", { withTimezone: true }).notNull().defaultNow(),
});

export type TermPlaybookConnectionRow = typeof termPlaybookConnection.$inferSelect;
export type NewTermPlaybookConnectionRow = typeof termPlaybookConnection.$inferInsert;

// qa_dashboard_roles — who holds Admin/Guide/Mentor access on the QA
// Dashboard (src/server/qaDashboard/qaRoles.ts), managed from the "QA
// Dashboard Access" tab in User Directory & Management. Replaces the former
// QA_ADMIN_EMAILS/QA_GUIDE_EMAILS/QA_MENTOR_EMAILS env vars entirely — this
// table is the sole source of truth as of the 2026-07-30 cutover, which
// backfilled the exact membership those env vars held at the time (see
// drizzle/0022_qa_dashboard_roles.sql). displayName is only meaningful for
// guide/mentor: it must match the "Guide"/"Mentor Name" column text in the
// QA team's Google Sheet exactly (which may differ from this person's
// WebApp profile name) for src/server/qaDashboard/qaDataEngine.ts's
// getAdvisorsForGuide/getAdvisorsForMentor to find their team.
export const qaDashboardRoleEnum = pgEnum("qa_dashboard_role", ["admin", "guide", "mentor"]);

export const qaDashboardRoles = pgTable("qa_dashboard_roles", {
  email: varchar("email", { length: 320 }).primaryKey(),
  role: qaDashboardRoleEnum("role").notNull(),
  displayName: text("display_name"),
  assignedBy: text("assigned_by").notNull(),
  assignedAt: timestamp("assigned_at", { withTimezone: true }).notNull().defaultNow(),
});

export type QaDashboardRoleRow = typeof qaDashboardRoles.$inferSelect;
export type NewQaDashboardRoleRow = typeof qaDashboardRoles.$inferInsert;

// qa_evaluation_history — one-time archival imports of QA evaluation rows
// (Checked Date, Mistake Date, TACT ID, Advisor, Chat ID, Domain, Score),
// stitched in alongside the live master_feedback_dump Google Sheet
// (src/server/qaDashboard/qaDataEngine.ts) by getMergedFeedbackDumpRows() so
// score/blunder aggregates cover rows the Sheet itself is missing.
//
// Two batches so far, with two different overlap situations:
//   - The original import (source_batch NULL), June 2025-May 2026 —
//     confirmed before that table/script existed to be a period the live
//     Sheet never held at all, so there was no overlap/double-count risk by
//     construction. scripts/importQaEvaluationHistory.ts.
//   - The 2026-06 gap-fill batch (source_batch "2026-06-manual-backfill"),
//     covering June 2026 rows the freshly-launched live Sheet is missing —
//     this one DOES overlap the Sheet's own June 2026 date range by design
//     (the whole point is filling gaps within a range the Sheet also
//     covers), so the "no overlap" guarantee no longer holds by
//     construction for every batch. getMergedFeedbackDumpRows() instead
//     enforces it at read time: any archive row matching a live Sheet row on
//     (checked date, TACT ID, chat ID, domain, score) is dropped from the
//     merge, so a row present in both never double-counts, including if the
//     Sheet is later completed with the very rows this batch fills in.
//     scripts/importJune2026QaBackfill.ts.
//
// checkedDate/mistakeDate are stored as "yyyy-MM-dd" text rather than a
// native `date` column, matching the rest of the QA Dashboard's date-string
// convention (see DateFilters in qaDataEngine.ts) — this lets them plug
// directly into sheetsClient.ts's dateStringToSerial() with no
// driver-specific date-object handling to reconcile.
//
// This table only carries the six identification columns above — no
// dispute/escalation/feedback-text columns — so archive rows never appear in
// dispute/escalation review listings, only in score aggregates.
export const qaEvaluationHistory = pgTable(
  "qa_evaluation_history",
  {
    id: serial("id").primaryKey(),
    checkedDate: text("checked_date").notNull(), // yyyy-MM-dd
    mistakeDate: text("mistake_date"), // yyyy-MM-dd, nullable — ~24 source rows have it blank
    tactId: text("tact_id").notNull(),
    advisorName: text("advisor_name").notNull(),
    chatId: text("chat_id").notNull(),
    domain: text("domain").notNull(), // "CHAT" | "FIRST_CALL" | "PAYMENT_CALL"
    score: integer("score"), // nullable — ~31 source rows have no recorded score
    // Nullable — NULL means the original June 2025-May 2026 import (which
    // predates this column). Every import since stamps its own id here so
    // deleteByBatch() can wipe and re-import just one batch (see the table
    // comment above) instead of the whole table.
    sourceBatch: text("source_batch"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("qa_evaluation_history_tact_id_idx").on(table.tactId),
    index("qa_evaluation_history_checked_date_idx").on(table.checkedDate),
  ]
);

export type QaEvaluationHistoryRow = typeof qaEvaluationHistory.$inferSelect;
export type NewQaEvaluationHistoryRow = typeof qaEvaluationHistory.$inferInsert;

export type SearchHistoryRow = typeof searchHistory.$inferSelect;
export type NewSearchHistoryRow = typeof searchHistory.$inferInsert;

export type ChangeLogRow = typeof changeLogs.$inferSelect;
export type NewChangeLogRow = typeof changeLogs.$inferInsert;

export type AnnouncementRow = typeof announcements.$inferSelect;
export type NewAnnouncementRow = typeof announcements.$inferInsert;

export type AnnouncementAckRow = typeof announcementAcks.$inferSelect;
export type NewAnnouncementAckRow = typeof announcementAcks.$inferInsert;

export type FlaggedIssueRow = typeof flaggedIssues.$inferSelect;
export type NewFlaggedIssueRow = typeof flaggedIssues.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────
// Knowledge Base — "Ask the Playbook" advisor Q&A assistant. Grounds Gemini
// answers in this app's own curated resources instead of depending on
// NotebookLM (which has no self-serve API and can't be embedded natively —
// see conversation history). Three source types feed kbChunks/live lookups
// differently:
//   pdf   — parsed/chunked/embedded once at upload time (re-embedded only if
//           replaced).
//   web   — parsed/chunked/embedded at add time, re-crawled periodically
//           with change-detection (contentHash) so only actually-changed
//           pages get re-embedded.
//   sheet — the Product Playbook Google Sheet, currently a single resource
//           row (see src/server/knowledgeBase/playbookIngest.ts). Its own
//           OAuth grant lives in kbPlaybookConnection below (separate
//           account/owner from the QA Dashboard's), re-parsed on-demand via
//           a Resync button plus a lazy periodic refresh (checked
//           opportunistically at query time, not a live Sheets call on
//           every message — the sheet is too large for that). Split two
//           ways at ingestion: its narrative tabs (Recommendation
//           specifics / FAQs & Narratives / Feature Description) are
//           chunked/embedded into kbChunks like a normal document; its
//           feature x plan comparison tabs are reshaped into
//           kbPlaybookPlanFacts instead — see that table's comment for why.
// kbAnnouncements are a separate, always-injected, always-authoritative
// channel — not retrieved via vector similarity like kbChunks. Per the
// explicit governance rule this table exists to satisfy: when a resource
// (PDF/web/Playbook) conflicts with a dated product-team announcement, the
// announcement wins. kbPlaybookPlanFacts sits one rung below announcements
// and above generic PDF/web content in that same precedence — see
// productAssist.ts's SYSTEM_INSTRUCTION SOURCE PRECEDENCE list.
// ─────────────────────────────────────────────────────────────────────────
export const kbCategoryTypeEnum = pgEnum("kb_category_type", ["insurer", "general", "fundamentals"]);

// A category is either one insurer's resource bucket (HDFC Ergo, Care
// Health, ...), the catch-all "general" bucket (IRDAI, cross-insurer
// FAQs, etc.), or a "fundamentals" bucket (2026-09 — see below).
// Deliberately just a plain table (not a hardcoded enum of insurer names)
// so new categories can be added from the admin UI at any
// time without a migration — the one open requirement from the original
// ask ("possibility of adding new categories in future").
//
// type: "fundamentals" — a dedicated, domain-scoped conceptual-knowledge
// layer (e.g. "Insurance Fundamentals" for Health, later a separate one for
// Term — domain keeps the two isolated exactly like every other category)
// holding background material on how insurance mechanics work and how
// policy provisions relate to each other, deliberately separate from the
// catch-all "general" ("General / Others") bucket: unlike "general"
// resources, which only ever enter retrieval for a "General" question with
// no insurer selected (see productAssist.ts's resolveEligibleResourceIds),
// "fundamentals" resources are retrieved via their own always-on, tightly
// bounded, relevance-thresholded channel (see productAssist.ts's
// retrieveFundamentalsChunks) regardless of whether an insurer/plan is
// selected — never blended into the normal Policy Wording -> Prospectus ->
// Brochure/other staged retrieval, and never treated as authoritative for a
// product-specific fact (SOURCE PRECEDENCE #5 in SYSTEM_INSTRUCTION). Kept
// out of resolveEligibleResourceIds's General-question category pool (and
// out of the plan/insurer-name detectors) for exactly this reason — see
// that function's own comment.
export const kbCategories = pgTable("kb_categories", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  type: kbCategoryTypeEnum("type").notNull().default("insurer"),
  // Which Product Assist/Knowledge Base vertical this category belongs to
  // (2026-09, Term insurance rollout) — reuses the exact `announcement_team`
  // enum/values announcements.team already established for the identical
  // Health/Term skill-domain concept (see that column's comment), rather
  // than defining a parallel enum with the same two values. A Health-
  // tagged user only ever sees domain="Health" categories in Product
  // Assist/Knowledge Base, a Term-tagged user only "Term" ones, and a user
  // with both tags (or none — same convention as announcements.team) gets
  // a toggle between them. Every category that existed before this column
  // was added is a Health insurer/general bucket, hence the default.
  domain: announcementTeamEnum("domain").notNull().default("Health"),
  sortOrder: integer("sort_order").notNull().default(0),
  // Admin-curated list of this insurer's plan names — the suggestion source
  // for tagging a resource (kb_resources.planTags, 0029) so an admin picks
  // from real options instead of free-typing every time. Only meaningful
  // for type="insurer" categories. See 0030_kb_category_plan_names.sql.
  planNames: text("plan_names").array().notNull().default([]),
  // A plan name that's been disabled rather than deleted — hidden from the
  // "N plans" count, the quick-add suggestions, and Product Assist's plan
  // scope picker (ProductAssistPage.tsx's selectablePlanNames), but its
  // resources keep their planTags untouched (see kb_resources.planTags) so
  // nothing is orphaned and the plan can be re-enabled by clearing its entry
  // here. A separate array (not a removal from planNames itself) because a
  // resource can still be legitimately tagged with a disabled plan's name —
  // deleting the roster entry outright would make planNamesForCategory
  // silently resynthesize it from those tags anyway (by design, so tagged
  // resources are never orphaned), which is exactly the "can't actually
  // delete/disable a plan with resources" bug this column fixes. See
  // 0046_kb_plan_disable_insurer_resources.sql.
  disabledPlanNames: text("disabled_plan_names").array().notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const kbResourceTypeEnum = pgEnum("kb_resource_type", ["pdf", "web", "sheet"]);
// processing: upload accepted, parsing/embedding not finished yet.
// active: ready and included in retrieval. error: ingestion failed
// (errorMessage carries why) — excluded from retrieval until fixed/retried.
// archived: soft-deleted, kept for history, excluded from retrieval.
export const kbResourceStatusEnum = pgEnum("kb_resource_status", ["processing", "active", "error", "archived"]);

// What KIND of document this is, independent of type (pdf/web/sheet) and
// category (insurer) — the "clean Knowledge Base" rebuild's single-purpose
// resources are one Brochure, one Policy Wording, and one Prospectus PDF
// per plan instead of a merged multi-document file, and this is what lets
// productAssist.ts apply the authority precedence Policy Wording > Prospectus
// > Brochure across them at retrieval/citation time — see
// 0034_kb_resource_document_type.sql. 'other' covers everything that isn't
// one of those three (claim guides, glossaries, the Playbook resource, and
// every pre-"clean start" legacy merged file).
export const kbDocumentTypeEnum = pgEnum("kb_document_type", ["brochure", "policy_wording", "prospectus", "addon", "other"]);

export const kbResources = pgTable(
  "kb_resources",
  {
    id: serial("id").primaryKey(),
    categoryId: integer("category_id").notNull().references(() => kbCategories.id, { onDelete: "cascade" }),
    type: kbResourceTypeEnum("type").notNull(),
    title: text("title").notNull(),
    documentType: kbDocumentTypeEnum("document_type").notNull().default("other"),
    // Web: the source URL. PDF: original filename (the parsed text lives in
    // kbChunks — the raw file itself isn't persisted, see pdfIngest.ts).
    // Sheet: the Google Sheet URL (informational; the live read path doesn't
    // use this column at query time).
    sourceUrl: text("source_url"),
    status: kbResourceStatusEnum("status").notNull().default("processing"),
    // Web only — hash of the last-fetched page content, so the periodic
    // re-crawl can skip re-embedding a page that hasn't actually changed.
    contentHash: text("content_hash"),
    lastFetchedAt: timestamp("last_fetched_at", { withTimezone: true }),
    chunkCount: integer("chunk_count").notNull().default(0),
    errorMessage: text("error_message"),
    // Multi-plan tagging within this resource's insurer category — e.g.
    // "HDFC Ergo Add-ons.pdf" tagged ["Optima Secure", "my:health Medisure"]
    // so it's surfaced for questions about either plan, not locked to one
    // via a dropdown. Free-form text[] (same pattern as users.tags,
    // 0026_advisor_tags.sql) rather than an enum, since insurers sell plans
    // beyond this app's 6 deterministic-engine plans. Empty array = not
    // plan-specific — applies broadly within its category; see
    // 0029_kb_resource_plan_tags.sql.
    planTags: text("plan_tags").array().notNull().default([]),
    // True for an insurer/company-level document (claim process, general
    // claim guidelines, insurer-wide processes) that isn't tied to any plan
    // and shouldn't be — distinct from planTags=[] (which means "applies
    // broadly to every plan under this insurer", the existing untagged-
    // resource semantics used throughout the Plans tab and retrieval). An
    // insurer-level resource is deliberately excluded from every plan's
    // resource count/bucket (see resourcesForPlanKey in
    // KnowledgeBaseResourceManagement.tsx) and surfaced only in its
    // category's separate "Insurer Resources" section. See
    // 0046_kb_plan_disable_insurer_resources.sql.
    isInsurerLevel: boolean("is_insurer_level").notNull().default(false),
    addedBy: text("added_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("kb_resources_category_id_idx").on(table.categoryId)]
);

// gemini-embedding-001 at 768 output dimensions (Matryoshka-truncated from
// its native 3072) — one of Google's officially-recommended reduced sizes,
// chosen over the full 3072 so the HNSW index below stays cheap to build
// and query at this app's scale.
//
// The Product Playbook Sheet's own resource row feeds this table too, but
// only from its narrative-shaped tabs (Recommendation specifics / FAQs &
// Narratives / Feature Description) — those work fine as similarity-
// retrieved excerpts. Its per-insurer feature-comparison tabs do NOT come
// through here; see kbPlaybookPlanFacts below for why those are always
// injected in full instead.
export const kbChunks = pgTable(
  "kb_chunks",
  {
    id: serial("id").primaryKey(),
    resourceId: integer("resource_id").notNull().references(() => kbResources.id, { onDelete: "cascade" }),
    chunkIndex: integer("chunk_index").notNull(),
    content: text("content").notNull(),
    embedding: vector("embedding", { dimensions: 768 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("kb_chunks_resource_id_idx").on(table.resourceId)]
);

// kb_playbook_plan_facts — one row per (insurer, plan) reshaped fact-sheet,
// parsed from the Playbook's feature x plan comparison tabs (see
// src/server/knowledgeBase/playbookIngest.ts's parseMatrixTab). Unlike
// kbChunks, this is never similarity-retrieved — it's always injected into
// the Product Assist prompt in full the moment the advisor's selected
// plan(s) match, the same "always inject" treatment kbAnnouncements gets,
// because partial/similarity retrieval could silently drop the one line
// that actually answers the question (e.g. which single bonus type is
// inbuilt on a plan, out of several the insurer offers across its range).
export const kbPlaybookPlanFacts = pgTable(
  "kb_playbook_plan_facts",
  {
    id: serial("id").primaryKey(),
    resourceId: integer("resource_id").notNull().references(() => kbResources.id, { onDelete: "cascade" }),
    // Which Product Assist vertical these facts belong to (2026-09, Term
    // Playbook rollout) — same announcement_team enum/reasoning as
    // kb_categories.domain. Every row already lives under a single
    // per-domain resourceId (the Health Playbook resource vs the Term
    // Playbook resource), so this column is a belt-and-suspenders guard
    // against findMatching()'s cross-resource `listAll()` scan ever
    // blending a Term plan's facts into a Health answer or vice versa,
    // rather than the primary isolation mechanism. Every row that existed
    // before this column was added is Health-authored, hence the default.
    domain: announcementTeamEnum("domain").notNull().default("Health"),
    // Free text, matched case-insensitively against kb_categories.name at
    // query time (see productAssist.ts) — not a foreign key, since one
    // Playbook tab's plans can span category names that don't exist yet as
    // kb_categories rows.
    insurerName: text("insurer_name").notNull(),
    // The plan's exact column header from the sheet, e.g. "HDFC Ergo Optima
    // Secure+" — matched case-insensitively against kb_resources.planTags /
    // the advisor's selected scope.planTags, same convention as the rest of
    // the Knowledge Base.
    planName: text("plan_name").notNull(),
    // Which sheet tab this plan's facts came from (e.g. "Dittos Recommended
    // Policies", "ICICI Lombard") — admin-facing only, for the Resync
    // status panel.
    sourceTab: text("source_tab").notNull(),
    content: text("content").notNull(),
    // Cell notes/comments from the source sheet (2026-09, Product Playbook
    // advisor UI) — the little hover-only annotation Google Sheets attaches
    // to a cell, captured separately from `content` above rather than
    // folded into it, since `content` is what's injected verbatim into the
    // Product Assist prompt (see productAssist.ts's playbookInputs) and
    // must stay byte-identical to before this feature existed. One entry
    // per note found: a note on the plan's own header cell (label: "Plan"),
    // or a note on a specific feature/sub-feature's value cell for this
    // plan (label: that row's feature/sub-feature label, e.g. "Room Rent —
    // Single Private Room"). Empty array on every row synced before notes
    // support existed, or when the sheet simply has no notes for that plan.
    // See playbookIngest.ts's parseMatrixTab / termPlaybookIngest.ts's
    // parseTermMatrixTab for how this is populated, and
    // playbookSheetsClient.ts's fetchPlaybookSheetNotes for how the note
    // grid itself is fetched (same spreadsheets.readonly OAuth scope
    // already granted for values — no new consent needed).
    notes: jsonb("notes").$type<{ label: string; note: string }[]>().notNull().default([]),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("kb_playbook_plan_facts_resource_id_idx").on(table.resourceId),
    index("kb_playbook_plan_facts_insurer_plan_idx").on(table.insurerName, table.planName),
  ]
);

export type KbPlaybookPlanFactRow = typeof kbPlaybookPlanFacts.$inferSelect;
export type NewKbPlaybookPlanFactRow = typeof kbPlaybookPlanFacts.$inferInsert;

// Dated product-team announcements — always injected into the query-time
// prompt (not retrieved via similarity search), explicitly marked as
// overriding any conflicting PDF/web/Playbook content. categoryId is
// nullable: a null-category announcement applies generally (e.g. "Moratorium
// period reduced from 8 years to 5 years" isn't insurer-specific).
export const kbAnnouncements = pgTable(
  "kb_announcements",
  {
    id: serial("id").primaryKey(),
    categoryId: integer("category_id").references(() => kbCategories.id, { onDelete: "set null" }),
    title: text("title").notNull(),
    body: text("body").notNull(),
    effectiveDate: date("effective_date").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("kb_announcements_category_id_idx").on(table.categoryId)]
);

export const kbChatSessions = pgTable(
  "kb_chat_sessions",
  {
    id: serial("id").primaryKey(),
    userEmail: text("user_email").notNull(),
    // First question's snippet — lets a future session-history list show
    // something meaningful without joining to the first message every time.
    title: text("title"),
    // Scope chosen when the session starts (insurer + optional plan tags,
    // or both null/empty for a "General" session) — every follow-up turn
    // in the same multi-turn conversation reuses this scope automatically.
    // See 0031_kb_chat_session_scope.sql.
    categoryId: integer("category_id").references(() => kbCategories.id, { onDelete: "set null" }),
    planTags: text("plan_tags").array().notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("kb_chat_sessions_user_email_idx").on(table.userEmail)]
);

export const kbChatRoleEnum = pgEnum("kb_chat_role", ["user", "assistant"]);

export const kbChatMessages = pgTable(
  "kb_chat_messages",
  {
    id: serial("id").primaryKey(),
    sessionId: integer("session_id").notNull().references(() => kbChatSessions.id, { onDelete: "cascade" }),
    role: kbChatRoleEnum("role").notNull(),
    content: text("content").notNull(),
    // Array of { title, primaryReference } the answer was grounded in —
    // only populated on "assistant" rows, powers a citations list in the UI.
    sources: jsonb("sources"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("kb_chat_messages_session_id_idx").on(table.sessionId)]
);

export type KbCategoryRow = typeof kbCategories.$inferSelect;
export type NewKbCategoryRow = typeof kbCategories.$inferInsert;

export type KbResourceRow = typeof kbResources.$inferSelect;
export type NewKbResourceRow = typeof kbResources.$inferInsert;

export type KbChunkRow = typeof kbChunks.$inferSelect;
export type NewKbChunkRow = typeof kbChunks.$inferInsert;

export type KbAnnouncementRow = typeof kbAnnouncements.$inferSelect;
export type NewKbAnnouncementRow = typeof kbAnnouncements.$inferInsert;

export type KbChatSessionRow = typeof kbChatSessions.$inferSelect;
export type NewKbChatSessionRow = typeof kbChatSessions.$inferInsert;

export type KbChatMessageRow = typeof kbChatMessages.$inferSelect;
export type NewKbChatMessageRow = typeof kbChatMessages.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────
// product_assist_logs — server-side record of Product Assist conversations,
// added 2026-08 to build a real representative test set for the
// optimization-review testing strategy (Product Assist Quality-Preserving
// Optimization Review, Section 6) — Product Assist's normal design
// deliberately keeps NO server-side record of conversations otherwise (see
// productAssist.ts / ProductAssistPage.tsx's doc comments: chat history
// itself still lives only in the advisor's own browser; this table exists
// purely for admin-side quality review and cost/usage visibility). Gated by
// the PRODUCT_ASSIST_LOG_ENABLED env flag so it can be turned off entirely.
//
// PERMANENCE (revised 2026-09): originally time-boxed and deleted from the
// DB once exported to the connected Google Sheet. Changed to a permanent
// record on direct user request, specifically so the "AI Usage & Limits" >
// Usage History admin tab can always expand any row (old or new) to show
// its full query detail, matching everything the Sheet export already
// carries — see exportedAt below and productAssistLogExport.ts. The Sheet
// export is now a periodic COPY (rows are marked exported, never deleted),
// not a move-and-clear.
// ─────────────────────────────────────────────────────────────────────────
export const productAssistLogs = pgTable(
  "product_assist_logs",
  {
    id: serial("id").primaryKey(),
    userEmail: text("user_email").notNull(),
    // Links this row to the exact product_assist_usage_ledger entry the same
    // /ask request wrote (2026-09, migration 0067) — lets the Usage History
    // admin tab look up one usage row's full query detail directly instead
    // of a fragile timestamp/user match. Nullable: rows written before this
    // column existed, and any future call path that records usage without
    // logging (or vice versa), have no link. onDelete: "set null" rather than
    // cascade — a usage ledger row is never deleted in normal operation, but
    // this log row's own detail should survive regardless.
    usageLedgerId: integer("usage_ledger_id").references(() => productAssistUsageLedger.id, { onDelete: "set null" }),
    // Denormalized alongside categoryId (not just a FK) so a row still
    // reads meaningfully in the exported Sheet even if the category is
    // later renamed or deleted from kb_categories.
    categoryId: integer("category_id"),
    categoryName: text("category_name"),
    planTags: text("plan_tags").array().notNull().default([]),
    question: text("question").notNull(),
    // The verified "answer" field (productAssist.ts's structured output) —
    // never the customer-facing "share" paraphrase alone, since "answer" is
    // what test-set authors need to judge correctness/completeness against.
    answer: text("answer").notNull(),
    share: text("share"),
    // ProductAssistSource[] as sent to the advisor — title/categoryName/
    // documentType/sourceUrl per distinct source, for judging citation and
    // source-fidelity accuracy against the real documents later.
    sources: jsonb("sources").notNull().default([]),
    hadNoMatches: boolean("had_no_matches").notNull().default(false),
    retrievedChunkCount: integer("retrieved_chunk_count").notNull().default(0),
    playbookFactCount: integer("playbook_fact_count").notNull().default(0),
    historyTurnCount: integer("history_turn_count").notNull().default(0),
    // Gemini's own usageMetadata token counts, when the SDK response
    // includes them — nullable since that's not guaranteed on every call.
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    // The actual resolved model Gemini reports back via
    // response.modelVersion (2026-09, migration 0066) — not just the
    // GENERATION_MODEL alias productAssist.ts requested, since Google can
    // route an alias to a specific dated snapshot behind the scenes. Null
    // for the deterministic Special-Instruction-conflict answer path (see
    // buildConflictAnswer), where no AI call is made at all.
    modelName: text("model_name"),
    latencyMs: integer("latency_ms"),
    // Null = not yet exported to the Sheet (still in the "next export batch"
    // — see productAssistLogsRepository.ts's listUnexported()). Set once
    // appendProductAssistLogRows() confirms the append succeeded (2026-09,
    // migration 0067) — the row itself is never deleted afterward; see this
    // table's PERMANENCE comment above.
    exportedAt: timestamp("exported_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("product_assist_logs_created_at_idx").on(table.createdAt),
    index("product_assist_logs_exported_at_idx").on(table.exportedAt),
    index("product_assist_logs_usage_ledger_id_idx").on(table.usageLedgerId),
  ]
);

export type ProductAssistLogRow = typeof productAssistLogs.$inferSelect;
export type NewProductAssistLogRow = typeof productAssistLogs.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────
// product_assist_log_export_connection — same single-row shape/purpose as
// qaDashboardGoogleConnection above (see that table's comment), but this
// grant requests the WRITE `spreadsheets` scope rather than
// `spreadsheets.readonly`, since it's used to append product_assist_logs rows
// to an export Sheet (see productAssistLogSheetsClient.ts) rather than to
// read one. Kept as its own table/connection — deliberately never reuses
// the QA Dashboard's or Playbook's stored grant — so this is the only place
// in the app holding a credential capable of writing to a Google Sheet.
// Encrypted at rest; see productAssistLogTokenCrypto.ts.
// ─────────────────────────────────────────────────────────────────────────
export const productAssistLogExportConnection = pgTable("product_assist_log_export_connection", {
  id: text("id").primaryKey().default("default"),
  connectedEmail: text("connected_email").notNull(),
  encryptedRefreshToken: text("encrypted_refresh_token").notNull(),
  connectedBy: text("connected_by").notNull(),
  connectedAt: timestamp("connected_at", { withTimezone: true }).notNull().defaultNow(),
});

export type ProductAssistLogExportConnectionRow = typeof productAssistLogExportConnection.$inferSelect;
export type NewProductAssistLogExportConnectionRow = typeof productAssistLogExportConnection.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────
// Product Assist Credit & Usage Management (2026-08, eligibility model
// revised 2026-09-07 — "multiple eligibility groups, no trial fallback").
// A NEW administrative quota layer sitting entirely around the existing
// Product Assist AI call — it does not read from or write to
// product_assist_logs above (that table is explicitly temporary/disableable
// and written fire-and-forget, so it cannot be trusted as quota's source of
// truth). Five tables:
//
//   - product_assist_quota_settings: single global settings row (the
//     token->credit conversion rate, warning threshold, company monthly
//     budget, and API pricing) — every knob a Developer/Platform Admin can
//     tune from the "AI Usage & Limits" Settings tab without a code change
//     or redeploy. As of 2026-09-07 this table no longer holds any
//     eligibility or default-credit fields — those moved to
//     product_assist_eligibility_groups below, since a single global
//     Department/Team/Role/Tag rule with one shared allowance couldn't
//     express "give this other group of users a different limit" without
//     overwriting the first group.
//   - product_assist_eligibility_groups: an ordered list of admin-defined
//     groups, each with its own optional Department/Team/Role/Tag matching
//     conditions (same "null = don't care about this dimension, AND across
//     the ones that are set" semantics as access_rules — see
//     ruleMatchesCaller() in accessRuleEvaluator.ts, which this mirrors)
//     and its own daily/monthly credit limits (each independently nullable
//     = uncapped on that dimension). A user can match more than one group;
//     see resolveMatchedGroups()/deriveGroupLimits() in
//     productAssistQuota.ts for how the limits combine (highest wins,
//     independently per dimension). A user matching NO group gets zero
//     monthly credits (blocked) — as of 2026-09-07 there is no automatic
//     "everyone else" trial allotment; an admin who wants to give a
//     specific non-matching user access uses the per-user override or
//     extra-credit mechanisms below, or a deliberately blank/wildcard
//     group.
//   - product_assist_user_quota_overrides: sparse, one row per user who has
//     ANY override set (custom daily/monthly limit, limits disabled
//     entirely, or explicit unlimited access). No row = "use the computed
//     default from this user's matched eligibility group(s)" — see
//     resolveMatchedGroups() in productAssistQuota.ts.
//   - product_assist_extra_credit_grants: append-only ledger of admin
//     top-ups (and removals/reductions, recorded as a negative-amount
//     entry rather than mutating a past row). Grants never expire BY
//     DEFAULT — the current extra-credit balance for a user is SUM(amount)
//     across their non-expired rows (expiresAt null OR in the future),
//     added on top of their MONTHLY limit only (a grant never raises the
//     daily cap). expiresAt (added migration 0049) is optional, set by the
//     granting admin at grant time; leaving it unset preserves the
//     original "never expires" behavior exactly.
//   - product_assist_usage_ledger: the actual credit-consumption record
//     used for enforcement. Deliberately separate from product_assist_logs
//     above — this table is written SYNCHRONOUSLY (awaited) immediately
//     after every successful Product Assist AI call, always on regardless
//     of PRODUCT_ASSIST_LOG_ENABLED, and exists solely to answer "how many
//     credits has this user used today / this calendar month."
// ─────────────────────────────────────────────────────────────────────────
export const productAssistQuotaSettings = pgTable("product_assist_quota_settings", {
  id: text("id").primaryKey().default("default"),
  // 1 credit = this many actual AI tokens (input + output combined) —
  // configurable rather than hardcoded anywhere in the enforcement code.
  tokensPerCredit: integer("tokens_per_credit").notNull().default(1000),
  warningThresholdPercent: integer("warning_threshold_percent").notNull().default(80),
  monthlyBudget: numeric("monthly_budget", { precision: 12, scale: 2 }).notNull().default("2000"),
  budgetWarningThresholdPercent: integer("budget_warning_threshold_percent").notNull().default(80),
  currency: text("currency").notNull().default("INR"),
  // Cost-estimation config only (never affects enforcement, which is
  // credit-based) — mirrors productAssist.ts's GENERATION_MODEL constant so
  // pricing can be corrected/updated without touching code.
  modelName: text("model_name").notNull().default("gemini-2.5-flash"),
  inputPricePerMillionTokens: numeric("input_price_per_million_tokens", { precision: 12, scale: 4 }).notNull().default("0"),
  outputPricePerMillionTokens: numeric("output_price_per_million_tokens", { precision: 12, scale: 4 }).notNull().default("0"),
  updatedBy: text("updated_by"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type ProductAssistQuotaSettingsRow = typeof productAssistQuotaSettings.$inferSelect;
export type NewProductAssistQuotaSettingsRow = typeof productAssistQuotaSettings.$inferInsert;

// Added migration 0064, replacing product_assist_quota_settings'
// eligibleDepartmentId/eligibleOrgTeamId/eligibleRoleId (a single global
// rule) plus its defaultDailyCredits/defaultMonthlyCredits/
// trialMonthlyCredits (one shared allowance for that rule, plus a fallback
// for everyone else). See this section's header comment above for the full
// reasoning; see resolveMatchedGroups()/deriveGroupLimits() in
// productAssistQuota.ts for how a user's matched group(s) become their
// effective limits.
export const productAssistEligibilityGroups = pgTable("product_assist_eligibility_groups", {
  id: serial("id").primaryKey(),
  // Admin-facing label only (e.g. "Falcon Advisory Team") — never matched
  // against anything, purely so the Settings tab and Users tab can show
  // which group(s) a user qualifies through.
  name: text("name").notNull(),
  // Matching conditions — null on any of these four means "don't care
  // about this dimension" for this group; every non-null one must match
  // simultaneously (AND). A group with all four null matches every user (a
  // deliberate, if unusual, wildcard — same allowance as access_rules).
  // onDelete: "set null" so deactivating (not deleting) a referenced
  // catalog row can't leave a dangling reference — it just quietly widens
  // that dimension to "any" rather than erroring.
  departmentId: integer("department_id").references(() => departments.id, { onDelete: "set null" }),
  orgTeamId: integer("org_team_id").references(() => orgTeams.id, { onDelete: "set null" }),
  roleId: integer("role_id").references(() => roles.id, { onDelete: "set null" }),
  // Matches against one entry of the user's users.tags array (e.g.
  // "Health"). Free text, not a FK, mirroring access_rules.productTag —
  // ADVISOR_TAG_OPTIONS (AdvisorTagCheckboxes.tsx) is the admin UI's
  // dropdown source, not a DB-enforced constraint.
  tag: text("tag"),
  // This group's own limits — independently nullable (null = uncapped on
  // that dimension for a user matching this group). See
  // deriveGroupLimits() for how multiple matched groups combine.
  dailyCredits: integer("daily_credits"),
  monthlyCredits: integer("monthly_credits"),
  sortOrder: integer("sort_order").notNull().default(0),
  createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type ProductAssistEligibilityGroupRow = typeof productAssistEligibilityGroups.$inferSelect;
export type NewProductAssistEligibilityGroupRow = typeof productAssistEligibilityGroups.$inferInsert;

export const productAssistUserQuotaOverrides = pgTable("product_assist_user_quota_overrides", {
  userEmail: varchar("user_email", { length: 320 })
    .primaryKey()
    .references(() => users.email, { onDelete: "cascade" }),
  // Null = fall through to this user's computed bucket default.
  customDailyCredits: integer("custom_daily_credits"),
  customMonthlyCredits: integer("custom_monthly_credits"),
  // false = quota enforcement is fully switched off for this user
  // (distinct from unlimitedAccess below so the admin UI/audit trail can
  // record which specific toggle was used — both produce the same
  // practical effect of never blocking this user).
  limitsEnabled: boolean("limits_enabled").notNull().default(true),
  unlimitedAccess: boolean("unlimited_access").notNull().default(false),
  updatedBy: text("updated_by").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type ProductAssistUserQuotaOverrideRow = typeof productAssistUserQuotaOverrides.$inferSelect;
export type NewProductAssistUserQuotaOverrideRow = typeof productAssistUserQuotaOverrides.$inferInsert;

export const productAssistExtraCreditGrants = pgTable(
  "product_assist_extra_credit_grants",
  {
    id: serial("id").primaryKey(),
    userEmail: varchar("user_email", { length: 320 })
      .notNull()
      .references(() => users.email, { onDelete: "cascade" }),
    // Positive = grant, negative = an admin removal/reduction entry. Never
    // mutate a past row — a removal is always a new, negative-amount row,
    // so the full grant/removal history stays intact for audit.
    amount: integer("amount").notNull(),
    reason: text("reason"),
    grantedBy: text("granted_by").notNull(),
    grantedAt: timestamp("granted_at", { withTimezone: true }).notNull().defaultNow(),
    // Optional, added migration 0049. Null = never expires (the original,
    // still-default behavior). When set, this grant is excluded from
    // balanceForUser/balancesByUser once expiresAt is in the past — the row
    // itself is never deleted or mutated, so grant/removal history stays
    // intact for audit exactly as before.
    expiresAt: timestamp("expires_at", { withTimezone: true }),
  },
  (table) => [index("product_assist_extra_credit_grants_user_email_idx").on(table.userEmail)]
);

export type ProductAssistExtraCreditGrantRow = typeof productAssistExtraCreditGrants.$inferSelect;
export type NewProductAssistExtraCreditGrantRow = typeof productAssistExtraCreditGrants.$inferInsert;

export const productAssistUsageLedger = pgTable(
  "product_assist_usage_ledger",
  {
    id: serial("id").primaryKey(),
    userEmail: varchar("user_email", { length: 320 }).notNull(),
    inputTokens: integer("input_tokens").notNull(),
    outputTokens: integer("output_tokens").notNull(),
    totalTokens: integer("total_tokens").notNull(),
    credits: numeric("credits", { precision: 10, scale: 3 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("product_assist_usage_ledger_user_created_idx").on(table.userEmail, table.createdAt)]
);

export type ProductAssistUsageLedgerRow = typeof productAssistUsageLedger.$inferSelect;
export type NewProductAssistUsageLedgerRow = typeof productAssistUsageLedger.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────
// ai_usage_log (2026-09, migration 0068) — cross-feature AI usage tracking,
// "for visibility only." product_assist_usage_ledger above stays the ONE
// source of truth for Product Assist's credit ENFORCEMENT (unchanged by
// this table); this one exists purely so "AI Usage & Limits" > Overview can
// show a real total-cost picture across every Gemini call site in the app,
// per direct user request — Declaration Assist's PED-to-question matching
// (/api/match), Specific Illness Check's "Check with AI" fallback, and Plan
// Management's "Refine with AI" workflow, alongside Product Assist itself
// (mirrored here too, from the exact same call that writes the ledger
// above, so Product Assist's own row counts once towards enforcement and
// once towards this cross-feature total — see server.ts's /ask route).
// Deliberately lightweight — no quota/limit logic ever reads this table,
// and none ever will; it only ever gates the enforcement-specific ledger
// above, per the user's explicit instruction that "the limits should be
// applicable to only product assist."
// ─────────────────────────────────────────────────────────────────────────
export const aiUsageSourceEnum = pgEnum("ai_usage_source", [
  "product_assist",
  "declaration_assist_match",
  "specific_illness_ai_check",
  "plan_management_ai_workflow",
]);

export const aiUsageLog = pgTable(
  "ai_usage_log",
  {
    id: serial("id").primaryKey(),
    source: aiUsageSourceEnum("source").notNull(),
    userEmail: varchar("user_email", { length: 320 }).notNull(),
    // The actual model that answered (see productAssist.ts's
    // response.modelVersion precedent) — several of these sources try
    // multiple models in sequence on transient failures, so this is never
    // assumed from a single constant the way Product Assist's own
    // GENERATION_MODEL used to be.
    model: text("model").notNull(),
    inputTokens: integer("input_tokens").notNull(),
    outputTokens: integer("output_tokens").notNull(),
    totalTokens: integer("total_tokens").notNull(),
    // Short, source-specific context for an admin glancing at raw rows —
    // e.g. the PED condition text or plan name — never the full
    // question/answer detail Product Assist's own product_assist_logs
    // carries (this table is a lightweight tally, not a query-detail log).
    // Truncated by the caller before insert; nullable since not every
    // source has an obvious single label.
    label: text("label"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("ai_usage_log_created_at_idx").on(table.createdAt),
    index("ai_usage_log_source_created_idx").on(table.source, table.createdAt),
  ]
);

export type AiUsageLogRow = typeof aiUsageLog.$inferSelect;
export type NewAiUsageLogRow = typeof aiUsageLog.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────
// ai_model_pricing (2026-09, migration 0068) — admin-editable $/million-
// token pricing per Gemini model, keyed by model name. Exists because
// ai_usage_log above spans several call sites that each try more than one
// model (see aiUsageLog's own comment), so the single global model/price
// pair on product_assist_quota_settings (which only ever needs to describe
// Product Assist's own one model) can't accurately cost a mixed-model
// total. Used exclusively by the cross-feature Overview cost estimate;
// Product Assist's own existing budget tracking keeps reading
// product_assist_quota_settings's pricing fields, unchanged.
// ─────────────────────────────────────────────────────────────────────────
export const aiModelPricing = pgTable("ai_model_pricing", {
  modelName: text("model_name").primaryKey(),
  inputPricePerMillionTokens: numeric("input_price_per_million_tokens", { precision: 12, scale: 4 }).notNull().default("0"),
  outputPricePerMillionTokens: numeric("output_price_per_million_tokens", { precision: 12, scale: 4 }).notNull().default("0"),
  updatedBy: text("updated_by"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type AiModelPricingRow = typeof aiModelPricing.$inferSelect;
export type NewAiModelPricingRow = typeof aiModelPricing.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────
// special_instructions — Product Assist's "Special Instructions" layer
// (Knowledge Base, 2026-08). A small, admin-curated set of controlled
// instructions Product Assist checks BEFORE consulting the normal
// knowledge-retrieval chain (Product Playbook -> Policy Wording -> other
// resources; see productAssist.ts's SOURCE PRECEDENCE). Purely additive: when
// no active instruction matches a given question, retrieval and answer
// behavior is byte-identical to before this table existed.
//
// Three types, increasing generality, decreasing authority:
//   - override_rule: highest authority in the whole retrieval chain. When
//     one applies to a topic, its statement of that topic is used INSTEAD
//     OF conflicting Playbook/document content, the same "exclusive"
//     treatment the Playbook already gets over document excerpts one rung
//     down (SOURCE PRECEDENCE #1) — this becomes the new #0.
//   - additional_information: supplementary context injected ALONGSIDE the
//     normal retrieved resources — never a replacement for the underlying
//     product/policy facts.
//   - general_instruction: broad guidance on how to handle a topic (e.g.
//     "distinguish X from Y") — advisory only, same non-override treatment
//     as additional_information.
//
// Scope is two independent optional fields, not a single enum — see
// productAssist.ts's SOURCE PRECEDENCE #8/#9 (spec) for the resulting 4-level
// specificity ladder this produces:
//   insurerCategoryId + productPlanName both set -> Product+Insurer+Topic (most specific)
//   productPlanName only                          -> Product+Topic
//   insurerCategoryId only                         -> Insurer+Topic
//   neither set                                    -> Topic only (globally applicable)
// Topic relevance itself (is this question actually ABOUT this topic, not
// just same insurer/product) is established separately at query time via
// embedding similarity against `topicEmbedding` — see
// src/server/knowledgeBase/specialInstructions.ts. Deliberately reuses the
// exact query embedding productAssist.ts already computes for kbChunks
// retrieval (RETRIEVAL_QUERY task type) — zero extra embedding calls.
// ─────────────────────────────────────────────────────────────────────────
export const specialInstructionTypeEnum = pgEnum("special_instruction_type", [
  "override_rule",
  "additional_information",
  "general_instruction",
]);

export const specialInstructions = pgTable(
  "special_instructions",
  {
    id: serial("id").primaryKey(),
    topic: text("topic").notNull(),
    instructionText: text("instruction_text").notNull(),
    instructionType: specialInstructionTypeEnum("instruction_type").notNull(),
    // Optional insurer scope — reuses kb_categories (type="insurer") rather
    // than a free-text insurer name, consistent with the rest of the
    // Knowledge Base. Nullable = applies across insurers (subject to the
    // productPlanName/topic checks below).
    insurerCategoryId: integer("insurer_category_id").references(() => kbCategories.id, { onDelete: "set null" }),
    // Optional product/plan scope. Free text, matched case-insensitively
    // against the advisor's effective plan tags at query time — same
    // convention as kbResources.planTags / kbPlaybookPlanFacts.planName,
    // since a Product+Topic instruction (no Insurer) must still be
    // supportable per the spec, and plan-name rosters are themselves free
    // text (kb_categories.planNames).
    productPlanName: text("product_plan_name"),
    // Which Product Assist vertical this instruction applies to (2026-09,
    // Term insurance rollout) — same `announcement_team` enum/reasoning as
    // kb_categories.domain above. Checked as an additional, deterministic
    // condition in scopeMatches() alongside insurerCategoryId/productPlanName
    // — a Term query never sees a Health-authored instruction and vice
    // versa, even one with insurerCategoryId left null ("applies across
    // insurers" was never meant to mean "applies across verticals too").
    // Every instruction that existed before this column was added is
    // Health-authored, hence the default.
    domain: announcementTeamEnum("domain").notNull().default("Health"),
    // gemini-embedding-001 at 768 dims (RETRIEVAL_DOCUMENT task type),
    // embedding just the Topic string — recomputed on every create/update
    // that changes `topic`. See embeddings.ts's KB_EMBEDDING_DIMENSIONS.
    topicEmbedding: vector("topic_embedding", { dimensions: 768 }).notNull(),
    isActive: boolean("is_active").notNull().default(true),
    createdBy: text("created_by").notNull(),
    updatedBy: text("updated_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("special_instructions_insurer_category_id_idx").on(table.insurerCategoryId),
    index("special_instructions_is_active_idx").on(table.isActive),
  ]
);

export type SpecialInstructionRow = typeof specialInstructions.$inferSelect;
export type NewSpecialInstructionRow = typeof specialInstructions.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────
// product_assist_unresolved_queries (2026-09) — a PERSISTENT record of every
// Product Assist question the AI couldn't answer at all, distinct from and
// unrelated to product_assist_logs above (that table is explicitly
// temporary/disableable and gets periodically exported-and-cleared — a poor
// fit for a queue admins are meant to work through and keep a durable
// history of). One row is created automatically, fire-and-forget, from
// server.ts's POST /api/product-assist/ask whenever answerQuery() returns
// hadNoMatches=true (see productAssist.ts's ProductAssistAnswer.hadNoMatches
// doc comment — "nothing usable was found in scope": no document chunks, no
// Playbook facts, no FAQ match, and no Special Instruction matched). This is
// deliberately NOT deduplicated against prior rows for the same/similar
// question — a topic that keeps recurring is itself useful signal for which
// gap to prioritize closing, and the admin workflow (see
// ProductAssistQuotaPage.tsx's "Unresolved Queries" tab) is built around
// working through/filtering the raw list, not a pre-collapsed one.
//
// Resolution workflow: an admin reviews a row and either
//   - Resolves it by adding a Special Instruction (Override Rule or
//     Additional Information) covering the topic via the exact same form
//     Knowledge Base > Special Instructions uses (see
//     SpecialInstructionFormModal.tsx) — once that instruction is active, a
//     future matching question naturally stops producing hadNoMatches=true
//     (see specialInstructions.ts's resolveApplicableInstructions() and
//     productAssist.ts's hadNoMatches computation, which already counts
//     overrideRules/advisory hits as "found something"). This row is then
//     linked to the created instruction via resolvedSpecialInstructionId so
//     the connection is traceable later.
//   - Skips it (status="skipped") when no KB change is warranted — e.g. a
//     one-off, out-of-scope, or nonsensical question.
// Both actions, plus a manual reopen back to "unresolved", are simple status
// PATCHes (see server.ts) — creating the Special Instruction itself goes
// through the existing, separately-authorized POST /api/kb/special-
// instructions route (Developer/Platform Admin only), never duplicated here.
// ─────────────────────────────────────────────────────────────────────────
export const unresolvedQueryStatusEnum = pgEnum("unresolved_query_status", ["unresolved", "resolved", "skipped"]);

export const productAssistUnresolvedQueries = pgTable(
  "product_assist_unresolved_queries",
  {
    id: serial("id").primaryKey(),
    // Health/Term — see special_instructions.domain's comment above for the
    // same reasoning; scopes both the admin UI's filter and the Google
    // Sheets export's Health/Term tab split.
    domain: announcementTeamEnum("domain").notNull(),
    userEmail: text("user_email").notNull(),
    // Denormalized alongside categoryId (not just a FK), same convention as
    // product_assist_logs.categoryName — a row stays meaningful even if the
    // category is later renamed/deleted.
    categoryId: integer("category_id").references(() => kbCategories.id, { onDelete: "set null" }),
    categoryName: text("category_name"),
    planTags: text("plan_tags").array().notNull().default([]),
    question: text("question").notNull(),
    status: unresolvedQueryStatusEnum("status").notNull().default("unresolved"),
    // Set only when status="resolved" via the "add a Special Instruction"
    // path — onDelete: "set null" so deleting the instruction later doesn't
    // break this historical row, it just quietly loses the traceable link.
    resolvedSpecialInstructionId: integer("resolved_special_instruction_id").references(() => specialInstructions.id, {
      onDelete: "set null",
    }),
    resolvedBy: text("resolved_by"),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("product_assist_unresolved_queries_created_at_idx").on(table.createdAt),
    index("product_assist_unresolved_queries_status_idx").on(table.status),
    index("product_assist_unresolved_queries_domain_idx").on(table.domain),
  ]
);

export type ProductAssistUnresolvedQueryRow = typeof productAssistUnresolvedQueries.$inferSelect;
export type NewProductAssistUnresolvedQueryRow = typeof productAssistUnresolvedQueries.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────
// kb_acronyms — the Acronym Dictionary: shorthand advisors habitually type
// (e.g. "OS" for "Optima Secure", "CBB" for "Cumulative Bonus Booster") is explicitly
// mapped to its full expansion, so Product Assist can recognize it instead
// of treating the question as ambiguous or under-retrieving for it. Small,
// admin-curated, in-app CRUD (same convention as Special Instructions
// above) — deliberately NOT embedding-matched like Special Instructions'
// topic or the Ditto FAQ's question: an acronym is a short, exact token
// (not a phrase with room for semantic drift), so a plain word-boundary,
// case-insensitive string match against the question text is both simpler
// and more precise than a similarity threshold would be here. See
// src/server/knowledgeBase/acronyms.ts for how this is matched and applied
// at query time (retrieval-query expansion, plan-name detection, and a
// small reference block in the prompt).
// ─────────────────────────────────────────────────────────────────────────
export const kbAcronyms = pgTable(
  "kb_acronyms",
  {
    id: serial("id").primaryKey(),
    // Stored as the admin typed it (e.g. "OS") — matching lowercases both
    // sides, so case doesn't matter at query time, only for display here.
    acronym: text("acronym").notNull(),
    // The full term/phrase the acronym stands for, e.g. "Optima Secure",
    // "Cumulative Bonus Super". When this exactly matches (case-
    // insensitively) a plan name in the scoped insurer's roster
    // (kb_categories.planNames), the acronym is also treated as naming that
    // plan for retrieval/Playbook scoping — see acronyms.ts.
    expansion: text("expansion").notNull(),
    // Optional admin-facing disambiguation note (e.g. "HDFC Ergo only — ICICI
    // uses OS for a different plan"), never shown to the advisor directly;
    // folded into the prompt's reference block only if present.
    notes: text("notes"),
    // Which Product Assist vertical this acronym belongs to (2026-09, Term
    // insurance rollout) — same `announcement_team` enum/reasoning as
    // kb_categories.domain above. A Health-tagged advisor's questions are
    // only ever expanded against Health acronyms, a Term-tagged advisor's
    // only against Term ones — a shorthand like "OS" ("Optima Secure", a
    // Health plan) has no business firing on a Term question. Every acronym
    // that existed before this column was added is Health-authored, hence
    // the default.
    domain: announcementTeamEnum("domain").notNull().default("Health"),
    isActive: boolean("is_active").notNull().default(true),
    createdBy: text("created_by").notNull(),
    updatedBy: text("updated_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("kb_acronyms_is_active_idx").on(table.isActive)]
);

export type KbAcronymRow = typeof kbAcronyms.$inferSelect;
export type NewKbAcronymRow = typeof kbAcronyms.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────
// kb_faq_connection — the Ditto FAQ Google Sheet's stored OAuth grant, same
// shape/purpose as kbPlaybookConnection above but its own table since the
// FAQ workbook has its own owner/account, separate from the Playbook's (see
// "Connect Google Sheets" in Knowledge Base Management, not Developer
// Controls). Encrypted at rest — see src/server/knowledgeBase/faqTokenCrypto.ts.
// ─────────────────────────────────────────────────────────────────────────
export const kbFaqConnection = pgTable("kb_faq_connection", {
  id: text("id").primaryKey().default("default"),
  connectedEmail: text("connected_email").notNull(),
  encryptedRefreshToken: text("encrypted_refresh_token").notNull(),
  connectedBy: text("connected_by").notNull(),
  connectedAt: timestamp("connected_at", { withTimezone: true }).notNull().defaultNow(),
});

export type KbFaqConnectionRow = typeof kbFaqConnection.$inferSelect;
export type NewKbFaqConnectionRow = typeof kbFaqConnection.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────
// faq_records — "Ditto FAQ" (2026-08): Ditto's own official Q&A rulebook,
// imported read-only from a dedicated Google Sheet (2 tabs: "Sheet1" =
// Health Product FAQs, "Operations Health FAQs" = Operations Health FAQs;
// only column A/question and column B/answer are ever read — see
// src/server/knowledgeBase/faqIngest.ts). Deliberately its OWN table, not
// folded into kb_chunks like a normal document: an FAQ record is always a
// whole (question, answer) pair, never chunked, and needs question-weighted
// retrieval (see faqRelevanceThreshold in faq.ts) rather than generic
// passage similarity — see productAssist.ts's SOURCE PRECEDENCE #1 ("ORG
// CONSTITUTION"), where this is an equal-authority peer to
// kb_playbook_plan_facts, never a subordinate DOCUMENT EXCERPT.
//
// One kb_resources row (type="sheet", title="Ditto FAQ", in the "general"/
// "Org Constitution" category) owns every faq_records row the same way
// the Playbook Sheet owns kb_playbook_plan_facts — see faqIngest.ts's
// syncFaq.
// ─────────────────────────────────────────────────────────────────────────
export const faqCategoryEnum = pgEnum("faq_category", ["health_product", "operations_health"]);

export const faqRecords = pgTable(
  "faq_records",
  {
    id: serial("id").primaryKey(),
    resourceId: integer("resource_id").notNull().references(() => kbResources.id, { onDelete: "cascade" }),
    category: faqCategoryEnum("category").notNull(),
    question: text("question").notNull(),
    // Preserved verbatim from Column B — never rewritten/summarized/
    // "improved" at ingestion (spec: FAQ answers must not be altered).
    // Empty string when the sheet's Column B was blank; isAnswerable below
    // is what actually gates whether this can be used as a sourced answer,
    // not this field being non-empty.
    answer: text("answer").notNull().default(""),
    // false when Column B was blank ("INCOMPLETE FAQ" per spec §17) — never
    // used as an authoritative answer, but still stored/visible for admin
    // review. Also false for every row in a conflicting-duplicate group
    // (hasConflict below), so a conflict can never be silently used either.
    isAnswerable: boolean("is_answerable").notNull().default(true),
    // true when this question (normalized: trim + collapse whitespace +
    // casefold) appears more than once in the SAME category tab with
    // MATERIALLY DIFFERENT answers — per spec §18, never auto-resolved.
    // Excluded from retrieval (see faq.ts) until an admin deactivates the
    // stale duplicate(s) via isActive below, at which point a resync will
    // naturally stop re-flagging it (only the remaining active question
    // text is compared against). Duplicate rows whose answers were
    // materially IDENTICAL are collapsed into a single canonical row at
    // ingestion instead — see faqIngest.ts — so they never reach this table
    // as separate conflicting rows.
    hasConflict: boolean("has_conflict").notNull().default(false),
    // The normalized question text shared by every row in a conflict group,
    // so the admin review UI can group them — null when hasConflict=false.
    conflictGroupKey: text("conflict_group_key"),
    // gemini-embedding-001 at 768 dims (RETRIEVAL_DOCUMENT task type),
    // embedding ONLY the question text — never the answer — which is what
    // gives "FAQ question receives the strongest retrieval weight" (spec §9)
    // by construction, the same convention special_instructions.topic_embedding
    // already uses for its topic-only matching. Null whenever this record
    // must never be used as an authoritative answer (isAnswerable=false or
    // hasConflict=true) — a null embedding structurally can't be
    // similarity-matched, on top of faq.ts's own explicit filter.
    questionEmbedding: vector("question_embedding", { dimensions: 768 }),
    // 1-based row number in the source tab — admin/debug traceability only,
    // never surfaced to advisors (spec §13/§20: internal metadata only).
    sourceRowNumber: integer("source_row_number").notNull(),
    // Lets an admin retire a bad/outdated record (e.g. one side of a
    // resolved conflict) without waiting for the next sheet edit — full
    // resync still fully replaces this table's contents (see faqIngest.ts's
    // replaceForResource), so a manual deactivation only "sticks" until the
    // next resync unless it's also fixed at the sheet level; that's a
    // deliberate, documented limitation matching kb_playbook_plan_facts'
    // own always-replace-on-resync convention (the Sheet, not this table,
    // is the authoring source per spec §19).
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("faq_records_resource_id_idx").on(table.resourceId),
    index("faq_records_category_idx").on(table.category),
    index("faq_records_is_active_idx").on(table.isActive),
  ]
);

export type FaqRecordRow = typeof faqRecords.$inferSelect;
export type NewFaqRecordRow = typeof faqRecords.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────
// term_faq_connection / term_faq_records — "Term FAQ" (2026-09): imported
// read-only from its own Google Sheet (7 tabs — see
// src/server/knowledgeBase/termFaqIngest.ts). Originally built to feed only
// the Did You Know card's Term side (src/server/knowledgeBase/didYouKnow.ts)
// with no questionEmbedding column at all — Term Product Assist (added
// later the same month) reuses this exact table as its Org Constitution
// #1b peer, the same role faq_records plays for Health, which is why
// questionEmbedding exists below now. Same shape as kbFaqConnection/
// faqRecords above in every other respect. `category` is plain text here
// (the tab name itself, e.g. "ADD-ONS/ RIDERS") rather than a pgEnum — 7
// tabs today, vs. Health's 2, and more likely to be renamed/added to over
// time.
// ─────────────────────────────────────────────────────────────────────────
export const termFaqConnection = pgTable("term_faq_connection", {
  id: text("id").primaryKey().default("default"),
  connectedEmail: text("connected_email").notNull(),
  encryptedRefreshToken: text("encrypted_refresh_token").notNull(),
  connectedBy: text("connected_by").notNull(),
  connectedAt: timestamp("connected_at", { withTimezone: true }).notNull().defaultNow(),
});

export type TermFaqConnectionRow = typeof termFaqConnection.$inferSelect;
export type NewTermFaqConnectionRow = typeof termFaqConnection.$inferInsert;

export const termFaqRecords = pgTable(
  "term_faq_records",
  {
    id: serial("id").primaryKey(),
    resourceId: integer("resource_id").notNull().references(() => kbResources.id, { onDelete: "cascade" }),
    category: text("category").notNull(),
    question: text("question").notNull(),
    answer: text("answer").notNull().default(""),
    isAnswerable: boolean("is_answerable").notNull().default(true),
    hasConflict: boolean("has_conflict").notNull().default(false),
    conflictGroupKey: text("conflict_group_key"),
    // gemini-embedding-001 at 768 dims (RETRIEVAL_DOCUMENT task type),
    // embedding ONLY the question text — added 2026-09 when Term Product
    // Assist started retrieving Term FAQ the same way Health's faq_records.
    // questionEmbedding already works (see that column's comment for the
    // "question receives the strongest retrieval weight" reasoning). Null
    // for every row synced before this column existed, and for any row
    // that must never be used as an authoritative answer (isAnswerable=
    // false or hasConflict=true) — same convention as faq_records.
    questionEmbedding: vector("question_embedding", { dimensions: 768 }),
    sourceRowNumber: integer("source_row_number").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("term_faq_records_resource_id_idx").on(table.resourceId),
    index("term_faq_records_category_idx").on(table.category),
    index("term_faq_records_is_active_idx").on(table.isActive),
  ]
);

export type TermFaqRecordRow = typeof termFaqRecords.$inferSelect;
export type NewTermFaqRecordRow = typeof termFaqRecords.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────
// advisor_directory_sync_state — one row per directory user this app's
// Advisor Directory Sync (src/server/qaDashboard/advisorDirectorySync.ts)
// has ever touched, tracking EXACTLY what it last wrote to that user's
// department/team/role/tags. Not a duplicate of the user directory — a
// separate "who owns this field's current value" ledger, so a later sync
// run can:
//   1. Skip a re-write when the sheet's desired state already matches what
//      was applied last time (idempotent no-op, not counted as "updated").
//   2. Safely UNDO its own assignment when a user drops off "Currently
//      Employed" — but ONLY the specific field values it recorded here as
//      self-applied, and ONLY if the user's live value still equals that
//      recorded value. If a Developer/Platform Admin has since manually
//      changed the field (live value != what's recorded here), the sync
//      leaves it alone — this table is what makes "do not overwrite
//      manually managed fields unless explicitly owned by this sync"
//      possible without guessing at intent.
// A missing row for a given user simply means the sync has never touched
// them — nothing to compare against, nothing to revert.
// ─────────────────────────────────────────────────────────────────────────
export const advisorDirectorySyncState = pgTable("advisor_directory_sync_state", {
  userEmail: varchar("user_email", { length: 320 })
    .primaryKey()
    .references(() => users.email, { onDelete: "cascade" }),
  // master_advisors identity this row was last matched against — display/
  // debugging only, no FK (the sheet is external, not a DB table).
  sheetTactId: text("sheet_tact_id"),
  // This sync's last-seen employment status for this user. false the
  // instant a sync run either sees "not Currently Employed" or no longer
  // finds the row at all.
  currentlyEmployed: boolean("currently_employed").notNull().default(false),
  // The exact Department/Team/Role/tag values THIS sync wrote, or null in
  // each slot once reverted (see the table comment above) — never a
  // snapshot of the user's current live value, which may have since moved
  // on independently (a manual edit, or a different subsystem).
  appliedDepartmentId: integer("applied_department_id").references(() => departments.id, { onDelete: "set null" }),
  appliedOrgTeamId: integer("applied_org_team_id").references(() => orgTeams.id, { onDelete: "set null" }),
  appliedRoleId: integer("applied_role_id").references(() => roles.id, { onDelete: "set null" }),
  appliedProductTags: text("applied_product_tags").array().notNull().default([]),
  lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }).notNull().defaultNow(),
  lastSyncedBy: text("last_synced_by").notNull(),
});

export type AdvisorDirectorySyncStateRow = typeof advisorDirectorySyncState.$inferSelect;
export type NewAdvisorDirectorySyncStateRow = typeof advisorDirectorySyncState.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────
// coaching_sessions / coaching_actionables — Team Tracker's Coaching
// Workspace (src/pages/TeamTrackerPage.tsx's floating "Coaching" panel). A
// row here is created ONLY when a Guide/Mentor/Admin explicitly clicks
// Save on a draft coaching note for one advisor — unsaved drafts live
// entirely in the browser's own localStorage and never reach this table
// (see coachingService.ts). Once saved, a session is an append-only entry
// in that advisor's permanent Coaching History — the current UI never
// edits or deletes one after the fact.
//
// authorEmail/authorName are plain text, NOT a users.email foreign key —
// same choice change_logs (userName, above) already makes for this kind of
// append-only meeting log: it must stay legible even if the author's
// account is later renamed or removed, rather than cascading away with it.
//
// Access control (who can save/read a given advisor's sessions) is not
// enforced here at the schema level — it's the same Guide-owns-their-team /
// Mentor-owns-their-mentees / Admin-sees-everyone scope teamTrackerService's
// resolvePool() already computes for the rest of Team Tracker, reused
// as-is by coachingService.ts rather than duplicated.
// ─────────────────────────────────────────────────────────────────────────
export const coachingActionableStatusEnum = pgEnum("coaching_actionable_status", ["Open", "In Progress", "Completed", "Failed"]);

export const coachingSessions = pgTable(
  "coaching_sessions",
  {
    id: serial("id").primaryKey(),
    tactId: text("tact_id").notNull(),
    advisorName: text("advisor_name").notNull(),
    authorEmail: varchar("author_email", { length: 320 }).notNull(),
    authorName: text("author_name").notNull(),
    // Defaults to the day it was saved; not editable by the current UI, but
    // kept as its own field (rather than reusing createdAt) since a future
    // "log this meeting for an earlier date" flow would only need a form
    // field, not a schema change.
    meetingDate: date("meeting_date").notNull(),
    discussionPoints: text("discussion_points"),
    meetingNotes: text("meeting_notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("coaching_sessions_tact_id_idx").on(table.tactId)]
);

export const coachingActionables = pgTable(
  "coaching_actionables",
  {
    id: serial("id").primaryKey(),
    sessionId: integer("session_id")
      .notNull()
      .references(() => coachingSessions.id, { onDelete: "cascade" }),
    description: text("description").notNull(),
    dueDate: date("due_date"),
    status: coachingActionableStatusEnum("status").notNull().default("Open"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("coaching_actionables_session_id_idx").on(table.sessionId)]
);

export type CoachingSessionRow = typeof coachingSessions.$inferSelect;
export type NewCoachingSessionRow = typeof coachingSessions.$inferInsert;
export type CoachingActionableRow = typeof coachingActionables.$inferSelect;
export type NewCoachingActionableRow = typeof coachingActionables.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────
// qa_feedback_discussed_marks — the Advisor Insight Page's "Mark as
// Discussed" checkbox on a QA Feedback row (TeamTrackerPage.tsx). QA
// Feedback rows themselves come from an external sheet, not a DB table
// this app owns, so there's no row id to attach a boolean column to —
// instead each mark is its own row here, keyed by (tactId, rowIdentity)
// where rowIdentity is the same stable "Chat ID|Checked Date|Domain"
// string the client already builds to identify a feedback row. Presence
// of a row = discussed; un-marking deletes it. Backend-persisted (not
// localStorage) so the mark is visible to every Guide/Mentor/Admin who
// opens that advisor, not just the browser that set it.
// ─────────────────────────────────────────────────────────────────────────
export const qaFeedbackDiscussedMarks = pgTable(
  "qa_feedback_discussed_marks",
  {
    id: serial("id").primaryKey(),
    tactId: text("tact_id").notNull(),
    rowIdentity: text("row_identity").notNull(),
    markedByEmail: varchar("marked_by_email", { length: 320 }).notNull(),
    markedAt: timestamp("marked_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("qa_feedback_discussed_marks_tact_row_idx").on(table.tactId, table.rowIdentity),
    index("qa_feedback_discussed_marks_tact_id_idx").on(table.tactId),
  ]
);

export type QaFeedbackDiscussedMarkRow = typeof qaFeedbackDiscussedMarks.$inferSelect;
export type NewQaFeedbackDiscussedMarkRow = typeof qaFeedbackDiscussedMarks.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────
// guide_mentor_advisor_mappings — the Master Advisors page's Guide/Mentor ->
// Advisor mapping (2026-09; that page split out of Access Control Center's
// Relationships tab, since renamed to the Groups tab — see
// MasterAdvisorsManagement.tsx). Populated by a manual sync
// (src/server/qaDashboard/guideMentorRelationshipsSync.ts) that reads
// master_advisors' Guide/Mentor columns — the exact same sheet/columns
// Team Tracker and the QA Dashboard already read live at request time (see
// qaDataEngine.ts's getAdvisorsForGuide/getAdvisorsForMentor) — and mirrors
// them into this table so the Master Advisors page has something to display
// and edit. Deliberately NOT wired as those pages' read path yet: this is
// phase 1 (build + display), migrating Team Tracker/QA Dashboard to read
// from here instead of the live sheet is a separate follow-up once this
// sync has been run and verified in production.
//
// Keyed by tact_id, NOT by a `users` row — unlike user_relationships above,
// an advisor here does not need a login/directory account to be mapped and
// shown (many won't have one yet), so this intentionally carries its own
// copy of name/email/status rather than joining against `users`. A sync
// run upserts every sheet row by tact_id, overwriting name/email/
// guideName/mentorName/status/skillDomain from the sheet every time — the
// sheet is the actual source of the mapping, this table is a mirror of it.
// Rows can still be hand-edited between syncs (e.g. to correct a typo'd
// Guide name before the sheet itself is fixed) — manuallyEdited/
// lastEditedAt/lastEditedBy record that a row was touched by hand, purely
// informational, since the NEXT sync run overwrites it from the sheet
// regardless (predictable "sync always matches the sheet" behavior, rather
// than silently-sticky edits nobody remembers making).
// ─────────────────────────────────────────────────────────────────────────
export const guideMentorAdvisorMappings = pgTable(
  "guide_mentor_advisor_mappings",
  {
    id: serial("id").primaryKey(),
    tactId: text("tact_id").notNull(),
    name: text("name").notNull(),
    // master_advisors "Email ID" column, lowercased — best-effort, may be
    // null (see qaDataEngine.ts's readEmail). No FK: this advisor may not
    // have a `users` row at all yet.
    email: varchar("email", { length: 320 }),
    // Raw free-text Guide/Mentor column values from the sheet — not an FK
    // to `users`, for the same "no account required" reason as tactId
    // above. Grouping in the UI is by this text, case/whitespace-
    // insensitively, same best-effort name-matching precedent as
    // teamTrackerService.ts's buildPictureLookup.
    guideName: text("guide_name"),
    mentorName: text("mentor_name"),
    // Raw Status/Employment Status cell (e.g. "Currently Employed",
    // "Resigned", ...) — see qaDataEngine.ts's MasterAdvisorsRow.statusRaw.
    status: text("status"),
    // master_advisors column F ("Health"/"Term"/"Both") — see
    // qaDataEngine.ts's skillDomainColIndex.
    skillDomain: text("skill_domain"),
    // Free text — see qaDataEngine.ts's batchColIndex.
    batchNumber: text("batch_number"),
    // "Date of moving out to a different role" / "Last working day" — the
    // sheet's own two possible end-of-advisor-tenure dates (see
    // qaDataEngine.ts's movedOutColIndex/lastWorkingDayColIndex). The
    // Master Advisors page's own "Active Till" column is the earlier of the
    // two, computed at read time rather than stored — see
    // MasterAdvisorsManagement.tsx.
    dateOfMovingOut: date("date_of_moving_out"),
    lastWorkingDay: date("last_working_day"),
    // Whether this row's guideName/mentorName/status/skillDomain still
    // reflect the last sync verbatim, or have been hand-edited since (see
    // the table comment above) — shown in the UI so an editor can tell a
    // synced value from a manual correction at a glance.
    manuallyEdited: boolean("manually_edited").notNull().default(false),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }).notNull().defaultNow(),
    lastSyncedBy: text("last_synced_by").notNull(),
    lastEditedAt: timestamp("last_edited_at", { withTimezone: true }),
    lastEditedBy: text("last_edited_by"),
  },
  (table) => [uniqueIndex("guide_mentor_advisor_mappings_tact_id_unique").on(table.tactId)]
);

export type GuideMentorAdvisorMappingRow = typeof guideMentorAdvisorMappings.$inferSelect;
export type NewGuideMentorAdvisorMappingRow = typeof guideMentorAdvisorMappings.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────
// guide_mentor_relationship_history — per-advisor Mentor/Guide relationship
// timeline (2026-09), a companion to guide_mentor_advisor_mappings above.
// That table only ever holds an advisor's CURRENT Guide/Mentor (overwritten
// in place on every edit or sync) — this table is the append-only record of
// every past assignment, so a "who was this advisor's Mentor/Guide during
// [past period]" question (needed for historical QA Dashboard/Team Tracker
// attribution) has an answer.
//
// One row per assignment PERIOD, not per advisor: an advisor accumulates a
// new row here every time their Guide or Mentor changes. Guide and Mentor
// are two fully independent timelines (the `kind` column) — replacing one
// never touches the other's rows. At most one row per (tactId, kind) has
// isActive = true at a time; changing that relationship terminates the old
// active row (endDate + isActive:false) and inserts a new active row — it
// never overwrites or deletes the old row (see
// guideMentorAdvisorMappingsRepository.ts's update()/upsertFromSync(),
// which both call GuideMentorRelationshipHistoryRepository.changeRelationship
// for this). Sync participates in this same lifecycle instead of blindly
// overwriting the way it used to, so the timeline stays accurate even
// though most real-world changes arrive via a sync run rather than a hand
// edit — source records which path created a given row.
//
// endDate is deliberately a different concept from
// guide_mentor_advisor_mappings.dateOfMovingOut/its derived "Active Till"
// display (the point an ADVISOR themselves stops being active) — this
// endDate marks when a specific RELATIONSHIP ended, which can happen while
// the advisor themselves stays active (they just moved to a different
// Mentor/Guide). The UI labels these two concepts distinctly to avoid
// confusion (see MasterAdvisorsManagement.tsx).
// ─────────────────────────────────────────────────────────────────────────
export const guideMentorRelationshipHistory = pgTable(
  "guide_mentor_relationship_history",
  {
    id: serial("id").primaryKey(),
    tactId: text("tact_id").notNull(),
    // "guide" | "mentor" — plain text rather than a pg enum, matching this
    // schema's existing convention for small closed vocabularies.
    kind: text("kind").notNull(),
    personName: text("person_name").notNull(),
    startDate: date("start_date").notNull(),
    // null while isActive is true ("current, no end yet"); set to the
    // effective date this relationship was terminated/replaced once
    // isActive flips to false.
    endDate: date("end_date"),
    isActive: boolean("is_active").notNull().default(true),
    // "manual" (an edit made on this tab) or "sync" (detected during a
    // "Sync From Advisor Directory" run) — purely informational, shown in
    // the history view so a change is traceable to its source.
    source: text("source").notNull(),
    recordedBy: text("recorded_by").notNull(),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("guide_mentor_relationship_history_tact_id_idx").on(table.tactId),
    index("guide_mentor_relationship_history_tact_kind_idx").on(table.tactId, table.kind),
  ]
);

export type GuideMentorRelationshipHistoryRow = typeof guideMentorRelationshipHistory.$inferSelect;
export type NewGuideMentorRelationshipHistoryRow = typeof guideMentorRelationshipHistory.$inferInsert;
