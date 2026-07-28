-- PED repository governance rules (2026-07-28) — see Checkpoint B decisions:
-- repository must contain only professional medical terminology (no
-- action-verb phrases, no visible misspellings), with hidden normalization
-- aliases still supporting forgiving search. Purely additive: no existing
-- column is dropped or narrowed.
--
-- Written by hand, matching this project's established convention for
-- 0009-0017 (drizzle-kit generate misbehaves against this repo's
-- drizzle/meta/ snapshot gap).

ALTER TABLE "ped_aliases" ADD COLUMN IF NOT EXISTS "is_visible" boolean DEFAULT true NOT NULL;
