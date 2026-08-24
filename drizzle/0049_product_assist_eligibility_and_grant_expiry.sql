-- Wire the Access Control Center's Department/Team/Role catalogs into
-- Product Assist eligibility, and add optional expiry to extra-credit
-- grants (2026-08). Purely additive/nullable — no existing row's meaning
-- changes. See schema.ts's doc comments on product_assist_quota_settings
-- and product_assist_extra_credit_grants for the full reasoning.

-- 1. Which Department/Team/Role combination (plus the Health tag, checked
--    in application code, not here) makes a user eligible for the
--    Health-Advisor allocation. Nullable and unset by default — until a
--    Developer/Platform Admin picks all three in "AI Usage & Limits", no
--    user is upgraded into the health_advisor bucket by this rule (falls
--    back to Developer-unlimited or trial exactly as before this
--    migration). Deliberately configuration (DB rows an admin picks), not
--    hardcoded name strings, so a future department/team/role rename never
--    silently breaks eligibility.
ALTER TABLE "product_assist_quota_settings" ADD COLUMN "eligible_department_id" integer;
--> statement-breakpoint
ALTER TABLE "product_assist_quota_settings" ADD COLUMN "eligible_org_team_id" integer;
--> statement-breakpoint
ALTER TABLE "product_assist_quota_settings" ADD COLUMN "eligible_role_id" integer;
--> statement-breakpoint
ALTER TABLE "product_assist_quota_settings" ADD CONSTRAINT "product_assist_quota_settings_eligible_department_id_departments_id_fk"
    FOREIGN KEY ("eligible_department_id") REFERENCES "public"."departments"("id")
    ON DELETE SET NULL ON UPDATE NO ACTION;
--> statement-breakpoint
ALTER TABLE "product_assist_quota_settings" ADD CONSTRAINT "product_assist_quota_settings_eligible_org_team_id_org_teams_id_fk"
    FOREIGN KEY ("eligible_org_team_id") REFERENCES "public"."org_teams"("id")
    ON DELETE SET NULL ON UPDATE NO ACTION;
--> statement-breakpoint
ALTER TABLE "product_assist_quota_settings" ADD CONSTRAINT "product_assist_quota_settings_eligible_role_id_roles_id_fk"
    FOREIGN KEY ("eligible_role_id") REFERENCES "public"."roles"("id")
    ON DELETE SET NULL ON UPDATE NO ACTION;
--> statement-breakpoint

-- 2. Optional expiry on extra-credit grants. Null = never expires (the
--    existing, unchanged default behavior for every grant made before this
--    migration and every grant made afterward unless an admin sets one).
ALTER TABLE "product_assist_extra_credit_grants" ADD COLUMN "expires_at" timestamp with time zone;
--> statement-breakpoint

-- 3. Convenience "Advisory" department row, matching migration 0038's
--    precedent of seeding Bliss/Falcon/Central as a starting catalog entry
--    (editable/deactivatable afterward from Access Control Center, never
--    hardcoded elsewhere). Departments had no seed data before this
--    migration; Section 7's eligibility rule needs one to exist for a
--    Developer to pick in the new Settings dropdown.
INSERT INTO "departments" ("name", "description", "created_by") VALUES
    ('Advisory', 'Advisors who handle customer-facing declaration and product questions.', 'system (migration 0049)')
ON CONFLICT (name) DO NOTHING;
