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
} from "drizzle-orm/pg-core";

// ─────────────────────────────────────────────────────────────────────────
// search_history — one row per PED lookup performed. Append-only audit
// trail: never updated after insert, only ever inserted or (rarely, by an
// Owner) bulk-cleared. Unbounded growth in production (the old client-side
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
  planName: text("plan_name").notNull(),
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
  // Distinct from effectiveDate (when the policy/rule described actually
  // kicks in — can be future-dated) and from createdAt (an exact server
  // timestamp). This is the admin-editable "posted on" date shown to
  // advisors, defaulting to today in the form but backdatable/postdatable.
  announcementDate: date("announcement_date"),
  // Renamed from the client-side `from` field to avoid the SQL keyword.
  fromTeam: text("from_team"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ─────────────────────────────────────────────────────────────────────────
// flagged_issues — advisor-reported mismatches, triaged by Owners/Admins.
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
export const userTierEnum = pgEnum("user_tier", ["General", "Admin", "Owner"]);
// "Disabled" replaces the old "Pending First Login" value — that used to
// mark a user an Owner pre-added who hadn't completed first-time setup yet;
// it's now a real deactivation flag an Owner can set to lock someone out
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
});

export type UserRow = typeof users.$inferSelect;
export type NewUserRow = typeof users.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────
// external_resources — admin/owner-curated list of external links (SOPs,
// QA Dashboard, etc.) surfaced in the Workspace Controls drawer for every
// user. Read by everyone; writable by Admin/Owner only (enforced in the
// API route, same pattern as announcements).
// ─────────────────────────────────────────────────────────────────────────
export const externalResources = pgTable("external_resources", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  url: text("url").notNull(),
  addedBy: text("added_by").notNull(),
  // Manual display order (lower shows first) — Admin/Owner can reorder the
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
// before it goes live. Admin/Owner write; readable by every authenticated
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
// smoke_test_peds — admin/owner-added custom entries for the Smoke Test
// page's PED list. The page's baseline 50+ common PEDs are a hardcoded
// constant (COMMON_SMOKE_TEST_PEDS in src/constants/commonSmokeTestPeds.ts)
// since they're a fixed regression list, not admin-editable data — this
// table only holds the ADDITIONAL custom terms an Admin/Owner appends on
// top of that baseline. Read by everyone (the Smoke Test page is visible to
// every tier), writes gated to Admin/Owner in the API route layer, same
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
// page_visibility — Owner-only kill switch for hiding a page from everyone
// else while work on it is in progress.
//
// Deliberately dumb: one row per feature id, one boolean. It is NOT a
// permissions system and does not interact with tiers, roles, or the
// featurePermissions registry — those still govern who *may* use a page.
// This only answers "is this page currently shown at all".
//
// Invariant enforced in the client's hasAccess(): a hidden page is still
// fully visible to the Owner. The Owner must never be able to lock
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

export type SearchHistoryRow = typeof searchHistory.$inferSelect;
export type NewSearchHistoryRow = typeof searchHistory.$inferInsert;

export type ChangeLogRow = typeof changeLogs.$inferSelect;
export type NewChangeLogRow = typeof changeLogs.$inferInsert;

export type AnnouncementRow = typeof announcements.$inferSelect;
export type NewAnnouncementRow = typeof announcements.$inferInsert;

export type FlaggedIssueRow = typeof flaggedIssues.$inferSelect;
export type NewFlaggedIssueRow = typeof flaggedIssues.$inferInsert;
