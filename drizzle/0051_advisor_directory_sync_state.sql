-- Advisor Directory Sync — one-row-per-user ledger of exactly what the
-- master_advisors sync last wrote to a directory user's
-- department/team/role/tags, so a later run can idempotently no-op an
-- already-correct user and safely revert ONLY its own prior assignment
-- when someone drops off "Currently Employed" (never touching a field a
-- human has manually changed since). See schema.ts's table comment for the
-- full reasoning.

CREATE TABLE "advisor_directory_sync_state" (
    "user_email" varchar(320) PRIMARY KEY REFERENCES "public"."users"("email") ON DELETE CASCADE,
    "sheet_tact_id" text,
    "currently_employed" boolean NOT NULL DEFAULT false,
    "applied_department_id" integer REFERENCES "public"."departments"("id") ON DELETE SET NULL,
    "applied_org_team_id" integer REFERENCES "public"."org_teams"("id") ON DELETE SET NULL,
    "applied_role_id" integer REFERENCES "public"."roles"("id") ON DELETE SET NULL,
    "applied_product_tags" text[] NOT NULL DEFAULT '{}',
    "last_synced_at" timestamp with time zone NOT NULL DEFAULT now(),
    "last_synced_by" text NOT NULL
);
