CREATE TYPE "public"."ai_usage_source" AS ENUM('product_assist', 'declaration_assist_match', 'specific_illness_ai_check', 'plan_management_ai_workflow');--> statement-breakpoint
CREATE TYPE "public"."announcement_audience" AS ENUM('Health', 'Term', 'Both');--> statement-breakpoint
CREATE TYPE "public"."announcement_team" AS ENUM('Health', 'Term');--> statement-breakpoint
CREATE TYPE "public"."announcement_type" AS ENUM('QA Announcement', 'General Announcement', 'Product Announcement', 'Insurance Operations', 'Insight');--> statement-breakpoint
CREATE TYPE "public"."coaching_actionable_status" AS ENUM('Open', 'In Progress', 'Completed', 'Failed');--> statement-breakpoint
CREATE TYPE "public"."collision_severity" AS ENUM('guardrail', 'advisory');--> statement-breakpoint
CREATE TYPE "public"."collision_type" AS ENUM('alias', 'category', 'plan', 'ai', 'regression');--> statement-breakpoint
CREATE TYPE "public"."faq_category" AS ENUM('health_product', 'operations_health');--> statement-breakpoint
CREATE TYPE "public"."feature_access_level" AS ENUM('None', 'Viewer', 'Editor');--> statement-breakpoint
CREATE TYPE "public"."flagged_issue_status" AS ENUM('Pending', 'Urgent', 'Resolved', 'Ignored');--> statement-breakpoint
CREATE TYPE "public"."kb_category_type" AS ENUM('insurer', 'general', 'fundamentals');--> statement-breakpoint
CREATE TYPE "public"."kb_chat_role" AS ENUM('user', 'assistant');--> statement-breakpoint
CREATE TYPE "public"."kb_document_type" AS ENUM('brochure', 'policy_wording', 'prospectus', 'addon', 'other');--> statement-breakpoint
CREATE TYPE "public"."kb_resource_status" AS ENUM('processing', 'active', 'error', 'archived');--> statement-breakpoint
CREATE TYPE "public"."kb_resource_type" AS ENUM('pdf', 'web', 'sheet');--> statement-breakpoint
CREATE TYPE "public"."mapping_history_entity_type" AS ENUM('ped', 'alias', 'category', 'plan_override', 'plan_config');--> statement-breakpoint
CREATE TYPE "public"."ped_status" AS ENUM('draft', 'approved', 'deprecated');--> statement-breakpoint
CREATE TYPE "public"."plan_restriction_mode" AS ENUM('require_keywords', 'exclude_keywords', 'block_category');--> statement-breakpoint
CREATE TYPE "public"."playbook_issue_kind" AS ENUM('source_gap', 'excel_copy_discrepancy');--> statement-breakpoint
CREATE TYPE "public"."playbook_issue_status" AS ENUM('open', 'resolved_pending_verification', 'verified', 'recorded');--> statement-breakpoint
CREATE TYPE "public"."playbook_plan_status" AS ENUM('active', 'discontinued_fresh_porting', 'brochure_only', 'hidden');--> statement-breakpoint
CREATE TYPE "public"."playbook_snapshot_status" AS ENUM('fetched', 'rejected', 'verified', 'published', 'superseded');--> statement-breakpoint
CREATE TYPE "public"."playbook_value_kind" AS ENUM('empty', 'text', 'number', 'boolean', 'formula', 'error');--> statement-breakpoint
CREATE TYPE "public"."qa_dashboard_role" AS ENUM('admin', 'guide', 'mentor');--> statement-breakpoint
CREATE TYPE "public"."special_instruction_type" AS ENUM('override_rule', 'additional_information', 'general_instruction');--> statement-breakpoint
CREATE TYPE "public"."unresolved_query_status" AS ENUM('unresolved', 'resolved', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."user_status" AS ENUM('Active', 'Disabled');--> statement-breakpoint
CREATE TYPE "public"."user_tier" AS ENUM('General', 'Admin', 'Platform Admin', 'Developer');--> statement-breakpoint
CREATE TABLE "access_rules" (
	"id" serial PRIMARY KEY NOT NULL,
	"resource_key" text NOT NULL,
	"name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"org_team_id" integer,
	"department_id" integer,
	"role_id" integer,
	"product_tag" text,
	"granted_level" "feature_access_level" NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "advisor_directory_sync_state" (
	"user_email" varchar(320) PRIMARY KEY NOT NULL,
	"sheet_tact_id" text,
	"currently_employed" boolean DEFAULT false NOT NULL,
	"applied_department_id" integer,
	"applied_org_team_id" integer,
	"applied_role_id" integer,
	"applied_product_tags" text[] DEFAULT '{}' NOT NULL,
	"last_synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_synced_by" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_memory" (
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
	"access_count" integer DEFAULT 0 NOT NULL,
	"confidence" text,
	"suggested_category_key" text,
	"ped_id" integer
);
--> statement-breakpoint
CREATE TABLE "ai_model_pricing" (
	"model_name" text PRIMARY KEY NOT NULL,
	"input_price_per_million_tokens" numeric(12, 4) DEFAULT '0' NOT NULL,
	"output_price_per_million_tokens" numeric(12, 4) DEFAULT '0' NOT NULL,
	"updated_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_usage_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"source" "ai_usage_source" NOT NULL,
	"user_email" varchar(320) NOT NULL,
	"model" text NOT NULL,
	"input_tokens" integer NOT NULL,
	"output_tokens" integer NOT NULL,
	"total_tokens" integer NOT NULL,
	"label" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "announcement_acks" (
	"id" serial PRIMARY KEY NOT NULL,
	"announcement_id" integer NOT NULL,
	"user_email" varchar(320) NOT NULL,
	"acked_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "announcement_sync_state" (
	"id" integer PRIMARY KEY NOT NULL,
	"last_attempt_at" timestamp with time zone,
	"last_success_at" timestamp with time zone,
	"last_trigger" text,
	"last_summary" text,
	"last_error" text
);
--> statement-breakpoint
CREATE TABLE "announcements" (
	"id" serial PRIMARY KEY NOT NULL,
	"announcement" text NOT NULL,
	"effective_date" date,
	"category" text NOT NULL,
	"added_by" text NOT NULL,
	"rating" integer,
	"type" "announcement_type" DEFAULT 'QA Announcement',
	"valid_till_date" date,
	"title" text,
	"team" "announcement_audience" DEFAULT 'Health' NOT NULL,
	"announcement_date" date,
	"from_team" text,
	"requires_ack" boolean DEFAULT true NOT NULL,
	"qa_id" text,
	"source_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "announcements_qa_id_unique" UNIQUE("qa_id")
);
--> statement-breakpoint
CREATE TABLE "categories" (
	"category_key" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"description" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "change_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"timestamp" timestamp with time zone DEFAULT now() NOT NULL,
	"user_name" text NOT NULL,
	"role" varchar(32) NOT NULL,
	"action_type" text NOT NULL,
	"plan_name" text,
	"description" text NOT NULL,
	"snapshot" jsonb
);
--> statement-breakpoint
CREATE TABLE "coaching_actionables" (
	"id" serial PRIMARY KEY NOT NULL,
	"session_id" integer NOT NULL,
	"description" text NOT NULL,
	"due_date" date,
	"status" "coaching_actionable_status" DEFAULT 'Open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "coaching_sessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"tact_id" text NOT NULL,
	"advisor_name" text NOT NULL,
	"author_email" varchar(320) NOT NULL,
	"author_name" text NOT NULL,
	"meeting_date" date NOT NULL,
	"discussion_points" text,
	"meeting_notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "collision_repository" (
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
CREATE TABLE "custom_access_grants" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_email" varchar(320) NOT NULL,
	"grant_type" text NOT NULL,
	"target_id" text NOT NULL,
	"level" "feature_access_level",
	"note" text,
	"active" boolean DEFAULT true NOT NULL,
	"granted_by" text NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "departments" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "external_resources" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"url" text NOT NULL,
	"added_by" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"icon" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
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
CREATE TABLE "feature_access_overrides" (
	"feature_id" text PRIMARY KEY NOT NULL,
	"general_access" "feature_access_level",
	"admin_access" "feature_access_level",
	"platform_admin_access" "feature_access_level",
	"updated_by" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "flagged_issues" (
	"id" serial PRIMARY KEY NOT NULL,
	"timestamp" timestamp with time zone DEFAULT now() NOT NULL,
	"user_email" varchar(320) NOT NULL,
	"user_name" text NOT NULL,
	"user_tact_id" varchar(64) NOT NULL,
	"plan_name" text NOT NULL,
	"ped_input" text NOT NULL,
	"matched_question" text NOT NULL,
	"match_type" varchar(32) NOT NULL,
	"source" text NOT NULL,
	"explanation" text NOT NULL,
	"issue_notes" text NOT NULL,
	"status" "flagged_issue_status" DEFAULT 'Pending' NOT NULL,
	"owner_notes" text,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "group_tool_access" (
	"id" serial PRIMARY KEY NOT NULL,
	"relationship_group_id" integer NOT NULL,
	"feature_id" text NOT NULL,
	"level" "feature_access_level" DEFAULT 'Editor' NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "guide_mentor_advisor_mappings" (
	"id" serial PRIMARY KEY NOT NULL,
	"tact_id" text NOT NULL,
	"name" text NOT NULL,
	"email" varchar(320),
	"guide_name" text,
	"mentor_name" text,
	"status" text,
	"skill_domain" text,
	"batch_number" text,
	"date_of_moving_out" date,
	"last_working_day" date,
	"manually_edited" boolean DEFAULT false NOT NULL,
	"last_synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_synced_by" text NOT NULL,
	"last_edited_at" timestamp with time zone,
	"last_edited_by" text
);
--> statement-breakpoint
CREATE TABLE "guide_mentor_relationship_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"tact_id" text NOT NULL,
	"kind" text NOT NULL,
	"person_name" text NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date,
	"is_active" boolean DEFAULT true NOT NULL,
	"source" text NOT NULL,
	"recorded_by" text NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kb_acronyms" (
	"id" serial PRIMARY KEY NOT NULL,
	"acronym" text NOT NULL,
	"expansion" text NOT NULL,
	"notes" text,
	"domain" "announcement_team" DEFAULT 'Health' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by" text NOT NULL,
	"updated_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
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
CREATE TABLE "kb_categories" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"type" "kb_category_type" DEFAULT 'insurer' NOT NULL,
	"domain" "announcement_team" DEFAULT 'Health' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"plan_names" text[] DEFAULT '{}' NOT NULL,
	"disabled_plan_names" text[] DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
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
CREATE TABLE "kb_chat_sessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_email" text NOT NULL,
	"title" text,
	"category_id" integer,
	"plan_tags" text[] DEFAULT '{}' NOT NULL,
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
CREATE TABLE "kb_faq_connection" (
	"id" text PRIMARY KEY DEFAULT 'default' NOT NULL,
	"connected_email" text NOT NULL,
	"encrypted_refresh_token" text NOT NULL,
	"connected_by" text NOT NULL,
	"connected_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kb_playbook_connection" (
	"id" text PRIMARY KEY DEFAULT 'default' NOT NULL,
	"connected_email" text NOT NULL,
	"encrypted_refresh_token" text NOT NULL,
	"connected_by" text NOT NULL,
	"connected_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kb_playbook_plan_facts" (
	"id" serial PRIMARY KEY NOT NULL,
	"resource_id" integer NOT NULL,
	"domain" "announcement_team" DEFAULT 'Health' NOT NULL,
	"insurer_name" text NOT NULL,
	"plan_name" text NOT NULL,
	"source_tab" text NOT NULL,
	"content" text NOT NULL,
	"notes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kb_resources" (
	"id" serial PRIMARY KEY NOT NULL,
	"category_id" integer NOT NULL,
	"type" "kb_resource_type" NOT NULL,
	"title" text NOT NULL,
	"document_type" "kb_document_type" DEFAULT 'other' NOT NULL,
	"source_url" text,
	"status" "kb_resource_status" DEFAULT 'processing' NOT NULL,
	"content_hash" text,
	"last_fetched_at" timestamp with time zone,
	"chunk_count" integer DEFAULT 0 NOT NULL,
	"error_message" text,
	"plan_tags" text[] DEFAULT '{}' NOT NULL,
	"is_insurer_level" boolean DEFAULT false NOT NULL,
	"added_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
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
	"undo_note" text,
	"reason" text,
	"change_category" text,
	"business_decision" text,
	"impact_tier" text,
	"impact" jsonb
);
--> statement-breakpoint
CREATE TABLE "mapping_history" (
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
CREATE TABLE "mapping_state" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"version" bigint DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "org_teams" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "page_visibility" (
	"feature_id" text PRIMARY KEY NOT NULL,
	"hidden" boolean DEFAULT false NOT NULL,
	"updated_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ped_aliases" (
	"id" serial PRIMARY KEY NOT NULL,
	"ped_id" integer NOT NULL,
	"alias_text" text NOT NULL,
	"normalized_alias" text NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"is_visible" boolean DEFAULT true NOT NULL,
	"routing_enabled" boolean DEFAULT true NOT NULL,
	"category_key_override" text,
	"fallback_category_key" text,
	"added_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ped_aliases_normalized_alias_unique" UNIQUE("normalized_alias")
);
--> statement-breakpoint
CREATE TABLE "ped_mapping_overrides" (
	"id" serial PRIMARY KEY NOT NULL,
	"ped_text" text NOT NULL,
	"category" text NOT NULL,
	"added_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ped_mapping_overrides_ped_text_unique" UNIQUE("ped_text")
);
--> statement-breakpoint
CREATE TABLE "ped_repository" (
	"id" serial PRIMARY KEY NOT NULL,
	"ped_code" text NOT NULL,
	"canonical_name" text NOT NULL,
	"category_key" text,
	"category_chain" jsonb,
	"status" "ped_status" DEFAULT 'draft' NOT NULL,
	"merged_into_id" integer,
	"notes" text,
	"added_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ped_repository_ped_code_unique" UNIQUE("ped_code")
);
--> statement-breakpoint
CREATE TABLE "ped_directory" (
	"id" serial PRIMARY KEY NOT NULL,
	"term" text NOT NULL,
	"category" text,
	"added_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ped_directory_term_unique" UNIQUE("term")
);
--> statement-breakpoint
CREATE TABLE "plan_configs" (
	"plan_name" text PRIMARY KEY NOT NULL,
	"insurer_name" text NOT NULL,
	"questions" jsonb NOT NULL,
	"category_map" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"any_other" text NOT NULL,
	"has_umbrella" boolean DEFAULT false NOT NULL,
	"umbrella_questions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"specific_illnesses" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"overrides" jsonb,
	"disabled" boolean DEFAULT false NOT NULL,
	"disabled_note" text,
	"removed" boolean DEFAULT false NOT NULL,
	"added_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plan_overrides" (
	"id" serial PRIMARY KEY NOT NULL,
	"plan_name" text NOT NULL,
	"ped_id" integer NOT NULL,
	"category_key" text,
	"target_question" text,
	"reason" text,
	"added_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
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
CREATE TABLE "playbook_cells" (
	"snapshot_id" integer NOT NULL,
	"sheet_gid" bigint NOT NULL,
	"row_num" integer NOT NULL,
	"col_num" integer NOT NULL,
	"a1" text NOT NULL,
	"value_kind" "playbook_value_kind" NOT NULL,
	"raw_text" text,
	"number_raw" text,
	"number_value" numeric,
	"formatted_value" text,
	"formula" text,
	"user_entered_value" jsonb,
	"effective_value" jsonb,
	"text_format_runs" jsonb,
	"resolved_runs" jsonb,
	"user_entered_format" jsonb,
	"effective_format" jsonb,
	"chip_runs" jsonb,
	"note" text,
	"hyperlink" text,
	"merge_range" text,
	"covered_by" text,
	CONSTRAINT "playbook_cells_pk" PRIMARY KEY("snapshot_id","sheet_gid","row_num","col_num"),
	CONSTRAINT "playbook_cells_positive" CHECK ("playbook_cells"."row_num" >= 1 AND "playbook_cells"."col_num" >= 1),
	CONSTRAINT "playbook_cells_empty_has_no_text" CHECK ("playbook_cells"."value_kind" <> 'empty' OR "playbook_cells"."raw_text" IS NULL),
	CONSTRAINT "playbook_cells_merge_xor" CHECK ("playbook_cells"."merge_range" IS NULL OR "playbook_cells"."covered_by" IS NULL)
);
--> statement-breakpoint
CREATE TABLE "playbook_features" (
	"domain" "announcement_team" DEFAULT 'Health' NOT NULL,
	"feature_key" text NOT NULL,
	"sub_key" text DEFAULT '' NOT NULL,
	"expected_label" text NOT NULL,
	"expected_sub_label" text,
	"sort_order" integer NOT NULL,
	"updated_by" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "playbook_features_pk" PRIMARY KEY("domain","feature_key","sub_key")
);
--> statement-breakpoint
CREATE TABLE "playbook_mirror_connection" (
	"domain" "announcement_team" PRIMARY KEY NOT NULL,
	"connected_email" text NOT NULL,
	"encrypted_refresh_token" text NOT NULL,
	"granted_scopes" text[] NOT NULL,
	"connected_by" text NOT NULL,
	"connected_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "playbook_mirror_connection_readonly_scopes" CHECK ('https://www.googleapis.com/auth/spreadsheets.readonly' = ANY ("playbook_mirror_connection"."granted_scopes") AND NOT ("playbook_mirror_connection"."granted_scopes" && ARRAY['https://www.googleapis.com/auth/spreadsheets','https://www.googleapis.com/auth/drive','https://www.googleapis.com/auth/drive.file','https://www.googleapis.com/auth/script.processes']::text[]))
);
--> statement-breakpoint
CREATE TABLE "playbook_plans" (
	"plan_key" text PRIMARY KEY NOT NULL,
	"domain" "announcement_team" DEFAULT 'Health' NOT NULL,
	"insurer" text NOT NULL,
	"display_name" text NOT NULL,
	"expected_header" text NOT NULL,
	"status" "playbook_plan_status" NOT NULL,
	"status_confirmed_by" text,
	"status_confirmed_at" timestamp with time zone,
	"show_to_advisors" boolean DEFAULT false NOT NULL,
	"kb_plan_name" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"updated_by" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "playbook_plans_header_unique" UNIQUE("domain","expected_header"),
	CONSTRAINT "playbook_plans_visible_needs_confirmation" CHECK (NOT "playbook_plans"."show_to_advisors" OR ("playbook_plans"."status_confirmed_by" IS NOT NULL AND "playbook_plans"."status_confirmed_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "playbook_published" (
	"domain" "announcement_team" PRIMARY KEY NOT NULL,
	"snapshot_id" integer NOT NULL,
	"updated_by" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "playbook_snapshot_tabs" (
	"snapshot_id" integer NOT NULL,
	"sheet_gid" bigint NOT NULL,
	"title" text NOT NULL,
	"tab_index" integer,
	"frozen_rows" integer,
	"frozen_cols" integer,
	"grid_rows" integer,
	"grid_cols" integer,
	"hidden_rows" integer[] DEFAULT '{}' NOT NULL,
	"hidden_cols" integer[] DEFAULT '{}' NOT NULL,
	"rows_hidden_by_filter" integer[] DEFAULT '{}' NOT NULL,
	"merges_raw" jsonb DEFAULT '[]'::jsonb NOT NULL,
	CONSTRAINT "playbook_snapshot_tabs_pk" PRIMARY KEY("snapshot_id","sheet_gid")
);
--> statement-breakpoint
CREATE TABLE "playbook_snapshots" (
	"id" serial PRIMARY KEY NOT NULL,
	"domain" "announcement_team" DEFAULT 'Health' NOT NULL,
	"spreadsheet_id" text NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"fetched_via" text NOT NULL,
	"trigger" text NOT NULL,
	"request_ranges" text[] NOT NULL,
	"request_fields" text NOT NULL,
	"raw_response_gzip" "bytea" NOT NULL,
	"raw_response_bytes" integer NOT NULL,
	"raw_sha256" text NOT NULL,
	"parser_version" text NOT NULL,
	"status" "playbook_snapshot_status" DEFAULT 'fetched' NOT NULL,
	"structure_report" jsonb,
	"reconciliation_report" jsonb,
	"diff_vs_published" jsonb,
	"rejected_reason" text,
	"published_by" text,
	"published_at" timestamp with time zone,
	CONSTRAINT "playbook_snapshots_sha256_format" CHECK ("playbook_snapshots"."raw_sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "playbook_snapshots_rejected_has_reason" CHECK ("playbook_snapshots"."status" <> 'rejected' OR "playbook_snapshots"."rejected_reason" IS NOT NULL),
	CONSTRAINT "playbook_snapshots_published_has_who" CHECK ("playbook_snapshots"."published_at" IS NULL OR "playbook_snapshots"."published_by" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "playbook_source_issues" (
	"id" serial PRIMARY KEY NOT NULL,
	"domain" "announcement_team" DEFAULT 'Health' NOT NULL,
	"issue_key" text NOT NULL,
	"kind" "playbook_issue_kind" NOT NULL,
	"status" "playbook_issue_status" NOT NULL,
	"tab_title" text NOT NULL,
	"a1" text NOT NULL,
	"description" text NOT NULL,
	"show_warning" boolean NOT NULL,
	"resolved_by" text,
	"resolved_at" timestamp with time zone,
	"verified_by" text,
	"verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "playbook_source_issues_key_unique" UNIQUE("domain","issue_key"),
	CONSTRAINT "playbook_source_issues_verified_by_other" CHECK ("playbook_source_issues"."status" <> 'verified' OR ("playbook_source_issues"."verified_by" IS NOT NULL AND "playbook_source_issues"."verified_at" IS NOT NULL AND "playbook_source_issues"."verified_by" IS DISTINCT FROM "playbook_source_issues"."resolved_by")),
	CONSTRAINT "playbook_source_issues_warning_until_verified" CHECK ("playbook_source_issues"."kind" <> 'source_gap' OR "playbook_source_issues"."status" = 'verified' OR "playbook_source_issues"."show_warning")
);
--> statement-breakpoint
CREATE TABLE "playbook_sync_state" (
	"domain" "announcement_team" PRIMARY KEY NOT NULL,
	"last_attempt_at" timestamp with time zone,
	"last_success_at" timestamp with time zone,
	"last_trigger" text,
	"last_error" text,
	"last_snapshot_id" integer
);
--> statement-breakpoint
CREATE TABLE "product_assist_acks" (
	"user_email" varchar(320) PRIMARY KEY NOT NULL,
	"acked_at" timestamp with time zone,
	"last_reminder_date" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_assist_eligibility_groups" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"department_id" integer,
	"org_team_id" integer,
	"role_id" integer,
	"tag" text,
	"daily_credits" integer,
	"monthly_credits" integer,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_assist_extra_credit_grants" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_email" varchar(320) NOT NULL,
	"amount" integer NOT NULL,
	"reason" text,
	"granted_by" text NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "product_assist_log_export_connection" (
	"id" text PRIMARY KEY DEFAULT 'default' NOT NULL,
	"connected_email" text NOT NULL,
	"encrypted_refresh_token" text NOT NULL,
	"connected_by" text NOT NULL,
	"connected_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_assist_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_email" text NOT NULL,
	"usage_ledger_id" integer,
	"category_id" integer,
	"category_name" text,
	"plan_tags" text[] DEFAULT '{}' NOT NULL,
	"question" text NOT NULL,
	"answer" text NOT NULL,
	"share" text,
	"sources" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"had_no_matches" boolean DEFAULT false NOT NULL,
	"retrieved_chunk_count" integer DEFAULT 0 NOT NULL,
	"playbook_fact_count" integer DEFAULT 0 NOT NULL,
	"history_turn_count" integer DEFAULT 0 NOT NULL,
	"input_tokens" integer,
	"output_tokens" integer,
	"model_name" text,
	"latency_ms" integer,
	"exported_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_assist_quota_settings" (
	"id" text PRIMARY KEY DEFAULT 'default' NOT NULL,
	"tokens_per_credit" integer DEFAULT 1000 NOT NULL,
	"warning_threshold_percent" integer DEFAULT 80 NOT NULL,
	"monthly_budget" numeric(12, 2) DEFAULT '2000' NOT NULL,
	"budget_warning_threshold_percent" integer DEFAULT 80 NOT NULL,
	"currency" text DEFAULT 'INR' NOT NULL,
	"model_name" text DEFAULT 'gemini-2.5-flash' NOT NULL,
	"input_price_per_million_tokens" numeric(12, 4) DEFAULT '0' NOT NULL,
	"output_price_per_million_tokens" numeric(12, 4) DEFAULT '0' NOT NULL,
	"updated_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_assist_unresolved_queries" (
	"id" serial PRIMARY KEY NOT NULL,
	"domain" "announcement_team" NOT NULL,
	"user_email" text NOT NULL,
	"category_id" integer,
	"category_name" text,
	"plan_tags" text[] DEFAULT '{}' NOT NULL,
	"question" text NOT NULL,
	"status" "unresolved_query_status" DEFAULT 'unresolved' NOT NULL,
	"resolved_special_instruction_id" integer,
	"resolved_by" text,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_assist_usage_ledger" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_email" varchar(320) NOT NULL,
	"input_tokens" integer NOT NULL,
	"output_tokens" integer NOT NULL,
	"total_tokens" integer NOT NULL,
	"credits" numeric(10, 3) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_assist_user_quota_overrides" (
	"user_email" varchar(320) PRIMARY KEY NOT NULL,
	"custom_daily_credits" integer,
	"custom_monthly_credits" integer,
	"limits_enabled" boolean DEFAULT true NOT NULL,
	"unlimited_access" boolean DEFAULT false NOT NULL,
	"updated_by" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "qa_dashboard_google_connection" (
	"id" text PRIMARY KEY DEFAULT 'default' NOT NULL,
	"connected_email" text NOT NULL,
	"encrypted_refresh_token" text NOT NULL,
	"connected_by" text NOT NULL,
	"connected_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "qa_dashboard_roles" (
	"email" varchar(320) PRIMARY KEY NOT NULL,
	"role" "qa_dashboard_role" NOT NULL,
	"display_name" text,
	"assigned_by" text NOT NULL,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "qa_evaluation_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"checked_date" text NOT NULL,
	"mistake_date" text,
	"tact_id" text NOT NULL,
	"advisor_name" text NOT NULL,
	"chat_id" text NOT NULL,
	"domain" text NOT NULL,
	"score" integer,
	"source_batch" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "qa_feedback_discussed_marks" (
	"id" serial PRIMARY KEY NOT NULL,
	"tact_id" text NOT NULL,
	"row_identity" text NOT NULL,
	"marked_by_email" varchar(320) NOT NULL,
	"marked_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "relationship_groups" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"active" boolean DEFAULT true NOT NULL,
	"department_id" integer,
	"used_for_group_access" boolean DEFAULT false NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
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
CREATE TABLE "search_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"timestamp" timestamp with time zone DEFAULT now() NOT NULL,
	"user_email" varchar(320) NOT NULL,
	"plan_name" text NOT NULL,
	"ped_input" text NOT NULL,
	"matched_question" text NOT NULL,
	"match_type" varchar(32) NOT NULL,
	"source" text NOT NULL,
	"explanation" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "smoke_test_peds" (
	"id" serial PRIMARY KEY NOT NULL,
	"term" text NOT NULL,
	"added_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "special_instructions" (
	"id" serial PRIMARY KEY NOT NULL,
	"topic" text NOT NULL,
	"instruction_text" text NOT NULL,
	"instruction_type" "special_instruction_type" NOT NULL,
	"insurer_category_id" integer,
	"product_plan_name" text,
	"domain" "announcement_team" DEFAULT 'Health' NOT NULL,
	"topic_embedding" vector(768) NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by" text NOT NULL,
	"updated_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "term_faq_connection" (
	"id" text PRIMARY KEY DEFAULT 'default' NOT NULL,
	"connected_email" text NOT NULL,
	"encrypted_refresh_token" text NOT NULL,
	"connected_by" text NOT NULL,
	"connected_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "term_faq_records" (
	"id" serial PRIMARY KEY NOT NULL,
	"resource_id" integer NOT NULL,
	"category" text NOT NULL,
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
CREATE TABLE "term_playbook_connection" (
	"id" text PRIMARY KEY DEFAULT 'default' NOT NULL,
	"connected_email" text NOT NULL,
	"encrypted_refresh_token" text NOT NULL,
	"connected_by" text NOT NULL,
	"connected_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_relationships" (
	"id" serial PRIMARY KEY NOT NULL,
	"owner_email" varchar(320) NOT NULL,
	"subject_email" varchar(320) NOT NULL,
	"relationship_group_id" integer NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"email" varchar(320) PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"tact_id" varchar(64) NOT NULL,
	"tier" "user_tier" DEFAULT 'General' NOT NULL,
	"status" "user_status" DEFAULT 'Active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_login" timestamp with time zone,
	"picture" text,
	"tags" text[] DEFAULT '{}' NOT NULL,
	"department_id" integer,
	"org_team_id" integer,
	"role_id" integer
);
--> statement-breakpoint
ALTER TABLE "access_rules" ADD CONSTRAINT "access_rules_org_team_id_org_teams_id_fk" FOREIGN KEY ("org_team_id") REFERENCES "public"."org_teams"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_rules" ADD CONSTRAINT "access_rules_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_rules" ADD CONSTRAINT "access_rules_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "advisor_directory_sync_state" ADD CONSTRAINT "advisor_directory_sync_state_user_email_users_email_fk" FOREIGN KEY ("user_email") REFERENCES "public"."users"("email") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "advisor_directory_sync_state" ADD CONSTRAINT "advisor_directory_sync_state_applied_department_id_departments_id_fk" FOREIGN KEY ("applied_department_id") REFERENCES "public"."departments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "advisor_directory_sync_state" ADD CONSTRAINT "advisor_directory_sync_state_applied_org_team_id_org_teams_id_fk" FOREIGN KEY ("applied_org_team_id") REFERENCES "public"."org_teams"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "advisor_directory_sync_state" ADD CONSTRAINT "advisor_directory_sync_state_applied_role_id_roles_id_fk" FOREIGN KEY ("applied_role_id") REFERENCES "public"."roles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "announcement_acks" ADD CONSTRAINT "announcement_acks_announcement_id_announcements_id_fk" FOREIGN KEY ("announcement_id") REFERENCES "public"."announcements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coaching_actionables" ADD CONSTRAINT "coaching_actionables_session_id_coaching_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."coaching_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_access_grants" ADD CONSTRAINT "custom_access_grants_user_email_users_email_fk" FOREIGN KEY ("user_email") REFERENCES "public"."users"("email") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "faq_records" ADD CONSTRAINT "faq_records_resource_id_kb_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."kb_resources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_tool_access" ADD CONSTRAINT "group_tool_access_relationship_group_id_relationship_groups_id_fk" FOREIGN KEY ("relationship_group_id") REFERENCES "public"."relationship_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kb_announcements" ADD CONSTRAINT "kb_announcements_category_id_kb_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."kb_categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kb_chat_messages" ADD CONSTRAINT "kb_chat_messages_session_id_kb_chat_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."kb_chat_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kb_chat_sessions" ADD CONSTRAINT "kb_chat_sessions_category_id_kb_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."kb_categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kb_chunks" ADD CONSTRAINT "kb_chunks_resource_id_kb_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."kb_resources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kb_playbook_plan_facts" ADD CONSTRAINT "kb_playbook_plan_facts_resource_id_kb_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."kb_resources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kb_resources" ADD CONSTRAINT "kb_resources_category_id_kb_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."kb_categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "playbook_cells" ADD CONSTRAINT "playbook_cells_tab_fk" FOREIGN KEY ("snapshot_id","sheet_gid") REFERENCES "public"."playbook_snapshot_tabs"("snapshot_id","sheet_gid") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "playbook_published" ADD CONSTRAINT "playbook_published_snapshot_id_playbook_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."playbook_snapshots"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "playbook_snapshot_tabs" ADD CONSTRAINT "playbook_snapshot_tabs_snapshot_id_playbook_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."playbook_snapshots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "playbook_sync_state" ADD CONSTRAINT "playbook_sync_state_last_snapshot_id_playbook_snapshots_id_fk" FOREIGN KEY ("last_snapshot_id") REFERENCES "public"."playbook_snapshots"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_assist_eligibility_groups" ADD CONSTRAINT "product_assist_eligibility_groups_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_assist_eligibility_groups" ADD CONSTRAINT "product_assist_eligibility_groups_org_team_id_org_teams_id_fk" FOREIGN KEY ("org_team_id") REFERENCES "public"."org_teams"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_assist_eligibility_groups" ADD CONSTRAINT "product_assist_eligibility_groups_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_assist_extra_credit_grants" ADD CONSTRAINT "product_assist_extra_credit_grants_user_email_users_email_fk" FOREIGN KEY ("user_email") REFERENCES "public"."users"("email") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_assist_logs" ADD CONSTRAINT "product_assist_logs_usage_ledger_id_product_assist_usage_ledger_id_fk" FOREIGN KEY ("usage_ledger_id") REFERENCES "public"."product_assist_usage_ledger"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_assist_unresolved_queries" ADD CONSTRAINT "product_assist_unresolved_queries_category_id_kb_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."kb_categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_assist_unresolved_queries" ADD CONSTRAINT "product_assist_unresolved_queries_resolved_special_instruction_id_special_instructions_id_fk" FOREIGN KEY ("resolved_special_instruction_id") REFERENCES "public"."special_instructions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_assist_user_quota_overrides" ADD CONSTRAINT "product_assist_user_quota_overrides_user_email_users_email_fk" FOREIGN KEY ("user_email") REFERENCES "public"."users"("email") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relationship_groups" ADD CONSTRAINT "relationship_groups_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "special_instructions" ADD CONSTRAINT "special_instructions_insurer_category_id_kb_categories_id_fk" FOREIGN KEY ("insurer_category_id") REFERENCES "public"."kb_categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "term_faq_records" ADD CONSTRAINT "term_faq_records_resource_id_kb_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."kb_resources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_relationships" ADD CONSTRAINT "user_relationships_owner_email_users_email_fk" FOREIGN KEY ("owner_email") REFERENCES "public"."users"("email") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_relationships" ADD CONSTRAINT "user_relationships_subject_email_users_email_fk" FOREIGN KEY ("subject_email") REFERENCES "public"."users"("email") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_relationships" ADD CONSTRAINT "user_relationships_relationship_group_id_relationship_groups_id_fk" FOREIGN KEY ("relationship_group_id") REFERENCES "public"."relationship_groups"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_org_team_id_org_teams_id_fk" FOREIGN KEY ("org_team_id") REFERENCES "public"."org_teams"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ai_memory_condition_plan_version_idx" ON "ai_memory" USING btree ("normalized_condition","plan_name","engine_version");--> statement-breakpoint
CREATE INDEX "ai_usage_log_created_at_idx" ON "ai_usage_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "ai_usage_log_source_created_idx" ON "ai_usage_log" USING btree ("source","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "announcement_acks_announcement_user_unique" ON "announcement_acks" USING btree ("announcement_id","user_email");--> statement-breakpoint
CREATE INDEX "coaching_actionables_session_id_idx" ON "coaching_actionables" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "coaching_sessions_tact_id_idx" ON "coaching_sessions" USING btree ("tact_id");--> statement-breakpoint
CREATE UNIQUE INDEX "custom_access_grants_triple_unique" ON "custom_access_grants" USING btree ("user_email","grant_type","target_id");--> statement-breakpoint
CREATE UNIQUE INDEX "departments_name_unique" ON "departments" USING btree ("name");--> statement-breakpoint
CREATE INDEX "faq_records_resource_id_idx" ON "faq_records" USING btree ("resource_id");--> statement-breakpoint
CREATE INDEX "faq_records_category_idx" ON "faq_records" USING btree ("category");--> statement-breakpoint
CREATE INDEX "faq_records_is_active_idx" ON "faq_records" USING btree ("is_active");--> statement-breakpoint
CREATE UNIQUE INDEX "group_tool_access_group_feature_unique" ON "group_tool_access" USING btree ("relationship_group_id","feature_id");--> statement-breakpoint
CREATE UNIQUE INDEX "guide_mentor_advisor_mappings_tact_id_unique" ON "guide_mentor_advisor_mappings" USING btree ("tact_id");--> statement-breakpoint
CREATE INDEX "guide_mentor_relationship_history_tact_id_idx" ON "guide_mentor_relationship_history" USING btree ("tact_id");--> statement-breakpoint
CREATE INDEX "guide_mentor_relationship_history_tact_kind_idx" ON "guide_mentor_relationship_history" USING btree ("tact_id","kind");--> statement-breakpoint
CREATE INDEX "kb_acronyms_is_active_idx" ON "kb_acronyms" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "kb_announcements_category_id_idx" ON "kb_announcements" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "kb_chat_messages_session_id_idx" ON "kb_chat_messages" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "kb_chat_sessions_user_email_idx" ON "kb_chat_sessions" USING btree ("user_email");--> statement-breakpoint
CREATE INDEX "kb_chunks_resource_id_idx" ON "kb_chunks" USING btree ("resource_id");--> statement-breakpoint
CREATE INDEX "kb_playbook_plan_facts_resource_id_idx" ON "kb_playbook_plan_facts" USING btree ("resource_id");--> statement-breakpoint
CREATE INDEX "kb_playbook_plan_facts_insurer_plan_idx" ON "kb_playbook_plan_facts" USING btree ("insurer_name","plan_name");--> statement-breakpoint
CREATE INDEX "kb_resources_category_id_idx" ON "kb_resources" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "mapping_change_sets_ai_memory_idx" ON "mapping_change_sets" USING btree ("related_ai_memory_id");--> statement-breakpoint
CREATE UNIQUE INDEX "org_teams_name_unique" ON "org_teams" USING btree ("name");--> statement-breakpoint
CREATE UNIQUE INDEX "plan_overrides_plan_ped_idx" ON "plan_overrides" USING btree ("plan_name","ped_id");--> statement-breakpoint
CREATE INDEX "plan_restrictions_plan_name_idx" ON "plan_restrictions" USING btree ("plan_name");--> statement-breakpoint
CREATE INDEX "plan_restrictions_is_active_idx" ON "plan_restrictions" USING btree ("is_active");--> statement-breakpoint
CREATE UNIQUE INDEX "playbook_cells_a1_idx" ON "playbook_cells" USING btree ("snapshot_id","sheet_gid","a1");--> statement-breakpoint
CREATE INDEX "playbook_snapshots_domain_fetched_idx" ON "playbook_snapshots" USING btree ("domain","fetched_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "product_assist_extra_credit_grants_user_email_idx" ON "product_assist_extra_credit_grants" USING btree ("user_email");--> statement-breakpoint
CREATE INDEX "product_assist_logs_created_at_idx" ON "product_assist_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "product_assist_logs_exported_at_idx" ON "product_assist_logs" USING btree ("exported_at");--> statement-breakpoint
CREATE INDEX "product_assist_logs_usage_ledger_id_idx" ON "product_assist_logs" USING btree ("usage_ledger_id");--> statement-breakpoint
CREATE INDEX "product_assist_unresolved_queries_created_at_idx" ON "product_assist_unresolved_queries" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "product_assist_unresolved_queries_status_idx" ON "product_assist_unresolved_queries" USING btree ("status");--> statement-breakpoint
CREATE INDEX "product_assist_unresolved_queries_domain_idx" ON "product_assist_unresolved_queries" USING btree ("domain");--> statement-breakpoint
CREATE INDEX "product_assist_usage_ledger_user_created_idx" ON "product_assist_usage_ledger" USING btree ("user_email","created_at");--> statement-breakpoint
CREATE INDEX "qa_evaluation_history_tact_id_idx" ON "qa_evaluation_history" USING btree ("tact_id");--> statement-breakpoint
CREATE INDEX "qa_evaluation_history_checked_date_idx" ON "qa_evaluation_history" USING btree ("checked_date");--> statement-breakpoint
CREATE UNIQUE INDEX "qa_feedback_discussed_marks_tact_row_idx" ON "qa_feedback_discussed_marks" USING btree ("tact_id","row_identity");--> statement-breakpoint
CREATE INDEX "qa_feedback_discussed_marks_tact_id_idx" ON "qa_feedback_discussed_marks" USING btree ("tact_id");--> statement-breakpoint
CREATE UNIQUE INDEX "relationship_groups_name_unique" ON "relationship_groups" USING btree ("name");--> statement-breakpoint
CREATE UNIQUE INDEX "roles_name_unique" ON "roles" USING btree ("name");--> statement-breakpoint
CREATE INDEX "routing_rules_position_idx" ON "routing_rules" USING btree ("position");--> statement-breakpoint
CREATE INDEX "special_instructions_insurer_category_id_idx" ON "special_instructions" USING btree ("insurer_category_id");--> statement-breakpoint
CREATE INDEX "special_instructions_is_active_idx" ON "special_instructions" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "term_faq_records_resource_id_idx" ON "term_faq_records" USING btree ("resource_id");--> statement-breakpoint
CREATE INDEX "term_faq_records_category_idx" ON "term_faq_records" USING btree ("category");--> statement-breakpoint
CREATE INDEX "term_faq_records_is_active_idx" ON "term_faq_records" USING btree ("is_active");--> statement-breakpoint
CREATE UNIQUE INDEX "user_relationships_triple_unique" ON "user_relationships" USING btree ("owner_email","subject_email","relationship_group_id");