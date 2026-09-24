-- Broula King Mine BUMBALDRY (1453) seeded from the supplied activity
-- plan and category-level tracker workbook. Individual project allocations are
-- intentionally role-only: no per-person budget-hour allocation was supplied.
begin;

do $broula$
declare
  v_project_id uuid;
  v_source_id uuid;
  v_actor_id uuid := '2c265989-7864-41ad-9e2d-202d64d9a954'::uuid;
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
      '2c265989-7864-41ad-9e2d-202d64d9a954'::uuid,
      '4eef096c-91da-4135-839d-c8a67b3a5e6f'::uuid,
      '2026-06-01', '2026-12-08', 455, 110829, 243.58, 'active', 'approved', now(), v_actor_id
    ) returning id into v_project_id;
  else
    update public.projects set
      client_name = 'Irwin Environmental Management (594)',
      description = 'BDAR project with staged ecological surveys, reporting, QA and final BOAMS submission.',
      scope_of_works = 'Prepare and deliver the Biodiversity Development Assessment Report (BDAR), including ecological surveys, data management, mapping, quality assurance and BOAMS submission.',
      project_lead_user_id = '2c265989-7864-41ad-9e2d-202d64d9a954'::uuid,
      overseeing_senior_ecologist_user_id = '4eef096c-91da-4135-839d-c8a67b3a5e6f'::uuid,
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
    ('2c265989-7864-41ad-9e2d-202d64d9a954'::uuid, 'Project Manager'),
    ('4eef096c-91da-4135-839d-c8a67b3a5e6f'::uuid, 'Senior Ecologist'),
    ('abd4449e-5294-4e18-ad2a-08403cc3e1ce'::uuid, 'Senior Ecologist'),
    ('d07b78be-c1e7-4bf5-94fa-5366a59cb408'::uuid, 'Senior Ecologist'),
    ('f62ded2f-8ee5-4b3e-a06e-8952514844ad'::uuid, 'Ecologist'),
    ('e5cc0d64-b4d0-4751-afdf-84306bd7c24c'::uuid, 'Ecologist'),
    ('ff9205f1-e1e9-4e83-8693-3d90ad31c026'::uuid, 'Ecologist'),
    ('4f0e728d-75e6-460e-9ae6-f065ce6865a9'::uuid, 'Ecologist')
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
    ('DESKTOP', 'Desktop/Field plan', 7, 8.5),
    ('PREP', 'Preparation (pre-fieldwork, pre-report set up)', 12, 8.4),
    ('FIELD', 'Fieldwork & Travel', 282, 156.25),
    ('DATA', 'Data Management', 43, 15.5),
    ('REPORT', 'Reporting', 66, 44.25),
    ('GIS', 'GIS/Mapping', 24, 15),
    ('QA', 'QA Review', 8, 0),
    ('CLIENT', 'Client Consultation', 8, 17.65),
    ('PM', 'General Project Management', 5, 25.35),
    ('OTHER', 'Other', 0, 11.9),
    ('DELIVERY', 'Delivery', 0, 0)
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
    '["Desktop/Field plan","Preparation (pre-fieldwork, pre-report set up)","Fieldwork & Travel","Data Management","Reporting","GIS/Mapping","QA Review","Client Consultation","General Project Management","Other","Delivery"]'::jsonb,
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
      (
      35,
      '27 · Desktop/field plan',
      'Draft Oct field plan',
      'f62ded2f-8ee5-4b3e-a06e-8952514844ad'::uuid,
      'Desktop/Field plan',
      1,
      'not_commenced',
      0,
      '2026-10-01',
      '2026-10-01'
    ),
(
      36,
      '28 · Internal Meeting',
      'Pre field kick meetin for Oct surveys',
      'f62ded2f-8ee5-4b3e-a06e-8952514844ad'::uuid,
      'General Project Management',
      0.5,
      'not_commenced',
      0,
      '2026-10-01',
      '2026-10-01'
    ),
(
      37,
      '28 · Internal Meeting',
      'Pre field kick meetin for Oct surveys',
      'd07b78be-c1e7-4bf5-94fa-5366a59cb408'::uuid,
      'General Project Management',
      0.5,
      'not_commenced',
      0,
      '2026-10-01',
      '2026-10-01'
    ),
(
      38,
      '28 · Internal Meeting',
      'Pre field kick meetin for Oct surveys',
      '4eef096c-91da-4135-839d-c8a67b3a5e6f'::uuid,
      'General Project Management',
      0.5,
      'not_commenced',
      0,
      '2026-10-01',
      '2026-10-01'
    ),
