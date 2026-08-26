-- Species Profiles domain — fauna field photo submission + Fauna expert approval.
-- Mirrors flora_photo_submissions exactly. Applied live via Supabase MCP to
-- project qjsdglkipgncttztksxl on 2026-08-26.
create table public.fauna_photo_submissions (
  id uuid primary key default gen_random_uuid(),
  submitted_by uuid not null default auth.uid(),
  taxon_name text not null,
  common_name text,
  photo_data text not null,
  note text,
  status text not null default 'pending' check (status in ('pending','verified','rejected')),
  reviewed_by uuid,
  reviewed_at timestamptz,
  review_note text,
  seen_by_staff boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.fauna_photo_submissions enable row level security;

create policy fauna_photo_submissions_admin_all on public.fauna_photo_submissions
  for all to authenticated
  using (is_admin())
  with check (is_admin());

create policy fauna_photo_submissions_insert on public.fauna_photo_submissions
  for insert to authenticated
  with check (submitted_by = auth.uid());

create policy fauna_photo_submissions_select on public.fauna_photo_submissions
  for select to authenticated
  using (submitted_by = auth.uid() or is_admin());

create policy fauna_photo_submissions_update_own on public.fauna_photo_submissions
  for update to authenticated
  using ((submitted_by = auth.uid() and status = 'pending') or is_admin())
  with check (submitted_by = auth.uid() or is_admin());

create trigger fauna_photo_submissions_set_updated_at
  before update on public.fauna_photo_submissions
  for each row execute function set_updated_at();

create trigger fauna_photo_submissions_reset_seen
  before update on public.fauna_photo_submissions
  for each row execute function reset_seen_on_review();

-- extend the shared seen-reset trigger fn to cover the new table
create or replace function reset_seen_on_review()
returns trigger
language plpgsql
as $$
begin
  if (TG_TABLE_NAME = 'service_requests' and new.status is distinct from old.status and new.status in ('approved','declined'))
     or (TG_TABLE_NAME = 'whs_forms' and new.status is distinct from old.status and new.status in ('reviewed','actioned'))
     or (TG_TABLE_NAME = 'flora_photo_submissions' and new.status is distinct from old.status and new.status in ('verified','rejected'))
     or (TG_TABLE_NAME = 'fauna_photo_submissions' and new.status is distinct from old.status and new.status in ('verified','rejected')) then
    new.seen_by_staff := false;
  end if;
  return new;
end;
$$;
