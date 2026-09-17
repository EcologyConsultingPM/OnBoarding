-- Adds an explicit start date to manually assigned operational tasks.
-- Project activities already carry their own start and due dates; this makes
-- non-project work equally visible and proportionate in the Capacity Planner.

alter table public.remote_tasks
  add column if not exists start_date date;

create index if not exists remote_tasks_capacity_dates_idx
  on public.remote_tasks (assigned_to, start_date, due_date)
  where status not in ('complete', 'withdrawn', 'declined');
