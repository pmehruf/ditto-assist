-- qa_dashboard_google_connection — single-row table holding the QA
-- Dashboard's stored Google OAuth grant (an encrypted refresh token), so
-- the app can read the QA team's Sheet read-only as whoever clicked
-- "Connect Google Sheets" in Developer Controls, without a Workspace admin
-- action or a service account. See src/server/qaDashboard/tokenCrypto.ts —
-- the refresh token is encrypted before it ever reaches this table.
--
-- Purely additive: no existing table is read, written, or altered.

CREATE TABLE IF NOT EXISTS "qa_dashboard_google_connection" (
  "id" text PRIMARY KEY NOT NULL DEFAULT 'default',
  "connected_email" text NOT NULL,
  "encrypted_refresh_token" text NOT NULL,
  "connected_by" text NOT NULL,
  "connected_at" timestamp with time zone DEFAULT now() NOT NULL
);
