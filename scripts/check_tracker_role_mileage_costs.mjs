import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { PGlite } from '@electric-sql/pglite';

// Strictly isolated: in-memory PostgreSQL, imported pure helpers, mocked APIs.
// No environment secrets, sockets, production rows, or live service calls.
const root = new URL('../', import.meta.url);
const read = (file) => readFile(new URL(file, root), 'utf8');
const dataUrl = (source) => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const chargeUrl = dataUrl(await read('lib/projectTrackerChargeRates.js'));
const charge = await import(chargeUrl);
const actualUrl = dataUrl((await read('lib/projectTrackerUnassignedActuals.js')).replace('"./projectTrackerChargeRates"', JSON.stringify(chargeUrl)));
const actual = await import(actualUrl);
const refresh = await import(dataUrl((await read('lib/projectTrackerAllocationTotals.js')).replace('"./projectTrackerChargeRates"', JSON.stringify(chargeUrl))));
const role = await import(dataUrl((await read('lib/projectTrackerRoleCosts.js')).replace('"./projectTrackerChargeRates"', JSON.stringify(chargeUrl)).replace('"./projectTrackerUnassignedActuals"', JSON.stringify(actualUrl))));
const periods = await import(dataUrl(await read('lib/projectBudgetPeriods.js')));
const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ACTOR = uuid(1), STAFF = uuid(2), P = uuid(3), S = uuid(4), A = uuid(5), N = uuid(6), LEGACY = uuid(7);
const SENIOR = 'd07b78be-c1e7-4bf5-94fa-5366a59cb408', MANAGER = '577f0587-e75c-4c35-8013-1b334c348871';
const cardRoles = { 'Senior Ecologist': 207, Ecologist: 174, 'Project Manager': 163 };
const time = '2026-11-24T00:00:00.123456+00:00';
let checks = 0;
const eq = (a,b,message) => { assert.deepEqual(a,b,message); checks++; };
const stamped = (staff = STAFF, patch = {}) => ({ charge_role: charge.trackerChargeRole(staff), charge_rate_snapshot: cardRoles[charge.trackerChargeRole(staff)], charge_rate_stamped: true,
  internal_role: charge.trackerChargeRole(staff), internal_hourly_rate_snapshot: charge.trackerInternalHourlyRate(staff), internal_cost_stamped: true,
  mileage_charge_rate_snapshot: 1.25, mileage_charge_stamped: true, mileage_internal_rate_snapshot: 0.90, mileage_internal_stamped: true, km: 10, ...patch });
const entry = (id, patch = {}) => ({ id: uuid(id), project_id: P, staff_user_id: STAFF, budget_source_id: S, budget_allocation_id: A, hours: 2, custom_data: stamped(), ...patch });
for (const [staff,rate] of [[SENIOR,81],[STAFF,75],[MANAGER,70]]) {
  eq(charge.trackerInternalHourlyRate(staff), rate);
  const e = entry(10, { staff_user_id: staff, custom_data: stamped(staff) });
  eq(charge.trackerEntryInternalCost(e), 2 * rate + 9);
  eq(charge.trackerEntryInternalCost(e), role.trackerEntryInternalCost(e), 'Role/shared cost parity');
  eq(charge.trackerEntryChargeTotal(e, null), role.summarizeTrackerActuals([e]).chargeOutSpend);
  eq(charge.trackerEntryChargeTotal(e, null), 2 * cardRoles[charge.trackerChargeRole(staff)] + 12.5);
}
for (const value of [10, '10.25', 0, null, '']) eq(charge.trackerEntryKilometres({ custom_data: { kilometres: value } }), Number(value || 0));
for (const value of [-1, 'wrong', true, Infinity]) assert.throws(() => charge.trackerEntryKilometres({ custom_data: { km: value } }), /kilometres/);
const old = entry(11, { custom_data: { km: 10, charge_rate_snapshot: 999, internal_hourly_rate_snapshot: 999, internal_cost_stamped: true, internal_role: 'Ecologist', mileage_internal_stamped: true, mileage_internal_rate_snapshot: 999 } });
eq(charge.trackerEntryChargeTotal(old, new Map([[P,new Map([['Ecologist',900]])]]), 130), 260);
eq(charge.trackerEntryMileageChargeRate(old), 0);
eq(charge.trackerEntryInternalCost(old), 159, 'Old arbitrary internal fields cannot change fixed policy');
eq(role.trackerEntryInternalCost(old), charge.trackerEntryInternalCost(old));
const unassigned = entry(12, { budget_source_id: null, budget_allocation_id: null, custom_data: stamped(STAFF, { budget_assignment: 'unassigned' }) });
eq(actual.summarizeTrackerUnassignedActuals([old,unassigned]), { count:1,hours:2,chargeOutSpend:360.5,internalCost:159 });
const stripped = charge.trackerResponseCustomData({ ...unassigned.custom_data, nested: { mileage_charge_stamped: true, internal_cost_stamped: true, km: 10, charge_out_spend: 30 }, notes: 'Keep' });
eq(stripped, { km:10,budget_assignment:'unassigned',nested:{km:10},notes:'Keep' });

