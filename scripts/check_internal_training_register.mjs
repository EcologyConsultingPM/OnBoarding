import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
const root = new URL('../', import.meta.url);
const read = path => readFile(new URL(path, root), 'utf8');
const url = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const model = await import(url(await read('lib/internalTrainingRegister.js')));
const id = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const actor = id(1), worker = id(2), primary = id(3), linked = id(4);
const staffValues = { staff_name: 'Test Worker', position: 'Ecologist', employment_type: 'full_time' };
const trainingValues = { staff_id: id(10), qualification: 'Test training', training_organisation: 'Test provider', completion_date: '2026-11-12', expiry_date: '' };
assert.deepEqual(model.EMPLOYMENT_TYPES.map(x => x.value), ['full_time','part_time','casual']);
assert.equal(model.getRegisterToday('2026-11-11T13:30:00Z'), '2026-11-12');
assert.equal(model.getRegisterToday('2026-06-01T13:30:00Z'), '2026-06-01');
assert.equal(model.getRegisterToday('2026-06-01T14:30:00Z'), '2026-06-02');
for (const [date,key,days] of [['2026-11-11','expired',-1],['2026-11-12','amber',0],['2026-11-26','amber',14],['2026-11-27','yellow',15],['2026-12-12','yellow',30],['2026-12-13','current',31],[null,'no_expiry',null]]) {
  const result = model.trainingExpiry(date,'2026-11-12'); assert.equal(result.key,key); assert.equal(result.daysRemaining,days);
}
assert.equal(model.trainingExpiry('2026-10-05','2026-10-03').daysRemaining,2, 'Sydney DST must not change civil-date arithmetic');
assert.equal(model.normaliseRegisterStaff(staffValues).value.staff_name, 'Test Worker');
assert.equal(model.normaliseRegisterStaff({ ...staffValues, staff_name: '<b>test</b>' }).value,null);
assert.equal(model.normaliseRegisterStaff({ ...staffValues, employment_type:'guessed' }).value,null);
assert.equal(model.normaliseRegisterStaff({ ...staffValues, linked_user_id:'invalid' }).value,null);
assert.equal(model.normaliseRegisterStaff({ ...staffValues, metadata:{} }).value,null);
assert.equal(model.normaliseTrainingRecord(trainingValues).value.expiry_date,null);
for (const values of [{ ...trainingValues, completion_date:'2026-02-30' }, { ...trainingValues, expiry_date:'2026-11-11' }, { ...trainingValues, qualification:'x'.repeat(201) }, { ...trainingValues, training_organisation:'<script>' }, { ...trainingValues, completion_date:null }]) assert.equal(model.normaliseTrainingRecord(values).value,null);
const summary = model.summariseTrainingRecords([{ id:id(20),staff_id:id(10),expiry_date:'2026-11-12' },{ id:id(21),staff_id:id(10),expiry_date:'2026-11-11' },{ id:id(22),staff_id:id(10),expiry_date:'2026-11-27' },{ id:id(23),staff_id:id(10),archived_at:'archived',expiry_date:'2026-11-11' },{ id:id(24),staff_id:id(11),expiry_date:'2026-11-11' }],[{ id:id(10),staff_name:'A' },{ id:id(11),staff_name:'B',archived_at:'archived' }],'2026-11-12');
assert.deepEqual([summary.total,summary.expired,summary.dueWithin14,summary.dueWithin30,summary.alerts.length],[3,1,1,1,3]);
console.log('Model checks passed: Sydney dates/DST, all expiry boundaries, required plain fields and active-only summary.');

