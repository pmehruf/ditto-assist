-- team — which advisor audience an announcement is targeted at.
--
-- Health Advisors see only "Health" announcements, Term Advisors see only
-- "Term" announcements; everyone else (advisorRole null/"Both advisor"/
-- "Manager") sees both. NOT NULL DEFAULT 'Health' both sets the default for
-- future rows AND retroactively backfills every existing announcement to
-- "Health" in the same statement, per spec ("Term" is a future addition with
-- no announcements yet, so there is nothing to backfill as "Term").

CREATE TYPE "announcement_team" AS ENUM ('Health', 'Term');
--> statement-breakpoint
ALTER TABLE "announcements" ADD COLUMN "team" "announcement_team" NOT NULL DEFAULT 'Health';
