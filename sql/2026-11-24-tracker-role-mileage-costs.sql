-- Apply AFTER 2026-11-24-timesheet-unassigned-import.sql. Schema/functions only:
-- no rate seeds, payroll changes, timesheet writes, or historical cost backfill.
begin;

alter table public.project_charge_rates add column if not exists mileage_rate numeric(12,2);
do $$ begin
  if not exists(select 1 from pg_constraint where conrelid='public.project_charge_rates'::regclass and conname='project_charge_rates_mileage_rate_check') then
    alter table public.project_charge_rates add constraint project_charge_rates_mileage_rate_check
      check (mileage_rate is null or (mileage_rate >= 0 and mileage_rate <= 1000000));
  end if;
end $$;

create or replace function public.ec_save_project_charge_rates(
  p_project_id uuid, p_actor_id uuid, p_expected_updated_at timestamptz, p_rates jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_actor_email text;
  v_before public.project_charge_rates%rowtype;
  v_after public.project_charge_rates%rowtype;
  v_exists boolean;
  v_role text;
  v_rate numeric;
  v_mileage numeric;
  v_rates jsonb := '{}'::jsonb;
  v_now timestamptz;
begin
  select u.email into v_actor_email from auth.users u
    where u.id=p_actor_id and u.deleted_at is null and (u.banned_until is null or u.banned_until<=now())
      and public.project_closeout_can_manage(p_actor_id) limit 1;
  if v_actor_email is null then raise exception 'Only an active administrator can confirm project charge rates.' using errcode='42501'; end if;
  if lower(btrim(v_actor_email)) not in ('aaron.dooley@ecologyconsulting.au','tony.webster@ecologyconsulting.au')
    and exists(select 1 from public.portal_visibility_overrides v where v.user_id=p_actor_id
      and v.resource_key in ('admin.projects','admin.projects.setup') and v.is_visible=false limit 1) then
    raise exception 'Project setup access is disabled for this administrator.' using errcode='42501';
  end if;
  if p_project_id is null or p_rates is null or jsonb_typeof(p_rates) is distinct from 'object'
    or not (p_rates ?& array['Senior Ecologist','Ecologist','Project Manager'])
    or exists(select 1 from jsonb_object_keys(p_rates) k(role) where k.role not in ('Senior Ecologist','Ecologist','Project Manager','Mileage')) then
    raise exception 'Provide Senior Ecologist, Ecologist, Project Manager and optional Mileage only.' using errcode='22023';
  end if;
  foreach v_role in array array['Senior Ecologist','Ecologist','Project Manager'] loop
    if jsonb_typeof(p_rates->v_role) not in ('number','string') or (p_rates->>v_role) !~ '^[0-9]+([.][0-9]+)?$' then
      raise exception 'Hourly charge rates must be positive finite numbers.' using errcode='22023';
    end if;
    v_rate := (p_rates->>v_role)::numeric;
    if v_rate<=0 or v_rate>1000000 or round(v_rate,2)<=0 then
      raise exception 'Hourly charge rates must round to positive amounts no greater than 1,000,000.' using errcode='22023';
    end if;
    v_rates := v_rates||jsonb_build_object(v_role,round(v_rate,2));
  end loop;
  if p_rates ? 'Mileage' and p_rates->'Mileage' is distinct from 'null'::jsonb then
    if jsonb_typeof(p_rates->'Mileage') not in ('number','string') or (p_rates->>'Mileage') !~ '^[0-9]+([.][0-9]{1,2})?$' then
      raise exception 'Mileage must be null or a non-negative finite rate with at most two decimal places.' using errcode='22023';
    end if;
    v_mileage := (p_rates->>'Mileage')::numeric;
    if v_mileage<0 or v_mileage>1000000 then raise exception 'Invalid Mileage charge rate.' using errcode='22023'; end if;
  end if;
  -- Same parent-first creation/update lock and create-only NULL CAS contract.
  -- Entry writers/importers acquire the entry table before this parent lock.
  perform p.id from public.projects p where p.id=p_project_id and p.deleted_at is null for update;
  if not found then raise exception 'Project not found. No charge rates saved.' using errcode='P0002'; end if;
  select c.* into v_before from public.project_charge_rates c where c.project_id=p_project_id for update;
  v_exists := found;
  if (v_exists and v_before.updated_at is distinct from p_expected_updated_at) or (not v_exists and p_expected_updated_at is not null) then
    raise exception 'Project charge rates changed concurrently. Reload before confirming; no changes saved.' using errcode='40001';
  end if;
  -- Old three-key callers cannot accidentally clear an existing mileage value.
  if not (p_rates ? 'Mileage') and v_exists then v_mileage := v_before.mileage_rate; end if;
  v_now := clock_timestamp();
  if v_exists then v_now := greatest(v_now,v_before.updated_at+interval '1 microsecond'); end if;
  insert into public.project_charge_rates(project_id,senior_ecologist_rate,ecologist_rate,project_manager_rate,mileage_rate,confirmed_by,confirmed_at,updated_at)
    values(p_project_id,(v_rates->>'Senior Ecologist')::numeric,(v_rates->>'Ecologist')::numeric,(v_rates->>'Project Manager')::numeric,v_mileage,p_actor_id,v_now,v_now)
    on conflict(project_id) do update set senior_ecologist_rate=excluded.senior_ecologist_rate,ecologist_rate=excluded.ecologist_rate,
      project_manager_rate=excluded.project_manager_rate,mileage_rate=excluded.mileage_rate,
      confirmed_by=excluded.confirmed_by,confirmed_at=excluded.confirmed_at,updated_at=excluded.updated_at returning * into v_after;
  insert into public.admin_audit_log(actor_id,action,entity_type,entity_id,project_id,resource_key,before_data,after_data,reason)
    values(p_actor_id,'project_charge_rates_confirmed','project_charge_rates',p_project_id,p_project_id,'admin.projects.setup',
      case when v_exists then to_jsonb(v_before) else '{}'::jsonb end,to_jsonb(v_after),
      'Administrator explicitly confirmed per-job labour and optional Mileage charge-out rates. Historical snapshots and stored actuals were not repriced.');
  return to_jsonb(v_after);
end $$;

create or replace function public.ec_tracker_internal_hourly_rate(p_staff_id uuid)
returns numeric language sql immutable set search_path = '' as $$
  select case public.ec_tracker_charge_role(p_staff_id) when 'Senior Ecologist' then 81 when 'Project Manager' then 70 else 75 end::numeric;
$$;

create or replace function public.ec_tracker_entry_kilometres(p_custom_data jsonb)
returns numeric language plpgsql immutable set search_path = '' as $$
declare v_value jsonb; v_km numeric;
begin
  v_value := coalesce(nullif(p_custom_data->'km','null'::jsonb),p_custom_data->'kilometres');
  if v_value is null or v_value='null'::jsonb or (jsonb_typeof(v_value)='string' and btrim(v_value#>>'{}')='') then return 0; end if;
  if jsonb_typeof(v_value) not in ('number','string') or btrim(v_value#>>'{}') !~ '^[+]?([0-9]+([.][0-9]*)?|[.][0-9]+)([eE][+-]?[0-9]+)?$' then
    raise exception 'Invalid tracker entry kilometres.' using errcode='23514';
  end if;
  v_km := (v_value#>>'{}')::numeric;
  if v_km<0 or v_km::text in ('NaN','Infinity','-Infinity') then raise exception 'Invalid tracker entry kilometres.' using errcode='23514'; end if;
  return v_km;
end $$;

create or replace function public.ec_tracker_entry_mileage_charge_rate(p_custom_data jsonb)
returns numeric language plpgsql immutable set search_path = '' as $$
declare v_rate numeric;
begin
  if p_custom_data->'mileage_charge_stamped' is distinct from 'true'::jsonb then return 0; end if;
  if jsonb_typeof(p_custom_data->'mileage_charge_rate_snapshot') is distinct from 'number' then
    raise exception 'Invalid trusted tracker mileage charge rate snapshot.' using errcode='23514';
  end if;
  v_rate := (p_custom_data->>'mileage_charge_rate_snapshot')::numeric;
  if v_rate<0 or v_rate::text in ('NaN','Infinity','-Infinity') then
    raise exception 'Invalid trusted tracker mileage charge rate snapshot.' using errcode='23514';
  end if;
  return v_rate;
end $$;

create or replace function public.ec_tracker_entry_internal_cost(p_staff_id uuid,p_hours numeric,p_custom_data jsonb)
returns numeric language plpgsql immutable set search_path = '' as $$
declare v_hourly numeric := public.ec_tracker_internal_hourly_rate(p_staff_id); v_mileage numeric := 0.90;
begin
  if p_hours is null or p_hours<0 or p_hours::text in ('NaN','Infinity','-Infinity') then raise exception 'Invalid tracker entry hours.' using errcode='23514'; end if;
  -- Old arbitrary internal metadata was never protected by the former trigger.
  -- Trust only exact confirmed-policy snapshots; otherwise use fixed policy.
  if p_custom_data->'internal_cost_stamped'='true'::jsonb
    and p_custom_data->>'internal_role'=public.ec_tracker_charge_role(p_staff_id)
    and p_custom_data->'internal_hourly_rate_snapshot'=to_jsonb(v_hourly) then
    v_hourly := (p_custom_data->>'internal_hourly_rate_snapshot')::numeric;
  end if;
  if p_custom_data->'mileage_internal_stamped'='true'::jsonb
    and p_custom_data->'mileage_internal_rate_snapshot'=to_jsonb(v_mileage) then
    v_mileage := (p_custom_data->>'mileage_internal_rate_snapshot')::numeric;
  end if;
  return p_hours*v_hourly+public.ec_tracker_entry_kilometres(p_custom_data)*v_mileage;
end $$;

create or replace function public.ec_tracker_entry_charge_total(p_project_id uuid,p_staff_id uuid,p_hours numeric,p_custom_data jsonb)
returns numeric language plpgsql security definer set search_path = '' as $$
begin
  if p_hours is null or p_hours<0 or p_hours::text in ('NaN','Infinity','-Infinity') then raise exception 'Invalid tracker entry hours.' using errcode='23514'; end if;
  return p_hours*public.ec_tracker_entry_charge_rate(p_project_id,p_staff_id,p_custom_data)
    +public.ec_tracker_entry_kilometres(p_custom_data)*public.ec_tracker_entry_mileage_charge_rate(p_custom_data);
end $$;

create or replace function public.ec_stamp_tracker_charge_rate()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_metadata jsonb := coalesce(new.custom_data,'{}'::jsonb);
  v_role text;
  v_rate numeric;
  v_mileage numeric;
  v_km numeric;
  v_configure_mileage boolean := false;
begin
  if jsonb_typeof(v_metadata) is distinct from 'object' then raise exception 'Tracker custom_data must be a JSON object.' using errcode='23514'; end if;
  v_km := public.ec_tracker_entry_kilometres(v_metadata);
  -- Preserve import_* provenance for the unassigned guard; all financial snapshot
  -- ownership is server-only. Unstamped updates cannot promote submitted values.
  select coalesce(jsonb_object_agg(k,v),'{}'::jsonb) into v_metadata from jsonb_each(v_metadata) x(k,v)
    where k !~* '^(charge_|internal_|mileage_charge_|mileage_internal_)'
      and (left(k,7)='import_' or k !~* '(^|_)(rate|rates|role|roles|stamped|snapshot|financials|profit|profitability|charge_out_spend)(_|$)');
  if tg_op='INSERT' then
    perform p.id from public.projects p where p.id=new.project_id for key share;
    if exists(select 1 from public.project_charge_rates c where c.project_id=new.project_id and c.confirmed_by is not null and c.confirmed_at is not null) then
      v_role := public.ec_tracker_charge_role(new.staff_user_id);
      v_rate := public.ec_tracker_current_charge_rate(new.project_id,new.staff_user_id);
      v_metadata := v_metadata||jsonb_build_object('charge_role',v_role,'charge_rate_snapshot',v_rate,'charge_rate_stamped',true);
    end if;
    v_metadata := v_metadata||jsonb_build_object('internal_role',public.ec_tracker_charge_role(new.staff_user_id),
      'internal_hourly_rate_snapshot',public.ec_tracker_internal_hourly_rate(new.staff_user_id),'internal_cost_stamped',true,
      'mileage_internal_rate_snapshot',0.90,'mileage_internal_stamped',true);
    v_configure_mileage := true;
  else
    if (old.custom_data->'charge_rate_stamped'='true'::jsonb or old.custom_data->'internal_cost_stamped'='true'::jsonb
      or old.custom_data->'mileage_charge_stamped'='true'::jsonb or old.custom_data->'mileage_internal_stamped'='true'::jsonb)
      and (new.staff_user_id is distinct from old.staff_user_id or new.project_id is distinct from old.project_id) then
      raise exception 'Tracker snapshot project/staff identity cannot be changed; void and replace the entry.' using errcode='23514';
    end if;
    if old.custom_data->'charge_rate_stamped'='true'::jsonb then
      v_role := public.ec_tracker_charge_role(old.staff_user_id);
      if old.custom_data->>'charge_role' is distinct from v_role then raise exception 'Invalid trusted tracker charge role snapshot.' using errcode='23514'; end if;
      v_rate := public.ec_tracker_entry_charge_rate(old.project_id,old.staff_user_id,old.custom_data);
      v_metadata := v_metadata||jsonb_build_object('charge_role',v_role,'charge_rate_snapshot',v_rate,'charge_rate_stamped',true);
    end if;
    -- Validate old cost snapshots before retaining them, including independent
    -- mileage/internal flags. Older unmarked rows use the fixed policy fallback.
    perform public.ec_tracker_entry_internal_cost(old.staff_user_id,old.hours,old.custom_data);
    if old.custom_data->'internal_cost_stamped'='true'::jsonb
      and old.custom_data->>'internal_role'=public.ec_tracker_charge_role(old.staff_user_id)
      and old.custom_data->'internal_hourly_rate_snapshot'=to_jsonb(public.ec_tracker_internal_hourly_rate(old.staff_user_id)) then
      v_metadata := v_metadata||jsonb_build_object('internal_role',old.custom_data->'internal_role',
        'internal_hourly_rate_snapshot',old.custom_data->'internal_hourly_rate_snapshot','internal_cost_stamped',true);
    end if;
    if old.custom_data->'mileage_internal_stamped'='true'::jsonb and old.custom_data->'mileage_internal_rate_snapshot'='0.90'::jsonb then
      v_metadata := v_metadata||jsonb_build_object('mileage_internal_rate_snapshot',old.custom_data->'mileage_internal_rate_snapshot','mileage_internal_stamped',true);
    end if;
    if old.custom_data->'mileage_charge_stamped'='true'::jsonb then
      v_mileage := public.ec_tracker_entry_mileage_charge_rate(old.custom_data);
      v_metadata := v_metadata||jsonb_build_object('mileage_charge_rate_snapshot',v_mileage,'mileage_charge_stamped',true);
    elsif v_metadata->'internal_cost_stamped'='true'::jsonb and v_km>0 then
      -- A post-policy entry first gaining km needs a configured rate. Legacy
      -- updates (no internal stamp) remain historical reference-only zero charge.
      v_configure_mileage := true;
    end if;
  end if;
  if v_configure_mileage then
    perform p.id from public.projects p where p.id=new.project_id for key share;
    select c.mileage_rate into v_mileage from public.project_charge_rates c
      where c.project_id=new.project_id and c.confirmed_by is not null and c.confirmed_at is not null;
    if v_mileage is null and v_km>0 then raise exception 'Configure this project Mileage charge-out rate before recording positive kilometres.' using errcode='23514'; end if;
    if v_mileage is not null then
      v_metadata := v_metadata||jsonb_build_object('mileage_charge_rate_snapshot',v_mileage,'mileage_charge_stamped',true);
    end if;
  end if;
  new.custom_data := v_metadata;
  return new;
end $$;

-- No new policies or table-write grants. Internal values remain service-only.
revoke all on function public.ec_tracker_internal_hourly_rate(uuid) from public,anon,authenticated;
revoke all on function public.ec_tracker_entry_kilometres(jsonb) from public,anon,authenticated;
revoke all on function public.ec_tracker_entry_mileage_charge_rate(jsonb) from public,anon,authenticated;
revoke all on function public.ec_tracker_entry_internal_cost(uuid,numeric,jsonb) from public,anon,authenticated;
revoke all on function public.ec_tracker_entry_charge_total(uuid,uuid,numeric,jsonb) from public,anon,authenticated;
revoke all on function public.ec_save_project_charge_rates(uuid,uuid,timestamptz,jsonb) from public,anon,authenticated;
revoke all on function public.ec_stamp_tracker_charge_rate() from public,anon,authenticated,service_role;
grant execute on function public.ec_tracker_internal_hourly_rate(uuid) to service_role;
grant execute on function public.ec_tracker_entry_kilometres(jsonb) to service_role;
grant execute on function public.ec_tracker_entry_mileage_charge_rate(jsonb) to service_role;
grant execute on function public.ec_tracker_entry_internal_cost(uuid,numeric,jsonb) to service_role;
grant execute on function public.ec_tracker_entry_charge_total(uuid,uuid,numeric,jsonb) to service_role;
grant execute on function public.ec_save_project_charge_rates(uuid,uuid,timestamptz,jsonb) to service_role;

-- Reviewed RPC copied from the immediately preceding migration. Only financial
-- metadata validation, totals and audit/result breakdown are extended below.
create or replace function public.ec_import_weekly_timesheets_reviewed(
  p_actor_id uuid, p_batch_id uuid, p_entries jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare
  item jsonb;
  target record;
  allocation record;
  recipient record;
  review jsonb;
  expected jsonb;
  snapshot jsonb;
  existing record;
  entry_id uuid;
  v_project_id uuid;
  v_source_id uuid;
  v_allocation_id uuid;
  v_staff_id uuid;
  work_day date;
  amount numeric;
  km numeric;
  category text;
  info text;
  fingerprint text;
  current_rate numeric;
  current_mileage numeric;
  total_mileage_charge numeric := 0;
  total_internal_cost numeric := 0;
  unassigned_mileage_charge numeric := 0;
  unassigned_internal_cost numeric := 0;
  is_unassigned boolean;
  metadata jsonb;
  prior_import_context text := current_setting('ec.timesheet_import_context', true);
  request_role text := coalesce(nullif(current_setting('request.jwt.claim.role', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role');
  session_role text := nullif(current_setting('role', true), 'none');
  existing_count integer;
  row_count integer := 0;
  allocation_count integer := 0;
  notification_count integer := 0;
  unassigned_count integer := 0;
  unassigned_hours numeric := 0;
  unassigned_charge numeric := 0;
  total_hours numeric := 0;
  total_km numeric := 0;
  total_charge numeric := 0;
  consumed numeric;
  spent numeric;
  internal_spent numeric;
begin
  -- Check the original request/session, not current_user (which is the
  -- SECURITY DEFINER owner). Function EXECUTE stays service-only as well.
  if (request_role is not null and request_role <> 'service_role')
    or not coalesce(session_role = 'service_role' or (session_role is null and
      (session_user = 'service_role' or exists(select 1 from pg_catalog.pg_roles r where r.rolname = session_user and r.rolsuper))), false) then
    raise exception 'A service-authorized administrator import is required.' using errcode='42501';
  end if;
  if not exists(select 1 from auth.users u where u.id=p_actor_id and u.deleted_at is null
    and (u.banned_until is null or u.banned_until<=now())
    and public.project_closeout_can_manage(p_actor_id) limit 1) then
    raise exception 'Only an active administrator can import timesheets.' using errcode='42501';
  end if;
  if exists(select 1 from auth.users u where u.id=p_actor_id
    and lower(u.email) not in ('aaron.dooley@ecologyconsulting.au','tony.webster@ecologyconsulting.au')
    and exists(select 1 from public.portal_visibility_overrides v where v.user_id=u.id
      and v.resource_key in ('admin.projects','admin.projects.tracker') and v.is_visible=false limit 1) limit 1) then
    raise exception 'Project Tracker import access is disabled for this administrator.' using errcode='42501';
  end if;
  if p_batch_id is null or jsonb_typeof(p_entries) is distinct from 'array'
    or jsonb_array_length(p_entries) not between 1 and 1000 then
    raise exception 'Import requires between 1 and 1000 reviewed entries.';
  end if;
  perform pg_advisory_xact_lock(20261119,1);
  -- Match ordinary staff writes: entry-table BEFORE project/rate/source locks.
  lock table public.project_tracker_entries in share row exclusive mode;
  perform p.id from public.projects p where p.id in (
    select (e->>'project_id')::uuid from jsonb_array_elements(p_entries) e
  ) order by p.id for update;
  perform r.project_id from public.project_charge_rates r where r.project_id in (
    select (e->>'project_id')::uuid from jsonb_array_elements(p_entries) e
  ) order by r.project_id for share;
  perform s.id from public.project_budget_sources s where s.project_id in (
    select (e->>'project_id')::uuid from jsonb_array_elements(p_entries) e
  ) order by s.id for update;
  perform a.id from public.project_budget_allocations a where a.id in (
    select (e->>'budget_allocation_id')::uuid from jsonb_array_elements(p_entries) e
  ) order by a.id for update;

  for item in select value from jsonb_array_elements(p_entries) loop
    v_project_id := (item->>'project_id')::uuid;
    v_source_id := (item->>'budget_source_id')::uuid;
    v_allocation_id := (item->>'budget_allocation_id')::uuid;
    v_staff_id := (item->>'staff_user_id')::uuid;
    work_day := (item->>'work_date')::date;
    amount := (item->>'hours')::numeric;
    metadata := item->'custom_data';
    km := (metadata->>'km')::numeric;
    category := trim(item->>'activity_category');
    info := trim(item->>'activity_information');
    fingerprint := metadata->>'import_fingerprint';
    review := metadata->'import_duplicate_review';
    expected := review->'expected_entries';
    is_unassigned := coalesce(metadata->>'budget_assignment'='unassigned', false);
    if jsonb_typeof(item) is distinct from 'object' or jsonb_typeof(metadata) is distinct from 'object'
      or amount is null or amount::text in ('NaN','Infinity','-Infinity') or amount<=0 or amount>24
      or amount<>round(amount,2) or work_day is null or work_day<'1900-01-01' or work_day>'2200-12-31'
      or category is null or char_length(category) not between 1 and 120
      or info is null or char_length(info) not between 1 and 5000
      or fingerprint is null or fingerprint !~ '^[a-f0-9]{64}$'
      or (km is not null and (km::text in ('NaN','Infinity','-Infinity') or km<0 or km>100000)) then
      raise exception 'Invalid values in reviewed timesheet row.';
    end if;
    -- Omission/stale refs never silently opt out. Legacy allocated callers may
    -- omit budget_assignment; both refs must still resolve normally below.
    if (is_unassigned and (not (item ?& array['budget_source_id','budget_allocation_id'])
        or item->'budget_source_id' is distinct from 'null'::jsonb
        or item->'budget_allocation_id' is distinct from 'null'::jsonb))
      or (not is_unassigned and (v_source_id is null or v_allocation_id is null)) then
      raise exception 'Choose both budget references or explicitly choose unassigned with both references SQL NULL.' using errcode='23514';
    end if;
    if jsonb_typeof(review) is distinct from 'object' or coalesce(review->>'decision','') not in ('new','separate')
      or jsonb_typeof(expected) is distinct from 'array' or jsonb_array_length(expected)>50 then
      raise exception 'A current duplicate-review decision is required.' using errcode='40001';
    end if;
    if not exists(select 1 from auth.users u where u.id=v_staff_id and u.deleted_at is null
      and (u.banned_until is null or u.banned_until<=now()) limit 1) then
      raise exception 'Staff account changed. Refresh the preview.' using errcode='40001';
    end if;
    if is_unassigned then
      select p.name into target from public.projects p
        where p.id=v_project_id and p.status='active' and p.deleted_at is null limit 1;
      if not found then raise exception 'Project changed. Refresh the preview.' using errcode='40001'; end if;
    else
      select p.name,s.service_period_start,s.service_period_end,a.allocation_name,a.allocation_code
        into target from public.projects p
        join public.project_budget_sources s on s.project_id=p.id and s.id=v_source_id
        join public.project_budget_allocations a on a.project_id=p.id and a.budget_source_id=s.id and a.id=v_allocation_id
        where p.id=v_project_id and p.status='active' and p.deleted_at is null
          and s.approval_status='approved' and s.source_type in ('original','variation')
          and a.status='active' and a.staff_visible=true limit 1;
      if not found then raise exception 'Project or budget allocation changed. Refresh the preview.' using errcode='40001'; end if;
      -- Approved import targets cannot silently consume a different legacy
      -- single allocation merely because it is the only available budget.
      if public.ec_timesheet_import_text(category) in ('general project management','fieldwork travel','gis mapping','qa review','desktop assessment','internal meeting','other')
        and public.ec_timesheet_import_text(category)<>public.ec_timesheet_import_text(target.allocation_name)
        and left(public.ec_timesheet_import_text(category),40)<>public.ec_timesheet_import_text(target.allocation_code) then
        raise exception 'Budget allocation no longer matches the mapped import category.' using errcode='40001';
      end if;
      if target.service_period_start is not null or target.service_period_end is not null then
        if target.service_period_start is null or target.service_period_end is null
          or work_day not between target.service_period_start and target.service_period_end then
          raise exception 'Work date falls outside the approved source period.' using errcode='40001';
        end if;
        if public.ec_timesheet_import_text(category)<>public.ec_timesheet_import_text(target.allocation_name)
          and left(public.ec_timesheet_import_text(category),40)<>public.ec_timesheet_import_text(target.allocation_code) then
          raise exception 'Monthly allocation no longer matches the category.' using errcode='40001';
        end if;
      elsif exists(select 1 from public.project_budget_sources s where s.project_id=v_project_id
        and s.approval_status='approved' and s.source_type in ('original','variation')
        and (s.service_period_start is not null or s.service_period_end is not null) limit 1) then
        raise exception 'Select the approved period-specific budget for this project.' using errcode='40001';
      end if;
    end if;
    if not exists(select 1 from public.project_charge_rates r where r.project_id=v_project_id
      and r.confirmed_by is not null and r.confirmed_at is not null limit 1) then
      raise exception 'Confirm the job-specific charge-out rates before importing.' using errcode='40001';
    end if;
    current_rate := public.ec_tracker_current_charge_rate(v_project_id,v_staff_id);
    if (metadata->>'import_expected_charge_rate')::numeric is distinct from current_rate
      or metadata->>'import_charge_role' is distinct from public.ec_tracker_charge_role(v_staff_id) then
      raise exception 'The job charge rate changed since review. Refresh the preview.' using errcode='40001';
    end if;
    select r.mileage_rate into current_mileage from public.project_charge_rates r where r.project_id=v_project_id;
    if coalesce(km,0)>0 and (current_mileage is null
      or jsonb_typeof(metadata->'import_expected_mileage_rate') is distinct from 'number'
      or (metadata->>'import_expected_mileage_rate')::numeric is distinct from current_mileage) then
      raise exception 'The job Mileage charge rate is missing or changed since review. Refresh the preview.' using errcode='40001';
    end if;
    -- Exact/possible duplicate identity deliberately excludes budget assignment.
    if exists(select 1 from public.project_tracker_entries e where e.custom_data->>'import_fingerprint'=fingerprint
      or (e.project_id=v_project_id and e.staff_user_id=v_staff_id and e.work_date=work_day
        and round(e.hours,2)=amount
        and public.ec_timesheet_import_text(e.activity_category)=public.ec_timesheet_import_text(category)
        and public.ec_timesheet_import_text(case when e.activity_information='Imported weekly timesheet entry — no comments supplied.' then '' else e.activity_information end)
          =public.ec_timesheet_import_text(case when info='Imported weekly timesheet entry — no comments supplied.' then '' else info end)
        and round(case when coalesce(e.custom_data->>'km',e.custom_data->>'kilometres','') ~ '^[0-9]+(\.[0-9]+)?$'
          then coalesce(e.custom_data->>'km',e.custom_data->>'kilometres')::numeric else null end,2) is not distinct from round(km,2)) limit 1) then
      raise exception 'An identical entry already exists; this batch was not imported.' using errcode='23505';
    end if;
    select count(*) into existing_count from public.project_tracker_entries e
      where e.project_id=v_project_id and e.staff_user_id=v_staff_id and e.work_date=work_day and e.hours>0
        and public.ec_timesheet_import_text(e.activity_category)=public.ec_timesheet_import_text(category)
        and (e.custom_data->>'import_batch_id') is distinct from p_batch_id::text;
    if existing_count<>jsonb_array_length(expected) then
      raise exception 'Related tracker entries changed after review; refresh the preview.' using errcode='40001';
    end if;
    if existing_count>0 or exists(select 1 from public.project_tracker_entries e
      where e.project_id=v_project_id and e.staff_user_id=v_staff_id and e.work_date=work_day and e.hours>0
        and public.ec_timesheet_import_text(e.activity_category)=public.ec_timesheet_import_text(category)
        and e.custom_data->>'import_batch_id'=p_batch_id::text limit 1) then
      if review->>'decision'<>'separate' or char_length(trim(coalesce(review->>'reason','')))<10 then
        raise exception 'Confirm separate work with a substantive reason before adding overlapping hours.' using errcode='40001';
      end if;
    end if;
    if review->>'decision'='separate' and (char_length(trim(coalesce(review->>'reason',''))) not between 10 and 1000
      or coalesce(review->>'reason','') !~ '[[:alnum:]]'
      or coalesce(review->>'review_token','') !~ '^[a-f0-9]{64}$') then
      raise exception 'A separate-work reason must contain between 10 and 1000 characters.';
    end if;
    if (select count(distinct x->>'id') from jsonb_array_elements(expected) x)<>jsonb_array_length(expected) then
      raise exception 'Review entry references must be unique.' using errcode='40001';
    end if;
    for snapshot in select value from jsonb_array_elements(expected) loop
      select e.* into existing from public.project_tracker_entries e where e.id=(snapshot->>'id')::uuid
        and e.project_id=v_project_id and e.staff_user_id=v_staff_id and e.work_date=work_day and e.hours>0
        and public.ec_timesheet_import_text(e.activity_category)=public.ec_timesheet_import_text(category) limit 1;
      if not found or existing.updated_at is distinct from (snapshot->>'updated_at')::timestamptz
        or existing.work_date is distinct from (snapshot->>'work_date')::date
        or existing.hours is distinct from (snapshot->>'hours')::numeric
        or existing.activity_category is distinct from snapshot->>'activity_category'
        or existing.activity_information is distinct from snapshot->>'activity_information'
        or coalesce(existing.custom_data->'km','null'::jsonb) is distinct from coalesce(snapshot->'km','null'::jsonb)
        or coalesce(existing.custom_data->'kilometres','null'::jsonb) is distinct from coalesce(snapshot->'kilometres','null'::jsonb) then
        raise exception 'A reviewed existing entry changed; refresh the comparison.' using errcode='40001';
      end if;
    end loop;
    perform set_config('ec.timesheet_import_context', jsonb_build_object('actor_id',p_actor_id,
      'batch_id',p_batch_id,'fingerprint',fingerprint,'project_id',v_project_id,'staff_id',v_staff_id)::text, true);
    insert into public.project_tracker_entries(project_id,budget_source_id,budget_allocation_id,staff_user_id,entered_by_admin_id,
      work_date,activity_category,activity_information,hours,status,notable_issues,custom_data)
    values(v_project_id,v_source_id,v_allocation_id,v_staff_id,p_actor_id,work_day,category,info,amount,'completed',null,
      metadata||jsonb_build_object('import_batch_id',p_batch_id)) returning id into entry_id;
    perform set_config('ec.timesheet_import_context', coalesce(prior_import_context,''), true);
    row_count:=row_count+1;
    total_hours:=total_hours+amount;
    total_km:=total_km+coalesce(km,0);
    total_charge:=total_charge+amount*current_rate;
    total_mileage_charge:=total_mileage_charge+coalesce(km,0)*coalesce(current_mileage,0);
    total_internal_cost:=total_internal_cost+amount*public.ec_tracker_internal_hourly_rate(v_staff_id)+coalesce(km,0)*0.90;
    if is_unassigned then
      unassigned_count:=unassigned_count+1;
      unassigned_hours:=unassigned_hours+amount;
      unassigned_charge:=unassigned_charge+amount*current_rate;
      unassigned_mileage_charge:=unassigned_mileage_charge+coalesce(km,0)*coalesce(current_mileage,0);
      unassigned_internal_cost:=unassigned_internal_cost+amount*public.ec_tracker_internal_hourly_rate(v_staff_id)+coalesce(km,0)*0.90;
    end if;
  end loop;

  -- NULL is NOT an allocation. Unassigned actuals are summed independently by
  -- the project API, exactly once, without mutating any funded allocation.
  for allocation in select distinct e.project_id,e.budget_allocation_id from public.project_tracker_entries e
    where e.custom_data->>'import_batch_id'=p_batch_id::text and e.budget_allocation_id is not null loop
    select coalesce(sum(e.hours),0),coalesce(sum(public.ec_tracker_entry_charge_total(e.project_id,e.staff_user_id,e.hours,e.custom_data)),0),
        coalesce(sum(public.ec_tracker_entry_internal_cost(e.staff_user_id,e.hours,e.custom_data)),0)
      into consumed,spent,internal_spent from public.project_tracker_entries e
      where e.budget_allocation_id=allocation.budget_allocation_id and e.project_id=allocation.project_id;
    update public.project_budget_allocations set hours_consumed=round(consumed,2),charge_out_spend=round(spent,2),
      internal_cost=round(internal_spent,2),updated_by=p_actor_id,updated_at=now()
      where id=allocation.budget_allocation_id and project_id=allocation.project_id;
    allocation_count:=allocation_count+1;
  end loop;
  for recipient in select e.staff_user_id,e.project_id,p.name,count(*) as entries,sum(e.hours) as hours,
      min(e.work_date) as first_day,max(e.work_date) as last_day,(array_agg(e.id order by e.created_at,e.id))[1] as first_entry_id
    from public.project_tracker_entries e join public.projects p on p.id=e.project_id
    where e.custom_data->>'import_batch_id'=p_batch_id::text group by e.staff_user_id,e.project_id,p.name loop
    insert into public.portal_events(recipient_id,event_type,severity,title,body,href,source_table,source_id)
    values(recipient.staff_user_id,'project_tracker_entry_on_behalf','information','Weekly timesheet imported: '||recipient.name,
      'An administrator imported '||recipient.entries::text||' entries totalling '||recipient.hours::text||' hours for '
      ||recipient.first_day::text||' to '||recipient.last_day::text||'.','/staff/project-tracker','project_tracker_entries',recipient.first_entry_id);
    notification_count:=notification_count+1;
  end loop;
  insert into public.admin_audit_log(actor_id,action,entity_type,entity_id,resource_key,after_data,reason)
    values(p_actor_id,'weekly_timesheets_imported','timesheet_import',p_batch_id,'admin.projects.tracker',
      jsonb_build_object('batchId',p_batch_id,'entries',row_count,'hours',total_hours,'km',total_km,'labourCharge',round(total_charge,2),'mileageCharge',round(total_mileage_charge,2),'totalCharge',round(total_charge+total_mileage_charge,2),'internalCost',round(total_internal_cost,2),
        'allocationsRecalculated',allocation_count,'unassignedCount',unassigned_count,'unassignedHours',unassigned_hours,'unassignedCharge',round(unassigned_charge+unassigned_mileage_charge,2),'unassignedLabourCharge',round(unassigned_charge,2),'unassignedMileageCharge',round(unassigned_mileage_charge,2),'unassignedInternalCost',round(unassigned_internal_cost,2)),
      'Reviewed weekly import; exact duplicates blocked across budget assignments, separate-work overlap evidence retained, confirmed job rates snapshotted; explicit unassigned time remains project-level actuals.');
  return jsonb_build_object('success',true,'importedCount',row_count,'totalHours',total_hours,'totalKilometres',total_km,
    'labourCharge',round(total_charge,2),'mileageCharge',round(total_mileage_charge,2),'totalCharge',round(total_charge+total_mileage_charge,2),'internalCost',round(total_internal_cost,2),'batchId',p_batch_id,'allocationsRecalculated',allocation_count,'notificationsCreated',notification_count,
    'unassignedCount',unassigned_count,'unassignedHours',unassigned_hours,'unassignedCharge',round(unassigned_charge+unassigned_mileage_charge,2),'unassignedLabourCharge',round(unassigned_charge,2),'unassignedMileageCharge',round(unassigned_mileage_charge,2),'unassignedInternalCost',round(unassigned_internal_cost,2));
end;
$fn$;
revoke all on function public.ec_import_weekly_timesheets_reviewed(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.ec_import_weekly_timesheets_reviewed(uuid,uuid,jsonb) to service_role;

notify pgrst,'reload schema';
commit;
