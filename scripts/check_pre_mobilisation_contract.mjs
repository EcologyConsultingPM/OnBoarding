import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

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
  // The Next.js app transpiles .js source as ESM, while this repository does
  // not declare package type=module. A data URL lets this deterministic Node
  // contract test run the same dependency-free source without changing config.
  const source = read("lib/preMobilisationChecklist.js");
  return import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
}

const contract = await importChecklistContract();
const component = read("components/PreMobilisationChecklistForm.js");
const route = read("app/api/whs-forms/route.js");
const sql = read("sql/2026-09-17-pre-mobilisation-rev3-conditions.sql");

const expectedIds = [
  ...Array.from({ length: 13 }, (_, index) => `V${index + 1}`),
  ...Array.from({ length: 9 }, (_, index) => `E${index + 1}`),
  ...Array.from({ length: 10 }, (_, index) => `T${index + 1}`),
  ...Array.from({ length: 8 }, (_, index) => `P${index + 1}`),
];

check("controlled document identity is EC-OPS-PMC-001 Rev 3", () => {
  assert.equal(contract.PRE_MOBILISATION_DOCUMENT_CODE, "EC-OPS-PMC-001");
  assert.equal(contract.PRE_MOBILISATION_DOCUMENT_REVISION, 3);
});

check("all required V1-V13, E1-E9, T1-T10 and P1-P8 rows are fixed and ordered", () => {
  assert.deepEqual(contract.PRE_MOBILISATION_ROW_IDS, expectedIds);
  assert.equal(contract.PRE_MOBILISATION_ROWS.length, 40);
});

check("every controlled row has a Pass, Fail and N/A outcome", () => {
  assert.deepEqual(contract.CHECK_OUTCOMES, ["pass", "fail", "na"]);
});

check("source links cover weather, fire, traffic, air quality, hazards and storm conditions", () => {
  assert.equal(contract.PRE_MOBILISATION_SOURCE_LINKS.length, 6);
  for (const source of contract.PRE_MOBILISATION_SOURCE_LINKS) assert.match(source.href, /^https:\/\//);
});

function validForm() {
  const form = contract.createEmptyPreMobilisationForm();
  form.metadata = {
    project: "Wetland survey", jobNumber: "EC-1234", location: "Wollongong", date: "2026-09-16",
    departureTime: "07:30", expectedReturnTime: "17:00", completedBy: "Alex Example", additionalStaff: "Sam Example",
    communicationOfficer: "Casey, 07:10", vehicleRegistration: "EC-001", vehicleType: "4WD wagon", odometer: "42510", vehicleLogBook: "Yes",
  };
  form.checks = form.checks.map((row) => ({ ...row, outcome: "pass" }));
  form.conditions = {
    weatherConditions: "Sunny / Clear", comments: "", fireDangerRating: "Moderate",
    lightningStormActivity: "No activity within 30 km", liveTrafficHazardsChecked: true,
    mobileCoverage: "Full",
  };
  form.approval = {
    name: "Alex Example", position: "Field Ecologist", signedAt: "2026-09-16T07:15",
    signature: "data:image/png;base64,c2lnbmF0dXJl", failedItemsAction: "",
  };
  form.proceedStatus = "cleared";
  return form;
}

check("valid controlled submission normalizes to the fixed stored contract", () => {
  const result = contract.normalisePreMobilisationDetails(validForm());
  assert.deepEqual(result.errors, []);
  assert.equal(result.details.proceedStatus, "cleared");
  assert.deepEqual(result.details.checks.map((row) => row.id), expectedIds);
});

check("a failed row requires a row action and approval summary and is stored as blocked", () => {
  const form = validForm();
  form.checks[0] = { ...form.checks[0], outcome: "fail" };
  form.proceedStatus = "blocked";
  let result = contract.normalisePreMobilisationDetails(form);
  assert.ok(result.errors.some((message) => /corrective action/.test(message)));
  form.checks[0].action = "Vehicle removed from service; Office notified at 07:20.";
  form.approval.failedItemsAction = "V1 failed. Office notified at 07:20; instruction received not to proceed.";
  result = contract.normalisePreMobilisationDetails(form);
  assert.deepEqual(result.errors, []);
  assert.equal(result.details.proceedStatus, "blocked");
});

check("revision, unexpected fields, invalid enums and reordered rows are rejected", () => {
  const revision = validForm(); revision.documentRevision = 2;
  assert.ok(contract.normalisePreMobilisationDetails(revision).errors.length);
  const extra = validForm(); extra.untrusted = "no";
  assert.ok(contract.normalisePreMobilisationDetails(extra).errors.length);
  const enumValue = validForm(); enumValue.checks[0].outcome = "yes";
  assert.ok(contract.normalisePreMobilisationDetails(enumValue).errors.length);
  const reordered = validForm(); [reordered.checks[0], reordered.checks[1]] = [reordered.checks[1], reordered.checks[0]];
  assert.ok(contract.normalisePreMobilisationDetails(reordered).errors.length);
  const invalidCoverage = validForm(); invalidCoverage.conditions.mobileCoverage = "Inconsistent";
  assert.ok(contract.normalisePreMobilisationDetails(invalidCoverage).errors.length);
  const uncheckedTraffic = validForm(); uncheckedTraffic.conditions.liveTrafficHazardsChecked = false;
  assert.ok(contract.normalisePreMobilisationDetails(uncheckedTraffic).errors.length);
});

check("client form provides per-row actions, signature capture, source links and native print", () => {
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

check("generic WHS API scopes strict validation to pre_mobilisation and retains submission idempotency", () => {
  assert.match(route, /if \(b\.form_type === "pre_mobilisation"\)/);
  assert.match(route, /normalisePreMobilisationDetails\(details\)/);
  assert.match(route, /whs_forms_created_by_submission_key_uidx/);
  assert.match(route, /duplicate: true/);
});

check("database integrity check is limited to pre_mobilisation and preserves idempotency index", () => {
  assert.match(sql, /form_type <> 'pre_mobilisation'/);
  assert.match(sql, /EC-OPS-PMC-001/);
  assert.match(sql, /'2', '3'/);
  assert.match(sql, /jsonb_array_length\(details -> 'checks'\) = 40/);
  assert.match(sql, /whs_forms_created_by_submission_key_uidx/);
});

for (const [label, passed] of checks) console.log(`${passed ? "PASS" : "FAIL"}  ${label}`);
if (failures) {
  console.error(`\nPre-Mobilisation Checklist contract failed (${failures} failure${failures === 1 ? "" : "s"}).`);
  process.exitCode = 1;
} else {
  console.log("\nPre-Mobilisation Checklist contract passed.");
}
