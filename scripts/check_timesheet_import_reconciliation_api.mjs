import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import * as XLSX from 'xlsx';
import * as imports from '../lib/projectTimesheetImport.js';
import * as periods from '../lib/projectBudgetPeriods.js';
import * as reconciliation from '../lib/projectTimesheetReconciliation.js';

const source = await readFile(new URL('../app/api/admin/project-tracker-timesheet-import/route.js', import.meta.url),'utf8');
const stripped = source.replace(/^import[\s\S]*?;\s*$/gm,'').replace(/export /g,'');
const actor='00000000-0000-4000-8000-000000000001';
const staff='d07b78be-c1e7-4bf5-94fa-5366a59cb408';
const project='00000000-0000-4000-8000-000000000003';
const otherProject='00000000-0000-4000-8000-000000000008';
const src='00000000-0000-4000-8000-000000000004';
const fieldAllocation='00000000-0000-4000-8000-000000000005';
const quoteAllocation='00000000-0000-4000-8000-000000000006';
const quote='00000000-0000-4000-8000-000000000007';
let currentEntries=[];
let confirmed=true;
let lastRPC;
let access;
const tables={
  projects:[{id:project,name:'Wastewater Pond Upgrade ACT',client_name:'IQon Pty Ltd',status:'active',deleted_at:null,default_hourly_rate:999},{id:otherProject,name:'Other job',client_name:'Another client',status:'active',deleted_at:null,default_hourly_rate:999}],
  project_budget_sources:[{id:src,project_id:project,source_type:'original',source_name:'Original',approval_status:'approved',approved_value:10000,approved_hours:100}],
  project_budget_allocations:[{id:fieldAllocation,project_id:project,budget_source_id:src,allocation_name:'External consultation',allocation_code:'EXTERNAL',status:'active',staff_visible:true},{id:quoteAllocation,project_id:project,budget_source_id:src,allocation_name:'Quotes and tenders',allocation_code:'QUOTES',status:'active',staff_visible:true}],
  project_tracker_templates:[{project_id:project,category_options:['External consultation','Quotes and tenders']}],
  quote_draft_projects:[{project_id:project,quote_id:quote}],
  quote_drafts:[{transferred_quote_id:quote,project_number:'1597'}],
};
class Query {
  constructor(table){this.table=table;this.filters=[];this.start=0;this.end=99999;}
  select(){return this;}eq(k,v){this.filters.push(r=>r[k]===v);return this;}is(k,v){this.filters.push(r=>(r[k]??null)===v);return this;}
  in(k,values){this.filters.push(r=>values.includes(r[k]));return this;}gt(k,v){this.filters.push(r=>Number(r[k])>v);return this;}
  gte(k,v){this.filters.push(r=>r[k]>=v);return this;}lte(k,v){this.filters.push(r=>r[k]<=v);return this;}order(){return this;}range(start,end){this.start=start;this.end=end;return this;}
  then(resolve){let data=this.table==='project_tracker_entries'?currentEntries:tables[this.table]||[];return Promise.resolve({data:data.filter(r=>this.filters.every(f=>f(r))).slice(this.start,this.end+1),error:null}).then(resolve);}
}
const admin={from:(table)=>new Query(table),auth:{admin:{listUsers:async()=>({data:{users:[{id:staff,email:'gerard@ecologyconsulting.au',user_metadata:{full_name:'Gerard Dwyer'}},{id:actor,email:'admin@example.test',user_metadata:{full_name:'Administrator'}}]}})}},rpc:async(name,args)=>{lastRPC={name,args};return {data:{success:true,importedCount:args.p_entries.length,totalHours:args.p_entries.reduce((s,e)=>s+e.hours,0),totalKilometres:args.p_entries.reduce((s,e)=>s+(e.custom_data.km||0),0),labourCharge:args.p_entries.reduce((s,e)=>s+e.hours*e.custom_data.import_expected_charge_rate,0),allocationsRecalculated:1},error:null};}};
access={admin,user:{id:actor},isAdmin:true};
const context={...imports,...periods,...reconciliation,Date,Response,Headers,Request,FormData,File,console,XLSX,createHash,randomUUID,Map,Set,requireSession:async()=>access,requirePortalResource:async()=>null,serverError:e=>Response.json({error:e.message},{status:400}),trackerChargeRole:id=>id===staff?'Senior Ecologist':'Ecologist',loadTrackerChargeRates:async(_admin,ids)=>{
 assert(ids.includes(project));
 return confirmed?new Map([[project,new Map([['Senior Ecologist',205],['Ecologist',170],['Project Manager',140]])],[otherProject,new Map([['Senior Ecologist',270],['Ecologist',195],['Project Manager',160]])]]):new Map();
}};
vm.createContext(context);vm.runInContext(stripped+'\nthis.api={handleUpload,normaliseRow,buildPreview,handleImport,userName,POST};',context);
const headers=['Date','Employee','Client','Job#','Client job','Hours','Expenses','Kms','Vehicle','Task','Notes'];
const matrix=[headers,['5/11/2026','Gerard Dwyer','IQon Pty Ltd',1597,'Wastewater Pond Upgrade ACT',0.25,'','','','External consultation','Consultation on access and visit timing'],['30/10/2026','Gerard Dwyer','IQon Pty Ltd',1597,'Wastewater Pond Upgrade ACT',0.75,25,35,'EC01','Quotes and tenders','Client consultation and Quoting']];
const workbook=XLSX.utils.book_new();XLSX.utils.book_append_sheet(workbook,XLSX.utils.aoa_to_sheet(matrix),'Weekly');
const file=new File([XLSX.write(workbook,{type:'buffer',bookType:'biff8'})],'weekly.xls');
const form=new FormData();form.append('file',file);
const uploaded=await (await context.api.handleUpload(new Request('https://test/import',{method:'POST',body:form}))).json();
assert.deepEqual(uploaded.headers,headers);assert.equal(uploaded.rawRows.length,2);
const mapped=imports.mapRawTimesheetRows(uploaded.rawRows,imports.inferTimesheetColumnMap(uploaded.headers));
let preview=await context.api.buildPreview(admin,mapped);
assert.equal(preview.summary.ready,2);assert.equal(preview.rows[0].projectId,project);assert.equal(preview.rows[0].staffUserId,staff);
assert.equal(preview.rows[0].chargeRole,'Senior Ecologist');assert.equal(preview.rows[0].chargeRate,205,'The matched job rate must override company/default/other-job amounts.');assert.equal(preview.rows[0].chargeAmount,0.25*205);
assert.equal(preview.rows[1].expenses,25);assert.equal(preview.rows[1].vehicle,'EC01');assert.equal(preview.reconciliation.length,2);
const firstImport=await context.api.handleImport(access,{rows:preview.rows,fileName:'weekly.xls'});
assert.equal(firstImport.status,201);assert.equal(lastRPC.name,'ec_import_weekly_timesheets_reviewed');assert.equal(lastRPC.args.p_entries.length,2);assert.equal(lastRPC.args.p_entries[1].custom_data.expenses,25);assert.equal(lastRPC.args.p_entries[1].custom_data.import_source_task,'Quotes and tenders');
const existing={id:'00000000-0000-4000-8000-000000000009',project_id:project,staff_user_id:staff,entered_by_admin_id:null,work_date:'2026-11-05',activity_category:'External consultation',activity_information:'Previously entered staff consultation',hours:1,custom_data:{},updated_at:'2026-11-06T00:00:00Z'};
currentEntries=[existing];
preview=await context.api.buildPreview(admin,mapped);assert.equal(preview.summary.ready,1);assert.equal(preview.summary.possibleDuplicates,1);assert.equal(preview.rows[0].isSkipped,true);assert.equal(preview.rows[0].possibleDuplicates[0].enteredByAdmin,false);
const safeImport=await context.api.handleImport(access,{rows:preview.rows,fileName:'weekly.xls'});assert.equal(safeImport.status,201);assert.equal(lastRPC.args.p_entries.length,1,'Possible overlaps default to skip rather than add prior staff time twice.');
const approved=preview.rows.map(r=>({...r,duplicateDecision:r.sourceRow===2?'separate':r.duplicateDecision,duplicateReason:r.sourceRow===2?'Different consultation after the first staff visit.':r.duplicateReason}));
preview=await context.api.buildPreview(admin,approved);assert.equal(preview.summary.ready,2);
const separateImport=await context.api.handleImport(access,{rows:preview.rows,fileName:'weekly.xls'});assert.equal(separateImport.status,201);assert.equal(lastRPC.args.p_entries[0].custom_data.import_duplicate_review.expected_entries.length,1);assert.equal(lastRPC.args.p_entries[0].custom_data.import_duplicate_review.decision,'separate');
currentEntries=[{...existing,hours:2}];
assert.equal((await context.api.handleImport(access,{rows:preview.rows,fileName:'weekly.xls'})).status,409,'Stale separate-work review must reject the entire batch.');
confirmed=false;
preview=await context.api.buildPreview(admin,mapped);assert.equal(preview.summary.ready,0);assert(preview.rows.every(r=>r.issues.some(i=>i.code==='missing_project_rates')));
confirmed=true;currentEntries=[];
preview=await context.api.buildPreview(admin,mapped);preview.rows[0].chargeRate=220;
assert.equal((await context.api.handleImport(access,{rows:preview.rows,fileName:'weekly.xls'})).status,409,'A changed charge amount must be reviewed again.');
assert.equal(context.api.userName({id:'2c265989-7864-41ad-9e2d-202d64d9a954',email:'aaron.dooley@ecologyconsulting.au',user_metadata:{}}),'Aaron Dooley');
const bad=context.api.normaliseRow({...mapped[0],expenses:'not money'},0);assert.equal(bad.invalidExpenses,true);assert.equal(context.api.normaliseRow(bad,0).invalidExpenses,true);
assert.equal(context.api.normaliseRow({...mapped[0],expenses:'$25.00'},0).expenses,25);
const ui=await readFile(new URL('../components/AdminTimesheetImporter.js',import.meta.url),'utf8');
assert.match(ui,/<Reconciliation summary=\{summary\} groups=\{preview\.reconciliation \|\| \[\]\} \/>/);
const displayCode=ui.slice(ui.indexOf('const numberFormatter'),ui.indexOf('function isExactDuplicate'))+ui.slice(ui.indexOf('function formatNumber'),ui.indexOf('function sourceValue'))+ui.slice(ui.indexOf('function Reconciliation'),ui.indexOf('function Metric'))+'\nglobalThis.Reconciliation=Reconciliation;';
const swc=createRequire(import.meta.url)('next/dist/build/swc');
const compiled=await swc.transform(displayCode,{jsc:{parser:{syntax:'ecmascript',jsx:true},transform:{react:{runtime:'classic'}}},module:{type:'commonjs'}});
const renderContext=vm.createContext({React,Intl,Number});vm.runInContext(compiled.code,renderContext);
const renderPreview=await context.api.buildPreview(admin,mapped);
const markup=renderToStaticMarkup(React.createElement(renderContext.Reconciliation,{summary:renderPreview.summary,groups:renderPreview.reconciliation}));
assert(markup.includes('Gerard Dwyer')&&markup.includes('Wastewater Pond Upgrade ACT')&&markup.includes('2026-11-02')&&markup.includes('2026-10-26'));
assert(!markup.includes('No weekly reconciliation groups are available yet'),'Real top-level API reconciliation must populate the rendered table.');
const normalAccess=access;
const request=(body)=>new Request('https://test/import',{method:'POST',headers:{'Content-Type':'application/json'},body:typeof body==='string'?body:JSON.stringify(body)});
const privateHeaders=(response,status)=>{assert.equal(response.status,status);assert.equal(response.headers.get('Cache-Control'),'private, no-store');assert(response.headers.get('Vary').toLowerCase().includes('authorization'));};
access={error:Response.json({error:'Not authenticated.'},{status:401,headers:{Vary:'Origin'}})};
let privateResponse=await context.api.POST(request({}));privateHeaders(privateResponse,401);assert(privateResponse.headers.get('Vary').includes('Origin'));
access={...normalAccess,isAdmin:false};privateHeaders(await context.api.POST(request({})),403);
access=normalAccess;privateHeaders(await context.api.POST(request('{')),400);
privateHeaders(await context.api.POST(request({action:'preview',rows:mapped})),200);
confirmed=false;privateHeaders(await context.api.POST(request({action:'import',rows:mapped})),409);confirmed=true;
context.requirePortalResource=async()=>Response.json({error:'Denied'},{status:403});privateHeaders(await context.api.POST(request({})),403);context.requirePortalResource=async()=>null;
privateHeaders(await context.api.POST(request({action:'import',rows:renderPreview.rows})),201);
console.log('Actual XLS importer API passed: supplied workbook, exact Job#/Client job mapping, per-job role charges, reference values, prior staff overlap default skip, deliberate separate work, stale review/rate rejection and missing-card protection.');
