-- Product Assist daily AI-awareness warning — server-persisted state per
-- user (not just browser localStorage), so it survives a cleared cache or a
-- new device.
--
-- product_assist_acks — one row per user. acked_at is set exactly once, the
-- first time an advisor completes the full first-ever warning's 10-second
-- countdown + checkbox + Proceed flow, and is never cleared afterward.
-- last_reminder_date is the advisor's own LOCAL calendar date (YYYY-MM-DD)
-- the lightweight daily reminder was last shown (or was subsumed by
-- completing the first-ever flow that same day). No row yet = this user has
-- never seen either.
--
-- Purely additive: no existing table is read, written, or altered.

CREATE TABLE IF NOT EXISTS "product_assist_acks" (
  "user_email" varchar(320) PRIMARY KEY NOT NULL,
  "acked_at" timestamp with time zone,
  "last_reminder_date" text,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
