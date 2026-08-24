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
  boolean,
  jsonb,
  varchar,
  date,
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
export const announcementTypeEnum = pgEnum("announcement_type", [
  "QA Announcement",
  "General Announcement",
]);

// Which advisor audience an announcement is targeted at. Users tagged
// Health-only see only "Health" announcements, Term-only see only "Term",
// and everyone else (no tags, or tagged BOTH Health and Term) sees both.
// Defaults to "Health" so every pre-existing announcement (posted before
// this concept existed) is retroactively tagged Health, per spec.
export const announcementTeamEnum = pgEnum("announcement_team", ["Health", "Term"]);

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
  team: announcementTeamEnum("team").notNull().default("Health"),
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
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

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
  // Schema-only for now (not yet populated/displayed) — createdAt is set on
  // insert; lastLogin stays null until a follow-up wires the OAuth callback
  // to stamp it on each sign-in.
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastLogin: timestamp("last_login", { withTimezone: true }),
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
    categoryKey: text("category_key").notNull(),
    reason: text("reason"),
    addedBy: text("added_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("plan_overrides_plan_ped_idx").on(table.planName, table.pedId)]
);

export type PlanOverrideRow = typeof planOverrides.$inferSelect;
export type NewPlanOverrideRow = typeof planOverrides.$inferInsert;

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
// Deliberately does NOT cover the 3 ids in constants/featurePermissions.ts's
// DEVELOPER_ONLY_FEATURES set ("owner_controls", "connections", "smoke_test")
// — those stay a hardcoded hard-gate checked before this table is ever
// consulted (see hasAccess() in App.tsx), specifically so they can never
// leak to a lower tier via a stale/incomplete permission list. The PUT
// route below also refuses to write an override row for those 3 ids, so
// the two mechanisms can't drift out of sync.
// ─────────────────────────────────────────────────────────────────────────
export const featureAccessLevelEnum = pgEnum("feature_access_level", ["None", "Viewer", "Editor"]);

export const featureAccessOverrides = pgTable("feature_access_overrides", {
  // featurePermissions id (e.g. "smoke_test", "advisory_zone") — same
  // identifier space as page_visibility.featureId above.
  featureId: text("feature_id").primaryKey(),
  generalAccess: featureAccessLevelEnum("general_access"),
  adminAccess: featureAccessLevelEnum("admin_access"),
  updatedBy: text("updated_by").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type FeatureAccessOverrideRow = typeof featureAccessOverrides.$inferSelect;
export type NewFeatureAccessOverrideRow = typeof featureAccessOverrides.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────
// departments — purely organizational metadata (Advisory, QA, Operations,
// etc.), managed from the "Departments" tab on Access Control Center.
// Introduced with the Access Control system (2026-08) alongside
// feature_access_overrides above, but deliberately UNRELATED to it: a
// user's department has zero effect on what they can do. It exists so the
// org structure can be represented and evolve (Developer can add/rename/
// deactivate departments, Admin+Developer can assign a user to one — see
// users.department_id below) without the authorization model assuming that
// structure implies any permission. If department-scoped permissions are
// ever genuinely needed, that's a deliberate, separate, auditable follow-up
// — not something this table does implicitly.
//
// No seed rows: every department a Developer hasn't explicitly created
// simply doesn't exist yet, and every existing user starts with
// department_id = null ("unassigned") — there is no current organizational
// data to migrate into this.
//
// Deactivating (active=false) rather than deleting is the only path exposed
// in the UI, so a department already referenced by users.department_id
// never needs its members silently reassigned — they keep pointing at the
// (now-inactive) department, which the UI can grey out, and reactivating
// restores it cleanly. onDelete: "set null" on the FK below is only a
// defensive backstop for a row removed directly in the database.
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
// table above) — the UI still just calls this "Team".
//
// Same shape and same reasoning as `departments` above: a freely-managed
// catalog (Developer/Platform Admin can add/rename/deactivate), no seed
// membership assumed for existing users, deactivate-not-delete as the only
// removal path. Seeded here with Bliss/Falcon/Central as convenience
// starting rows ONLY — still a real, editable table, not a hardcoded enum,
// specifically so a 4th team can be added later without a migration.
//
// UNLIKE department_id, this is meant to eventually participate in actual
// data-scoping decisions (which pages someone can see, once that
// enforcement is built — not yet, as of this migration: see roles/
// user_relationships below for the rest of that foundation). It carries no
// access effect on its own today; it is inert metadata until a future page
// explicitly consults it, exactly like department_id already is.
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
// org_teams above (freely-managed catalog, deactivate-not-delete).
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
// ─────────────────────────────────────────────────────────────────────────
export const relationshipTypes = pgTable("relationship_types", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  active: boolean("active").notNull().default(true),
  createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  nameUnique: uniqueIndex("relationship_types_name_unique").on(table.name),
}));

