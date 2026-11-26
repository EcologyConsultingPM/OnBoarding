import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const root = new URL('..', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');
const moduleUrl = (source) => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const chargeSource = await read('lib/projectTrackerChargeRates.js');
const chargeUrl = moduleUrl(chargeSource);
const chargeHelpers = await import(chargeUrl);
const { trackerChargeRole, loadTrackerChargeRates, trackerEntryChargeRate, trackerCurrentChargeRate, trackerResponseCustomData } = chargeHelpers;
const unassignedSource = await read('lib/projectTrackerUnassignedActuals.js');
const actuals = await import(moduleUrl(unassignedSource.replace('"./projectTrackerChargeRates"', JSON.stringify(chargeUrl))));
const { loadTrackerEntryPages } = actuals;
const allocationSource = await read('lib/projectTrackerAllocationTotals.js');
const { refreshProjectTrackerAllocation } = await import(moduleUrl(allocationSource.replace('"./projectTrackerChargeRates"', JSON.stringify(chargeUrl))));
const staffRoute = await read('app/api/project-tracker-entries/route.js');
const adminRoute = await read('app/api/admin/project-tracker-entries/route.js');
const healthRoute = await read('app/api/project-health-report/route.js');
const migration = await read('sql/2026-11-20-tracker-role-charge-rates.sql');
const require = createRequire(import.meta.url);
const { PGlite } = require('@electric-sql/pglite');
const db = new PGlite();

const seniorIds = ['d07b78be-c1e7-4bf5-94fa-5366a59cb408', '4eef096c-91da-4135-839d-c8a67b3a5e6f', 'abd4449e-5294-4e18-ad2a-08403cc3e1ce'];
const managerIds = ['577f0587-e75c-4c35-8013-1b334c348871', '2c265989-7864-41ad-9e2d-202d64d9a954', '75b7ca74-86d9-4cf5-be17-31ac12947f40'];
const actor = '00000000-0000-4000-8000-000000000001';
const other = '00000000-0000-4000-8000-000000000002';
const projects = Array.from({ length: 4 }, (_, i) => `00000000-0000-4000-8000-${String(i + 10).padStart(12, '0')}`);
const [p1, p2, p3, p4] = projects;
const allocation = '00000000-0000-4000-8000-000000000020';
const cardRates = (senior = 220, ecologist = 180, manager = 150) => ({ 'Senior Ecologist': senior, Ecologist: ecologist, 'Project Manager': manager });
const save = async (project, rates = cardRates(), expected = null, who = actor) => (await db.query(
  'select public.ec_save_project_charge_rates($1,$2,$3::timestamptz,$4::jsonb) as card', [project, who, expected, JSON.stringify(rates)]
)).rows[0].card;
const sqlRate = async (project, staff, metadata = {}) => Number((await db.query(
  'select public.ec_tracker_entry_charge_rate($1,$2,$3::jsonb) as rate', [project, staff, JSON.stringify(metadata)]
)).rows[0].rate);
const sqlCurrentRate = async (project, staff) => Number((await db.query(
  'select public.ec_tracker_current_charge_rate($1,$2) as rate', [project, staff]
)).rows[0].rate);
const insert = async (project, staff = other, metadata = {}, hours = 1) => (await db.query(
  'insert into project_tracker_entries(project_id,budget_allocation_id,staff_user_id,hours,custom_data) values($1,$2,$3,$4,$5::jsonb) returning id,project_id,staff_user_id,hours,custom_data',
  [project, allocation, staff, hours, JSON.stringify(metadata)]
)).rows[0];
const entries = async () => (await db.query('select id,project_id,budget_allocation_id,staff_user_id,hours,custom_data from project_tracker_entries order by id')).rows;

function mockAdmin(tables = {}, errors = {}) {
  const calls = [];
  const updates = [];
  return { calls, updates, from(table) {
    const filters = [];
    let columns = null, maximum = null, range = null, sort = null, single = false, patch = null;
    const q = {
      select(value) { columns = value; return q; },
      eq(key, value) { filters.push((row) => row[key] === value); return q; },
      in(key, values) { filters.push((row) => values.includes(row[key])); return q; },
      is(key, value) { filters.push((row) => (row[key] ?? null) === value); return q; },
      neq(key, value) { filters.push((row) => row[key] !== value); return q; },
      order(key) { sort = key; return q; },
      limit(value) { maximum = value; return q; },
      range(first, last) { range = [first, last]; return q; },
      maybeSingle() { single = true; return q; },
      update(value) { patch = value; return q; },
      then(resolve, reject) {
        calls.push({ table, columns, maximum, range });
        if (errors[table]) return Promise.resolve({ data: null, error: errors[table] }).then(resolve, reject);
        let rows = (tables[table] || []).filter((row) => filters.every((filter) => filter(row)));
        if (patch) { updates.push({ table, patch }); for (const row of rows) Object.assign(row, patch); }
        rows = rows.map((row) => ({ ...row }));
        if (sort) rows.sort((a, b) => String(a[sort]).localeCompare(String(b[sort])));
        if (maximum !== null) rows = rows.slice(0, maximum);
        if (range) rows = rows.slice(range[0], range[1] + 1);
        return Promise.resolve({ data: single ? rows[0] || null : rows, error: null }).then(resolve, reject);
      },
    };
    return q;
  } };
}
function extractFunction(source, start, end, name, context) {
  const text = source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start))).replace(/^export /, '');
  vm.createContext(context);
  vm.runInContext(`${text}\nthis.result = ${name};`, context);
  return context.result;
}
const staffRefresh = extractFunction(staffRoute, 'export async function refreshTrackerAllocation(', '\nasync function ownEntries(', 'refreshTrackerAllocation', { refreshProjectTrackerAllocation });
const adminRefresh = extractFunction(adminRoute, 'async function refreshAllocation(', '\n// Staff eligible', 'refreshAllocation', { refreshProjectTrackerAllocation });

