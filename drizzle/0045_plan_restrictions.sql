-- Plan-Specific Restrictions (2026-08).
--
-- Generic, deterministic, admin-authorable replacement for the 3 hardcoded
-- boolean flags on plan_configs.overrides (requiresInsulinForDiabetes /
-- excludePrediabetes / bypassBenignTumors). Purely additive here — the old
-- flags and the engine.ts code reading them are removed in a later step of
-- this same change, only after this table is confirmed to reproduce
-- identical classification behavior (see scripts/migratePlanRestrictions.ts).

CREATE TYPE "plan_restriction_mode" AS ENUM ('require_keywords', 'exclude_keywords', 'block_category');
--> statement-breakpoint

CREATE TABLE "plan_restrictions" (
    "id" serial PRIMARY KEY NOT NULL,
    "plan_name" text NOT NULL,
    "category_key" text NOT NULL,
    "mode" "plan_restriction_mode" NOT NULL,
    "keywords" jsonb DEFAULT '[]'::jsonb NOT NULL,
    "explanation" text NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_by" text NOT NULL,
    "updated_by" text NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

CREATE INDEX "plan_restrictions_plan_name_idx" ON "plan_restrictions" USING btree ("plan_name");
--> statement-breakpoint

CREATE INDEX "plan_restrictions_is_active_idx" ON "plan_restrictions" USING btree ("is_active");
