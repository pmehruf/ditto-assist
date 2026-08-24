-- Knowledge Base: genuine plan disable/enable (without destroying tagged
-- resources) + insurer-level (non-plan-specific) resources.
--
-- Both columns are additive with safe defaults — zero effect on existing
-- rows/behavior until the admin UI starts setting them.

ALTER TABLE "kb_categories"
  ADD COLUMN IF NOT EXISTS "disabled_plan_names" text[] NOT NULL DEFAULT '{}';
--> statement-breakpoint

ALTER TABLE "kb_resources"
  ADD COLUMN IF NOT EXISTS "is_insurer_level" boolean NOT NULL DEFAULT false;
