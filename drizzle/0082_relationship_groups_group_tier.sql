CREATE TYPE "public"."group_tier" AS ENUM('General', 'Admin', 'Platform Admin');--> statement-breakpoint
ALTER TABLE "relationship_groups" ADD COLUMN "group_tier" "group_tier" DEFAULT 'General' NOT NULL;
