-- Biological hazard / exposure register. Apply only through the approved deployment.
-- Depends on auth.users, admin_emails, portal_visibility_overrides,
-- portal_events and admin_audit_log from the existing portal migrations.
-- No medical details, signatures or photo paths are sent to notification/audit feeds.
begin;

create sequence if not exists public.biological_hazard_register_seq;
create table if not exists public.biological_hazard_events (
  id uuid primary key default gen_random_uuid(),
  register_number text not null unique default ('BIO-' || lpad(nextval('public.biological_hazard_register_seq')::text, 6, '0')),
  created_by uuid not null references auth.users(id) on delete restrict,
  submission_key uuid not null,
  details jsonb not null check (jsonb_typeof(details) = 'object'
    and details->>'documentCode' = 'EC-WHS-BIO-002'
    and details->'documentRevision' = '1'::jsonb
    and details->>'category' in ('obs','pot','exp','inj','nm')
    and jsonb_typeof(details->'fields') = 'object'
    and jsonb_typeof(details->'declaration') = 'object'
    and octet_length(details::text) <= 600000),
  status text not null default 'Open' check (status in ('Open','In progress','Closed')),
  version integer not null default 1 check (version > 0),
  admin_notes text not null default '' check (length(admin_notes) <= 4000),
  follow_up_date date,
  follow_up_notes text not null default '' check (length(follow_up_notes) <= 4000),
  closure_reason text not null default '' check (length(closure_reason) <= 4000),
  action_owner_id uuid references auth.users(id) on delete restrict,
  closed_by uuid references auth.users(id) on delete restrict,
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(created_by, submission_key),
  check ((status = 'Closed' and closed_by is not null and closed_at is not null and length(trim(closure_reason)) > 0)
    or (status <> 'Closed' and closed_by is null and closed_at is null)),
  check (status <> 'Closed' or details->>'category' not in ('exp','inj')
    or (follow_up_date is not null and length(trim(follow_up_notes)) > 0))
);
create index if not exists biological_hazard_owner_idx on public.biological_hazard_events(created_by, created_at desc, id desc);
create index if not exists biological_hazard_register_idx on public.biological_hazard_events(created_at desc, id desc);
create table if not exists public.biological_hazard_updates (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.biological_hazard_events(id) on delete restrict,
  version integer not null check (version > 0),
  action text not null check (action in ('submitted','admin_updated','photo_attached')),
  actor_id uuid not null references auth.users(id) on delete restrict,
  before_data jsonb,
  after_data jsonb not null,
  reason text,
  created_at timestamptz not null default now()
);
create index if not exists biological_hazard_updates_event_idx on public.biological_hazard_updates(event_id, created_at desc, id desc);
create table if not exists public.biological_hazard_photos (
  id uuid primary key,
  event_id uuid not null references public.biological_hazard_events(id) on delete restrict,
  storage_path text not null unique,
  file_name text not null default 'photo.jpeg' check (file_name = 'photo.jpeg' or file_name ~ '^biological-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$'),
  mime_type text not null check (mime_type = 'image/jpeg'),
  size_bytes bigint not null check (size_bytes between 1 and 8388608),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  check (storage_path = 'events/' || event_id::text || '/' || id::text || '.jpeg')
);
create index if not exists biological_hazard_photos_event_idx on public.biological_hazard_photos(event_id, created_at);
create unique index if not exists biological_hazard_photo_retry_idx on public.biological_hazard_photos(event_id,file_name) where file_name <> 'photo.jpeg';

alter table public.biological_hazard_events enable row level security;
alter table public.biological_hazard_updates enable row level security;
alter table public.biological_hazard_photos enable row level security;
-- Deny browser reads as well as writes. Medical data is served only by the
-- authenticated, resource-checked API. Even service_role has no direct DML grant.
revoke all on public.biological_hazard_events, public.biological_hazard_updates, public.biological_hazard_photos from public, anon, authenticated, service_role;
grant select on public.biological_hazard_events, public.biological_hazard_updates, public.biological_hazard_photos to service_role;
revoke all on sequence public.biological_hazard_register_seq from public, anon, authenticated, service_role;

