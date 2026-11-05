import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const root=new URL('..',import.meta.url);
const source=await readFile(new URL('lib/staffProjectAssignmentSummary.js',root),'utf8');
const helpers=await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const {summarizeStaffProjectAssignments,staffProjectCardLabels,loadStaffProjectAssignments,emptyStaffProjectAssignmentSummary}=helpers;
const me='staff-me',other='staff-other';
const activities=Array.from({length:11},(_,i)=>({id:`a${i}`,project_id:'rail',is_active:true}));
const assignments=activities.map(a=>({id:`assignment-${a.id}`,activity_id:a.id,staff_user_id:me,acceptance_status:'awaiting_response',removed_at:null}));
let summary=summarizeStaffProjectAssignments(assignments,activities,me).get('rail');
assert.deepEqual(summary,{assigned:11,awaitingResponse:11,accepted:0,actioned:0});
let labels=staffProjectCardLabels({id:'rail',hasActiveAllocation:true,allocatedHours:40,assignmentSummary:summary});
assert.equal(labels.assigned,'11 assigned work activities');assert.equal(labels.awaitingResponse,'11 awaiting your response');assert.equal(labels.allocation,'40 h allocated to you');
const mixed=[...assignments,{...assignments[0]}, {activity_id:'colleague',staff_user_id:other,acceptance_status:'accepted'}, {activity_id:'declined',staff_user_id:me,acceptance_status:'declined'}, {activity_id:'removed',staff_user_id:me,acceptance_status:'removed'}, {activity_id:'retired',staff_user_id:me,acceptance_status:'accepted'}, {activity_id:'accepted',staff_user_id:me,acceptance_status:'accepted'}, {activity_id:'actioned',staff_user_id:me,acceptance_status:'actioned'}];
const extra=[...activities,...['colleague','declined','removed','accepted','actioned'].map(id=>({id,project_id:'rail',is_active:true})),{id:'retired',project_id:'rail',is_active:false}];
assert.deepEqual(summarizeStaffProjectAssignments(mixed,extra,me).get('rail'),{assigned:13,awaitingResponse:11,accepted:1,actioned:1});
assert.equal(staffProjectCardLabels({id:'rail',assignmentSummary:null},[],true).assigned,'Assigned work activities unavailable');
assert.equal(staffProjectCardLabels({id:'rail',allocatedHours:0,hasActiveAllocation:true,assignmentSummary:emptyStaffProjectAssignmentSummary()}).allocation,'0 h allocated to you');
assert.equal(staffProjectCardLabels({id:'rail',allocatedHours:null,hasActiveAllocation:true}).allocation,'Your allocated hours are not set');
assert.equal(staffProjectCardLabels({id:'rail',hasActiveAllocation:false}).allocation,'No project hours allocated to you');
assert.equal(staffProjectCardLabels({id:'rail',allocatedHours:40,assignmentSummary:summary},null,false).assigned,'Assigned work activities unavailable');
assert.equal(staffProjectCardLabels({id:'rail'},Array(200).fill({projectId:'rail',id:'a',acceptanceStatus:'awaiting_response'})).assigned,'Assigned work activities unavailable');

function mockAdmin(tables,assignmentError=null){
 const calls=[];
 return {calls,from(table){let filters=[],range=null,sort=null;
  const q={select(){return q;},eq(k,v){filters.push(r=>r[k]===v);return q;},in(k,v){filters.push(r=>v.includes(r[k]));return q;},is(k,v){filters.push(r=>(r[k]??null)===v);return q;},order(k){sort=k;return q;},range(start,end){range=[start,end];return q;},then(resolve,reject){
   calls.push({table,range});
   if(table==='project_activity_assignees'&&assignmentError)return Promise.resolve({data:null,error:assignmentError}).then(resolve,reject);
   let rows=(tables[table]||[]).filter(r=>filters.every(f=>f(r))).map(r=>({...r}));
   if(sort)rows.sort((a,b)=>String(a[sort]).localeCompare(String(b[sort])));
   if(range)rows=rows.slice(range[0],range[1]+1);
   return Promise.resolve({data:rows,error:null}).then(resolve,reject);
  }};return q;
 }};
}
const many=Array.from({length:1201},(_,i)=>({id:`row-${String(i).padStart(5,'0')}`,activity_id:`many-${i}`,staff_user_id:me,acceptance_status:'awaiting_response',removed_at:null}));
const manyActivities=many.map(r=>({id:r.activity_id,project_id:'rail',is_active:true}));
let admin=mockAdmin({project_activity_assignees:many,project_activities:manyActivities});
let loaded=await loadStaffProjectAssignments(admin,me,['rail'],()=>false);
assert.equal(loaded.rows.length,1201);assert.equal(loaded.activities.length,1201);
assert.equal(summarizeStaffProjectAssignments(loaded.rows,loaded.activities,me).get('rail').assigned,1201);
assert.equal(admin.calls.filter(c=>c.table==='project_activity_assignees').length,3,'All recipient rows must be paginated.');
admin=mockAdmin({project_activities:[{id:'legacy',project_id:'rail',staff_user_id:me,is_active:true,acceptance_status:'awaiting_response'},{id:'outside',project_id:'outside',staff_user_id:me,is_active:true,acceptance_status:'accepted'}]},{code:'42P01',message:'missing table'});
loaded=await loadStaffProjectAssignments(admin,me,['rail'],e=>e.code==='42P01');
assert.equal(loaded.legacy,true);assert.deepEqual(loaded.activities.map(a=>a.id),['legacy']);
await assert.rejects(()=>loadStaffProjectAssignments(mockAdmin({},{message:'Permission denied'}),me,['rail'],()=>false),/Permission denied/);

