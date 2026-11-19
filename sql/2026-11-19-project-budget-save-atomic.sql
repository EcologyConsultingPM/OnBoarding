-- Atomic ordinary Project Operations save. projects stores the ORIGINAL baseline,
-- not original + variations. No itemised budgets, rates, actuals or variations
-- are changed. Apply after the tracker foundation, service-period columns,
-- governed-workflow audit log and project_closeout_can_manage(uuid) helper.
-- No data backfill or policy changes. Safe to reapply.
begin;

create or replace function public.ec_save_project_original_budget(
  p_project_id uuid, p_actor_id uuid, p_source_id uuid,
  p_expected_source jsonb, p_patch jsonb, p_source_patch jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare
  actor_email text;
  project_before public.projects%rowtype;
  project_after public.projects%rowtype;
  source_before public.project_budget_sources%rowtype;
  source_after public.project_budget_sources%rowtype;
  original_count integer;
  k text;
  n numeric;
  before_data jsonb;
  after_data jsonb;
  project_projection jsonb;
begin
  select u.email into actor_email from auth.users u
  where u.id = p_actor_id and u.deleted_at is null
    and (u.banned_until is null or u.banned_until <= now())
    and public.project_closeout_can_manage(p_actor_id)
  limit 1;
  if actor_email is null then
    raise exception 'Only an active administrator can save the original project budget.' using errcode = '42501';
  end if;

  if p_project_id is null or p_source_id is null
    or p_expected_source is null or jsonb_typeof(p_expected_source) <> 'object'
    or p_patch is null or jsonb_typeof(p_patch) <> 'object'
    or p_source_patch is null or jsonb_typeof(p_source_patch) <> 'object' then
    raise exception 'Provide project/source IDs, the expected original amounts and patch objects.' using errcode = '22023';
  end if;
  if not (p_expected_source ?& array['approved_value','approved_hours'])
    or exists (select 1 from jsonb_object_keys(p_expected_source) t(key) where key not in ('approved_value','approved_hours'))
    or exists (select 1 from jsonb_object_keys(p_source_patch) t(key) where key not in ('approved_value','approved_hours'))
    or exists (select 1 from jsonb_object_keys(p_patch) t(key) where key not in (
      'name','client_name','client_contact','sharepoint_link','sharepoint_label',
      'description','scope_of_works','project_lead_user_id',
      'overseeing_senior_ecologist_user_id','start_date','end_date',
      'budget_hours','budget_dollars','default_hourly_rate','status','deleted_at','deleted_by'
    )) then
    raise exception 'Original budget save contains missing expected amounts or unsupported patch fields.' using errcode = '22023';
  end if;
  if not (p_patch ? 'budget_hours' or p_patch ? 'budget_dollars') then
    raise exception 'An explicit original budget amount is required.' using errcode = '22023';
  end if;
  if p_patch ? 'deleted_at' or p_patch ? 'deleted_by' then
    if not (p_patch ?& array['deleted_at','deleted_by'])
      or p_patch->'deleted_at' <> 'null'::jsonb or p_patch->'deleted_by' <> 'null'::jsonb then
      raise exception 'Only an explicit paired restore is allowed.' using errcode = '22023';
    end if;
  end if;
  for k in select jsonb_object_keys(p_patch) loop
    if k in ('budget_hours','budget_dollars') then
      if jsonb_typeof(p_patch->k) not in ('number','string')
        or (p_patch->>k) !~ '^(\d+(\.\d{1,2})?|\.\d{1,2})$' then
        raise exception 'Original budget amounts must be non-negative decimals with at most two decimal places.' using errcode = '22023';
      end if;
      n := (p_patch->>k)::numeric;
      if n > 1000000000 then raise exception 'Original budget amounts must not exceed 1,000,000,000.' using errcode = '22023'; end if;
    elsif k <> 'default_hourly_rate' and jsonb_typeof(p_patch->k) not in ('string','null') then
      raise exception 'Project detail fields must be text or null.' using errcode = '22023';
    end if;
  end loop;
  for k in select jsonb_object_keys(p_source_patch) loop
    if jsonb_typeof(p_source_patch->k) not in ('number','string')
      or (p_source_patch->>k) !~ '^(\d+(\.\d{1,2})?|\.\d{1,2})$'
      or (p_source_patch->>k)::numeric > 1000000000 then
      raise exception 'Source budget amounts must be non-negative decimals with at most two decimal places.' using errcode = '22023';
    end if;
  end loop;
  for k in select jsonb_object_keys(p_expected_source) loop
    if jsonb_typeof(p_expected_source->k) not in ('number','string','null')
      or (p_expected_source->>k)::numeric::text in ('NaN','Infinity','-Infinity') then
      raise exception 'Expected source amounts must be finite numbers or null.' using errcode = '22023';
    end if;
  end loop;
  if p_patch ? 'name' and (p_patch->>'name' is null or btrim(p_patch->>'name') = '') then
    raise exception 'Project name cannot be empty.' using errcode = '22023';
  end if;
  if p_patch ? 'status' and (p_patch->>'status' is null or p_patch->>'status' not in ('planning','active','on_hold','complete','archived')) then
    raise exception 'Provide a valid project status.' using errcode = '22023';
  end if;

  -- Lock the parent FIRST, like the monthly RPC. FOR UPDATE also conflicts with
  -- the FK key-share lock needed to insert/move a source into this project.
  -- Lock all sources (including draft/closed), so concurrent approval, amount,
  -- type and period edits cannot change the basis after these checks.
  select p.* into project_before from public.projects p where p.id = p_project_id for update;
  if not found then raise exception 'Project not found. No changes saved.' using errcode = 'P0002'; end if;
  perform s.id from public.project_budget_sources s where s.project_id = p_project_id order by s.id for update;
  if exists (select 1 from public.project_budget_sources s where s.project_id = p_project_id
    and (s.service_period_start is not null or s.service_period_end is not null) limit 1) then
    raise exception 'Service-period budget sources appeared. Reload and use the per-source/monthly budget workflow; no changes saved.' using errcode = '40001';
  end if;
  select count(*) into original_count from public.project_budget_sources s
    where s.project_id = p_project_id and s.source_type = 'original' and s.approval_status = 'approved'
      and s.service_period_start is null and s.service_period_end is null;
  select s.* into source_before from public.project_budget_sources s
    where s.id = p_source_id and s.project_id = p_project_id
      and s.source_type = 'original' and s.approval_status = 'approved'
      and s.service_period_start is null and s.service_period_end is null;
  if original_count <> 1 or not found then
    raise exception 'The unique approved original source changed. Reload before saving; no changes saved.' using errcode = '40001';
  end if;
  if source_before.approved_value is distinct from (p_expected_source->>'approved_value')::numeric
    or source_before.approved_hours is distinct from (p_expected_source->>'approved_hours')::numeric then
    raise exception 'The approved original source amounts changed concurrently. Reload before saving; no changes saved.' using errcode = '40001';
  end if;

  -- Populate records from the locked rows: omitted fields retain current values,
  -- including concurrent unrelated project edits made before this transaction.
  select * into project_after from jsonb_populate_record(project_before, p_patch);
  select * into source_after from jsonb_populate_record(source_before, p_source_patch);
  if (p_patch ? 'budget_dollars' and project_after.budget_dollars is distinct from source_after.approved_value)
    or (p_patch ? 'budget_hours' and project_after.budget_hours is distinct from source_after.approved_hours)
    or (p_source_patch ? 'approved_value' and not p_patch ? 'budget_dollars')
    or (p_source_patch ? 'approved_hours' and not p_patch ? 'budget_hours') then
    raise exception 'Project and original-source budget patches must agree. No changes saved.' using errcode = '22023';
  end if;
  before_data := jsonb_build_object('project',to_jsonb(project_before),'source',to_jsonb(source_before));

  update public.projects set
    name = project_after.name, client_name = project_after.client_name,
    client_contact = project_after.client_contact, sharepoint_link = project_after.sharepoint_link,
    sharepoint_label = project_after.sharepoint_label, description = project_after.description,
    scope_of_works = project_after.scope_of_works, project_lead_user_id = project_after.project_lead_user_id,
    overseeing_senior_ecologist_user_id = project_after.overseeing_senior_ecologist_user_id,
    start_date = project_after.start_date, end_date = project_after.end_date,
    budget_hours = project_after.budget_hours, budget_dollars = project_after.budget_dollars,
    default_hourly_rate = project_after.default_hourly_rate, status = project_after.status,
    deleted_at = project_after.deleted_at, deleted_by = project_after.deleted_by, updated_at = now()
    where id = p_project_id returning * into project_after;
  if not found then raise exception 'Project update did not complete. No changes saved.'; end if;
  if source_before.approved_value is distinct from source_after.approved_value
    or source_before.approved_hours is distinct from source_after.approved_hours then
    update public.project_budget_sources set approved_value = source_after.approved_value,
      approved_hours = source_after.approved_hours, updated_by = p_actor_id, updated_at = now()
      where id = p_source_id returning * into source_after;
    if not found then raise exception 'Original source update did not complete. No changes saved.'; end if;
  end if;
  if (p_patch ? 'budget_dollars' and project_after.budget_dollars is distinct from source_after.approved_value)
    or (p_patch ? 'budget_hours' and project_after.budget_hours is distinct from source_after.approved_hours) then
    raise exception 'Original budget updates did not reconcile. No changes saved.';
  end if;
  after_data := jsonb_build_object('project',to_jsonb(project_after),'source',to_jsonb(source_after),
    'variations_unchanged',true,'itemised_budgets_unchanged',true,'actual_entries_unchanged',true,
    'budget_basis','original baseline; approved variations remain additive');
  insert into public.admin_audit_log(actor_id,action,entity_type,entity_id,project_id,resource_key,before_data,after_data,reason)
    values(p_actor_id,'project_original_budget_saved','project',p_project_id,p_project_id,
      'admin.projects.tracker',before_data,after_data,
      'Administrator saved project details and the ordinary original-scope budget atomically. Approved variations, itemised budgets and actuals were retained.');
  if not found then raise exception 'Original budget audit was not recorded. No changes saved.'; end if;

  select jsonb_object_agg(t.key,t.value) into project_projection from jsonb_each(to_jsonb(project_after)) t
    where t.key = any(array['id','name','client_name','client_contact','sharepoint_link','sharepoint_label',
      'description','scope_of_works','project_lead_user_id','overseeing_senior_ecologist_user_id',
      'start_date','end_date','budget_hours','budget_dollars','default_hourly_rate','status','created_at','updated_at']);
  return jsonb_build_object('project',project_projection,'sourceBudgetSynchronized',true);
end;
$fn$;

revoke all on function public.ec_save_project_original_budget(uuid,uuid,uuid,jsonb,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.ec_save_project_original_budget(uuid,uuid,uuid,jsonb,jsonb,jsonb) to service_role;
notify pgrst,'reload schema';
commit;