(
      39,
      '28 · Internal Meeting',
      'Pre field kick meetin for Oct surveys',
      'e5cc0d64-b4d0-4751-afdf-84306bd7c24c'::uuid,
      'General Project Management',
      0.5,
      'not_commenced',
      0,
      '2026-10-01',
      '2026-10-01'
    ),
(
      40,
      '29 · Other',
      'Anabat preparation',
      '4eef096c-91da-4135-839d-c8a67b3a5e6f'::uuid,
      'Other',
      3,
      'not_commenced',
      0,
      '2026-10-02',
      '2026-10-02'
    ),
(
      41,
      '30 · Other',
      'Camera preparation',
      'd07b78be-c1e7-4bf5-94fa-5366a59cb408'::uuid,
      'Other',
      3,
      'not_commenced',
      0,
      '2026-10-02',
      '2026-10-02'
    ),
(
      42,
      '31 · Fieldwork & Travel',
      'Travel',
      'e5cc0d64-b4d0-4751-afdf-84306bd7c24c'::uuid,
      'Fieldwork & Travel',
      2.25,
      'not_commenced',
      0,
      '2026-10-12',
      '2026-10-12'
    ),
(
      43,
      '31 · Fieldwork & Travel',
      'Travel',
      'd07b78be-c1e7-4bf5-94fa-5366a59cb408'::uuid,
      'Fieldwork & Travel',
      2.25,
      'not_commenced',
      0,
      '2026-10-12',
      '2026-10-12'
    ),
(
      44,
      '32 · Fieldwork & Travel',
      'Anabat deployment and other camp search',
      'd07b78be-c1e7-4bf5-94fa-5366a59cb408'::uuid,
      'Fieldwork & Travel',
      6,
      'not_commenced',
      0,
      '2026-10-12',
      '2026-10-12'
    ),
(
      45,
      '32 · Fieldwork & Travel',
      'Anabat deployment and other camp search',
      'e5cc0d64-b4d0-4751-afdf-84306bd7c24c'::uuid,
      'Fieldwork & Travel',
      6,
      'not_commenced',
      0,
      '2026-10-12',
      '2026-10-12'
    ),
(
      46,
      '33 · Fieldwork & Travel',
      'Raptor survey  1',
      'd07b78be-c1e7-4bf5-94fa-5366a59cb408'::uuid,
      'Fieldwork & Travel',
      0.5,
      'not_commenced',
      0,
      '2026-10-12',
      '2026-10-12'
    ),
(
      47,
      '33 · Fieldwork & Travel',
      'Raptor survey  1',
      'e5cc0d64-b4d0-4751-afdf-84306bd7c24c'::uuid,
      'Fieldwork & Travel',
      0.5,
      'not_commenced',
      0,
      '2026-10-12',
      '2026-10-12'
    ),
(
      48,
      '34 · Fieldwork & Travel',
      'Diurnal survey 1',
      'd07b78be-c1e7-4bf5-94fa-5366a59cb408'::uuid,
      'Fieldwork & Travel',
      1,
      'not_commenced',
      0,
      '2026-10-13',
      '2026-10-13'
    ),
(
      49,
      '34 · Fieldwork & Travel',
      'Diurnal survey  1',
      'e5cc0d64-b4d0-4751-afdf-84306bd7c24c'::uuid,
      'Fieldwork & Travel',
      1,
      'not_commenced',
      0,
      '2026-10-13',
      '2026-10-13'
    ),
(
      50,
      '35 · Fieldwork & Travel',
      'Threat flora transects x 1',
      'd07b78be-c1e7-4bf5-94fa-5366a59cb408'::uuid,
      'Fieldwork & Travel',
      6,
      'not_commenced',
      0,
      '2026-10-13',
      '2026-10-13'
    ),
(
      51,
      '35 · Fieldwork & Travel',
      'Threat flora transects x 1',
      'e5cc0d64-b4d0-4751-afdf-84306bd7c24c'::uuid,
      'Fieldwork & Travel',
      6,
      'not_commenced',
      0,
      '2026-10-13',
      '2026-10-13'
    ),
(
      52,
      '36 · Fieldwork & Travel',
      'Raptor survey 2',
      'd07b78be-c1e7-4bf5-94fa-5366a59cb408'::uuid,
      'Fieldwork & Travel',
      0.5,
      'not_commenced',
      0,
      '2026-10-13',
      '2026-10-13'
    ),
