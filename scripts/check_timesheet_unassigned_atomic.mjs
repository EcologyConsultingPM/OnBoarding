import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';

// Isolated in-memory PostgreSQL only: no environment secrets, remote DB, or API.
const db = new PGlite();
const sql = (name) => readFile(new URL(`../sql/${name}`, import.meta.url), 'utf8');
const actor = '00000000-0000-4000-8000-000000000001';
const staff = 'd07b78be-c1e7-4bf5-94fa-5366a59cb408';
const otherStaff = '00000000-0000-4000-8000-000000000002';
const project = '00000000-0000-4000-8000-000000000003';
const source = '00000000-0000-4000-8000-000000000004';
const allocation = '00000000-0000-4000-8000-000000000005';
const noBudget = '00000000-0000-4000-8000-000000000006';
const noCard = '00000000-0000-4000-8000-000000000007';
const legacySource = '00000000-0000-4000-8000-000000000008';
const legacyAllocation = '00000000-0000-4000-8000-000000000009';
const oldId = '00000000-0000-4000-8000-000000000010';
let serial = 100;
const uuid = () => `00000000-0000-4000-8000-${String(serial++).padStart(12, '0')}`;
const hash = (value) => createHash('sha256').update(value).digest('hex');
const query = (text, params = []) => db.query(text, params);
const one = async (text, params = []) => (await query(text, params)).rows[0];
const entry = (date, hours = 0.25, notes = 'Distinct work documented in weekly export', patch = {}) => {
  const base = {
    project_id: project, budget_source_id: source, budget_allocation_id: allocation,
    staff_user_id: staff, work_date: date, activity_category: 'General Project Management', activity_information: notes, hours,
    custom_data: {
      import_source_row: 2, import_file_name: 'weekly.xls', import_source_task: 'External consultation',
      import_expected_charge_rate: 207, import_charge_role: 'Senior Ecologist',
      import_duplicate_review: { decision: 'new', reason: null, review_token: null, expected_entries: [], file_overlap_rows: [] },
      import_fingerprint: hash(JSON.stringify([date, hours, notes, patch.custom_data?.km ?? null, patch.project_id ?? project])),
      expenses: 25, vehicle: 'EC01',
    },
  };
  return { ...base, ...patch, custom_data: { ...base.custom_data, ...patch.custom_data } };
};
const unassigned = (date, hours, notes, patch = {}) => entry(date, hours, notes, {
  ...patch, budget_source_id: null, budget_allocation_id: null,
  custom_data: { ...patch.custom_data, budget_assignment: 'unassigned' },
});
const run = (entries, who = actor, rpc = 'ec_import_weekly_timesheets_reviewed', batchId = uuid()) =>
  query(`select public.${rpc}($1,$2,$3::jsonb) as result`, [who, batchId, JSON.stringify(entries)]).then((r) => r.rows[0].result);
const rowAt = (date, projectId = project) => one('select * from project_tracker_entries where work_date=$1 and project_id=$2 order by created_at,id limit 1', [date, projectId]);
const snapshot = (row) => ({
  id: row.id, updated_at: row.updated_at, work_date: row.work_date, hours: Number(row.hours),
  activity_category: row.activity_category, activity_information: row.activity_information,
  km: row.custom_data.km ?? null, kilometres: row.custom_data.kilometres ?? null,
});
const separate = (rows = []) => ({ decision: 'separate', reason: 'Different meetings at separate documented times.', review_token: 'a'.repeat(64), expected_entries: rows.map(snapshot), file_overlap_rows: [2, 3] });
const state = async () => ({
  entries: (await query('select * from project_tracker_entries order by id')).rows,
  allocations: (await query('select * from project_budget_allocations order by id')).rows,
  events: (await query('select * from portal_events order by id')).rows,
  audit: (await query('select * from admin_audit_log order by id')).rows,
});
const rejectedAtomically = async (entries, pattern, who = actor) => {
  const before = await state();
  await assert.rejects(run(entries, who), pattern);
  assert.deepEqual(await state(), before, 'Failed import must not change entries, allocation totals, audit or notification state.');
};
const identity = async (role = null, user = null, jwtRole = role) => {
  await db.exec('reset role;');
  await query("select set_config('request.jwt.claim.role','',false),set_config('request.jwt.claim.sub','',false),set_config('request.jwt.claims',$1,false),set_config('ec.timesheet_import_context','',false)", [jwtRole ? JSON.stringify({ role: jwtRole, sub: user }) : '']);
  if (role) await db.exec(`set role ${role};`);
};
const rawInsert = (row, by = actor) => query(`insert into project_tracker_entries(project_id,budget_source_id,budget_allocation_id,staff_user_id,entered_by_admin_id,work_date,activity_category,activity_information,hours,status,custom_data)
  values($1,$2,$3,$4,$5,$6,$7,$8,$9,'completed',$10::jsonb)`, [row.project_id, row.budget_source_id, row.budget_allocation_id, row.staff_user_id, by, row.work_date, row.activity_category, row.activity_information, row.hours, JSON.stringify(row.custom_data)]);

