-- ============================================================
-- Per-user onboarding progress
-- Already applied directly to the live database via Supabase MCP.
-- Kept here for the repo's own record/history.
-- ============================================================
create table if not exists public.staff_progress (
  user_id    uuid not null references auth.users(id) on delete cascade,
  item_id    uuid not null references public.checklist_items(id) on delete cascade,
  done       boolean not null default false,
  item_date  text default '',
  notes      text default '',
  updated_at timestamptz not null default now(),
  primary key (user_id, item_id)
);

alter table public.staff_progress enable row level security;

-- is_admin() already exists (created earlier, hardened with search_path).

drop policy if exists sp_select on public.staff_progress;
create policy sp_select on public.staff_progress
  for select
  using (auth.uid() = user_id or public.is_admin());

drop policy if exists sp_insert on public.staff_progress;
create policy sp_insert on public.staff_progress
  for insert
  with check (auth.uid() = user_id);

drop policy if exists sp_update on public.staff_progress;
create policy sp_update on public.staff_progress
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
