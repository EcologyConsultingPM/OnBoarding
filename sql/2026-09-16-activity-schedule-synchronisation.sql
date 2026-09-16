-- Preserve the source relationship for Gantt items created from a Work Activity.
-- Generated schedule items track their source activity; manually-created phases
-- remain untouched when an activity is edited.

alter table public.project_schedule_items
  add column if not exists generated_from_activity_id uuid
  references public.project_activities(id) on delete set null;

create unique index if not exists project_schedule_generated_activity_unique
  on public.project_schedule_items(generated_from_activity_id)
  where generated_from_activity_id is not null;

-- Backfill only an unambiguous one-to-one legacy match. Grouped/manual phases
-- are intentionally left manual and will not be rewritten by activity saves.
with single_linked_activity as (
  select
    schedule_item_id,
    min(id::text)::uuid as activity_id
  from public.project_activities
  where is_active = true
    and schedule_item_id is not null
  group by schedule_item_id
  having count(*) = 1
)
update public.project_schedule_items schedule
set generated_from_activity_id = linked.activity_id
from single_linked_activity linked
join public.project_activities activity on activity.id = linked.activity_id
where schedule.id = linked.schedule_item_id
  and schedule.generated_from_activity_id is null
  and schedule.title = activity.title
  and coalesce(schedule.detail, '') = coalesce(activity.detail, '')
  and coalesce(schedule.start_date::text, '') = coalesce(activity.start_date::text, activity.due_date::text, '')
  and coalesce(schedule.end_date::text, '') = coalesce(activity.due_date::text, '')
  and coalesce(schedule.milestone, false) = coalesce(activity.milestone, false);
