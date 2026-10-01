ALTER TABLE "group_tool_access" ADD COLUMN "level" "feature_access_level" DEFAULT 'Editor' NOT NULL;--> statement-breakpoint
ALTER TABLE "relationship_groups" DROP COLUMN "group_tier";--> statement-breakpoint
DROP TYPE "public"."group_tier";
