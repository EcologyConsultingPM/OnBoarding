import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const root=new URL('..',import.meta.url);
const route=await readFile(new URL('app/api/projects/[projectId]/activities/route.js',root),'utf8');
const deleteSource=route.slice(route.indexOf('export async function DELETE(')).replace('export async function DELETE(','async function DELETE(');
const projectId='11111111-1111-4111-8111-111111111111';
const activityId='22222222-2222-4222-8222-222222222222';
const scheduleId='33333333-3333-4333-8333-333333333333';
const validId=value=>/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value||''));

async function run({isAdmin=true,activityPresent=true,otherActiveLinks=0,id=activityId,authError=null}={}){
 const operations=[];
 const admin={from(table){
  const operation={table,filters:[],kind:'select',values:null};
  const q={
   select(columns,options){operation.columns=columns;operation.options=options;return q;},
   update(values){operation.kind='update';operation.values=values;return q;},
   eq(column,value){operation.filters.push([column,value]);return q;},
   is(column,value){operation.filters.push([column,value]);return q;},
   async maybeSingle(){operations.push(structuredClone(operation));return {data:activityPresent?{id:activityId,project_id:projectId,schedule_item_id:scheduleId}:null,error:null};},
   then(resolve,reject){operations.push(structuredClone(operation));return Promise.resolve(operation.options?.head?{count:otherActiveLinks,error:null}:{error:null}).then(resolve,reject);},
  };return q;
 }};
 const context={Response,URL,Date,requireSession:async()=>({isAdmin,admin,error:authError}),validId,serverError:error=>Response.json({error:error.message},{status:500})};
 vm.createContext(context);
 vm.runInContext(deleteSource+'\nthis.handler=DELETE;',context);
 const response=await context.handler(new Request(`https://example.test/api/projects/${projectId}/activities?id=${id}`,{method:'DELETE'}),{params:{projectId}});
 return {response,body:await response.json(),operations};
}

let result=await run();
assert.equal(result.response.status,200);assert.equal(result.body.success,true);
const retirement=result.operations.find(o=>o.table==='project_activities'&&o.kind==='update');
assert.equal(retirement.values.is_active,false);
assert.deepEqual(retirement.filters, [['id',activityId]]);
const read=result.operations.find(o=>o.table==='project_activities'&&o.kind==='select'&&!o.options?.head);
assert(read.filters.some(([k,v])=>k==='project_id'&&v===projectId),'Deletion must be scoped to the project.');
assert(read.filters.some(([k,v])=>k==='is_active'&&v===true));
const dismissed=result.operations.find(o=>o.table==='portal_events'&&o.kind==='update');
assert(dismissed.values.dismissed_at);
assert(dismissed.filters.some(([k,v])=>k==='source_id'&&v===activityId));
assert(dismissed.filters.some(([k,v])=>k==='event_type'&&v==='project_activity_assigned'));
assert(result.operations.some(o=>o.table==='project_schedule_items'&&o.kind==='update'&&o.values.is_active===false),'The orphaned Gantt item must leave the active schedule.');
assert(!result.operations.some(o=>['project_tracker_entries','project_allocations','project_budget_allocations','project_activity_assignees'].includes(o.table)),'Retirement must retain timesheets, allocations and assignee response history.');

result=await run({otherActiveLinks:1});
assert.equal(result.response.status,200);
assert(!result.operations.some(o=>o.table==='project_schedule_items'&&o.kind==='update'),'A shared schedule item must remain active while another activity uses it.');
result=await run({isAdmin:false});assert.equal(result.response.status,403);assert.equal(result.operations.length,0);
result=await run({id:'not-an-id'});assert.equal(result.response.status,400);assert.equal(result.operations.length,0);
result=await run({activityPresent:false});assert.equal(result.response.status,404);assert(!result.operations.some(o=>o.kind==='update'));
result=await run({authError:Response.json({error:'Authentication required'},{status:401})});assert.equal(result.response.status,401);assert.equal(result.operations.length,0);
console.log('Activity bulk-delete support contract passed: admin/project guards, targeted retirement, notification withdrawal, shared Gantt protection and retained timesheet/history records.');

const helperSource=await readFile(new URL('lib/workActivitySelection.js',root),'utf8');
const {withActivityClientId,activitySelectionKey,stripActivityUiFields,retireSelectedWorkActivities,activityRemovalConfirmation}=await import(`data:text/javascript;base64,${Buffer.from(helperSource).toString('base64')}`);
const saved=[{id:activityId,title:'First'},{id:scheduleId,title:'Second'},{id:projectId,title:'Third'}];
const draft=withActivityClientId({title:'Unsaved'});
assert.equal(activitySelectionKey({...draft,title:'Edited'}),activitySelectionKey(draft));
assert.notEqual(activitySelectionKey(withActivityClientId({title:'Unsaved'})),activitySelectionKey(draft));
assert.equal(stripActivityUiFields({...draft,selected:true}).clientId,undefined);
assert.equal(stripActivityUiFields({...draft,selected:true}).selected,undefined);
assert.match(activityRemovalConfirmation(saved),/Delete 3 selected/);
let calls=[];
let retired=await retireSelectedWorkActivities({rows:[saved[0],draft],projectId,auth:async(method,url)=>{calls.push({method,url});return Response.json({success:true});}});
assert.equal(retired.completedKeys.size,2);assert.equal(retired.remainingKeys.size,0);assert.equal(calls.length,1);assert.equal(calls[0].method,'DELETE');
calls=[];
retired=await retireSelectedWorkActivities({rows:saved,projectId,auth:async(method,url)=>{
 calls.push({method,url});
 if(method==='GET')return Response.json({activities:saved.slice(1)});
 if(url.includes(scheduleId))return Response.json({error:'Try again'},{status:500});
 return Response.json({success:true});
}});
assert.equal(retired.completedKeys.size,1);assert.equal(retired.remainingKeys.size,2);assert.equal(calls.filter(c=>c.method==='DELETE').length,2);assert.equal(retired.requestError,'Try again');
retired=await retireSelectedWorkActivities({rows:saved,projectId,auth:async(method,url)=>{
 if(method==='GET')return Response.json({activities:[saved[2]]});
 if(url.includes(scheduleId))throw new Error('Lost response');
 return Response.json({success:true});
}});
assert.equal(retired.completedKeys.size,2);assert.equal(retired.remainingKeys.size,1);assert.equal(retired.reconciledRetirement,true);
retired=await retireSelectedWorkActivities({rows:saved,projectId,auth:async()=>{throw new Error('Offline');}});
assert.equal(retired.completedKeys.size,0);assert.equal(retired.remainingKeys.size,3);assert.equal(retired.reconciliationError,'Offline');
console.log('Activity selection behaviour passed: stable draft/saved identity, no UI fields in payloads, local-only removal, serial targeted DELETEs and truthful partial-failure recovery.');
