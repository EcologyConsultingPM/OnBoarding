begin;

-- EC-OPS-PMC-001 Rev 4 adds a separate 15-row biological checklist.
-- No submissions are rewritten. Keep the original Rev 2/3 acceptance rules and
-- NOT VALID legacy preservation; the replacement check applies to new writes.
-- Procedural type guards precede array operations so malformed JSON fails the
-- CHECK constraint, rather than raising an uncontrolled JSON operation error.
create or replace function public.pre_mobilisation_details_integrity_valid(p_details jsonb)
returns boolean
language plpgsql
immutable
set search_path = pg_catalog
as $$
declare
  core_ids constant text[] := array[
    'V1', 'V2', 'V3', 'V4', 'V5', 'V6', 'V7', 'V8', 'V9', 'V10', 'V11', 'V12', 'V13',
    'E1', 'E2', 'E3', 'E4', 'E5', 'E6', 'E7', 'E8', 'E9',
    'T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'T8', 'T9', 'T10',
    'P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8'
  ];
  row_data jsonb;
  row_number bigint;
  has_issues boolean := false;
begin
  if not coalesce(
    jsonb_typeof(p_details) = 'object'
    and p_details ->> 'documentCode' = 'EC-OPS-PMC-001'
    and p_details ->> 'documentRevision' in ('2', '3', '4')
    and p_details ->> 'proceedStatus' in ('cleared', 'blocked')
    and jsonb_typeof(p_details -> 'metadata') = 'object'
    and jsonb_typeof(p_details -> 'conditions') = 'object'
    and jsonb_typeof(p_details -> 'approval') = 'object'
    and jsonb_typeof(p_details -> 'checks') = 'array'
    and nullif(trim(p_details #>> '{metadata,project}'), '') is not null
    and nullif(trim(p_details #>> '{metadata,jobNumber}'), '') is not null
    and nullif(trim(p_details #>> '{metadata,location}'), '') is not null
    and nullif(trim(p_details #>> '{metadata,date}'), '') is not null
    and nullif(trim(p_details #>> '{metadata,vehicleRegistration}'), '') is not null
    and nullif(trim(p_details #>> '{approval,name}'), '') is not null
    and nullif(trim(p_details #>> '{approval,signature}'), '') is not null,
    false
  ) then
    return false;
  end if;

  if jsonb_array_length(p_details -> 'checks') <> 40 then
    return false;
  end if;

  -- Deliberately do not impose new row, enum or biological requirements on the
  -- prior revisions. Their 40-row contract and stored data remain unchanged.
  if p_details ->> 'documentRevision' in ('2', '3') then
    return true;
  end if;

  if not coalesce(
    p_details -> 'documentRevision' = '4'::jsonb
    and (p_details - array['documentCode', 'documentRevision', 'metadata', 'checks', 'biologicalChecks', 'conditions', 'approval', 'proceedStatus']) = '{}'::jsonb
    and jsonb_typeof(p_details -> 'biologicalChecks') = 'array',
    false
  ) then
    return false;
  end if;
  if jsonb_array_length(p_details -> 'biologicalChecks') <> 15 then
    return false;
  end if;

  for row_data, row_number in
    select value, ordinality from jsonb_array_elements(p_details -> 'checks') with ordinality
  loop
    if not coalesce(jsonb_typeof(row_data) = 'object', false) then
      return false;
    end if;
    if not coalesce(
      (row_data - array['id', 'outcome', 'action']) = '{}'::jsonb
      and row_data ->> 'id' = core_ids[row_number::integer]
      and row_data ->> 'outcome' in ('pass', 'fail', 'na')
      and jsonb_typeof(row_data -> 'action') = 'string'
      and length(trim(row_data ->> 'action')) <= 1000,
      false
    ) then
      return false;
    end if;
    if row_data ->> 'outcome' = 'fail' then
      if not coalesce(row_data ->> 'action' ~ '[^[:space:]]', false) then
        return false;
      end if;
      has_issues := true;
    end if;
  end loop;

  for row_data, row_number in
    select value, ordinality from jsonb_array_elements(p_details -> 'biologicalChecks') with ordinality
  loop
    if not coalesce(jsonb_typeof(row_data) = 'object', false) then
      return false;
    end if;
    if not coalesce(
      (row_data - array['id', 'outcome', 'action']) = '{}'::jsonb
      and row_data ->> 'id' = 'B' || row_number::text
      and row_data ->> 'outcome' in ('yes', 'no', 'na')
      and jsonb_typeof(row_data -> 'action') = 'string'
      and length(trim(row_data ->> 'action')) <= 1000,
      false
    ) then
      return false;
    end if;
    if row_data ->> 'outcome' = 'no' then
      if not coalesce(row_data ->> 'action' ~ '[^[:space:]]', false) then
        return false;
      end if;
      has_issues := true;
    end if;
  end loop;

  return coalesce(
    p_details ->> 'proceedStatus' = case when has_issues then 'blocked' else 'cleared' end
    and jsonb_typeof(p_details #> '{approval,failedItemsAction}') = 'string'
    and length(trim(p_details #>> '{approval,failedItemsAction}')) <= 4000
    and (not has_issues or p_details #>> '{approval,failedItemsAction}' ~ '[^[:space:]]'),
    false
  );
end;
$$;

alter table public.whs_forms
  drop constraint if exists whs_forms_pre_mobilisation_integrity_chk;

alter table public.whs_forms
  add constraint whs_forms_pre_mobilisation_integrity_chk
  check (coalesce(
    form_type <> 'pre_mobilisation'
    or public.pre_mobilisation_details_integrity_valid(details),
    false
  )) not valid;

-- Retain repeat-tap/mobile-retry idempotency; no existing indexes are dropped.
create unique index if not exists whs_forms_created_by_submission_key_uidx
  on public.whs_forms (created_by, submission_key)
  where submission_key is not null;

commit;