(
      53,
      '36 · Fieldwork & Travel',
      'Raptor survey 2',
      'e5cc0d64-b4d0-4751-afdf-84306bd7c24c'::uuid,
      'Fieldwork & Travel',
      0.5,
      'not_commenced',
      0,
      '2026-10-13',
      '2026-10-13'
    ),
(
      54,
      '37 · Fieldwork & Travel',
      'Diurnal survey  2',
      'd07b78be-c1e7-4bf5-94fa-5366a59cb408'::uuid,
      'Fieldwork & Travel',
      1,
      'not_commenced',
      0,
      '2026-10-14',
      '2026-10-14'
    ),
(
      55,
      '37 · Fieldwork & Travel',
      'Diurnal survey  2',
      'e5cc0d64-b4d0-4751-afdf-84306bd7c24c'::uuid,
      'Fieldwork & Travel',
      1,
      'not_commenced',
      0,
      '2026-10-14',
      '2026-10-14'
    ),
(
      56,
      '38 · Fieldwork & Travel',
      'Threat flora transects x 2',
      'd07b78be-c1e7-4bf5-94fa-5366a59cb408'::uuid,
      'Fieldwork & Travel',
      6,
      'not_commenced',
      0,
      '2026-10-14',
      '2026-10-14'
    ),
(
      57,
      '38 · Fieldwork & Travel',
      'Threat flora transects x 2',
      'e5cc0d64-b4d0-4751-afdf-84306bd7c24c'::uuid,
      'Fieldwork & Travel',
      6,
      'not_commenced',
      0,
      '2026-10-14',
      '2026-10-14'
    ),
(
      58,
      '39 · Fieldwork & Travel',
      'Camera deployment',
      'd07b78be-c1e7-4bf5-94fa-5366a59cb408'::uuid,
      'Fieldwork & Travel',
      8,
      'not_commenced',
      0,
      '2026-10-15',
      '2026-10-15'
    ),
(
      59,
      '39 · Fieldwork & Travel',
      'Camera deployment',
      'e5cc0d64-b4d0-4751-afdf-84306bd7c24c'::uuid,
      'Fieldwork & Travel',
      8,
      'not_commenced',
      0,
      '2026-10-15',
      '2026-10-15'
    ),
(
      60,
      '40 · Data Management',
      'Data up laod',
      'd07b78be-c1e7-4bf5-94fa-5366a59cb408'::uuid,
      'Data Management',
      1.5,
      'not_commenced',
      0,
      '2026-10-16',
      '2026-10-16'
    ),
(
      61,
      '40 · Data Management',
      'Data up laod',
      'e5cc0d64-b4d0-4751-afdf-84306bd7c24c'::uuid,
      'Data Management',
      1.5,
      'not_commenced',
      0,
      '2026-10-16',
      '2026-10-16'
    ),
(
      62,
      '41 · Fieldwork & Travel',
      'Travel',
      'd07b78be-c1e7-4bf5-94fa-5366a59cb408'::uuid,
      'Fieldwork & Travel',
      2.25,
      'not_commenced',
      0,
      '2026-10-16',
      '2026-10-16'
    ),
(
      63,
      '41 · Fieldwork & Travel',
      'Travel',
      'e5cc0d64-b4d0-4751-afdf-84306bd7c24c'::uuid,
      'Fieldwork & Travel',
      2.25,
      'not_commenced',
      0,
      '2026-10-16',
      '2026-10-16'
    ),
(
      64,
      '42 · Fieldwork & Travel',
      'Draft Nov field plan',
      'f62ded2f-8ee5-4b3e-a06e-8952514844ad'::uuid,
      'Fieldwork & Travel',
      1,
      'not_commenced',
      0,
      '2026-11-10',
      '2026-11-10'
    ),
(
      65,
      '43 · Fieldwork & Travel',
      'Pre field kick meetin for Nov surveys',
      'f62ded2f-8ee5-4b3e-a06e-8952514844ad'::uuid,
      'Fieldwork & Travel',
      0.5,
      'not_commenced',
      0,
      '2026-11-10',
      '2026-11-10'
    ),
(
      66,
      '43 · Fieldwork & Travel',
      'Pre field kick meetin for Nov surveys',
      '4eef096c-91da-4135-839d-c8a67b3a5e6f'::uuid,
      'Fieldwork & Travel',
      0.5,
      'not_commenced',
      0,
      '2026-11-10',
      '2026-11-10'
    ),
