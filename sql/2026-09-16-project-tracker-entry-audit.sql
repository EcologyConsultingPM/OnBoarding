-- Preserve the original record when an administrator corrects or removes a
-- Project Tracker entry. The operational row may be corrected/voided, but the
-- audit row is append-only and records the authorised reason and snapshots.

create table if not exists public.project_tracker_entry_audit (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete restrict,
  tracker_entry_id uuid,
  action text not null check (action in ('corrected', 'voided')),
  reason text not null check (char_length(trim(reason)) >= 10),
  before_data jsonb not null,
  after_data jsonb,
  performed_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

create index if not exists project_tracker_entry_audit_entry_created_idx
  on public.project_tracker_entry_audit(tracker_entry_id, created_at desc);
create index if not exists project_tracker_entry_audit_project_created_idx
  on public.project_tracker_entry_audit(project_id, created_at desc);

alter table public.project_tracker_entry_audit enable row level security;
drop policy if exists project_tracker_entry_audit_admin_read on public.project_tracker_entry_audit;
create policy project_tracker_entry_audit_admin_read
  on public.project_tracker_entry_audit for select to authenticated using (is_admin());
