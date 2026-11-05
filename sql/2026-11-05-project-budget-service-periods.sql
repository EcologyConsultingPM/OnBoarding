-- Inclusive optional budget service periods. No backfill, budget duplication,
-- entry reclassification, source-type changes, or RLS/policy changes.
-- Apply before deploying the service-period-aware API/UI.
begin;

alter table public.project_budget_sources
  add column if not exists service_period_start date,
  add column if not exists service_period_end date;

alter table public.project_budget_sources
  drop constraint if exists project_budget_sources_service_period_bounds;
alter table public.project_budget_sources
  add constraint project_budget_sources_service_period_bounds check (
    (service_period_start is null and service_period_end is null)
    or (service_period_start is not null and service_period_end is not null
      and isfinite(service_period_start) and isfinite(service_period_end)
      and service_period_start <= service_period_end)
  );

comment on column public.project_budget_sources.service_period_start is
  'Inclusive optional service-period start; paired with service_period_end. Monthly UI uses first day of month.';
comment on column public.project_budget_sources.service_period_end is
  'Inclusive optional service-period end; paired with service_period_start. Monthly UI uses last day of month.';

create or replace function public.check_project_tracker_entry_service_period()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  source_project uuid;
  period_start date;
  period_end date;
  allocation_project uuid;
  allocation_source uuid;
begin
  -- SHARE (not KEY SHARE) serialises entry validation with a period edit,
  -- including privileged admin/import writes; no SECURITY DEFINER bypass.
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
  -- Both period columns NULL is an unrestricted legacy source, regardless of
  -- its effective_date. Historical work is never rejected based on that date.
  return new;
end;
$$;

drop trigger if exists project_tracker_entries_service_period_guard on public.project_tracker_entries;
create trigger project_tracker_entries_service_period_guard
before insert or update on public.project_tracker_entries
for each row execute function public.check_project_tracker_entry_service_period();

create or replace function public.check_project_budget_source_period_edit()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
begin
  if new.service_period_start is not null and exists (
    select 1 from public.project_tracker_entries entry
    where entry.budget_source_id = old.id
      and (entry.work_date < new.service_period_start or entry.work_date > new.service_period_end)
  ) then
    raise exception using errcode = '23514', message = 'Cannot change service period: existing tracker entries fall outside the proposed bounds.';
  end if;
  if new.project_id is distinct from old.project_id and exists (
    select 1 from public.project_tracker_entries entry where entry.budget_source_id = old.id
  ) then
    raise exception using errcode = '23514', message = 'Cannot move a budget source with existing tracker entries to another project.';
  end if;
  return new;
end;
$$;

drop trigger if exists project_budget_sources_service_period_edit_guard on public.project_budget_sources;
create trigger project_budget_sources_service_period_edit_guard
before update of service_period_start, service_period_end, project_id on public.project_budget_sources
for each row execute function public.check_project_budget_source_period_edit();

commit;
