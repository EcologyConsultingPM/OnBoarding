-- Ecology Consulting Portal
-- Staff event feed for task, governance and future register workflows.

begin;

create table if not exists public.portal_events (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references auth.users(id) on delete cascade,
  event_type text not null,
  severity text not null default 'information'
    check (severity = any (array['information'::text, 'review'::text, 'approval'::text, 'action_required'::text, 'critical'::text])),
  title text not null,
  body text,
  href text,
  source_table text,
  source_id uuid,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  dismissed_at timestamptz
);

create index if not exists portal_events_recipient_active_idx
  on public.portal_events (recipient_id, created_at desc)
  where dismissed_at is null;
create index if not exists portal_events_source_idx
  on public.portal_events (source_table, source_id, created_at desc);

alter table public.portal_events enable row level security;

drop policy if exists portal_events_select_own_or_admin on public.portal_events;
create policy portal_events_select_own_or_admin
  on public.portal_events
  for select
  to authenticated
  using (recipient_id = auth.uid() or is_admin());

-- There is intentionally no direct UPDATE policy. The protected API verifies the
-- recipient and changes only read_at through its service-role query; clients cannot
-- alter severity, content, recipient, dismissal state or source metadata.
drop policy if exists portal_events_update_own_read_state on public.portal_events;

-- Inserts are owned by protected server routes using the service role. Clients
-- cannot forge an event or direct an event to another staff member.

commit;
