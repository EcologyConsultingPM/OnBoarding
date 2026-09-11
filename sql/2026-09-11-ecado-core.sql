-- Ecado core tables.
--
-- These five tables are already live in Supabase but were never captured in
-- this repository, unlike every other feature in sql/. That meant the access
-- control for the hidden Ecado domain (ecado_viewers) and its audit trail
-- (ecado_audit_log) had never been through code review, and a rebuild from
-- sql/ would have produced an application whose Ecado domain silently failed
-- closed on every request.
--
-- Reconstructed from every column the application reads or writes:
--   lib/ecado/escalations.js, lib/ecado/access.js, lib/ecado/thresholds.js,
--   app/api/ecado/brief/route.js, app/api/admin/ecado-viewers/route.js
--
-- Written to be idempotent so it can be applied over the existing tables:
-- every statement is IF NOT EXISTS / ADD COLUMN IF NOT EXISTS. Verify against
-- production with the audit query at the end BEFORE relying on it.

-- ---------------------------------------------------------------------------
-- Access allow-list for the hidden /admin/ecado domain.
-- Membership is granted by an administrator; revocation is a timestamp, never
-- a delete, so the history of who had access and when is preserved.
-- ---------------------------------------------------------------------------
create table if not exists public.ecado_viewers (
  email       text primary key,
  full_name   text,
  granted_by  text,
  granted_at  timestamptz not null default now(),
  revoked_at  timestamptz,
  note        text
);

create index if not exists ecado_viewers_active_idx
  on public.ecado_viewers (email) where revoked_at is null;

-- ---------------------------------------------------------------------------
-- Audit log. Every Ecado access decision and brief generation lands here,
-- including denials. Append-only by policy: no update or delete path exists in
-- the application, and none is granted below.
-- ---------------------------------------------------------------------------
create table if not exists public.ecado_audit_log (
  id           uuid primary key default gen_random_uuid(),
  user_email   text not null,
  action       text not null,
  detail       jsonb not null default '{}'::jsonb,
  sources_read text[] not null default array[]::text[],
  created_at   timestamptz not null default now()
);

create index if not exists ecado_audit_log_user_idx    on public.ecado_audit_log (user_email, created_at desc);
create index if not exists ecado_audit_log_action_idx  on public.ecado_audit_log (action, created_at desc);

-- ---------------------------------------------------------------------------
-- Escalations: a rule finding that has been persisted because it crossed the
-- persistence bar. `fingerprint` is sha256(ruleId::sourceType::sourceId), so
-- the same underlying problem updates one row rather than creating a new one
-- each run. A recurrence after closure is stored as a separate row with a
-- ":r<timestamp>" fingerprint suffix, which is why fingerprint is unique but
-- not the primary key.
-- ---------------------------------------------------------------------------
create table if not exists public.ecado_escalations (
  id             uuid primary key default gen_random_uuid(),
  fingerprint    text not null unique,
  rule_id        text not null,
  source_type    text not null,
  source_id      text not null,
  source_ref     text,
  level          integer not null check (level between 1 and 4),
  rating         text not null check (rating in ('critical','high','medium','low')),
  peak_rating    text not null check (peak_rating in ('critical','high','medium','low')),
  title          text not null,
  what_happened  text not null,
  why_it_matters text not null,
  what_next      text not null,
  owner          text,
  detail         jsonb not null default '{}'::jsonb,
  opened_at      timestamptz not null default now(),
  last_seen_at   timestamptz not null default now(),
  closed_at      timestamptz,
  closed_by      text,
  closure_reason text,

  -- A named human and a reason of substance are required to close an
  -- escalation. Enforced here as well as in closeEscalation() so the invariant
  -- survives any future caller that bypasses the helper.
  constraint ecado_closure_requires_reason check (
    closed_at is null
    or (closed_by is not null and closure_reason is not null and length(trim(closure_reason)) >= 10)
  )
);

create index if not exists ecado_escalations_open_idx
  on public.ecado_escalations (level desc, opened_at) where closed_at is null;
create index if not exists ecado_escalations_rule_idx
  on public.ecado_escalations (rule_id, opened_at desc);

-- ---------------------------------------------------------------------------
-- Generated briefs, retained so a recommendation can be reproduced later
-- exactly as it was issued: the findings, the data currency, the model used,
-- and whether the AI narration survived validation.
-- ---------------------------------------------------------------------------
create table if not exists public.ecado_briefs (
  id                uuid primary key default gen_random_uuid(),
  kind              text not null,
  subject_ref       text,
  generated_by      text not null,
  data_current_to   jsonb not null default '{}'::jsonb,
  counts            jsonb not null default '{}'::jsonb,
  findings          jsonb not null default '[]'::jsonb,
  markdown          text not null,
  model             text,
  narrated          boolean not null default false,
  created_at        timestamptz not null default now()
);

create index if not exists ecado_briefs_kind_idx on public.ecado_briefs (kind, created_at desc);

-- ---------------------------------------------------------------------------
-- Threshold overrides. Ratings are deterministic, and the values that drive
-- them are configuration rather than code, so they live here. Absent keys fall
-- back to DEFAULT_THRESHOLDS in lib/ecado/thresholds.js.
-- ---------------------------------------------------------------------------
create table if not exists public.ecado_thresholds (
  key        text primary key,
  value      jsonb not null,
  updated_by text,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- RLS. Every one of these tables is reached exclusively through the service
-- role in server routes, which is gated by requireEcadoViewerApi(). No browser
-- client should ever read them directly, so RLS is enabled with no permissive
-- policy: the service role bypasses RLS, everything else is denied.
-- ---------------------------------------------------------------------------
alter table public.ecado_viewers     enable row level security;
alter table public.ecado_audit_log   enable row level security;
alter table public.ecado_escalations enable row level security;
alter table public.ecado_briefs      enable row level security;
alter table public.ecado_thresholds  enable row level security;

comment on table public.ecado_viewers is
  'Allow-list for the hidden /admin/ecado domain. Revocation is a timestamp, never a delete.';
comment on table public.ecado_audit_log is
  'Append-only record of Ecado access decisions and brief generation, including denials.';
comment on constraint ecado_closure_requires_reason on public.ecado_escalations is
  'An escalation may only be closed by a named person with a reason of at least 10 characters.';

-- ---------------------------------------------------------------------------
-- VERIFY against production before trusting this file. Any row returned by the
-- first query is a column that exists live but is not described above.
-- ---------------------------------------------------------------------------
-- select table_name, column_name, data_type, is_nullable
-- from information_schema.columns
-- where table_schema = 'public' and table_name like 'ecado_%'
-- order by table_name, ordinal_position;
--
-- select conname, pg_get_constraintdef(oid)
-- from pg_constraint
-- where conrelid::regclass::text like 'ecado_%';
