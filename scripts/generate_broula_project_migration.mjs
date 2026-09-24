import { readFile, writeFile } from "node:fs/promises";

const sourcePath = "/home/ubuntu/upload/pasted_content_2.txt";
const outputPath = new URL("../sql/2026-09-24-broula-king-mine-project.sql", import.meta.url);
const actorId = "2c265989-7864-41ad-9e2d-202d64d9a954"; // Aaron Dooley
const staffIds = {
  Aaron: actorId,
  Emily: "4eef096c-91da-4135-839d-c8a67b3a5e6f",
  Simon: "abd4449e-5294-4e18-ad2a-08403cc3e1ce",
  Gerard: "d07b78be-c1e7-4bf5-94fa-5366a59cb408",
  Rosie: "f62ded2f-8ee5-4b3e-a06e-8952514844ad",
  Julianne: "e5cc0d64-b4d0-4751-afdf-84306bd7c24c",
  Jane: "ff9205f1-e1e9-4e83-8693-3d90ad31c026",
  Dylan: "4f0e728d-75e6-460e-9ae6-f065ce6865a9",
};

const roles = [
  [staffIds.Aaron, "Project Manager"],
  [staffIds.Emily, "Senior Ecologist"],
  [staffIds.Simon, "Senior Ecologist"],
  [staffIds.Gerard, "Senior Ecologist"],
  [staffIds.Rosie, "Ecologist"],
  [staffIds.Julianne, "Ecologist"],
  [staffIds.Jane, "Ecologist"],
  [staffIds.Dylan, "Ecologist"],
];

const categoryMap = {
  "Client follow up": "Client Consultation",
  "Desktop/field plan": "Desktop/Field plan",
  "Fieldwork & Travel": "Fieldwork & Travel",
  "Data Management": "Data Management",
  "Internal Meeting": "General Project Management",
  "Other": "Other",
  "Reporting": "Reporting",
  "GIS Mapping": "GIS/Mapping",
  "QA review": "QA Review",
  "Feedback Review": "QA Review",
  "Delivery": "Delivery",
};

const categories = [
  ["DESKTOP", "Desktop/Field plan", 7, 8.5],
  ["PREP", "Preparation (pre-fieldwork, pre-report set up)", 12, 8.4],
  ["FIELD", "Fieldwork & Travel", 282, 156.25],
  ["DATA", "Data Management", 43, 15.5],
  ["REPORT", "Reporting", 66, 44.25],
  ["GIS", "GIS/Mapping", 24, 15],
  ["QA", "QA Review", 8, 0],
  ["CLIENT", "Client Consultation", 8, 17.65],
  ["PM", "General Project Management", 5, 25.35],
  // The supplied overall total is 302.8 hours while the listed category rows
  // total 298.3; the 4.5-hour difference is retained in Other so the live
  // Tracker agrees with the provided 152.2 hours remaining.
  ["OTHER", "Other", 0, 11.9],
  ["DELIVERY", "Delivery", 0, 0],
];

const escape = (value) => String(value ?? "").replaceAll("'", "''");
const sqlText = (value) => value == null || value === "" ? "null" : `'${escape(value)}'`;
const sqlNumber = (value) => value == null || value === "" ? "null" : String(Number(value));

function parseDate(value) {
  const clean = String(value || "").trim();
  if (!clean) return null;
  const match = clean.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{2})$/);
  if (!match) throw new Error(`Unrecognised activity date: ${clean}`);
  const months = { Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6, Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12 };
  return `20${match[3]}-${String(months[match[2]]).padStart(2, "0")}-${String(match[1]).padStart(2, "0")}`;
}

const raw = await readFile(sourcePath, "utf8");
const lines = raw.split(/\r?\n/).slice(2).filter(Boolean);
const activities = lines.map((line, index) => {
  const [project, activityNumber, activity, detail, staff, budget, status, progress, start, end] = line.split("\t");
  if (project.trim() !== "Irwin- Broula") throw new Error(`Unexpected source project at line ${index + 3}.`);
  const title = `${activityNumber.trim()} · ${activity.trim()}`;
  const staffId = staffIds[String(staff || "").trim()] || null;
  const activityStatus = /^complete/i.test(String(status || "")) ? "completed" : "not_commenced";
  return {
    sortOrder: index + 1,
    title,
    detail: String(detail || "").trim(),
    staffId,
    category: categoryMap[String(activity || "").trim()] || "Other",
    budgetHours: String(budget || "").trim() || null,
    status: activityStatus,
    progress: Number(String(progress || "0").replace("%", "")) || 0,
    startDate: parseDate(start),
    endDate: parseDate(end),
  };
}).filter((activity) => activity.status !== "completed");