// Exercise the actual eligibleProjects implementation: pending counts may not
// become a new membership grant, and ad hoc project options disclose no personal
// allocation, financial summary or colleague assignment counts.
const route=await readFile(new URL('app/api/project-tracker-entries/route.js',root),'utf8');
const begin=route.indexOf('export async function eligibleProjects(');
const end=route.indexOf('export async function refreshTrackerAllocation(',begin);
const functionSource=route.slice(begin,end).replace('export async function eligibleProjects(','async function eligibleProjects(');
const projects=['rail','pending-only','accepted-only'].map(id=>({id,name:id,client_name:'Client',status:'active',deleted_at:null}));
const tables={
 projects,
 project_allocations:[{project_id:'rail',staff_user_id:me,active:true,allocated_hours:40}],
 project_activity_assignees:[...assignments,{id:'pending-only-a',activity_id:'pending-only-a',staff_user_id:me,acceptance_status:'awaiting_response',removed_at:null},{id:'accepted-only-a',activity_id:'accepted-only-a',staff_user_id:me,acceptance_status:'accepted',removed_at:null}],
 project_activities:[...activities,{id:'pending-only-a',project_id:'pending-only',is_active:true},{id:'accepted-only-a',project_id:'accepted-only',is_active:true}],
 project_tracker_settings:projects.map(p=>({project_id:p.id,tracker_visible:true})),
 project_tracker_templates:projects.map(p=>({project_id:p.id,locked:true})),
 project_budget_sources:projects.map(p=>({id:`source-${p.id}`,project_id:p.id,approval_status:'approved',approved_value:1000,approved_hours:100})),
 project_budget_allocations:projects.map(p=>({id:`budget-${p.id}`,project_id:p.id,budget_source_id:`source-${p.id}`,status:'active',staff_visible:true,allocation_hours:100,hours_consumed:2,charge_out_spend:20})),
};
const context={loadStaffProjectAssignments,summarizeStaffProjectAssignments,emptyStaffProjectAssignmentSummary,assignmentTableUnavailable:()=>false,unavailable:()=>false};vm.createContext(context);vm.runInContext(functionSource+'\nthis.eligible=eligibleProjects;',context);
admin=mockAdmin(tables);
let eligible=await context.eligible({admin,user:{id:me}});
assert.deepEqual(Array.from(eligible.projects,p=>p.id).sort(),['accepted-only','rail']);
const rail=eligible.projects.find(p=>p.id==='rail');assert.equal(rail.allocatedHours,40);assert.equal(rail.assignmentSummary.assigned,11);
assert.equal(eligible.projects.find(p=>p.id==='accepted-only').hasActiveAllocation,false);
eligible=await context.eligible({admin,user:{id:me}},me,true);
const adHoc=eligible.projects.find(p=>p.id==='pending-only');assert.equal(adHoc.isAssigned,false);assert.equal(adHoc.assignmentSummary,undefined);assert.equal(adHoc.allocatedHours,undefined);assert.equal(adHoc.financials,undefined);assert.equal(adHoc.clientName,'');
const ui=await readFile(new URL('components/StaffProjectTracker.js',root),'utf8');
assert.match(ui,/setAssignedActivities\(\(ownActivities \|\| \[\]\)[\s\S]*?\["accepted", "actioned"\]\.includes\(activity\.acceptanceStatus\)/,'Pending counts must not enter editable work/time dropdowns.');
console.log('Staff project assignment counts passed: 11 pending Rail activities/40 personal hours, shared assignees, exclusion/deduplication, paging, legacy fallback, unavailable states and unchanged membership/edit permissions.');
