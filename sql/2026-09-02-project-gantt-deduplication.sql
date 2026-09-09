begin;

-- Choose one canonical active Gantt row for each exact same-project schedule
-- definition, then move linked activities before retiring duplicate rows.
create temporary table gantt_schedule_dedup on commit drop as
with ranked as (
  select
    id,
    first_value(id) over (
      partition by project_id, title, detail, start_date, end_date
      order by sort_order asc nulls last, created_at asc nulls last, id asc
    ) as canonical_id,
    row_number() over (
      partition by project_id, title, detail, start_date, end_date
      order by sort_order asc nulls last, created_at asc nulls last, id asc
    ) as row_number
  from public.project_schedule_items
  where is_active = true
)
select id, canonical_id
from ranked
where row_number > 1;

update public.project_activities activity
set schedule_item_id = dedup.canonical_id,
    updated_at = now()
from gantt_schedule_dedup dedup
where activity.schedule_item_id = dedup.id
  and activity.is_active = true;

update public.project_schedule_items schedule_item
set is_active = false,
    updated_at = now()
from gantt_schedule_dedup dedup
where schedule_item.id = dedup.id;

-- Retain the earliest exact duplicate activity row per project. Repeated rows
-- are retired rather than deleted so tracker/audit references remain valid.
with ranked as (
  select
    id,
    row_number() over (
      partition by project_id, staff_user_id, task_category, title, detail,
        budget_hours, due_date, schedule_item_id
      order by created_at asc nulls last, id asc
    ) as row_number
  from public.project_activities
  where is_active = true
)
update public.project_activities activity
set is_active = false,
    updated_at = now()
from ranked duplicate
where activity.id = duplicate.id
  and duplicate.row_number > 1;

commit;
