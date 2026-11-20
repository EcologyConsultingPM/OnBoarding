-- Confirmed charge-out cards are PER JOB. Company project_role_rates remains
-- suggestion-only and is neither read nor written by tracker charging helpers.
-- No cards are seeded, no old entries are backfilled, and no stored allocation
-- actuals are repriced. Requires tracker foundation, admin_audit_log, visibility
-- overrides, and the existing project_closeout_can_manage(uuid) admin helper.
begin;

create table if not exists public.project_charge_rates (
  project_id uuid primary key references public.projects(id) on delete cascade,
  senior_ecologist_rate numeric(12,2) not null check (senior_ecologist_rate > 0 and senior_ecologist_rate <= 1000000),
  ecologist_rate numeric(12,2) not null check (ecologist_rate > 0 and ecologist_rate <= 1000000),
  project_manager_rate numeric(12,2) not null check (project_manager_rate > 0 and project_manager_rate <= 1000000),
  confirmed_by uuid not null references auth.users(id),
  confirmed_at timestamptz not null,
  updated_at timestamptz not null
);
alter table public.project_charge_rates enable row level security;
revoke all on public.project_charge_rates from public, anon, authenticated, service_role;
grant select on public.project_charge_rates to service_role;
-- No authenticated RLS policies; confirmation writes go through the audited RPC.

