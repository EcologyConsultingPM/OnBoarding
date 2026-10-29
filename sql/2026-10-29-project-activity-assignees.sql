-- Ecology Consulting Portal
-- Multi-staff Work Activity assignments. This is additive: project_activities
-- keeps its legacy scalar staff_user_id and lifecycle columns for compatibility
-- with older clients while recipient-specific workflow state lives here.

begin;

create table if not exists public.project_activity_assignees (
  id uuid primary key default gen_random_uuid(),
  activity_id uuid not null references public.project_activities(id) on delete cascade,
  staff_user_id uuid not null references auth.users(id) on delete cascade,
  allocated_hours numeric(10,2) not null default 0 check (allocated_hours >= 0),
  role text not null default 'contributor' check (length(trim(role)) > 0),
  acceptance_status text not null default 'awaiting_response'
    check (acceptance_status in ('awaiting_response', 'accepted', 'declined', 'actioned', 'removed')),
  response_note text,
  assigned_at timestamptz,
  accepted_at timestamptz,
  declined_at timestamptz,
  actioned_at timestamptz,
  assigned_by uuid references auth.users(id),
  notified_at timestamptz,
  removed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (activity_id, staff_user_id)
);

create index if not exists project_activity_assignees_activity_idx
  on public.project_activity_assignees (activity_id, acceptance_status);
create index if not exists project_activity_assignees_staff_active_idx
  on public.project_activity_assignees (staff_user_id, acceptance_status, assigned_at desc)
  where acceptance_status <> 'removed';
create index if not exists project_activity_assignees_pending_notification_idx
  on public.project_activity_assignees (activity_id, notified_at)
  where acceptance_status <> 'removed' and notified_at is null;

-- Project activity lifecycle data predates the join table. Seed exactly one
-- recipient row for each scalar assignment, retaining the original response
-- status/timestamps rather than putting operational history back into a queue.
insert into public.project_activity_assignees (
  activity_id,
  staff_user_id,
  allocated_hours,
  role,
  acceptance_status,
  response_note,
  assigned_at,
  accepted_at,
  declined_at,
  actioned_at,
  assigned_by,
  notified_at,
  created_at,
  updated_at
)
select
  activity.id,
  activity.staff_user_id,
  greatest(0, coalesce(activity.budget_hours, 0)),
  'contributor',
  coalesce(activity.acceptance_status, 'accepted'),
  activity.response_note,
  activity.assigned_at,
  activity.accepted_at,
  activity.declined_at,
  activity.actioned_at,
  activity.assigned_by,
  activity.notified_at,
  coalesce(activity.created_at, now()),
  coalesce(activity.updated_at, activity.created_at, now())
from public.project_activities activity
where activity.staff_user_id is not null
on conflict (activity_id, staff_user_id) do nothing;

-- Service routes own all access; deliberately create no direct RLS policy.
alter table public.project_activity_assignees enable row level security;

select pg_notify('pgrst', 'reload schema') as schema_cache_refreshed;

commit;
