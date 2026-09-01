-- Adds a "Failed" status to coaching_actionable_status, alongside a new
-- status-update capability (see coachingRepository.ts's
-- updateActionableStatus). Actionables created via the Session Feedback
-- form still always start "Open" — only Feedback Summary's own status
-- control can move one along Open -> In Progress -> Completed/Failed.
-- ALTER TYPE ... ADD VALUE cannot run inside the same transaction as a
-- later statement that uses the new value, but this migration only adds
-- the value (no data touched), so a single statement is safe.

ALTER TYPE "public"."coaching_actionable_status" ADD VALUE 'Failed';
