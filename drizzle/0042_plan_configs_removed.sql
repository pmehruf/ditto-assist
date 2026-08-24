-- Adds a genuine "removed" flag to plan_configs, distinct from `disabled`.
-- `disabled` is temporary/visible (advisors see a note, plan still listed);
-- `removed` is what the Plan Management "Delete" action now writes for
-- EVERY plan, including the 4 built-in ones (Optima Secure, Care Supreme,
-- Activ One Max, Activ Fit Preferred) that previously had no DB row at all
-- to delete, and therefore no Delete button. A plan_configs row can now
-- exist purely to record "this name is removed" — even for a plan whose
-- content still lives in the hardcoded getPlanConfig() bootstrap seed in
-- types.ts, that seed is suppressed everywhere once removed=true here.
ALTER TABLE "plan_configs" ADD COLUMN IF NOT EXISTS "removed" boolean DEFAULT false NOT NULL;
