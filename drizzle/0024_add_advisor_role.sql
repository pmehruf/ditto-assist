-- advisor_role — Health advisor / Term advisor / Both advisor / Manager.
--
-- Deliberately NOT live-joined from the QA Google Sheet the way the User
-- Management directory's earlier "Skill Domain" column was (see
-- getSkillDomainByTactIdMap in qaDashboardService.ts, still used only by
-- the one-time backfill script below) — that field needed to become
-- directly editable (Admin/Developer assign it, including "Manager" which
-- has no equivalent in the sheet at all), so it has to be real, persisted
-- state on this app's own users table, not a read-through of someone else's
-- spreadsheet. Nullable/unassigned by default; scripts/backfillAdvisorRole.ts
-- does a ONE-TIME seed of "Health advisor"/"Term advisor"/"Both advisor" for
-- existing users from the sheet's current Health/Term/Both column, after
-- which this column is manually managed going forward.

ALTER TABLE "users" ADD COLUMN "advisor_role" text;
