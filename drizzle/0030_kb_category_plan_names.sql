-- kb_categories.plan_names — the curated list of plan names an admin
-- maintains per insurer category, so tagging a resource (kb_resources.
-- plan_tags, 0029) offers real suggestions to click instead of free-typing
-- every time. Free-form text[] (same pattern as users.tags / kb_resources.
-- plan_tags) since insurers sell plans beyond this app's 6 deterministic-
-- engine plans. Only meaningful for type='insurer' categories.

ALTER TABLE "kb_categories" ADD COLUMN "plan_names" text[] NOT NULL DEFAULT '{}';
