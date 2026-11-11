import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
const root = new URL('../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');
const [portal, visibilitySource, source, ui, job, backup] = await Promise.all([
  'components/OnboardingWorkbook.js','lib/portalVisibility.js','app/api/admin/system-health/route.js',
  'components/PortalSystemHealth.js','app/api/jobs/system-health/route.js','.github/workflows/private-daily-database-backup.yml',
].map(read));
assert.match(portal, /title: "Internal Registers"/);
assert.match(portal, /mode: "internalregisters"/);
assert.match(portal, /isAdmin && mode === "internalregisters"/);
assert.match(portal, /<AdminInternalRegisters onToast=/);
const visContext = { normaliseStaffEmail: (value) => String(value || '').toLowerCase(), Response };
vm.createContext(visContext);
vm.runInContext(visibilitySource.replace(/^import .*;\n/gm, '').replace(/export /g, '') + '\nthis.def=resourceDefinition;this.allowed=canAccessPortalResource;',visContext);
assert.equal(visContext.def('admin.internal_registers').portal, 'admin');
assert.equal(visContext.def('admin.internal_registers.training').parent, 'admin.internal_registers');
function access(isAdmin, rows=[], email='test.admin@ecologyconsulting.au') {
  return {isAdmin,user:{id:'test-account',email},admin:{from(){return{select(){return this;},eq(){return this;},in(){return Promise.resolve({data:rows,error:null});}};}}};
}
assert.equal(await visContext.allowed(access(false), 'admin.internal_registers.training'), false);
assert.equal(await visContext.allowed(access(true), 'admin.internal_registers.training'), true);
assert.equal(await visContext.allowed(access(true,[{resource_key:'admin.internal_registers',is_visible:false}]), 'admin.internal_registers.training'), false);
assert.equal(await visContext.allowed(access(true,[{resource_key:'admin.internal_registers.training',is_visible:false}]), 'admin.internal_registers.training'), false);
assert.equal(await visContext.allowed(access(true,[{resource_key:'admin.internal_registers',is_visible:false}],'aaron.dooley@ecologyconsulting.au'), 'admin.internal_registers.training'), true);

let rows=[],failed=false,admin=true,unauth=false;const calls=[];
const ctx={Response,Date,requireSession:async()=>unauth?{error:Response.json({error:'auth'},{status:401})}:{isAdmin:admin,admin:{from(table){const q={table,columns:'',select(columns){this.columns=columns;assert(!columns.split(',').map(s=>s.trim()).includes('*'));return this;},order(){return this;},limit(n){assert(n<=30);if(table==='backup_runs')assert(!this.columns.split(',').map(s=>s.trim()).includes('id'),'Production backup_runs has no id.');calls.push({table,columns:this.columns});return Promise.resolve({data:table==='backup_runs'?rows:[],error:failed?{message:'secret-credential'}:null});}};return q;}}}};
vm.createContext(ctx);
vm.runInContext(source.replace(/^import .*;\n/gm,'').replace(/export /g,'')+'\nthis.get=GET;this.coverage=coverageStatus;',ctx);
let res=await ctx.get(new Request('https://test.invalid/api/admin/system-health'));assert.equal(res.status,200);let body=await res.json();assert.equal(body.backup_coverage.database,false);assert.equal(body.internal_registers_backup_scope.configured,true);assert.match(res.headers.get('cache-control'),/no-store/);
rows=[{run_id:'test',status:'failed',finished_at:new Date().toISOString(),coverage:{database_data:true,database_roles:true,database_schema:true,storage_objects:true}}];
res=await ctx.get(new Request('https://test.invalid'));body=await res.json();assert.equal(body.backup_coverage.database,false);
rows[0].status='succeeded';res=await ctx.get(new Request('https://test.invalid'));body=await res.json();assert.equal(body.backup_coverage.database,true);assert.equal(body.backup_coverage.storage,true);
rows[0].finished_at=new Date(Date.now()-31*3600000).toISOString();res=await ctx.get(new Request('https://test.invalid'));body=await res.json();assert.equal(body.backup_coverage.database,false);assert.equal(body.backup_coverage.stale,true);
admin=false;let before=calls.length;res=await ctx.get(new Request('https://test.invalid'));assert.equal(res.status,403);assert.equal(calls.length,before);
unauth=true;res=await ctx.get(new Request('https://test.invalid'));assert.equal(res.status,401);assert.equal(calls.length,before);
unauth=false;admin=true;failed=true;res=await ctx.get(new Request('https://test.invalid'));assert.equal(res.status,500);body=await res.json();assert.equal(body.code,'HEALTH_QUERY_FAILED');assert(!JSON.stringify(body).includes('secret-credential'));
assert.match(ui,/Error code:/);assert.doesNotMatch(ui,/private archive is database-only/);
for(const table of ['internal_register_staff','internal_training_records'])assert(job.includes(`"${table}"`));
assert.match(job,/table === "backup_runs" \? "run_id" : "id"/);
assert.equal((backup.match(/- cron:/g)||[]).length,1);
assert.match(backup,/supabase db dump --remote=.*-f backup\/schema.sql/);
assert.match(backup,/--data-only --use-copy/);
console.log('Internal Registers integration passed: admin card/render, inherited permissions, staff denial, real backup schema, failed/stale/fresh coverage, private responses, sanitised errors and one existing daily full-database schedule. No live calls.');
