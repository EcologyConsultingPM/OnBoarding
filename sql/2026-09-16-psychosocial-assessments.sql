-- EC-WHS-PSA-001 V1.0
-- Restricted psychosocial self-risk assessment register. All reads and writes are
-- brokered by app/api/psychosocial-assessments with the service role; no browser
-- policy is granted direct access to this sensitive record set.

begin;

create table if not exists public.psychosocial_assessments (
  id uuid primary key default gen_random_uuid(),
  worker_id uuid not null references auth.users(id) on delete restrict,
  position text,
  assessment_date date,
  workplace_location text,
  scope text,
  assessment_methods jsonb not null default '[]'::jsonb,
  hazard_categories jsonb not null default '[]'::jsonb,
  category_notes jsonb not null default '{}'::jsonb,
  hazard_register jsonb not null default '[]'::jsonb,
  additional_notes text,
  discuss_in_person boolean not null default false,
  worker_declaration_signature text,
  worker_declaration_confirmed boolean not null default false,
  stage text not null default 'draft',
  is_critical boolean not null default false,
  submitted_to text,
  submitted_at timestamptz,
  submission_key text,
  whs_officer_id uuid references auth.users(id) on delete set null,
  root_cause_analysis text,
  corrective_action_plan jsonb not null default '[]'::jsonb,
  risk_ratings_validated text,
  controls_reviewed_finding text,
  additional_actions_identified text,
  individual_action_plan_required text,
  highest_residual_risk text,
  reviewed_at timestamptz,
  returned_to_worker_at timestamptz,
  returned_by text,
  return_method text,
  worker_acknowledgement_signature text,
  worker_acknowledgement_confirmed boolean not null default false,
  worker_response_before_meeting text,
  worker_acknowledged_at timestamptz,
  meeting_date date,
  meeting_time time,
  meeting_format text,
  meeting_location text,
  support_person text,
  meeting_attendees jsonb not null default '[]'::jsonb,
  meeting_outcomes text,
  matters_not_agreed text,
  follow_up_review_date date,
  next_assessment_due date,
  escalation_status text,
  escalation_details text,
  meeting_completed_at timestamptz,
  worker_signature_final text,
  worker_final_signature_confirmed boolean not null default false,
  worker_final_signed_at timestamptz,
  whs_officer_name text,
  whs_officer_review_date date,
  whs_officer_signature text,
  project_manager_name text,
  project_manager_signature text,
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint psychosocial_assessments_stage_check check (stage = any (array[
    'draft'::text, 'submitted'::text, 'whs_review'::text, 'returned_to_worker'::text,
    'worker_acknowledged'::text, 'consultation_completed'::text, 'closed'::text
  ])),
  constraint psychosocial_assessments_risk_validation_check check (
    risk_ratings_validated is null or risk_ratings_validated = any (array['Confirmed as submitted'::text, 'Amended — raised'::text, 'Amended — lowered'::text])
  ),
  constraint psychosocial_assessments_residual_risk_check check (
    highest_residual_risk is null or highest_residual_risk = any (array['Low'::text, 'Medium'::text, 'High'::text, 'Extreme'::text])
  ),
  constraint psychosocial_assessments_escalation_check check (
    escalation_status is null or escalation_status = any (array['Not required'::text, 'Escalated to leadership'::text, 'External support / referral'::text])
  )
);

-- The initial deployment may have an earlier draft table. Add audited V1.0
-- columns without dropping records, then normalise the former meeting stage.
alter table public.psychosocial_assessments
  add column if not exists category_notes jsonb not null default '{}'::jsonb,
  add column if not exists worker_declaration_confirmed boolean not null default false,
  add column if not exists submission_key text,
  add column if not exists worker_acknowledgement_confirmed boolean not null default false,
  add column if not exists worker_acknowledged_at timestamptz,
  add column if not exists meeting_outcomes text,
  add column if not exists escalation_status text,
  add column if not exists escalation_details text,
  add column if not exists meeting_completed_at timestamptz,
  add column if not exists worker_final_signature_confirmed boolean not null default false,
  add column if not exists worker_final_signed_at timestamptz;

update public.psychosocial_assessments
set stage = 'consultation_completed'
where stage = 'consultation_scheduled';

alter table public.psychosocial_assessments
  drop constraint if exists psychosocial_assessments_stage_check;
alter table public.psychosocial_assessments
  add constraint psychosocial_assessments_stage_check check (stage = any (array[
    'draft'::text, 'submitted'::text, 'whs_review'::text, 'returned_to_worker'::text,
    'worker_acknowledged'::text, 'consultation_completed'::text, 'closed'::text
  ])) not valid;
alter table public.psychosocial_assessments
  validate constraint psychosocial_assessments_stage_check;

create index if not exists psychosocial_assessments_worker_created_idx
  on public.psychosocial_assessments (worker_id, created_at desc);
create index if not exists psychosocial_assessments_stage_created_idx
  on public.psychosocial_assessments (stage, created_at desc)
  where stage <> 'closed';
create unique index if not exists psychosocial_assessments_worker_submission_key_uidx
  on public.psychosocial_assessments (worker_id, submission_key)
  where submission_key is not null;

-- The restricted register is not available through direct browser CRUD. The
-- protected Next route authorises a worker scope or administrator scope before
-- issuing service-role queries, avoiding accidental exposure through a client.
alter table public.psychosocial_assessments enable row level security;
drop policy if exists psychosocial_assessments_select_own_or_admin on public.psychosocial_assessments;
drop policy if exists psychosocial_assessments_insert_own on public.psychosocial_assessments;
drop policy if exists psychosocial_assessments_update_own_or_admin on public.psychosocial_assessments;
drop policy if exists psychosocial_assessments_service_route_only on public.psychosocial_assessments;
-- Remove policy names from the original implementation. Direct browser writes
-- bypass the controlled API validator and stage gates; with no authenticated
-- policies remaining, RLS denies browser CRUD while the service route retains
-- its server-side access after explicit worker/admin authorisation.
drop policy if exists psychosocial_admin_all on public.psychosocial_assessments;
drop policy if exists psychosocial_own_read on public.psychosocial_assessments;
drop policy if exists psychosocial_own_write on public.psychosocial_assessments;

comment on table public.psychosocial_assessments is 'EC-WHS-PSA-001 confidential psychosocial assessment register; access only through protected service routes.';
comment on column public.psychosocial_assessments.hazard_register is 'Server-derived risk_score, risk_rating and rating_band are stored per complete work activity.';
comment on column public.psychosocial_assessments.corrective_action_plan is 'Required server-side for every persisted Medium, High or Extreme activity before review and close-out.';

commit;
