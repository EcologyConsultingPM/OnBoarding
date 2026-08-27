-- Ecology Consulting Portal
-- Project-first Tracker foundation
--
-- Additive migration. It preserves existing projects, project activities,
-- activity history and external Timesheets separation while adding controlled
-- commercial tracker, staff entry and template records.

begin;

create table if not exists public.project_budget_sources (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  source_code text not null,
  source_name text not null,
  source_type text not null default 'variation' check (source_type in ('original', 'variation', 'internal_reallocation')),
  approved_value numeric(14,2) not null default 0 check (approved_value >= 0),
  approved_hours numeric(12,2) not null default 0 check (approved_hours >= 0),
  approval_status text not null default 'draft' check (approval_status in ('draft', 'pending_approval', 'approved', 'rejected', 'closed')),
  variation_reason text,
  effective_date date not null default current_date,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now(),
  unique (project_id, source_code)
);

create table if not exists public.project_budget_allocations (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  budget_source_id uuid not null references public.project_budget_sources(id) on delete cascade,
  allocation_code text not null,
  allocation_name text not null,
  allocation_value numeric(14,2) not null default 0 check (allocation_value >= 0),
  allocation_hours numeric(12,2) not null default 0 check (allocation_hours >= 0),
  hours_consumed numeric(12,2) not null default 0 check (hours_consumed >= 0),
  charge_out_spend numeric(14,2) not null default 0 check (charge_out_spend >= 0),
  internal_cost numeric(14,2) not null default 0 check (internal_cost >= 0),
  threshold_percent numeric(5,2) not null default 80 check (threshold_percent > 0 and threshold_percent <= 100),
  status text not null default 'draft' check (status in ('draft', 'active', 'closed')),
  staff_visible boolean not null default false,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now(),
  unique (budget_source_id, allocation_code)
);

create table if not exists public.project_tracker_templates (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null unique references public.projects(id) on delete cascade,
  template_name text not null default 'Project Tracker',
  instructions text not null default 'Record your project activity accurately and highlight issues that require project-lead review.',
  category_options jsonb not null default '[]'::jsonb,
  column_definitions jsonb not null default '[]'::jsonb,
  guidance_rows jsonb not null default '[]'::jsonb,
  locked boolean not null default false,
  locked_by uuid references auth.users(id),
  locked_at timestamptz,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now()
);

create table if not exists public.project_tracker_template_events (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  template_id uuid not null references public.project_tracker_templates(id) on delete cascade,
  action text not null check (action in ('template_locked', 'template_unlocked')),
  actor_id uuid not null references auth.users(id),
  template_snapshot jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists public.project_tracker_entries (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  budget_source_id uuid not null references public.project_budget_sources(id) on delete restrict,
  budget_allocation_id uuid not null references public.project_budget_allocations(id) on delete restrict,
  staff_user_id uuid not null references auth.users(id) on delete restrict,
  work_date date not null,
  activity_category text not null,
  activity_information text not null,
  hours numeric(6,2) not null check (hours >= 0 and hours <= 24),
  status text not null check (status in ('not_commenced', 'active', 'paused_other', 'completed')),
  notable_issues text,
  custom_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists project_budget_sources_project_idx on public.project_budget_sources (project_id, effective_date);
create index if not exists project_budget_allocations_project_idx on public.project_budget_allocations (project_id, status);
create index if not exists project_tracker_entries_staff_idx on public.project_tracker_entries (staff_user_id, work_date desc, created_at desc);
create index if not exists project_tracker_entries_allocation_idx on public.project_tracker_entries (budget_allocation_id, work_date desc);
create index if not exists project_tracker_template_events_project_idx on public.project_tracker_template_events (project_id, created_at desc);

-- Seed an approved original source from each existing project master budget.
-- Existing financial master records are retained; this is a tracker baseline.
insert into public.project_budget_sources (
  project_id, source_code, source_name, source_type, approved_value,
  approved_hours, approval_status, effective_date, created_by, updated_by
)
select
  p.id, 'ORG-01', 'Original Scope', 'original', coalesce(p.budget_dollars, 0),
  coalesce(p.budget_hours, 0), 'approved', case when p.start_date ~ '^\\d{4}-\\d{2}-\\d{2}$' then p.start_date::date else current_date end,
  p.created_by, p.created_by
from public.projects p
where not exists (
  select 1 from public.project_budget_sources source
  where source.project_id = p.id and source.source_type = 'original'
);

alter table public.project_budget_sources enable row level security;
alter table public.project_budget_allocations enable row level security;
alter table public.project_tracker_templates enable row level security;
alter table public.project_tracker_template_events enable row level security;
alter table public.project_tracker_entries enable row level security;

-- There are intentionally no direct authenticated-client policies. Project
-- Tracker reads and writes are conducted through routes that verify the
-- signed-in user and enforce project allocation, template lock and admin rules.

drop policy if exists project_budget_sources_admin_direct_access on public.project_budget_sources;
drop policy if exists project_budget_allocations_admin_direct_access on public.project_budget_allocations;
drop policy if exists project_tracker_templates_admin_direct_access on public.project_tracker_templates;
drop policy if exists project_tracker_template_events_admin_direct_access on public.project_tracker_template_events;
drop policy if exists project_tracker_entries_direct_access on public.project_tracker_entries;

commit;
