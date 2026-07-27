-- Adds the smoke_test_peds table — Admin/Owner-added custom entries that
-- extend the Smoke Test page's hardcoded 50+ baseline PED list
-- (COMMON_SMOKE_TEST_PEDS in src/constants/commonSmokeTestPeds.ts). The
-- baseline list itself lives in code (it's a fixed regression list, not
-- admin-editable data); this table only holds the additional custom terms.
CREATE TABLE "smoke_test_peds" (
	"id" serial PRIMARY KEY NOT NULL,
	"term" text NOT NULL,
	"added_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