-- The existing project_closeout_can_manage is admin-only but enforces project
-- visibility, not WHS. This dedicated helper uses the SAME protected identities
-- and admin register, with WHS parent + Monitoring permissions instead.
create or replace function public.biological_hazard_can_manage(p_actor_id uuid)
returns boolean language sql stable security definer set search_path = pg_catalog, public as $$
  select exists (
    select 1 from auth.users u
    where u.id = p_actor_id and u.deleted_at is null
      and (u.banned_until is null or u.banned_until <= now())
      and coalesce(u.raw_user_meta_data->>'staff_directory_active', 'true') <> 'false'
      and (
        lower(trim(u.email)) in ('aaron.dooley@ecologyconsulting.au', 'tony.webster@ecologyconsulting.au')
        or (exists (select 1 from public.admin_emails a where lower(trim(a.email)) = lower(trim(u.email)))
          and not exists (select 1 from public.portal_visibility_overrides v
            where v.user_id = u.id and v.resource_key in ('admin.whs','admin.whs_monitoring') and v.is_visible = false))
      )
  );
$$;

-- Enforce signed-submission immutability and retention even in trusted tooling.
create or replace function public.biological_hazard_preserve_record()
returns trigger language plpgsql set search_path = pg_catalog, public as $$
begin
  if tg_op = 'DELETE' then raise exception 'BIO_IMMUTABLE: Records must be retained.'; end if;
  if tg_table_name <> 'biological_hazard_events' then
    raise exception 'BIO_IMMUTABLE: History and photo metadata are append-only.';
  end if;
  if new.id is distinct from old.id or new.created_by is distinct from old.created_by
    or new.submission_key is distinct from old.submission_key or new.details is distinct from old.details
    or new.register_number is distinct from old.register_number or new.created_at is distinct from old.created_at then
    raise exception 'BIO_IMMUTABLE: Original signed submission cannot be changed.';
  end if;
  return new;
end;
$$;
drop trigger if exists biological_hazard_preserve_event on public.biological_hazard_events;
create trigger biological_hazard_preserve_event before update or delete on public.biological_hazard_events for each row execute function public.biological_hazard_preserve_record();
drop trigger if exists biological_hazard_preserve_update on public.biological_hazard_updates;
create trigger biological_hazard_preserve_update before update or delete on public.biological_hazard_updates for each row execute function public.biological_hazard_preserve_record();
drop trigger if exists biological_hazard_preserve_photo on public.biological_hazard_photos;
create trigger biological_hazard_preserve_photo before update or delete on public.biological_hazard_photos for each row execute function public.biological_hazard_preserve_record();

create or replace function public.biological_hazard_submit(p_actor_id uuid, p_details jsonb, p_submission_key uuid)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare e public.biological_hazard_events%rowtype; summary jsonb;
begin
  if p_actor_id is null or not exists (select 1 from auth.users u where u.id = p_actor_id
    and u.email is not null and u.deleted_at is null and (u.banned_until is null or u.banned_until <= now())
    and coalesce(u.raw_user_meta_data->>'staff_directory_active','true') <> 'false') then
    raise exception 'BIO_FORBIDDEN: A valid active actor is required.';
  end if;
  if p_submission_key is null then raise exception 'BIO_INVALID_INPUT: Submission key required.'; end if;
  -- Serialize retries for the same actor/key, including concurrent first submissions.
  perform pg_advisory_xact_lock(hashtextextended(p_actor_id::text || ':' || p_submission_key::text, 0));
  select * into e from public.biological_hazard_events where created_by = p_actor_id and submission_key = p_submission_key;
  if found then return jsonb_build_object('event', to_jsonb(e), 'duplicate', true); end if;
  if p_details is null or jsonb_typeof(p_details) <> 'object' or octet_length(p_details::text) > 600000
    or p_details->>'documentCode' is distinct from 'EC-WHS-BIO-002'
    or p_details->'documentRevision' is distinct from '1'::jsonb
    or coalesce(p_details->>'category','') not in ('obs','pot','exp','inj','nm')
    or jsonb_typeof(p_details->'fields') is distinct from 'object'
    or jsonb_typeof(p_details->'declaration') is distinct from 'object'
    or exists (select 1 from jsonb_object_keys(p_details) as k(key) where key not in ('documentCode','documentRevision','category','fields','declaration')) then
    raise exception 'BIO_INVALID_INPUT: Canonical signed details required.';
  end if;
  insert into public.biological_hazard_events(created_by, submission_key, details)
    values (p_actor_id, p_submission_key, p_details) returning * into e;
  summary := jsonb_build_object('id', e.id, 'register_number', e.register_number, 'category', e.details->>'category', 'status', e.status, 'version', e.version);
  insert into public.biological_hazard_updates(event_id,version,action,actor_id,after_data)
    values(e.id,e.version,'submitted',p_actor_id,summary);
  insert into public.admin_audit_log(actor_id,action,entity_type,entity_id,resource_key,after_data)
    values(p_actor_id,'biological_hazard_submitted','biological_hazard_events',e.id,'staff.forms',summary);
  -- Review-capable administrators only; email matches are deduplicated via EXISTS.
  insert into public.portal_events(recipient_id,event_type,severity,title,body,href,source_table,source_id)
  select u.id, 'biological_hazard_submitted', 'review', 'Biological register report awaiting review',
    'Report ' || e.register_number || ' is ready for WHS review.',
    '/?portal=admin&workspace=whsmonitor&whsView=biological&biologicalEventId=' || e.id::text,
    'biological_hazard_events', e.id
  from auth.users u where public.biological_hazard_can_manage(u.id);
  return jsonb_build_object('event',to_jsonb(e),'duplicate',false);
