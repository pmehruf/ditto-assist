-- Adds "Product Announcement" and "Insurance Operations" values to
-- announcement_type, replacing "General Announcement" as the two
-- selectable non-QA announcement types in the Announcement Manager (their
-- department is now encoded directly by the type, not a free-text "From"
-- field). "General Announcement" itself stays in the enum (Postgres can't
-- drop enum values in place, and existing rows may still carry it — see
-- migration 0056, which reclassifies whichever ones it can).
-- ALTER TYPE ... ADD VALUE cannot run inside the same transaction as a
-- later statement that USES the new value, but this migration only adds
-- the values (no data touched), so both statements together are safe.

ALTER TYPE "public"."announcement_type" ADD VALUE 'Product Announcement';--> statement-breakpoint
ALTER TYPE "public"."announcement_type" ADD VALUE 'Insurance Operations';
