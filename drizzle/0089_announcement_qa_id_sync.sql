-- QA-sheet announcement sync: stable QA ID + sync bookkeeping.
-- qa_id is UNIQUE (NULLs allowed, so hand-typed announcements are unaffected).
ALTER TABLE "announcements" ADD COLUMN "qa_id" text;
--> statement-breakpoint
ALTER TABLE "announcements" ADD COLUMN "source_hash" text;
--> statement-breakpoint
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_qa_id_unique" UNIQUE ("qa_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "announcement_sync_state" (
  "id" integer PRIMARY KEY NOT NULL,
  "last_attempt_at" timestamp with time zone,
  "last_success_at" timestamp with time zone,
  "last_trigger" text,
  "last_summary" text,
  "last_error" text
);
