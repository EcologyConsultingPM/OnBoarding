-- Explicit unknown planned effort; existing numeric values and semantics remain.
-- No data backfill, numeric nullability changes, or constraint changes.
ALTER TABLE public.project_activities
  ADD COLUMN IF NOT EXISTS budget_hours_tbc boolean NOT NULL DEFAULT false;

ALTER TABLE public.project_activity_assignees
  ADD COLUMN IF NOT EXISTS allocated_hours_tbc boolean NOT NULL DEFAULT false;
