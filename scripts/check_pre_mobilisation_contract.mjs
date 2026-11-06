import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const checks = [];
let failures = 0;

function check(label, callback) {
  try {
    callback();
    checks.push([label, true]);
  } catch (error) {
    checks.push([`${label}: ${error.message}`, false]);
    failures += 1;
  }
}

async function importChecklistContract() {
  // Next.js transpiles .js as ESM; a data URL runs the dependency-free contract
  // in Node without changing package.json or the application's configuration.
  const source = read("lib/preMobilisationChecklist.js");
  return import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
}

const contract = await importChecklistContract();
const component = read("components/PreMobilisationChecklistForm.js");
const route = read("app/api/whs-forms/route.js");
const sql = read("sql/2026-11-06-pre-mobilisation-rev4-biological.sql");

const expectedIds = [
  ...Array.from({ length: 13 }, (_, index) => `V${index + 1}`),
  ...Array.from({ length: 9 }, (_, index) => `E${index + 1}`),
  ...Array.from({ length: 10 }, (_, index) => `T${index + 1}`),
  ...Array.from({ length: 8 }, (_, index) => `P${index + 1}`),
];
const biologicalWording = [
  "Site information and client hazard information reviewed",
  "Previous vector observations / hotspots checked",
  "Season, rainfall, humidity, vegetation and water conditions considered",
  "Animal activity, faeces, carcasses, nests and hives considered",
  "Contaminated water, soil, sediment or mould risks assessed",
  "Relevant public health alerts checked",
  "Site-specific risk assessment / SWMS / JSA completed and communicated",
  "Access, evacuation, nearest medical facility and retrieval time confirmed",
  "Mobile / satellite communications tested and check-in plan confirmed",
  "Team consultation and relevant individual emergency plans addressed confidentially",
  "PPE, clothing, repellent and hygiene supplies checked",
  "First aid kit and hazard-specific supplies checked",
  "Emergency contacts, GPS coordinates and site ERP available",
  "Toolbox talk completed, including snakebite and anaphylaxis response where relevant",
  "Decontamination, clothing and equipment cleaning arrangements planned",
];
const biologicalIds = biologicalWording.map((_, index) => `B${index + 1}`);

check("controlled document identity is EC-OPS-PMC-001 Rev 4", () => {
  assert.equal(contract.PRE_MOBILISATION_DOCUMENT_CODE, "EC-OPS-PMC-001");
  assert.equal(contract.PRE_MOBILISATION_DOCUMENT_REVISION, 4);
  assert.equal(contract.PRE_MOBILISATION_DOCUMENT_LABEL, "EC-OPS-PMC-001 Rev 4");
});

check("the original 40 V/E/T/P rows and Pass/Fail/N/A outcomes remain fixed and ordered", () => {
  assert.deepEqual(contract.PRE_MOBILISATION_ROW_IDS, expectedIds);
  assert.equal(contract.PRE_MOBILISATION_ROWS.length, 40);
  assert.deepEqual(contract.CHECK_OUTCOMES, ["pass", "fail", "na"]);
});

check("biological rows are separate, ordered B1-B15 and use the exact user wording", () => {
  assert.deepEqual(contract.BIOLOGICAL_CHECK_OUTCOMES, ["yes", "no", "na"]);
  assert.deepEqual(contract.PRE_FIELDWORK_BIOLOGICAL_ROW_IDS, biologicalIds);
  assert.deepEqual(contract.PRE_FIELDWORK_BIOLOGICAL_SECTION, {
    id: "biological", title: "Pre-fieldwork biological hazard checklist",
    rows: biologicalWording.map((text, index) => ({ id: biologicalIds[index], check: text })),
  });
});

check("empty forms contain all 55 unanswered rows without inventing completion", () => {
  const form = contract.createEmptyPreMobilisationForm();
  assert.deepEqual(form.checks, expectedIds.map((id) => ({ id, outcome: "", action: "" })));
  assert.deepEqual(form.biologicalChecks, biologicalIds.map((id) => ({ id, outcome: "", action: "" })));
  form.biologicalChecks[0].outcome = "yes";
  assert.equal(contract.createEmptyPreMobilisationForm().biologicalChecks[0].outcome, "");
});

