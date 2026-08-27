-- Project activity calendar support
-- Additive review migration: preserves every existing activity and leaves
-- existing records without a calendar date until an administrator sets one.

begin;

alter table public.project_activities
  add column if not exists due_date date;

create index if not exists project_activities_staff_due_date_lookup
  on public.project_activities (staff_user_id, due_date)
  where due_date is not null;

commit;

-- Rollback plan (execute only if this release must be reverted):
-- begin;
-- drop index if exists public.project_activities_staff_due_date_lookup;
-- alter table public.project_activities drop column if exists due_date;
-- commit;
