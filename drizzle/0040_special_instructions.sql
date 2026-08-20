-- Product Assist "Special Instructions" layer (Knowledge Base, 2026-08).
--
-- Purely additive: a new standalone table, no existing column/table is
-- altered. See schema.ts's doc comment on `specialInstructions` for the
-- full design (three instruction types, two independent optional scope
-- fields producing a 4-level specificity ladder, topic-embedding column
-- for query-time relevance matching).

CREATE TYPE "special_instruction_type" AS ENUM ('override_rule', 'additional_information', 'general_instruction');
--> statement-breakpoint

CREATE TABLE "special_instructions" (
    "id" serial PRIMARY KEY NOT NULL,
    "topic" text NOT NULL,
    "instruction_text" text NOT NULL,
    "instruction_type" "special_instruction_type" NOT NULL,
    "insurer_category_id" integer,
    "product_plan_name" text,
    "topic_embedding" vector(768) NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_by" text NOT NULL,
    "updated_by" text NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

ALTER TABLE "special_instructions" ADD CONSTRAINT "special_instructions_insurer_category_id_kb_categories_id_fk"
    FOREIGN KEY ("insurer_category_id") REFERENCES "public"."kb_categories"("id")
    ON DELETE SET NULL ON UPDATE NO ACTION;
--> statement-breakpoint

CREATE INDEX "special_instructions_insurer_category_id_idx" ON "special_instructions" USING btree ("insurer_category_id");
--> statement-breakpoint

CREATE INDEX "special_instructions_is_active_idx" ON "special_instructions" USING btree ("is_active");