check("source links retain weather, fire, traffic, air quality, hazards and storm information", () => {
  assert.equal(contract.PRE_MOBILISATION_SOURCE_LINKS.length, 6);
  for (const source of contract.PRE_MOBILISATION_SOURCE_LINKS) assert.match(source.href, /^https:\/\//);
});

function validForm() {
  const form = contract.createEmptyPreMobilisationForm();
  form.metadata = {
    project: "Wetland survey", jobNumber: "EC-1234", location: "Wollongong", date: "2026-11-06",
    departureTime: "07:30", expectedReturnTime: "17:00", completedBy: "Alex Example", additionalStaff: "Sam Example",
    communicationOfficer: "Casey, 07:10", vehicleRegistration: "EC-001", vehicleType: "4WD wagon", odometer: "42510", vehicleLogBook: "Yes",
  };
  form.checks = form.checks.map((row) => ({ ...row, outcome: "pass" }));
  form.biologicalChecks = form.biologicalChecks.map((row) => ({ ...row, outcome: "yes" }));
  form.conditions = {
    weatherConditions: "Sunny / Clear", comments: "", fireDangerRating: "Moderate",
    lightningStormActivity: "No activity within 30 km", liveTrafficHazardsChecked: true, mobileCoverage: "Full",
  };
  form.approval = {
    name: "Alex Example", position: "Field Ecologist", signedAt: "2026-11-06T07:15",
    signature: "data:image/png;base64,c2lnbmF0dXJl", failedItemsAction: "",
  };
  form.proceedStatus = "cleared";
  return form;
}

function rejected(form, label) {
  const result = contract.normalisePreMobilisationDetails(form);
  assert.equal(result.details, null, label);
  assert.ok(result.errors.length, label);
}

check("valid Rev 4 submission normalizes both arrays and does not mutate its input", () => {
  const form = validForm();
  form.biologicalChecks[0].action = "  Confirmation only  ";
  const original = structuredClone(form);
  const result = contract.normalisePreMobilisationDetails(form);
  assert.deepEqual(result.errors, []);
  assert.equal(result.details.proceedStatus, "cleared");
  assert.deepEqual(result.details.checks.map((row) => row.id), expectedIds);
  assert.deepEqual(result.details.biologicalChecks.map((row) => row.id), biologicalIds);
  assert.equal(result.details.biologicalChecks[0].action, "Confirmation only");
  assert.deepEqual(form, original);
  assert.deepEqual(contract.preMobilisationValidationMessages(result.details), []);
});

check("a core Fail retains its row-action, Office-summary and blocked-status semantics", () => {
  const form = validForm();
  form.checks[0].outcome = "fail";
  form.proceedStatus = "blocked";
  let result = contract.normalisePreMobilisationDetails(form);
  assert.ok(result.errors.some((message) => /corrective action/.test(message)));
  assert.ok(result.errors.some((message) => /Office/.test(message)));
  form.checks[0].action = "Vehicle removed from service; Office notified at 07:20.";
  form.approval.failedItemsAction = "V1 failed. Office instruction received not to proceed.";
  result = contract.normalisePreMobilisationDetails(form);
  assert.deepEqual(result.errors, []);
  assert.equal(result.details.proceedStatus, "blocked");
});

check("biological No requires per-row comments/action and the existing Office summary", () => {
  const form = validForm();
  form.biologicalChecks[9].outcome = "no";
  form.proceedStatus = "blocked";
  let result = contract.normalisePreMobilisationDetails(form);
  assert.ok(result.errors.some((message) => /biological No.*comments \/ action/.test(message)));
  assert.ok(result.errors.some((message) => /Office/.test(message)));
  form.biologicalChecks[9].action = "Consultation process pending; contact Office before travel.";
  assert.ok(contract.normalisePreMobilisationDetails(form).errors.some((message) => /Office/.test(message)));
  form.approval.failedItemsAction = "B10 No. Office notified; instructed not to depart.";
  result = contract.normalisePreMobilisationDetails(form);
  assert.deepEqual(result.errors, []);
  assert.equal(result.details.proceedStatus, "blocked");
  form.proceedStatus = "cleared";
  rejected(form, "Office instructions cannot clear a No answer");
});

check("combined failures report both actions and every failed/No row needs its own action", () => {
  const form = validForm();
  form.checks[0].outcome = "fail";
  form.biologicalChecks[0].outcome = "no";
  form.biologicalChecks[1].outcome = "no";
  form.proceedStatus = "blocked";
  const messages = contract.preMobilisationValidationMessages(form);
  assert.ok(messages.some((message) => /failed item.*corrective action/.test(message)));
  assert.ok(messages.some((message) => /biological No.*comments \/ action/.test(message)));
  assert.ok(messages.some((message) => /failed items and biological No.*Office/.test(message)));
  form.checks[0].action = "Stop; Office notified.";
  form.biologicalChecks[0].action = "Review pending; stop.";
  form.approval.failedItemsAction = "V1, B1 and B2 unresolved; Office instructed not to proceed.";
  rejected(form, "B2 still needs its own action");
  form.biologicalChecks[1].action = "Review hotspot information before mobilisation.";
  assert.deepEqual(contract.normalisePreMobilisationDetails(form).errors, []);
});

check("proceed status accepts the optional biological argument without changing core behavior", () => {
  assert.equal(contract.preMobilisationProceedStatus([{ outcome: "fail" }]), "blocked");
  assert.equal(contract.preMobilisationProceedStatus([{ outcome: "pass" }]), "cleared");
  assert.equal(contract.preMobilisationProceedStatus([], [{ outcome: "no" }]), "blocked");
  assert.equal(contract.preMobilisationProceedStatus([{ outcome: "fail" }], [{ outcome: "yes" }]), "blocked");
  assert.equal(contract.preMobilisationProceedStatus([], [{ outcome: "na" }]), "cleared");
  assert.equal(contract.preMobilisationProceedStatus(null, [null]), "cleared");
  const form = validForm(); delete form.proceedStatus;
  assert.equal(contract.normalisePreMobilisationDetails(form).details.proceedStatus, "cleared");
  for (const status of [null, "", false, "blocked"]) {
    const malformed = validForm(); malformed.proceedStatus = status;
    rejected(malformed, `invalid declared status ${status}`);
  }
});

check("N/A is valid but does not fill unanswered checks or cancel a Fail/No", () => {
  const form = validForm();
  form.checks.forEach((row) => { row.outcome = "na"; });
  form.biologicalChecks.forEach((row) => { row.outcome = "na"; });
  assert.deepEqual(contract.normalisePreMobilisationDetails(form).errors, []);
  form.biologicalChecks[0].outcome = "";
  rejected(form, "unanswered biological row");
  assert.ok(contract.preMobilisationValidationMessages(form).some((message) => /Yes, No or N\/A/.test(message)));
  form.biologicalChecks[0].outcome = "na";
  form.checks[0].outcome = "";
  rejected(form, "unanswered controlled row");
  form.checks[0] = { ...form.checks[0], outcome: "fail", action: "Stop." };
  form.proceedStatus = "blocked";
  form.approval.failedItemsAction = "Office notified; do not proceed.";
  assert.equal(contract.normalisePreMobilisationDetails(form).details.proceedStatus, "blocked");
});

for (const field of ["checks", "biologicalChecks"]) {
  check(`${field} rejects missing, malformed, extra, duplicate, unknown and reordered rows`, () => {
    const cases = [
      ["missing array", (form) => { delete form[field]; }],
      ...[null, {}, "invalid", 42].map((value) => ["not array", (form) => { form[field] = value; }]),
      ["missing row", (form) => { form[field].pop(); }],
      ["extra row", (form) => { form[field].push({ ...form[field][0] }); }],
      ["duplicate ID", (form) => { form[field][1].id = form[field][0].id; }],
      ["unknown ID", (form) => { form[field][0].id = "X1"; }],
      ["reordered", (form) => { [form[field][0], form[field][1]] = [form[field][1], form[field][0]]; }],
      ["extra key", (form) => { form[field][0].untrusted = true; }],
      ["missing ID", (form) => { delete form[field][0].id; }],
      ["missing outcome", (form) => { delete form[field][0].outcome; }],
      ["missing action", (form) => { delete form[field][0].action; }],
      ["long action", (form) => { form[field][0].action = "x".repeat(1001); }],
      ...[null, [], "row", 12, true].map((value) => ["malformed row", (form) => { form[field][0] = value; }]),
      ...[null, false, [], {}].map((value) => ["malformed action", (form) => { form[field][0].action = value; }]),
      ...["", "YES", "invalid", null, 1, ...(field === "checks" ? ["yes", "no"] : ["pass", "fail"])].map((value) => ["invalid answer", (form) => { form[field][0].outcome = value; }]),
      ["sparse array", (form) => { delete form[field][0]; }],
    ];
    for (const [label, mutate] of cases) {
      const form = validForm(); mutate(form);
      rejected(form, `${field}: ${label}`);
      assert.doesNotThrow(() => contract.preMobilisationValidationMessages(form));
    }
  });
}

check("old revisions, unexpected fields and existing invalid condition values remain rejected", () => {
  for (const revision of [2, 3, "4", null]) {
    const form = validForm(); form.documentRevision = revision; rejected(form, `revision ${revision}`);
  }
  const extra = validForm(); extra.untrusted = "no"; rejected(extra, "extra top-level key");
  const invalidCoverage = validForm(); invalidCoverage.conditions.mobileCoverage = "Inconsistent"; rejected(invalidCoverage, "coverage");
  const uncheckedTraffic = validForm(); uncheckedTraffic.conditions.liveTrafficHazardsChecked = false; rejected(uncheckedTraffic, "traffic");
});

check("client form retains existing per-row actions, signature capture, source links and native print", () => {
  assert.match(component, /SignaturePad/);
  assert.match(component, /window\.print\(\)/);
  assert.match(component, /Corrective action \/ comment/);
  assert.match(component, /PRE_MOBILISATION_SOURCE_LINKS/);
  assert.match(component, /PROCEEDING BLOCKED/);
  assert.match(component, /fieldset className="pmc-outcomes"/);
  assert.match(component, /Live Traffic and Hazards Near Me checked/);
  assert.match(component, /MOBILE_COVERAGE_OPTIONS/);
  assert.match(component, /PRE_MOBILISATION_SECTIONS\.map/);
  assert.match(component, /section\.rows\.map/);
});

check("generic WHS API scopes strict validation to pre_mobilisation and retains idempotency", () => {
  assert.match(route, /if \(b\.form_type === "pre_mobilisation"\)/);
  assert.match(route, /normalisePreMobilisationDetails\(details\)/);
  assert.match(route, /whs_forms_created_by_submission_key_uidx/);
  assert.match(route, /duplicate: true/);
});

check("Rev 4 DB integrity is scoped, fail-closed, legacy-preserving and repeat-safe", () => {
  assert.match(sql, /form_type <> 'pre_mobilisation'/);
  assert.match(sql, /EC-OPS-PMC-001/);
  assert.match(sql, /in \('2', '3'\)/);
  assert.match(sql, /jsonb_array_length\(p_details -> 'checks'\) <> 40/);
  assert.match(sql, /jsonb_array_length\(p_details -> 'biologicalChecks'\) <> 15/);
  assert.match(sql, /immutable/);
  assert.match(sql, /check \(coalesce\(/);
  assert.match(sql, /not valid/);
  assert.match(sql, /create unique index if not exists whs_forms_created_by_submission_key_uidx/);
  assert.doesNotMatch(sql, /^\s*(?:update|delete|insert|drop index)\b/im);
});

for (const [label, passed] of checks) console.log(`${passed ? "PASS" : "FAIL"}  ${label}`);
if (failures) {
  console.error(`\nPre-Mobilisation Checklist contract failed (${failures} failure${failures === 1 ? "" : "s"}).`);
  process.exitCode = 1;
} else {
  console.log("\nPre-Mobilisation Checklist contract passed.");
}