// Historical completed work is represented by the supplied category tracker
// totals. The active Work Activities and Gantt plan should contain only the
// remaining 2026 delivery assignments, so staff do not receive a duplicated
// history beside their live work plan.
if (activities.length !== 60) throw new Error(`Expected 60 remaining activity rows, found ${activities.length}.`);

const activityValues = activities.map((activity) => `(
      ${activity.sortOrder},
      ${sqlText(activity.title)},
      ${sqlText(activity.detail)},
      ${activity.staffId ? `'${activity.staffId}'::uuid` : "null"},
      ${sqlText(activity.category)},
      ${sqlNumber(activity.budgetHours)},
      ${sqlText(activity.status)},
      ${sqlNumber(activity.progress)},
      ${sqlText(activity.startDate)},
      ${sqlText(activity.endDate)}
    )`).join(",\n");

const teamValues = roles.map(([id, role]) => `('${id}'::uuid, '${role}')`).join(",\n    ");
const categoryValues = categories.map(([code, name, allocated, used]) => `('${code}', '${name}', ${allocated}, ${used})`).join(",\n    ");
const trackerCategories = JSON.stringify(categories.map(([, name]) => name));

const sql = `-- Broula King Mine BUMBALDRY (1453) seeded from the supplied activity
-- plan and category-level tracker workbook. Individual project allocations are
-- intentionally role-only: no per-person budget-hour allocation was supplied.
begin;

do $broula$
declare
  v_project_id uuid;
  v_source_id uuid;
  v_actor_id uuid := '${actorId}'::uuid;
  v_activity_count integer;
begin
  select id into v_project_id
  from public.projects
  where name = 'Broula King Mine BUMBALDRY (1453)'
    and deleted_at is null
  limit 1;

  if v_project_id is null then
    insert into public.projects (
      created_by, name, client_name, description, scope_of_works,
      project_lead_user_id, overseeing_senior_ecologist_user_id,
      start_date, end_date, budget_hours, budget_dollars,
      default_hourly_rate, status, activities_approval_status,
      activities_approved_at, activities_approved_by
    ) values (
      v_actor_id,
      'Broula King Mine BUMBALDRY (1453)',
      'Irwin Environmental Management (594)',
      'BDAR project with staged ecological surveys, reporting, QA and final BOAMS submission.',
      'Prepare and deliver the Biodiversity Development Assessment Report (BDAR), including ecological surveys, data management, mapping, quality assurance and BOAMS submission.',
      '${staffIds.Aaron}'::uuid,
      '${staffIds.Emily}'::uuid,
      '2026-06-01', '2026-12-08', 455, 110829, 243.58, 'active', 'approved', now(), v_actor_id
    ) returning id into v_project_id;
  else
    update public.projects set
      client_name = 'Irwin Environmental Management (594)',
      description = 'BDAR project with staged ecological surveys, reporting, QA and final BOAMS submission.',
      scope_of_works = 'Prepare and deliver the Biodiversity Development Assessment Report (BDAR), including ecological surveys, data management, mapping, quality assurance and BOAMS submission.',
      project_lead_user_id = '${staffIds.Aaron}'::uuid,
      overseeing_senior_ecologist_user_id = '${staffIds.Emily}'::uuid,
      start_date = '2026-06-01', end_date = '2026-12-08',
      budget_hours = 455, budget_dollars = 110829, default_hourly_rate = 243.58,
      status = 'active', activities_approval_status = 'approved',
      activities_approved_at = coalesce(activities_approved_at, now()),
      activities_approved_by = coalesce(activities_approved_by, v_actor_id),
      updated_at = now()
    where id = v_project_id;
  end if;

  insert into public.project_allocations (project_id, staff_user_id, role_on_project, allocated_hours, hourly_rate, active, can_submit_entries)
  values
    ${teamValues}
  on conflict (project_id, staff_user_id) do update set
    role_on_project = excluded.role_on_project,
    allocated_hours = null,
    hourly_rate = null,
    active = true,
    can_submit_entries = true,
    updated_at = now();

  insert into public.project_budget_sources (
    project_id, source_code, source_name, source_type, approved_value,
    approved_hours, approval_status, effective_date, created_by, updated_by
  ) values (
    v_project_id, '1453-ORIGINAL', 'Original contract · Budget JobNo1453.v3.xlsx', 'original',
    110829, 455, 'approved', '2026-04-08', v_actor_id, v_actor_id
  )
  on conflict (project_id, source_code) do update set
    source_name = excluded.source_name,
    approved_value = excluded.approved_value,
    approved_hours = excluded.approved_hours,
    approval_status = excluded.approval_status,
    updated_by = v_actor_id,
    updated_at = now()
  returning id into v_source_id;

  insert into public.project_budget_allocations (
    project_id, budget_source_id, allocation_code, allocation_name,
    allocation_value, allocation_hours, hours_consumed, charge_out_spend,
    internal_cost, threshold_percent, status, staff_visible, created_by, updated_by
  )
  select
    v_project_id,
    v_source_id,
    allocation_code,
    allocation_name,
    round(allocation_hours * 110829 / 455, 2),
    allocation_hours,
    hours_consumed,
    round(hours_consumed * 58704 / 302.8, 2),
    round(hours_consumed * 58704 / 302.8 * 0.6, 2),
    80,
    'active',
    true,
    v_actor_id,
    v_actor_id
  from (values
    ${categoryValues}
  ) as budget_data(allocation_code, allocation_name, allocation_hours, hours_consumed)
  on conflict (budget_source_id, allocation_code) do update set
    allocation_name = excluded.allocation_name,
    allocation_value = excluded.allocation_value,
    allocation_hours = excluded.allocation_hours,
    hours_consumed = excluded.hours_consumed,
    charge_out_spend = excluded.charge_out_spend,
    internal_cost = excluded.internal_cost,
    status = 'active',
    staff_visible = true,
    updated_by = v_actor_id,
    updated_at = now();

  insert into public.project_tracker_templates (
    project_id, template_name, instructions, category_options,
    column_definitions, guidance_rows, locked, locked_by, locked_at,
    created_by, updated_by
  )
  select
    v_project_id,
    'Project Tracker — Broula King Mine BUMBALDRY (1453)',
    'Record actual project activity against the controlled category budget. Escalate before continuing if a category budget has been exceeded.',
    '${trackerCategories}'::jsonb,
    '[]'::jsonb,
    '[]'::jsonb,
    true,
    v_actor_id,
    now(),
    v_actor_id,
    v_actor_id
  where not exists (select 1 from public.project_tracker_templates where project_id = v_project_id);

  insert into public.project_tracker_settings (
    project_id, tracker_visible, resources_ready, training_checked,
    forms_configured, whs_checked, activated_by, activated_at, updated_by
  ) values (
    v_project_id, true, true, true, true, true, v_actor_id, now(), v_actor_id
  )
  on conflict (project_id) do update set
    tracker_visible = true,
    resources_ready = true,
    training_checked = true,
    forms_configured = true,
    whs_checked = true,
    activated_by = v_actor_id,
    activated_at = coalesce(public.project_tracker_settings.activated_at, now()),
    updated_by = v_actor_id,
    updated_at = now();

  select count(*) into v_activity_count from public.project_activities where project_id = v_project_id;
  if v_activity_count = 0 then
    with input(sort_order, title, detail, staff_user_id, task_category, budget_hours, status, progress_percent, start_date, end_date) as (
      values
      ${activityValues}
    ), schedule_rows as (
      insert into public.project_schedule_items (
        project_id, sort_order, title, detail, start_date, end_date,
        milestone, progress_percent, status, is_active
      )
      select v_project_id, sort_order, title, detail, start_date, end_date,
        false, progress_percent, status, true
      from input
      order by sort_order
      returning id, sort_order
    )
    insert into public.project_activities (
      project_id, staff_user_id, task_category, title, detail, budget_hours,
      status, sort_order, created_by, due_date, start_date, schedule_item_id,
      acceptance_status, assigned_at, accepted_at, started_at, completed_at,
      assigned_by, progress_percent, locked, is_active
    )
    select
      v_project_id, input.staff_user_id, input.task_category, input.title,
      input.detail, input.budget_hours, input.status, input.sort_order,
      v_actor_id, input.end_date, input.start_date, schedule_rows.id,
      'accepted', now(), now(),
      case when input.status = 'completed' then now() else null end,
      case when input.status = 'completed' then now() else null end,
      v_actor_id, input.progress_percent, false, true
    from input
    join schedule_rows using (sort_order)
    order by input.sort_order;

    update public.project_schedule_items as schedule
    set generated_from_activity_id = activity.id,
        updated_at = now()
    from public.project_activities as activity
    where activity.project_id = v_project_id
      and schedule.id = activity.schedule_item_id;
  end if;
end $broula$;

commit;
`;

await writeFile(outputPath, sql);
console.log(`Generated ${outputPath.pathname} with ${activities.length} activity assignments.`);
