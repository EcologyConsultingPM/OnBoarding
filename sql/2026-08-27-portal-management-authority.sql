-- Portal Management authority controls
-- Review-only migration: do not apply to production until the accompanying
-- PRIMARY_ADMIN_EMAIL environment setting is confirmed in Vercel.

begin;

create table if not exists public.portal_role_assignments (
  id uuid primary key default gen_random_uuid(),
  target_user_id uuid not null references auth.users(id) on delete cascade,
  target_email text not null,
  role_key text not null check (role_key in (
    'fauna_expert',
    'flora_expert',
    'whs_manager',
    'report_expert',
    'module_assessor'
  )),
  module_scope text,
  status text not null default 'active' check (status in ('active', 'withdrawn')),
  assigned_by uuid not null references auth.users(id),
  assigned_at timestamptz not null default now(),
  withdrawn_by uuid references auth.users(id),
  withdrawn_at timestamptz,
  check (
    (role_key = 'module_assessor' and nullif(btrim(module_scope), '') is not null)
    or (role_key <> 'module_assessor' and module_scope is null)
  ),
  check (
    (status = 'active' and withdrawn_by is null and withdrawn_at is null)
    or (status = 'withdrawn' and withdrawn_by is not null and withdrawn_at is not null)
  )
);

create unique index if not exists portal_role_assignments_one_active_role
  on public.portal_role_assignments (target_user_id, role_key, coalesce(module_scope, ''))
  where status = 'active';

create index if not exists portal_role_assignments_active_lookup
  on public.portal_role_assignments (status, assigned_at desc);

create table if not exists public.admin_access_requests (
  id uuid primary key default gen_random_uuid(),
  request_type text not null check (request_type in ('grant', 'remove')),
  target_email text not null,
  reason text,
  requested_by uuid not null references auth.users(id),
  requester_email text not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  decided_by uuid references auth.users(id),
  decided_at timestamptz,
  decision_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (status = 'pending' and decided_by is null and decided_at is null)
    or (status in ('approved', 'rejected', 'cancelled'))
  )
);

create index if not exists admin_access_requests_pending_lookup
  on public.admin_access_requests (status, created_at desc);

create unique index if not exists admin_access_requests_one_pending_target_action
  on public.admin_access_requests (target_email, request_type)
  where status = 'pending';

-- These records are deliberately unavailable to browser clients. Administrative
-- reads/writes pass through the authenticated server route, which applies the
-- configured primary-administrator check before using the service-role client.
alter table public.portal_role_assignments enable row level security;
alter table public.admin_access_requests enable row level security;

drop policy if exists portal_role_assignments_admin_read on public.portal_role_assignments;
drop policy if exists portal_role_assignments_admin_write on public.portal_role_assignments;
drop policy if exists admin_access_requests_admin_read on public.admin_access_requests;
drop policy if exists admin_access_requests_admin_write on public.admin_access_requests;

-- Retire the legacy client-side policy that allows every administrator to write
-- directly to the administrator allow-list. The existing authenticated read
-- policy remains so the legacy app can resolve its own administrator status.
drop policy if exists admin_emails_admin_write on public.admin_emails;

commit;

-- Rollback plan (execute only if the review release must be reverted):
-- begin;
-- create policy admin_emails_admin_write on public.admin_emails
--   for all to public using (public.is_admin()) with check (public.is_admin());
-- drop table if exists public.admin_access_requests;
-- drop table if exists public.portal_role_assignments;
-- commit;
