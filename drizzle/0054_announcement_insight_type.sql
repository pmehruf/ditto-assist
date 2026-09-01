-- Adds an "Insight" value to announcement_type, backing the new
-- Home Dashboard "Did you know!?" card content type (managed via the
-- Announcement Manager, see announcementsRepository.ts / server.ts).
-- Insights are informational-only: they force requiresAck=false at the
-- application layer and are excluded from the advisor-facing announcement
-- feed by default (see announcements.list's excludeTypes filter).
-- ALTER TYPE ... ADD VALUE cannot run inside the same transaction as a
-- later statement that uses the new value, but this migration only adds
-- the value (no data touched), so a single statement is safe.

ALTER TYPE "public"."announcement_type" ADD VALUE 'Insight';
