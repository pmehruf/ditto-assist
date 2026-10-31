-- PROPOSAL ONLY (Step 2 review). Not in ./drizzle, not in the journal, not applied anywhere.
-- On approval this file is copied to drizzle/0090_playbook_mirror.sql with journal
-- entry when=1792400000000 (must be > 1792300000000, the newest applied on staging).
--
-- Product Playbook mirror: exact, versioned, read-only copy of two Google Sheet tabs.
-- ADDITIVE ONLY: creates new types, tables, functions and triggers. It does not ALTER,
-- DROP or write to any existing table. It reuses the existing enum "announcement_team"
-- (Health/Term) for the domain column, exactly as kb_playbook_plan_facts does.

CREATE TYPE "playbook_snapshot_status" AS ENUM ('fetched', 'rejected', 'verified', 'published', 'superseded');
--> statement-breakpoint
CREATE TYPE "playbook_value_kind" AS ENUM ('empty', 'text', 'number', 'boolean', 'formula', 'error');
--> statement-breakpoint
CREATE TYPE "playbook_plan_status" AS ENUM ('active', 'discontinued_fresh_porting', 'brochure_only', 'hidden');
--> statement-breakpoint
CREATE TYPE "playbook_issue_kind" AS ENUM ('source_gap', 'excel_copy_discrepancy');
--> statement-breakpoint
CREATE TYPE "playbook_issue_status" AS ENUM ('open', 'resolved_pending_verification', 'verified', 'recorded');
--> statement-breakpoint

-- 1. Dedicated read-only Google grant for the mirror (separate from kb_playbook_connection,
--    which is left untouched). granted_scopes = what Google's tokeninfo reported at connect
--    time. The CHECK refuses to store any grant that carries a write or Drive scope.
CREATE TABLE "playbook_mirror_connection" (
  "domain" "announcement_team" PRIMARY KEY NOT NULL,
  "connected_email" text NOT NULL,
  "encrypted_refresh_token" text NOT NULL,
  "granted_scopes" text[] NOT NULL,
  "connected_by" text NOT NULL,
  "connected_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "playbook_mirror_connection_readonly_scopes" CHECK (
    'https://www.googleapis.com/auth/spreadsheets.readonly' = ANY ("granted_scopes")
    AND NOT ("granted_scopes" && ARRAY[
      'https://www.googleapis.com/auth/spreadsheets',
      'https://www.googleapis.com/auth/drive',
      'https://www.googleapis.com/auth/drive.file',
      'https://www.googleapis.com/auth/script.processes'
    ]::text[])
  )
);
--> statement-breakpoint

-- 2. One row per sync attempt that produced a response. Immutable source columns.
CREATE TABLE "playbook_snapshots" (
  "id" serial PRIMARY KEY NOT NULL,
  "domain" "announcement_team" DEFAULT 'Health' NOT NULL,
  "spreadsheet_id" text NOT NULL,
  "fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
  "fetched_via" text NOT NULL,
  "trigger" text NOT NULL,
  "request_ranges" text[] NOT NULL,
  "request_fields" text NOT NULL,
  "raw_response_gzip" bytea NOT NULL,
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
  CONSTRAINT "playbook_snapshots_sha256_format" CHECK ("raw_sha256" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "playbook_snapshots_rejected_has_reason" CHECK ("status" <> 'rejected' OR "rejected_reason" IS NOT NULL),
  CONSTRAINT "playbook_snapshots_published_has_who" CHECK ("published_at" IS NULL OR "published_by" IS NOT NULL)
);
--> statement-breakpoint
CREATE INDEX "playbook_snapshots_domain_fetched_idx" ON "playbook_snapshots" ("domain", "fetched_at" DESC NULLS LAST);
--> statement-breakpoint

-- 3. Per-tab metadata, exactly as received (merges/hidden flags kept raw + as arrays).
CREATE TABLE "playbook_snapshot_tabs" (
  "snapshot_id" integer NOT NULL CONSTRAINT "playbook_snapshot_tabs_snapshot_id_playbook_snapshots_id_fk" REFERENCES "playbook_snapshots"("id") ON DELETE CASCADE,
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
  CONSTRAINT "playbook_snapshot_tabs_pk" PRIMARY KEY ("snapshot_id", "sheet_gid")
);
--> statement-breakpoint

-- 4. Every cell with a value, note, link or formatting run. Raw API objects are stored
--    unchanged next to the convenience columns; nothing is trimmed or normalised.
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
  CONSTRAINT "playbook_cells_pk" PRIMARY KEY ("snapshot_id", "sheet_gid", "row_num", "col_num"),
  CONSTRAINT "playbook_cells_tab_fk" FOREIGN KEY ("snapshot_id", "sheet_gid")
    REFERENCES "playbook_snapshot_tabs"("snapshot_id", "sheet_gid") ON DELETE CASCADE,
  CONSTRAINT "playbook_cells_positive" CHECK ("row_num" >= 1 AND "col_num" >= 1),
  CONSTRAINT "playbook_cells_empty_has_no_text" CHECK ("value_kind" <> 'empty' OR "raw_text" IS NULL),
  CONSTRAINT "playbook_cells_merge_xor" CHECK ("merge_range" IS NULL OR "covered_by" IS NULL)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "playbook_cells_a1_idx" ON "playbook_cells" ("snapshot_id", "sheet_gid", "a1");
--> statement-breakpoint

-- 5. Approved structure. Statuses are PROVISIONAL until confirmed (D4); a plan can only be
--    shown to advisors once its status is confirmed. Nothing is derived from header text.
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
  CONSTRAINT "playbook_plans_header_unique" UNIQUE ("domain", "expected_header"),
  CONSTRAINT "playbook_plans_visible_needs_confirmation" CHECK (
    NOT "show_to_advisors" OR ("status_confirmed_by" IS NOT NULL AND "status_confirmed_at" IS NOT NULL)
  )
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
  CONSTRAINT "playbook_features_pk" PRIMARY KEY ("domain", "feature_key", "sub_key")
);
--> statement-breakpoint

