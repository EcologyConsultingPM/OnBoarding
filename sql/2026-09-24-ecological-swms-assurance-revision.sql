-- EC-GEN-SWMS-001 Revision 1.1: source-by-source high-risk hazard assurance.
-- The eight source PDFs retain their Revision 1.0 status and remain controlling.
-- This updates only the daily selector/template metadata and records its controlled version history.

with updated_document as (
  update public.policy_documents
  set
    version = '1.1',
    body = 'Daily project-specific ecological survey SWMS selector and briefing record. Revision 1.1 surfaces source-specific scope limits, prerequisites, controls, linked documents, emergency boundaries and stop-work triggers for all eight controlled hazard modules. It does not replace a selected source SWMS or site-specific Emergency Response Plan.',
    published_at = now(),
    effective_date = current_date,
    next_review_date = (current_date + interval '12 months')::date
  where document_link = 'controlled:EC-GEN-SWMS-001'
    and category = 'Internal Generic SWMS'
    and status = 'published'
  returning *
)
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
  'Revision 1.1 — source-by-source high-risk hazard assurance; expanded staff selector content while preserving all source SWMS as controlling documents.'
from updated_document document
where document.approved_by is not null
  and not exists (
    select 1
    from public.policy_document_versions version_row
    where version_row.document_id = document.id
      and version_row.version = document.version
      and version_row.status = document.status
  );
