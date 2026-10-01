-- Mapping-control Phase 2 (equality migration) — additive only.
-- No existing column, row or table is changed or dropped; no behaviour changes
-- until MAPPING_ENGINE=db is set. See MASTER_CONSTITUTION.md and
-- src/mapping/ for the data model this supports.
CREATE TABLE "routing_rules" (
	"id" serial PRIMARY KEY NOT NULL,
	"rule_key" text NOT NULL,
	"kind" text NOT NULL,
	"stage" text NOT NULL,
	"primitive" text,
	"position" integer NOT NULL,
	"plan_scope" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"definition" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "routing_rules_rule_key_unique" UNIQUE("rule_key")
);
--> statement-breakpoint
CREATE INDEX "routing_rules_position_idx" ON "routing_rules" USING btree ("position");
--> statement-breakpoint
CREATE TABLE "mapping_state" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"version" bigint DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
INSERT INTO "mapping_state" ("id", "version") VALUES (1, 1) ON CONFLICT ("id") DO NOTHING;
--> statement-breakpoint
ALTER TABLE "ped_aliases" ADD COLUMN "routing_enabled" boolean DEFAULT true NOT NULL;
--> statement-breakpoint
ALTER TABLE "ped_aliases" ADD COLUMN "category_key_override" text;
--> statement-breakpoint
ALTER TABLE "ped_aliases" ADD COLUMN "fallback_category_key" text;