-- 6. What advisors would see. Empty after this migration: nothing is published in Step 2.
CREATE TABLE "playbook_published" (
  "domain" "announcement_team" PRIMARY KEY NOT NULL,
  "snapshot_id" integer NOT NULL CONSTRAINT "playbook_published_snapshot_id_playbook_snapshots_id_fk" REFERENCES "playbook_snapshots"("id") ON DELETE RESTRICT,
  "updated_by" text NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

-- 7. Sync health (D9: immediate warning on failure), including failures that never
--    produced a snapshot (e.g. Google refused the request).
CREATE TABLE "playbook_sync_state" (
  "domain" "announcement_team" PRIMARY KEY NOT NULL,
  "last_attempt_at" timestamp with time zone,
  "last_success_at" timestamp with time zone,
  "last_trigger" text,
  "last_error" text,
  "last_snapshot_id" integer CONSTRAINT "playbook_sync_state_last_snapshot_id_playbook_snapshots_id_fk" REFERENCES "playbook_snapshots"("id") ON DELETE SET NULL
);
--> statement-breakpoint

-- 8. Known source issues and discrepancies (D5 warning; G29 Excel-copy damage).
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
  CONSTRAINT "playbook_source_issues_key_unique" UNIQUE ("domain", "issue_key"),
  CONSTRAINT "playbook_source_issues_verified_by_other" CHECK (
    "status" <> 'verified' OR ("verified_by" IS NOT NULL AND "verified_at" IS NOT NULL AND "verified_by" IS DISTINCT FROM "resolved_by")
  ),
  CONSTRAINT "playbook_source_issues_warning_until_verified" CHECK (
    "kind" <> 'source_gap' OR "status" = 'verified' OR "show_warning"
  )
);
--> statement-breakpoint
INSERT INTO "playbook_source_issues" ("issue_key", "kind", "status", "tab_title", "a1", "description", "show_warning") VALUES
  ('ad46_picture', 'source_gap', 'open', 'Ditto''s Recommended Policies', 'AD46',
   'Cover for Care Supreme Enhance: a picture floats over this cell and the cell itself is empty. The Google Sheets API cannot read pictures, so this information is not mirrored. Resolution agreed (D5): the product team retypes the picture''s information into the sheet; the warning stays until that is mirrored and verified by a second person.',
   true),
  ('excel_copy_g29', 'excel_copy_discrepancy', 'recorded', 'Ditto''s Recommended Policies', 'G29',
   'The downloaded Excel copy (Product Playbook - Health.xlsx, re-saved 2026-10-29) has stray cell references typed after "50% to 100%" in G29. The live Google Sheet reads "50% to 100%" and is the source of truth. The Excel copy must not be used as a source.',
   false);