let session = true, isAdmin = true, visible = true, databaseActor = true, storageError = null, mutationError = null, duplicate = false;
const queries = [], permissions = [], rpcCalls = [], health = [], listPages = [];
const mockRow = { id:id(10),...staffValues,version:1 };
const admin = {
  from(table) {
    const entry = { table,filters:[],orders:[] }; queries.push(entry);
    const q = {
      select(columns,options) { assert(!columns.includes('*')); entry.columns=columns; entry.options=options; return q; },
      is(k,v) { entry.filters.push([k,v]); return q; }, eq(k,v) { entry.filters.push([k,v]); return q; },
      order(k,v) { entry.orders.push([k,v]); return q; }, range(a,b) { entry.range=[a,b]; return q; },
      async insert(values) { assert.equal(table, 'system_health_runs'); assert(Number.isFinite(Date.parse(values.checked_at)), 'Production health logs require checked_at.'); health.push(values); return { error:null }; },
      then(resolve,reject) { return Promise.resolve({ data:[{ ...mockRow,internal_register_staff:{staff_name:'Test Worker'} }],count:201,error:storageError }).then(resolve,reject); },
    }; return q;
  },
  async rpc(name,params) { rpcCalls.push({name,params}); return name==='internal_register_can_manage' ? {data:databaseActor} : {data:{row:mockRow,duplicate},error:mutationError}; },
  auth:{ admin:{ async listUsers(options) { listPages.push(options); return {data:{users:Array.from({length:200},(_,i) => ({id:id(options.page*200+i),email:'fixture@ecologyconsulting.au',user_metadata:{full_name:'Account fixture',phone:'PRIVATE_PHONE',position:'PRIVATE_POSITION'}}))}}; } } },
};
globalThis.__irTest = { model, admin, access:() => session ? {user:{id:actor},isAdmin,admin} : {error:Response.json({error:'No session'},{status:401})}, permission:(_access,key) => {permissions.push(key);return visible ? null : Response.json({error:'Denied'},{status:403});}, email:value => value?.endsWith('@ecologyconsulting.au'), person:user => ({id:user.id,name:user.user_metadata?.full_name || user.email}) };
const routeSource = (await read('app/api/internal-registers/route.js'))
  .replace(/import \{ requireSession \} from "[^"]+";/, 'const requireSession = async () => globalThis.__irTest.access();')
  .replace(/import \{ requirePortalResource \} from "[^"]+";/, 'const requirePortalResource = async (...args) => globalThis.__irTest.permission(...args);')
  .replace(/import \{ isEcologyStaffEmail, staffDirectoryRecord \} from "[^"]+";/, 'const isEcologyStaffEmail = globalThis.__irTest.email; const staffDirectoryRecord = globalThis.__irTest.person;')
  .replace(/import \{ REGISTER_UUID, normaliseRegisterStaff, normaliseTrainingRecord, normaliseRegisterText \} from "[^"]+";/, 'const { REGISTER_UUID, normaliseRegisterStaff, normaliseTrainingRecord, normaliseRegisterText } = globalThis.__irTest.model;');
const route = await import(url(routeSource));
const req = (query='',body) => new Request(`https://isolated.test/api/internal-registers${query}`,body===undefined ? {} : {method:'POST',body:typeof body==='string' ? body : JSON.stringify(body)});
const body = {entity:'staff',action:'create',values:staffValues,mutation_key:id(100)};
session=false; assert.equal((await route.GET(req())).status,401);assert.equal((await route.POST(req('',body))).status,401);session=true;
isAdmin=false;assert.equal((await route.GET(req())).status,403);isAdmin=true;
visible=false;assert.equal((await route.POST(req('',body))).status,403);visible=true;
databaseActor=false;assert.equal((await route.GET(req())).status,403);databaseActor=true;
for (const query of ['?entity=bad','?limit=101','?limit=0','?offset=-1','?offset=1000001','?includeArchived=yes','?staff_id=bad']) assert.equal((await route.GET(req(query))).status,400);
let response = await route.GET(req('?entity=training&limit=100&offset=100&staff_id='+id(10)));
assert.equal(response.status,200);let result=await response.json();assert.equal(result.total,201);assert.equal(result.hasMore,true);assert.equal(result.rows[0].internal_register_staff,undefined);
assert.deepEqual(queries.at(-1).range,[100,199]);assert(queries.at(-1).orders.some(([key]) => key==='internal_register_staff(staff_name)'));
assert.deepEqual(permissions.slice(-2),['admin.internal_registers','admin.internal_registers.training']);
response=await route.GET(req('?entity=directory&limit=100&offset=1900'));result=await response.json();assert.equal(result.total,2000);assert.equal(result.rows.length,100);assert.equal(result.hasMore,false);assert.equal(listPages.length,10);assert.deepEqual(Object.keys(result.rows[0]).sort(),['id','name']);assert(!JSON.stringify(result).includes('PRIVATE_'));
assert.equal((await route.POST(req('',body))).status,201);duplicate=true;assert.equal((await route.POST(req('',body))).status,200);duplicate=false;
assert.equal((await route.POST(req('',{...body,action:'archive',id:id(10),expected_version:1,values:{}}))).status,400);
assert.equal((await route.POST(req('',{...body,action:'update',id:id(10),expected_version:0}))).status,400);
assert.equal((await route.POST(req('',{...body,values:{...staffValues,staff_name:'<b>'}}))).status,400);
assert.equal((await route.POST(req('','{'))).status,400);assert.equal((await route.POST(req('','x'.repeat(50001)))).status,413);
mutationError={message:'IR_STAFF_HAS_TRAINING: PRIVATE_DB_DETAIL'};assert.equal((await route.POST(req('',body))).status,409);assert.equal(health.length,0);mutationError=null;
storageError={code:'42P01',message:'PRIVATE_STAFF_NAME'};response=await route.GET(req());assert.equal(response.status,503);assert(!JSON.stringify(await response.json()).includes('PRIVATE'));assert.deepEqual(health.at(-1).details,{error_code:'IR_UNAVAILABLE',operation:'read'});storageError=null;
console.log('Mocked API checks passed: authentication/resource/actor enforcement, bounded paging/directory, no metadata disclosure, payload bound, mutation validation and sanitised health errors.');