end;
$$;

create or replace function public.biological_hazard_update(p_actor_id uuid,p_event_id uuid,p_version integer,p_patch jsonb)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare e public.biological_hazard_events%rowtype; before_e jsonb; after_e jsonb; k text; dt text;
  next_status text; owner_id uuid; reason_text text;
begin
  if not public.biological_hazard_can_manage(p_actor_id) then raise exception 'BIO_FORBIDDEN: WHS administrator required.'; end if;
  if p_version is null or p_version < 1 or p_version > 2147483646 or p_patch is null
    or jsonb_typeof(p_patch) <> 'object' or p_patch = '{}'::jsonb or octet_length(p_patch::text) > 20000
    or exists (select 1 from jsonb_object_keys(p_patch) as k(key) where key not in ('status','admin_notes','follow_up_date','follow_up_notes','closure_reason','action_owner_id')) then
    raise exception 'BIO_INVALID_INPUT: Valid version and administrator patch required.';
  end if;
  for k in select jsonb_object_keys(p_patch) loop
    if k in ('admin_notes','follow_up_notes','closure_reason') and
      (jsonb_typeof(p_patch->k) <> 'string' or length(p_patch->>k) > 4000) then
      raise exception 'BIO_INVALID_INPUT: Invalid note.';
    end if;
  end loop;
  if p_patch ? 'status' and coalesce(p_patch->>'status','') not in ('Open','In progress','Closed') then raise exception 'BIO_INVALID_INPUT: Invalid status.'; end if;
  if p_patch ? 'follow_up_date' and p_patch->'follow_up_date' <> 'null'::jsonb then
    dt := p_patch->>'follow_up_date';
    if dt <> '' then
      if jsonb_typeof(p_patch->'follow_up_date') <> 'string' or dt !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'BIO_INVALID_INPUT: Invalid date.'; end if;
      begin
        if to_char(dt::date,'YYYY-MM-DD') <> dt then raise exception 'Invalid date'; end if;
      exception when others then raise exception 'BIO_INVALID_INPUT: Invalid date.'; end;
    end if;
  end if;
  if p_patch ? 'action_owner_id' and p_patch->'action_owner_id' <> 'null'::jsonb then
    begin owner_id := (p_patch->>'action_owner_id')::uuid;
    exception when others then raise exception 'BIO_INVALID_INPUT: Invalid action owner.'; end;
    if not exists (select 1 from auth.users u where u.id = owner_id and u.email is not null and u.deleted_at is null
      and (u.banned_until is null or u.banned_until <= now())
      and coalesce(u.raw_user_meta_data->>'staff_directory_active','true') <> 'false') then raise exception 'BIO_INVALID_INPUT: Active staff action owner required.'; end if;
  end if;
  select * into e from public.biological_hazard_events where id = p_event_id for update;
  if not found then raise exception 'BIO_NOT_FOUND: Record not found.'; end if;
  if e.version <> p_version then raise exception 'BIO_VERSION_CONFLICT: Reload before saving.'; end if;
  -- Snapshot only review metadata: no medical body/signature or photo storage path.
  before_e := to_jsonb(e) - array['details','submission_key'];
  next_status := coalesce(p_patch->>'status',e.status);
  reason_text := case when p_patch ? 'closure_reason' then trim(p_patch->>'closure_reason') else e.closure_reason end;
  if next_status = 'Closed' and (nullif(reason_text,'') is null or
    (e.details->>'category' in ('exp','inj') and
      (nullif(case when p_patch ? 'follow_up_date' then p_patch->>'follow_up_date' else e.follow_up_date::text end,'') is null
      or nullif(trim(case when p_patch ? 'follow_up_notes' then p_patch->>'follow_up_notes' else e.follow_up_notes end),'') is null))) then
    raise exception 'BIO_CLOSURE_REQUIRED: Closing requires reason and completed exposure/illness follow-up.';
  end if;
  update public.biological_hazard_events set
    status = next_status, version = version + 1,
    admin_notes = case when p_patch ? 'admin_notes' then p_patch->>'admin_notes' else admin_notes end,
    follow_up_date = case when p_patch ? 'follow_up_date' then nullif(p_patch->>'follow_up_date','')::date else follow_up_date end,
    follow_up_notes = case when p_patch ? 'follow_up_notes' then p_patch->>'follow_up_notes' else follow_up_notes end,
    closure_reason = reason_text,
    action_owner_id = case when p_patch ? 'action_owner_id' then owner_id else action_owner_id end,
    closed_by = case when next_status = 'Closed' then coalesce(closed_by,p_actor_id) else null end,
    closed_at = case when next_status = 'Closed' then coalesce(closed_at,now()) else null end,
    updated_at = now()
  where id = e.id returning * into e;
  after_e := to_jsonb(e) - array['details','submission_key'];
  insert into public.biological_hazard_updates(event_id,version,action,actor_id,before_data,after_data,reason)
    values(e.id,e.version,'admin_updated',p_actor_id,before_e,after_e,reason_text);
  -- General audit feed contains identifiers/status only, not internal clinical prose.
  insert into public.admin_audit_log(actor_id,action,entity_type,entity_id,resource_key,before_data,after_data)
    values(p_actor_id,'biological_hazard_updated','biological_hazard_events',e.id,'admin.whs_monitoring',
      jsonb_build_object('status',before_e->>'status','version',before_e->'version'),
      jsonb_build_object('register_number',e.register_number,'status',e.status,'version',e.version));
  -- Only the affected submitter and this patch's explicitly assigned action owner.
  -- Assignment conveys no right to read someone else's report or photographs.
  insert into public.portal_events(recipient_id,event_type,severity,title,body,href,source_table,source_id)
  select u.id, 'biological_hazard_updated', 'information', 'Biological register update',
    'Report ' || e.register_number || ' status: ' || e.status || '.',
    case when u.id = e.created_by then '/?workspace=staffforms&formView=biological-history&biologicalEventId=' || e.id::text else '/staff/notifications' end,
    'biological_hazard_events',e.id
  from auth.users u where u.id in (e.created_by,owner_id) and u.deleted_at is null
    and (u.banned_until is null or u.banned_until <= now())
    and coalesce(u.raw_user_meta_data->>'staff_directory_active','true') <> 'false';
  return to_jsonb(e);
