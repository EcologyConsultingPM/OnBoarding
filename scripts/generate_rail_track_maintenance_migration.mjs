import { readFile, writeFile } from "node:fs/promises";

const sourcePath = "/home/ubuntu/upload/pasted_content_7.txt";
const outputPath = "sql/2026-09-25-rail-track-drainage-maintenance-plan.sql";
const projectId = "bcabdb53-0a06-4aed-9dea-33d875535c12";
const actorId = "2c265989-7864-41ad-9e2d-202d64d9a954";

const staff = {
  Aaron: "2c265989-7864-41ad-9e2d-202d64d9a954",
  Tony: "75b7ca74-86d9-4cf5-be17-31ac12947f40",
  Grace: "577f0587-e75c-4c35-8013-1b334c348871",
  Simon: "abd4449e-5294-4e18-ad2a-08403cc3e1ce",
  Shu: "669aa880-bdcd-4afd-82d5-3ef5fb7994f1",
  Patrick: "c9a881ce-431b-45b4-b5ae-aa50d6d4226d",
  Dylan: "4f0e728d-75e6-460e-9ae6-f065ce6865a9",
  Jane: "ff9205f1-e1e9-4e83-8693-3d90ad31c026",
};

const categoryMap = {
  "Other": "Other",
  "QA review": "QA Review",
  "GIS Mapping": "GIS/Mapping",
  "Internal Meeting": "General Project Management",
  "Client follow up": "Client Consultation",
  "Fieldwork & Travel": "Fieldwork & Travel",
  "Data Management": "Data Management",
  "Reporting": "Reporting",
};

const newSourceOrders = new Set([19, 22, 25, 28, 31, 67, 69, 71]);

function sqlText(value) {
  return `'${String(value ?? "").replaceAll("'", "''")}'`;
}

function sqlNullableText(value) {
  return value ? sqlText(value) : "null";
}

function sqlUuid(value) {
  return value ? `'${value}'::uuid` : "null::uuid";
}

function sqlNumber(value) {
  return value === "" || value == null ? "null" : `${Number(value)}::numeric`;
}

function parseDate(value) {
  const match = String(value || "").trim().match(/^(\d{1,2})-([A-Za-z]{3})-(\d{2})$/);
  if (!match) throw new Error(`Unrecognised date: ${value}`);
  const months = { Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06", Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12" };
  const day = match[1].padStart(2, "0");
  return `20${match[3]}-${months[match[2]]}-${day}`;
}

function detailFor(phase) {
  return phase ? `Phase: ${phase}` : "";
}

const text = await readFile(sourcePath, "utf8");
const rows = text.split(/\r?\n/).filter(Boolean).map((line, index) => {
  const parts = line.split("\t").map((part) => part.trim());
  if (parts.length < 10) throw new Error(`Expected 10 columns on source row ${index + 1}`);
  const [, phase, rawCategory, title, assignedName, hours, sourceStatus, progress, start, due] = parts;
  if (!title || !rawCategory) throw new Error(`Missing activity details on source row ${index + 1}`);
  const staffUserId = assignedName === "Staff" ? null : staff[assignedName];
  if (assignedName !== "Staff" && !staffUserId) throw new Error(`No staff mapping for ${assignedName}`);
  const category = categoryMap[rawCategory];
  if (!category) throw new Error(`No category mapping for ${rawCategory}`);
  return {
    sort: index + 1,
    phase,
    rawCategory,
    category,
    title,
    detail: detailFor(phase),
    staffUserId,
    budgetHours: hours,
    status: /^complete$/i.test(sourceStatus) ? "completed" : "not_commenced",
    progress: Number(String(progress).replace("%", "")) || 0,
    startDate: parseDate(start),
    dueDate: parseDate(due),
  };
});

if (rows.length !== 71) throw new Error(`Expected 71 source rows, found ${rows.length}`);

let existingSort = 0;
for (const row of rows) {
  row.existingSort = newSourceOrders.has(row.sort) ? null : ++existingSort;
}
if (existingSort !== 63) throw new Error(`Expected 63 existing rows, matched ${existingSort}`);

const tuples = rows.map((row) => `    (${[
  row.sort,
  row.existingSort == null ? "null::integer" : row.existingSort,
  sqlText(row.category),
  sqlText(row.title),
  sqlNullableText(row.detail),
  sqlUuid(row.staffUserId),
  sqlNumber(row.budgetHours),
  sqlText(row.status),
  `${row.progress}::numeric`,
  sqlText(row.startDate) + "::date",
  sqlText(row.dueDate) + "::date",
].join(", ")})`).join(",\n");