// Reuse only the deterministic PostgREST mock definition, not its old tests or
// old percentage expectations. Its projection/range semantics match production.
const previousTest = await read('scripts/check_tracker_unassigned_actuals.mjs');
const mockContext = vm.createContext({ structuredClone, uuid });
const mockSource=previousTest.slice(previousTest.indexOf('function mockAdmin('), previousTest.indexOf('function context('))
  .replace('      neq(key, value)',`      gte(key,value) {filters.push(row=>row[key]>=value);return q;},
      lte(key,value) {filters.push(row=>row[key]<=value);return q;},
      gt(key,value) {filters.push(row=>Number(row[key])>value);return q;},
      neq(key, value)`);
vm.runInContext(mockSource+'\nthis.mockAdmin=mockAdmin;',mockContext);
const mockAdmin = mockContext.mockAdmin;
function routeContext(source, access, extra = {}) {
  const ctx = vm.createContext({ Response,Request,Headers,URL,TextDecoder,Uint8Array,Date,console,
    ...charge,...actual,...periods,...refresh,
    requireSession:async()=>access, requirePortalResource:async()=>null,
    serverError:(error)=>Response.json({error:error.message},{status:500}), ...extra });
  vm.runInContext(source.replace(/^import[\s\S]*?from ["'][^"']+["'];\n/gm,'').replace(/^export /gm,''),ctx);
  return ctx;
}
const project = { id:P,name:'Isolated project',status:'active',budget_dollars:5000,budget_hours:30,default_hourly_rate:111 };
const source = { id:S,project_id:P,source_type:'original',approval_status:'approved',approved_value:5000,approved_hours:30 };
const allocation = { id:A,project_id:P,budget_source_id:S,status:'active',staff_visible:true,hours_consumed:2,charge_out_spend:360.5,internal_cost:216.3 };
const card = { project_id:P,senior_ecologist_rate:207,ecologist_rate:174,project_manager_rate:163,mileage_rate:1.25,confirmed_at:time,updated_at:time,confirmed_by:ACTOR };
const tables = (entries) => ({ projects:[project],project_budget_sources:[source],project_budget_allocations:[allocation],project_tracker_entries:entries,
  project_allocations:[{project_id:P,staff_user_id:STAFF,hourly_rate:130,active:true}], project_charge_rates:[card],project_activities:[],project_tracker_settings:[],portal_events:[] });
