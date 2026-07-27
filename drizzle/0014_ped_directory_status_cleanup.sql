-- PED Directory: remove status/administrative/test-result phrasing that
-- isn't itself a medical condition, diagnosis, or procedure. Continuation
-- of 0013_ped_directory_cleanup.sql's standardization pass, scoped to the
-- admin's follow-up review of 6 borderline rows.
--
-- "Pregnant" (#931) is deliberately NOT touched here: it's matched by the
-- "natural life stage" firewall regex in src/engine.ts (nonAilmentRegex,
-- and the two hardcoded NON_AILMENT-style term lists) that routes
-- pregnancy-related declarations away from PED matching. ped_directory is
-- decoupled from the matching engine, but keeping "Pregnant" here means an
-- advisor who types it gets the exact literal string the firewall expects,
-- so removing it would only create a gap, not a cleanup win.

-- 1. "Cystoscopy done" is a status phrase ("done") layered on the actual
--    procedure. Add the bare procedure name first (it did not already
--    exist as its own row) so the concept isn't lost, then drop the
--    administrative phrasing.
INSERT INTO "ped_directory" ("term", "category", "added_by")
VALUES ('Cystoscopy', 'kidney', 'System (cleanup)')
ON CONFLICT ("term") DO NOTHING;
--> statement-breakpoint

-- 2. "HIV positive" is a test result, not the diagnosis itself. The
--    canonical condition "HIV infection" (#498) already exists but was
--    left uncategorized at seed time — promote it to the 'hiv' category
--    that "HIV positive" carried, so the mapping isn't lost when that row
--    is deleted below.
UPDATE "ped_directory" SET "category" = 'hiv' WHERE "term" = 'HIV infection' AND "category" IS NULL;
--> statement-breakpoint

-- 3. Delete the status/administrative/test-result rows. In each case the
--    actual condition or procedure remains searchable under its own name:
--      Dialysis patient   -> Dialysis (#333) already exists
--      Cystoscopy done    -> Cystoscopy (inserted above)
--      HIV positive       -> HIV infection (#498, now categorized 'hiv')
--    "Breast clinic evaluation", "HIV negative", "Positive HIV test", and
--    "Routine general checkup" describe a visit/test outcome/administrative
--    check, not a condition, so they're removed with no replacement.
DELETE FROM "ped_directory" WHERE "term" = 'Dialysis patient';
--> statement-breakpoint
DELETE FROM "ped_directory" WHERE "term" = 'Cystoscopy done';
--> statement-breakpoint
DELETE FROM "ped_directory" WHERE "term" = 'Breast clinic evaluation';
--> statement-breakpoint
DELETE FROM "ped_directory" WHERE "term" = 'HIV negative';
--> statement-breakpoint
DELETE FROM "ped_directory" WHERE "term" = 'HIV positive';
--> statement-breakpoint
DELETE FROM "ped_directory" WHERE "term" = 'Positive HIV test';
--> statement-breakpoint
DELETE FROM "ped_directory" WHERE "term" = 'Routine general checkup';