export type RelationshipTypeRow = typeof relationshipTypes.$inferSelect;
export type NewRelationshipTypeRow = typeof relationshipTypes.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────
// user_relationships — explicit person-to-person mappings (e.g. "this
// Mentor's mentees are exactly these advisors"), Access Control system
// Phase 2 (2026-08). This is the concrete answer to "mapped to that
// particular member" from the original spec: a generic (owner, subject,
// relationship type) triple rather than a single hardcoded "reports to"
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
  relationshipTypeId: integer("relationship_type_id").notNull().references(() => relationshipTypes.id, { onDelete: "restrict" }),
  createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  tripleUnique: uniqueIndex("user_relationships_triple_unique").on(table.ownerEmail, table.subjectEmail, table.relationshipTypeId),
}));

export type UserRelationshipRow = typeof userRelationships.$inferSelect;
export type NewUserRelationshipRow = typeof userRelationships.$inferInsert;

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

// qa_evaluation_history — one-time archival import of QA evaluation rows
// (Checked Date, Mistake Date, TACT ID, Advisor, Chat ID, Domain, Score)
// covering June 2025-May 2026, a period the live master_feedback_dump
// Google Sheet (src/server/qaDashboard/qaDataEngine.ts) no longer holds —
// confirmed before building this table, so there's no overlap/double-count
// risk with the live Sheet. Imported via scripts/importQaEvaluationHistory.ts.
//
// checkedDate/mistakeDate are stored as "yyyy-MM-dd" text rather than a
// native `date` column, matching the rest of the QA Dashboard's date-string
// convention (see DateFilters in qaDataEngine.ts) — this lets them plug
// directly into sheetsClient.ts's dateStringToSerial() with no
// driver-specific date-object handling to reconcile.
//
// qaDataEngine.ts's getMergedFeedbackDumpRows() reads this table and
// stitches its rows in alongside the live Sheet's rows (converted to the
// same serial-number cell-array shape) before any of the existing
// aggregation/reporting functions run, so a date range that falls in this
// window returns real data instead of nothing. This table only carries the
// six identification columns above — no dispute/escalation/feedback-text
// columns — so archive rows never appear in dispute/escalation review
// listings, only in score aggregates.
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
// queryAssist.ts's SYSTEM_INSTRUCTION SOURCE PRECEDENCE list.
// ─────────────────────────────────────────────────────────────────────────
export const kbCategoryTypeEnum = pgEnum("kb_category_type", ["insurer", "general"]);