try {
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth;
    create table auth.users(id uuid primary key, deleted_at timestamptz, banned_until timestamptz, email text);
    create table public.portal_visibility_overrides(user_id uuid,resource_key text,is_visible boolean);
    create table public.projects(id uuid primary key,name text,status text,deleted_at timestamptz,default_hourly_rate numeric,
      budget_dollars numeric,budget_hours numeric,start_date text,created_by uuid);
    create table public.project_allocations(project_id uuid,staff_user_id uuid,hourly_rate numeric);
    create table public.portal_events(id uuid primary key default gen_random_uuid(),recipient_id uuid,event_type text,severity text,title text,body text,href text,source_table text,source_id uuid);
    create table public.admin_audit_log(id uuid primary key default gen_random_uuid(),actor_id uuid,action text,entity_type text,entity_id uuid,project_id uuid,resource_key text,before_data jsonb,after_data jsonb,reason text);
    create function public.project_closeout_can_manage(uuid) returns boolean language sql as $$select $1='${actor}'::uuid$$;
  `);
  // Apply foundation to an EMPTY project register; its historical baseline seed
  // therefore writes nothing. All test data is inserted only in this PGlite DB.
  await db.exec(await sql('2026-08-28-project-tracker-foundation.sql'));
  await db.exec(await sql('2026-11-05-project-budget-service-periods.sql'));
  await db.exec(await sql('2026-11-19-timesheet-import-atomic.sql'));
  await db.exec(`
    insert into auth.users(id,email) values('${actor}','admin@example.test'),('${staff}','gerard@example.test'),('${otherStaff}','staff@example.test');
    insert into projects(id,name,status,default_hourly_rate) values('${project}','Monthly project','active',111),('${noBudget}','No budget project','active',111),('${noCard}','No confirmed card','active',111);
    insert into project_budget_sources(id,project_id,source_code,source_name,source_type,approval_status,service_period_start,service_period_end)
      values('${source}','${project}','NOV','November','original','approved','2026-11-01','2026-11-30'),('${legacySource}','${project}','LEGACY','Legacy unrestricted','original','approved',null,null);
    insert into project_budget_allocations(id,project_id,budget_source_id,allocation_code,allocation_name,status,staff_visible)
      values('${allocation}','${project}','${source}','GENERAL','General Project Management','active',true),('${legacyAllocation}','${project}','${legacySource}','GENERAL','General Project Management','active',true);
    insert into project_allocations values('${project}','${staff}',130);
    insert into project_tracker_entries(id,project_id,budget_source_id,budget_allocation_id,staff_user_id,work_date,activity_category,activity_information,hours,status)
      values('${oldId}','${project}','${source}','${allocation}','${staff}','2026-11-01','General Project Management','Original staff-created history',1,'completed');
  `);
  await db.exec(await sql('2026-11-20-tracker-role-charge-rates.sql'));
  await db.exec(await sql('2026-11-20-timesheet-reconciliation.sql'));
  const stampBefore = (await one("select pg_get_functiondef('public.ec_stamp_tracker_charge_rate()'::regprocedure) as definition")).definition;
  const guardBefore = (await one("select pg_get_functiondef('public.check_project_budget_source_period_edit()'::regprocedure) as definition")).definition;
  const dataBefore = await state();
  const migration = await sql('2026-11-24-timesheet-unassigned-import.sql');
  assert(migration.indexOf('lock table public.project_tracker_entries') < migration.indexOf('perform p.id from public.projects'));
  await db.exec(migration); await db.exec(migration);
  assert.deepEqual(await state(), dataBefore, 'Applying/reapplying migration must not rewrite actuals or allocations.');
  assert.equal((await one("select pg_get_functiondef('public.ec_stamp_tracker_charge_rate()'::regprocedure) as definition")).definition, stampBefore);
  assert.equal((await one("select pg_get_functiondef('public.check_project_budget_source_period_edit()'::regprocedure) as definition")).definition, guardBefore);
  assert.equal((await one("select count(*) as n from pg_policies where schemaname='public' and tablename='project_tracker_entries'")).n, 0);
  assert.deepEqual(await one("select relrowsecurity,relforcerowsecurity from pg_class where oid='public.project_tracker_entries'::regclass"), { relrowsecurity: true, relforcerowsecurity: false });
  assert.equal((await query("select column_name from information_schema.columns where table_name='project_tracker_entries' and column_name in ('budget_source_id','budget_allocation_id') and is_nullable='YES'")).rows.length, 2);
  assert.equal((await one("select count(*) as n from pg_constraint where conrelid='public.project_tracker_entries'::regclass and contype='f' and confdeltype='r' and conkey && array[(select attnum from pg_attribute where attrelid='public.project_tracker_entries'::regclass and attname='budget_source_id'),(select attnum from pg_attribute where attrelid='public.project_tracker_entries'::regclass and attname='budget_allocation_id')]::smallint[]")).n, 2);
  const saveRates = (id, rates, stamp = null) => query('select public.ec_save_project_charge_rates($1,$2,$3,$4::jsonb) as card', [id, actor, stamp, JSON.stringify(rates)]).then((r) => r.rows[0].card);
  let card = await saveRates(project, { 'Senior Ecologist': 207, Ecologist: 174, 'Project Manager': 163 });
  await saveRates(noBudget, { 'Senior Ecologist': 207, Ecologist: 174, 'Project Manager': 163 });
  assert.deepEqual((await one('select custom_data from project_tracker_entries where id=$1', [oldId])).custom_data, {});

  // Use actual service-role execution, not only the privileged fixture owner.
  await identity('service_role');
  let result = await run([entry('2026-11-02', 0.5), unassigned('2026-11-03', 0.75)]);
  assert.equal(result.importedCount, 2); assert.equal(result.allocationsRecalculated, 1); assert.equal(result.notificationsCreated, 1);
  assert.equal(result.unassignedCount, 1); assert.equal(result.unassignedHours, 0.75); assert.equal(result.unassignedCharge, 155.25); assert.equal(result.labourCharge, 258.75);
  await identity();
  let funded = await one('select hours_consumed,charge_out_spend,internal_cost from project_budget_allocations where id=$1', [allocation]);
  assert.deepEqual(funded, { hours_consumed: '1.50', charge_out_spend: '233.50', internal_cost: '140.10' }, 'Legacy unsnapshotted hours retain 130/hr; null actuals do not consume allocations.');
  const imported = await rowAt('2026-11-03');
  assert.equal(imported.budget_source_id, null); assert.equal(imported.budget_allocation_id, null); assert.equal(imported.entered_by_admin_id, actor);
  assert.equal(imported.custom_data.budget_assignment, 'unassigned'); assert.equal(imported.custom_data.charge_role, 'Senior Ecologist'); assert.equal(imported.custom_data.charge_rate_snapshot, 207); assert.equal(imported.custom_data.charge_rate_stamped, true);
  assert.equal(imported.custom_data.import_source_task, 'External consultation'); assert.equal(imported.custom_data.expenses, 25); assert.equal(imported.custom_data.vehicle, 'EC01');
  const audit = await one("select after_data from admin_audit_log where action='weekly_timesheets_imported' order by id limit 1");
  assert.equal(audit.after_data.unassignedCount, 1); assert.equal(audit.after_data.unassignedHours, 0.75); assert.equal(audit.after_data.unassignedCharge, 155.25);
  assert.equal((await one("select nullif(current_setting('ec.timesheet_import_context',true),'') as context")).context, null, 'RPC must not leave usable import context behind.');
  const allocBeforeUnassigned = (await state()).allocations;
  result = await run([unassigned('2026-10-15', 0.25, 'No budget/project level work', { project_id: noBudget })], actor, 'ec_import_weekly_timesheets');
  assert.equal(result.allocationsRecalculated, 0); assert.equal(result.unassignedCount, 1); assert.equal(result.unassignedCharge, 51.75);
  result = await run([unassigned('2026-12-15', 0.25, 'Outside source months but explicitly unassigned')]);
  assert.equal(result.allocationsRecalculated, 0); assert.deepEqual((await state()).allocations, allocBeforeUnassigned);
  assert.equal((await one('select count(*) as n from project_budget_sources where project_id=$1', [noBudget])).n, 0);
  const projectActuals = await one(`select sum(hours) as hours,sum(hours*public.ec_tracker_entry_charge_rate(project_id,staff_user_id,custom_data)) as charge
    from project_tracker_entries where project_id=$1`, [project]);
  assert.equal(Number(projectActuals.hours), 2.5); assert.equal(Number(projectActuals.charge), 440.5);

  // Both directions across assignment: different fingerprints still cannot
  // bypass the normalized exact identity check.
  await rejectedAtomically([unassigned('2026-11-02', 0.5, undefined, { custom_data: { import_fingerprint: hash('different assignment exact') } })], /identical entry/);
  await rejectedAtomically([entry('2026-11-03', 0.75, undefined, { custom_data: { import_fingerprint: hash('reverse assignment exact') } })], /identical entry/);
  await rejectedAtomically([unassigned('2026-11-02', 0.25, 'Changed comments and hours')], /Related tracker entries changed/);
  await rejectedAtomically([entry('2026-11-03', 0.25, 'Reverse overlap')], /Related tracker entries changed/);
  const assigned = await rowAt('2026-11-02');
  const assignedReview = separate([assigned]);
  await rejectedAtomically([unassigned('2026-11-02', 0.25, 'Later unrelated work', { custom_data: { import_duplicate_review: { ...assignedReview, reason: '..........' } } })], /separate-work reason/);
  await query('update project_tracker_entries set activity_information=$1 where id=$2', ['Edited after preview', assigned.id]);
  await rejectedAtomically([unassigned('2026-11-02', 0.25, 'Later unrelated work', { custom_data: { import_duplicate_review: assignedReview } })], /reviewed existing entry changed/);
  await query('update project_tracker_entries set activity_information=$1 where id=$2', [assigned.activity_information, assigned.id]);
  assert.equal((await run([unassigned('2026-11-02', 0.25, 'Later unrelated work', { custom_data: { import_duplicate_review: assignedReview } })])).importedCount, 1);
  assert.equal((await run([entry('2026-11-03', 0.25, 'Separate funded segment', { custom_data: { import_duplicate_review: separate([imported]) } })])).importedCount, 1);
  await rejectedAtomically([entry('2026-11-04', 0.25, 'Morning'), unassigned('2026-11-04', 0.5, 'Afternoon')], /Confirm separate work/);
  await rejectedAtomically([entry('2026-11-04', 0.25, 'Same record'), unassigned('2026-11-04', 0.25, 'Same record', { custom_data: { import_duplicate_review: separate() } })], /identical entry/);
  const peerReview = separate();
  assert.equal((await run([entry('2026-11-04', 0.25, 'Morning', { custom_data: { import_duplicate_review: peerReview } }), unassigned('2026-11-04', 0.5, 'Afternoon', { custom_data: { import_duplicate_review: peerReview } })])).importedCount, 2);

  // Preserve allocated approved-source, active/visible allocation, monthly
  // category/date and unrestricted-vs-monthly selection rules unchanged.
  await rejectedAtomically([entry('2026-12-01')], /outside the approved source period/);
  await rejectedAtomically([entry('2026-11-05', 0.25, 'Wrong monthly category', { activity_category: 'Other' })], /Monthly allocation|mapped import category/);
  await rejectedAtomically([entry('2026-11-05', 0.25, 'Legacy source on monthly project', { budget_source_id: legacySource, budget_allocation_id: legacyAllocation })], /period-specific budget/);
  await query("update project_budget_sources set approval_status='draft' where id=$1", [source]);
  await rejectedAtomically([entry('2026-11-05')], /budget allocation changed/);
  await query("update project_budget_sources set approval_status='approved' where id=$1", [source]);
  await query('update project_budget_allocations set staff_visible=false where id=$1', [allocation]);
  await rejectedAtomically([entry('2026-11-05')], /budget allocation changed/);
  await query('update project_budget_allocations set staff_visible=true where id=$1', [allocation]);

  // No null fallback, partial-null references or forged explicit marker.
  await rejectedAtomically([entry('2026-11-05', 0.25, 'Missing allocation', { budget_allocation_id: null })], /both budget references/);
  await rejectedAtomically([entry('2026-11-05', 0.25, 'Missing source', { budget_source_id: null })], /both budget references/);
  await rejectedAtomically([entry('2026-11-05', 0.25, 'False opt-out', { custom_data: { budget_assignment: 'unassigned' } })], /both budget references/);
  const noMarker = unassigned('2026-11-05'); delete noMarker.custom_data.budget_assignment;
  await rejectedAtomically([noMarker], /both budget references/);
  const omittedRef = unassigned('2026-11-05'); delete omittedRef.budget_source_id;
  await rejectedAtomically([omittedRef], /both budget references/);
  await rejectedAtomically([unassigned('2026-11-05', 0.25, 'No filename', { custom_data: { import_file_name: '' } })], /import provenance/);
  await rejectedAtomically([unassigned('2026-11-05', 0.25, 'No source row', { custom_data: { import_source_row: 0 } })], /import provenance/);
  const bogusActorPayload = unassigned('2026-11-05', 0.25, 'Server must choose administrator', { entered_by_admin_id: otherStaff });
  await run([bogusActorPayload]);
  assert.equal((await rowAt('2026-11-05')).entered_by_admin_id, actor);
  await rejectedAtomically([unassigned('2026-11-06')], /active administrator/, staff);
  await query("update auth.users set banned_until=now()+interval '1 day' where id=$1", [actor]);
  await rejectedAtomically([unassigned('2026-11-06')], /active administrator/);
  await query('update auth.users set banned_until=null where id=$1', [actor]);
  await query("insert into portal_visibility_overrides values($1,'admin.projects.tracker',false)", [actor]);
  await rejectedAtomically([unassigned('2026-11-06')], /access is disabled/);
  await query('delete from portal_visibility_overrides where user_id=$1', [actor]);
  await query("update projects set status='inactive' where id=$1", [project]);
  await rejectedAtomically([unassigned('2026-11-06')], /Project changed/);
  await query("update projects set status='active',deleted_at=now() where id=$1", [project]);
  await rejectedAtomically([unassigned('2026-11-06')], /Project changed/);
  await query('update projects set deleted_at=null where id=$1', [project]);
  await query('update auth.users set deleted_at=now() where id=$1', [staff]);
  await rejectedAtomically([unassigned('2026-11-06')], /Staff account changed/);
  await query('update auth.users set deleted_at=null where id=$1', [staff]);
  for (const amount of [0, -1, 24.01, 0.001, 'NaN', 'Infinity']) await rejectedAtomically([unassigned('2026-11-06', amount)], /Invalid values/);
  await rejectedAtomically([unassigned('2026-11-06', 0.25, 'No card project', { project_id: noCard })], /Confirm the job-specific/);
  const noReview = unassigned('2026-11-06'); delete noReview.custom_data.import_duplicate_review;
  await assert.rejects(run([noReview], actor, 'ec_import_weekly_timesheets'), /current duplicate-review/);

  // SQL trust boundary: no permissive RLS changes in migration; normal raw
  // authenticated REST allocated INSERT is denied. Under test-only permissive
  // policies, null-row forgery is still denied by original session/JWT checks.
  await db.exec('grant usage on schema public to anon,authenticated,service_role; grant select on projects,project_budget_sources,project_budget_allocations to authenticated; grant select,insert,update on project_tracker_entries to anon,authenticated;');
  await identity('authenticated', staff);
  assert.deepEqual((await query('select id from project_tracker_entries')).rows, [], 'No entry policies means authenticated clients cannot see any row.');
  await assert.rejects(rawInsert(entry('2026-11-06')), /row-level security|permission denied/, 'Original source FOR SHARE privileges/RLS and entry RLS reject ordinary raw writes.');
  await assert.rejects(run([unassigned('2026-11-06')]), /permission denied for function/);
  await identity();
  for (const role of ['anon', 'authenticated']) {
    assert.equal((await one("select has_function_privilege($1,'public.ec_import_weekly_timesheets_reviewed(uuid,uuid,jsonb)','execute') as allowed", [role])).allowed, false);
    assert.equal((await one("select has_function_privilege($1,'public.ec_import_weekly_timesheets(uuid,uuid,jsonb)','execute') as allowed", [role])).allowed, false);
  }
  await db.exec('create policy fixture_insert_probe on project_tracker_entries for insert to authenticated with check(true); create policy fixture_select_probe on project_tracker_entries for select to authenticated using(true); create policy fixture_update_probe on project_tracker_entries for update to authenticated using(true) with check(true);');
  const forged = unassigned('2026-11-06'); forged.custom_data.import_batch_id = uuid();
  const guessedContext = { actor_id: actor, batch_id: forged.custom_data.import_batch_id, fingerprint: forged.custom_data.import_fingerprint, project_id: project, staff_id: staff };
  await identity('authenticated', staff);
  await query("select set_config('ec.timesheet_import_context',$1,false)", [JSON.stringify(guessedContext)]);
  await assert.rejects(rawInsert(forged), /service-authorized reviewed administrator import/);
  await assert.rejects(rawInsert({ ...forged, budget_source_id: source }), /both be assigned/);
  await assert.rejects(rawInsert({ ...forged, budget_allocation_id: allocation }), /both be assigned/);
  await assert.rejects(rawInsert(entry('2026-11-06', 0.25, 'Allocated forged marker', { custom_data: { budget_assignment: 'unassigned' } })), /cannot retain budget references/);
  await identity();
  await db.exec('grant select,insert,update on project_tracker_entries to service_role;');
  await identity('service_role');
  await assert.rejects(rawInsert(forged), /service-authorized reviewed administrator import/, 'Even a service-client staff route cannot opt out by accepting forged import metadata without reviewed-RPC context.');
  await identity(null, staff, 'authenticated');
  await assert.rejects(rawInsert(forged), /service-authorized reviewed administrator import/, 'SECURITY DEFINER/current_user or a privileged SQL owner must not override an authenticated request claim.');
  await assert.rejects(run([unassigned('2026-11-06')]), /service-authorized administrator import/);
  await identity();

  // Correct imported history via the service client and, under test-only RLS,
  // its actual staff owner. Original rates and all import metadata are retained.
  card = await saveRates(project, { 'Senior Ecologist': 230, Ecologist: 190, 'Project Manager': 170 }, card.updated_at);
  await rejectedAtomically([unassigned('2026-11-06')], /charge rate changed/);
  await identity('service_role');
  const correctionMetadata = { ...imported.custom_data, km: 12, charge_rate_snapshot: 99999, charge_role: 'Ecologist', charge_rate_stamped: false, staff_note: 'Correction' };
  await query('update project_tracker_entries set hours=1.25,activity_information=$1,custom_data=$2::jsonb where id=$3', ['Corrected imported notes', JSON.stringify(correctionMetadata), imported.id]);
  await identity();
  let corrected = await one('select * from project_tracker_entries where id=$1', [imported.id]);
  assert.equal(corrected.custom_data.charge_rate_snapshot, 207); assert.equal(corrected.custom_data.charge_role, 'Senior Ecologist'); assert.equal(corrected.custom_data.charge_rate_stamped, true);
  assert.equal(corrected.custom_data.import_fingerprint, imported.custom_data.import_fingerprint); assert.equal(corrected.custom_data.km, 12); assert.equal(corrected.entered_by_admin_id, actor);
  await identity('authenticated', staff);
  await query('update project_tracker_entries set hours=1.50,activity_information=$1 where id=$2', ['Own corrected imported history', imported.id]);
  await assert.rejects(query('update project_tracker_entries set entered_by_admin_id=$1 where id=$2', [otherStaff, imported.id]), /preserve original/);
  await assert.rejects(query("update project_tracker_entries set custom_data=custom_data||'{\"import_file_name\":\"forged.xls\"}'::jsonb where id=$1", [imported.id]), /preserve original/);
  await assert.rejects(query("update project_tracker_entries set custom_data=custom_data-'budget_assignment' where id=$1", [imported.id]), /import provenance/);
  await assert.rejects(query('update project_tracker_entries set staff_user_id=$1 where id=$2', [otherStaff, imported.id]), /identity cannot be changed/);
  await identity('authenticated', otherStaff);
  await assert.rejects(query('update project_tracker_entries set hours=2 where id=$1', [imported.id]), /staff owner/);
  await identity();
  await db.exec('drop policy fixture_insert_probe on project_tracker_entries; drop policy fixture_select_probe on project_tracker_entries; drop policy fixture_update_probe on project_tracker_entries;');
  corrected = await one('select * from project_tracker_entries where id=$1', [imported.id]);
  assert.equal(Number(corrected.hours), 1.5); assert.equal(corrected.custom_data.charge_rate_snapshot, 207);
  assert.equal((await one('select public.ec_tracker_entry_charge_rate(project_id,staff_user_id,custom_data) as rate from project_tracker_entries where id=$1', [oldId])).rate, '130');
  assert.equal((await one("select count(*) as n from pg_policies where tablename='project_tracker_entries'")).n, 0);

  // A failure late in the transaction must undo mixed inserts AND any already
  // recalculated allocation totals, as well as all events/audit rows.
  const current = { custom_data: { import_expected_charge_rate: 230 } };
  await rejectedAtomically([unassigned('2026-11-07', 0.25, 'Valid first row', current), entry('2026-12-01', 0.25, 'Invalid later row', current)], /outside the approved source period/);
  await db.exec('alter table portal_events add constraint fixture_notification_failure check(false) not valid;');
  await rejectedAtomically([entry('2026-11-07', 0.25, 'Assigned rollback', current), unassigned('2026-11-08', 0.5, 'Unassigned rollback', current)], /fixture_notification_failure/);
  await db.exec('alter table portal_events drop constraint fixture_notification_failure;');
  await db.exec("alter table admin_audit_log add constraint fixture_audit_failure check(action<>'weekly_timesheets_imported') not valid;");
  await rejectedAtomically([entry('2026-11-07', 0.25, 'Assigned audit rollback', current), unassigned('2026-11-08', 0.5, 'Unassigned audit rollback', current)], /fixture_audit_failure/);
  await db.exec('alter table admin_audit_log drop constraint fixture_audit_failure;');
  result = await run([entry('2026-11-07', 0.25, 'Assigned finally succeeds', current), unassigned('2026-11-08', 0.5, 'Unassigned finally succeeds', current)]);
  assert.equal(result.importedCount, 2); assert.equal(result.allocationsRecalculated, 1); assert.equal(result.unassignedCharge, 115);
  assert.equal((await rowAt('2026-11-08')).custom_data.charge_rate_snapshot, 230);
  // Source parent-edit guards still protect assigned dates, ignoring NULL refs.
  await assert.rejects(query("update project_budget_sources set service_period_start='2026-11-02' where id=$1", [source]), /existing tracker entries/);
  const beforeDeleteAllocations = (await state()).allocations;
  const beforeDeleteHours = Number((await one('select sum(hours) as h from project_tracker_entries where project_id=$1', [project])).h);
  await query('delete from project_tracker_entries where id=$1', [imported.id]);
  assert.equal(Number((await one('select sum(hours) as h from project_tracker_entries where project_id=$1', [project])).h), beforeDeleteHours - 1.5);
  assert.deepEqual((await state()).allocations, beforeDeleteAllocations, 'Unassigned deletion changes project actuals, not allocated balances.');
  console.log('Unassigned import PostgreSQL passed: real foundation/period/rate/review migrations; paired NULLs, mixed/no-budget imports, unchanged allocated guards, trusted pricing and corrections, cross-assignment exact/overlap review, admin/service/RLS forgery defence, stale review/rates, project actuals, and complete notification/audit rollback.');
} finally {
  await db.close();
}
