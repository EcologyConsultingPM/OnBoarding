import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
const require = createRequire(import.meta.url);
const { PGlite } = require('@electric-sql/pglite');
const db = new PGlite();
await db.exec(`
create role anon; create role authenticated; create role service_role;
create schema auth;
create table auth.users(id uuid primary key,deleted_at timestamptz,banned_until timestamptz,email text);
create table public.portal_visibility_overrides(user_id uuid,resource_key text,is_visible boolean);
create table public.projects(id uuid primary key,name text,status text,deleted_at timestamptz,default_hourly_rate numeric);
create table public.project_budget_sources(id uuid primary key,project_id uuid,source_type text,approval_status text,service_period_start date,service_period_end date);
create table public.project_budget_allocations(id uuid primary key,project_id uuid,budget_source_id uuid,allocation_name text,allocation_code text,status text,staff_visible boolean,hours_consumed numeric,charge_out_spend numeric,internal_cost numeric,updated_by uuid,updated_at timestamptz);
create table public.project_allocations(project_id uuid,staff_user_id uuid,hourly_rate numeric);
create table public.project_tracker_entries(id uuid primary key default gen_random_uuid(),project_id uuid,budget_source_id uuid,budget_allocation_id uuid,staff_user_id uuid,work_date date,activity_category text,activity_information text,hours numeric,status text,notable_issues text,custom_data jsonb not null default '{}',created_at timestamptz default now());
create table public.portal_events(id uuid default gen_random_uuid(),recipient_id uuid,event_type text,severity text,title text,body text,href text,source_table text,source_id uuid);
create table public.admin_audit_log(actor_id uuid,action text,entity_type text,entity_id uuid,resource_key text,after_data jsonb,reason text);
create function public.project_closeout_can_manage(uuid) returns boolean language sql as $$ select $1='00000000-0000-4000-8000-000000000001'::uuid $$;
`);
const migration = await readFile(new URL('../sql/2026-11-19-timesheet-import-atomic.sql', import.meta.url),'utf8');
await db.exec(migration);
// The migration must be safe on the live schema where admin provenance already exists.
await db.exec(migration);
const actor='00000000-0000-4000-8000-000000000001';
const staff='00000000-0000-4000-8000-000000000002';
const project='00000000-0000-4000-8000-000000000003';
const source='00000000-0000-4000-8000-000000000004';
const allocation='00000000-0000-4000-8000-000000000005';
await db.exec(`insert into auth.users(id) values('${actor}'),('${staff}');
update auth.users set email='admin@example.test' where id='${actor}';
insert into projects values('${project}','Creek survey','active',null,100);
insert into project_budget_sources values('${source}','${project}','original','approved',null,null);
insert into project_budget_allocations values('${allocation}','${project}','${source}','Field survey','FIELD_SURVEY','active',true,0,0,0,null,null);
insert into project_allocations values('${project}','${staff}',150);`);
let serial=10;
const batch=()=>`00000000-0000-4000-8000-${String(serial++).padStart(12,'0')}`;
const entry=(date,hours=7.5,comments='Creek assessment',km=42)=>({project_id:project,budget_source_id:source,budget_allocation_id:allocation,staff_user_id:staff,work_date:date,activity_category:'Field survey',activity_information:comments,hours,
custom_data:{km,import_source_row:4,import_file_name:'weekly.csv',import_fingerprint:createHash('sha256').update([date,hours,comments,km].join('|')).digest('hex')}});
const run=(entries,who=actor)=>db.query('select public.ec_import_weekly_timesheets($1,$2,$3::jsonb) as result',[who,batch(),JSON.stringify(entries)]);
let result=(await run([entry('2026-11-19')])).rows[0].result;
assert.equal(result.importedCount,1); assert.equal(result.totalHours,7.5); assert.equal(result.totalKilometres,42); assert.equal(result.notificationsCreated,1);
let totals=(await db.query('select hours_consumed,charge_out_spend,internal_cost from project_budget_allocations')).rows[0];
assert.equal(Number(totals.hours_consumed),7.5); assert.equal(Number(totals.charge_out_spend),1125); assert.equal(Number(totals.internal_cost),675);
assert.equal((await db.query('select entered_by_admin_id from project_tracker_entries')).rows[0].entered_by_admin_id,actor);
await assert.rejects(run([entry('2026-11-19')]), /identical entry/i);
await assert.rejects(run([entry('2026-11-20'),entry('2026-11-20')]), /identical entry/i);
assert.equal(Number((await db.query('select count(*) as count from project_tracker_entries')).rows[0].count),1,'Within-file duplicate must roll back the first inserted row.');
await assert.rejects(run([entry('2026-11-20')],staff), /active administrator/);
await db.exec(`insert into portal_visibility_overrides values('${actor}','admin.projects.tracker',false);`);
await assert.rejects(run([entry('2026-11-20')]), /import access is disabled/);
await db.exec('delete from portal_visibility_overrides;');
// Atomic notifications: forced event failure must roll back entries, totals and audit.
await db.exec(`alter table portal_events add constraint forced_notification_failure check(false) not valid;`);
await assert.rejects(run([entry('2026-11-21')]), /forced_notification_failure/);
assert.equal(Number((await db.query('select count(*) as count from project_tracker_entries')).rows[0].count),1);
assert.equal(Number((await db.query('select hours_consumed from project_budget_allocations')).rows[0].hours_consumed),7.5);
await db.exec('alter table portal_events drop constraint forced_notification_failure;');
// Simultaneous identical submissions cannot both be accepted.
const concurrent = await Promise.allSettled([run([entry('2026-11-22')]),run([entry('2026-11-22')])]);
assert.equal(concurrent.filter(r=>r.status==='fulfilled').length,1);
assert.equal(concurrent.filter(r=>r.status==='rejected').length,1);
await db.exec(`insert into project_tracker_entries(project_id,budget_source_id,budget_allocation_id,staff_user_id,work_date,activity_category,activity_information,hours,status,custom_data)
values('${project}','${source}','${allocation}','${staff}','2026-11-24','Field survey','Legacy row',1,'completed','{"km":"unknown"}');`);
assert.equal((await run([entry('2026-11-24',1,'Legacy row',12)])).rows[0].result.importedCount,1,'Malformed legacy kilometre metadata must not cause an unrelated valid row to fail.');
assert.equal((await db.query("select public.ec_timesheet_import_text('résumé') as key")).rows[0].key,'resume','SQL and preview must remove combining accents identically.');
await db.exec(`insert into project_tracker_entries(project_id,budget_source_id,budget_allocation_id,staff_user_id,work_date,activity_category,activity_information,hours,status,custom_data)
values('${project}','${source}','${allocation}','${staff}','2026-11-25','Field survey','résumé',1,'completed','{"km":1.005}');`);
await assert.rejects(run([entry('2026-11-25',1,'resume',1.01)]),/identical entry/,'A fingerprint-free staff row must be rechecked with the same text and decimal semantics at commit.');
await db.exec(`update project_budget_sources set service_period_start='2026-11-01',service_period_end='2026-11-30';`);
await assert.rejects(run([entry('2026-12-01')]), /outside.*period/);
await db.exec(`update projects set status='archived';`);
await assert.rejects(run([entry('2026-11-23')]), /Project or budget allocation changed/);
await db.close();
console.log('Atomic weekly timesheet import passed: provenance, totals, notifications, duplicate/race guards, authorization, dates, and rollback.');