try {
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth;
    create table auth.users(id uuid primary key,email text,deleted_at timestamptz,banned_until timestamptz);
    create table public.portal_visibility_overrides(user_id uuid,resource_key text,is_visible boolean);
    create table public.projects(id uuid primary key,default_hourly_rate numeric,deleted_at timestamptz);
    create table public.project_allocations(project_id uuid,staff_user_id uuid,hourly_rate numeric);
    create table public.project_tracker_entries(id uuid primary key default gen_random_uuid(),project_id uuid references public.projects(id),budget_allocation_id uuid,staff_user_id uuid,hours numeric,custom_data jsonb not null default '{}');
    create table public.project_budget_allocations(id uuid,project_id uuid,hours_consumed numeric,charge_out_spend numeric,internal_cost numeric,updated_by uuid,updated_at timestamptz);
    create table public.project_role_rates(id uuid default gen_random_uuid(),role_name text,charge_rate numeric,sort_order integer,updated_at timestamptz);
    create table public.admin_audit_log(actor_id uuid,action text,entity_type text,entity_id uuid,project_id uuid,resource_key text,before_data jsonb,after_data jsonb,reason text);
    create function public.project_closeout_can_manage(uuid) returns boolean language sql as $$ select $1 in ('${actor}'::uuid,'${managerIds[1]}'::uuid) $$;
    insert into public.projects(id,default_hourly_rate) values ${projects.map((id) => `('${id}',95)`).join(',')};
    insert into auth.users(id,email) values('${actor}','admin@example.test'),('${other}','staff@example.test'),${[...seniorIds, ...managerIds].map((id, i) => `('${id}','${id === managerIds[1] ? 'aaron.dooley@ecologyconsulting.au' : `person${i}@example.test`}')`).join(',')};
    insert into project_allocations values('${p3}','${seniorIds[0]}',125),('${p3}','${managerIds[0]}',0);
    insert into project_role_rates(role_name,charge_rate) values('Senior Ecologist',999999),('Ecologist',888888),('Project Manager',777777);
    insert into project_budget_allocations(id,project_id,hours_consumed,charge_out_spend,internal_cost) values('${allocation}','${p1}',9,777,400);
  `);
  const legacy = await insert(p1, other, { km: 12, charge_role: 'Ecologist', charge_rate_snapshot: 13 });
  await db.exec(migration);
  await db.exec(migration);
  assert.deepEqual((await entries())[0].custom_data, legacy.custom_data, 'Migration must not rewrite old metadata.');
  assert.equal(Number((await db.query('select count(*) as count from project_charge_rates')).rows[0].count), 0, 'Migration must not seed any project cards.');
  assert.equal(await sqlRate(p3, seniorIds[0]), 125);
  assert.equal(await sqlRate(p3, managerIds[0]), 95, 'Zero legacy individual rates retain the default fallback.');
  assert.equal(await sqlRate(p3, other), 95, 'Missing cards never use company role suggestions.');
  const beforeCard = await insert(p3, other, { km: 3, charge_role: 'Ecologist', charge_rate_snapshot: 9999, charge_rate_stamped: true });
  assert.deepEqual(beforeCard.custom_data, { km: 3 }, 'No-card inserts must remove spoofed snapshots without blocking staff time.');

  const first = await save(p1);
  const second = await save(p2, cardRates(300, 210, 160));
  assert.equal(first.confirmed_by, actor);
  assert.ok(first.confirmed_at && first.updated_at);
  const cardTables = { project_charge_rates: [first, second] };
  let rates = await loadTrackerChargeRates(mockAdmin(cardTables), projects);
  assert.equal(rates.size, 2);
  assert.equal(rates.has(p3), false);
  for (const [id, expected] of [...seniorIds.map((id) => [id, 'Senior Ecologist']), ...managerIds.map((id) => [id, 'Project Manager']), [other, 'Ecologist'], [null, 'Ecologist']]) {
    assert.equal(trackerChargeRole(id), expected);
    assert.equal(trackerChargeRole(id?.toUpperCase()), expected);
    assert.equal((await db.query('select public.ec_tracker_charge_role($1) as role', [id])).rows[0].role, expected);
    for (const project of [p1, p2]) {
      assert.equal(await sqlCurrentRate(project, id), trackerCurrentChargeRate(project, id, rates, 95));
      assert.equal(await sqlRate(project, id), 95, 'Unstamped entry pricing must ignore even a confirmed current card.');
      assert.equal(trackerEntryChargeRate({ project_id: project, staff_user_id: id }, rates, 95), 95);
    }
  }
  assert.equal(trackerEntryChargeRate({ project_id: p3, staff_user_id: seniorIds[0] }, rates, 125), 125);
  assert.equal(trackerEntryChargeRate({ project_id: p3, staff_user_id: other }, rates), 0);
  assert.equal((await loadTrackerChargeRates(mockAdmin(), [])).size, 0);
  const absentAdmin = mockAdmin();
  assert.equal((await loadTrackerChargeRates(absentAdmin, [p3])).has(p3), false);
  assert.deepEqual(absentAdmin.calls.map((c) => c.table), ['project_charge_rates']);

  const original = await insert(p1, other, { km: 42, charge_role: 'Project Manager', charge_rate_snapshot: 9999, charge_rate_stamped: true }, 2);
  assert.equal(original.custom_data.charge_role, 'Ecologist');
  assert.equal(original.custom_data.charge_rate_snapshot, 180);
  assert.equal(original.custom_data.charge_rate_stamped, true);
  const senior = await insert(p1, seniorIds[0], { charge_rate_snapshot: 1 });
  assert.equal(senior.custom_data.charge_rate_snapshot, 220);
  const beforeRates = await entries();
  const changed = await save(p1, cardRates(345.678, 245.678, 175.678), first.updated_at);
  assert.equal(changed.ecologist_rate, 245.68);
  assert.deepEqual(await entries(), beforeRates, 'Card confirmation must not reprice or backfill entries.');
  assert.equal(Number((await db.query('select charge_out_spend from project_budget_allocations')).rows[0].charge_out_spend), 777, 'Card save must not update stored actuals.');
  rates = await loadTrackerChargeRates(mockAdmin({ project_charge_rates: [changed, second] }), projects);
  assert.equal(trackerEntryChargeRate(legacy, rates, 95), 95, 'Newly confirmed/changed cards must never reprice old unstamped rows.');
  assert.equal(await sqlRate(p1, other, legacy.custom_data), 95);
  assert.equal(trackerEntryChargeRate(original, rates), 180);
  assert.equal(await sqlRate(p1, other, original.custom_data), 180);
  const fresh = await insert(p1, other);
  assert.equal(fresh.custom_data.charge_rate_snapshot, 245.68, 'Future entries stamp current per-job rates.');
  const corrected = (await db.query('update project_tracker_entries set hours=3,custom_data=$2::jsonb where id=$1 returning project_id,staff_user_id,hours,custom_data',
    [original.id, JSON.stringify({ km: 7, charge_role: 'Project Manager', charge_rate_snapshot: 1, charge_rate_stamped: false })])).rows[0];
  assert.equal(corrected.custom_data.charge_rate_snapshot, 180);
  assert.equal(corrected.custom_data.charge_role, 'Ecologist');
  assert.equal(corrected.custom_data.charge_rate_stamped, true);
  assert.equal(corrected.custom_data.km, 7);
  assert.equal(trackerEntryChargeRate(corrected, rates), 180);
  await db.query('update project_tracker_entries set custom_data=\'{}\'::jsonb where id=$1', [original.id]);
  assert.equal(await sqlRate(p1, other, (await entries()).find((e) => e.id === original.id).custom_data), 180, 'Deleting submitted metadata cannot remove a trusted snapshot.');
  await db.query('update project_tracker_entries set custom_data=$2::jsonb,hours=2 where id=$1', [legacy.id, JSON.stringify({ km: 5, charge_role: 'Ecologist', charge_rate_snapshot: 1, charge_rate_stamped: true })]);
  assert.deepEqual((await entries()).find((e) => e.id === legacy.id).custom_data, { km: 5 }, 'Legacy corrections stay unstamped even after card confirmation.');
  await assert.rejects(db.query('update project_tracker_entries set staff_user_id=$2 where id=$1', [original.id, seniorIds[0]]), /identity cannot be changed/);
  const wrongRole = { charge_rate_stamped: true, charge_role: 'Project Manager', charge_rate_snapshot: 1 };
  assert.equal(await sqlRate(p1, other, wrongRole), 95);
  assert.equal(trackerEntryChargeRate({ project_id: p1, staff_user_id: other, custom_data: wrongRole }, rates, 95), 95);
  for (const bad of [0, -1, null, '180']) {
    const metadata = { charge_rate_stamped: true, charge_role: 'Ecologist', charge_rate_snapshot: bad };
    await assert.rejects(sqlRate(p1, other, metadata), /Invalid trusted/);
    assert.throws(() => trackerEntryChargeRate({ project_id: p1, staff_user_id: other, custom_data: metadata }, rates), /Invalid trusted/);
  }
  const snapshotOnly = { project_id: p1, staff_user_id: other, custom_data: { charge_rate_stamped: true, charge_role: 'Ecologist', charge_rate_snapshot: 987.65 } };
  assert.equal(trackerEntryChargeRate(snapshotOnly, new Map()), 987.65, 'Valid future positive snapshots are not capped to historical catalogue values.');
  assert.equal(await sqlRate(p1, other, snapshotOnly.custom_data), 987.65);

  await assert.rejects(save(p1, cardRates(), first.updated_at), /changed concurrently/);
  await assert.rejects(save(p1), /changed concurrently/, 'Null expected timestamps cannot overwrite an existing card.');
  await assert.rejects(save(p3, cardRates(), first.updated_at), /changed concurrently/);
  for (const bad of [cardRates(0), cardRates(-1), cardRates(1000000.01), cardRates('Infinity'), cardRates('NaN'), cardRates(0.001), { Ecologist: 180 }, { ...cardRates(), Other: 1 }, cardRates(null), cardRates(true)]) {
    await assert.rejects(save(p3, bad), /rates|roles/);
  }
  await assert.rejects(save(p3, cardRates(), null, other), /active administrator/);
  await db.query('update auth.users set banned_until=now()+interval \'1 day\' where id=$1', [actor]);
  await assert.rejects(save(p3), /active administrator/);
  await db.query('update auth.users set banned_until=null,deleted_at=now() where id=$1', [actor]);
  await assert.rejects(save(p3), /active administrator/);
  await db.query('update auth.users set deleted_at=null where id=$1', [actor]);
  for (const key of ['admin.projects', 'admin.projects.setup']) {
    await db.query('insert into portal_visibility_overrides values($1,$2,false)', [actor, key]);
    await assert.rejects(save(p3), /setup access is disabled/);
    await db.exec('delete from portal_visibility_overrides');
  }
  await db.query('insert into portal_visibility_overrides values($1,\'admin.projects.setup\',false)', [managerIds[1]]);
  const primaryCard = await save(p4, cardRates(), null, managerIds[1]);
  assert.equal(primaryCard.confirmed_by, managerIds[1], 'Protected primary admins retain access despite a visibility override.');
  await db.exec('delete from portal_visibility_overrides');
  const auditCount = Number((await db.query('select count(*) as count from admin_audit_log')).rows[0].count);
  await db.exec('alter table admin_audit_log add constraint forced_audit_failure check(false) not valid');
  await assert.rejects(save(p1, cardRates(), changed.updated_at), /forced_audit_failure/);
  assert.equal((await db.query('select to_jsonb(c) as card from project_charge_rates c where project_id=$1', [p1])).rows[0].card.updated_at, changed.updated_at);
  assert.equal(Number((await db.query('select count(*) as count from admin_audit_log')).rows[0].count), auditCount, 'Failed audit must roll back the card edit.');
  await db.exec('alter table admin_audit_log drop constraint forced_audit_failure');
  const concurrent = await Promise.allSettled([save(p1, cardRates(260, 200, 155), changed.updated_at), save(p1, cardRates(261, 201, 156), changed.updated_at)]);
  assert.equal(concurrent.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(concurrent.filter((result) => result.status === 'rejected').length, 1);
  const privileges = (await db.query(`select
    has_function_privilege('anon','public.ec_tracker_entry_charge_rate(uuid,uuid,jsonb)','EXECUTE') as anon_rate,
    has_function_privilege('authenticated','public.ec_save_project_charge_rates(uuid,uuid,timestamptz,jsonb)','EXECUTE') as staff_save,
    has_function_privilege('service_role','public.ec_save_project_charge_rates(uuid,uuid,timestamptz,jsonb)','EXECUTE') as service_save,
    has_table_privilege('authenticated','project_charge_rates','SELECT') as staff_select,
    has_table_privilege('service_role','project_charge_rates','SELECT') as service_select,
    has_table_privilege('service_role','project_charge_rates','UPDATE') as service_update`)).rows[0];
  assert.deepEqual(privileges, { anon_rate: false, staff_save: false, service_save: true, staff_select: false, service_select: true, service_update: false });
  assert.equal((await db.query("select relrowsecurity from pg_class where oid='public.project_charge_rates'::regclass")).rows[0].relrowsecurity, true);
  await db.exec('set role authenticated');
  await assert.rejects(db.query('select project_id from project_charge_rates'), /permission denied/);
  await db.exec('reset role; set role service_role');
  assert.ok((await db.query('select project_id from project_charge_rates')).rows.length > 0);
  await db.exec('reset role');
  await assert.rejects(loadTrackerChargeRates(mockAdmin({ project_charge_rates: [{ ...first, ecologist_rate: 0 }] }), [p1]), /required positive/);
  await assert.rejects(loadTrackerChargeRates(mockAdmin({}, { project_charge_rates: { message: 'permission denied' } }), [p1]), /Unable to load/);
  assert.throws(() => trackerCurrentChargeRate(p1, other, new Map([[p1, new Map()]]), 95), /required positive/);
  assert.equal(trackerEntryChargeRate({ project_id: p1, staff_user_id: other }, new Map([[p1, new Map()]]), 95), 95, 'An old row never takes its price from the current card.');
  assert.throws(() => trackerEntryChargeRate({ project_id: p3 }, new Map(), Infinity), /Invalid legacy/);
  const manyCards = Array.from({ length: 1001 }, (_, i) => ({ ...first, project_id: `project-${i}` }));
  assert.equal((await loadTrackerChargeRates(mockAdmin({ project_charge_rates: manyCards }), manyCards.map((card) => card.project_id))).size, 1001, 'Large card reads must not be server-limit truncated.');

  const allCards = (await db.query('select to_jsonb(c) as card from project_charge_rates c')).rows.map((row) => row.card);
  const baseTables = {
    project_charge_rates: allCards,
    projects: projects.map((id) => ({ id, default_hourly_rate: 95 })),
    project_allocations: [{ project_id: p3, staff_user_id: seniorIds[0], hourly_rate: 125 }],
    project_tracker_entries: await entries(),
    project_budget_allocations: [{ id: allocation, project_id: p1 }],
  };
  const expectedSpend = Number((await db.query('select round(sum(hours*public.ec_tracker_entry_charge_rate(project_id,staff_user_id,custom_data)),2) as spend from project_tracker_entries where project_id=$1', [p1])).rows[0].spend);
  const results = [];
  for (const refresh of [refreshProjectTrackerAllocation, staffRefresh, adminRefresh]) {
    const admin = mockAdmin(structuredClone(baseTables));
    const result = await refresh({ admin, user: { id: actor } }, p1, allocation);
    assert.equal(result.chargeOutSpend, expectedSpend);
    assert.ok(admin.calls.some((call) => call.table === 'project_tracker_entries' && call.columns.includes('custom_data')));
    assert.ok(!admin.calls.some((call) => call.table === 'project_role_rates'));
    const { updated_at, ...patch } = admin.updates[0].patch;
    results.push(patch);
  }
  assert.deepEqual(results[0], results[1]);
  assert.deepEqual(results[1], results[2], 'Administrator and staff refreshes must have identical snapshot/card/legacy charging.');
  const many = Array.from({ length: 10001 }, (_, i) => ({ id: String(i).padStart(6, '0'), project_id: p3, budget_allocation_id: allocation, staff_user_id: other, hours: 0.01, custom_data: {} }));
  const manyAdmin = mockAdmin({ ...baseTables, project_tracker_entries: [...many, { ...many[0], project_id: p2, hours: 24 }], project_budget_allocations: [{ id: allocation, project_id: p3 }] });
  const manyTotals = await staffRefresh({ admin: manyAdmin, user: { id: actor } }, p3, allocation);
  assert.equal(manyTotals.hoursConsumed, Math.round(10001 * 0.01 * 100) / 100);
  assert.equal(manyTotals.chargeOutSpend, Math.round(10001 * 0.01 * 95 * 100) / 100);
  assert.equal(manyAdmin.calls.filter((call) => call.table === 'project_tracker_entries').length, 11, 'No former 10,000-row cap may survive.');
  const failedAdmin = mockAdmin({ ...baseTables, project_charge_rates: [{ ...first, ecologist_rate: 0 }] });
  await assert.rejects(staffRefresh({ admin: failedAdmin, user: { id: actor } }, p1, allocation), /required positive/);
  assert.equal(failedAdmin.updates.length, 0, 'Invalid confirmed rates fail closed without zeroing totals.');

  // Exercise report pricing without changing source-backed current/historical actuals.
  const reportTables = {
    ...baseTables,
    projects: projects.map((id) => ({ id, name: id, status: 'active', deleted_at: null, default_hourly_rate: 95, budget_hours: 100, budget_dollars: 10000 })),
    project_allocations: [{ project_id: p3, staff_user_id: other, hourly_rate: 125, active: true }],
    project_activities: [],
    project_tracker_entries: [fresh, { project_id: p3, staff_user_id: other, hours: 2, custom_data: {} }, { project_id: p4, staff_user_id: other, hours: 999, custom_data: { charge_rate_stamped: true, charge_role: 'Ecologist', charge_rate_snapshot: 0 } }],
    project_budget_sources: [{ id: 'source', project_id: p4, source_type: 'original', approval_status: 'approved', approved_value: 10000, approved_hours: 100 }],
    project_budget_allocations: [{ id: 'current', project_id: p4, budget_source_id: 'source', status: 'active', hours_consumed: 4, charge_out_spend: 777, internal_cost: 444 }, { id: 'old', project_id: p4, budget_source_id: 'closed', status: 'closed', hours_consumed: 2, charge_out_spend: 50, internal_cost: 30 }],
  };
  let reportAdmin = mockAdmin(reportTables);
  const reportContext = { ...chargeHelpers, ...actuals, Headers, loadTrackerChargeRates, trackerEntryChargeRate, requireSession: async () => ({ admin: reportAdmin, isAdmin: true, user: { id: actor } }), serverError: (error) => Response.json({ error: error.message }, { status: 500 }), Response, console };
  vm.createContext(reportContext);
  vm.runInContext(healthRoute.replace(/^import[^\n]*\n/gm, '').replace(/export /g, '') + '\nthis.reportGet = GET;', reportContext);
  let response = await reportContext.reportGet({});
  assert.equal(response.status, 200);
  let report = await response.json();
  assert.equal(report.rows.find((row) => row.id === p1).currentSpend, fresh.custom_data.charge_rate_snapshot);
  assert.equal(report.rows.find((row) => row.id === p3).currentSpend, 250, 'Missing-card report projects retain legacy pricing.');
  const sourced = report.rows.find((row) => row.id === p4);
  assert.equal(sourced.currentSpend, 777);
  assert.equal(sourced.historicalChargeOutSpend, 50);
  assert.equal(sourced.lifetimeChargeOutSpend, 827);
  reportAdmin = mockAdmin({ ...reportTables, projects: reportTables.projects.filter((project) => project.id === p4) }, { project_charge_rates: { message: 'must not load rates for stored actuals' } });
  response = await reportContext.reportGet({});
  assert.equal(response.status, 200);
  assert.equal(reportAdmin.calls.some((call) => call.table === 'project_charge_rates'), false, 'Source-only health reports must not depend on current charge cards.');

  const initialRace = await Promise.allSettled([save(p3, cardRates(275, 205, 165)), save(p3, cardRates(276, 206, 166))]);
  assert.equal(initialRace.filter((result) => result.status === 'fulfilled').length, 1, 'Parent locking must serialize first-card creation too.');
  assert.equal(initialRace.filter((result) => result.status === 'rejected').length, 1);
  const laterRates = await loadTrackerChargeRates(mockAdmin({ project_charge_rates: [initialRace.find((result) => result.status === 'fulfilled').value] }), [p3]);
  assert.equal(trackerEntryChargeRate(beforeCard, laterRates, 95), 95, 'A row inserted before its project card remains legacy after confirmation.');
  assert.equal(await sqlRate(p3, other, beforeCard.custom_data), 95);
  assert.equal(await sqlRate(p3, seniorIds[0]), 125, 'Pre-card individual legacy rates survive new card confirmation.');
  const newAfterCard = await insert(p3, other);
  assert.equal(newAfterCard.custom_data.charge_rate_snapshot, await sqlCurrentRate(p3, other));

  const normalMetadata = { notes: 'Survey notes', km: 42, expenses: [{ amount: 12, purpose: 'Parking' }], vehicle: 'Ute', custom_column: 'Keep this value' };
  const privateMetadata = {
    ...normalMetadata, charge_role: 'Ecologist', charge_rate_snapshot: 180, charge_rate_stamped: true,
    charge_source: 'project card', charge_version: 1, charge_rate_source: 'confirmed', charge_rate_version: 1,
    charge_rate_snapshot_source: 'confirmed', charge_rate_snapshot_version: 1,
    import_expected_charge_rate: 180, import_charge_role: 'Ecologist',
    import_duplicate_review: { other_entry_id: 'private-entry', charge_out_spend: 999 },
  };
  assert.deepEqual(trackerResponseCustomData(privateMetadata), normalMetadata);
  assert.deepEqual(trackerResponseCustomData(privateMetadata, true), privateMetadata);
  assert.equal(privateMetadata.charge_rate_snapshot, 180, 'Response sanitizing must not mutate database or audit metadata.');
  const privacyEntry = { id: original.id, project_id: p1, budget_source_id: p2, budget_allocation_id: allocation, staff_user_id: other,
    activity_id: null, work_date: '2026-11-20', activity_category: 'Field', activity_information: 'Survey', hours: 1, status: 'completed',
    custom_data: privateMetadata, created_at: '2026-11-20T00:00:00Z', updated_at: '2026-11-20T00:00:00Z' };
  const ownHistory = extractFunction(staffRoute, 'async function ownEntries(', '\n// Every person allocated', 'ownEntries', { trackerResponseCustomData, loadTrackerEntryPages, unavailable: () => false });
  for (const isAdmin of [false, true]) {
    const history = await ownHistory({ admin: mockAdmin({ project_tracker_entries: [privacyEntry] }), user: { id: other }, isAdmin });
    assert.deepEqual(history.entries[0].customData, isAdmin ? privateMetadata : normalMetadata, 'GET history must sanitize according to the caller, not the entry owner.');
  }
  // Simulate the database trigger returning trusted metadata after INSERT or
  // UPDATE; execute the real route functions, not a copied response mapping.
  const responseAdmin = { from(table) {
    let patch = null;
    const q = {
      select() { return q; }, eq() { return q; }, maybeSingle() { return q; }, single() { return q; },
      insert(value) { patch = value; return q; }, update(value) { patch = value; return q; },
      then(resolve, reject) {
        const data = table === 'project_tracker_entries' ? { ...privacyEntry, ...patch, custom_data: privateMetadata } : null;
        return Promise.resolve({ data, error: null }).then(resolve, reject);
      },
    };
    return q;
  } };
  const privacyProject = { id: p1, name: 'Survey job', isAssigned: true, template: { category_options: ['Field'], column_definitions: [] },
    sources: [{ id: p2, allocations: [{ id: allocation, allocation_code: 'FIELD', allocation_name: 'Field' }] }] };
  let privacyAccess = { admin: responseAdmin, user: { id: other }, isAdmin: false };
  const responseContext = {
    trackerResponseCustomData, Date, Response, STATUSES: new Set(['completed']), validId: () => true,
    text: (value) => typeof value === 'string' ? value.trim() : '', hours: Number, validBudgetDate: () => true,
    budgetEntryPeriodError: () => null, eligibleProjects: async () => ({ available: true, projects: [privacyProject] }),
    refreshTrackerAllocation: async () => {}, requireSession: async () => privacyAccess, requirePortalResource: async () => null,
    validateTrackerBudgetCorrection: async () => ({ sourceId: p2, allocationId: allocation }),
    jsonError: (error, status = 400) => Response.json({ error }, { status }),
    serverError: (error) => Response.json({ error: error.message }, { status: 500 }),
  };
  const create = extractFunction(staffRoute, 'export async function createTrackerEntry(', '\nexport async function POST(', 'createTrackerEntry', responseContext);
  const correctionSource = staffRoute.slice(staffRoute.indexOf('export async function PATCH(')).replace(/^export /, '');
  vm.runInContext(correctionSource + '\nthis.correct = PATCH;', responseContext);
  const input = { id: original.id, projectId: p1, sourceId: p2, allocationId: allocation, workDate: '2026-11-20',
    activityCategory: 'Field', activityInformation: 'Survey', hours: 1, status: 'completed', customData: normalMetadata };
  for (const isAdmin of [false, true]) {
    privacyAccess = { ...privacyAccess, isAdmin };
    const created = await create(privacyAccess, input);
    assert.equal(created.error, undefined);
    assert.deepEqual(created.entry.customData, isAdmin ? privateMetadata : normalMetadata, 'POST creation must not leak newly stamped rates to staff.');
    const correctedResponse = await responseContext.correct({ json: async () => input });
    assert.equal(correctedResponse.status, 200);
    assert.deepEqual((await correctedResponse.json()).entry.customData, isAdmin ? privateMetadata : normalMetadata, 'Correction responses must not leak snapshot or other-entry review metadata.');
  }

  assert.doesNotMatch(staffRoute.slice(staffRoute.indexOf('export async function refreshTrackerAllocation('), staffRoute.indexOf('async function ownEntries(')), /limit\(10000\)|hourly_rate|default_hourly_rate/);
  assert.equal((staffRoute.match(/customData: trackerResponseCustomData\(entry\.custom_data, access\.isAdmin\)/g) || []).length, 3);
  assert.doesNotMatch(staffRoute, /customData: entry\.custom_data/);
  assert.match(allocationSource, /trackerEntryChargeTotal\(entry, ratesByProject, legacyRate\)/);
  assert.doesNotMatch(chargeSource, /from\("project_role_rates"\)/);
  assert.doesNotMatch(migration, /update public\.project_tracker_entries|update public\.project_budget_allocations/);
  console.log('Tracker charge cards passed: six fixed roles/default parity, per-job isolation, missing-card legacy logging/pricing, snapshot tamper/correction retention, future-only changes, audited active-admin/visibility saves, optimistic races/rollback, service-only RLS, 10,001-row admin/staff consistency, and unchanged source-backed health actuals.');
} finally {
  await db.close();
}
