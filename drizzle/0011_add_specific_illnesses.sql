-- Adds a per-plan Specific Illness List to plan_configs, mirroring how
-- `questions` already stores the Declaration Questions for the Add/Edit
-- Plan wizard. Array of { category?: string, illness: string }, defaulting
-- to an empty list so every existing row backfills cleanly with no data
-- migration needed. Read by the client-side specific-illness matching
-- engine (checkIllnessInPlanSpecificList / matchesPhrase in
-- specificIllnessEngine.ts) to flag a looked-up PED as "Specific Illness"
-- for a plan whose admin has populated this list, additively alongside the
-- legacy hardcoded MASTER_ILLNESSES catalog (never replacing it).
ALTER TABLE "plan_configs" ADD COLUMN "specific_illnesses" jsonb DEFAULT '[]'::jsonb NOT NULL;
