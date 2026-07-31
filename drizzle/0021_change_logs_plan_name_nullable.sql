-- change_logs.plan_name was NOT NULL, which only fits plan-specific action
-- types (e.g. "Draft Approved", "Insurer Edited"). Newer action types like
-- "Page Visibility Changed" have no associated plan and were failing to
-- write their audit-log entry with a not-null constraint violation. Make
-- the column nullable — existing rows are unaffected.

ALTER TABLE "change_logs" ALTER COLUMN "plan_name" DROP NOT NULL;
