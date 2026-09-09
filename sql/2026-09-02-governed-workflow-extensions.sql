begin;

-- Immutable, application-level audit log. API routes write via the service role only
-- after their existing signed-in user and portal-resource checks.
create table if not exists public.admin_audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references auth.users(id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  project_id uuid references public.projects(id) on delete set null,
  resource_key text,
  before_data jsonb,
  after_data jsonb,
  reason text,
  created_at timestamptz not null default now()
);
create index if not exists admin_audit_log_entity_idx on public.admin_audit_log(entity_type, entity_id, created_at desc);
create index if not exists admin_audit_log_project_idx on public.admin_audit_log(project_id, created_at desc);
alter table public.admin_audit_log enable row level security;

-- Governed quote deliverable catalogue and line items.
create table if not exists public.quote_deliverable_categories (
  id uuid primary key default gen_random_uuid(),
  label text not null unique,
  description text,
  sort_order integer not null default 0,
  active boolean not null default true,
  locked boolean not null default false,
  archived_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.quote_deliverables (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references public.quote_pipeline(id) on delete restrict,
  category_id uuid references public.quote_deliverable_categories(id) on delete restrict,
  title text not null,
  description text,
  estimated_fee numeric,
  estimated_hours numeric,
  status text not null default 'draft' check (status in ('draft','approved','archived')),
  locked boolean not null default false,
  archived_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (quote_id, title)
);
create index if not exists quote_deliverables_quote_idx on public.quote_deliverables(quote_id, status, created_at);
alter table public.quote_deliverable_categories enable row level security;
alter table public.quote_deliverables enable row level security;

-- A successful issued quote can create one draft project only. It is never activated
-- until a separate administrator approval is recorded.
create table if not exists public.quote_draft_projects (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null unique references public.quote_pipeline(id) on delete restrict,
  project_id uuid not null unique references public.projects(id) on delete restrict,
  status text not null default 'pending_review' check (status in ('pending_review','approved','rejected','activated','archived')),
  approval_note text,
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  activated_by uuid references auth.users(id) on delete set null,
  activated_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.quote_draft_projects enable row level security;

create or replace function public.ensure_quote_draft_project(p_quote_id uuid, p_actor_id uuid)
returns table (draft_project_id uuid, project_id uuid, state text)
language plpgsql security definer set search_path = public as $$
declare q public.quote_pipeline%rowtype; existing public.quote_draft_projects%rowtype; new_project_id uuid; new_link_id uuid;
begin
  select * into q from public.quote_pipeline where id = p_quote_id for update;
  if not found then raise exception 'Quote was not found.'; end if;
  if q.status <> 'successful' or q.superseded then raise exception 'Only an active successful quote can create a draft project.'; end if;
  select * into existing from public.quote_draft_projects where quote_id = p_quote_id for update;
  if found then return query select existing.id, existing.project_id, existing.status; return; end if;
  insert into public.projects (created_by, name, client_name, description, status)
  values (p_actor_id, coalesce(nullif(trim(q.project), ''), 'Draft project'), nullif(trim(q.client), ''), concat_ws(' · ', 'Draft project created from successful quote', nullif(trim(q.comments), '')), 'draft')
  returning id into new_project_id;
  insert into public.quote_draft_projects (quote_id, project_id, created_by)
  values (p_quote_id, new_project_id, p_actor_id) returning id into new_link_id;
  return query select new_link_id, new_project_id, 'pending_review'::text;
end; $$;
revoke all on function public.ensure_quote_draft_project(uuid, uuid) from public;
grant execute on function public.ensure_quote_draft_project(uuid, uuid) to service_role;

-- Service Request transition safeguards, task details and deduplicated writes.
alter table public.service_requests drop constraint if exists service_requests_request_type_check;
alter table public.service_requests add constraint service_requests_request_type_check check (request_type in ('leave','training','equipment','task','other','whs_incident','whs_near_miss'));
alter table public.service_requests drop constraint if exists service_requests_status_check;
alter table public.service_requests add constraint service_requests_status_check check (status in ('draft','submitted','returned','assigned','in_progress','approved','declined','cancelled','closed','archived'));
alter table public.service_requests add column if not exists submission_key text;
alter table public.service_requests add column if not exists project_id uuid references public.projects(id) on delete set null;
alter table public.service_requests add column if not exists assigned_to uuid references auth.users(id) on delete set null;
alter table public.service_requests add column if not exists priority text not null default 'normal' check (priority in ('low','normal','high','urgent'));
alter table public.service_requests add column if not exists due_date date;
alter table public.service_requests add column if not exists estimated_hours numeric;
alter table public.service_requests add column if not exists attachments jsonb not null default '[]'::jsonb;
alter table public.service_requests add column if not exists locked boolean not null default false;
alter table public.service_requests add column if not exists archived_at timestamptz;
alter table public.service_requests add column if not exists return_reason text;
create unique index if not exists service_requests_submit_key_idx on public.service_requests(created_by, submission_key) where submission_key is not null;
create index if not exists service_requests_assignee_idx on public.service_requests(assigned_to, status, updated_at desc);

-- Learning assignments make the staff lifecycle and competency verification explicit.
create table if not exists public.learning_assignments (
  id uuid primary key default gen_random_uuid(),
  node_id uuid not null references public.ld_nodes(id) on delete restrict,
  user_id uuid not null references auth.users(id) on delete restrict,
  assigned_by uuid references auth.users(id) on delete set null,
  status text not null default 'assigned' check (status in ('assigned','started','submitted','assessed','competency_verified','returned','archived')),
  due_date date,
  started_at timestamptz,
  submitted_at timestamptz,
  assessed_at timestamptz,
  verified_at timestamptz,
  reviewer_id uuid references auth.users(id) on delete set null,
  remediation_note text,
  locked boolean not null default false,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(node_id, user_id)
);
create index if not exists learning_assignments_user_idx on public.learning_assignments(user_id, status, due_date);
alter table public.learning_assignments enable row level security;
alter table public.ld_nodes add column if not exists content_type text;
alter table public.ld_nodes add column if not exists owner_id uuid references auth.users(id) on delete set null;
alter table public.ld_nodes add column if not exists version_label text;
alter table public.ld_nodes add column if not exists review_date date;
alter table public.ld_nodes add column if not exists audience text not null default 'staff' check (audience in ('staff','manager','administrator'));
alter table public.ld_nodes add column if not exists publication_status text not null default 'draft' check (publication_status in ('draft','published','superseded','archived'));
alter table public.ld_nodes add column if not exists superseded_by uuid references public.ld_nodes(id) on delete set null;
alter table public.ld_nodes add column if not exists locked boolean not null default false;
alter table public.ld_nodes add column if not exists archived_at timestamptz;

-- Restricted confidential psychosocial support requests. No browser-direct policies;
-- access is granted only via narrowly scoped server routes and explicit reviewer assignment.
create table if not exists public.psychosocial_support_cases (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references auth.users(id) on delete restrict,
  status text not null default 'draft' check (status in ('draft','submitted','triaged','actioned','closed','archived')),
  urgency text not null default 'standard' check (urgency in ('standard','priority','urgent')),
  preferred_contact text,
  confidential_summary text,
  assigned_reviewer uuid references auth.users(id) on delete set null,
  submitted_at timestamptz,
  triaged_at timestamptz,
  closed_at timestamptz,
  retention_review_at timestamptz not null default (now() + interval '90 days'),
  locked boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.psychosocial_case_access_log (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.psychosocial_support_cases(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  action text not null,
  created_at timestamptz not null default now()
);
alter table public.psychosocial_support_cases enable row level security;
alter table public.psychosocial_case_access_log enable row level security;

-- Commercial margin snapshots remain administrator-only and cannot be calculated
-- until administrators provide approved revenue and reconciled actual costs.
create table if not exists public.commercial_margin_snapshots (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null unique references public.projects(id) on delete restrict,
  approved_revenue numeric,
  reconciled_actual_cost numeric,
  margin_amount numeric,
  margin_percent numeric,
  source_note text,
  status text not null default 'draft' check (status in ('draft','review','approved','archived')),
  locked boolean not null default false,
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.commercial_margin_snapshots enable row level security;

-- Curated BioNet watchlist, deliberately separated from page-level Regulatory Watch.
create table if not exists public.bionet_watchlists (
  id uuid primary key default gen_random_uuid(),
  scientific_name text not null,
  common_name text,
  profile_url text,
  jurisdiction text not null default 'NSW',
  active boolean not null default true,
  locked boolean not null default false,
  last_observed_checksum text,
  last_checked_at timestamptz,
  last_successful_check_at timestamptz,
  review_note text,
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(scientific_name, jurisdiction)
);
create table if not exists public.bionet_watch_events (
  id uuid primary key default gen_random_uuid(),
  watchlist_id uuid not null references public.bionet_watchlists(id) on delete cascade,
  detected_at timestamptz not null default now(),
  source_url text,
  snapshot_hash text,
  change_summary text,
  assessment_status text not null default 'detected' check (assessment_status in ('detected','reviewed','actioned','ignored','archived')),
  assessed_by uuid references auth.users(id) on delete set null,
  assessed_at timestamptz,
  assessment_note text,
  created_at timestamptz not null default now()
);
alter table public.bionet_watchlists enable row level security;
alter table public.bionet_watch_events enable row level security;

-- Structured-feed metadata for Regulatory Watch. Existing page-monitor sources keep
-- fetch_type=page unless an administrator selects an authoritative feed/version endpoint.
alter table public.regulatory_sources add column if not exists fetch_type text not null default 'page' check (fetch_type in ('page','rss','atom','json','document'));
alter table public.regulatory_sources add column if not exists feed_url text;
alter table public.regulatory_sources add column if not exists content_scope text;
alter table public.regulatory_sources add column if not exists version_value text;
alter table public.regulatory_sources add column if not exists next_retry_at timestamptz;

select pg_notify('pgrst', 'reload schema') as schema_cache_refreshed;
commit;