--> statement-breakpoint

-- 9. Guards (database-level, so no application bug can bypass them).

-- 9a. Snapshots are immutable evidence: source columns can never change after insert.
CREATE FUNCTION "playbook_snapshots_guard_update"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."raw_response_gzip" IS DISTINCT FROM OLD."raw_response_gzip"
     OR NEW."raw_sha256" IS DISTINCT FROM OLD."raw_sha256"
     OR NEW."raw_response_bytes" IS DISTINCT FROM OLD."raw_response_bytes"
     OR NEW."spreadsheet_id" IS DISTINCT FROM OLD."spreadsheet_id"
     OR NEW."fetched_at" IS DISTINCT FROM OLD."fetched_at"
     OR NEW."request_ranges" IS DISTINCT FROM OLD."request_ranges"
     OR NEW."request_fields" IS DISTINCT FROM OLD."request_fields"
     OR NEW."parser_version" IS DISTINCT FROM OLD."parser_version"
     OR NEW."domain" IS DISTINCT FROM OLD."domain" THEN
    RAISE EXCEPTION 'playbook_snapshots: source columns are immutable (snapshot %)', OLD."id";
  END IF;
  IF OLD."published_at" IS NOT NULL AND NEW."published_at" IS DISTINCT FROM OLD."published_at" THEN
    RAISE EXCEPTION 'playbook_snapshots: published_at cannot be changed once set (snapshot %)', OLD."id";
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER "playbook_snapshots_guard_update" BEFORE UPDATE ON "playbook_snapshots"
  FOR EACH ROW EXECUTE FUNCTION "playbook_snapshots_guard_update"();
--> statement-breakpoint

-- 9b. D8: never delete a snapshot that was ever published (rollback candidates) or that the
--     published pointer references (also enforced by the RESTRICT foreign key above).
CREATE FUNCTION "playbook_snapshots_guard_delete"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."published_at" IS NOT NULL OR OLD."status" IN ('published', 'superseded') THEN
    RAISE EXCEPTION 'playbook_snapshots: snapshot % was published and must be kept for rollback', OLD."id";
  END IF;
  RETURN OLD;
END $$;
--> statement-breakpoint
CREATE TRIGGER "playbook_snapshots_guard_delete" BEFORE DELETE ON "playbook_snapshots"
  FOR EACH ROW EXECUTE FUNCTION "playbook_snapshots_guard_delete"();
--> statement-breakpoint

-- 9c. Cells and tab metadata are write-once (insert, or removal with an unpublished snapshot).
CREATE FUNCTION "playbook_write_once_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '%: rows are write-once and cannot be updated', TG_TABLE_NAME;
END $$;
--> statement-breakpoint
CREATE TRIGGER "playbook_cells_no_update" BEFORE UPDATE ON "playbook_cells"
  FOR EACH ROW EXECUTE FUNCTION "playbook_write_once_guard"();
--> statement-breakpoint
CREATE TRIGGER "playbook_snapshot_tabs_no_update" BEFORE UPDATE ON "playbook_snapshot_tabs"
  FOR EACH ROW EXECUTE FUNCTION "playbook_write_once_guard"();
--> statement-breakpoint

-- 9d. No premature publishing: the pointer may only reference a snapshot whose status is
--     'verified' or 'published', whose checks were recorded, and of the same domain.
CREATE FUNCTION "playbook_published_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE s RECORD;
BEGIN
  SELECT "status", "domain", "structure_report", "reconciliation_report" INTO s
    FROM "playbook_snapshots" WHERE "id" = NEW."snapshot_id";
  IF s."status" NOT IN ('verified', 'published') THEN
    RAISE EXCEPTION 'playbook_published: snapshot % has status %, only verified snapshots can be published', NEW."snapshot_id", s."status";
  END IF;
  IF s."structure_report" IS NULL OR s."reconciliation_report" IS NULL THEN
    RAISE EXCEPTION 'playbook_published: snapshot % has no recorded structure/reconciliation report', NEW."snapshot_id";
  END IF;
  IF s."domain" <> NEW."domain" THEN
    RAISE EXCEPTION 'playbook_published: snapshot % belongs to domain %, not %', NEW."snapshot_id", s."domain", NEW."domain";
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER "playbook_published_guard" BEFORE INSERT OR UPDATE ON "playbook_published"
  FOR EACH ROW EXECUTE FUNCTION "playbook_published_guard"();