end;
$$;

create or replace function public.biological_hazard_attach_photo(p_actor_id uuid,p_event_id uuid,p_photo jsonb)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare e public.biological_hazard_events%rowtype; photo public.biological_hazard_photos%rowtype;
  photo_id uuid; photo_size bigint; summary jsonb;
begin
  if p_actor_id is null or not exists (select 1 from auth.users u where u.id = p_actor_id and u.email is not null
    and u.deleted_at is null and (u.banned_until is null or u.banned_until <= now())
    and coalesce(u.raw_user_meta_data->>'staff_directory_active','true') <> 'false') then raise exception 'BIO_FORBIDDEN: Active actor required.'; end if;
  select * into e from public.biological_hazard_events where id = p_event_id for update;
  if not found then raise exception 'BIO_NOT_FOUND: Record not found.'; end if;
  if e.created_by <> p_actor_id and not public.biological_hazard_can_manage(p_actor_id) then raise exception 'BIO_FORBIDDEN: Own record or WHS administrator required.'; end if;
  if p_photo is null or jsonb_typeof(p_photo) <> 'object' or octet_length(p_photo::text) > 2000
    or exists (select 1 from jsonb_object_keys(p_photo) as k(key) where key not in ('id','storage_path','file_name','mime_type','size_bytes')) then raise exception 'BIO_INVALID_INPUT: Valid photo metadata required.'; end if;
  begin
    if jsonb_typeof(p_photo->'id') is distinct from 'string' or jsonb_typeof(p_photo->'size_bytes') is distinct from 'number'
      or (p_photo->>'size_bytes') !~ '^\d+$' then raise exception 'Invalid metadata'; end if;
    photo_id := (p_photo->>'id')::uuid; photo_size := (p_photo->>'size_bytes')::bigint;
  exception when others then raise exception 'BIO_INVALID_INPUT: Invalid photo metadata.'; end;
  if p_photo->>'storage_path' is distinct from 'events/' || e.id::text || '/' || photo_id::text || '.jpeg'
    or p_photo->>'mime_type' is distinct from 'image/jpeg'
    or not (coalesce(p_photo->>'file_name','') = 'photo.jpeg' or coalesce(p_photo->>'file_name','') ~ '^biological-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$')
    or photo_size not between 1 and 8388608 then raise exception 'BIO_INVALID_INPUT: Invalid generated photo path or format.'; end if;
  if p_photo->>'file_name' <> 'photo.jpeg' then
    select * into photo from public.biological_hazard_photos where event_id=e.id and file_name=p_photo->>'file_name';
    if found then return to_jsonb(photo); end if;
  end if;
  if (select count(*) from public.biological_hazard_photos where event_id = e.id) >= 5 then raise exception 'BIO_PHOTO_LIMIT: At most five photos.'; end if;
  insert into public.biological_hazard_photos(id,event_id,storage_path,file_name,mime_type,size_bytes,created_by)
    values(photo_id,e.id,p_photo->>'storage_path',p_photo->>'file_name','image/jpeg',photo_size,p_actor_id) returning * into photo;
  update public.biological_hazard_events set version = version + 1, updated_at = now() where id = e.id returning * into e;
  summary := jsonb_build_object('photo_id',photo.id,'version',e.version,'status',e.status);
  insert into public.biological_hazard_updates(event_id,version,action,actor_id,after_data)
    values(e.id,e.version,'photo_attached',p_actor_id,summary);
  insert into public.admin_audit_log(actor_id,action,entity_type,entity_id,resource_key,after_data)
    values(p_actor_id,'biological_hazard_photo_attached','biological_hazard_events',e.id,
      case when p_actor_id = e.created_by then 'staff.forms' else 'admin.whs_monitoring' end,summary);
  return to_jsonb(photo);