create or replace function public.ec_save_project_charge_rates(
  p_project_id uuid,
  p_actor_id uuid,
  p_expected_updated_at timestamptz,
  p_rates jsonb
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_actor_email text;
  v_before public.project_charge_rates%rowtype;
  v_after public.project_charge_rates%rowtype;
  v_exists boolean;
  v_role text;
  v_rate numeric;
  v_rates jsonb := '{}'::jsonb;
  v_now timestamptz;
begin
  select u.email into v_actor_email from auth.users u
    where u.id = p_actor_id and u.deleted_at is null
      and (u.banned_until is null or u.banned_until <= now())
      and public.project_closeout_can_manage(p_actor_id)
    limit 1;
  if v_actor_email is null then
    raise exception 'Only an active administrator can confirm project charge rates.' using errcode = '42501';
  end if;
  if lower(btrim(v_actor_email)) not in ('aaron.dooley@ecologyconsulting.au', 'tony.webster@ecologyconsulting.au')
    and exists(select 1 from public.portal_visibility_overrides v where v.user_id = p_actor_id
      and v.resource_key in ('admin.projects', 'admin.projects.setup') and v.is_visible = false limit 1) then
    raise exception 'Project setup access is disabled for this administrator.' using errcode = '42501';
  end if;
  if p_project_id is null or p_rates is null or jsonb_typeof(p_rates) is distinct from 'object' then
    raise exception 'Provide a project and exactly three charge roles.' using errcode = '22023';
  end if;
  if not (p_rates ?& array['Senior Ecologist', 'Ecologist', 'Project Manager'])
    or exists(select 1 from jsonb_object_keys(p_rates) k(role) where k.role not in ('Senior Ecologist', 'Ecologist', 'Project Manager')) then
    raise exception 'Provide exactly Senior Ecologist, Ecologist and Project Manager rates.' using errcode = '22023';
  end if;
  foreach v_role in array array['Senior Ecologist', 'Ecologist', 'Project Manager'] loop
    if jsonb_typeof(p_rates -> v_role) not in ('number', 'string')
      or (p_rates ->> v_role) !~ '^[0-9]+([.][0-9]+)?$' then
      raise exception 'Charge rates must be positive finite numbers no greater than 1,000,000.' using errcode = '22023';
    end if;
    v_rate := (p_rates ->> v_role)::numeric;
    if v_rate <= 0 or v_rate > 1000000 or round(v_rate, 2) <= 0 then
      raise exception 'Charge rates must round to positive amounts no greater than 1,000,000.' using errcode = '22023';
    end if;
    v_rates := v_rates || jsonb_build_object(v_role, round(v_rate, 2));
  end loop;

  -- Parent-first locks serialize creation as well as updates, and agree with
  -- importer lock order. A null expected timestamp means create-only.
  perform p.id from public.projects p where p.id = p_project_id and p.deleted_at is null for update;
  if not found then raise exception 'Project not found. No charge rates saved.' using errcode = 'P0002'; end if;
  select c.* into v_before from public.project_charge_rates c where c.project_id = p_project_id for update;
  v_exists := found;
  if (v_exists and v_before.updated_at is distinct from p_expected_updated_at)
    or (not v_exists and p_expected_updated_at is not null) then
    raise exception 'Project charge rates changed concurrently. Reload before confirming; no changes saved.' using errcode = '40001';
  end if;
  v_now := clock_timestamp();
  if v_exists then v_now := greatest(v_now, v_before.updated_at + interval '1 microsecond'); end if;
  insert into public.project_charge_rates(project_id, senior_ecologist_rate, ecologist_rate, project_manager_rate, confirmed_by, confirmed_at, updated_at)
    values(p_project_id, (v_rates ->> 'Senior Ecologist')::numeric, (v_rates ->> 'Ecologist')::numeric,
      (v_rates ->> 'Project Manager')::numeric, p_actor_id, v_now, v_now)
    on conflict (project_id) do update set
      senior_ecologist_rate = excluded.senior_ecologist_rate,
      ecologist_rate = excluded.ecologist_rate,
      project_manager_rate = excluded.project_manager_rate,
      confirmed_by = excluded.confirmed_by, confirmed_at = excluded.confirmed_at, updated_at = excluded.updated_at
    returning * into v_after;
  insert into public.admin_audit_log(actor_id, action, entity_type, entity_id, project_id, resource_key, before_data, after_data, reason)
    values(p_actor_id, 'project_charge_rates_confirmed', 'project_charge_rates', p_project_id, p_project_id,
      'admin.projects.setup', case when v_exists then to_jsonb(v_before) else '{}'::jsonb end,
      to_jsonb(v_after), 'Administrator explicitly confirmed per-job charge-out rates. Existing tracker snapshots and stored actuals were not repriced.');
  return to_jsonb(v_after);
end;
$$;

create or replace function public.ec_tracker_charge_role(p_staff_id uuid)
returns text language sql immutable set search_path = pg_catalog, public
as $$
  select case
    when p_staff_id in (
      'd07b78be-c1e7-4bf5-94fa-5366a59cb408'::uuid, -- Gerard Dwyer
      '4eef096c-91da-4135-839d-c8a67b3a5e6f'::uuid, -- Emily Zouch
      'abd4449e-5294-4e18-ad2a-08403cc3e1ce'::uuid  -- Simon Vinson
    ) then 'Senior Ecologist'
    when p_staff_id in (
      '577f0587-e75c-4c35-8013-1b334c348871'::uuid, -- Grace Stephenson
      '2c265989-7864-41ad-9e2d-202d64d9a954'::uuid, -- Aaron Dooley
      '75b7ca74-86d9-4cf5-be17-31ac12947f40'::uuid  -- Tony Webster
    ) then 'Project Manager'
    else 'Ecologist'
  end;
$$;

-- Existing entries use trusted snapshots, otherwise unchanged legacy pricing.
-- A current card never retroactively prices an unstamped historical entry.
create or replace function public.ec_tracker_entry_charge_rate(p_project_id uuid, p_staff_id uuid, p_custom_data jsonb)
returns numeric language plpgsql security definer set search_path = ''
as $$
declare
  v_role text := public.ec_tracker_charge_role(p_staff_id);
  v_rate numeric;
  v_default numeric;
begin
  if p_custom_data -> 'charge_rate_stamped' = 'true'::jsonb
    and p_custom_data ->> 'charge_role' = v_role then
    if jsonb_typeof(p_custom_data -> 'charge_rate_snapshot') is distinct from 'number' then
      raise exception 'Invalid trusted tracker charge rate snapshot for role %.', v_role using errcode = '23514';
    end if;
    v_rate := (p_custom_data ->> 'charge_rate_snapshot')::numeric;
    if v_rate <= 0 or v_rate::text in ('NaN', 'Infinity', '-Infinity') then
      raise exception 'Invalid trusted tracker charge rate snapshot for role %.', v_role using errcode = '23514';
    end if;
    return v_rate;
  end if;
  -- Preserve pre-card staff logging and legacy charging; never borrow a
  -- company role suggestion or a different project's card.
  select p.default_hourly_rate into v_default from public.projects p where p.id = p_project_id;
  if not found then raise exception 'Project not found for tracker charging.' using errcode = 'P0002'; end if;
  select a.hourly_rate into v_rate from public.project_allocations a
    where a.project_id = p_project_id and a.staff_user_id = p_staff_id limit 1;
  v_rate := coalesce(nullif(v_rate, 0), v_default, 0);
  if v_rate < 0 or v_rate::text in ('NaN', 'Infinity', '-Infinity') then
    raise exception 'Invalid legacy tracker charge rate.' using errcode = '23514';
  end if;
  return v_rate;
end;
$$;

-- Current pricing is used for review and for INSERT stamping only. Imports
-- separately require an explicitly confirmed card before calling this helper.
create or replace function public.ec_tracker_current_charge_rate(p_project_id uuid, p_staff_id uuid)
returns numeric language plpgsql security definer set search_path = ''
as $$
declare
  v_role text := public.ec_tracker_charge_role(p_staff_id);
  v_card public.project_charge_rates%rowtype;
begin
  select c.* into v_card from public.project_charge_rates c where c.project_id = p_project_id;
  if found and v_card.confirmed_by is not null and v_card.confirmed_at is not null then
    if v_card.senior_ecologist_rate is null or v_card.senior_ecologist_rate <= 0 or v_card.senior_ecologist_rate > 1000000
      or v_card.ecologist_rate is null or v_card.ecologist_rate <= 0 or v_card.ecologist_rate > 1000000
      or v_card.project_manager_rate is null or v_card.project_manager_rate <= 0 or v_card.project_manager_rate > 1000000 then
      raise exception 'Missing required positive project charge rate for project %.', p_project_id using errcode = '23514';
    end if;
    return case v_role when 'Senior Ecologist' then v_card.senior_ecologist_rate
      when 'Project Manager' then v_card.project_manager_rate else v_card.ecologist_rate end;
  end if;
  return public.ec_tracker_entry_charge_rate(p_project_id, p_staff_id, '{}'::jsonb);
end;
$$;

create or replace function public.ec_stamp_tracker_charge_rate()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  v_metadata jsonb := coalesce(new.custom_data, '{}'::jsonb);
  v_role text;
  v_rate numeric;
begin
  if jsonb_typeof(v_metadata) is distinct from 'object' then
    raise exception 'Tracker custom_data must be a JSON object.' using errcode = '23514';
  end if;
  v_metadata := v_metadata - 'charge_role' - 'charge_rate_snapshot' - 'charge_rate_stamped';
  if tg_op = 'INSERT' then
    -- A concurrent confirmation/save locks this same parent. The scalar is
    -- volatile so it sees the confirmed card after waiting for that lock.
    perform p.id from public.projects p where p.id = new.project_id for key share;
    if exists(select 1 from public.project_charge_rates c where c.project_id = new.project_id
      and c.confirmed_by is not null and c.confirmed_at is not null) then
      v_role := public.ec_tracker_charge_role(new.staff_user_id);
      v_rate := public.ec_tracker_current_charge_rate(new.project_id, new.staff_user_id);
      v_metadata := v_metadata || jsonb_build_object(
        'charge_role', v_role, 'charge_rate_snapshot', v_rate, 'charge_rate_stamped', true);
    end if;
  elsif old.custom_data -> 'charge_rate_stamped' = 'true'::jsonb then
    if new.staff_user_id is distinct from old.staff_user_id or new.project_id is distinct from old.project_id then
      raise exception 'Tracker snapshot project/staff identity cannot be changed; void and replace the entry.' using errcode = '23514';
    end if;
    v_role := public.ec_tracker_charge_role(old.staff_user_id);
    if old.custom_data ->> 'charge_role' is distinct from v_role then
      raise exception 'Invalid trusted tracker charge role snapshot.' using errcode = '23514';
    end if;
    v_rate := public.ec_tracker_entry_charge_rate(old.project_id, old.staff_user_id, old.custom_data);
    v_metadata := v_metadata || jsonb_build_object(
      'charge_role', v_role, 'charge_rate_snapshot', v_rate, 'charge_rate_stamped', true);
  end if;
  -- Unstamped legacy updates stay unstamped even after a card is confirmed.
  -- They cannot promote submitted metadata into a trusted historical rate.
  new.custom_data := v_metadata;
  return new;
end;
$$;

drop trigger if exists project_tracker_entries_charge_rate_stamp on public.project_tracker_entries;
create trigger project_tracker_entries_charge_rate_stamp
before insert or update on public.project_tracker_entries
for each row execute function public.ec_stamp_tracker_charge_rate();

revoke all on function public.ec_tracker_charge_role(uuid) from public, anon, authenticated;
revoke all on function public.ec_tracker_entry_charge_rate(uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.ec_tracker_current_charge_rate(uuid, uuid) from public, anon, authenticated;
revoke all on function public.ec_save_project_charge_rates(uuid, uuid, timestamptz, jsonb) from public, anon, authenticated;
revoke all on function public.ec_stamp_tracker_charge_rate() from public, anon, authenticated, service_role;
grant execute on function public.ec_tracker_charge_role(uuid) to service_role;
grant execute on function public.ec_tracker_entry_charge_rate(uuid, uuid, jsonb) to service_role;
grant execute on function public.ec_tracker_current_charge_rate(uuid, uuid) to service_role;
grant execute on function public.ec_save_project_charge_rates(uuid, uuid, timestamptz, jsonb) to service_role;
notify pgrst, 'reload schema';
commit;
