-- ai_memory — Level 2 of the three-level lookup memory.
--
--   L1  Deterministic Engine (engine.ts + TOP_PED_DICTIONARY + plan config)
--   L2  AI Memory (this table)
--   L3  Gemini
--
-- Purely a cache + human-governance layer. /api/match consults this table
-- only AFTER the deterministic engine has failed to classify a PED, and a
-- hit means Gemini is never called again for that
-- (normalized_condition, plan_name, engine_version) triple.
--
-- This table is NOT the deterministic engine and never feeds it. Approving a
-- row here does not modify ped_directory, TOP_PED_DICTIONARY, the regex
-- sections, category maps, or any plan mapping — promotion into the
-- deterministic engine stays a separate manual activity. Purely additive:
-- no existing table is read, written, or altered by this migration.

CREATE TABLE IF NOT EXISTS "ai_memory" (
  "id" serial PRIMARY KEY NOT NULL,
  "condition" text NOT NULL,
  "normalized_condition" text NOT NULL,
  "plan_name" text NOT NULL,
  "engine_version" text NOT NULL,
  "prompt_version" text NOT NULL,
  "gemini_model" text NOT NULL,
  "ai_response" jsonb NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "approved_at" timestamp with time zone,
  "approved_by" text,
  "last_accessed_at" timestamp with time zone,
  "access_count" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint

-- One cached answer per condition + plan + engine version. Including the
-- engine version means a deterministic-engine change naturally invalidates
-- prior AI answers (new key = cache miss) instead of serving a stale mapping.
CREATE UNIQUE INDEX IF NOT EXISTS "ai_memory_condition_plan_version_idx"
  ON "ai_memory" ("normalized_condition", "plan_name", "engine_version");
--> statement-breakpoint

-- Queue screens filter by status and sort by recency/usage.
CREATE INDEX IF NOT EXISTS "ai_memory_status_idx" ON "ai_memory" ("status");
