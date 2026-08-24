-- Rename "Ditto Constitution" -> "Org Constitution" (2026-08).
--
-- Data-only rename, scoped as tightly as possible: only touches a "general"
-- category literally named "Ditto Constitution" today, so this is a no-op
-- (zero rows affected) rather than an error if that row was already renamed
-- or never existed under that exact name. Purely a display-label change —
-- matching logic elsewhere keys off "type" = 'general', never off this name,
-- so nothing else needs to change alongside it.

UPDATE "kb_categories" SET "name" = 'Org Constitution' WHERE "type" = 'general' AND "name" = 'Ditto Constitution';
