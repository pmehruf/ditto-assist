-- Acronym Dictionary (Knowledge Base, 2026-08).
--
-- Purely additive: a new standalone table, no existing column/table is
-- altered. See schema.ts's doc comment on `kbAcronyms` for the full design
-- (plain word-boundary string matching, not embedding-based like Special
-- Instructions/Ditto FAQ, since an acronym is a short exact token).

CREATE TABLE "kb_acronyms" (
    "id" serial PRIMARY KEY NOT NULL,
    "acronym" text NOT NULL,
    "expansion" text NOT NULL,
    "notes" text,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_by" text NOT NULL,
    "updated_by" text NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

CREATE INDEX "kb_acronyms_is_active_idx" ON "kb_acronyms" USING btree ("is_active");
