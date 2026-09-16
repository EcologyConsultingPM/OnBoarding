begin;

-- EC-OPS-PMC-001 Rev 2. The application route performs the complete allowlist,
-- row-order, field-length and corrective-action checks. This database check is
-- deliberately scoped to the controlled pre_mobilisation type, so legacy and
-- generic WHS forms retain their existing JSON details contract.
alter table public.whs_forms
  drop constraint if exists whs_forms_pre_mobilisation_integrity_chk;

alter table public.whs_forms
  add constraint whs_forms_pre_mobilisation_integrity_chk
  check (
    form_type <> 'pre_mobilisation'
    or (
      details is not null
      and details ->> 'documentCode' = 'EC-OPS-PMC-001'
      and details ->> 'documentRevision' = '2'
      and details ->> 'proceedStatus' in ('cleared', 'blocked')
      and jsonb_typeof(details -> 'metadata') = 'object'
      and jsonb_typeof(details -> 'conditions') = 'object'
      and jsonb_typeof(details -> 'approval') = 'object'
      and jsonb_typeof(details -> 'checks') = 'array'
      and jsonb_array_length(details -> 'checks') = 40
      and nullif(trim(details #>> '{metadata,project}'), '') is not null
      and nullif(trim(details #>> '{metadata,jobNumber}'), '') is not null
      and nullif(trim(details #>> '{metadata,location}'), '') is not null
      and nullif(trim(details #>> '{metadata,date}'), '') is not null
      and nullif(trim(details #>> '{metadata,vehicleRegistration}'), '') is not null
      and nullif(trim(details #>> '{approval,name}'), '') is not null
      and nullif(trim(details #>> '{approval,signature}'), '') is not null
    )
  ) not valid;

-- Retain the 2026-09-02 idempotency contract. This statement is safe when the
-- prior migration has already created the index and makes the dependency clear
-- for a database restored from a partial migration history.
create unique index if not exists whs_forms_created_by_submission_key_uidx
  on public.whs_forms (created_by, submission_key)
  where submission_key is not null;

commit;
