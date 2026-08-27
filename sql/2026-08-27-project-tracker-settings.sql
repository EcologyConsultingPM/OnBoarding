-- Project Tracker Setup controls
-- Review-only migration. Do not apply until the associated server route and
-- staff visibility query are approved for a coordinated release.

begin;

-- Existing allocations become explicitly controllable without duplicating the
-- current project/team record. Existing records remain active by default.
alter table public.project_allocations
  add column if not exists active boolean not null default true,
  add column if not exists can_submit_entries boolean not null default true;

create index if not exists project_allocations_active_staff_lookup
  on public.project_allocations (staff_user_id, project_id)
  where active = true;

create table if not exists public.project_tracker_settings (
  project_id uuid primary key references public.projects(id) on delete cascade,
  tracker_visible boolean not null default false,
  resources_ready boolean not null default false,
  training_checked boolean not null default false,
  forms_configured boolean not null default false,
  whs_checked boolean not null default false,
  activated_by uuid references auth.users(id),
  activated_at timestamptz,
  updated_by uuid not null references auth.users(id),
  updated_at timestamptz not null default now()
);

create table if not exists public.project_tracker_setting_events (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  action text not null check (action in ('settings_created', 'settings_updated', 'tracker_enabled', 'tracker_paused')),
  actor_id uuid not null references auth.users(id),
  before_state jsonb not null default '{}'::jsonb,
  after_state jsonb not null default '{}'::jsonb,
  summary text not null,
  created_at timestamptz not null default now()
);

create index if not exists project_tracker_setting_events_project_lookup
  on public.project_tracker_setting_events (project_id, created_at desc);

-- Browser clients do not write setup records directly. The server-side route
-- verifies the authenticated administrator and writes an attributed event.
alter table public.project_tracker_settings enable row level security;
alter table public.project_tracker_setting_events enable row level security;

drop policy if exists project_tracker_settings_admin_read on public.project_tracker_settings;
drop policy if exists project_tracker_settings_admin_write on public.project_tracker_settings;
drop policy if exists project_tracker_setting_events_admin_read on public.project_tracker_setting_events;
drop policy if exists project_tracker_setting_events_admin_write on public.project_tracker_setting_events;

commit;

-- Rollback plan (execute only if this review release is reverted):
-- begin;
-- drop table if exists public.project_tracker_setting_events;
-- drop table if exists public.project_tracker_settings;
-- alter table public.project_allocations
--   drop column if exists can_submit_entries,
--   drop column if exists active;
-- commit;
