-- Legis Monday briefings.
-- The scheduled server route writes these rows with the service role;
-- the authenticated /api/legis route reads them after verifying the session.
create table if not exists public.monday_briefs (
  id uuid primary key default gen_random_uuid(),
  week_of date not null unique,
  status text not null default 'generating' check (status in ('generating', 'ready', 'failed')),
  summary text not null default '',
  developments jsonb not null default '[]'::jsonb,
  actions_this_week jsonb not null default '[]'::jsonb,
  watchlist jsonb not null default '[]'::jsonb,
  no_material_change_categories jsonb not null default '[]'::jsonb,
  status_matrix jsonb not null default '[]'::jsonb,
  department_summaries jsonb not null default '{}'::jsonb,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists monday_briefs_status_week_idx
  on public.monday_briefs (status, week_of desc);

alter table public.monday_briefs enable row level security;

-- No direct browser policies: the protected server route verifies the user
-- session and uses the server-side Supabase client for reads.

-- Optional compliance-register bridge used by Legis recommendations. This is
-- deliberately additive and preserves existing rows if the table already exists.
create table if not exists public.compliance_register_items (
  id uuid primary key default gen_random_uuid(),
  monday_brief_id uuid references public.monday_briefs(id) on delete set null,
  development_title text not null,
  severity text,
  jurisdiction text,
  effective_date date,
  legal_status text,
  affected_templates_procedures text,
  action_required text,
  source_url text,
  created_at timestamptz not null default now()
);

create index if not exists compliance_register_items_brief_idx
  on public.compliance_register_items (monday_brief_id, created_at desc);

alter table public.compliance_register_items enable row level security;

commit;
