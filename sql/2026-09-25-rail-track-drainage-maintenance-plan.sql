-- Rail track drainage maintenance (1511): supplied 25 September 2026 work plan.
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
    (1, 1, 'Other', 'Set up project and tracker baseline — Create tracker, WBS, milestones, responsibilities, budget baseline', null, '2c265989-7864-41ad-9e2d-202d64d9a954'::uuid, 2::numeric, 'completed', 100::numeric, '2026-09-22'::date, '2026-09-23'::date),
    (2, 2, 'Other', 'Draft detailed field programme — Incorporate both sections, day sequence, logistics, surveys', null, '2c265989-7864-41ad-9e2d-202d64d9a954'::uuid, 2::numeric, 'completed', 100::numeric, '2026-09-16'::date, '2026-09-24'::date),
    (3, 3, 'QA Review', 'Review, update and finalise field programme', null, 'abd4449e-5294-4e18-ad2a-08403cc3e1ce'::uuid, 1::numeric, 'not_commenced', 0::numeric, '2026-09-29'::date, '2026-09-29'::date),
    (4, 4, 'GIS/Mapping', 'Set up all pre field back end survey (GIS, data sheets,offline maps, survery123)', null, '669aa880-bdcd-4afd-82d5-3ef5fb7994f1'::uuid, 3::numeric, 'not_commenced', 0::numeric, '2026-10-01'::date, '2026-10-01'::date),
    (5, 5, 'GIS/Mapping', 'Review and sign off', null, 'abd4449e-5294-4e18-ad2a-08403cc3e1ce'::uuid, 0.5::numeric, 'not_commenced', 0::numeric, '2026-10-01'::date, '2026-10-01'::date),
    (6, 6, 'Other', 'Confirm access approvals — Obtain written confirmation of corridor, road, shoreline, vessel and protected-area access conditions', null, '75b7ca74-86d9-4cf5-be17-31ac12947f40'::uuid, 1::numeric, 'not_commenced', 0::numeric, '2026-10-07'::date, '2026-10-07'::date),
    (7, 7, 'General Project Management', 'Pre-mobilisation team briefing — Confirm daily allocation, access, hazards, check-ins, data standards, tree counts and escalation controls', null, 'c9a881ce-431b-45b4-b5ae-aa50d6d4226d'::uuid, 0.5::numeric, 'not_commenced', 0::numeric, '2026-10-20'::date, '2026-10-20'::date),
    (8, 8, 'General Project Management', 'Pre-mobilisation team briefing — Confirm daily allocation, access, hazards, check-ins, data standards, tree counts and escalation controls', null, '4f0e728d-75e6-460e-9ae6-f065ce6865a9'::uuid, 0.5::numeric, 'not_commenced', 0::numeric, '2026-10-20'::date, '2026-10-20'::date),
    (9, 9, 'General Project Management', 'Pre-mobilisation team briefing — Confirm daily allocation, access, hazards, check-ins, data standards, tree counts and escalation controls', null, '669aa880-bdcd-4afd-82d5-3ef5fb7994f1'::uuid, 0.5::numeric, 'not_commenced', 0::numeric, '2026-10-20'::date, '2026-10-20'::date),
    (10, 10, 'General Project Management', 'Pre-mobilisation team briefing — Confirm daily allocation, access, hazards, check-ins, data standards, tree counts and escalation controls', null, 'abd4449e-5294-4e18-ad2a-08403cc3e1ce'::uuid, 0.5::numeric, 'not_commenced', 0::numeric, '2026-10-20'::date, '2026-10-20'::date),
    (11, 11, 'General Project Management', 'Pre-mobilisation team briefing — Confirm daily allocation, access, hazards, check-ins, data standards, tree counts and escalation controls', null, '577f0587-e75c-4c35-8013-1b334c348871'::uuid, 0.5::numeric, 'not_commenced', 0::numeric, '2026-10-20'::date, '2026-10-20'::date),
    (12, 12, 'General Project Management', 'Pre-mobilisation team briefing — Confirm daily allocation, access, hazards, check-ins, data standards, tree counts and escalation controls', null, '75b7ca74-86d9-4cf5-be17-31ac12947f40'::uuid, 0.5::numeric, 'not_commenced', 0::numeric, '2026-10-20'::date, '2026-10-20'::date),
    (13, 13, 'Other', 'Book accoomodation and equipment hire', null, '577f0587-e75c-4c35-8013-1b334c348871'::uuid, null, 'not_commenced', 0::numeric, '2026-10-20'::date, '2026-10-20'::date),
    (14, 14, 'Client Consultation', 'Pre-field mobilisation confirmation — Confirm dates, daily sequence, contacts, access, scope exclusions and outstanding decisions With Senior Ecologist', null, '4f0e728d-75e6-460e-9ae6-f065ce6865a9'::uuid, null, 'not_commenced', 0::numeric, '2026-10-21'::date, '2026-10-21'::date),
    (15, 15, 'Client Consultation', 'Pre-field mobilisation confirmation — Confirm dates, daily sequence, contacts, access, scope exclusions and outstanding decisions With Senior Ecologist', null, 'c9a881ce-431b-45b4-b5ae-aa50d6d4226d'::uuid, null, 'not_commenced', 0::numeric, '2026-10-21'::date, '2026-10-21'::date),
    (16, 16, 'Client Consultation', 'Pre-field mobilisation confirmation — Confirm dates, daily sequence, contacts, access, scope exclusions and outstanding decisions', null, 'abd4449e-5294-4e18-ad2a-08403cc3e1ce'::uuid, null, 'not_commenced', 0::numeric, '2026-10-21'::date, '2026-10-21'::date),
    (17, 17, 'Fieldwork & Travel', 'Section 1 - Drains 2235, 1539', 'Phase: Day 1', '4f0e728d-75e6-460e-9ae6-f065ce6865a9'::uuid, 8::numeric, 'not_commenced', 0::numeric, '2026-10-26'::date, '2026-10-26'::date),
    (18, 18, 'Fieldwork & Travel', 'Section 1 - Drains 2235, 1539', 'Phase: Day 1', 'c9a881ce-431b-45b4-b5ae-aa50d6d4226d'::uuid, 8::numeric, 'not_commenced', 0::numeric, '2026-10-26'::date, '2026-10-26'::date),
    (19, null::integer, 'Fieldwork & Travel', 'Section 1 - Drains 2235, 1539', 'Phase: Day 1', 'abd4449e-5294-4e18-ad2a-08403cc3e1ce'::uuid, 8::numeric, 'not_commenced', 0::numeric, '2026-10-26'::date, '2026-10-26'::date),
    (20, 19, 'Fieldwork & Travel', 'Section 1 - Drain 1538', 'Phase: Day 2', '4f0e728d-75e6-460e-9ae6-f065ce6865a9'::uuid, 8::numeric, 'not_commenced', 0::numeric, '2026-10-27'::date, '2026-10-27'::date),
    (21, 20, 'Fieldwork & Travel', 'Section 1 - Drain 1538', 'Phase: Day 2', 'c9a881ce-431b-45b4-b5ae-aa50d6d4226d'::uuid, 8::numeric, 'not_commenced', 0::numeric, '2026-10-27'::date, '2026-10-27'::date),
    (22, null::integer, 'Fieldwork & Travel', 'Section 1 - Drain 1538', 'Phase: Day 2', 'abd4449e-5294-4e18-ad2a-08403cc3e1ce'::uuid, 8::numeric, 'not_commenced', 0::numeric, '2026-10-27'::date, '2026-10-27'::date),
    (23, 21, 'Fieldwork & Travel', 'Section 1 - Drains 1657', 'Phase: Day 3', '4f0e728d-75e6-460e-9ae6-f065ce6865a9'::uuid, 8::numeric, 'not_commenced', 0::numeric, '2026-10-28'::date, '2026-10-28'::date),
    (24, 22, 'Fieldwork & Travel', 'Section 1 - Drains 1657', 'Phase: Day 3', 'c9a881ce-431b-45b4-b5ae-aa50d6d4226d'::uuid, 8::numeric, 'not_commenced', 0::numeric, '2026-10-28'::date, '2026-10-28'::date),
    (25, null::integer, 'Fieldwork & Travel', 'Section 1 - Drains 1657', 'Phase: Day 3', 'abd4449e-5294-4e18-ad2a-08403cc3e1ce'::uuid, 8::numeric, 'not_commenced', 0::numeric, '2026-10-28'::date, '2026-10-28'::date),
    (26, 23, 'Fieldwork & Travel', 'Section 1 - Drains 1658 , 2188', 'Phase: Day 4', '4f0e728d-75e6-460e-9ae6-f065ce6865a9'::uuid, 8::numeric, 'not_commenced', 0::numeric, '2026-10-29'::date, '2026-10-29'::date),
    (27, 24, 'Fieldwork & Travel', 'Section 1 - Drains 1658 , 2188', 'Phase: Day 4', 'c9a881ce-431b-45b4-b5ae-aa50d6d4226d'::uuid, 8::numeric, 'not_commenced', 0::numeric, '2026-10-29'::date, '2026-10-29'::date),
    (28, null::integer, 'Fieldwork & Travel', 'Section 1 - Drains 1658 , 2188', 'Phase: Day 4', 'abd4449e-5294-4e18-ad2a-08403cc3e1ce'::uuid, 8::numeric, 'not_commenced', 0::numeric, '2026-10-29'::date, '2026-10-29'::date),
    (29, 25, 'Fieldwork & Travel', 'Section 1 - Drains 2236, 2240', 'Phase: Day 5', '4f0e728d-75e6-460e-9ae6-f065ce6865a9'::uuid, 8::numeric, 'not_commenced', 0::numeric, '2026-10-30'::date, '2026-10-30'::date),
    (30, 26, 'Fieldwork & Travel', 'Section 1 - Drains 2236, 2240', 'Phase: Day 5', 'c9a881ce-431b-45b4-b5ae-aa50d6d4226d'::uuid, 8::numeric, 'not_commenced', 0::numeric, '2026-10-30'::date, '2026-10-30'::date),
    (31, null::integer, 'Fieldwork & Travel', 'Section 1 - Drains 2236, 2240', 'Phase: Day 5', 'abd4449e-5294-4e18-ad2a-08403cc3e1ce'::uuid, 8::numeric, 'not_commenced', 0::numeric, '2026-10-30'::date, '2026-10-30'::date),
    (32, 27, 'Fieldwork & Travel', 'Section 1 - Drains 2237', 'Phase: Day 6', '4f0e728d-75e6-460e-9ae6-f065ce6865a9'::uuid, 8::numeric, 'not_commenced', 0::numeric, '2026-11-03'::date, '2026-11-03'::date),
    (33, 28, 'Fieldwork & Travel', 'Section 1 - Drains 2237', 'Phase: Day 6', 'c9a881ce-431b-45b4-b5ae-aa50d6d4226d'::uuid, 8::numeric, 'not_commenced', 0::numeric, '2026-11-03'::date, '2026-11-03'::date),
    (34, 29, 'Fieldwork & Travel', 'Section 1 - Drains 2241', 'Phase: Day 7', '4f0e728d-75e6-460e-9ae6-f065ce6865a9'::uuid, 8::numeric, 'not_commenced', 0::numeric, '2026-11-04'::date, '2026-11-04'::date),
    (35, 30, 'Fieldwork & Travel', 'Section 1 - Drains 2241', 'Phase: Day 7', 'c9a881ce-431b-45b4-b5ae-aa50d6d4226d'::uuid, 8::numeric, 'not_commenced', 0::numeric, '2026-11-04'::date, '2026-11-04'::date),
    (36, 31, 'Fieldwork & Travel', 'Section 1 - Drains 2242', 'Phase: Day 8', '4f0e728d-75e6-460e-9ae6-f065ce6865a9'::uuid, 8::numeric, 'not_commenced', 0::numeric, '2026-11-05'::date, '2026-11-05'::date),
    (37, 32, 'Fieldwork & Travel', 'Section 1 - Drains 2242', 'Phase: Day 8', 'c9a881ce-431b-45b4-b5ae-aa50d6d4226d'::uuid, 8::numeric, 'not_commenced', 0::numeric, '2026-11-05'::date, '2026-11-05'::date),
    (38, 33, 'Fieldwork & Travel', 'Section 1 - Drains 2244, 2245, 8314', 'Phase: Day 9', '4f0e728d-75e6-460e-9ae6-f065ce6865a9'::uuid, 8::numeric, 'not_commenced', 0::numeric, '2026-11-06'::date, '2026-11-06'::date),
    (39, 34, 'Fieldwork & Travel', 'Section 1 - Drains 2244, 2245, 8314', 'Phase: Day 9', 'c9a881ce-431b-45b4-b5ae-aa50d6d4226d'::uuid, 8::numeric, 'not_commenced', 0::numeric, '2026-11-06'::date, '2026-11-06'::date),
    (40, 35, 'Fieldwork & Travel', 'Section 1 - Drains 2239, 8294, 2246', 'Phase: Day 10', '4f0e728d-75e6-460e-9ae6-f065ce6865a9'::uuid, 8::numeric, 'not_commenced', 0::numeric, '2026-11-09'::date, '2026-11-09'::date),
    (41, 36, 'Fieldwork & Travel', 'Section 1 - Drains 2239, 8294, 2246', 'Phase: Day 10', 'c9a881ce-431b-45b4-b5ae-aa50d6d4226d'::uuid, 8::numeric, 'not_commenced', 0::numeric, '2026-11-09'::date, '2026-11-09'::date),
    (42, 37, 'Fieldwork & Travel', 'Section 2 - Drains 2782,3141', 'Phase: Day 11', '4f0e728d-75e6-460e-9ae6-f065ce6865a9'::uuid, 8::numeric, 'not_commenced', 0::numeric, '2026-11-10'::date, '2026-11-10'::date),
    (43, 38, 'Fieldwork & Travel', 'Section 2 - Drains 2782,3141', 'Phase: Day 11', 'c9a881ce-431b-45b4-b5ae-aa50d6d4226d'::uuid, 8::numeric, 'not_commenced', 0::numeric, '2026-11-10'::date, '2026-11-10'::date),
    (44, 39, 'Fieldwork & Travel', 'Section 2 - Drains 3142', 'Phase: Day 12', '4f0e728d-75e6-460e-9ae6-f065ce6865a9'::uuid, 8::numeric, 'not_commenced', 0::numeric, '2026-11-11'::date, '2026-11-11'::date),
    (45, 40, 'Fieldwork & Travel', 'Section 2 - Drains 3142', 'Phase: Day 12', 'c9a881ce-431b-45b4-b5ae-aa50d6d4226d'::uuid, 8::numeric, 'not_commenced', 0::numeric, '2026-11-11'::date, '2026-11-11'::date),
    (46, 41, 'Fieldwork & Travel', 'Section 2 - Drains 3143, 3144', 'Phase: Day 13', '4f0e728d-75e6-460e-9ae6-f065ce6865a9'::uuid, 8::numeric, 'not_commenced', 0::numeric, '2026-11-12'::date, '2026-11-12'::date),
    (47, 42, 'Fieldwork & Travel', 'Section 2 - Drains 3143, 3144', 'Phase: Day 13', 'c9a881ce-431b-45b4-b5ae-aa50d6d4226d'::uuid, 8::numeric, 'not_commenced', 0::numeric, '2026-11-12'::date, '2026-11-12'::date),
    (48, 43, 'Fieldwork & Travel', 'Section 2 - Drains 3145, 3146', 'Phase: Day 14', '4f0e728d-75e6-460e-9ae6-f065ce6865a9'::uuid, 8::numeric, 'not_commenced', 0::numeric, '2026-11-13'::date, '2026-11-13'::date),
    (49, 44, 'Fieldwork & Travel', 'Section 2 - Drains 3145, 3146', 'Phase: Day 14', 'c9a881ce-431b-45b4-b5ae-aa50d6d4226d'::uuid, 8::numeric, 'not_commenced', 0::numeric, '2026-11-13'::date, '2026-11-13'::date),
    (50, 45, 'Fieldwork & Travel', 'Section 2 - Drains 3147, 3149', 'Phase: Day 15', '4f0e728d-75e6-460e-9ae6-f065ce6865a9'::uuid, 8::numeric, 'not_commenced', 0::numeric, '2026-11-17'::date, '2026-11-17'::date),
    (51, 46, 'Fieldwork & Travel', 'Section 2 - Drains 3147, 3149', 'Phase: Day 15', 'c9a881ce-431b-45b4-b5ae-aa50d6d4226d'::uuid, 8::numeric, 'not_commenced', 0::numeric, '2026-11-17'::date, '2026-11-17'::date),
    (52, 47, 'Fieldwork & Travel', 'Section 2 - Drains 3153', 'Phase: Day 16', '4f0e728d-75e6-460e-9ae6-f065ce6865a9'::uuid, 8::numeric, 'not_commenced', 0::numeric, '2026-11-18'::date, '2026-11-18'::date),
    (53, 48, 'Fieldwork & Travel', 'Section 2 - Drains 3153', 'Phase: Day 16', 'c9a881ce-431b-45b4-b5ae-aa50d6d4226d'::uuid, 8::numeric, 'not_commenced', 0::numeric, '2026-11-18'::date, '2026-11-18'::date),
    (54, 49, 'Fieldwork & Travel', 'Section 2 - Drains 3618', 'Phase: Day 17', '4f0e728d-75e6-460e-9ae6-f065ce6865a9'::uuid, 8::numeric, 'not_commenced', 0::numeric, '2026-11-19'::date, '2026-11-19'::date),
    (55, 50, 'Fieldwork & Travel', 'Section 2 - Drains 3618', 'Phase: Day 17', 'c9a881ce-431b-45b4-b5ae-aa50d6d4226d'::uuid, 8::numeric, 'not_commenced', 0::numeric, '2026-11-19'::date, '2026-11-19'::date),
    (56, 51, 'Fieldwork & Travel', 'Section 2 - Drains 7482, 7904', 'Phase: Day 18', '4f0e728d-75e6-460e-9ae6-f065ce6865a9'::uuid, 8::numeric, 'not_commenced', 0::numeric, '2026-11-20'::date, '2026-11-20'::date),
    (57, 52, 'Fieldwork & Travel', 'Section 2 - Drains 7482, 7904', 'Phase: Day 18', 'c9a881ce-431b-45b4-b5ae-aa50d6d4226d'::uuid, 8::numeric, 'not_commenced', 0::numeric, '2026-11-20'::date, '2026-11-20'::date),
    (58, 53, 'Data Management', 'Upon completion of each survey staff are required to upload and qa check data and cross reference field plan.', null, '4f0e728d-75e6-460e-9ae6-f065ce6865a9'::uuid, 9::numeric, 'not_commenced', 0::numeric, '2026-11-23'::date, '2026-11-24'::date),
    (59, 54, 'Data Management', 'Upon completion of each survey staff are required to upload and qa check data and cross reference field plan.', null, 'c9a881ce-431b-45b4-b5ae-aa50d6d4226d'::uuid, 9::numeric, 'not_commenced', 0::numeric, '2026-11-23'::date, '2026-11-24'::date),
    (60, 55, 'QA Review', 'Each morning QA the previous days data uploads', null, 'abd4449e-5294-4e18-ad2a-08403cc3e1ce'::uuid, 9::numeric, 'not_commenced', 0::numeric, '2026-10-26'::date, '2026-11-20'::date),
    (61, 56, 'QA Review', 'Prepare final reporting dataset', null, '669aa880-bdcd-4afd-82d5-3ef5fb7994f1'::uuid, 2::numeric, 'not_commenced', 0::numeric, '2026-11-25'::date, '2026-11-25'::date),
    (62, 57, 'Reporting', 'Each drain will have a Drain specific biodiversity assessment report', null, null::uuid, 60::numeric, 'not_commenced', 0::numeric, '2026-10-26'::date, '2026-11-20'::date),
    (63, 58, 'Reporting', 'Each drain will have a Drain specific biodiversity assessment report', null, null::uuid, 60::numeric, 'not_commenced', 0::numeric, '2026-10-26'::date, '2026-11-20'::date),
    (64, 59, 'Reporting', 'BAR report section 1', null, null::uuid, 16::numeric, 'not_commenced', 0::numeric, '2026-11-09'::date, '2026-11-17'::date),
    (65, 60, 'Reporting', 'BAR report section 2', null, null::uuid, 16::numeric, 'not_commenced', 0::numeric, '2026-11-20'::date, '2026-11-27'::date),
    (66, 61, 'Reporting', 'Senior input into the BAR report section 1', null, 'abd4449e-5294-4e18-ad2a-08403cc3e1ce'::uuid, 5::numeric, 'not_commenced', 0::numeric, '2026-11-25'::date, '2026-11-25'::date),
    (67, null::integer, 'Reporting', 'Senior input into the BAR reportsection 2', null, 'abd4449e-5294-4e18-ad2a-08403cc3e1ce'::uuid, 5::numeric, 'not_commenced', 0::numeric, '2026-11-16'::date, '2026-11-16'::date),
    (68, 62, 'GIS/Mapping', 'Mapping for the BAR report section 1', null, '669aa880-bdcd-4afd-82d5-3ef5fb7994f1'::uuid, 12::numeric, 'not_commenced', 0::numeric, '2026-11-12'::date, '2026-11-12'::date),
    (69, null::integer, 'GIS/Mapping', 'Mapping for the BAR report section 2', null, '669aa880-bdcd-4afd-82d5-3ef5fb7994f1'::uuid, 12::numeric, 'not_commenced', 0::numeric, '2026-11-23'::date, '2026-11-23'::date),
    (70, 63, 'QA Review', 'BAR and report review section 1', null, 'abd4449e-5294-4e18-ad2a-08403cc3e1ce'::uuid, 7::numeric, 'not_commenced', 0::numeric, '2026-11-16'::date, '2026-11-17'::date),
    (71, null::integer, 'QA Review', 'BAR and report review section 2', null, 'abd4449e-5294-4e18-ad2a-08403cc3e1ce'::uuid, 7::numeric, 'not_commenced', 0::numeric, '2026-11-27'::date, '2026-11-28'::date);

