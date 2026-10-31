-- ROLLBACK for 0090_playbook_mirror (staging only, run by hand only if Step 2 must be undone).
-- Removes ONLY objects created by 0090. Touches nothing else. Run in one transaction.
-- Afterwards the migration bookkeeping row must also be removed, otherwise the runner
-- believes 0090 is applied:  DELETE FROM drizzle.__drizzle_migrations WHERE created_at = 1792400000000;
BEGIN;
DROP TRIGGER IF EXISTS "playbook_published_guard" ON "playbook_published";
DROP TRIGGER IF EXISTS "playbook_snapshot_tabs_no_update" ON "playbook_snapshot_tabs";
DROP TRIGGER IF EXISTS "playbook_cells_no_update" ON "playbook_cells";
DROP TRIGGER IF EXISTS "playbook_snapshots_guard_delete" ON "playbook_snapshots";
DROP TRIGGER IF EXISTS "playbook_snapshots_guard_update" ON "playbook_snapshots";
DROP TABLE IF EXISTS "playbook_source_issues";
DROP TABLE IF EXISTS "playbook_sync_state";
DROP TABLE IF EXISTS "playbook_published";
DROP TABLE IF EXISTS "playbook_features";
DROP TABLE IF EXISTS "playbook_plans";
DROP TABLE IF EXISTS "playbook_cells";
DROP TABLE IF EXISTS "playbook_snapshot_tabs";
DROP TABLE IF EXISTS "playbook_snapshots";
DROP TABLE IF EXISTS "playbook_mirror_connection";
DROP FUNCTION IF EXISTS "playbook_published_guard"();
DROP FUNCTION IF EXISTS "playbook_write_once_guard"();
DROP FUNCTION IF EXISTS "playbook_snapshots_guard_delete"();
DROP FUNCTION IF EXISTS "playbook_snapshots_guard_update"();
DROP TYPE IF EXISTS "playbook_issue_status";
DROP TYPE IF EXISTS "playbook_issue_kind";
DROP TYPE IF EXISTS "playbook_plan_status";
DROP TYPE IF EXISTS "playbook_value_kind";
DROP TYPE IF EXISTS "playbook_snapshot_status";
COMMIT;
