-- Platform Admin as an independently configurable Feature Access tier
-- (2026-08). Until now feature_access_overrides only carried generalAccess
-- and adminAccess; Platform Admin bypassed feature-level access evaluation
-- entirely (see App.tsx's hasAccess() / server.ts's requireFeatureAccess(),
-- both updated alongside this migration). Purely additive/nullable — no
-- existing row's meaning changes, and every existing Platform Admin keeps
-- byte-for-byte identical access immediately after this migration runs: the
-- application layer treats an unset platform_admin_access the same way it
-- always resolved Platform Admin before this change (full Editor access),
-- until a Developer/Platform Admin explicitly narrows it per feature from
-- the Permissions tab.

ALTER TABLE "feature_access_overrides" ADD COLUMN "platform_admin_access" "feature_access_level";