do $rail_track$
declare
  v_project_id uuid := 'bcabdb53-0a06-4aed-9dea-33d875535c12'::uuid;
  v_actor_id uuid := '2c265989-7864-41ad-9e2d-202d64d9a954'::uuid;
  v_updated_count integer;
  v_inserted_count integer;
begin
  update public.projects
  set
    start_date = '2026-09-16',
    end_date = '2026-11-28',
    project_lead_user_id = '2c265989-7864-41ad-9e2d-202d64d9a954'::uuid,
    overseeing_senior_ecologist_user_id = 'abd4449e-5294-4e18-ad2a-08403cc3e1ce'::uuid,
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
    (v_project_id, 'abd4449e-5294-4e18-ad2a-08403cc3e1ce'::uuid, 'Senior Ecologist', null, null, true, true),
    (v_project_id, '2c265989-7864-41ad-9e2d-202d64d9a954'::uuid, 'Project Manager', null, null, true, true),
    (v_project_id, '75b7ca74-86d9-4cf5-be17-31ac12947f40'::uuid, 'Project Manager', null, null, true, true),
    (v_project_id, '577f0587-e75c-4c35-8013-1b334c348871'::uuid, 'Project Manager', null, null, true, true),
    (v_project_id, 'c9a881ce-431b-45b4-b5ae-aa50d6d4226d'::uuid, 'Ecologist', null, null, true, true),
    (v_project_id, '4f0e728d-75e6-460e-9ae6-f065ce6865a9'::uuid, 'Ecologist', null, null, true, true),
    (v_project_id, '669aa880-bdcd-4afd-82d5-3ef5fb7994f1'::uuid, 'Ecologist / GIS Lead', null, null, true, true),
    (v_project_id, 'ff9205f1-e1e9-4e83-8693-3d90ad31c026'::uuid, 'Ecologist', null, null, true, true)
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
    ('abd4449e-5294-4e18-ad2a-08403cc3e1ce'::uuid),
    ('2c265989-7864-41ad-9e2d-202d64d9a954'::uuid),
    ('75b7ca74-86d9-4cf5-be17-31ac12947f40'::uuid),
    ('577f0587-e75c-4c35-8013-1b334c348871'::uuid),
    ('c9a881ce-431b-45b4-b5ae-aa50d6d4226d'::uuid),
    ('4f0e728d-75e6-460e-9ae6-f065ce6865a9'::uuid),
    ('669aa880-bdcd-4afd-82d5-3ef5fb7994f1'::uuid),
    ('ff9205f1-e1e9-4e83-8693-3d90ad31c026'::uuid)
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