const require = createRequire(import.meta.url);
let PGlite;
try { ({PGlite}=require('@electric-sql/pglite')); }
catch { ({PGlite}=require(process.env.PGLITE_PATH || '/home/ubuntu/tmp/closeout-db-test/node_modules/@electric-sql/pglite')); }
const db = new PGlite();
await db.exec(`create role anon; create role authenticated; create role service_role bypassrls; create schema auth;
create table auth.users(id uuid primary key,email text,deleted_at timestamptz,banned_until timestamptz,raw_user_meta_data jsonb default '{}');
create table public.admin_emails(email text primary key);
create table public.portal_visibility_overrides(user_id uuid,resource_key text,is_visible boolean);
create table public.admin_audit_log(id uuid primary key default gen_random_uuid(),actor_id uuid references auth.users(id),action text,entity_type text,entity_id uuid,resource_key text,before_data jsonb,after_data jsonb,reason text,created_at timestamptz default now());`);
const migration=await read('sql/2026-11-12-internal-training-register.sql');
await db.exec(migration);await db.exec(migration);
assert.equal((await db.query('select count(id)::int n from internal_register_staff limit 1')).rows[0].n,0);
assert.equal((await db.query('select count(id)::int n from internal_training_records limit 1')).rows[0].n,0);
await db.query('insert into auth.users(id,email) values($1,$2),($3,$4),($5,$6),($7,$8)',[actor,'admin@ecologyconsulting.au',worker,'staff@ecologyconsulting.au',primary,'aaron.dooley@ecologyconsulting.au',linked,'linked@ecologyconsulting.au']);
await db.query('insert into public.admin_emails(email) values($1)',['admin@ecologyconsulting.au']);
const scalar=async (sql,params=[]) => (await db.query(sql,params)).rows[0];
const can=async user => (await scalar('select public.internal_register_can_manage($1) allowed limit 1',[user])).allowed;
assert.equal(await can(actor),true);assert.equal(await can(worker),false);assert.equal(await can(primary),true);
for (const key of ['admin.internal_registers','admin.internal_registers.training']) {
  await db.query('insert into portal_visibility_overrides(user_id,resource_key,is_visible) values($1,$2,false),($3,$2,false)',[actor,key,primary]);
  assert.equal(await can(actor),false);assert.equal(await can(primary),true);
  await db.query('delete from portal_visibility_overrides where resource_key=$1',[key]);
}
for (const statement of ["banned_until=now()+interval '1 day'","deleted_at=now()","raw_user_meta_data='{\"staff_directory_active\":false}'::jsonb"]) {
  await db.query(`update auth.users set ${statement} where id=$1`,[actor]);assert.equal(await can(actor),false);
  await db.query("update auth.users set banned_until=null,deleted_at=null,raw_user_meta_data='{}' where id=$1",[actor]);
}
let key=200;
const mutate = async (entity,action,values={},recordId=null,version=null,reason=null,mutationKey=id(key++),user=actor) => (await scalar('select public.internal_register_mutate($1,$2,$3,$4,$5,$6::jsonb,$7,$8) result limit 1',[user,entity,action,recordId,version,JSON.stringify(values),reason,mutationKey])).result;
const rejects = (promise,code) => assert.rejects(promise,error => error.message.includes(code));
await rejects(mutate('staff','create',staffValues,null,null,null,id(199),worker),'IR_FORBIDDEN');
const firstKey=id(key++);const first=await mutate('staff','create',staffValues,null,null,null,firstKey);const staffId=first.row.id;
assert.equal(first.duplicate,false);const retry=await mutate('staff','create',staffValues,null,null,null,firstKey);assert.equal(retry.duplicate,true);assert.equal(retry.row.id,staffId);
await rejects(mutate('staff','create',{...staffValues,position:'Changed'},null,null,null,firstKey),'IR_MUTATION_CONFLICT');
assert.equal((await scalar('select count(id)::int n from admin_audit_log limit 1')).n,1);
await rejects(mutate('staff','create',{...staffValues,staff_name:' test worker '}),'IR_DUPLICATE_STAFF');
await rejects(mutate('staff','create',{...staffValues,staff_name:'<script>'}),'IR_INVALID_INPUT');
await rejects(mutate('staff','create',{...staffValues,staff_name:'Second',linked_user_id:worker,employment_type:'other'}),'IR_INVALID_INPUT');
const second=(await mutate('staff','create',{...staffValues,staff_name:'Second',linked_user_id:linked})).row;
let updated=await mutate('staff','update',{...staffValues,position:'Senior Ecologist'},staffId,1);assert.equal(updated.row.version,2);
await rejects(mutate('staff','update',staffValues,staffId,1),'IR_VERSION_CONFLICT');
await rejects(mutate('staff','update',staffValues,id(999),1),'IR_NOT_FOUND');
const tv={...trainingValues,staff_id:staffId};
for (const bad of [{...tv,completion_date:'2026-02-30'},{...tv,expiry_date:'2026-11-11'},{...tv,qualification:''},{...tv,staff_id:id(999)}]) await rejects(mutate('training','create',bad),'IR_INVALID_INPUT');
const training=(await mutate('training','create',tv)).row;assert.equal(training.expiry_date,null);
await rejects(mutate('staff','archive',{},staffId,2,'Leaving'),'IR_STAFF_HAS_TRAINING');
await rejects(mutate('training','archive',{},training.id,1),'IR_INVALID_INPUT');
updated=await mutate('training','update',{...tv,expiry_date:'2026-12-12'},training.id,1);assert.equal(updated.row.version,2);
const archiveKey=id(key++);await mutate('training','archive',{},training.id,2,'Superseded',archiveKey);assert.equal((await mutate('training','archive',{},training.id,2,'Superseded',archiveKey)).duplicate,true);
await rejects(mutate('training','update',tv,training.id,3),'IR_ARCHIVED');
await mutate('staff','archive',{},staffId,2,'Leaving');await rejects(mutate('training','create',tv),'IR_INVALID_INPUT');
await mutate('staff','create',staffValues); // Archived names can be reused.
for (const table of ['internal_register_staff','internal_training_records','internal_register_mutations']) {
  assert.equal((await scalar('select relrowsecurity enabled from pg_class where oid=$1::regclass limit 1',[`public.${table}`])).enabled,true);
  for (const role of ['anon','authenticated','service_role']) for (const privilege of ['INSERT','UPDATE','DELETE']) assert.equal((await scalar('select has_table_privilege($1,$2,$3) allowed limit 1',[role,`public.${table}`,privilege])).allowed,false);
  for (const role of ['anon','authenticated']) assert.equal((await scalar('select has_table_privilege($1,$2,$3) allowed limit 1',[role,`public.${table}`,'SELECT'])).allowed,false);
  assert.equal((await scalar('select count(policyname)::int n from pg_policies where schemaname=$1 and tablename=$2 limit 1',['public',table])).n,0);
}
for (const signature of ['internal_register_can_manage(uuid)','internal_register_mutate(uuid,text,text,uuid,integer,jsonb,text,uuid)']) {
  for (const role of ['anon','authenticated']) assert.equal((await scalar('select has_function_privilege($1,$2,$3) allowed limit 1',[role,`public.${signature}`,'EXECUTE'])).allowed,false);
  assert.equal((await scalar('select has_function_privilege($1,$2,$3) allowed limit 1',['service_role',`public.${signature}`,'EXECUTE'])).allowed,true);
}
await rejects(db.query('delete from internal_register_staff where id=$1',[second.id]),'IR_IMMUTABLE');
await rejects(db.query("update internal_register_mutations set reason='Changed' where actor_id=$1 and mutation_key=$2",[actor,firstKey]),'IR_IMMUTABLE');
await db.exec(`create function public.ir_test_fail_audit() returns trigger language plpgsql as $$ begin raise exception 'TEST_AUDIT_FAILURE'; end; $$; create trigger ir_test_fail_audit before insert on public.admin_audit_log for each row execute function public.ir_test_fail_audit();`);
const counts=() => scalar('select (select count(id)::int from internal_register_staff) staff,(select count(mutation_key)::int from internal_register_mutations) mutations,(select count(id)::int from admin_audit_log) audits limit 1');
const before=await counts();const rollbackKey=id(key++);
await rejects(mutate('training','create',{...tv,staff_id:second.id}),'TEST_AUDIT_FAILURE');
assert.equal((await scalar('select count(id)::int n from internal_training_records where staff_id=$1 limit 1',[second.id])).n,0);
await rejects(mutate('staff','create',{...staffValues,staff_name:'Rollback'},null,null,null,rollbackKey),'TEST_AUDIT_FAILURE');assert.deepEqual(await counts(),before);
await rejects(mutate('staff','update',{...staffValues,staff_name:'Second',position:'Rollback'},second.id,1),'TEST_AUDIT_FAILURE');assert.equal((await scalar('select version,position from internal_register_staff where id=$1 limit 1',[second.id])).version,1);
await rejects(mutate('staff','archive',{},second.id,1,'Rollback archive'),'TEST_AUDIT_FAILURE');assert.equal((await scalar('select archived_at from internal_register_staff where id=$1 limit 1',[second.id])).archived_at,null);
await db.exec('drop trigger ir_test_fail_audit on public.admin_audit_log');
assert.equal((await mutate('staff','create',{...staffValues,staff_name:'Rollback'},null,null,null,rollbackKey)).duplicate,false);
const audit=await db.query('select before_data,after_data from admin_audit_log order by created_at,id limit 100');assert(!JSON.stringify(audit.rows).includes('Test Worker'));assert(!JSON.stringify(audit.rows).includes('Test training'));
// Exercise actual roles, not only catalogue grant inspection.
await db.exec('set role anon');
await rejects(db.query('select id from public.internal_register_staff limit 1'),'permission denied');
await rejects(db.query('select public.internal_register_can_manage($1) allowed limit 1',[actor]),'permission denied');
await db.exec('reset role; set role service_role');
assert.equal(await can(actor),true);
const roleCreate=await mutate('staff','create',{...staffValues,staff_name:'Service RPC'});assert(roleCreate.row.id);
await rejects(db.query('delete from public.internal_register_staff where id=$1',[roleCreate.row.id]),'permission denied');
await db.exec('reset role');
// Audit failure also rolls back training update/archive and leaves key reusable.
const trainingRollback=(await mutate('training','create',{...tv,staff_id:second.id})).row;
await db.exec('create trigger ir_test_fail_audit before insert on public.admin_audit_log for each row execute function public.ir_test_fail_audit()');
await rejects(mutate('training','update',{...tv,staff_id:second.id,expiry_date:'2026-12-12'},trainingRollback.id,1),'TEST_AUDIT_FAILURE');
await rejects(mutate('training','archive',{},trainingRollback.id,1,'Superseded'),'TEST_AUDIT_FAILURE');
assert.deepEqual(await scalar('select version,archived_at,expiry_date from internal_training_records where id=$1 limit 1',[trainingRollback.id]),{version:1,archived_at:null,expiry_date:null});
await db.exec('drop trigger ir_test_fail_audit on public.admin_audit_log');
await db.close();delete globalThis.__irTest;
console.log('PGlite checks passed: migration/reapply, initially empty tables, active admin and parent/child locks, primary recovery, service-only ACL/RLS, payload-bound idempotence, version conflicts, duplicate active names, date validation, staff/training archive rules, immutable history, and create/update/archive audit rollback.');