(
      67,
      '43 · Fieldwork & Travel',
      'Pre field kick meetin for Nov surveys',
      'd07b78be-c1e7-4bf5-94fa-5366a59cb408'::uuid,
      'Fieldwork & Travel',
      0.5,
      'not_commenced',
      0,
      '2026-11-10',
      '2026-11-10'
    ),
(
      68,
      '44 · Fieldwork & Travel',
      'Travel',
      'd07b78be-c1e7-4bf5-94fa-5366a59cb408'::uuid,
      'Fieldwork & Travel',
      2.25,
      'not_commenced',
      0,
      '2026-11-16',
      '2026-11-16'
    ),
(
      69,
      '44 · Fieldwork & Travel',
      'Travel',
      'f62ded2f-8ee5-4b3e-a06e-8952514844ad'::uuid,
      'Fieldwork & Travel',
      2.25,
      'not_commenced',
      0,
      '2026-11-16',
      '2026-11-16'
    ),
(
      70,
      '45 · Fieldwork & Travel',
      'Anabat and camera retrival',
      'd07b78be-c1e7-4bf5-94fa-5366a59cb408'::uuid,
      'Fieldwork & Travel',
      6,
      'not_commenced',
      0,
      '2026-11-16',
      '2026-11-16'
    ),
(
      71,
      '45 · Fieldwork & Travel',
      'Anabat and camera retrival',
      'f62ded2f-8ee5-4b3e-a06e-8952514844ad'::uuid,
      'Fieldwork & Travel',
      6,
      'not_commenced',
      0,
      '2026-11-16',
      '2026-11-16'
    ),
(
      72,
      '46 · Fieldwork & Travel',
      'Raptor survey 3',
      'd07b78be-c1e7-4bf5-94fa-5366a59cb408'::uuid,
      'Fieldwork & Travel',
      0.5,
      'not_commenced',
      0,
      '2026-11-16',
      '2026-11-16'
    ),
(
      73,
      '46 · Fieldwork & Travel',
      'Raptor survey 3',
      'f62ded2f-8ee5-4b3e-a06e-8952514844ad'::uuid,
      'Fieldwork & Travel',
      0.5,
      'not_commenced',
      0,
      '2026-11-16',
      '2026-11-16'
    ),
(
      74,
      '47 · Fieldwork & Travel',
      'Diurnal survey 3',
      'd07b78be-c1e7-4bf5-94fa-5366a59cb408'::uuid,
      'Fieldwork & Travel',
      1,
      'not_commenced',
      0,
      '2026-11-17',
      '2026-11-17'
    ),
(
      75,
      '47 · Fieldwork & Travel',
      'Diurnal survey 3',
      'f62ded2f-8ee5-4b3e-a06e-8952514844ad'::uuid,
      'Fieldwork & Travel',
      1,
      'not_commenced',
      0,
      '2026-11-17',
      '2026-11-17'
    ),
(
      76,
      '48 · Fieldwork & Travel',
      'Anabat and camera retrival',
      'd07b78be-c1e7-4bf5-94fa-5366a59cb408'::uuid,
      'Fieldwork & Travel',
      6,
      'not_commenced',
      0,
      '2026-11-17',
      '2026-11-17'
    ),
(
      77,
      '48 · Fieldwork & Travel',
      'Anabat and camera retrival',
      'f62ded2f-8ee5-4b3e-a06e-8952514844ad'::uuid,
      'Fieldwork & Travel',
      6,
      'not_commenced',
      0,
      '2026-11-17',
      '2026-11-17'
    ),
(
      78,
      '49 · Fieldwork & Travel',
      'Raptor survey 4',
      'd07b78be-c1e7-4bf5-94fa-5366a59cb408'::uuid,
      'Fieldwork & Travel',
      0.5,
      'not_commenced',
      0,
      '2026-11-17',
      '2026-11-17'
    ),
(
      79,
      '49 · Fieldwork & Travel',
      'Raptor survey 4',
      'f62ded2f-8ee5-4b3e-a06e-8952514844ad'::uuid,
      'Fieldwork & Travel',
      0.5,
      'not_commenced',
      0,
      '2026-11-17',
      '2026-11-17'
    ),
