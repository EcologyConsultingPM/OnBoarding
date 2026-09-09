-- Project close-out and continuous-improvement records.
-- Records are retained for audit; operational deletion should use archive flags.
create table if not exists public.project_closeouts (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete restrict,
  status text not null default 'not_started' check (status in ('not_started','initiated','awaiting_reviews','awaiting_manager_approval','closed','archived')),
  success_score integer check (success_score is null or success_score between 1 and 5),
  client_outcome text,
  delivery_summary text,
  lessons_learned text,
  stakeholder_feedback text,
  financial_review_notes text,
  recommendations text,
  approval_note text,
  initiated_at timestamptz,
  approved_at timestamptz,
  approved_by uuid,
  created_by uuid,
  updated_by uuid,
  locked_at timestamptz,
  locked_by uuid,
  archived_at timestamptz,
  archived_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(project_id)
);

create table if not exists public.project_closeout_feedback (
  id uuid primary key default gen_random_uuid(),
  closeout_id uuid not null references public.project_closeouts(id) on delete restrict,
  staff_user_id uuid not null,
  response jsonb not null default '{}'::jsonb,
  status text not null default 'submitted' check (status in ('draft','submitted','withdrawn')),
  submitted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(closeout_id, staff_user_id)
);

create table if not exists public.project_improvement_actions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete restrict,
  closeout_id uuid references public.project_closeouts(id) on delete restrict,
  title text not null,
  description text,
  assigned_to uuid,
  status text not null default 'draft' check (status in ('draft','assigned','in_progress','completed','verified','archived')),
  due_date date,
  locked boolean not null default false,
  is_active boolean not null default true,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists project_closeouts_status_idx on public.project_closeouts(status);
create index if not exists project_closeout_feedback_closeout_idx on public.project_closeout_feedback(closeout_id);
create index if not exists project_improvement_actions_project_idx on public.project_improvement_actions(project_id, is_active);

alter table public.project_closeouts enable row level security;
alter table public.project_closeout_feedback enable row level security;
alter table public.project_improvement_actions enable row level security;
