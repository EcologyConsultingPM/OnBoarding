import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const root=new URL('..',import.meta.url);
const source=await readFile(new URL('app/api/projects/[projectId]/route.js',root),'utf8');
const projectId='11111111-1111-4111-8111-111111111111';
const months=Array.from({length:4},(_,i)=>({approved_value:2548.50,approved_hours:18,service_period_start:`2026-${String(i+9).padStart(2,'0')}-01`,service_period_end:`2026-${String(i+9).padStart(2,'0')}-28`}));
async function run({sources=months,budgetError=null,isAdmin=true,body={budgetDollars:2548.50,budgetHours:30,name:'Monthly project'}}={}){
 const writes=[],queries=[];
 const admin={from(table){let kind='select',values=null;const filters=[];const query={
  select(columns){queries.push({table,columns,filters});return query;},
  eq(key,value){filters.push([key,value]);return query;},
  update(input){kind='update';values=structuredClone(input);writes.push({table,values});return query;},
  async maybeSingle(){return {data:{id:projectId,name:'Monthly project',status:'active'},error:null};},
  async single(){return {data:{id:projectId,...values},error:null};},
  then(resolve,reject){return Promise.resolve(table==='project_budget_sources'?{data:sources,error:budgetError}:{data:[],error:null}).then(resolve,reject);},
 };return query;}};
 const context={Response,URL,Date,requireSession:async()=>({user:{id:'admin'},isAdmin,admin}),serverError:e=>Response.json({error:e.message},{status:500})};vm.createContext(context);
 vm.runInContext(source.replace(/^import[^\n]*\n/gm,'').replace(/export /g,'')+'\nthis.handler=PATCH;',context);
 const response=await context.handler(new Request('https://example.test/api/projects/'+projectId,{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify(body)}),{params:{projectId}});
 return {response,body:await response.json(),writes,queries};
}
let r=await run();assert.equal(r.response.status,200);assert.equal(r.body.monthlyBudgetControlled,true);assert.equal(r.writes[0].values.budget_dollars,10194);assert.equal(r.writes[0].values.budget_hours,72);assert.equal(r.body.project.budget_dollars,10194);
assert(r.queries.find(q=>q.table==='project_budget_sources').filters.some(([k,v])=>k==='approval_status'&&v==='approved'));
r=await run({sources:[...months,{approved_value:100.10,approved_hours:0.25,service_period_start:null,service_period_end:null}]});assert.equal(r.body.project.budget_dollars,10294.10);assert.equal(r.body.project.budget_hours,72.25);
r=await run({sources:[{approved_value:5000,approved_hours:25,service_period_start:null,service_period_end:null}]});assert.equal(r.body.monthlyBudgetControlled,false);assert.equal(r.body.project.budget_dollars,2548.50);assert.equal(r.body.project.budget_hours,30);
r=await run({sources:[]});assert.equal(r.body.monthlyBudgetControlled,false);
r=await run({sources:null,budgetError:{code:'42703',message:'Period columns awaiting migration'}});assert.equal(r.response.status,200);assert.equal(r.body.monthlyBudgetControlled,false);
r=await run({sources:null,budgetError:{code:'08006',message:'Database unavailable'}});assert.equal(r.response.status,400);assert.equal(r.writes.length,0);
r=await run({isAdmin:false});assert.equal(r.response.status,403);assert.equal(r.writes.length,0);assert.equal(r.queries.length,0);
const ui=await readFile(new URL('components/AdminProjectSetup.js',root),'utf8');assert(ui.includes('if (d.monthlyBudgetControlled && d.project)'));assert(ui.includes('budget_dollars: d.project.budget_dollars, budget_hours: d.project.budget_hours'));
console.log('Monthly setup budget behaviour passed: approved aggregate totals, cent precision, mixed sources, non-monthly and pre-migration compatibility, fail-closed errors, administrator gate and canonical UI refresh.');
