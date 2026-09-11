-- Assign a named person to review a policy or process document.
--
-- policy_documents already carries next_review_date, so the system knew WHEN a
-- document was due for review but never WHO had to do it. Reviews therefore had
-- no owner, did not appear in anyone's workload, and could only be chased by an
-- administrator reading the register.
--
-- Idempotent: safe to run more than once.

alter table public.policy_documents
  add column if not exists review_assigned_to  uuid references auth.users(id) on delete set null,
  add column if not exists review_assigned_by  uuid references auth.users(id) on delete set null,
  add column if not exists review_assigned_at  timestamptz,
  add column if not exists review_note         text,
  add column if not exists review_completed_at timestamptz;

-- Open assignments, which is what the workload calendar and the reviewer's
-- own list both query.
create index if not exists policy_documents_review_assignee_idx
  on public.policy_documents (review_assigned_to, next_review_date)
  where review_assigned_to is not null and review_completed_at is null;

comment on column public.policy_documents.review_assigned_to is
  'Person responsible for the next scheduled review. Feeds the workload calendar.';
comment on column public.policy_documents.review_completed_at is
  'Set when the assigned review is signed off. Null means the assignment is open.';
