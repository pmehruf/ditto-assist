-- Access Control system (2026-08-19): makes the previously-hardcoded
-- General/Admin per-feature permission matrix (DEFAULT_FEATURE_PERMISSIONS
-- in src/constants/featurePermissions.ts) editable through the UI without a
-- code change/deploy, and introduces Departments as pure organizational
-- metadata with zero effect on access. See docs of feature_access_overrides
-- and departments below (and their mirrors in src/server/db/schema.ts) for
-- the full reasoning.
--
-- Every new table/column here is purely additive and defaults to "nothing
-- changed yet": feature_access_overrides starts empty (every feature keeps
-- behaving exactly as DEFAULT_FEATURE_PERMISSIONS already says), and every
-- existing user's new department_id starts NULL (unassigned) since there is
-- no current department data to migrate.

CREATE TYPE "feature_access_level" AS ENUM ('None', 'Viewer', 'Editor');
--> statement-breakpoint

CREATE TABLE "feature_access_overrides" (
	"feature_id" text PRIMARY KEY NOT NULL,
	"general_access" "feature_access_level",
	"admin_access" "feature_access_level",
	"updated_by" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
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

CREATE UNIQUE INDEX "departments_name_unique" ON "departments" USING btree ("name");
--> statement-breakpoint

ALTER TABLE "users" ADD COLUMN "department_id" integer;
--> statement-breakpoint

ALTER TABLE "users" ADD CONSTRAINT "users_department_id_departments_id_fk"
	FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id")
	ON DELETE SET NULL ON UPDATE NO ACTION;
