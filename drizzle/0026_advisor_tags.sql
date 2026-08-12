-- tags — replaces the single-value advisor_role column with a proper
-- multi-select set of skill-domain tags ("Health" and/or "Term").
--
-- Rationale: advisor_role could only ever hold ONE of "Health advisor" /
-- "Term advisor" / "Both advisor" / "Manager" at a time, which meant "I do
-- both Health and Term" or "I'm a Manager who covers both" had to be
-- encoded as a single special-cased label instead of the two independent
-- facts they actually are. Replacing it with a text[] column lets a user
-- hold either tag, both, or neither, chosen via a real multi-select (User
-- Management's edit row, and the new "Skill Domain" section on first-time
-- setup) instead of a single dropdown.
--
-- Backfill mapping (old advisor_role -> new tags):
--   'Health advisor'          -> {Health}
--   'Term advisor'            -> {Term}
--   'Both advisor', 'Manager' -> {Health,Term}  (per spec: both roles that
--                                 previously implied "sees/handles both"
--                                 domains now hold both tags explicitly)
--   NULL (unassigned)         -> {}              (still unassigned; a truly
--                                 tag-less user continues to see/handle
--                                 both domains by absence of restriction,
--                                 same effective behavior as before)

ALTER TABLE "users" ADD COLUMN "tags" text[] NOT NULL DEFAULT '{}';

UPDATE "users" SET "tags" = CASE
  WHEN "advisor_role" = 'Health advisor' THEN ARRAY['Health']
  WHEN "advisor_role" = 'Term advisor' THEN ARRAY['Term']
  WHEN "advisor_role" IN ('Both advisor', 'Manager') THEN ARRAY['Health', 'Term']
  ELSE '{}'::text[]
END;

ALTER TABLE "users" DROP COLUMN "advisor_role";
