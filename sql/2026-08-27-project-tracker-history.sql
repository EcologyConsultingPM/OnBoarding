-- Ecology Consulting Portal
-- Staff project tracker history
--
-- Records each approved status change made through the protected my-activities API.
-- This supports a staff-only Timesheets domain showing true tracker-entry history,
-- rather than presenting only the current status of project activities.

begin;

create table if not exists public.project_activity_history (
  id uuid primary key default gen_random_uuid(),
  activity_id uuid not null references public.project_activities(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  staff_user_id uuid not null references auth.users(id) on delete cascade,
  previous_status text,
  new_status text not null,
  note text,
  changed_by uuid not null references auth.users(id),
  changed_at timestamptz not null default now()
);

create index if not exists project_activity_history_staff_changed_idx
  on public.project_activity_history (staff_user_id, changed_at desc);

create index if not exists project_activity_history_activity_changed_idx
  on public.project_activity_history (activity_id, changed_at desc);

-- Seed one baseline record for each existing activity, so the staff Timesheets
-- domain has a useful tracker record immediately after the migration. The NOT
-- EXISTS condition makes this safe if deployment tooling re-runs the migration.
insert into public.project_activity_history (
  activity_id, project_id, staff_user_id, previous_status, new_status, note, changed_by, changed_at
)
select
  activity.id,
  activity.project_id,
  activity.staff_user_id,
  null,
  activity.status,
  coalesce(activity.pause_reason, 'Baseline tracker state recorded when history was enabled.'),
  activity.created_by,
  coalesce(activity.updated_at, activity.created_at, now())
from public.project_activities activity
where activity.staff_user_id is not null
  and not exists (
    select 1
    from public.project_activity_history history
    where history.activity_id = activity.id
  );

alter table public.project_activity_history enable row level security;

-- Staff can read only their own history; administrators retain portfolio visibility.
drop policy if exists project_activity_history_select_own_or_admin on public.project_activity_history;
create policy project_activity_history_select_own_or_admin
  on public.project_activity_history
  for select
  to authenticated
  using (staff_user_id = auth.uid() or is_admin());

-- The server-side API uses the service role and owns inserts. There is intentionally
-- no direct client insert/update/delete policy, which preserves the audit trail.

commit;
