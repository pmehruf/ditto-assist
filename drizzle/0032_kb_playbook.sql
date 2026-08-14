-- Product Playbook (Google Sheet) integration for "Ask the Playbook" /
-- Product Assist. Two purely-additive tables:
--
-- kb_playbook_connection — single-row table holding the Playbook Sheet's
-- stored Google OAuth grant (an encrypted refresh token), mirroring
-- qa_dashboard_google_connection (0020) but kept separate since the
-- Playbook Sheet has a different owner/account than the QA workbook — see
-- src/server/knowledgeBase/playbookTokenCrypto.ts for the at-rest
-- encryption (its own key salt, same SESSION_SECRET-derived scheme).
--
-- kb_playbook_plan_facts — one row per (insurer, plan) reshaped fact-sheet
-- parsed from the Playbook's per-insurer comparison tabs (Dittos
-- Recommended Policies + the per-insurer tabs). Always injected into the
-- Product Assist prompt in full when the advisor has that specific plan
-- selected — same "always inject, never similarity-retrieved" treatment as
-- kb_announcements — because this is the authoritative statement of which
-- specific sub-feature/variant applies to that plan, and partial retrieval
-- could silently drop the one line that matters. The Playbook's other,
-- narrative-shaped tabs (Recommendation specifics / FAQs & Narratives /
-- Feature Description) are embedded into the existing kb_chunks table
-- instead, tagged via the same kb_resources row — see
-- src/server/knowledgeBase/playbookIngest.ts.
--
-- Purely additive: no existing table is read, written, or altered.

CREATE TABLE IF NOT EXISTS "kb_playbook_connection" (
  "id" text PRIMARY KEY NOT NULL DEFAULT 'default',
  "connected_email" text NOT NULL,
  "encrypted_refresh_token" text NOT NULL,
  "connected_by" text NOT NULL,
  "connected_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "kb_playbook_plan_facts" (
  "id" serial PRIMARY KEY NOT NULL,
  "resource_id" integer NOT NULL REFERENCES "kb_resources"("id") ON DELETE CASCADE,
  "insurer_name" text NOT NULL,
  "plan_name" text NOT NULL,
  "source_tab" text NOT NULL,
  "content" text NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "kb_playbook_plan_facts_resource_id_idx" ON "kb_playbook_plan_facts" ("resource_id");
CREATE INDEX IF NOT EXISTS "kb_playbook_plan_facts_insurer_plan_idx" ON "kb_playbook_plan_facts" ("insurer_name", "plan_name");
