-- Ditto FAQ integration into the Knowledge Hub (2026-08).
--
-- Purely additive: two new standalone tables (own OAuth connection table,
-- own records table — mirroring kb_playbook_connection/kb_playbook_plan_facts'
-- shape exactly), plus one data-only rename of the existing "General /
-- Others" kb_categories row to "Ditto Constitution" (conditional on its
-- current name/type so this can never touch any other row). No existing
-- table/column is altered; the Product Playbook resource itself is
-- untouched. See schema.ts's doc comments on kbFaqConnection/faqRecords for
-- the full design.

CREATE TYPE "faq_category" AS ENUM ('health_product', 'operations_health');
--> statement-breakpoint

CREATE TABLE "kb_faq_connection" (
    "id" text PRIMARY KEY DEFAULT 'default' NOT NULL,
    "connected_email" text NOT NULL,
    "encrypted_refresh_token" text NOT NULL,
    "connected_by" text NOT NULL,
    "connected_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

CREATE TABLE "faq_records" (
    "id" serial PRIMARY KEY NOT NULL,
    "resource_id" integer NOT NULL,
    "category" "faq_category" NOT NULL,
    "question" text NOT NULL,
    "answer" text DEFAULT '' NOT NULL,
    "is_answerable" boolean DEFAULT true NOT NULL,
    "has_conflict" boolean DEFAULT false NOT NULL,
    "conflict_group_key" text,
    "question_embedding" vector(768),
    "source_row_number" integer NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

ALTER TABLE "faq_records" ADD CONSTRAINT "faq_records_resource_id_kb_resources_id_fk"
    FOREIGN KEY ("resource_id") REFERENCES "public"."kb_resources"("id")
    ON DELETE CASCADE ON UPDATE NO ACTION;
--> statement-breakpoint

CREATE INDEX "faq_records_resource_id_idx" ON "faq_records" USING btree ("resource_id");
--> statement-breakpoint

CREATE INDEX "faq_records_category_idx" ON "faq_records" USING btree ("category");
--> statement-breakpoint

CREATE INDEX "faq_records_is_active_idx" ON "faq_records" USING btree ("is_active");
--> statement-breakpoint

-- Data-only rename, scoped as tightly as possible: only touches a "general"
-- category literally named "General / Others" today, so this is a no-op
-- (zero rows affected) rather than an error if that row was already renamed
-- or never existed under that exact name.
UPDATE "kb_categories" SET "name" = 'Ditto Constitution' WHERE "type" = 'general' AND "name" = 'General / Others';
