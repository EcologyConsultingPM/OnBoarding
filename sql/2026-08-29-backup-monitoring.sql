-- Private backup and Portal Management health-monitoring foundation.
-- Additive only. Status records are written by trusted server jobs or the private
-- GitHub workflow; staff and browser clients receive no direct table policies.

create table if not exists public.backup_runs (
  id uuid primary key default gen_random_uuid(),
  run_id text not null unique,
  status text not null check (status in ('running', 'succeeded', 'failed')),
  workflow_name text not null default 'daily-private-database-backup',
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  archive_bytes bigint check (archive_bytes is null or archive_bytes >= 0),
  archive_sha256 text,
  coverage jsonb not null default '{"database_roles":true,"database_schema":true,"database_data":true,"storage_objects":false}'::jsonb,
  retention_days integer not null default 7 check (retention_days between 1 and 30),
  error_summary text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.system_health_runs (
  id uuid primary key default gen_random_uuid(),
  service_key text not null,
  status text not null check (status in ('healthy', 'degraded', 'failed')),
  summary text not null,
  details jsonb not null default '{}'::jsonb,
  checked_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists backup_runs_started_at_idx on public.backup_runs (started_at desc);
create index if not exists system_health_runs_checked_at_idx on public.system_health_runs (checked_at desc);
create index if not exists system_health_runs_service_checked_idx on public.system_health_runs (service_key, checked_at desc);

alter table public.backup_runs enable row level security;
alter table public.system_health_runs enable row level security;

-- Intentionally no SELECT/INSERT/UPDATE/DELETE policies: only server code using
-- the service role may write these operational records; the protected admin route
-- reads a curated view after requireSession confirms administrator access.
