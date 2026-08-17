[PRE_UPDATE_AUDIT_AND_SUPABASE_SQL.md](https://github.com/user-attachments/files/31125853/PRE_UPDATE_AUDIT_AND_SUPABASE_SQL.md)
# Pre-Update Audit and Ordered Supabase SQL Editor Scripts

## Readiness decision

**Status: conditionally ready to begin the update, but not yet ready to deploy.** The source package is structurally sound, uses a dedicated Supabase project, retains server-enforced administrator access and keeps password changes under Supabase Auth. The missing `@sentry/nextjs` package has now been added to `package.json` and `package-lock.json`.

The full local production build cannot be verified until `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are supplied as local environment variables. The Vercel project must also contain these variables. The source package currently contains **design and implementation guidance** for the numbered SWMS workflow; it does **not** yet contain the finished Next.js page, API routes and Supabase migration wired into the application. Therefore, do not describe it as fully deployed or ready for operational Staff use until the full replacement files and SQL below have been applied and tested.

| Area | Audit result | Required action before production deployment |
|---|---|---|
| Project source | The Next.js/Supabase structure is coherent and preserves login, password reset, self-service password changes and logout. | Use incremental replacement files; do not rewrite the large workbook in one change. |
| Administrator access | `admin_emails` is the stated allow-list and server routes independently verify a bearer token and admin membership. | Keep server-side checks on every new admin endpoint; never rely on hidden UI alone. |
| Staff access | The current provider restricts sign-in attempts to `@ecologyconsulting.au`; the database trigger is stated to enforce this independently. | Keep the database trigger and RLS policies in place. |
| Build configuration | `@sentry/nextjs` is now present in `package.json` and the lock file. | Build with the required Supabase variables present; confirm the Vercel project is connected to the intended `on-boarding-ivory.vercel.app` alias. |
| SQL migration | The existing recorded SQL covers Staff progress only. No numbered SWMS tables currently exist in the documented schema. | Run Scripts 1–4 below, in order, in the Supabase SQL Editor. |
| Numbered SWMS UI/API | Not wired into the current OnBoarding navigation yet. | Add the complete page, component, API route and client data file together, then test with a non-operational test draft. |

## Supabase SQL Editor execution order

Run each script separately in the **Ecology Consulting On Boarding** Supabase project (`mqgumjgotjiphfgqdyyl`). Confirm each succeeds before moving to the next script.

> These scripts are additive. They do not alter `phases`, `sections`, `checklist_items`, `item_progress`, `item_links`, `ld_months`, `ld_modules`, `signoffs`, `admin_emails` or `staff_progress`.

### Script 1 — Preflight checks

```sql
-- Confirm the active project has the expected onboarding tables.
select table_name
from information_schema.tables
where table_schema = 'public'
  and table_name in (
    'admin_emails',
    'staff_progress',
    'whs_drafts',
    'whs_draft_risk_rows'
  )
order by table_name;

-- Confirm the administrator allow-list has entries.
select count(*) as administrator_count
from public.admin_emails;

-- Confirm whether the reusable Administrator helper already exists.
select routine_name
from information_schema.routines
where routine_schema = 'public'
  and routine_name = 'is_admin';
```

### Script 2 — Create the `is_admin()` helper if it is missing

Run this script only if Script 1 did not return `is_admin`.

```sql
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
```

### Script 3 — Create SWMS draft records

```sql
create table if not exists public.whs_drafts (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references auth.users(id) on delete cascade,
  document_type text not null check (document_type in ('swms', 'psychosocial')),
  title text not null check (char_length(trim(title)) >= 3),
  project_name text,
  site_location text,
  work_activity text not null,
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

-- Keep the timestamp current without allowing a browser client to set it.
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

drop trigger if exists whs_drafts_set_updated_at on public.whs_drafts;
create trigger whs_drafts_set_updated_at
before update on public.whs_drafts
for each row execute function public.set_updated_at();
```

### Script 4 — Create the numbered hazard and psychosocial-factor rows

```sql
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
```

### Script 5 — Verify the migration

```sql
select
  table_name,
  row_security
from information_schema.tables
where table_schema = 'public'
  and table_name in ('whs_drafts', 'whs_draft_risk_rows')
order by table_name;

select
  tablename,
  policyname,
  cmd
from pg_policies
where schemaname = 'public'
  and tablename in ('whs_drafts', 'whs_draft_risk_rows')
order by tablename, policyname;
```

## Deployment checklist

1. Add `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` to the Vercel project and local `.env.local`. Never expose the service-role key to client code.
2. Apply Scripts 1–5 in order, checking each result in the SQL Editor.
3. Copy the complete Next.js files only after the database tables and RLS policies exist.
4. Run `npm install` and `npm run build` with the Supabase variables available.
5. Test with a non-operational draft account: Staff can create/read their own draft, cannot read another Staff member’s draft, and Administrators can review any draft.
6. Confirm Vercel’s Site URL and Redirect URLs include `https://on-boarding-ivory.vercel.app/` before testing email links or password resets.