const access = (admin,isAdmin=true)=>({admin,isAdmin,user:{id:ACTOR}});
let admin = mockAdmin(tables([entry(20),unassigned]));
eq((await charge.loadTrackerChargeRates(admin,[P])).get(P).get('Mileage'),1.25);
for (const mileage of [null,0,1.25]) {
  const db = mockAdmin({project_charge_rates:[{...card,mileage_rate:mileage}]});
  const rates = (await charge.loadTrackerChargeRates(db,[P])).get(P);
  eq(rates.has('Mileage'),mileage!==null); if(mileage!==null) eq(rates.get('Mileage'),mileage);
}
eq(await refresh.refreshProjectTrackerAllocation(access(admin),P,null),{hoursConsumed:0,chargeOutSpend:0,internalCost:0,skipped:true});
eq(admin.writes.length,0);
let totals = await refresh.refreshProjectTrackerAllocation(access(admin),P,A);
eq(totals,{hoursConsumed:2,chargeOutSpend:360.5,internalCost:159});
const adminSource = await read('app/api/admin/project-tracker/route.js');
const tracker = routeContext(adminSource,access(admin));
const build = (entries,allocations=[allocation],sources=[source],p=project)=>tracker.buildProjectTracker(p,sources,allocations,[],entries,1,{},new Map(),new Map(),true,new Map([[STAFF,130]]));
let projectResult = build([entry(20),unassigned]);
eq(projectResult.financials.internalCost,318);
eq(projectResult.financials.chargeOutSpend,721);
eq(projectResult.financials.usedHours,4);
eq(projectResult.financials.lifetimeInternalCost,318);
const closed = {...allocation,id:uuid(50),budget_source_id:uuid(51),status:'closed',hours_consumed:3,charge_out_spend:901,internal_cost:540.6};
const closedSource = {...source,id:uuid(51),approval_status:'closed'};
projectResult = build([entry(20),unassigned,entry(52,{hours:3,budget_allocation_id:closed.id,budget_source_id:closedSource.id})],[allocation,closed],[source,closedSource]);
eq(projectResult.financials.internalCost,318);
eq(projectResult.financials.historicalInternalCost,234);
eq(projectResult.financials.lifetimeInternalCost,552);
eq(projectResult.financials.lifetimeChargeOutSpend,1622);
eq(projectResult.sources[1].allocations[0].charge_out_spend,901,'Historical charges remain stored');
projectResult = build([unassigned],[],[],{...project,budget_dollars:0,budget_hours:0});
eq(projectResult.financials.usedHours,2); eq(projectResult.financials.chargeOutSpend,360.5); eq(projectResult.financials.internalCost,159);
eq(projectResult.financials.remainingBudget,-360.5); eq(projectResult.financials.remainingHours,-2);
eq(build([]).financials.internalCost,216.3,'No-source entries preserve stored manual cost');
eq(Array.from(build([]).financials.legacyUnattributedAllocationIds),[A]);

const reportSource = await read('app/api/project-health-report/route.js');
const many = Array.from({length:2005},(_,n)=>entry(1000+n,{hours:0.25,custom_data:stamped(STAFF,{km:0}),budget_source_id:null,budget_allocation_id:null}));
const reportAdmin = mockAdmin({...tables([entry(20),unassigned]),projects:[project,{...project,id:N,budget_dollars:0,budget_hours:0}],project_tracker_entries:[entry(20),unassigned,...many.map(e=>({...e,project_id:N}))]});
let response = await routeContext(reportSource,access(reportAdmin)).GET(new Request('https://fixture.test/report'));
eq(response.status,200); eq(response.headers.get('cache-control'),'private, no-store');
let report = await response.json();
eq(report.rows[0].usedHours,4); eq(report.rows[0].currentSpend,721); eq(report.rows[0].deliveryCost,318);
eq(report.rows[0].lifetimeInternalCost,318); eq(report.costBasisPercent,null);
eq(report.rows[1].usedHours,501.25); eq(report.rows[1].currentSpend,87217.5); eq(report.rows[1].deliveryCost,37593.75);
eq(report.rows[1].remainingHours,-501.25);
eq(reportAdmin.calls.filter(call=>call.table==='project_tracker_entries').length,3,'Report loads every page');
response = await routeContext(reportSource,access(reportAdmin,false)).GET(new Request('https://fixture.test/report'));
eq(response.status,403); eq(response.headers.get('cache-control'),'private, no-store');

// Card API: exact optional-key contract and unchanged microsecond CAS.
const cardSource = await read('app/api/admin/project-charge-rates/route.js');
const ratesBody = {project_manager_rate:163,senior_ecologist_rate:207,ecologist_rate:174};
async function cardApi(rates = ratesBody, saved = card, isAdmin = true, method='POST') {
  const mocked = mockAdmin({projects:[project],project_charge_rates:[saved],project_role_rates:[]});
  const from=mocked.from;
  mocked.from=(table)=>{
    if(table!=='project_charge_rates') return from(table);
    const q={select:()=>q,eq:()=>q,limit:()=>q,maybeSingle:async()=>({data:saved,error:null})};return q;
  };
  const calls=[]; mocked.rpc=async(name,args)=>{calls.push({name,args});return {data:saved,error:null};};
  const ctx=routeContext(cardSource,access(mocked,isAdmin));
  const response=await ctx[method](new Request(`https://fixture.test/rates?projectId=${P}`,{method,headers:{'content-type':'application/json'},...(method==='POST'?{body:JSON.stringify({projectId:P,rates,expectedUpdatedAt:time})}:{})}));
  eq(response.headers.get('cache-control'),'private, no-store');
  return {response,calls,body:await response.json()};
}
for(const mileage of [null,0,1.25]) {
  const result=await cardApi({...ratesBody,mileage_rate:mileage},{...card,mileage_rate:mileage});
  eq(result.response.status,200); eq(result.calls[0].args.p_rates.Mileage,mileage); eq(result.calls[0].args.p_expected_updated_at,time);
}
let cardResult=await cardApi(); eq(cardResult.response.status,200); eq(Object.hasOwn(cardResult.calls[0].args.p_rates,'Mileage'),false);
for(const invalid of [-1,1.234,'1.25',true,'',{}]) { cardResult=await cardApi({...ratesBody,mileage_rate:invalid}); eq(cardResult.response.status,400);eq(cardResult.calls.length,0); }
for(const invalid of [{...card,mileage_rate:-1},{...card,project_id:N},{...card,confirmed_at:'bad'},{...card,updated_at:null},{...card,confirmed_by:'bad'}]) {
  for(const method of ['GET','POST']) eq((await cardApi(ratesBody,invalid,true,method)).response.status,500);
}
eq((await cardApi(ratesBody,card,false)).response.status,403);

