-- PED repository DB migration — Phase 1 (schema only).
-- See PED_REPOSITORY_DB_MIGRATION_DESIGN.md for the full design.
--
-- Purely additive: no existing table is read, dropped, or has a column
-- removed. ai_memory gets 3 new nullable columns (confidence,
-- suggested_category_key, ped_id) so existing rows remain valid untouched.
--
-- Written by hand rather than via `drizzle-kit generate`, matching this
-- project's own established convention for the last several migrations
-- (0012-0016) — this repo's drizzle/meta/ snapshot history has a
-- pre-existing gap (no 0012-0016 snapshots), which made `drizzle-kit
-- generate` hang/misbehave when tested against it. Noted here rather than
-- silently worked around, since it's worth fixing at some point
-- independent of this migration.

CREATE TYPE "public"."ped_status" AS ENUM('draft', 'approved', 'deprecated');--> statement-breakpoint
CREATE TYPE "public"."mapping_history_entity_type" AS ENUM('ped', 'alias', 'category', 'plan_override', 'plan_config');--> statement-breakpoint
CREATE TYPE "public"."collision_type" AS ENUM('alias', 'category', 'plan', 'ai', 'regression');--> statement-breakpoint
CREATE TYPE "public"."collision_severity" AS ENUM('guardrail', 'advisory');--> statement-breakpoint

-- categories — category definitions, replacing the hardcoded
-- CATEGORY_LABELS object in types.ts. category_key is the primary key (not
-- a new integer id) since existing app code already speaks in these exact
-- string keys.
CREATE TABLE IF NOT EXISTS "categories" (
  "category_key" text PRIMARY KEY NOT NULL,
  "label" text NOT NULL,
  "description" text,
  "sort_order" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

-- ped_repository — master disease registry. Stable internal id/ped_code
-- identity independent of display name, so renames/spelling corrections
-- never break ped_aliases, plan_overrides, mapping_history, or
-- collision_repository rows that reference this PED.
CREATE TABLE IF NOT EXISTS "ped_repository" (
  "id" serial PRIMARY KEY NOT NULL,
  "ped_code" text NOT NULL,
  "canonical_name" text NOT NULL,
  "category_key" text,
  "status" "ped_status" DEFAULT 'draft' NOT NULL,
  "merged_into_id" integer,
  "notes" text,
  "added_by" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "ped_repository_ped_code_unique" UNIQUE("ped_code")
);
--> statement-breakpoint

-- ped_aliases — every searchable text variant for a ped_repository row
-- (including one is_primary row mirroring canonical_name). normalized_alias
-- is the actual runtime dictionary lookup key; its uniqueness is what
-- enforces "Alias Collision" at the database level.
CREATE TABLE IF NOT EXISTS "ped_aliases" (
  "id" serial PRIMARY KEY NOT NULL,
  "ped_id" integer NOT NULL,
  "alias_text" text NOT NULL,
  "normalized_alias" text NOT NULL,
  "is_primary" boolean DEFAULT false NOT NULL,
  "added_by" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "ped_aliases_normalized_alias_unique" UNIQUE("normalized_alias")
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "ped_aliases_ped_id_idx" ON "ped_aliases" ("ped_id");
--> statement-breakpoint

-- plan_overrides — per-plan category overrides for a specific PED,
-- replacing the 4 hardcoded stage-0.4 blocks in engine.ts.
CREATE TABLE IF NOT EXISTS "plan_overrides" (
  "id" serial PRIMARY KEY NOT NULL,
  "plan_name" text NOT NULL,
  "ped_id" integer NOT NULL,
  "category_key" text NOT NULL,
  "reason" text,
  "added_by" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "plan_overrides_plan_ped_idx"
  ON "plan_overrides" ("plan_name", "ped_id");
--> statement-breakpoint

-- mapping_history — structured audit trail for PED/category/mapping
-- changes specifically (distinct from change_logs, which stays for
-- plan/announcement/user admin actions).
CREATE TABLE IF NOT EXISTS "mapping_history" (
  "id" serial PRIMARY KEY NOT NULL,
  "ped_id" integer,
  "entity_type" "mapping_history_entity_type" NOT NULL,
  "action" text NOT NULL,
  "previous_value" jsonb,
  "new_value" jsonb,
  "reason" text,
  "performed_by" text NOT NULL,
  "performed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "mapping_history_ped_id_idx" ON "mapping_history" ("ped_id");
--> statement-breakpoint

-- collision_repository — institutional memory of alias/category/plan/ai/
-- regression collisions. Advisory-only for now (nothing in engine.ts
-- consults this table yet) — severity/active already support a later
-- enforcement layer without a further schema change.
CREATE TABLE IF NOT EXISTS "collision_repository" (
  "id" serial PRIMARY KEY NOT NULL,
  "collision_type" "collision_type" NOT NULL,
  "ped_id" integer,
  "rejected_category_key" text,
  "approved_category_key" text,
  "related_plan_name" text,
  "related_ai_memory_id" integer,
  "description" text NOT NULL,
  "severity" "collision_severity" DEFAULT 'advisory' NOT NULL,
  "active" boolean DEFAULT true NOT NULL,
  "added_by" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "collision_repository_ped_id_idx" ON "collision_repository" ("ped_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "collision_repository_type_idx" ON "collision_repository" ("collision_type");
--> statement-breakpoint

-- Extend ai_memory (the "AI Mapping Review" backing store) per the
-- approved design decision to extend in place rather than migrate to a new
-- table. All 3 columns nullable, so every existing row remains valid.
ALTER TABLE "ai_memory" ADD COLUMN IF NOT EXISTS "confidence" text;
--> statement-breakpoint
ALTER TABLE "ai_memory" ADD COLUMN IF NOT EXISTS "suggested_category_key" text;
--> statement-breakpoint
ALTER TABLE "ai_memory" ADD COLUMN IF NOT EXISTS "ped_id" integer;
