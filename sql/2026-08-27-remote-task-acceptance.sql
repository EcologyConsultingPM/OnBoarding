-- Ecology Consulting Portal
-- Acceptance-driven Remote Task workflow
--
-- Purpose:
--   1. A task remains unconfirmed until its assigned staff member accepts it.
--   2. The existing staff portal calendar derives task deadlines from accepted tasks.
--   3. No external calendar provider, email sender, or new calendar table is required.
--
-- Apply only after the accompanying route and client components are deployed.
-- Existing row-level-security policies can remain unchanged because the protected API
-- route continues to enforce administrator assignment and assignee-only responses.

begin;

alter table public.remote_tasks
  add column if not exists accepted_at timestamptz,
  add column if not exists declined_at timestamptz,
  add column if not exists decline_reason text,
  add column if not exists withdrawn_at timestamptz;

-- Existing assigned tasks were issued before staff acceptance existed. Preserve them as
-- awaiting a response rather than treating them as accepted.
update public.remote_tasks
set status = 'awaiting_acceptance'
where status = 'assigned';

alter table public.remote_tasks
  drop constraint if exists remote_tasks_status_check;

alter table public.remote_tasks
  add constraint remote_tasks_status_check
  check (
    status = any (
      array[
        'awaiting_acceptance'::text,
        'accepted'::text,
        'in_progress'::text,
        'submitted'::text,
        'revising'::text,
        'complete'::text,
        'declined'::text,
        'withdrawn'::text
      ]
    )
  );

alter table public.remote_tasks
  alter column status set default 'awaiting_acceptance'::text;

create index if not exists remote_tasks_assignee_status_due_idx
  on public.remote_tasks (assigned_to, status, due_date);

commit;

-- Rollback note:
-- Do not remove acceptance-history columns after the workflow is used in production.
-- If rollback is required before adoption, restore the original check constraint and
-- default only after updating all `awaiting_acceptance` rows to `assigned`.
