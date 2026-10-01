-- Mapping-control Phase 3A — additive only: audit + undo for admin mapping actions.
CREATE TABLE "mapping_change_sets" (
	"id" serial PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"summary" text NOT NULL,
	"status" text DEFAULT 'applied' NOT NULL,
	"related_ai_memory_id" integer,
	"ops" jsonb NOT NULL,
	"verification" jsonb,
	"performed_by" text NOT NULL,
	"performed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"undone_by" text,
	"undone_at" timestamp with time zone,
	"undo_note" text
);
--> statement-breakpoint
CREATE INDEX "mapping_change_sets_ai_memory_idx" ON "mapping_change_sets" USING btree ("related_ai_memory_id");
