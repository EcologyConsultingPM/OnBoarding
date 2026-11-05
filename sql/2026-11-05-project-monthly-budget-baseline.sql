-- Setup presents monthly values; projects retains aggregate approved-source totals.
-- This function changes planned allowances only. Actuals, role rates and staff
-- assignment/acceptance records are not written.
create or replace function public.ec_set_monthly_project_budget(
  p_project_id uuid, p_actor_id uuid, p_monthly_value numeric, p_monthly_hours numeric
) returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare
  src record;
  actor_email text;
  project_name text;
  source_count integer;
  changed_count integer;
  aggregate_value numeric;
  aggregate_hours numeric;
  allocation_value_total numeric;
  allocation_hours_total numeric;
  before_data jsonb;
  after_data jsonb;
  recipient record;
begin
  if p_monthly_value is null or p_monthly_hours is null
    or p_monthly_value::text in ('NaN','Infinity','-Infinity')
    or p_monthly_hours::text in ('NaN','Infinity','-Infinity')
    or p_monthly_value < 0 or p_monthly_hours < 0
    or p_monthly_value > 1000000000 or p_monthly_hours > 1000000000
    or p_monthly_value <> round(p_monthly_value,2)
    or p_monthly_hours <> round(p_monthly_hours,2) then
    raise exception 'Monthly value and hours must be non-negative finite numbers with at most two decimal places.';
  end if;
  select u.email into actor_email from auth.users u
  where u.id=p_actor_id and u.deleted_at is null
    and (u.banned_until is null or u.banned_until <= now())
    and public.project_closeout_can_manage(p_actor_id)
  limit 1;
  if actor_email is null then raise exception 'Only an active administrator can update monthly allowances.' using errcode='42501'; end if;
  select p.name into project_name from public.projects p
  where p.id=p_project_id and p.deleted_at is null limit 1 for update;
  if project_name is null then raise exception 'Project not found.'; end if;
  perform s.id from public.project_budget_sources s where s.project_id=p_project_id
    and s.approval_status='approved' and s.source_type in ('original','variation') for update;
  select count(*),count(*) filter(where s.approved_value<>p_monthly_value or s.approved_hours<>p_monthly_hours)
    into source_count,changed_count
  from public.project_budget_sources s where s.project_id=p_project_id
    and s.approval_status='approved' and s.source_type in ('original','variation') and s.service_period_start is not null
    and s.service_period_end is not null limit 1;
  if source_count=0 then raise exception 'No approved service-month sources exist. Set up the monthly sources first.'; end if;
  if source_count>120 then raise exception 'Too many monthly sources for one baseline change.'; end if;
  if exists(select 1 from public.project_budget_sources s where s.project_id=p_project_id
    and s.approval_status='approved' and s.source_type in ('original','variation') and s.service_period_start is not null
    and (extract(day from s.service_period_start)<>1
      or s.service_period_end <> (s.service_period_start+interval '1 month'-interval '1 day')::date)
    limit 1) then raise exception 'Every monthly source must span one full calendar month.'; end if;
  if exists(select 1 from public.project_budget_sources s where s.project_id=p_project_id
    and s.approval_status='approved' and s.source_type in ('original','variation') and s.service_period_start is not null
    group by s.service_period_start having count(*)>1 limit 1) then
    raise exception 'Multiple approved sources share a service month. Edit them individually instead of applying defaults twice.';
  end if;
  select jsonb_build_object(
    'project',(select jsonb_build_object('budget_dollars',p.budget_dollars,'budget_hours',p.budget_hours) from public.projects p where p.id=p_project_id limit 1),
    'sources',(select jsonb_agg(to_jsonb(s) order by s.service_period_start) from public.project_budget_sources s where s.project_id=p_project_id and s.approval_status='approved' and s.source_type in ('original','variation') and s.service_period_start is not null limit 1),
    'allocations',(select jsonb_agg(to_jsonb(a) order by a.id) from public.project_budget_allocations a join public.project_budget_sources s on s.id=a.budget_source_id where s.project_id=p_project_id and s.approval_status='approved' and s.source_type in ('original','variation') and s.service_period_start is not null and a.status='active' limit 1)
  ) into before_data;
  if changed_count>0 then
    for src in select s.id from public.project_budget_sources s
      where s.project_id=p_project_id and s.approval_status='approved' and s.source_type in ('original','variation')
        and s.service_period_start is not null and s.service_period_end is not null
      order by s.service_period_start limit 120 loop
      perform a.id from public.project_budget_allocations a where a.budget_source_id=src.id and a.status='active' for update;
      select sum(a.allocation_value),sum(a.allocation_hours) into allocation_value_total,allocation_hours_total
        from public.project_budget_allocations a where a.budget_source_id=src.id and a.status='active' limit 1;
      if allocation_value_total is null or allocation_hours_total is null then
        raise exception 'Each monthly source needs active itemised allocations before changing its baseline.';
      end if;
      if (allocation_value_total=0 and p_monthly_value>0) or (allocation_hours_total=0 and p_monthly_hours>0) then
        raise exception 'Populate itemised dollar/hour weights before applying a positive monthly baseline.';
      end if;
      -- Largest-remainder distribution prevents negative residuals or drift even
      -- for a one-cent allowance. Keep zero-weight expense hours at zero.
      with weights as (
        select a.id,
          case when allocation_value_total=0 then 0 else p_monthly_value*100*a.allocation_value/allocation_value_total end as exact_value,
          case when allocation_hours_total=0 then 0 else p_monthly_hours*100*a.allocation_hours/allocation_hours_total end as exact_hours
        from public.project_budget_allocations a where a.budget_source_id=src.id and a.status='active'
      ), ranked as (
        select w.id,floor(w.exact_value) as value_floor,floor(w.exact_hours) as hours_floor,
          row_number() over(order by w.exact_value-floor(w.exact_value) desc,w.id) as value_rank,
          row_number() over(order by w.exact_hours-floor(w.exact_hours) desc,w.id) as hours_rank,
          p_monthly_value*100-sum(floor(w.exact_value)) over() as value_remainder,
          p_monthly_hours*100-sum(floor(w.exact_hours)) over() as hours_remainder
        from weights w
      ) update public.project_budget_allocations a set
        allocation_value=(r.value_floor+case when r.value_rank<=r.value_remainder then 1 else 0 end)/100,
        allocation_hours=(r.hours_floor+case when r.hours_rank<=r.hours_remainder then 1 else 0 end)/100,
        updated_at=now()
      from ranked r where a.id=r.id;
      update public.project_budget_sources set approved_value=p_monthly_value,approved_hours=p_monthly_hours,updated_at=now() where id=src.id;
      if (select sum(a.allocation_value) from public.project_budget_allocations a where a.budget_source_id=src.id and a.status='active' limit 1) <> p_monthly_value
        or (select sum(a.allocation_hours) from public.project_budget_allocations a where a.budget_source_id=src.id and a.status='active' limit 1) <> p_monthly_hours then
        raise exception 'Monthly itemised allocations did not reconcile. No changes saved.';
      end if;
    end loop;
  end if;
  select coalesce(sum(s.approved_value),0),coalesce(sum(s.approved_hours),0)
    into aggregate_value,aggregate_hours from public.project_budget_sources s
    where s.project_id=p_project_id and s.approval_status='approved' and s.source_type in ('original','variation') limit 1;
  update public.projects set budget_dollars=aggregate_value,budget_hours=aggregate_hours,updated_at=now()
    where id=p_project_id and (budget_dollars is distinct from aggregate_value or budget_hours is distinct from aggregate_hours);
  if changed_count>0 then
    after_data:=jsonb_build_object('monthly_value',p_monthly_value,'monthly_hours',p_monthly_hours,'month_count',source_count,'aggregate_value',aggregate_value,'aggregate_hours',aggregate_hours,'actual_entries_unchanged',true,'role_rates_unchanged',true,'itemised_distribution','proportional largest remainder; previous weights retained in before_data');
    insert into public.admin_audit_log(actor_id,action,entity_type,entity_id,project_id,resource_key,before_data,after_data,reason)
      values(p_actor_id,'project_monthly_baseline_updated','project',p_project_id,p_project_id,'admin.projects.tracker',before_data,after_data,'Administrator explicitly changed per-month planning allowances. Service-month dates, actuals, rate snapshots and assignment responses were retained.');
    for recipient in select distinct a.staff_user_id from public.project_allocations a
      where a.project_id=p_project_id and a.active=true limit 200 loop
      insert into public.portal_events(recipient_id,event_type,severity,title,body,href,source_table,source_id)
        values(recipient.staff_user_id,'project_budget_updated','information',project_name||' — monthly allowance updated',
          'Each approved service month is now $'||p_monthly_value::text||' ex GST / '||p_monthly_hours::text||' planning hours. Actual entries remain assigned to their own month. This notice does not change staff acceptance or safety readiness.',
          '/staff/my-projects?projectId='||p_project_id::text,'projects',p_project_id);
    end loop;
  end if;
  return jsonb_build_object('monthlyValue',p_monthly_value,'monthlyHours',p_monthly_hours,'monthCount',source_count,'aggregateValue',aggregate_value,'aggregateHours',aggregate_hours,'changed',changed_count>0);
end;
$fn$;
revoke all on function public.ec_set_monthly_project_budget(uuid,uuid,numeric,numeric) from public,anon,authenticated;
grant execute on function public.ec_set_monthly_project_budget(uuid,uuid,numeric,numeric) to service_role;
notify pgrst,'reload schema';
