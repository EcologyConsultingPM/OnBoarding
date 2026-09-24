-- Controlled Internal Governance SWMS library and daily ecological field survey selector.
-- The source documents remain distinct controlled modules. EC-GEN-SWMS-001 is a
-- selection/briefing template and does not replace a source SWMS or site ERP.

alter table public.whs_forms
  drop constraint if exists whs_forms_form_type_check;

alter table public.whs_forms
  add constraint whs_forms_form_type_check
  check (form_type = any (array[
    'daily_risk_assessment',
    'office_risk_assessment',
    'injury_incident',
    'near_miss',
    'site_erp',
    'journey_plan',
    'pre_mobilisation',
    'toolbox_talk',
    'hazard_report',
    'job_safety_analysis',
    'first_aid_kit',
    'ecological_field_swms'
  ]));

with author as (
  select id
  from auth.users
  where lower(email) = lower('tony.webster@ecologyconsulting.au')
  limit 1
), documents(doc_type, title, category, version, body, document_link, requires_ack) as (
  values
    (
      'procedure',
      'EC-SWMS01 — Risk of a person falling more than two metres',
      'Internal Generic SWMS',
      '1.0',
      'Controlled source SWMS for ecological survey and observation near elevated or unstable edges. Use with EC-GEN-SWMS-001 when the daily field activity has a fall risk over two metres.',
      'controlled:EC-SWMS01',
      false
    ),
    (
      'procedure',
      'EC-SWMS04 — Asbestos observation only',
      'Internal Generic SWMS',
      '1.0',
      'Controlled source SWMS for visual ecological observations where asbestos or asbestos-containing material may be present. Observation only: no disturbance, handling, removal, excavation or ground disturbance.',
      'controlled:EC-SWMS04',
      false
    ),
    (
      'procedure',
      'EC-SWMS06 — Work in or near a confined space',
      'Internal Generic SWMS',
      '1.0',
      'Controlled source SWMS for ecological survey in or near culverts, drains, bridge voids, underpasses, pits, pipes and enclosed waterways. Non-entry methods must be considered first.',
      'controlled:EC-SWMS06',
      false
    ),
    (
      'procedure',
      'EC-SWMS08 — Tunnel ecological survey activities',
      'Internal Generic SWMS',
      '1.0',
      'Controlled source SWMS for ecological observation and survey in, at or near tunnels, culverts and underpasses.',
      'controlled:EC-SWMS08',
      false
    ),
    (
      'procedure',
      'EC-SWMS12 — Energised electrical installations or services',
      'Internal Generic SWMS',
      '1.0',
      'Controlled source SWMS for ecological survey, pre-clearing, habitat inspection, clearing supervision and fauna work near energised electrical assets.',
      'controlled:EC-SWMS12',
      false
    ),
    (
      'procedure',
      'EC-SWMS15 — Road, rail and live traffic corridor',
      'Internal Generic SWMS',
      '1.0',
      'Controlled source SWMS for ecological fieldwork in, on or adjacent to a road, rail or other live non-pedestrian traffic corridor.',
      'controlled:EC-SWMS15',
      false
    ),
    (
      'procedure',
      'EC-SWMS16 — Powered mobile plant',
      'Internal Generic SWMS',
      '1.0',
      'Controlled source SWMS for ecological fieldwork, clearing supervision or fauna rescue where powered mobile plant is operating or may move.',
      'controlled:EC-SWMS16',
      false
    ),
    (
      'procedure',
      'EC-SWMS18 — Water and drowning risk',
      'Internal Generic SWMS',
      '1.0',
      'Controlled source SWMS for ecological survey and monitoring in or near water or other liquid where drowning, immersion or unstable footing is a risk.',
      'controlled:EC-SWMS18',
      false
    ),
    (
      'procedure',
      'EC-GEN-SWMS-001 — Generic SWMS: Ecological Field Surveys',
      'Internal Generic SWMS',
      '1.0',
      'Daily project-specific selector for ecological field surveys. Staff record the activity, crew, site conditions and emergency arrangements, then select every relevant controlled SWMS module. It does not replace a selected source SWMS or the site-specific Emergency Response Plan.',
      'controlled:EC-GEN-SWMS-001',
      false
    )
)
insert into public.policy_documents (
  created_by,
  doc_type,
  title,
  category,
  version,
  body,
  document_link,
  requires_ack,
  requires_training,
  status,
  approved_by,
  approved_at,
  published_at,
  effective_date,
  next_review_date
)
select
  author.id,
  documents.doc_type,
  documents.title,
  documents.category,
  documents.version,
  documents.body,
  documents.document_link,
  documents.requires_ack,
  false,
  'published',
  author.id,
  now(),
  now(),
  current_date,
  (current_date + interval '12 months')::date
from author
cross join documents
where not exists (
  select 1
  from public.policy_documents existing
  where existing.title = documents.title
    and existing.category = documents.category
    and existing.version = documents.version
);
