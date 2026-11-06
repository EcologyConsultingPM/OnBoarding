import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import crypto from 'node:crypto';
import path from 'node:path';
const root=path.resolve(path.dirname(new URL(import.meta.url).pathname),'..');
const read=(p)=>fs.readFileSync(path.join(root,p),'utf8');
const contract=await import(`data:text/javascript;base64,${Buffer.from(read('lib/preMobilisationChecklist.js')).toString('base64')}`);
const userId='staff-self';const reviewerId='reviewer';
function valid(){
 const form=contract.createEmptyPreMobilisationForm();
 form.metadata={project:'Mock field project',jobNumber:'TEST',location:'Mock site',date:'2026-11-06',departureTime:'07:00',expectedReturnTime:'17:00',completedBy:'Mock Staff',additionalStaff:'',communicationOfficer:'Office at06:50',vehicleRegistration:'MOCK',vehicleType:'4WD wagon',odometer:'100',vehicleLogBook:'Yes'};
 form.conditions={weatherConditions:'Sunny / Clear',comments:'',fireDangerRating:'Moderate',lightningStormActivity:'Reviewed; no activity',liveTrafficHazardsChecked:true,mobileCoverage:'Full'};
 form.approval={name:'Mock Staff',position:'Ecologist',signedAt:'2026-11-06T06:55',signature:'data:image/png;base64,c2lnbmF0dXJl',failedItemsAction:''};
 form.checks=form.checks.map(x=>({...x,outcome:'pass'}));form.biologicalChecks=form.biologicalChecks.map(x=>({...x,outcome:'yes'}));return form;
}
const state={forms:[],events:[],denied:false,unauth:false,notificationFail:false,filters:[]};
function query(table){
 const q={table,mode:'read',filters:[],inserted:null,select(){return this;},order(){return this;},eq(k,v){this.filters.push([k,v]);return this;},insert(v){this.mode='insert';this.inserted=v;return this;},then(resolve,reject){return Promise.resolve(this.execute()).then(resolve,reject);},single(){return Promise.resolve(this.execute(true));},maybeSingle(){return Promise.resolve(this.execute(true));},execute(single=false){
  state.filters.push({table,mode:this.mode,filters:this.filters});
  if(table==='admin_emails')return {data:[{email:'reviewer@example.test'}],error:null};
  if(table==='portal_events'){if(state.notificationFail)throw Error('mock_notification_failure');state.events.push(...this.inserted);return {data:this.inserted,error:null};}
  if(table==='whs_forms'&&this.mode==='insert'){
   const v=this.inserted;const existing=state.forms.find(x=>x.created_by===v.created_by&&x.submission_key===v.submission_key);
   if(existing)return {data:null,error:{code:'23505'}};
   const row={...v,id:`form-${state.forms.length+1}`,created_at:'2026-11-06T04:00:00Z'};state.forms.push(row);return {data:row,error:null};
  }
  if(table==='whs_forms'){const rows=state.forms.filter(x=>this.filters.every(([k,v])=>x[k]===v));return {data:single?(rows[0]||null):rows,error:null};}
  return {data:[],error:null};
 }};return q;
}
const access={user:{id:userId},isAdmin:false,admin:{from:query,auth:{admin:{listUsers:async()=>({data:{users:[{id:reviewerId,email:'reviewer@example.test'},{id:'unrelated',email:'unrelated@example.test'},{id:userId,email:'staff@example.test'}]}})}}}};
let source=read('app/api/whs-forms/route.js').replace(/^import .*;\n/gm,'').replace(/export /g,'');source+='\nglobalThis.handlers={POST,GET};';
const context={crypto,Response,Request,URL,console:{warn(){}},requireSession:async()=>state.unauth?{error:Response.json({error:'Unauthenticated'},{status:401})}:access,serverError:(e)=>Response.json({error:e.message},{status:500}),PRIMARY_ADMIN_EMAILS:[],requirePortalResource:async()=>state.denied?Response.json({error:'Denied'},{status:403}):null,normalisePreMobilisationDetails:contract.normalisePreMobilisationDetails,normaliseEcologicalFieldSwmsDetails:()=>({errors:[]}),OFFICE_RISK_ITEM_IDS:[]};
vm.runInNewContext(source,context);const {POST,GET}=context.handlers;
const post=(form,type='pre_mobilisation')=>POST(new Request('https://mock.test/api/whs-forms',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({form_type:type,title:'Mock form',details:form})}));
let form=valid();let res=await post(form);assert.equal(res.status,201);assert.equal(state.forms[0].details.biologicalChecks.length,15);assert.equal(state.forms[0].details.documentRevision,4);assert.equal(state.events.length,1);assert.equal(state.events[0].recipient_id,reviewerId);assert.equal(state.events[0].event_type,'pre_mobilisation_submitted');assert.equal(state.events[0].severity,'information');
res=await post(form);assert.equal(res.status,200);assert.equal((await res.json()).duplicate,true);assert.equal(state.forms.length,1);assert.equal(state.events.length,1);
form=valid();form.biologicalChecks[9]={id:'B10',outcome:'no',action:'PRIVATE_TEST_PLAN_PROCESS'};form.approval.failedItemsAction='PRIVATE_TEST_OFFICE_ACTION';form.proceedStatus='blocked';res=await post(form);assert.equal(res.status,201);assert.equal(state.forms[1].details.biologicalChecks[9].action,'PRIVATE_TEST_PLAN_PROCESS');assert.equal(state.events.at(-1).severity,'warning');assert.ok(!JSON.stringify(state.events).includes('PRIVATE_TEST'));assert.match(state.events.at(-1).body,/blocked/);
form=valid();form.biologicalChecks[2].outcome='no';res=await post(form);assert.equal(res.status,400);assert.equal(state.forms.length,2);
form=valid();form.biologicalChecks.pop();res=await post(form);assert.equal(res.status,400);
form=valid();form.documentRevision=3;delete form.biologicalChecks;res=await post(form);assert.equal(res.status,400);
state.denied=true;res=await post(valid());assert.equal(res.status,403);state.denied=false;state.unauth=true;res=await post(valid());assert.equal(res.status,401);state.unauth=false;
res=await POST(new Request('https://mock.test',{method:'POST',body:'not-json'}));assert.equal(res.status,400);
form=valid();form.metadata.jobNumber='OTHER';state.notificationFail=true;res=await post(form);assert.equal(res.status,201);assert.equal(state.forms.length,3);state.notificationFail=false;
state.forms.push({...state.forms[0],id:'unrelated-form',created_by:'unrelated',submission_key:'unrelated'});access.isAdmin=true;
res=await GET(new Request('https://mock.test/api/whs-forms?scope=mine'));assert.equal(res.status,200);const history=await res.json();assert.equal(history.forms.length,3);assert.ok(history.forms.every(x=>x.created_by===userId));assert.ok(history.forms.some(x=>x.details.biologicalChecks.length===15));
res=await post({free:'Legacy generic payload'},'hazard_report');assert.equal(res.status,201);
for(const p of ['components/StaffForms.js','components/WhsFormsCompliance.js','components/WhsComplianceDashboard.js'])assert.match(read(p),/PreMobilisationBiologicalRecord/);
assert.match(read('components/PreMobilisationBiologicalRecord.js'),/definition\.check/);assert.match(read('components/PreMobilisationBiologicalRecord.js'),/OUTCOME_LABELS/);
console.log('Biological WHS workflow passed: real POST validation/storage, all15 outcomes/actions, warning reviewer-only notices, no private comments in events, idempotent retry, malformed and Rev3 rejection, authorization/portal denial, non-fatal notification failure, personal admin history and unchanged generic forms.');
