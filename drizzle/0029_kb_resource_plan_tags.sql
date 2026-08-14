-- kb_resources.plan_tags — per-resource multi-plan tagging, requested
-- alongside the insurer-level category (e.g. "HDFC Ergo Add-ons.pdf" should
-- be surfaced for questions about ANY HDFC ERGO plan it covers, not locked
-- to a single plan via a dropdown). Mirrors the users.tags precedent
-- (0026_advisor_tags.sql): a free-form text[] rather than an enum, since a
-- resource can apply to zero (whole-insurer/general), one, or several
-- plans, and insurers sell plans beyond this app's 6 deterministic-engine
-- plans (e.g. "my:health Medisure"). Empty array = not plan-specific —
-- applies broadly within its category; the future "Ask the Playbook" query
-- endpoint should treat an empty-tags resource as always in scope for its
-- category regardless of which specific plan (if any) the advisor selected.

ALTER TABLE "kb_resources" ADD COLUMN "plan_tags" text[] NOT NULL DEFAULT '{}';
