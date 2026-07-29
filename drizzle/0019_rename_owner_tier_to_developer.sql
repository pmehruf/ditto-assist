-- Renames the "Owner" access tier to "Developer" (UI/naming change only —
-- no permission or RBAC behavior changes). This is a pure enum LABEL rename:
-- every existing users.tier = 'Owner' row is automatically read back as
-- 'Developer' afterward, with no UPDATE/backfill needed and no risk of
-- missing a row.
--
-- change_logs.role is a free-text varchar, not this enum, so historical
-- audit rows that recorded role = 'Owner' at the time of a past action are
-- intentionally left untouched here (see AuditPage.tsx, which still
-- recognizes both "Owner" and "Developer" for display purposes).

ALTER TYPE "public"."user_tier" RENAME VALUE 'Owner' TO 'Developer';
