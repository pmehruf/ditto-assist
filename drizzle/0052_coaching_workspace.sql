-- Team Tracker's Coaching Workspace — a saved coaching_sessions row is
-- created only when a Guide/Mentor/Admin explicitly clicks Save on a draft
-- note for one advisor (unsaved drafts live in the browser's own
-- localStorage and never reach this table). coaching_actionables are the
-- meeting's action items, each tied to its session. See schema.ts's table
-- comment for the full reasoning, including why author identity is plain
-- text rather than a users.email foreign key.

CREATE TYPE "public"."coaching_actionable_status" AS ENUM('Open', 'In Progress', 'Completed');--> statement-breakpoint

CREATE TABLE "coaching_sessions" (
    "id" serial PRIMARY KEY NOT NULL,
    "tact_id" text NOT NULL,
    "advisor_name" text NOT NULL,
    "author_email" varchar(320) NOT NULL,
    "author_name" text NOT NULL,
    "meeting_date" date NOT NULL,
    "discussion_points" text,
    "meeting_notes" text,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

CREATE TABLE "coaching_actionables" (
    "id" serial PRIMARY KEY NOT NULL,
    "session_id" integer NOT NULL REFERENCES "public"."coaching_sessions"("id") ON DELETE CASCADE,
    "description" text NOT NULL,
    "due_date" date,
    "status" "public"."coaching_actionable_status" DEFAULT 'Open' NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

CREATE INDEX "coaching_sessions_tact_id_idx" ON "coaching_sessions" USING btree ("tact_id");--> statement-breakpoint
CREATE INDEX "coaching_actionables_session_id_idx" ON "coaching_actionables" USING btree ("session_id");
