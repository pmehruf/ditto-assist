-- Access Control system, Phase 2 (2026-08): Team, Role, person-to-person
-- Relationships, Custom Access Grants, and the "Platform Admin" tier.
--
-- All additive. No existing column is altered or dropped; every new FK
-- column on `users` is nullable (no backfill/guess for existing users,
-- consistent with department_id's precedent in 0037). See schema.ts's doc
-- comments on each table for the full reasoning.

-- 1. Extend the tier enum. Postgres requires ADD VALUE to run outside an
--    explicit transaction block in older versions; drizzle-kit's migrator
--    runs each statement-breakpoint-separated statement independently, so
--    this is safe as its own statement.
ALTER TYPE "user_tier" ADD VALUE 'Platform Admin';
--> statement-breakpoint

-- 2. org_teams (Bliss / Falcon / Central) — named org_teams, not teams, to
--    avoid confusion with the pre-existing, unrelated announcement_team
--    enum (Health/Term).
CREATE TABLE "org_teams" (
    "id" serial PRIMARY KEY NOT NULL,
    "name" text NOT NULL,
    "description" text,
    "active" boolean DEFAULT true NOT NULL,
    "created_by" text NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "org_teams_name_unique" ON "org_teams" USING btree ("name");
--> statement-breakpoint

-- 3. roles (Advisor / Mentor / Guide / ... — job function, independent of
--    tier and of qa_dashboard_roles).
CREATE TABLE "roles" (
    "id" serial PRIMARY KEY NOT NULL,
    "name" text NOT NULL,
    "description" text,
    "active" boolean DEFAULT true NOT NULL,
    "created_by" text NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "roles_name_unique" ON "roles" USING btree ("name");
--> statement-breakpoint

-- 4. relationship_types (Mentor / Guide / ... — the vocabulary usable in
--    user_relationships below).
CREATE TABLE "relationship_types" (
    "id" serial PRIMARY KEY NOT NULL,
    "name" text NOT NULL,
    "description" text,
    "active" boolean DEFAULT true NOT NULL,
    "created_by" text NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "relationship_types_name_unique" ON "relationship_types" USING btree ("name");
--> statement-breakpoint

-- 5. user_relationships (owner -> subject, e.g. mentor -> mentee).
CREATE TABLE "user_relationships" (
    "id" serial PRIMARY KEY NOT NULL,
    "owner_email" varchar(320) NOT NULL,
    "subject_email" varchar(320) NOT NULL,
    "relationship_type_id" integer NOT NULL,
    "created_by" text NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_relationships" ADD CONSTRAINT "user_relationships_owner_email_users_email_fk"
    FOREIGN KEY ("owner_email") REFERENCES "public"."users"("email")
    ON DELETE CASCADE ON UPDATE NO ACTION;
--> statement-breakpoint
ALTER TABLE "user_relationships" ADD CONSTRAINT "user_relationships_subject_email_users_email_fk"
    FOREIGN KEY ("subject_email") REFERENCES "public"."users"("email")
    ON DELETE CASCADE ON UPDATE NO ACTION;
--> statement-breakpoint
ALTER TABLE "user_relationships" ADD CONSTRAINT "user_relationships_relationship_type_id_relationship_types_id_fk"
    FOREIGN KEY ("relationship_type_id") REFERENCES "public"."relationship_types"("id")
    ON DELETE RESTRICT ON UPDATE NO ACTION;
--> statement-breakpoint
CREATE UNIQUE INDEX "user_relationships_triple_unique" ON "user_relationships" USING btree ("owner_email", "subject_email", "relationship_type_id");
--> statement-breakpoint

-- 6. custom_access_grants (per-individual, add-only access override).
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
ALTER TABLE "custom_access_grants" ADD CONSTRAINT "custom_access_grants_user_email_users_email_fk"
    FOREIGN KEY ("user_email") REFERENCES "public"."users"("email")
    ON DELETE CASCADE ON UPDATE NO ACTION;
--> statement-breakpoint
CREATE UNIQUE INDEX "custom_access_grants_triple_unique" ON "custom_access_grants" USING btree ("user_email", "grant_type", "target_id");
--> statement-breakpoint

-- 7. New nullable FK columns on users.
ALTER TABLE "users" ADD COLUMN "org_team_id" integer;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "role_id" integer;
--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_org_team_id_org_teams_id_fk"
    FOREIGN KEY ("org_team_id") REFERENCES "public"."org_teams"("id")
    ON DELETE SET NULL ON UPDATE NO ACTION;
--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_role_id_roles_id_fk"
    FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id")
    ON DELETE SET NULL ON UPDATE NO ACTION;
--> statement-breakpoint

-- 8. Convenience starting catalog rows. All editable/removable afterward
--    (deactivate, not delete) from Access Control Center. "system" as
--    created_by since these are seeded by the migration itself, not a
--    specific Developer's action.
INSERT INTO "org_teams" ("name", "description", "created_by") VALUES
    ('Bliss', NULL, 'system (migration 0038)'),
    ('Falcon', NULL, 'system (migration 0038)'),
    ('Central', 'Oversees Bliss and Falcon operations.', 'system (migration 0038)');
--> statement-breakpoint

INSERT INTO "relationship_types" ("name", "description", "created_by") VALUES
    ('Mentor', NULL, 'system (migration 0038)'),
    ('Guide', NULL, 'system (migration 0038)');
--> statement-breakpoint

INSERT INTO "roles" ("name", "description", "created_by") VALUES
    ('Advisor', NULL, 'system (migration 0038)'),
    ('Mentor', NULL, 'system (migration 0038)'),
    ('Guide', NULL, 'system (migration 0038)');
