CREATE EXTENSION IF NOT EXISTS vector;
--> statement-breakpoint
CREATE TYPE "public"."kb_category_type" AS ENUM('insurer', 'general');
--> statement-breakpoint
CREATE TYPE "public"."kb_resource_type" AS ENUM('pdf', 'web', 'sheet');
--> statement-breakpoint
CREATE TYPE "public"."kb_resource_status" AS ENUM('processing', 'active', 'error', 'archived');
--> statement-breakpoint
CREATE TYPE "public"."kb_chat_role" AS ENUM('user', 'assistant');
--> statement-breakpoint
CREATE TABLE "kb_categories" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"type" "kb_category_type" DEFAULT 'insurer' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kb_resources" (
	"id" serial PRIMARY KEY NOT NULL,
	"category_id" integer NOT NULL,
	"type" "kb_resource_type" NOT NULL,
	"title" text NOT NULL,
	"source_url" text,
	"status" "kb_resource_status" DEFAULT 'processing' NOT NULL,
	"content_hash" text,
	"last_fetched_at" timestamp with time zone,
	"chunk_count" integer DEFAULT 0 NOT NULL,
	"error_message" text,
	"added_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kb_chunks" (
	"id" serial PRIMARY KEY NOT NULL,
	"resource_id" integer NOT NULL,
	"chunk_index" integer NOT NULL,
	"content" text NOT NULL,
	"embedding" vector(768) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kb_announcements" (
	"id" serial PRIMARY KEY NOT NULL,
	"category_id" integer,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"effective_date" date NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kb_chat_sessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_email" text NOT NULL,
	"title" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kb_chat_messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"session_id" integer NOT NULL,
	"role" "kb_chat_role" NOT NULL,
	"content" text NOT NULL,
	"sources" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "kb_resources" ADD CONSTRAINT "kb_resources_category_id_kb_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."kb_categories"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "kb_chunks" ADD CONSTRAINT "kb_chunks_resource_id_kb_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."kb_resources"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "kb_announcements" ADD CONSTRAINT "kb_announcements_category_id_kb_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."kb_categories"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "kb_chat_messages" ADD CONSTRAINT "kb_chat_messages_session_id_kb_chat_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."kb_chat_sessions"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "kb_resources_category_id_idx" ON "kb_resources" USING btree ("category_id");
--> statement-breakpoint
CREATE INDEX "kb_chunks_resource_id_idx" ON "kb_chunks" USING btree ("resource_id");
--> statement-breakpoint
CREATE INDEX "kb_announcements_category_id_idx" ON "kb_announcements" USING btree ("category_id");
--> statement-breakpoint
CREATE INDEX "kb_chat_sessions_user_email_idx" ON "kb_chat_sessions" USING btree ("user_email");
--> statement-breakpoint
CREATE INDEX "kb_chat_messages_session_id_idx" ON "kb_chat_messages" USING btree ("session_id");
--> statement-breakpoint
CREATE INDEX "kb_chunks_embedding_idx" ON "kb_chunks" USING hnsw ("embedding" vector_cosine_ops);
