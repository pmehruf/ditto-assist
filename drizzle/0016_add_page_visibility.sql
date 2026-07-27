-- page_visibility — Owner-only show/hide switch per page.
--
-- One row per featurePermissions id, one boolean. Not a permissions system:
-- tiers and the featurePermissions registry still decide who MAY use a page.
-- This only records whether a page is currently shown at all, so the Owner
-- can hide in-progress work from other users.
--
-- No row = visible, so new pages default to shown and nothing needs seeding.
-- Purely additive: no existing table is read, written, or altered.

CREATE TABLE IF NOT EXISTS "page_visibility" (
  "feature_id" text PRIMARY KEY NOT NULL,
  "hidden" boolean DEFAULT false NOT NULL,
  "updated_by" text,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
