-- No production timesheet data is seeded or rewritten by this migration.
alter table public.project_tracker_entries
  add column if not exists entered_by_admin_id uuid references auth.users(id) on delete set null;

create unique index if not exists project_tracker_import_fingerprint_unique
  on public.project_tracker_entries ((custom_data->>'import_fingerprint'))
  where custom_data->>'import_fingerprint' is not null;

create or replace function public.ec_timesheet_import_text(p_text text)
returns text language sql immutable set search_path = '' as $fn$
  select trim(regexp_replace(lower(regexp_replace(normalize(coalesce(p_text,''),NFKD),U&'[\0300-\036f]','','g')), '[^a-z0-9]+', ' ', 'g'));
$fn$;

create or replace function public.ec_import_weekly_timesheets(
  p_actor_id uuid, p_batch_id uuid, p_entries jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare
  item jsonb;
  target record;
  allocation record;
  recipient record;
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
  row_count integer := 0;
  allocation_count integer := 0;
  notification_count integer := 0;
  total_hours numeric := 0;
  total_km numeric := 0;
  consumed numeric;
  spent numeric;
begin
  if not public.project_closeout_can_manage(p_actor_id) then
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
  -- Serialize importer requests; table lock also prevents a concurrent staff
  -- insert/correction/delete from racing the final duplicate check or totals.
  perform pg_advisory_xact_lock(20261119,1);
  perform p.id from public.projects p where p.id in (
    select (e->>'project_id')::uuid from jsonb_array_elements(p_entries) e
  ) order by p.id for update;
  perform s.id from public.project_budget_sources s where s.project_id in (
    select (e->>'project_id')::uuid from jsonb_array_elements(p_entries) e
  ) order by s.id for update;
  perform a.id from public.project_budget_allocations a where a.id in (
    select (e->>'budget_allocation_id')::uuid from jsonb_array_elements(p_entries) e
  ) order by a.id for update;
  lock table public.project_tracker_entries in share row exclusive mode;

  for item in select value from jsonb_array_elements(p_entries) loop
    v_project_id := (item->>'project_id')::uuid;
    v_source_id := (item->>'budget_source_id')::uuid;
    v_allocation_id := (item->>'budget_allocation_id')::uuid;
    v_staff_id := (item->>'staff_user_id')::uuid;
    work_day := (item->>'work_date')::date;
    amount := (item->>'hours')::numeric;
    km := (item->'custom_data'->>'km')::numeric;
    category := trim(item->>'activity_category');
    info := trim(item->>'activity_information');
    fingerprint := item->'custom_data'->>'import_fingerprint';
    if amount is null or amount::text in ('NaN','Infinity','-Infinity') or amount<=0 or amount>24
      or amount<>round(amount,2) or work_day is null or work_day<'1900-01-01' or work_day>'2200-12-31'
      or category is null or char_length(category) not between 1 and 120
      or info is null or char_length(info) not between 1 and 5000
      or fingerprint is null or fingerprint !~ '^[a-f0-9]{64}$'
      or (km is not null and (km::text in ('NaN','Infinity','-Infinity') or km<0 or km>100000)) then
      raise exception 'Invalid values in reviewed timesheet row.';
    end if;
    if not exists(select 1 from auth.users u where u.id=v_staff_id and u.deleted_at is null
      and (u.banned_until is null or u.banned_until<=now()) limit 1) then
      raise exception 'Staff account changed. Refresh the preview.' using errcode='40001';
    end if;
    select p.name,p.default_hourly_rate,s.service_period_start,s.service_period_end,a.allocation_name,a.allocation_code
      into target from public.projects p
      join public.project_budget_sources s on s.project_id=p.id and s.id=v_source_id
      join public.project_budget_allocations a on a.project_id=p.id and a.budget_source_id=s.id and a.id=v_allocation_id
      where p.id=v_project_id and p.status='active' and p.deleted_at is null
        and s.approval_status='approved' and s.source_type in ('original','variation')
        and a.status='active' and a.staff_visible=true limit 1;
    if not found then raise exception 'Project or budget allocation changed. Refresh the preview.' using errcode='40001'; end if;
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
    if exists(select 1 from public.project_tracker_entries e where e.custom_data->>'import_fingerprint'=fingerprint
      or (e.project_id=v_project_id and e.staff_user_id=v_staff_id and e.work_date=work_day
        and round(e.hours,2)=amount
        and public.ec_timesheet_import_text(e.activity_category)=public.ec_timesheet_import_text(category)
        and public.ec_timesheet_import_text(case when e.activity_information='Imported weekly timesheet entry — no comments supplied.' then '' else e.activity_information end)
          =public.ec_timesheet_import_text(case when info='Imported weekly timesheet entry — no comments supplied.' then '' else info end)
        and round(case when coalesce(e.custom_data->>'km',e.custom_data->>'kilometres','') ~ '^[0-9]+(\.[0-9]+)?$'
          then coalesce(e.custom_data->>'km',e.custom_data->>'kilometres')::numeric else null end,2) is not distinct from round(km,2)) limit 1) then
      raise exception 'An identical entry already exists. Refresh the preview; no entries were imported.' using errcode='23505';
    end if;
    insert into public.project_tracker_entries(project_id,budget_source_id,budget_allocation_id,staff_user_id,entered_by_admin_id,
      work_date,activity_category,activity_information,hours,status,notable_issues,custom_data)
    values(v_project_id,v_source_id,v_allocation_id,v_staff_id,p_actor_id,work_day,category,info,amount,'completed',null,
      coalesce(item->'custom_data','{}'::jsonb)||jsonb_build_object('import_batch_id',p_batch_id)) returning id into entry_id;
    row_count:=row_count+1;
    total_hours:=total_hours+amount;
    total_km:=total_km+coalesce(km,0);
  end loop;

  for allocation in select distinct e.project_id,e.budget_allocation_id from public.project_tracker_entries e
    where e.custom_data->>'import_batch_id'=p_batch_id::text loop
    select coalesce(sum(e.hours),0),coalesce(sum(e.hours*coalesce(nullif((
      select pa.hourly_rate from public.project_allocations pa
      where pa.project_id=e.project_id and pa.staff_user_id=e.staff_user_id limit 1),0),p.default_hourly_rate,0)),0)
      into consumed,spent from public.project_tracker_entries e join public.projects p on p.id=e.project_id
      where e.budget_allocation_id=allocation.budget_allocation_id;
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
      jsonb_build_object('batchId',p_batch_id,'entries',row_count,'hours',total_hours,'km',total_km,'allocationsRecalculated',allocation_count),
      'Administrator explicitly reviewed and imported weekly timesheet rows. Source-row provenance remains on each entry.');
  return jsonb_build_object('success',true,'importedCount',row_count,'totalHours',total_hours,'totalKilometres',total_km,
    'batchId',p_batch_id,'allocationsRecalculated',allocation_count,'notificationsCreated',notification_count);
end;
$fn$;
revoke all on function public.ec_import_weekly_timesheets(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.ec_import_weekly_timesheets(uuid,uuid,jsonb) to service_role;
revoke all on function public.ec_timesheet_import_text(text) from public,anon,authenticated;
grant execute on function public.ec_timesheet_import_text(text) to service_role;
notify pgrst,'reload schema';
