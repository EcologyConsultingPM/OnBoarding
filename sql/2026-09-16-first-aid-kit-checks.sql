-- EC-WHS-FAK-001 Rev 1 — controlled first-aid kit check records.
-- This migration is deliberately additive because the original form stored a
-- smaller legacy payload in first_aid_kit_checks. The API is the canonical
-- validator; these database constraints make malformed new writes difficult
-- even outside that route.

create table if not exists public.first_aid_kit_checks (
  id uuid primary key default gen_random_uuid(),
  checked_by uuid not null default auth.uid(),
  check_date date not null,
  next_check_due date not null,
  check_type text not null,
  checked_by_name text not null,
  checked_by_position text not null,
  selected_kits jsonb not null default '[]'::jsonb,
  restock_register jsonb not null default '[]'::jsonb,
  usage_notes text,
  signature text not null,
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.first_aid_kit_checks
  add column if not exists next_check_due date,
  add column if not exists check_type text,
  add column if not exists checked_by_name text,
  add column if not exists checked_by_position text,
  add column if not exists selected_kits jsonb not null default '[]'::jsonb,
  add column if not exists idempotency_key text,
  add column if not exists updated_at timestamptz not null default now();

-- Existing records were created before idempotency was introduced. Give each a
-- stable distinct legacy key before the uniqueness guarantee is enabled.
update public.first_aid_kit_checks
set idempotency_key = concat('legacy-', id::text)
where idempotency_key is null;

alter table public.first_aid_kit_checks
  alter column idempotency_key set not null;

alter table public.first_aid_kit_checks
  drop constraint if exists first_aid_kit_checks_check_type_check,
  drop constraint if exists first_aid_kit_checks_selected_kits_check,
  drop constraint if exists first_aid_kit_checks_restock_register_check,
  drop constraint if exists first_aid_kit_checks_check_due_check,
  drop constraint if exists first_aid_kit_checks_signature_check,
  add constraint first_aid_kit_checks_check_type_check
    check (check_type is null or check_type in (
      'Scheduled monthly check',
      'Post-use restock',
      'Pre-mobilisation spot check',
      'Annual audit'
    )) not valid,
  add constraint first_aid_kit_checks_selected_kits_check
    check (jsonb_typeof(selected_kits) = 'array' and jsonb_array_length(selected_kits) between 1 and 3) not valid,
  add constraint first_aid_kit_checks_restock_register_check
    check (jsonb_typeof(restock_register) = 'array' and jsonb_array_length(restock_register) <= 100) not valid,
  add constraint first_aid_kit_checks_check_due_check
    check (next_check_due is null or check_date is null or next_check_due > check_date) not valid,
  add constraint first_aid_kit_checks_signature_check
    check (signature like 'data:image/png;base64,%' and length(signature) between 100 and 360000) not valid;

create unique index if not exists first_aid_kit_checks_submitter_idempotency_key
  on public.first_aid_kit_checks (checked_by, idempotency_key);
create index if not exists first_aid_kit_checks_checked_by_created_at_idx
  on public.first_aid_kit_checks (checked_by, created_at desc);
create index if not exists first_aid_kit_checks_created_at_idx
  on public.first_aid_kit_checks (created_at desc);

alter table public.first_aid_kit_checks enable row level security;

drop policy if exists first_aid_kit_checks_select_own_or_admin on public.first_aid_kit_checks;
drop policy if exists first_aid_kit_checks_insert_own on public.first_aid_kit_checks;
drop policy if exists first_aid_kit_checks_update_admin on public.first_aid_kit_checks;
drop policy if exists first_aid_kit_checks_delete_admin on public.first_aid_kit_checks;
-- Remove the original broad SELECT policy (`using (true)`), plus redundant
-- policy names from the legacy implementation. Without this cleanup the more
-- restrictive own-or-admin policy below would be ORed with public staff read.
drop policy if exists fak_read on public.first_aid_kit_checks;
drop policy if exists fak_write on public.first_aid_kit_checks;
drop policy if exists fak_admin_manage on public.first_aid_kit_checks;

create policy first_aid_kit_checks_select_own_or_admin
  on public.first_aid_kit_checks for select to authenticated
  using (checked_by = auth.uid() or is_admin());
create policy first_aid_kit_checks_insert_own
  on public.first_aid_kit_checks for insert to authenticated
  with check (checked_by = auth.uid());
create policy first_aid_kit_checks_update_admin
  on public.first_aid_kit_checks for update to authenticated
  using (is_admin()) with check (is_admin());
create policy first_aid_kit_checks_delete_admin
  on public.first_aid_kit_checks for delete to authenticated
  using (is_admin());

-- Use the shared timestamp helper when the portal schema includes it. The
-- trigger is safe to recreate and does not affect the audit identity fields.
drop trigger if exists first_aid_kit_checks_set_updated_at on public.first_aid_kit_checks;
create trigger first_aid_kit_checks_set_updated_at
  before update on public.first_aid_kit_checks
  for each row execute function set_updated_at();
