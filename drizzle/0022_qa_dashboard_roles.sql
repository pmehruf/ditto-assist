-- qa_dashboard_roles — the QA Dashboard's Admin/Guide/Mentor role
-- assignments, now managed from the WebApp's own User Directory & Management
-- page ("QA Dashboard Access" tab) instead of the QA_ADMIN_EMAILS /
-- QA_GUIDE_EMAILS / QA_MENTOR_EMAILS env vars (and their _NAME_MAP
-- counterparts). This is a one-time cutover: the INSERT below backfills the
-- exact membership those env vars held at the time of this migration, so
-- nobody's access changes as a result of switching the source of truth. The
-- env vars are no longer read by the app after this — safe to remove them
-- from .env / Cloud Run once this migration has run.

CREATE TYPE "public"."qa_dashboard_role" AS ENUM('admin', 'guide', 'mentor');--> statement-breakpoint
CREATE TABLE "qa_dashboard_roles" (
	"email" varchar(320) PRIMARY KEY NOT NULL,
	"role" "qa_dashboard_role" NOT NULL,
	"display_name" text,
	"assigned_by" text NOT NULL,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
INSERT INTO "qa_dashboard_roles" ("email", "role", "display_name", "assigned_by") VALUES
	('divya.jain@joinditto.in', 'admin', NULL, 'Migration (env var cutover)'),
	('mehruf.p@joinditto.in', 'admin', NULL, 'Migration (env var cutover)'),
	('nikita@joinditto.in', 'admin', NULL, 'Migration (env var cutover)'),
	('shashwat@joinditto.in', 'admin', NULL, 'Migration (env var cutover)'),
	('saurabh.maheshwari@joinditto.in', 'admin', NULL, 'Migration (env var cutover)'),
	('ankita.godshay@joinditto.in', 'guide', 'Ankita', 'Migration (env var cutover)'),
	('jigyasa.pathror@joinditto.in', 'guide', 'Jigyasa', 'Migration (env var cutover)'),
	('shreya.bhardwaj@joinditto.in', 'guide', 'Shreya', 'Migration (env var cutover)'),
	('waris.f@joinditto.in', 'guide', 'Waris', 'Migration (env var cutover)'),
	('akriti.gupta@joinditto.in', 'mentor', 'Akriti Gupta', 'Migration (env var cutover)'),
	('rakshita.j@joinditto.in', 'mentor', 'Rakshita Joshi', 'Migration (env var cutover)'),
	('harman.n@joinditto.in', 'mentor', 'Harman Singh Narula', 'Migration (env var cutover)'),
	('rishabh.aggarwal@joinditto.in', 'mentor', 'Rishabh N Aggarwal', 'Migration (env var cutover)'),
	('selvamuthan.r@joinditto.in', 'mentor', 'Selvamuthan R', 'Migration (env var cutover)'),
	('ayushi.vats@joinditto.in', 'mentor', 'Ayushi Vats', 'Migration (env var cutover)'),
	('vishaka.s@joinditto.in', 'mentor', 'Vishaka Sharma', 'Migration (env var cutover)'),
	('arvind.s@joinditto.in', 'mentor', 'Arvind Sinha', 'Migration (env var cutover)'),
	('anurag.mukherjee@joinditto.in', 'mentor', 'Anurag Mukherjee', 'Migration (env var cutover)')
ON CONFLICT ("email") DO NOTHING;