const sql = `-- Rail track drainage maintenance (1511): supplied 25 September 2026 work plan.
-- Updates the active plan and schedule with every supplied activity, current
-- completion status and dates. It also sets the requested team roles without
-- overwriting the existing project allocation hours or rates.

begin;

create temporary table rail_track_1511_plan (
  sort_order integer primary key,
  existing_sort_order integer,
  task_category text not null,
  title text not null,
  detail text,
  staff_user_id uuid,
  budget_hours numeric,
  status text not null,
  progress_percent numeric not null,
  start_date date not null,
  due_date date not null
) on commit drop;

insert into rail_track_1511_plan (
  sort_order, existing_sort_order, task_category, title, detail,
  staff_user_id, budget_hours, status, progress_percent, start_date, due_date
) values
${tuples};

do $rail_track$
declare
  v_project_id uuid := '${projectId}'::uuid;
  v_actor_id uuid := '${actorId}'::uuid;
  v_updated_count integer;
  v_inserted_count integer;
begin
  update public.projects
  set
    start_date = '2026-09-16',
    end_date = '2026-11-28',
    project_lead_user_id = '${staff.Aaron}'::uuid,
    overseeing_senior_ecologist_user_id = '${staff.Simon}'::uuid,
    status = 'active',
    activities_approval_status = 'approved',
    activities_approved_at = coalesce(activities_approved_at, now()),
    activities_approved_by = coalesce(activities_approved_by, v_actor_id),
    updated_at = now()
  where id = v_project_id;

  insert into public.project_allocations (
    project_id, staff_user_id, role_on_project, allocated_hours, hourly_rate,
    active, can_submit_entries
  ) values
    (v_project_id, '${staff.Simon}'::uuid, 'Senior Ecologist', null, null, true, true),
    (v_project_id, '${staff.Aaron}'::uuid, 'Project Manager', null, null, true, true),
    (v_project_id, '${staff.Tony}'::uuid, 'Project Manager', null, null, true, true),
    (v_project_id, '${staff.Grace}'::uuid, 'Project Manager', null, null, true, true),
    (v_project_id, '${staff.Patrick}'::uuid, 'Ecologist', null, null, true, true),
    (v_project_id, '${staff.Dylan}'::uuid, 'Ecologist', null, null, true, true),
    (v_project_id, '${staff.Shu}'::uuid, 'Ecologist / GIS Lead', null, null, true, true),
    (v_project_id, '${staff.Jane}'::uuid, 'Ecologist', null, null, true, true)
  on conflict (project_id, staff_user_id) do update set
    role_on_project = excluded.role_on_project,
    active = true,
    can_submit_entries = true,
    updated_at = now();

  -- Move existing rows away from the target sequence first, so source order can
  -- be restored without conflicting with an existing schedule position.
  update public.project_activities
  set sort_order = sort_order + 1000, updated_at = now()
  where project_id = v_project_id and is_active = true;

  update public.project_schedule_items
  set sort_order = sort_order + 1000, updated_at = now()
  where project_id = v_project_id and is_active = true;

  with updated_activities as (
    update public.project_activities as activity
    set
      sort_order = plan.sort_order,
      staff_user_id = plan.staff_user_id,
      task_category = plan.task_category,
      title = plan.title,
      detail = nullif(plan.detail, ''),
      budget_hours = plan.budget_hours,
      status = plan.status,
      progress_percent = plan.progress_percent,
      start_date = plan.start_date,
      due_date = plan.due_date,
      acceptance_status = case when plan.status = 'completed' or plan.staff_user_id is null then 'accepted' else 'awaiting_response' end,
      assigned_at = coalesce(activity.assigned_at, now()),
      accepted_at = case when plan.status = 'completed' or plan.staff_user_id is null then coalesce(activity.accepted_at, now()) else null end,
      started_at = case when plan.status = 'completed' then coalesce(activity.started_at, now()) else null end,
      completed_at = case when plan.status = 'completed' then coalesce(activity.completed_at, now()) else null end,
      assigned_by = v_actor_id,
      locked = false,
      is_active = true,
      updated_at = now()
    from rail_track_1511_plan as plan
    where activity.project_id = v_project_id
      and plan.existing_sort_order is not null
      and activity.sort_order = plan.existing_sort_order + 1000
    returning activity.id, activity.schedule_item_id, plan.*
  ), updated_schedule as (
    update public.project_schedule_items as schedule
    set
      sort_order = activity.sort_order,
      title = activity.title,
      detail = nullif(activity.detail, ''),
      start_date = activity.start_date,
      end_date = activity.due_date,
      milestone = false,
      progress_percent = activity.progress_percent,
      status = activity.status,
      is_active = true,
      generated_from_activity_id = activity.id,
      updated_at = now()
    from updated_activities as activity
    where schedule.id = activity.schedule_item_id
    returning schedule.id
  )
  select count(*) into v_updated_count from updated_activities;

  if v_updated_count <> 63 then
    raise exception 'Expected 63 existing Rail Track activities to update, updated %.', v_updated_count;
  end if;

  with inserted_schedule as (
    insert into public.project_schedule_items (
      project_id, sort_order, title, detail, start_date, end_date,
      milestone, progress_percent, status, is_active, created_at, updated_at
    )
    select
      v_project_id,
      plan.sort_order,
      plan.title,
      nullif(plan.detail, ''),
      plan.start_date,
      plan.due_date,
      false,
      plan.progress_percent,
      plan.status,
      true,
      now(),
      now()
    from rail_track_1511_plan as plan
    where plan.existing_sort_order is null
      and not exists (
        select 1 from public.project_activities existing
        where existing.project_id = v_project_id
          and existing.sort_order = plan.sort_order
          and existing.is_active = true
      )
    returning id, sort_order
  ), inserted_activities as (
    insert into public.project_activities (
      project_id, staff_user_id, task_category, title, detail, budget_hours,
      status, sort_order, created_by, due_date, start_date, schedule_item_id,
      acceptance_status, assigned_at, accepted_at, started_at, completed_at,
      assigned_by, progress_percent, locked, is_active
    )
    select
      v_project_id,
      plan.staff_user_id,
      plan.task_category,
      plan.title,
      nullif(plan.detail, ''),
      plan.budget_hours,
      plan.status,
      plan.sort_order,
      v_actor_id,
      plan.due_date,
      plan.start_date,
      schedule.id,
      'awaiting_response',
      now(),
      null,
      null,
      null,
      v_actor_id,
      plan.progress_percent,
      false,
      true
    from rail_track_1511_plan as plan
    join inserted_schedule as schedule using (sort_order)
    returning id, schedule_item_id
  )
  update public.project_schedule_items as schedule
  set generated_from_activity_id = activity.id, updated_at = now()
  from inserted_activities as activity
  where schedule.id = activity.schedule_item_id;

  get diagnostics v_inserted_count = row_count;
  if v_inserted_count <> 8 then
    raise exception 'Expected 8 new Rail Track activities to insert, inserted %.', v_inserted_count;
  end if;

  -- One consolidated notification per project team member avoids flooding the
  -- staff portal with one notification for each field-day assignment.
  insert into public.portal_events (
    recipient_id, event_type, severity, title, body, href, source_table, source_id
  )
  select
    team.staff_user_id,
    'project_plan_updated',
    'information',
    'Work plan updated: Rail track drainage maintenance (1511)',
    'The updated field programme, work activities and Gantt dates are ready. Review your assigned work and project schedule.',
    '/?workspace=staffprojects',
    'projects',
    v_project_id
  from (values
    ('${staff.Simon}'::uuid),
    ('${staff.Aaron}'::uuid),
    ('${staff.Tony}'::uuid),
    ('${staff.Grace}'::uuid),
    ('${staff.Patrick}'::uuid),
    ('${staff.Dylan}'::uuid),
    ('${staff.Shu}'::uuid),
    ('${staff.Jane}'::uuid)
  ) as team(staff_user_id)
  where not exists (
    select 1 from public.portal_events existing
    where existing.recipient_id = team.staff_user_id
      and existing.event_type = 'project_plan_updated'
      and existing.source_table = 'projects'
      and existing.source_id = v_project_id
  );
end $rail_track$;

commit;
`;

await writeFile(outputPath, sql, "utf8");
console.log(`Generated ${outputPath} with ${rows.length} activities, ${existingSort} updates and ${newSourceOrders.size} additions.`);
