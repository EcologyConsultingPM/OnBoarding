-- Auditable administrator activation override for the project lifecycle.
-- A normal activation records Senior Ecologist approval. An override is
-- permitted only through the protected administrator API and always carries a
-- substantive reason; it never silently resembles a Senior Ecologist approval.

create table if not exists public.project_approval_history (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete restrict,
  action text not null check (action in ('senior_ecologist_review_requested', 'senior_ecologist_approved', 'administrator_override_activated', 'returned_to_draft')),
  reason text,
  performed_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

create index if not exists project_approval_history_project_created_idx
  on public.project_approval_history(project_id, created_at desc);

alter table public.project_approval_history enable row level security;

drop policy if exists project_approval_history_admin_read on public.project_approval_history;
create policy project_approval_history_admin_read
  on public.project_approval_history
  for select
  to authenticated
  using (is_admin());

-- Inserts are made exclusively by the protected server route using the service role.
