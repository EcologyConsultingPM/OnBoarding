-- Flora & Fauna Profiles domain (Flora first) — field photo submission + Flora expert approval
-- Applied live via Supabase MCP to project qjsdglkipgncttztksxl on 2026-08-25.
create table public.flora_photo_submissions (
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

alter table public.flora_photo_submissions enable row level security;

create policy flora_photo_submissions_admin_all on public.flora_photo_submissions
  for all to authenticated
  using (is_admin())
  with check (is_admin());

create policy flora_photo_submissions_insert on public.flora_photo_submissions
  for insert to authenticated
  with check (submitted_by = auth.uid());

create policy flora_photo_submissions_select on public.flora_photo_submissions
  for select to authenticated
  using (submitted_by = auth.uid() or is_admin());

create policy flora_photo_submissions_update_own on public.flora_photo_submissions
  for update to authenticated
  using ((submitted_by = auth.uid() and status = 'pending') or is_admin())
  with check (submitted_by = auth.uid() or is_admin());

create trigger flora_photo_submissions_set_updated_at
  before update on public.flora_photo_submissions
  for each row execute function set_updated_at();

create trigger flora_photo_submissions_reset_seen
  before update on public.flora_photo_submissions
  for each row execute function reset_seen_on_review();

-- extend the shared seen-reset trigger fn to cover the new table
create or replace function reset_seen_on_review()
returns trigger
language plpgsql
as $$
begin
  if (TG_TABLE_NAME = 'service_requests' and new.status is distinct from old.status and new.status in ('approved','declined'))
     or (TG_TABLE_NAME = 'whs_forms' and new.status is distinct from old.status and new.status in ('reviewed','actioned'))
     or (TG_TABLE_NAME = 'flora_photo_submissions' and new.status is distinct from old.status and new.status in ('verified','rejected')) then
    new.seen_by_staff := false;
  end if;
  return new;
end;
$$;
