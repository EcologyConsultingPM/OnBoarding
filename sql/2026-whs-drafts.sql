-- Ecology Consulting OnBoarding: numbered SWMS and psychosocial working drafts.
-- Run this file once, in full, in the Supabase SQL Editor for project
-- mqgumjgotjiphfgqdyyl after confirming the existing admin_emails table exists.

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.admin_emails
    where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.whs_drafts (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references auth.users(id) on delete cascade,
  document_type text not null check (document_type in ('swms', 'psychosocial')),
  title text not null check (char_length(trim(title)) >= 3),
  project_name text,
  site_location text,
  work_activity text not null check (char_length(trim(work_activity)) >= 3),
  team_and_roles text,
  emergency_arrangements text,
  consultation_notes text,
  review_date text,
  status text not null default 'draft' check (status in ('draft', 'ready_for_review', 'approved')),
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists whs_drafts_created_by_idx
  on public.whs_drafts (created_by, updated_at desc);

alter table public.whs_drafts enable row level security;

drop policy if exists whs_drafts_select on public.whs_drafts;
create policy whs_drafts_select on public.whs_drafts
  for select to authenticated
  using (created_by = auth.uid() or public.is_admin());

drop policy if exists whs_drafts_insert on public.whs_drafts;
create policy whs_drafts_insert on public.whs_drafts
  for insert to authenticated
  with check (created_by = auth.uid());

drop policy if exists whs_drafts_update_owner on public.whs_drafts;
create policy whs_drafts_update_owner on public.whs_drafts
  for update to authenticated
  using (created_by = auth.uid() and status <> 'approved')
  with check (created_by = auth.uid() and status <> 'approved');

drop policy if exists whs_drafts_update_admin on public.whs_drafts;
create policy whs_drafts_update_admin on public.whs_drafts
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop trigger if exists whs_drafts_set_updated_at on public.whs_drafts;
create trigger whs_drafts_set_updated_at
before update on public.whs_drafts
for each row execute function public.set_updated_at();

create table if not exists public.whs_draft_risk_rows (
  id uuid primary key default gen_random_uuid(),
  draft_id uuid not null references public.whs_drafts(id) on delete cascade,
  row_number integer not null check (row_number >= 1),
  row_type text not null check (row_type in ('hazard', 'psychosocial')),
  description text not null check (char_length(trim(description)) > 0),
  people_at_risk text,
  existing_controls text,
  proposed_controls text,
  residual_risk text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint whs_draft_risk_rows_draft_type_number_uq
    unique (draft_id, row_type, row_number)
);

create index if not exists whs_draft_risk_rows_draft_idx
  on public.whs_draft_risk_rows (draft_id, row_type, row_number);

alter table public.whs_draft_risk_rows enable row level security;

drop policy if exists whs_draft_risk_rows_select on public.whs_draft_risk_rows;
create policy whs_draft_risk_rows_select on public.whs_draft_risk_rows
  for select to authenticated
  using (
    exists (
      select 1 from public.whs_drafts draft
      where draft.id = whs_draft_risk_rows.draft_id
        and (draft.created_by = auth.uid() or public.is_admin())
    )
  );

drop policy if exists whs_draft_risk_rows_insert on public.whs_draft_risk_rows;
create policy whs_draft_risk_rows_insert on public.whs_draft_risk_rows
  for insert to authenticated
  with check (
    exists (
      select 1 from public.whs_drafts draft
      where draft.id = whs_draft_risk_rows.draft_id
        and draft.created_by = auth.uid()
        and draft.status <> 'approved'
    )
  );

drop policy if exists whs_draft_risk_rows_update on public.whs_draft_risk_rows;
create policy whs_draft_risk_rows_update on public.whs_draft_risk_rows
  for update to authenticated
  using (
    exists (
      select 1 from public.whs_drafts draft
      where draft.id = whs_draft_risk_rows.draft_id
        and (draft.created_by = auth.uid() or public.is_admin())
        and draft.status <> 'approved'
    )
  )
  with check (
    exists (
      select 1 from public.whs_drafts draft
      where draft.id = whs_draft_risk_rows.draft_id
        and (draft.created_by = auth.uid() or public.is_admin())
        and draft.status <> 'approved'
    )
  );

drop policy if exists whs_draft_risk_rows_delete on public.whs_draft_risk_rows;
create policy whs_draft_risk_rows_delete on public.whs_draft_risk_rows
  for delete to authenticated
  using (
    exists (
      select 1 from public.whs_drafts draft
      where draft.id = whs_draft_risk_rows.draft_id
        and (draft.created_by = auth.uid() or public.is_admin())
        and draft.status <> 'approved'
    )
  );

drop trigger if exists whs_draft_risk_rows_set_updated_at on public.whs_draft_risk_rows;
create trigger whs_draft_risk_rows_set_updated_at
before update on public.whs_draft_risk_rows
for each row execute function public.set_updated_at();
