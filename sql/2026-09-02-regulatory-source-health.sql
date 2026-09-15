alter table if exists public.regulatory_sources add column if not exists failure_count integer not null default 0;
alter table if exists public.regulatory_sources add column if not exists last_error text;
alter table if exists public.regulatory_sources add column if not exists last_successful_check_at timestamptz;

create table if not exists public.regulatory_source_health_alerts (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.regulatory_sources(id) on delete restrict,
  status text not null default 'open' check (status in ('open','resolved')),
  error_message text,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  resolved_at timestamptz,
  last_notified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(source_id, status)
);
create index if not exists regulatory_source_health_alerts_open_idx on public.regulatory_source_health_alerts(source_id, status);
alter table public.regulatory_source_health_alerts enable row level security;
