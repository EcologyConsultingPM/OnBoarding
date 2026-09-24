-- Backfill initial version records for the Internal Generic SWMS source library.
-- The source records are seeded by 2026-09-24-ecological-field-swms.sql.

insert into public.policy_document_versions (
  document_id,
  version,
  status,
  title,
  body,
  document_link,
  storage_path,
  changed_by,
  change_note
)
select
  document.id,
  document.version,
  document.status,
  document.title,
  document.body,
  document.document_link,
  document.storage_path,
  document.approved_by,
  'Initial controlled Internal Generic SWMS library publication.'
from public.policy_documents document
where document.category = 'Internal Generic SWMS'
  and document.status = 'published'
  and document.approved_by is not null
  and not exists (
    select 1
    from public.policy_document_versions version_row
    where version_row.document_id = document.id
      and version_row.version = document.version
      and version_row.status = document.status
  );
