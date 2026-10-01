ALTER TABLE "plan_overrides" ALTER COLUMN "category_key" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "plan_overrides" ADD COLUMN "target_question" text;
