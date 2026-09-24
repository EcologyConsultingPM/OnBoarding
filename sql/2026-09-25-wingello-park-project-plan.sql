-- WINGELLO PARK (1525): supplied 25 September 2026 project activity plan and
-- category-level project tracker update. Individual team allocations are role
-- and access records only; no per-person budget hours were supplied.
--
-- The three earlier summary tracker rows are reconciled to the first three
-- source-workbook rows with an audit record. The remaining workbook rows are
-- then retained individually, so category figures are derived from actual work.

begin;

do $wingello$
declare
  v_project_id uuid := '37edf194-fc99-4636-8c04-e884c2248560'::uuid;
  v_actor_id uuid := '2c265989-7864-41ad-9e2d-202d64d9a954'::uuid;
  v_source_id uuid;
  v_template_id uuid;
  v_legacy_ids uuid[];
begin
  select id into v_source_id
  from public.project_budget_sources
  where project_id = v_project_id
    and source_type = 'original'
  order by effective_date asc, created_at asc
  limit 1;

  if v_source_id is null then
    raise exception 'WINGELLO PARK (1525) requires an approved original tracker source.';
  end if;

  update public.projects
  set
    start_date = '2026-08-21',
    end_date = '2026-10-03',
    budget_hours = 55,
    budget_dollars = 6900,
    default_hourly_rate = round(6900::numeric / 55::numeric, 2),
    project_lead_user_id = '4eef096c-91da-4135-839d-c8a67b3a5e6f'::uuid,
    overseeing_senior_ecologist_user_id = '4eef096c-91da-4135-839d-c8a67b3a5e6f'::uuid,
    status = 'active',
    activities_approval_status = 'approved',
    updated_at = now()
  where id = v_project_id;

  -- Emily is the Senior Ecologist. Patrick, Devi, Shu and Julianne have
  -- Ecologist roles and active project access; category budgets hold the hours.
  insert into public.project_allocations (
    project_id, staff_user_id, role_on_project, allocated_hours, hourly_rate,
    active, can_submit_entries
  ) values
    (v_project_id, '4eef096c-91da-4135-839d-c8a67b3a5e6f'::uuid, 'Senior Ecologist', null, null, true, true),
    (v_project_id, 'c9a881ce-431b-45b4-b5ae-aa50d6d4226d'::uuid, 'Ecologist', null, null, true, true),
    (v_project_id, '3d953525-1627-4b70-863c-24ae61b0a549'::uuid, 'Ecologist', null, null, true, true),
    (v_project_id, '669aa880-bdcd-4afd-82d5-3ef5fb7994f1'::uuid, 'Ecologist', null, null, true, true),
    (v_project_id, 'e5cc0d64-b4d0-4751-afdf-84306bd7c24c'::uuid, 'Ecologist', null, null, true, true)
  on conflict (project_id, staff_user_id) do update set
    role_on_project = excluded.role_on_project,
    allocated_hours = null,
    hourly_rate = null,
    active = true,
    can_submit_entries = true,
    updated_at = now();

  update public.project_budget_sources
  set
    source_name = 'WINGELLO PARK (1525) · FFA approved baseline',
    approved_value = 6900,
    approved_hours = 55,
    approval_status = 'approved',
    updated_by = v_actor_id,
    updated_at = now()
  where id = v_source_id;

  -- Category budget from the supplied workbook. Allocation values use the
  -- approved hourly equivalent because no different category dollar split was
  -- supplied. Actual consumption is drawn from the itemised workbook ledger.
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
    round(allocation_hours * 6900::numeric / 55::numeric, 2),
    allocation_hours,
    hours_consumed,
    round(hours_consumed * 6900::numeric / 55::numeric, 2),
    round(hours_consumed * 6900::numeric / 55::numeric * 0.6, 2),
    80,
    'active',
    true,
    v_actor_id,
    v_actor_id
  from (values
    ('DESKTOP', 'Desktop/Field plan', 0::numeric, 0::numeric),
    ('PREPARATION', 'Preparation (pre-fieldwork, pre-report set up)', 0::numeric, 0::numeric),
    ('FIELDWORK', 'Fieldwork & Travel', 6::numeric, 0::numeric),
    ('DATA', 'Data Management', 2::numeric, 0::numeric),
    ('REPORTING', 'Reporting', 31::numeric, 42.5::numeric),
    ('GIS', 'GIS/Mapping', 5::numeric, 18.1::numeric),
    ('QA', 'QA Review', 7::numeric, 7.25::numeric),
    ('CLIENT', 'Client Consultation', 2::numeric, 0.5::numeric),
    ('PROJECT_MGMT', 'General Project Management', 2::numeric, 1.5::numeric),
    ('OTHER', 'Other', 0::numeric, 0::numeric),
    ('DELIVERY', 'Delivery', 0::numeric, 0::numeric),
    ('FEEDBACK', 'Feedback Review', 0::numeric, 0::numeric)
  ) as budget_data(allocation_code, allocation_name, allocation_hours, hours_consumed)
  on conflict (budget_source_id, allocation_code) do update set
    allocation_name = excluded.allocation_name,
    allocation_value = excluded.allocation_value,
    allocation_hours = excluded.allocation_hours,
    hours_consumed = excluded.hours_consumed,
    charge_out_spend = excluded.charge_out_spend,
    internal_cost = excluded.internal_cost,
    threshold_percent = 80,
    status = 'active',
    staff_visible = true,
    updated_by = v_actor_id,
    updated_at = now();

  select id into v_template_id
  from public.project_tracker_templates
  where project_id = v_project_id
  order by updated_at desc
  limit 1;

  if v_template_id is null then
    insert into public.project_tracker_templates (
      project_id, template_name, instructions, category_options,
      column_definitions, guidance_rows, locked, locked_by, locked_at,
      created_by, updated_by
    ) values (
      v_project_id,
      'Project Tracker — WINGELLO PARK (1525)',
      'Record actual time against the controlled category budget. Escalate to the Senior Ecologist before continuing where a category is exceeded.',
      '["Desktop/Field plan","Preparation (pre-fieldwork, pre-report set up)","Fieldwork & Travel","GIS/Mapping","Data Management","General Project Management","Client Consultation","QA Review","Reporting","Other","Delivery","Feedback Review"]'::jsonb,
      '[]'::jsonb,
      '[]'::jsonb,
      true,
      v_actor_id,
      now(),
      v_actor_id,
      v_actor_id
    );
  else
    update public.project_tracker_templates
    set
      template_name = 'Project Tracker — WINGELLO PARK (1525)',
      instructions = 'Record actual time against the controlled category budget. Escalate to the Senior Ecologist before continuing where a category is exceeded.',
      category_options = '["Desktop/Field plan","Preparation (pre-fieldwork, pre-report set up)","Fieldwork & Travel","GIS/Mapping","Data Management","General Project Management","Client Consultation","QA Review","Reporting","Other","Delivery","Feedback Review"]'::jsonb,
      locked = true,
      locked_by = v_actor_id,
      locked_at = coalesce(locked_at, now()),
      updated_by = v_actor_id,
      updated_at = now()
    where id = v_template_id;
  end if;

  -- There are no active project activities at the time of this import.
  -- Create one linked Gantt item for every supplied work activity.
  with input(sort_order, title, detail, staff_user_id, task_category, status, progress_percent, start_date, due_date) as (
    values
      (1, 'Prepare FFA v0.1', 'Imported from the supplied Wingello work plan.', 'c9a881ce-431b-45b4-b5ae-aa50d6d4226d'::uuid, 'Reporting', 'completed', 100::numeric, '2026-08-21'::date, '2026-08-27'::date),
      (2, 'Submit mapping request', 'Imported from the supplied Wingello work plan.', 'c9a881ce-431b-45b4-b5ae-aa50d6d4226d'::uuid, 'GIS/Mapping', 'completed', 100::numeric, '2026-08-25'::date, '2026-08-25'::date),
      (3, 'Complete mapping', 'Imported from the supplied Wingello work plan.', '3d953525-1627-4b70-863c-24ae61b0a549'::uuid, 'GIS/Mapping', 'completed', 100::numeric, '2026-09-14'::date, '2026-09-14'::date),
      (4, 'Complete mapping', 'Imported from the supplied Wingello work plan.', '669aa880-bdcd-4afd-82d5-3ef5fb7994f1'::uuid, 'GIS/Mapping', 'completed', 100::numeric, '2026-09-14'::date, '2026-09-14'::date),
      (5, 'QA draft v0.1 and mapping', 'Imported from the supplied Wingello work plan.', '4eef096c-91da-4135-839d-c8a67b3a5e6f'::uuid, 'QA Review', 'completed', 100::numeric, '2026-09-18'::date, '2026-09-18'::date),
      (6, 'Addressing SE feedback', 'Imported from the supplied Wingello work plan.', 'c9a881ce-431b-45b4-b5ae-aa50d6d4226d'::uuid, 'Reporting', 'completed', 100::numeric, '2026-09-21'::date, '2026-09-21'::date),
      (7, 'Final proof read', 'Imported from the supplied Wingello work plan.', '4eef096c-91da-4135-839d-c8a67b3a5e6f'::uuid, 'QA Review', 'completed', 100::numeric, '2026-09-21'::date, '2026-09-21'::date),
      (8, 'Delivery stage 2 draft v0.1', 'Imported from the supplied Wingello work plan.', '4eef096c-91da-4135-839d-c8a67b3a5e6f'::uuid, 'Delivery', 'completed', 100::numeric, '2026-09-24'::date, '2026-09-24'::date),
      (9, 'Client follow up', 'Imported from the supplied Wingello work plan.', '4eef096c-91da-4135-839d-c8a67b3a5e6f'::uuid, 'Client Consultation', 'not_commenced', 0::numeric, '2026-09-26'::date, '2026-09-26'::date),
      (10, 'Review client feedback', 'Imported from the supplied Wingello work plan.', '4eef096c-91da-4135-839d-c8a67b3a5e6f'::uuid, 'QA Review', 'not_commenced', 0::numeric, '2026-09-27'::date, '2026-09-27'::date),
      (11, 'Address client feedback', 'Imported from the supplied Wingello work plan.', 'c9a881ce-431b-45b4-b5ae-aa50d6d4226d'::uuid, 'Reporting', 'not_commenced', 0::numeric, '2026-09-28'::date, '2026-09-28'::date),
      (12, 'Final QA review for v1', 'Imported from the supplied Wingello work plan.', '4eef096c-91da-4135-839d-c8a67b3a5e6f'::uuid, 'QA Review', 'not_commenced', 0::numeric, '2026-09-28'::date, '2026-09-28'::date),
      (13, 'Client follow up if required', 'Imported from the supplied Wingello work plan.', '4eef096c-91da-4135-839d-c8a67b3a5e6f'::uuid, 'Client Consultation', 'not_commenced', 0::numeric, '2026-10-01'::date, '2026-10-01'::date),
      (14, 'Council follow up if required', 'Imported from the supplied Wingello work plan.', '4eef096c-91da-4135-839d-c8a67b3a5e6f'::uuid, 'Client Consultation', 'not_commenced', 0::numeric, '2026-10-01'::date, '2026-10-01'::date),
      (15, 'Delivery of stage 2 FFA v1', 'Imported from the supplied Wingello work plan.', '4eef096c-91da-4135-839d-c8a67b3a5e6f'::uuid, 'Delivery', 'not_commenced', 0::numeric, '2026-10-02'::date, '2026-10-02'::date),
      (16, 'Invoice final', 'Imported from the supplied Wingello work plan. Assign an internal owner before commencing.', null::uuid, 'Other', 'not_commenced', 0::numeric, '2026-10-03'::date, '2026-10-03'::date)
  ), schedule_rows as (
    insert into public.project_schedule_items (
      project_id, sort_order, title, detail, start_date, end_date,
      milestone, progress_percent, status, is_active, created_at, updated_at
    )
    select v_project_id, sort_order, title, detail, start_date, due_date,
      false, progress_percent, status, true, now(), now()
    from input
    order by sort_order
    returning id, sort_order
  ), activities as (
    insert into public.project_activities (
      project_id, staff_user_id, task_category, title, detail, budget_hours,
      status, sort_order, created_by, due_date, start_date, schedule_item_id,
      acceptance_status, assigned_at, accepted_at, started_at, completed_at,
      assigned_by, progress_percent, locked, is_active, notified_at
    )
    select
      v_project_id,
      input.staff_user_id,
      input.task_category,
      input.title,
      input.detail,
      null,
      input.status,
      input.sort_order,
      v_actor_id,
      input.due_date,
      input.start_date,
      schedule_rows.id,
      case when input.status = 'completed' or input.staff_user_id is null then 'accepted' else 'awaiting_response' end,
      now(),
      case when input.status = 'completed' or input.staff_user_id is null then now() else null end,
      case when input.status = 'completed' then now() else null end,
      case when input.status = 'completed' then now() else null end,
      v_actor_id,
      input.progress_percent,
      false,
      true,
      case when input.status = 'completed' or input.staff_user_id is null then null else now() end
    from input
    join schedule_rows using (sort_order)
    order by input.sort_order
    returning id, title, task_category, staff_user_id, budget_hours, due_date, status, schedule_item_id
  ), provenance as (
    update public.project_schedule_items as schedule
    set generated_from_activity_id = activity.id,
        updated_at = now()
    from activities as activity
    where schedule.id = activity.schedule_item_id
    returning schedule.id
  )
  insert into public.portal_events (
    recipient_id, event_type, severity, title, body, href, source_table, source_id
  )
  select
    activity.staff_user_id,
    'project_activity_assigned',
    'action_required',
    'Work assignment: ' || activity.title,
    'WINGELLO PARK (1525) · ' || activity.task_category || coalesce(' · Due ' || to_char(activity.due_date, 'DD Mon'), ''),
    '/staff/notifications',
    'project_activities',
    activity.id
  from activities as activity
  where activity.status = 'not_commenced'
    and activity.staff_user_id is not null;

  -- Reconcile the earlier three summary entries before replacing them with the
  -- itemised tracker ledger. This preserves their original values in the audit
  -- trail rather than deleting them.
  select array_agg(id order by work_date asc, created_at asc) into v_legacy_ids
  from (
    select id, work_date, created_at
    from public.project_tracker_entries
    where project_id = v_project_id
      and custom_data ->> 'import_batch' is distinct from 'wingello_1525_2026_09_25'
    order by work_date asc, created_at asc
    limit 3
  ) as legacy_rows;

  if coalesce(array_length(v_legacy_ids, 1), 0) = 3 then
    insert into public.project_tracker_entry_audit (
      project_id, tracker_entry_id, action, reason, before_data, after_data, performed_by
    )
    select
      v_project_id,
      entry.id,
      'corrected',
      'Reconciled a prior Wingello summary entry to the supplied itemised tracker workbook; the original summary is retained here.',
      to_jsonb(entry),
      null,
      v_actor_id
    from public.project_tracker_entries as entry
    where entry.id = any(v_legacy_ids);

    with raw(seq, staff_user_id, work_date, allocation_code, activity_information, hours) as (
      values
        (1, 'c9a881ce-431b-45b4-b5ae-aa50d6d4226d'::uuid, '2026-08-20'::date, 'REPORTING', 'Meeting with Emily', 0.5::numeric),
        (2, 'c9a881ce-431b-45b4-b5ae-aa50d6d4226d'::uuid, '2026-08-21'::date, 'REPORTING', 'LOOC and Intro of report', 6::numeric),
        (3, 'c9a881ce-431b-45b4-b5ae-aa50d6d4226d'::uuid, '2026-08-24'::date, 'REPORTING', 'LOOC table', 4.75::numeric)
    ), legacy(seq, id) as (
      select row_number() over (order by array_position(v_legacy_ids, entry_id)), entry_id
      from unnest(v_legacy_ids) as legacy_row(entry_id)
    ), allocation_map as (
      select allocation_code, id as allocation_id
      from public.project_budget_allocations
      where project_id = v_project_id and budget_source_id = v_source_id
    )
    update public.project_tracker_entries as entry
    set
      budget_source_id = v_source_id,
      budget_allocation_id = allocation_map.allocation_id,
      activity_id = null,
      staff_user_id = raw.staff_user_id,
      work_date = raw.work_date,
      activity_category = case raw.allocation_code when 'REPORTING' then 'Reporting' else raw.allocation_code end,
      activity_information = raw.activity_information,
      hours = raw.hours,
      status = 'completed',
      notable_issues = null,
      custom_data = jsonb_build_object('import_batch', 'wingello_1525_2026_09_25', 'source', 'Budget 1525.xlsx', 'source_row', raw.seq),
      entered_by_admin_id = v_actor_id,
      updated_at = now()
    from raw
    join legacy on legacy.seq = raw.seq
    join allocation_map on allocation_map.allocation_code = raw.allocation_code
    where entry.id = legacy.id;
  end if;

  -- Insert the remaining itemised tracker ledger rows. The import marker makes
  -- the data load safe to re-run without duplicating historical time entries.
  with raw(seq, staff_user_id, work_date, allocation_code, activity_information, hours) as (
    values
      (4, 'c9a881ce-431b-45b4-b5ae-aa50d6d4226d'::uuid, '2026-08-25'::date, 'REPORTING', 'Review of the LOOC table, methodology, intro, Appendix A', 6.75::numeric),
      (5, 'c9a881ce-431b-45b4-b5ae-aa50d6d4226d'::uuid, '2026-08-25'::date, 'REPORTING', 'Meeting with Emily', 0.25::numeric),
      (6, '4eef096c-91da-4135-839d-c8a67b3a5e6f'::uuid, '2026-08-25'::date, 'REPORTING', 'Call with Patrick about project reporting', 0.25::numeric),
      (7, 'c9a881ce-431b-45b4-b5ae-aa50d6d4226d'::uuid, '2026-08-26'::date, 'REPORTING', 'Review of the LOOC table, methodology, intro, Appendix A', 5.25::numeric),
      (8, '4eef096c-91da-4135-839d-c8a67b3a5e6f'::uuid, '2026-08-26'::date, 'QA', 'Review LOOC for Patrick', 1.75::numeric),
      (9, 'e5cc0d64-b4d0-4751-afdf-84306bd7c24c'::uuid, '2026-08-27'::date, 'REPORTING', 'PCT justification for Emily', 2::numeric),
      (10, 'c9a881ce-431b-45b4-b5ae-aa50d6d4226d'::uuid, '2026-08-27'::date, 'REPORTING', 'Start sections 5 and 6 and finish LOOC', 5.75::numeric),
      (11, '4eef096c-91da-4135-839d-c8a67b3a5e6f'::uuid, '2026-08-27'::date, 'REPORTING', 'Feedback for Patrick LOOC', 0.5::numeric),
      (12, '4eef096c-91da-4135-839d-c8a67b3a5e6f'::uuid, '2026-08-27'::date, 'QA', 'Review PCTs and Julianne work', 0.5::numeric),
      (13, 'c9a881ce-431b-45b4-b5ae-aa50d6d4226d'::uuid, '2026-08-28'::date, 'REPORTING', 'Sections 4, 5 and 6', 4::numeric),
      (14, 'c9a881ce-431b-45b4-b5ae-aa50d6d4226d'::uuid, '2026-08-31'::date, 'REPORTING', 'Review Emily''s edits', 2.5::numeric),
      (15, '4eef096c-91da-4135-839d-c8a67b3a5e6f'::uuid, '2026-08-31'::date, 'QA', 'Review Wingello report', 2::numeric),
      (16, '4eef096c-91da-4135-839d-c8a67b3a5e6f'::uuid, '2026-09-01'::date, 'QA', 'Review and detailed feedback for Patrick', 3::numeric),
      (17, '4eef096c-91da-4135-839d-c8a67b3a5e6f'::uuid, '2026-09-01'::date, 'PROJECT_MGMT', 'Project tracker administration', 0.5::numeric),
      (18, 'c9a881ce-431b-45b4-b5ae-aa50d6d4226d'::uuid, '2026-09-02'::date, 'REPORTING', 'Review of Emily''s comments', 4::numeric),
      (19, '4eef096c-91da-4135-839d-c8a67b3a5e6f'::uuid, '2026-09-03'::date, 'CLIENT', 'Email to client', 0.5::numeric),
      (20, '669aa880-bdcd-4afd-82d5-3ef5fb7994f1'::uuid, '2026-09-10'::date, 'GIS', 'Checking client file and preparing boundaries file', 2.5::numeric),
      (21, '3d953525-1627-4b70-863c-24ae61b0a549'::uuid, '2026-09-10'::date, 'GIS', 'FFA mapping', 1.5::numeric),
      (22, '669aa880-bdcd-4afd-82d5-3ef5fb7994f1'::uuid, '2026-09-11'::date, 'GIS', 'Mapping using field data', 0.5::numeric),
      (23, '3d953525-1627-4b70-863c-24ae61b0a549'::uuid, '2026-09-11'::date, 'GIS', 'Completed figures 1–7 and 10; shared via Teams', 8.5::numeric),
      (24, '4eef096c-91da-4135-839d-c8a67b3a5e6f'::uuid, '2026-09-11'::date, 'PROJECT_MGMT', 'Assist Devi with mapping', 1::numeric),
      (25, '669aa880-bdcd-4afd-82d5-3ef5fb7994f1'::uuid, '2026-09-14'::date, 'GIS', 'Checking CAD and creating footprint', 0.6::numeric),
      (26, '3d953525-1627-4b70-863c-24ae61b0a549'::uuid, '2026-09-14'::date, 'GIS', 'Completed FFA mapping; uploaded to SharePoint and updated prior maps for the revised development footprint', 3::numeric),
      (27, '3d953525-1627-4b70-863c-24ae61b0a549'::uuid, '2026-09-16'::date, 'GIS', 'Edited maps following Emily''s feedback; project setup, layouts, data compilation, map creation and existing environment work', 1.5::numeric)
  ), allocation_map as (
    select allocation_code, id as allocation_id, allocation_name
    from public.project_budget_allocations
    where project_id = v_project_id and budget_source_id = v_source_id
  ), inserted as (
    insert into public.project_tracker_entries (
      project_id, budget_source_id, budget_allocation_id, activity_id,
      staff_user_id, entered_by_admin_id, work_date, activity_category,
      activity_information, hours, status, notable_issues, custom_data,
      created_at, updated_at
    )
    select
      v_project_id,
      v_source_id,
      allocation_map.allocation_id,
      null,
      raw.staff_user_id,
      v_actor_id,
      raw.work_date,
      allocation_map.allocation_name,
      raw.activity_information,
      raw.hours,
      'completed',
      null,
      jsonb_build_object('import_batch', 'wingello_1525_2026_09_25', 'source', 'Budget 1525.xlsx', 'source_row', raw.seq),
      now(),
      now()
    from raw
    join allocation_map on allocation_map.allocation_code = raw.allocation_code
    where not exists (
      select 1
      from public.project_tracker_entries as existing
      where existing.project_id = v_project_id
        and existing.custom_data ->> 'import_batch' = 'wingello_1525_2026_09_25'
        and existing.custom_data ->> 'source_row' = raw.seq::text
    )
    returning id
  )
  insert into public.project_tracker_entry_audit (
    project_id, tracker_entry_id, action, reason, before_data, after_data, performed_by
  )
  select
    v_project_id,
    inserted.id,
    'corrected',
    'Imported itemised historical tracker time from the supplied Budget 1525.xlsx workbook.',
    '{}'::jsonb,
    jsonb_build_object('import_batch', 'wingello_1525_2026_09_25'),
    v_actor_id
  from inserted;
end $wingello$;

commit;