// Import API executes real preview and commit; current rate is returned explicitly.
const importSource = await read('app/api/admin/project-tracker-timesheet-import/route.js');
const importUrl = dataUrl(await read('lib/projectTimesheetImport.js'));
const importHelpers = await import(importUrl);
const reconciliation = await import(dataUrl((await read('lib/projectTimesheetReconciliation.js')).replace('"./projectTimesheetImport.js"',JSON.stringify(importUrl))));
const xlsx = createRequire(import.meta.url)('xlsx');
async function importApi(mileage, action='preview', reviewedRate=mileage) {
  const m=mockAdmin({...tables([]),projects:[{...project,client_name:'Fixture'}],project_charge_rates:[{...card,mileage_rate:mileage}],
    project_budget_allocations:[{...allocation,allocation_name:'General Project Management',allocation_code:'GENERAL'}],project_tracker_templates:[],quote_draft_projects:[]});
  m.auth.admin.listUsers=async()=>({data:{users:[{id:STAFF,email:'staff@example.test',user_metadata:{full_name:'Fixture staff'}}]},error:null});
  const calls=[];m.rpc=async(name,args)=>{calls.push({name,args});return {data:{success:true,importedCount:args.p_entries.length,labourCharge:348,mileageCharge:12.5,totalCharge:360.5},error:null};};
  const ctx=routeContext(importSource,access(m),{...importHelpers,...reconciliation,XLSX:xlsx,createHash,randomUUID:()=>uuid(900)});
  const body={action,fileName:'fixture.csv',rows:[{sourceRow:2,staffName:'Fixture staff',staffUserId:STAFF,projectId:P,projectName:project.name,workDate:'2026-11-20',hours:2,km:10,activityCategory:'External consultation',comments:'Fixture only',chargeRate:174,mileageChargeRate:reviewedRate}]};
  const response=await ctx.POST(new Request('https://fixture.test/import',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}));
  return {response,body:await response.json(),calls};
}
let preview=await importApi(null); eq(preview.response.status,200,JSON.stringify(preview.body));eq(preview.body.rows[0].isImportable,false);assert(preview.body.rows[0].issues.some(e=>e.code==='missing_mileage_rate'));
preview=await importApi(1.25);eq(preview.body.rows[0].labourChargeAmount,348);eq(preview.body.rows[0].mileageChargeAmount,12.5);eq(preview.body.rows[0].chargeAmount,360.5);
eq(preview.body.summary.totalLabourCharge,348);eq(preview.body.summary.totalMileageCharge,12.5);
let imported=await importApi(1.25,'import',1);eq(imported.response.status,409);eq(imported.calls.length,0);
imported=await importApi(1.25,'import',1.25);eq(imported.response.status,201);eq(imported.calls[0].args.p_entries[0].custom_data.import_expected_mileage_rate,1.25);
imported=await importApi(0,'import',0);eq(imported.response.status,201);eq(imported.calls[0].args.p_entries[0].custom_data.import_expected_mileage_rate,0);

