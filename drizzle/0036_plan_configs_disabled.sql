-- plan_configs.disabled / disabled_note — lets an admin take a plan out of
-- service for advisors (e.g. its questions/mapping engine logic is mid
-- rework) without deleting its configuration. /api/match refuses to run a
-- lookup against a disabled plan (see server.ts), and the declaration
-- dropdown (LookupPage.tsx) surfaces disabled_note to the advisor once they
-- select it, sourced from the Declaration Assistant Control page (formerly
-- "Plan Management").
--
-- Both default to their "not disabled" state so every existing plan stays
-- exactly as usable as it is today — this migration changes no row's
-- meaning, only adds a column new/edited plans can set going forward.

ALTER TABLE "plan_configs" ADD COLUMN "disabled" boolean NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE "plan_configs" ADD COLUMN "disabled_note" text;
