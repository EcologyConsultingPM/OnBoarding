-- Additive, initially empty register. Depends on existing auth.users,
-- admin_emails, portal_visibility_overrides and admin_audit_log.
-- Apply only through the approved deployment; no account metadata is changed.
begin;
create table if not exists public.internal_register_staff (
  id uuid primary key default gen_random_uuid(),
  staff_name text not null check (length(btrim(staff_name)) between 1 and 150 and staff_name !~ '[<>[:cntrl:]]'),
  position text not null check (length(btrim(position)) between 1 and 150 and position !~ '[<>[:cntrl:]]'),
  employment_type text not null check (employment_type in ('full_time','part_time','casual')),
  linked_user_id uuid references auth.users(id) on delete restrict,
  version integer not null default 1 check (version > 0),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists internal_register_staff_active_name_idx
  on public.internal_register_staff(lower(btrim(staff_name))) where archived_at is null;
create table if not exists public.internal_training_records (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.internal_register_staff(id) on delete restrict,
  qualification text not null check (length(btrim(qualification)) between 1 and 200 and qualification !~ '[<>[:cntrl:]]'),
  training_organisation text not null check (length(btrim(training_organisation)) between 1 and 200 and training_organisation !~ '[<>[:cntrl:]]'),
  completion_date date not null,
  expiry_date date check (expiry_date is null or expiry_date >= completion_date),
  version integer not null default 1 check (version > 0),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists internal_training_records_staff_idx on public.internal_training_records(staff_id,id);
-- Immutable snapshots bind each retry key to its complete canonical request.
create table if not exists public.internal_register_mutations (
  actor_id uuid not null references auth.users(id) on delete restrict,
  mutation_key uuid not null,
  payload jsonb not null,
  before_data jsonb,
  result jsonb not null,
  reason text,
  created_at timestamptz not null default now(),
  primary key(actor_id,mutation_key)
);
alter table public.internal_register_staff enable row level security;
alter table public.internal_training_records enable row level security;
alter table public.internal_register_mutations enable row level security;
revoke all on public.internal_register_staff, public.internal_training_records, public.internal_register_mutations from public, anon, authenticated, service_role;
grant select on public.internal_register_staff, public.internal_training_records to service_role;

create or replace function public.internal_register_can_manage(p_actor_id uuid)
returns boolean language sql stable security definer set search_path = pg_catalog, public as $$
  select exists (
    select 1 from auth.users u where u.id = p_actor_id and u.deleted_at is null
      and (u.banned_until is null or u.banned_until <= now())
      and coalesce(u.raw_user_meta_data->>'staff_directory_active','true') <> 'false'
      and (
        lower(trim(u.email)) in ('aaron.dooley@ecologyconsulting.au','tony.webster@ecologyconsulting.au')
        or (exists (select 1 from public.admin_emails a where lower(trim(a.email)) = lower(trim(u.email)))
          and not exists (select 1 from public.portal_visibility_overrides v
            where v.user_id = u.id and v.resource_key in ('admin.internal_registers','admin.internal_registers.training') and v.is_visible = false))
      )
  );
$$;
create or replace function public.internal_register_preserve_history()
returns trigger language plpgsql set search_path = pg_catalog, public as $$
begin
  if tg_table_name = 'internal_register_mutations' or tg_op = 'DELETE' then
    raise exception 'IR_IMMUTABLE: Register history must be retained.';
  end if;
  if new.id is distinct from old.id or new.created_at is distinct from old.created_at
    or old.archived_at is not null then raise exception 'IR_IMMUTABLE: Original identity and archived records must be retained.'; end if;
  return new;
end;
$$;
drop trigger if exists internal_register_staff_retention on public.internal_register_staff;
create trigger internal_register_staff_retention before update or delete on public.internal_register_staff for each row execute function public.internal_register_preserve_history();
drop trigger if exists internal_training_records_retention on public.internal_training_records;
create trigger internal_training_records_retention before update or delete on public.internal_training_records for each row execute function public.internal_register_preserve_history();
drop trigger if exists internal_register_mutation_retention on public.internal_register_mutations;
create trigger internal_register_mutation_retention before update or delete on public.internal_register_mutations for each row execute function public.internal_register_preserve_history();

create or replace function public.internal_register_mutate(
  p_actor_id uuid, p_entity text, p_action text, p_id uuid, p_expected_version integer,
  p_values jsonb, p_reason text, p_mutation_key uuid
) returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  payload jsonb; previous_payload jsonb; previous_result jsonb; before_row jsonb; after_row jsonb;
  vals jsonb; reason_text text; table_name text; key_name text; field_text text;
  linked_id uuid; staff_uuid uuid; completed date; expires date; dt text; conflict_constraint text;
begin
  if not public.internal_register_can_manage(p_actor_id) then raise exception 'IR_FORBIDDEN: Administrator access required.'; end if;
  if p_entity is null or p_entity not in ('staff','training') or p_action is null or p_action not in ('create','update','archive') or p_mutation_key is null
    or (p_action = 'create' and (p_id is not null or p_expected_version is not null))
    or (p_action <> 'create' and (p_id is null or p_expected_version is null or p_expected_version not between 1 and 2147483646)) then
    raise exception 'IR_INVALID_INPUT: Valid mutation fields required.';
  end if;
  vals := coalesce(p_values,'{}'::jsonb); reason_text := nullif(btrim(p_reason),'');
  if jsonb_typeof(vals) is distinct from 'object' or octet_length(vals::text) > 50000
    or (reason_text is not null and (length(reason_text) > 1000 or reason_text ~ '[<>[:cntrl:]]'))
    or (p_action = 'archive' and (reason_text is null or vals <> '{}'::jsonb))
    or (p_action <> 'archive' and reason_text is not null) then raise exception 'IR_INVALID_INPUT: Valid fields and archive reason required.'; end if;
  payload := jsonb_build_object('entity',p_entity,'action',p_action,'id',p_id,'expected_version',p_expected_version,'values',vals,'reason',reason_text);
  perform pg_advisory_xact_lock(hashtextextended(p_actor_id::text || ':' || p_mutation_key::text,0));
  select m.payload,m.result into previous_payload,previous_result from public.internal_register_mutations m
    where m.actor_id=p_actor_id and m.mutation_key=p_mutation_key;
  if found then
    if previous_payload is distinct from payload then raise exception 'IR_MUTATION_CONFLICT: Retry key is bound to another request.'; end if;
    return jsonb_build_object('row',previous_result,'duplicate',true);
  end if;
  table_name := case when p_entity='staff' then 'internal_register_staff' else 'internal_training_records' end;
  if p_action <> 'archive' then
    if exists (select 1 from jsonb_object_keys(vals) as k(key) where
      (p_entity='staff' and key not in ('staff_name','position','employment_type','linked_user_id')) or
      (p_entity='training' and key not in ('staff_id','qualification','training_organisation','completion_date','expiry_date'))) then
      raise exception 'IR_INVALID_INPUT: Unexpected fields.';
    end if;
    foreach key_name in array (case when p_entity='staff' then array['staff_name','position'] else array['qualification','training_organisation'] end) loop
      field_text := btrim(vals->>key_name);
      if jsonb_typeof(vals->key_name) is distinct from 'string' or coalesce(length(field_text),0) < 1
        or length(field_text) > (case when p_entity='staff' then 150 else 200 end) or field_text ~ '[<>[:cntrl:]]' then
        raise exception 'IR_INVALID_INPUT: Required plain text field invalid.';
      end if;
      vals := jsonb_set(vals,array[key_name],to_jsonb(field_text));
    end loop;
    if p_entity='staff' then
      if coalesce(vals->>'employment_type','') not in ('full_time','part_time','casual') then raise exception 'IR_INVALID_INPUT: Choose an employment type.'; end if;
      if vals ? 'linked_user_id' and vals->'linked_user_id' <> 'null'::jsonb then
        begin
          if jsonb_typeof(vals->'linked_user_id') <> 'string' or (vals->>'linked_user_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'Invalid'; end if;
          linked_id := (vals->>'linked_user_id')::uuid;
        exception when others then raise exception 'IR_INVALID_INPUT: Invalid linked account.'; end;
        if not exists (select 1 from auth.users u where u.id=linked_id and u.deleted_at is null
          and lower(u.email) like '%@ecologyconsulting.au' and (u.banned_until is null or u.banned_until <= now())
          and coalesce(u.raw_user_meta_data->>'staff_directory_active','true') <> 'false') then raise exception 'IR_INVALID_INPUT: Active directory account required.'; end if;
      end if;
    else
      begin
        if jsonb_typeof(vals->'staff_id') is distinct from 'string' or (vals->>'staff_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'Invalid'; end if;
        staff_uuid := (vals->>'staff_id')::uuid;
        foreach key_name in array array['completion_date','expiry_date'] loop
          dt := vals->>key_name;
          if key_name='expiry_date' and (dt is null or dt='') then continue; end if;
          if jsonb_typeof(vals->key_name) is distinct from 'string' or dt is null or dt !~ '^\d{4}-\d{2}-\d{2}$' or to_char(dt::date,'YYYY-MM-DD') <> dt then raise exception 'Invalid'; end if;
          if key_name='completion_date' then completed := dt::date; else expires := dt::date; end if;
        end loop;
        if completed is null or (expires is not null and expires < completed) then raise exception 'Invalid'; end if;
      exception when others then raise exception 'IR_INVALID_INPUT: Invalid staff or training dates.'; end;
    end if;
  end if;
  if p_action <> 'create' then
    if p_entity='staff' then
      select to_jsonb(s) into before_row from public.internal_register_staff s where s.id=p_id for update;
    else
      select to_jsonb(t) into before_row from public.internal_training_records t where t.id=p_id for update;
    end if;
    if before_row is null then raise exception 'IR_NOT_FOUND: Record not found.'; end if;
    if (before_row->>'version')::integer <> p_expected_version then raise exception 'IR_VERSION_CONFLICT: Reload before saving.'; end if;
    if before_row->>'archived_at' is not null then raise exception 'IR_ARCHIVED: Record is already archived.'; end if;
  end if;
  -- Training additions/reassignments serialize against staff archive through the
  -- same staff row lock, preventing active training under archived staff.
  if p_entity='training' and p_action <> 'archive' then
    perform 1 from public.internal_register_staff s where s.id=staff_uuid and s.archived_at is null for update;
    if not found then raise exception 'IR_INVALID_INPUT: Choose active staff.'; end if;
  end if;
  if p_entity='staff' and p_action='archive' and exists (select 1 from public.internal_training_records t where t.staff_id=p_id and t.archived_at is null) then
    raise exception 'IR_STAFF_HAS_TRAINING: Archive active training first.';
  end if;
  if p_action='archive' then
    if p_entity='staff' then
      update public.internal_register_staff set archived_at=now(),updated_at=now(),version=version+1 where id=p_id returning to_jsonb(internal_register_staff) into after_row;
    else
      update public.internal_training_records set archived_at=now(),updated_at=now(),version=version+1 where id=p_id returning to_jsonb(internal_training_records) into after_row;
    end if;
  elsif p_entity='staff' then
    if p_action='create' then
      insert into public.internal_register_staff(staff_name,position,employment_type,linked_user_id)
        values(vals->>'staff_name',vals->>'position',vals->>'employment_type',linked_id) returning to_jsonb(internal_register_staff) into after_row;
    else
      update public.internal_register_staff set staff_name=vals->>'staff_name',position=vals->>'position',employment_type=vals->>'employment_type',linked_user_id=linked_id,updated_at=now(),version=version+1
        where id=p_id returning to_jsonb(internal_register_staff) into after_row;
    end if;
  else
    if p_action='create' then
      insert into public.internal_training_records(staff_id,qualification,training_organisation,completion_date,expiry_date)
        values(staff_uuid,vals->>'qualification',vals->>'training_organisation',completed,expires) returning to_jsonb(internal_training_records) into after_row;
    else
      update public.internal_training_records set staff_id=staff_uuid,qualification=vals->>'qualification',training_organisation=vals->>'training_organisation',completion_date=completed,expiry_date=expires,updated_at=now(),version=version+1
        where id=p_id returning to_jsonb(internal_training_records) into after_row;
    end if;
  end if;
  -- Full snapshots remain in restricted, append-only history. General audit is
  -- identifiers/version only, not names or qualification contents.
  insert into public.admin_audit_log(actor_id,action,entity_type,entity_id,resource_key,before_data,after_data,reason)
    values(p_actor_id,'internal_register_' || p_action,table_name,(after_row->>'id')::uuid,'admin.internal_registers.training',
      case when before_row is null then null else jsonb_build_object('id',before_row->'id','version',before_row->'version','archived_at',before_row->'archived_at') end,
      jsonb_build_object('id',after_row->'id','version',after_row->'version','archived_at',after_row->'archived_at'),reason_text);
  insert into public.internal_register_mutations(actor_id,mutation_key,payload,before_data,result,reason)
    values(p_actor_id,p_mutation_key,payload,before_row,after_row,reason_text);
  return jsonb_build_object('row',after_row,'duplicate',false);
exception when unique_violation then
  get stacked diagnostics conflict_constraint = constraint_name;
  if conflict_constraint = 'internal_register_staff_active_name_idx' then
    raise exception 'IR_DUPLICATE_STAFF: An active staff record already has that name.';
  end if;
  raise;
end;
$$;
revoke all on function public.internal_register_can_manage(uuid) from public, anon, authenticated;
revoke all on function public.internal_register_preserve_history() from public, anon, authenticated, service_role;
revoke all on function public.internal_register_mutate(uuid,text,text,uuid,integer,jsonb,text,uuid) from public, anon, authenticated;
grant execute on function public.internal_register_can_manage(uuid) to service_role;
grant execute on function public.internal_register_mutate(uuid,text,text,uuid,integer,jsonb,text,uuid) to service_role;
comment on table public.internal_training_records is 'Training attendance is not independent proof of competency or task authorisation. No certificates or medical evidence.';
select pg_notify('pgrst','reload schema');
commit;
