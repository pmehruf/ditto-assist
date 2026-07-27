CREATE TYPE "public"."user_status" AS ENUM('Active', 'Disabled');--> statement-breakpoint
CREATE TYPE "public"."user_tier" AS ENUM('General', 'Admin', 'Owner');--> statement-breakpoint
CREATE TABLE "users" (
	"email" varchar(320) PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"tact_id" varchar(64) NOT NULL,
	"tier" "user_tier" DEFAULT 'General' NOT NULL,
	"status" "user_status" DEFAULT 'Active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_login" timestamp with time zone
);
