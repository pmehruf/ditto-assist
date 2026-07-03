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
  jsonb,
  varchar,
  date,
  pgEnum,
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

export type SearchHistoryRow = typeof searchHistory.$inferSelect;
export type NewSearchHistoryRow = typeof searchHistory.$inferInsert;

export type ChangeLogRow = typeof changeLogs.$inferSelect;
export type NewChangeLogRow = typeof changeLogs.$inferInsert;

export type AnnouncementRow = typeof announcements.$inferSelect;
export type NewAnnouncementRow = typeof announcements.$inferInsert;

export type FlaggedIssueRow = typeof flaggedIssues.$inferSelect;
export type NewFlaggedIssueRow = typeof flaggedIssues.$inferInsert;
