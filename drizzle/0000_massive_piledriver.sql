CREATE TYPE "public"."announcement_type" AS ENUM('QA Announcement', 'General Announcement');--> statement-breakpoint
CREATE TYPE "public"."flagged_issue_status" AS ENUM('Pending', 'Urgent', 'Resolved', 'Ignored');--> statement-breakpoint
CREATE TABLE "announcements" (
	"id" serial PRIMARY KEY NOT NULL,
	"announcement" text NOT NULL,
	"effective_date" date,
	"category" text NOT NULL,
	"added_by" text NOT NULL,
	"rating" integer,
	"type" "announcement_type" DEFAULT 'QA Announcement',
	"valid_till_date" date,
	"title" text,
	"from_team" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "change_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"timestamp" timestamp with time zone DEFAULT now() NOT NULL,
	"user_name" text NOT NULL,
	"role" varchar(32) NOT NULL,
	"action_type" text NOT NULL,
	"plan_name" text NOT NULL,
	"description" text NOT NULL,
	"snapshot" jsonb
);
--> statement-breakpoint
CREATE TABLE "flagged_issues" (
	"id" serial PRIMARY KEY NOT NULL,
	"timestamp" timestamp with time zone DEFAULT now() NOT NULL,
	"user_email" varchar(320) NOT NULL,
	"user_name" text NOT NULL,
	"user_tact_id" varchar(64) NOT NULL,
	"plan_name" text NOT NULL,
	"ped_input" text NOT NULL,
	"matched_question" text NOT NULL,
	"match_type" varchar(32) NOT NULL,
	"source" text NOT NULL,
	"explanation" text NOT NULL,
	"issue_notes" text NOT NULL,
	"status" "flagged_issue_status" DEFAULT 'Pending' NOT NULL,
	"owner_notes" text,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "search_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"timestamp" timestamp with time zone DEFAULT now() NOT NULL,
	"user_email" varchar(320) NOT NULL,
	"plan_name" text NOT NULL,
	"ped_input" text NOT NULL,
	"matched_question" text NOT NULL,
	"match_type" varchar(32) NOT NULL,
	"source" text NOT NULL,
	"explanation" text NOT NULL
);
