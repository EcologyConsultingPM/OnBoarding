-- Apply after tracker foundation, service periods, atomic importer and both
-- 20 November charge-rate/reconciliation migrations. No rows are seeded,
-- repriced, reassigned or backfilled; both original RESTRICT FKs remain intact.
begin;

alter table public.project_tracker_entries
  alter column budget_source_id drop not null,
  alter column budget_allocation_id drop not null;

-- Keep this SECURITY INVOKER and retain the allocated branch's original SHARE
-- locks/relationship/date checks. RLS/grants are deliberately not broadened.
-- The reviewed, service-only RPC supplies a transaction-local import context.
-- A client-controlled metadata marker or GUC alone is NOT authorization: the
-- original session role/JWT must also be service_role (or a trusted SQL admin).
create or replace function public.check_project_tracker_entry_service_period()
returns trigger language plpgsql security invoker
set search_path = pg_catalog, public
as $$
declare
  source_project uuid;
  period_start date;
  period_end date;
  allocation_project uuid;
  allocation_source uuid;
  request_role text := coalesce(nullif(current_setting('request.jwt.claim.role', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role');
  session_role text := nullif(current_setting('role', true), 'none');
  request_user text := coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub');
  service_authorized boolean;
  import_context jsonb := coalesce(nullif(current_setting('ec.timesheet_import_context', true), '')::jsonb, '{}'::jsonb);
  metadata jsonb := coalesce(new.custom_data, '{}'::jsonb);
begin
  if (new.budget_source_id is null) <> (new.budget_allocation_id is null) then
    raise exception 'Budget source and allocation must either both be assigned or both be SQL NULL.' using errcode = '23514';
  end if;
  if new.budget_source_id is null then
    if jsonb_typeof(metadata) is distinct from 'object'
      or metadata ->> 'budget_assignment' is distinct from 'unassigned'
      or new.entered_by_admin_id is null
      or coalesce(metadata ->> 'import_batch_id', '') !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'
      or coalesce(metadata ->> 'import_fingerprint', '') !~ '^[a-f0-9]{64}$'
      or coalesce(metadata ->> 'import_source_row', '') !~ '^[1-9][0-9]*$'
      or char_length(btrim(coalesce(metadata ->> 'import_file_name', ''))) not between 1 and 500
      or metadata -> 'charge_rate_stamped' is distinct from 'true'::jsonb then
      raise exception 'Unassigned time requires explicit administrator import provenance and a trusted charge snapshot.' using errcode = '23514';
    end if;
    service_authorized := (request_role is null or request_role = 'service_role')
      and (session_role = 'service_role' or (session_role is null and
        (session_user = 'service_role' or exists(select 1 from pg_roles r where r.rolname = session_user and r.rolsuper))));
    if tg_op = 'INSERT' then
      if service_authorized is distinct from true
        or import_context ->> 'actor_id' is distinct from new.entered_by_admin_id::text
        or import_context ->> 'batch_id' is distinct from metadata ->> 'import_batch_id'
        or import_context ->> 'fingerprint' is distinct from metadata ->> 'import_fingerprint'
        or import_context ->> 'project_id' is distinct from new.project_id::text
        or import_context ->> 'staff_id' is distinct from new.staff_user_id::text
        or new.status is distinct from 'completed' then
        raise exception 'New unassigned time must be created by the service-authorized reviewed administrator import.' using errcode = '42501';
      end if;
      if not exists(select 1 from auth.users u where u.id = new.entered_by_admin_id
        and u.deleted_at is null and (u.banned_until is null or u.banned_until <= now())
        and public.project_closeout_can_manage(u.id) limit 1) then
        raise exception 'Unassigned time requires an active importing administrator.' using errcode = '42501';
      end if;
    else
      -- Corrections retain the original trusted history, including the original
      -- administrator even when the staff API executes using its service client.
      -- Do not re-check a historical administrator's present employment status.
      if old.budget_source_id is not null or old.budget_allocation_id is not null
        or old.custom_data ->> 'budget_assignment' is distinct from 'unassigned'
        or old.custom_data -> 'charge_rate_stamped' is distinct from 'true'::jsonb
        or new.project_id is distinct from old.project_id
        or new.staff_user_id is distinct from old.staff_user_id
        or new.entered_by_admin_id is distinct from old.entered_by_admin_id
        or (select coalesce(jsonb_object_agg(k, v), '{}'::jsonb) from jsonb_each(metadata) x(k,v) where left(k,7) = 'import_')
          is distinct from (select coalesce(jsonb_object_agg(k, v), '{}'::jsonb) from jsonb_each(old.custom_data) x(k,v) where left(k,7) = 'import_') then
        raise exception 'Corrections must preserve original unassigned import identity and provenance.' using errcode = '23514';
      end if;
      if service_authorized is distinct from true and
        (request_role is distinct from 'authenticated' or request_user is distinct from old.staff_user_id::text) then
        raise exception 'Only the staff owner or an authorized server may correct imported unassigned time.' using errcode = '42501';
      end if;
    end if;
    return new;
  end if;
  if metadata ->> 'budget_assignment' = 'unassigned' then
    raise exception 'An explicit unassigned entry cannot retain budget references.' using errcode = '23514';
  end if;

  -- Original allocated guard, unchanged: unrestricted legacy sources retain
  -- their date behavior; imported allocated rows have extra RPC eligibility checks.
  select source.project_id, source.service_period_start, source.service_period_end
    into source_project, period_start, period_end
    from public.project_budget_sources source
    where source.id = new.budget_source_id
    for share;
  if not found or source_project is distinct from new.project_id then
    raise exception using errcode = '23514', message = 'Budget source must belong to the entry project.';
  end if;
  select allocation.project_id, allocation.budget_source_id
    into allocation_project, allocation_source
    from public.project_budget_allocations allocation
    where allocation.id = new.budget_allocation_id
    for share;
  if not found or allocation_project is distinct from new.project_id
      or allocation_source is distinct from new.budget_source_id then
    raise exception using errcode = '23514', message = 'Budget allocation must belong to the entry project and budget source.';
  end if;
  if period_start is not null and
      (new.work_date is null or new.work_date < period_start or new.work_date > period_end) then
    raise exception using errcode = '23514', message = 'Work date must fall within the budget source service period.';
  end if;
  return new;
end;
$$;

-- The existing trigger continues to invoke the replaced function, after the
-- alphabetically earlier charge-rate INSERT/UPDATE stamping trigger. Do not
-- replace the stamp function, drop triggers, or change RLS policies.
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
    if is_unassigned then
      unassigned_count:=unassigned_count+1;
      unassigned_hours:=unassigned_hours+amount;
      unassigned_charge:=unassigned_charge+amount*current_rate;
    end if;
  end loop;

  -- NULL is NOT an allocation. Unassigned actuals are summed independently by
  -- the project API, exactly once, without mutating any funded allocation.
  for allocation in select distinct e.project_id,e.budget_allocation_id from public.project_tracker_entries e
    where e.custom_data->>'import_batch_id'=p_batch_id::text and e.budget_allocation_id is not null loop
    select coalesce(sum(e.hours),0),coalesce(sum(e.hours*public.ec_tracker_entry_charge_rate(e.project_id,e.staff_user_id,e.custom_data)),0)
      into consumed,spent from public.project_tracker_entries e where e.budget_allocation_id=allocation.budget_allocation_id;
    update public.project_budget_allocations set hours_consumed=round(consumed,2),charge_out_spend=round(spent,2),
      internal_cost=round(round(spent,2)*0.6,2),updated_by=p_actor_id,updated_at=now()
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
      jsonb_build_object('batchId',p_batch_id,'entries',row_count,'hours',total_hours,'km',total_km,'labourCharge',round(total_charge,2),
        'allocationsRecalculated',allocation_count,'unassignedCount',unassigned_count,'unassignedHours',unassigned_hours,'unassignedCharge',round(unassigned_charge,2)),
      'Reviewed weekly import; exact duplicates blocked across budget assignments, separate-work overlap evidence retained, confirmed job rates snapshotted; explicit unassigned time remains project-level actuals.');
  return jsonb_build_object('success',true,'importedCount',row_count,'totalHours',total_hours,'totalKilometres',total_km,
    'labourCharge',round(total_charge,2),'batchId',p_batch_id,'allocationsRecalculated',allocation_count,'notificationsCreated',notification_count,
    'unassignedCount',unassigned_count,'unassignedHours',unassigned_hours,'unassignedCharge',round(unassigned_charge,2));
end;
$fn$;
revoke all on function public.ec_import_weekly_timesheets_reviewed(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.ec_import_weekly_timesheets_reviewed(uuid,uuid,jsonb) to service_role;

-- Preserve the original name as a fail-closed wrapper around exactly this path.
create or replace function public.ec_import_weekly_timesheets(
  p_actor_id uuid, p_batch_id uuid, p_entries jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $fn$
begin
  return public.ec_import_weekly_timesheets_reviewed(p_actor_id,p_batch_id,p_entries);
end;
$fn$;
revoke all on function public.ec_import_weekly_timesheets(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.ec_import_weekly_timesheets(uuid,uuid,jsonb) to service_role;
notify pgrst,'reload schema';
commit;