end;
$$;

revoke all on function public.biological_hazard_can_manage(uuid) from public, anon, authenticated;
revoke all on function public.biological_hazard_preserve_record() from public, anon, authenticated, service_role;
revoke all on function public.biological_hazard_submit(uuid,jsonb,uuid) from public, anon, authenticated;
revoke all on function public.biological_hazard_update(uuid,uuid,integer,jsonb) from public, anon, authenticated;
revoke all on function public.biological_hazard_attach_photo(uuid,uuid,jsonb) from public, anon, authenticated;
grant execute on function public.biological_hazard_can_manage(uuid) to service_role;
grant execute on function public.biological_hazard_submit(uuid,jsonb,uuid) to service_role;
grant execute on function public.biological_hazard_update(uuid,uuid,integer,jsonb) to service_role;
grant execute on function public.biological_hazard_attach_photo(uuid,uuid,jsonb) to service_role;

-- Storage authorization occurs only on the server after linked-parent checks.
-- No public/anon/authenticated Storage policies are created by this migration.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('biological-hazard-photos','biological-hazard-photos',false,8388608,array['image/jpeg'])
on conflict(id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
-- Restrictive denial also defeats any legacy permissive policy covering ALL
-- buckets. This policy grants no access to this bucket or to any other bucket.
drop policy if exists biological_hazard_photos_no_browser on storage.objects;
create policy biological_hazard_photos_no_browser on storage.objects as restrictive
  for all to anon, authenticated
  using (bucket_id <> 'biological-hazard-photos')
  with check (bucket_id <> 'biological-hazard-photos');
comment on table public.biological_hazard_events is 'Restricted medical/WHS signed submissions; original details immutable, retained. Browser access denied; API scope=mine always own records.';
comment on table public.biological_hazard_updates is 'Append-only versioned review metadata; internal prose restricted to WHS reviewers, never notification/audit feed.';
comment on table public.biological_hazard_photos is 'Private Storage keys only; no binary image data. Row-locked RPC enforces five-photo cap.';
select pg_notify('pgrst','reload schema');
commit;