// Real SQL end-to-end, including additive migration reapplication and guard
// equality against the base. Fixture data is created only inside this PGlite DB.
const db = new PGlite();
const query=(sql,args=[])=>db.query(sql,args);
const one=async(sql,args=[])=>(await query(sql,args)).rows[0];
let serial=300;
const row=(date,km=10,assigned=true,staff=STAFF,patch={})=>({project_id:P,budget_source_id:assigned?S:null,budget_allocation_id:assigned?A:null,staff_user_id:staff,
  work_date:date,hours:2,activity_category:'General Project Management',activity_information:'Distinct isolated work '+date,
  custom_data:{km,budget_assignment:assigned?'assigned':'unassigned',import_source_row:2,import_file_name:'fixture.csv',import_source_task:'External consultation',import_source_notes:'Raw notes',
    import_expected_charge_rate:cardRoles[charge.trackerChargeRole(staff)],import_expected_mileage_rate:1.25,import_charge_role:charge.trackerChargeRole(staff),
    import_duplicate_review:{decision:'new',expected_entries:[],file_overlap_rows:[]},import_fingerprint:createHash('sha256').update(date+String(serial++)).digest('hex'),...patch}});
const run=(entries,who=ACTOR)=>one('select public.ec_import_weekly_timesheets_reviewed($1,$2,$3::jsonb) as result',[who,uuid(serial++),JSON.stringify(entries)]).then(r=>r.result);
const save=(rates,stamp=null,p=P)=>one('select public.ec_save_project_charge_rates($1,$2,$3,$4::jsonb) as card',[p,ACTOR,stamp,JSON.stringify(rates)]).then(r=>r.card);
const state=async()=>({entries:(await query('select * from project_tracker_entries order by id')).rows,allocations:(await query('select * from project_budget_allocations order by id')).rows,events:(await query('select * from portal_events order by id')).rows,audits:(await query('select * from admin_audit_log order by id')).rows});
async function atomicReject(rows,pattern) {const before=await state();await assert.rejects(run(rows),pattern);eq(await state(),before);}
try {
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;
    create table auth.users(id uuid primary key,deleted_at timestamptz,banned_until timestamptz,email text);
    create table portal_visibility_overrides(user_id uuid,resource_key text,is_visible boolean);
    create table projects(id uuid primary key,name text,status text,deleted_at timestamptz,default_hourly_rate numeric,budget_dollars numeric,budget_hours numeric,start_date text,created_by uuid);
    create table project_allocations(project_id uuid,staff_user_id uuid,hourly_rate numeric);
    create table portal_events(id uuid primary key default gen_random_uuid(),recipient_id uuid,event_type text,severity text,title text,body text,href text,source_table text,source_id uuid);
    create table admin_audit_log(id uuid primary key default gen_random_uuid(),actor_id uuid,action text,entity_type text,entity_id uuid,project_id uuid,resource_key text,before_data jsonb,after_data jsonb,reason text);
    create function project_closeout_can_manage(uuid) returns boolean language sql as $$select $1='${ACTOR}'::uuid$$;`);
  for(const migration of ['2026-08-28-project-tracker-foundation.sql','2026-11-05-project-budget-service-periods.sql','2026-11-19-timesheet-import-atomic.sql']) await db.exec(await read('sql/'+migration));
  await db.exec(`insert into auth.users(id,email) values('${ACTOR}','admin@example.test'),('${STAFF}','staff@example.test'),('${SENIOR}','senior@example.test'),('${MANAGER}','manager@example.test');
    insert into projects(id,name,status,default_hourly_rate) values('${P}','Fixture','active',111),('${N}','No budget','active',111);
    insert into project_budget_sources(id,project_id,source_code,source_name,source_type,approval_status) values('${S}','${P}','ORG','Original','original','approved');
    insert into project_budget_allocations(id,project_id,budget_source_id,allocation_code,allocation_name,status,staff_visible) values('${A}','${P}','${S}','GENERAL','General Project Management','active',true);
    insert into project_allocations values('${P}','${STAFF}',130);
    insert into project_tracker_entries(id,project_id,budget_source_id,budget_allocation_id,staff_user_id,work_date,activity_category,activity_information,hours,status,custom_data)
      values('${LEGACY}','${P}','${S}','${A}','${STAFF}','2026-11-01','General Project Management','Legacy',1,'completed','{"km":10,"internal_hourly_rate_snapshot":999,"internal_cost_stamped":true,"internal_role":"Ecologist","mileage_internal_rate_snapshot":999,"mileage_internal_stamped":true}');`);
  for(const migration of ['2026-11-20-tracker-role-charge-rates.sql','2026-11-20-timesheet-reconciliation.sql','2026-11-24-timesheet-unassigned-import.sql']) await db.exec(await read('sql/'+migration));
  const guard=(await one("select pg_get_functiondef('public.check_project_tracker_entry_service_period()'::regprocedure) as body")).body;
  const wrapper=(await one("select pg_get_functiondef('public.ec_import_weekly_timesheets(uuid,uuid,jsonb)'::regprocedure) as body")).body;
  const beforeMigration=await state();
  const migration=await read('sql/2026-11-24-tracker-role-mileage-costs.sql');
  await db.exec(migration);await db.exec(migration);
  eq(await state(),beforeMigration,'Migration never rewrites history');
  eq((await one("select pg_get_functiondef('public.check_project_tracker_entry_service_period()'::regprocedure) as body")).body,guard);
  eq((await one("select pg_get_functiondef('public.ec_import_weekly_timesheets(uuid,uuid,jsonb)'::regprocedure) as body")).body,wrapper);
  eq((await one("select count(*) as n from pg_policies where tablename='project_tracker_entries'")).n,0);
  let saved=await save(cardRoles);eq(saved.mileage_rate,null);
  await atomicReject([row('2026-11-02')],/Mileage charge rate/);
  saved=await save({...cardRoles,Mileage:0},saved.updated_at);eq(saved.mileage_rate,0);
  let result=await run([row('2026-11-02',10,true,STAFF,{import_expected_mileage_rate:0})]);eq(result.mileageCharge,0);eq(result.internalCost,159);
  saved=await save({...cardRoles,Mileage:1.25},saved.updated_at);eq(saved.mileage_rate,1.25);
  saved=await save(cardRoles,saved.updated_at);eq(saved.mileage_rate,1.25,'Three-field SQL caller preserves mileage');
  await assert.rejects(save({...cardRoles,Mileage:1.5},time),/changed concurrently/);
  await assert.rejects(save({...cardRoles,Mileage:-1},saved.updated_at),/Mileage/);
  result=await run([row('2026-11-03'),row('2026-11-04',10,false,SENIOR),row('2026-11-05',10,false,MANAGER)]);
  eq(result.labourCharge,1088);eq(result.mileageCharge,37.5);eq(result.totalCharge,1125.5);eq(result.internalCost,479);
  eq(result.unassignedCharge,765);eq(result.unassignedLabourCharge,740);eq(result.unassignedMileageCharge,25);eq(result.unassignedInternalCost,320);
  let funded=await one('select hours_consumed,charge_out_spend,internal_cost from project_budget_allocations where id=$1',[A]);
  eq(funded,{hours_consumed:'5.00',charge_out_spend:'838.50',internal_cost:'402.00'});
  let stored=(await one("select custom_data from project_tracker_entries where work_date='2026-11-03'")).custom_data;
  eq(stored.internal_hourly_rate_snapshot,75);eq(stored.mileage_internal_rate_snapshot,0.90);eq(stored.mileage_charge_rate_snapshot,1.25);
  for(const staff of [STAFF,SENIOR,MANAGER]) eq(Number((await one('select public.ec_tracker_internal_hourly_rate($1) as rate',[staff])).rate),charge.trackerInternalHourlyRate(staff));
  for(const e of (await query('select project_id,staff_user_id,hours,custom_data from project_tracker_entries')).rows) {
    const result=await one('select public.ec_tracker_entry_charge_total($1,$2,$3,$4::jsonb) as charge,public.ec_tracker_entry_internal_cost($2,$3,$4::jsonb) as cost',[e.project_id,e.staff_user_id,e.hours,JSON.stringify(e.custom_data)]);
    eq(Number(result.charge),charge.trackerEntryChargeTotal(e,null,e.staff_user_id===STAFF?130:111));eq(Number(result.cost),charge.trackerEntryInternalCost(e));
  }
  saved=await save({...cardRoles,Mileage:2},saved.updated_at);
  await atomicReject([row('2026-11-06'),row('2026-11-07')],/Mileage charge rate/);
  await atomicReject([row('2026-11-06',10,true,STAFF,{import_expected_mileage_rate:2,import_expected_charge_rate:999})],/charge rate changed/);
  await query("update project_tracker_entries set hours=3,custom_data=custom_data||'{\"mileage_charge_rate_snapshot\":999,\"internal_hourly_rate_snapshot\":999,\"charge_rate_snapshot\":999,\"mileage_charge_stamped\":false}'::jsonb where work_date='2026-11-03'");
  stored=(await one("select custom_data from project_tracker_entries where work_date='2026-11-03'")).custom_data;
  eq(stored.mileage_charge_rate_snapshot,1.25);eq(stored.internal_hourly_rate_snapshot,75);eq(stored.charge_rate_snapshot,174);eq(stored.mileage_charge_stamped,true);
  await query("update project_tracker_entries set hours=2,custom_data=custom_data||'{\"charge_rate_stamped\":true,\"charge_rate_snapshot\":999,\"mileage_charge_stamped\":true,\"mileage_charge_rate_snapshot\":999}'::jsonb where id=$1",[LEGACY]);
  stored=(await one('select custom_data from project_tracker_entries where id=$1',[LEGACY])).custom_data;
  eq(Object.hasOwn(stored,'mileage_charge_stamped'),false);eq(Object.hasOwn(stored,'charge_rate_stamped'),false);eq(Object.hasOwn(stored,'internal_cost_stamped'),false);
  eq(Number((await one('select public.ec_tracker_entry_charge_total(project_id,staff_user_id,hours,custom_data) as total from project_tracker_entries where id=$1',[LEGACY])).total),260);
  await assert.rejects(query("update project_tracker_entries set staff_user_id=$1 where work_date='2026-11-03'",[MANAGER]),/identity cannot be changed/);
  const correctionRows=(await query('select * from project_tracker_entries')).rows;
  const mock=mockAdmin({...tables(correctionRows),project_charge_rates:[{...card,mileage_rate:2}],project_budget_allocations:[{...allocation,...funded}]});
  const refreshed=await refresh.refreshProjectTrackerAllocation(access(mock),P,A);
  const sqlTotals=await one('select sum(hours) as hours,sum(public.ec_tracker_entry_charge_total(project_id,staff_user_id,hours,custom_data)) as charge,sum(public.ec_tracker_entry_internal_cost(staff_user_id,hours,custom_data)) as cost from project_tracker_entries where budget_allocation_id=$1',[A]);
  eq(refreshed,{hoursConsumed:Number(sqlTotals.hours),chargeOutSpend:Number(sqlTotals.charge),internalCost:Number(sqlTotals.cost)},'Correction SQL/JS totals agree');
  await query("delete from project_tracker_entries where work_date='2026-11-03'");
  const deletedRows=(await query('select * from project_tracker_entries')).rows;
  const afterDelete=actual.summarizeTrackerUnassignedActuals(deletedRows);
  eq(afterDelete.chargeOutSpend,765);eq(afterDelete.internalCost,320);
  const policies=(await query("select has_function_privilege('authenticated','public.ec_tracker_entry_internal_cost(uuid,numeric,jsonb)','execute') as allowed")).rows[0];eq(policies.allowed,false);
  saved=await save({...cardRoles,Mileage:null},saved.updated_at);eq(saved.mileage_rate,null);
  await atomicReject([row('2026-11-09')],/Mileage charge rate/);
  await db.exec("alter table portal_events add constraint fixture_failure check(false) not valid;");
  await atomicReject([row('2026-11-10',0,true),row('2026-11-11',0,false)],/fixture_failure/);
  await db.exec('alter table portal_events drop constraint fixture_failure;');
  await query("update auth.users set banned_until=now()+interval '1 day' where id=$1",[ACTOR]);
  await assert.rejects(save(cardRoles,saved.updated_at),/active administrator/);
} finally {await db.close();}

const swc=createRequire(import.meta.url)('next/dist/build/swc');
for(const file of ['components/ProjectChargeRates.js','app/api/admin/project-tracker/route.js','app/api/project-health-report/route.js']) await swc.transform(await read(file),{filename:file,jsc:{parser:{syntax:'ecmascript',jsx:true},target:'es2022'},module:{type:'commonjs'}});
console.log(`Tracker role/mileage engine PASS: ${checks} assertions; fixed 81/75/70 + 0.90/km, role/helper parity, legacy zero-mileage revenue, optional/null/zero/old-three-field cards and CAS, authoritative SQL stamps/corrections, mixed assigned/unassigned costs, SQL/shared refresh parity, stale-rate atomic rollback, paginated/no-budget project reports, private financial APIs, no-entry manual-cost preservation and migration idempotence. No live services or writes.`);
