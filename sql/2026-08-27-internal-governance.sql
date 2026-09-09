-- Ecology Consulting Portal
-- Internal Governance: controlled policies and procedures
--
-- Status flow: draft -> in_review -> pending_approval -> published -> archived.
-- Published versions are immutable through the application workflow; amendments are
-- created as a new revision. Consultation material is visible only to its selected
-- audience, while approved material is readable by all authenticated staff.

begin;

alter table public.policy_documents
  add column if not exists consultation_scope text not null default 'all_staff',
  add column if not exists consultation_user_ids uuid[] not null default '{}',
  add column if not exists consultation_starts_at timestamptz,
  add column if not exists consultation_ends_at timestamptz,
  add column if not exists submitted_for_approval_at timestamptz,
  add column if not exists approved_by uuid references auth.users(id),
  add column if not exists approved_at timestamptz,
  add column if not exists effective_date date,
  add column if not exists next_review_date date,
  add column if not exists requires_training boolean not null default false,
  add column if not exists storage_path text,
  add column if not exists supersedes_document_id uuid references public.policy_documents(id),
  add column if not exists archived_at timestamptz;

alter table public.policy_documents
  drop constraint if exists policy_documents_status_check;

alter table public.policy_documents
  add constraint policy_documents_status_check
  check (status = any (array[
    'draft'::text,
    'in_review'::text,
    'pending_approval'::text,
    'published'::text,
    'rejected'::text,
    'archived'::text,
    'superseded'::text
  ]));

alter table public.policy_documents
  drop constraint if exists policy_documents_consultation_scope_check;

alter table public.policy_documents
  add constraint policy_documents_consultation_scope_check
  check (consultation_scope = any (array['all_staff'::text, 'selected_staff'::text]));

create table if not exists public.policy_document_comments (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.policy_documents(id) on delete cascade,
  author_id uuid not null references auth.users(id),
  body text not null check (char_length(trim(body)) >= 2),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.policy_document_versions (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.policy_documents(id) on delete cascade,
  version text not null,
  status text not null,
  title text not null,
  body text,
  document_link text,
  storage_path text,
  changed_by uuid not null references auth.users(id),
  change_note text,
  recorded_at timestamptz not null default now()
);

create unique index if not exists policy_acknowledgements_one_per_user_document_idx
  on public.policy_acknowledgements (document_id, user_id);

create index if not exists policy_documents_governance_status_idx
  on public.policy_documents (doc_type, status, updated_at desc);
create index if not exists policy_documents_next_review_idx
  on public.policy_documents (next_review_date)
  where status = 'published';
create index if not exists policy_document_comments_document_idx
  on public.policy_document_comments (document_id, created_at);
create index if not exists policy_document_versions_document_idx
  on public.policy_document_versions (document_id, recorded_at desc);

-- Existing RLS policy allowed staff to see only published documents. Extend it
-- safely so In Review documents are visible only during consultation and only to
-- all staff or an explicitly selected staff list; all management remains admin-only.
drop policy if exists policy_documents_select on public.policy_documents;
create policy policy_documents_select
  on public.policy_documents
  for select
  to authenticated
  using (
    is_admin()
    or status = 'published'
    or (
      status = 'in_review'
      and (consultation_ends_at is null or consultation_ends_at >= now())
      and (
        consultation_scope = 'all_staff'
        or auth.uid() = any(consultation_user_ids)
      )
    )
  );

alter table public.policy_document_comments enable row level security;
drop policy if exists policy_comments_select_own_or_admin on public.policy_document_comments;
create policy policy_comments_select_own_or_admin
  on public.policy_document_comments
  for select
  to authenticated
  using (author_id = auth.uid() or is_admin());
drop policy if exists policy_comments_insert_author on public.policy_document_comments;
create policy policy_comments_insert_author
  on public.policy_document_comments
  for insert
  to authenticated
  with check (author_id = auth.uid());

alter table public.policy_document_versions enable row level security;
drop policy if exists policy_versions_admin_only on public.policy_document_versions;
create policy policy_versions_admin_only
  on public.policy_document_versions
  for select
  to authenticated
  using (is_admin());

-- Private storage. Administrators may upload source documents; the protected
-- Internal Governance API issues short-lived signed URLs only after it confirms
-- the reader has access to the document's current folder/status.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'governance-documents',
  'governance-documents',
  false,
  26214400,
  array['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document']
)
on conflict (id) do nothing;

drop policy if exists governance_documents_upload_admin on storage.objects;
create policy governance_documents_upload_admin
  on storage.objects
  for insert
  to authenticated
  with check (bucket_id = 'governance-documents' and is_admin());

drop policy if exists governance_documents_update_admin on storage.objects;
create policy governance_documents_update_admin
  on storage.objects
  for update
  to authenticated
  using (bucket_id = 'governance-documents' and is_admin())
  with check (bucket_id = 'governance-documents' and is_admin());

drop policy if exists governance_documents_delete_admin on storage.objects;
create policy governance_documents_delete_admin
  on storage.objects
  for delete
  to authenticated
  using (bucket_id = 'governance-documents' and is_admin());

commit;
