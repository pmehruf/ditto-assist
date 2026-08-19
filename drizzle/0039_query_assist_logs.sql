-- Query Assist temporary logging (2026-08): a knowingly time-boxed
-- exception to Product Assist's normal "no server-side record" design,
-- added specifically to build a real test set for the Product Assist
-- Quality-Preserving Optimization Review's testing strategy. See
-- schema.ts's comments on query_assist_logs / query_assist_log_export_connection
-- for the full reasoning. All additive.

-- 1. query_assist_logs — full Q&A + scope + sources + metadata per
--    advisor question, gated at write time by QUERY_ASSIST_LOG_ENABLED.
CREATE TABLE "query_assist_logs" (
    "id" serial PRIMARY KEY NOT NULL,
    "user_email" text NOT NULL,
    "category_id" integer,
    "category_name" text,
    "plan_tags" text[] DEFAULT '{}' NOT NULL,
    "question" text NOT NULL,
    "answer" text NOT NULL,
    "share" text,
    "sources" jsonb DEFAULT '[]' NOT NULL,
    "had_no_matches" boolean DEFAULT false NOT NULL,
    "retrieved_chunk_count" integer DEFAULT 0 NOT NULL,
    "playbook_fact_count" integer DEFAULT 0 NOT NULL,
    "history_turn_count" integer DEFAULT 0 NOT NULL,
    "input_tokens" integer,
    "output_tokens" integer,
    "latency_ms" integer,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "query_assist_logs_created_at_idx" ON "query_assist_logs" USING btree ("created_at");
--> statement-breakpoint

-- 2. query_assist_log_export_connection — the stored WRITE-scope Google
--    Sheets OAuth grant used to export/clear the table above on a
--    schedule. Same single-row shape as qa_dashboard_google_connection /
--    kb_playbook_connection, kept as its own table/credential.
CREATE TABLE "query_assist_log_export_connection" (
    "id" text PRIMARY KEY DEFAULT 'default' NOT NULL,
    "connected_email" text NOT NULL,
    "encrypted_refresh_token" text NOT NULL,
    "connected_by" text NOT NULL,
    "connected_at" timestamp with time zone DEFAULT now() NOT NULL
);
