-- Mapping-control Phase 3B-i — additive only: change-control + impact fields on admin mapping change sets.
ALTER TABLE "mapping_change_sets" ADD COLUMN "reason" text;--> statement-breakpoint
ALTER TABLE "mapping_change_sets" ADD COLUMN "change_category" text;--> statement-breakpoint
ALTER TABLE "mapping_change_sets" ADD COLUMN "business_decision" text;--> statement-breakpoint
ALTER TABLE "mapping_change_sets" ADD COLUMN "impact_tier" text;--> statement-breakpoint
ALTER TABLE "mapping_change_sets" ADD COLUMN "impact" jsonb;