(
      80,
      '50 · Fieldwork & Travel',
      'Diurnal survey 4',
      'd07b78be-c1e7-4bf5-94fa-5366a59cb408'::uuid,
      'Fieldwork & Travel',
      1,
      'not_commenced',
      0,
      '2026-11-18',
      '2026-11-18'
    ),
(
      81,
      '50 · Fieldwork & Travel',
      'Diurnal survey 4',
      'f62ded2f-8ee5-4b3e-a06e-8952514844ad'::uuid,
      'Fieldwork & Travel',
      1,
      'not_commenced',
      0,
      '2026-11-18',
      '2026-11-18'
    ),
(
      82,
      '51 · Fieldwork & Travel',
      'Data',
      'f62ded2f-8ee5-4b3e-a06e-8952514844ad'::uuid,
      'Fieldwork & Travel',
      8,
      'not_commenced',
      0,
      '2026-11-18',
      '2026-11-18'
    ),
(
      83,
      '52 · Fieldwork & Travel',
      'Travel',
      'f62ded2f-8ee5-4b3e-a06e-8952514844ad'::uuid,
      'Fieldwork & Travel',
      2.25,
      'not_commenced',
      0,
      '2026-11-18',
      '2026-11-18'
    ),
(
      84,
      '52 · Fieldwork & Travel',
      'Travel',
      'd07b78be-c1e7-4bf5-94fa-5366a59cb408'::uuid,
      'Fieldwork & Travel',
      2.25,
      'not_commenced',
      0,
      '2026-11-18',
      '2026-11-18'
    ),
(
      85,
      '53 · Fieldwork & Travel',
      'Camera analysis',
      'd07b78be-c1e7-4bf5-94fa-5366a59cb408'::uuid,
      'Fieldwork & Travel',
      6,
      'not_commenced',
      0,
      '2026-11-19',
      '2026-11-19'
    ),
(
      86,
      '54 · Reporting',
      'Prepare draft BDAR v0.2 including maps',
      'f62ded2f-8ee5-4b3e-a06e-8952514844ad'::uuid,
      'Reporting',
      null,
      'not_commenced',
      0,
      '2026-11-17',
      '2026-11-26'
    ),
(
      87,
      '55 · Feedback Review',
      'QA draft v0.2 report',
      '4eef096c-91da-4135-839d-c8a67b3a5e6f'::uuid,
      'QA Review',
      null,
      'not_commenced',
      0,
      '2026-11-30',
      '2026-11-30'
    ),
(
      88,
      '56 · Delivery',
      'Delivery of  draft v0.2',
      '4eef096c-91da-4135-839d-c8a67b3a5e6f'::uuid,
      'Delivery',
      null,
      'not_commenced',
      0,
      '2026-12-01',
      '2026-12-01'
    ),
(
      89,
      '57 · Reporting',
      'Prepare final BDAR v1',
      'f62ded2f-8ee5-4b3e-a06e-8952514844ad'::uuid,
      'Reporting',
      null,
      'not_commenced',
      0,
      '2026-12-03',
      '2026-12-05'
    ),
(
      90,
      '58 · Feedback Review',
      'QA final report',
      '4eef096c-91da-4135-839d-c8a67b3a5e6f'::uuid,
      'QA Review',
      null,
      'not_commenced',
      0,
      '2026-12-05',
      '2026-12-08'
    ),
(
      91,
      '59 · Delivery',
      'Delivery of final report and BOAMS submission',
      '4eef096c-91da-4135-839d-c8a67b3a5e6f'::uuid,
      'Delivery',
      null,
      'not_commenced',
      0,
      '2026-12-08',
      '2026-12-08'
    ),
(
      92,
      '60 · Client follow up',
      'Client follow up',
      '4eef096c-91da-4135-839d-c8a67b3a5e6f'::uuid,
      'Client Consultation',
      null,
      'not_commenced',
      0,
      '2026-12-08',
      '2026-12-08'
    ),
(
      93,
      '61 · Data Management',
      'Collate Bionet data for project (if required)',
      'ff9205f1-e1e9-4e83-8693-3d90ad31c026'::uuid,
      'Data Management',
      null,
      'not_commenced',
      0,
      '2026-12-08',
      '2026-12-08'
    ),
(
      94,
      '62 · Data Management',
      'Review Bionet data before submission',
      'abd4449e-5294-4e18-ad2a-08403cc3e1ce'::uuid,
      'Data Management',
      null,
      'not_commenced',
      0,
      null,
      null
    )
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
