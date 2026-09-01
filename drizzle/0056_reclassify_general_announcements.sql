-- Reclassifies existing "General Announcement" rows into the two new
-- dedicated types, based on their existing free-text from_team value —
-- per product decision, replacing General Announcement's "From" tag with
-- two real types (see QAAnnouncementForm.tsx's Type dropdown / migration
-- 0055). Must run as its OWN migration, after 0055 has committed — a
-- migration cannot ALTER TYPE ... ADD VALUE and then use that same value
-- in the same transaction.
--
-- Matching is a case-insensitive substring match against from_team:
--   - contains "product"   -> Product Announcement
--   - contains "operation" -> Insurance Operations
-- Checked in that order, so a from_team matching both (unlikely) becomes
-- Product Announcement. Any row that matches neither is left untouched as
-- "General Announcement" — still fully visible/manageable in the
-- Announcement Manager and the advisor-facing archive, just no longer
-- selectable when creating a NEW announcement.

UPDATE "announcements"
SET "type" = 'Product Announcement'
WHERE "type" = 'General Announcement' AND "from_team" ILIKE '%product%';--> statement-breakpoint
UPDATE "announcements"
SET "type" = 'Insurance Operations'
WHERE "type" = 'General Announcement' AND "from_team" ILIKE '%operation%';
