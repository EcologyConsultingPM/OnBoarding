import assert from 'node:assert/strict';
import { inferTimesheetColumnMap, mapRawTimesheetRows, normaliseWorkDate } from '../lib/projectTimesheetImport.js';
import { reconcileTimesheetRows, timesheetWeekStart, timesheetWeekEnd } from '../lib/projectTimesheetReconciliation.js';

const headers = ['Date','Employee','Client','Job#','Client job','Hours','Expenses','Kms','Vehicle','Task','Notes'];
const mapping = inferTimesheetColumnMap(headers);
assert.deepEqual(mapping, {workDate:0,staffName:1,clientName:2,projectName:4,projectNumber:3,hours:5,expenses:6,km:7,vehicle:8,activityCategory:9,comments:10});
const sourceRows = [
  {rowNumber:2,values:['5/11/2026','Gerard Dwyer','IQon Pty Ltd','1597','Wastewater Pond Upgrade ACT',0.25,'','','','External consultation','Consultation on access and visit timing']},
  {rowNumber:3,values:['30/10/2026','Gerard Dwyer','IQon Pty Ltd','1597','Wastewater Pond Upgrade ACT',0.75,25,35,'EC01','Quotes and tenders','Client consultation and Quoting']},
];
const mapped = mapRawTimesheetRows(sourceRows,mapping);
assert.equal(mapped[0].projectNumber,'1597');assert.equal(mapped[0].projectName,'Wastewater Pond Upgrade ACT');
assert.equal(normaliseWorkDate(mapped[0].workDate),'2026-11-05');assert.equal(normaliseWorkDate(mapped[1].workDate),'2026-10-30');
assert.equal(mapped[1].expenses,25);assert.equal(mapped[1].vehicle,'EC01');assert.equal(mapped[1].sourceTask,'Quotes and tenders');
assert.equal(timesheetWeekStart('2026-11-05'),'2026-11-02');assert.equal(timesheetWeekEnd('2026-11-05'),'2026-11-08');
assert.equal(timesheetWeekStart('2026-11-08'),'2026-11-02');
const base = {sourceRow:2,workDate:'2026-11-05',projectId:'p',staffUserId:'s',staffLabel:'Gerard Dwyer',projectLabel:'Pond upgrade',activityCategory:'External consultation',hours:1,km:null,comments:'Visit timing',chargeAmount:220,duplicateDecision:'',duplicateReason:'',duplicateReviewToken:'',issues:[],warnings:[]};
const row = (patch={}) => ({...base,...patch,issues:[],warnings:[]});
const existing = (patch={}) => ({id:'entry1',work_date:base.workDate,project_id:'p',staff_user_id:'s',activity_category:base.activityCategory,hours:1,activity_information:base.comments,custom_data:{},updated_at:'2026-11-06T00:00:00Z',...patch});
let result = reconcileTimesheetRows([row()],[existing()]);
assert.equal(result.rows[0].issues[0].code,'duplicate_existing');assert.equal(result.rows[0].isSkipped,true);assert.equal(result.rows[0].isImportable,false);
assert.equal(result.reconciliation[0].newHours,0);assert.equal(result.reconciliation[0].resultingHours,1);
result = reconcileTimesheetRows([row({comments:'Completed consultation on visit timing',km:35})],[existing()]);
assert.equal(result.rows[0].possibleDuplicates.length,1);assert.equal(result.rows[0].duplicateDecision,'skip');assert.equal(result.rows[0].isImportable,false);
assert.equal(result.reconciliation[0].excludedHours,1);
let separate = {...result.rows[0],duplicateDecision:'separate',duplicateReason:'This was a second consultation later that day.'};
result = reconcileTimesheetRows([{...separate,issues:[],warnings:[]}],[existing()]);
assert.equal(result.rows[0].isImportable,true);assert.equal(result.reconciliation[0].resultingHours,2);
result = reconcileTimesheetRows([{...separate,issues:[],warnings:[]}],[existing({hours:2})]);
assert.equal(result.rows[0].isImportable,false);assert(result.rows[0].issues.some(i=>i.code==='duplicate_review_changed'));
result = reconcileTimesheetRows([row({hours:3,chargeAmount:660})],[existing({id:'a',hours:1}),existing({id:'b',hours:2,activity_information:'Second segment'})]);
assert.equal(result.rows[0].possibleDuplicates.length,2);assert.equal(result.rows[0].isSkipped,true);assert.equal(result.reconciliation[0].existingHours,3);assert.equal(result.reconciliation[0].resultingHours,3);
result = reconcileTimesheetRows([row({hours:1}),row({sourceRow:3,hours:2,comments:'Second segment',chargeAmount:440})],[existing({hours:3})]);
assert(result.rows.every(r=>r.isSkipped));assert.equal(result.reconciliation[0].uploadHours,3);assert.equal(result.reconciliation[0].excludedHours,3);
result = reconcileTimesheetRows([row(),row({sourceRow:3,hours:2,comments:'Later consultation',chargeAmount:440})],[]);
assert(result.rows.every(r=>r.isSkipped));assert(result.rows.every(r=>r.fileOverlaps.length===1));
const approved = result.rows.map(r=>({...r,duplicateDecision:'separate',duplicateReason:'Separate meetings with different participants.',issues:[],warnings:[]}));
result = reconcileTimesheetRows(approved,[]);assert(result.rows.every(r=>r.isImportable));assert.equal(result.reconciliation[0].newHours,3);
result = reconcileTimesheetRows([row(),row({sourceRow:3})],[]);
assert.equal(result.rows[0].isImportable,true);assert.equal(result.rows[1].isSkipped,true,'Only a repeated exact copy is dropped; the first new row remains eligible.');
result = reconcileTimesheetRows([row({workDate:'2026-11-06'})],[existing()]);assert.equal(result.rows[0].isImportable,true);assert.equal(result.reconciliation[0].existingHours,1,'Earlier staff time in the same week is included in reconciliation even on another work date.');
console.log('XLS heading mapping and reconciliation passed: prior staff exact/near matches, changed notes/km/hours, split totals, file overlaps, explicit reasons, stale reviews and weekly balances.');