// A category is either one insurer's resource bucket (HDFC Ergo, Care
// Health, ...) or the catch-all "general" bucket (IRDAI, cross-insurer
// FAQs, etc.). Deliberately just a plain table (not a hardcoded enum of
// insurer names) so new categories can be added from the admin UI at any
// time without a migration — the one open requirement from the original
// ask ("possibility of adding new categories in future").
export const kbCategories = pgTable("kb_categories", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  type: kbCategoryTypeEnum("type").notNull().default("insurer"),
  sortOrder: integer("sort_order").notNull().default(0),
  // Admin-curated list of this insurer's plan names — the suggestion source
  // for tagging a resource (kb_resources.planTags, 0029) so an admin picks
  // from real options instead of free-typing every time. Only meaningful
  // for type="insurer" categories. See 0030_kb_category_plan_names.sql.
  planNames: text("plan_names").array().notNull().default([]),
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
// queryAssist.ts apply the authority precedence Policy Wording > Prospectus
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
    // Free text, matched case-insensitively against kb_categories.name at
    // query time (see queryAssist.ts) — not a foreign key, since one
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
// query_assist_logs — TEMPORARY server-side record of Product Assist
// conversations, added 2026-08 specifically to build a real representative
// test set for the optimization-review testing strategy (Product Assist
// Quality-Preserving Optimization Review, Section 6) — Query Assist's
// normal design deliberately keeps NO server-side record of conversations
// (see queryAssist.ts / QueryAssistPage.tsx's doc comments: history lives
// only in the advisor's own browser). This table is an explicit, knowingly
// time-boxed exception to that, gated by the QUERY_ASSIST_LOG_ENABLED env
// flag so it can be turned off once enough real data has been collected —
// it is not meant to become a permanent record. Rows are periodically
// pushed to a Google Sheet and deleted from here (see
// src/server/knowledgeBase/queryAssistLogExport.ts), so this table isn't
// meant to grow indefinitely either.
// ─────────────────────────────────────────────────────────────────────────
export const queryAssistLogs = pgTable(
  "query_assist_logs",
  {
    id: serial("id").primaryKey(),
    userEmail: text("user_email").notNull(),
    // Denormalized alongside categoryId (not just a FK) so a row still
    // reads meaningfully in the exported Sheet even if the category is
    // later renamed or deleted from kb_categories.
    categoryId: integer("category_id"),
    categoryName: text("category_name"),
    planTags: text("plan_tags").array().notNull().default([]),
    question: text("question").notNull(),
    // The verified "answer" field (queryAssist.ts's structured output) —
    // never the customer-facing "share" paraphrase alone, since "answer" is
    // what test-set authors need to judge correctness/completeness against.
    answer: text("answer").notNull(),
    share: text("share"),
    // QueryAssistSource[] as sent to the advisor — title/categoryName/
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
    latencyMs: integer("latency_ms"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("query_assist_logs_created_at_idx").on(table.createdAt)]
);

export type QueryAssistLogRow = typeof queryAssistLogs.$inferSelect;
export type NewQueryAssistLogRow = typeof queryAssistLogs.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────
// query_assist_log_export_connection — same single-row shape/purpose as
// qaDashboardGoogleConnection above (see that table's comment), but this
// grant requests the WRITE `spreadsheets` scope rather than
// `spreadsheets.readonly`, since it's used to append query_assist_logs rows
// to an export Sheet (see queryAssistLogSheetsClient.ts) rather than to
// read one. Kept as its own table/connection — deliberately never reuses
// the QA Dashboard's or Playbook's stored grant — so this is the only place
// in the app holding a credential capable of writing to a Google Sheet.
// Encrypted at rest; see queryAssistLogTokenCrypto.ts.
// ─────────────────────────────────────────────────────────────────────────
export const queryAssistLogExportConnection = pgTable("query_assist_log_export_connection", {
  id: text("id").primaryKey().default("default"),
  connectedEmail: text("connected_email").notNull(),
  encryptedRefreshToken: text("encrypted_refresh_token").notNull(),
  connectedBy: text("connected_by").notNull(),
  connectedAt: timestamp("connected_at", { withTimezone: true }).notNull().defaultNow(),
});

export type QueryAssistLogExportConnectionRow = typeof queryAssistLogExportConnection.$inferSelect;
export type NewQueryAssistLogExportConnectionRow = typeof queryAssistLogExportConnection.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────
// special_instructions — Product Assist's "Special Instructions" layer
// (Knowledge Base, 2026-08). A small, admin-curated set of controlled
// instructions Product Assist checks BEFORE consulting the normal
// knowledge-retrieval chain (Product Playbook -> Policy Wording -> other
// resources; see queryAssist.ts's SOURCE PRECEDENCE). Purely additive: when
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
// queryAssist.ts's SOURCE PRECEDENCE #8/#9 (spec) for the resulting 4-level
// specificity ladder this produces:
//   insurerCategoryId + productPlanName both set -> Product+Insurer+Topic (most specific)
//   productPlanName only                          -> Product+Topic
//   insurerCategoryId only                         -> Insurer+Topic
//   neither set                                    -> Topic only (globally applicable)
// Topic relevance itself (is this question actually ABOUT this topic, not
// just same insurer/product) is established separately at query time via
// embedding similarity against `topicEmbedding` — see
// src/server/knowledgeBase/specialInstructions.ts. Deliberately reuses the
// exact query embedding queryAssist.ts already computes for kbChunks
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
// passage similarity — see queryAssist.ts's SOURCE PRECEDENCE #1 ("DITTO
// CONSTITUTION"), where this is an equal-authority peer to
// kb_playbook_plan_facts, never a subordinate DOCUMENT EXCERPT.
//
// One kb_resources row (type="sheet", title="Ditto FAQ", in the "general"/
// "Ditto Constitution" category) owns every faq_records row the same way
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
