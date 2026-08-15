-- kb_chat_sessions.category_id / plan_tags — Query Assist sessions remember
-- their insurer + plan scope (chosen once when the advisor starts a
-- question) so every follow-up turn in the same multi-turn conversation
-- stays scoped to the same category/plan without re-asking. NULL
-- category_id = a "General" session (not tied to any one insurer).

ALTER TABLE "kb_chat_sessions" ADD COLUMN "category_id" integer REFERENCES "kb_categories"("id") ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE "kb_chat_sessions" ADD COLUMN "plan_tags" text[] NOT NULL DEFAULT '{}';
