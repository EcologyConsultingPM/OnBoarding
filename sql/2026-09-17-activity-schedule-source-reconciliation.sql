-- Reconcile legacy one-to-one Work Activity and Gantt links.
--
-- Step 4 (Work activities) is the authoritative delivery plan for a linked
-- activity. Older records may have schedule_item_id but no
-- generated_from_activity_id, which allowed Step 5 to retain stale dates,
-- titles and progress. Only a schedule item with exactly one active linked
-- activity is adopted. Shared manual phases remain untouched.

begin;

with single_activity_links as (
  select
    a.schedule_item_id,
    min(a.id::text)::uuid as activity_id
  from public.project_activities a
  join public.project_schedule_items s
    on s.id = a.schedule_item_id
   and s.is_active = true
  where a.is_active = true
    and a.schedule_item_id is not null
  group by a.schedule_item_id
  having count(*) = 1
)
update public.project_schedule_items s
set
  generated_from_activity_id = l.activity_id,
  updated_at = now()
from single_activity_links l
where s.id = l.schedule_item_id
  and s.generated_from_activity_id is null;

commit;
