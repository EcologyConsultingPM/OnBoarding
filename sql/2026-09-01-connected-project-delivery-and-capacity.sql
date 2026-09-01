-- Ecology Consulting Portal
-- Connected Projects & Operations delivery workflow and Staff Capacity Planner
--
-- Additive review migration. Existing projects, activities, schedules,
-- tracker entries, leave requests and financial allocations are retained.
-- No existing staff allocation is moved back into an awaiting-response state.

begin;

-- The prior calendar migration may not have been applied in every environment.
alter table public.project_activities
  add column if not exists due_date date,
  add column if not exists schedule_item_id uuid references public.project_schedule_items(id) on delete set null,
  add column if not exists acceptance_status text not null default 'accepted',
  add column if not exists response_note text,
  add column if not exists assigned_at timestamptz,
  add column if not exists accepted_at timestamptz,
  add column if not exists declined_at timestamptz,
  add column if not exists actioned_at timestamptz,
  add column if not exists started_at timestamptz,
  add column if not exists completed_at timestamptz,
  add column if not exists assigned_by uuid references auth.users(id),
  add column if not exists progress_percent numeric(5,2) not null default 0,
  add column if not exists locked boolean not null default false,
  add column if not exists is_active boolean not null default true;

-- Existing activity assignments are treated as accepted operational records;
-- all newly created activities begin in the staff response queue.
alter table public.project_activities
  alter column acceptance_status set default 'awaiting_response';

update public.project_activities
set assigned_at = coalesce(assigned_at, created_at),
    assigned_by = coalesce(assigned_by, created_by),
    accepted_at = case
      when acceptance_status = 'accepted' and staff_user_id is not null
        then coalesce(accepted_at, created_at)
      else accepted_at
    end,
    progress_percent = case
      when status = 'completed' then 100
      else greatest(0, least(100, coalesce(progress_percent, 0)))
    end
where assigned_at is null
   or assigned_by is null
   or (status = 'completed' and progress_percent <> 100);

alter table public.project_activities
  drop constraint if exists project_activities_acceptance_status_check;
alter table public.project_activities
  add constraint project_activities_acceptance_status_check
  check (acceptance_status in ('awaiting_response', 'accepted', 'declined', 'actioned'));

alter table public.project_activities
  drop constraint if exists project_activities_progress_percent_check;
alter table public.project_activities
  add constraint project_activities_progress_percent_check
  check (progress_percent >= 0 and progress_percent <= 100);

create index if not exists project_activities_staff_response_due_idx
  on public.project_activities (staff_user_id, acceptance_status, due_date)
  where staff_user_id is not null;
create index if not exists project_activities_schedule_item_idx
  on public.project_activities (schedule_item_id)
  where schedule_item_id is not null;
create index if not exists project_activities_active_project_idx
  on public.project_activities (project_id, sort_order)
  where is_active = true;

alter table public.project_schedule_items
  add column if not exists progress_percent numeric(5,2) not null default 0,
  add column if not exists status text not null default 'not_commenced',
  add column if not exists locked boolean not null default false,
  add column if not exists is_active boolean not null default true;

update public.project_schedule_items
set progress_percent = greatest(0, least(100, coalesce(progress_percent, 0)))
where progress_percent < 0 or progress_percent > 100;

alter table public.project_schedule_items
  drop constraint if exists project_schedule_items_progress_percent_check;
alter table public.project_schedule_items
  add constraint project_schedule_items_progress_percent_check
  check (progress_percent >= 0 and progress_percent <= 100);
alter table public.project_schedule_items
  drop constraint if exists project_schedule_items_status_check;
alter table public.project_schedule_items
  add constraint project_schedule_items_status_check
  check (status in ('not_commenced', 'active', 'need_info', 'paused_other', 'qa_review', 'completed'));

alter table public.project_tracker_entries
  add column if not exists activity_id uuid references public.project_activities(id) on delete set null;

alter table public.project_tracker_entries
  drop constraint if exists project_tracker_entries_status_check;
alter table public.project_tracker_entries
  add constraint project_tracker_entries_status_check
  check (status in ('not_commenced', 'active', 'need_info', 'paused_other', 'qa_review', 'completed'));

create index if not exists project_tracker_entries_activity_idx
  on public.project_tracker_entries (activity_id, created_at desc)
  where activity_id is not null;

-- Capacity is intentionally held in a separate controlled profile table rather
-- than inside authentication metadata. It supplies a 38-hour weekly default
-- and can be overridden for each staff member by a capacity planner editor.
create table if not exists public.staff_capacity_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  weekly_capacity_hours numeric(6,2) not null default 38 check (weekly_capacity_hours >= 0 and weekly_capacity_hours <= 168),
  notes text,
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

alter table public.staff_capacity_profiles enable row level security;
drop policy if exists staff_capacity_profiles_direct_access on public.staff_capacity_profiles;

-- Capacity Planner permissions are modelled as two controlled sub-resources:
-- view grants the read-only planner; edit grants allocation/capacity changes.
alter table public.portal_visibility_overrides
  drop constraint if exists portal_visibility_overrides_resource_key_check;
alter table public.portal_visibility_overrides
  add constraint portal_visibility_overrides_resource_key_check
  check (resource_key in (
    'staff.projects',
    'staff.notifications',
    'staff.projects.activities',
    'staff.projects.tracker',
    'staff.projects.service_requests',
    'staff.timesheets',
    'staff.forms',
    'staff.forms.governance',
    'staff.learning',
    'staff.species',
    'staff.remote_operations',
    'staff.onboarding',
    'admin.projects',
    'admin.projects.setup',
    'admin.projects.tracker',
    'admin.projects.health',
    'admin.projects.capacity',
    'admin.projects.capacity.edit',
    'admin.quote_pipeline',
    'admin.quote_pipeline.financials',
    'admin.remote_operations',
    'admin.whs',
    'admin.whs_monitoring',
    'admin.internal_governance',
    'admin.service_requests',
    'admin.learning',
    'admin.species',
    'admin.regulatory_watch',
    'admin.portal_management'
  ));

select pg_notify('pgrst', 'reload schema') as schema_cache_refreshed;

commit;

-- Rollback guidance (use only after a controlled data review):
-- The migration deliberately does not drop columns/tables automatically because
-- activity responses and capacity settings become auditable operational records.
