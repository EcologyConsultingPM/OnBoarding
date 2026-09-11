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
  -- Live has NO check on these two (verified 2026-09-11): only
  -- ecado_escalations_level_check exists. They are left unconstrained here so
  -- this file matches production. The optional hardening block at the foot adds
  -- them safely, after validating existing rows.
  rating         text not null,
  peak_rating    text not null,
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
  --
  -- Written to match the live definition byte for byte, verified 2026-09-11.
  -- Note it does NOT trim: ten spaces satisfies the database. closeEscalation()
  -- does trim, so the application path is sound, but a direct SQL write could
  -- close an escalation with a whitespace "reason". See the hardening block at
  -- the foot of this file.
  constraint ecado_closure_requires_reason check (
    closed_at is null
    or (closed_by is not null and length(coalesce(closure_reason, ''::text)) >= 10)
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
-- Threshold change history.
--
-- This table exists in production but is never read or written by the
-- application — lib/ecado/thresholds.js documents it as "written to
-- ecado_threshold_history by trigger". The trigger is therefore also
-- undocumented in this repo.
--
-- SHAPE UNVERIFIED. The constraint introspection confirms only that the table
-- exists with a uuid primary key. Run the columns query at the foot of this
-- file and the trigger query, then correct this block before relying on it.
-- ---------------------------------------------------------------------------
create table if not exists public.ecado_threshold_history (
  id          uuid primary key default gen_random_uuid(),
  key         text not null,
  old_value   jsonb,
  new_value   jsonb,
  changed_by  text,
  changed_at  timestamptz not null default now()
);

create index if not exists ecado_threshold_history_key_idx
  on public.ecado_threshold_history (key, changed_at desc);

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
alter table public.ecado_threshold_history enable row level security;

comment on table public.ecado_viewers is
  'Allow-list for the hidden /admin/ecado domain. Revocation is a timestamp, never a delete.';
comment on table public.ecado_audit_log is
  'Append-only record of Ecado access decisions and brief generation, including denials.';
comment on constraint ecado_closure_requires_reason on public.ecado_escalations is
  'An escalation may only be closed by a named person with a reason of at least 10 characters.';

-- ---------------------------------------------------------------------------
-- OPTIONAL HARDENING — review before running.
--
-- Production currently accepts any string in rating and peak_rating, and will
-- accept a whitespace-only closure reason. Neither is reachable through the
-- application, so these are defence in depth rather than bug fixes. Each
-- validates existing data first and does nothing if the data would fail, so it
-- is safe to run and safe to skip.
-- ---------------------------------------------------------------------------
-- do $$
-- begin
--   if not exists (select 1 from pg_constraint where conname = 'ecado_escalations_rating_check')
--      and not exists (select 1 from public.ecado_escalations
--                      where rating not in ('critical','high','medium','low')
--                         or peak_rating not in ('critical','high','medium','low'))
--   then
--     alter table public.ecado_escalations
--       add constraint ecado_escalations_rating_check
--       check (rating in ('critical','high','medium','low')
--          and peak_rating in ('critical','high','medium','low'));
--   end if;
-- end $$;
--
-- -- Require a closure reason with actual content, not just length.
-- alter table public.ecado_escalations drop constraint if exists ecado_closure_requires_reason;
-- alter table public.ecado_escalations add constraint ecado_closure_requires_reason
--   check (closed_at is null
--          or (closed_by is not null and length(btrim(coalesce(closure_reason, ''))) >= 10));

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
--
-- -- STILL OUTSTANDING: the trigger that maintains ecado_threshold_history.
-- select tgname,
--        pg_get_triggerdef(t.oid) as definition
-- from pg_trigger t
-- where not t.tgisinternal
--   and t.tgrelid::regclass::text like 'ecado_%';
--
-- -- And the function it calls:
-- select p.proname, pg_get_functiondef(p.oid)
-- from pg_proc p join pg_namespace n on n.oid = p.pronamespace
-- where n.nspname = 'public' and p.proname ilike '%threshold%';
