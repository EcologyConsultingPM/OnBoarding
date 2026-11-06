import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (name) => fs.readFileSync(path.join(root, name), "utf8");
const require = createRequire(import.meta.url);
// Optional test dependency, never an application dependency or live DB client.
// Run with PGLITE_MODULE=/path/to/@electric-sql/pglite if not installed locally.
const { PGlite } = require(process.env.PGLITE_MODULE || "/home/ubuntu/tmp/closeout-db-test/node_modules/@electric-sql/pglite");
const contract = await import(`data:text/javascript;base64,${Buffer.from(read("lib/preMobilisationChecklist.js")).toString("base64")}`);
const migration = read("sql/2026-11-06-pre-mobilisation-rev4-biological.sql");
const db = new PGlite();
let assertions = 0;
let sequence = 0;

function validForm() {
  const form = contract.createEmptyPreMobilisationForm();
  Object.assign(form.metadata, {
    project: "Biological fixture", jobNumber: "TEST-4", location: "Test site", date: "2026-11-06",
    departureTime: "07:00", expectedReturnTime: "17:00", completedBy: "Test staff",
    communicationOfficer: "Office", vehicleRegistration: "TEST", vehicleType: "4WD wagon", odometer: "1000", vehicleLogBook: "Yes",
  });
  form.checks.forEach((row) => { row.outcome = "pass"; });
  form.biologicalChecks.forEach((row) => { row.outcome = "yes"; });
  Object.assign(form.conditions, {
    weatherConditions: "Sunny / Clear", fireDangerRating: "Moderate", lightningStormActivity: "None",
    liveTrafficHazardsChecked: true, mobileCoverage: "Full",
  });
  Object.assign(form.approval, {
    name: "Test staff", position: "Field staff", signedAt: "2026-11-06T06:50", signature: "data:image/png;base64,dGVzdA==",
  });
  assert.deepEqual(contract.normalisePreMobilisationDetails(form).errors, []);
  return form;
}

const insert = (details, formType = "pre_mobilisation", key = `fixture-${++sequence}`) => db.query(
  "insert into public.whs_forms (created_by, form_type, details, submission_key) values ($1, $2, $3::jsonb, $4) returning id",
  ["00000000-0000-0000-0000-000000000001", formType, details === null ? null : JSON.stringify(details), key],
);
async function accept(label, details, formType) {
  await insert(details, formType);
  assertions += 1;
  console.log(`PASS  accepts ${label}`);
}
async function reject(label, details) {
  await assert.rejects(() => insert(details), (error) => {
    assert.equal(error.code, "23514", `${label}: must reject via CHECK, not an unsafe JSON operation`);
    assert.equal(error.constraint, "whs_forms_pre_mobilisation_integrity_chk", label);
    return true;
  });
  assertions += 1;
}
const issueForm = (field, index = 0) => {
  const form = validForm();
  form[field][index].outcome = field === "checks" ? "fail" : "no";
  form[field][index].action = "Process pending; STOP and notify Office.";
  form.approval.failedItemsAction = "Office notified; instruction received not to proceed.";
  form.proceedStatus = "blocked";
  return form;
};

try {
  // Minimal real columns needed by both migrations. Deliberately nullable details
  // exercises fail-closed CHECK behavior independently of the production NOT NULL.
  await db.exec(`create table public.whs_forms (
    id integer generated always as identity primary key,
    created_by uuid not null, form_type text not null, details jsonb, submission_key text
  );`);
  const legacy2 = validForm(); legacy2.documentRevision = 2; delete legacy2.biologicalChecks;
  const legacy3 = validForm(); legacy3.documentRevision = 3; delete legacy3.biologicalChecks;
  // Old evidence may predate even the prior NOT VALID constraint.
  const oldInvalid = { documentRevision: 2, retainedHistoricalEvidence: true };
  await insert(legacy2, "pre_mobilisation", "legacy-2");
  await insert(legacy3, "pre_mobilisation", "legacy-3");
  await insert(oldInvalid, "pre_mobilisation", "legacy-unvalidated");
  await insert({ custom: [1, 2, 3] }, "incident", "unrelated-original");
  await db.exec(read("sql/2026-09-17-pre-mobilisation-rev3-conditions.sql"));
  const snapshot = await db.query("select id, form_type, details, submission_key from public.whs_forms order by id limit 100");
  const indexBefore = await db.query("select oid, indexname, indexdef from pg_indexes join pg_class on relname = indexname where schemaname = 'public' and indexname = 'whs_forms_created_by_submission_key_uidx' limit 1");
  await db.exec(migration);
  const after = await db.query("select id, form_type, details, submission_key from public.whs_forms order by id limit 100");
  assert.deepEqual(after.rows, snapshot.rows);
  assertions += 1;
  console.log("PASS  old Rev 2/3, unvalidated evidence and unrelated forms are byte-for-byte unchanged");

  await accept("valid Rev 4", validForm());
  await accept("prior Rev 2 without biological rows", legacy2);
  await accept("prior Rev 3 without biological rows", legacy3);
  const permissiveLegacy = structuredClone(legacy3);
  permissiveLegacy.checks = Array.from({ length: 40 }, () => ({ oldEvidence: "retained" }));
  await accept("original legacy 40-row semantics without imposing new row rules", permissiveLegacy);
  await accept("unrelated form with arbitrary JSON", [1, { other: true }], "near_miss");
  await accept("unrelated form with NULL details", null, "toolbox");
  const allNa = validForm();
  [...allNa.checks, ...allNa.biologicalChecks].forEach((row) => { row.outcome = "na"; });
  await accept("all N/A with complete arrays", allNa);
  await accept("core Fail with action/Office summary and blocked status", issueForm("checks"));
  await accept("biological No with action/Office summary and blocked status", issueForm("biologicalChecks", 9));
  const both = issueForm("checks");
  both.biologicalChecks[14] = { ...both.biologicalChecks[14], outcome: "no", action: "Cleaning plan pending; stop." };
  await accept("both issue kinds blocked", both);

  for (const malformed of [null, {}, [], true, 4, "invalid"]) await reject("malformed details", malformed);
  for (const field of ["documentCode", "documentRevision", "proceedStatus", "metadata", "conditions", "approval", "checks", "biologicalChecks"]) {
    const missing = validForm(); delete missing[field]; await reject(`missing ${field}`, missing);
    const nullField = validForm(); nullField[field] = null; await reject(`NULL ${field}`, nullField);
  }
  for (const field of ["project", "jobNumber", "location", "date", "vehicleRegistration"]) {
    const form = validForm(); delete form.metadata[field]; await reject(`missing metadata.${field}`, form);
  }
  for (const field of ["name", "signature", "failedItemsAction"]) {
    const form = validForm(); delete form.approval[field]; await reject(`missing approval.${field}`, form);
  }
  for (const revision of [1, 5, "4"]) {
    const form = validForm(); form.documentRevision = revision; await reject(`revision ${revision}`, form);
  }
  const extra = validForm(); extra.extra = true; await reject("unsupported Rev 4 field", extra);
  for (const field of ["checks", "biologicalChecks"]) {
    for (const value of [{}, "array", true, 42]) {
      const form = validForm(); form[field] = value; await reject(`${field} non-array`, form);
    }
    const cases = [
      ["short array", (rows) => { rows.pop(); }],
      ["extra row", (rows) => { rows.push({ ...rows[0] }); }],
      ["duplicate ID", (rows) => { rows[1].id = rows[0].id; }],
      ["unknown ID", (rows) => { rows[0].id = "X1"; }],
      ["reorder", (rows) => { [rows[0], rows[1]] = [rows[1], rows[0]]; }],
      ["extra row key", (rows) => { rows[0].extra = true; }],
      ...["id", "outcome", "action"].map((key) => [`missing ${key}`, (rows) => { delete rows[0][key]; }]),
      ["long action", (rows) => { rows[0].action = "x".repeat(1001); }],
      ...[null, [], 1, true, "row"].map((value) => ["malformed row", (rows) => { rows[0] = value; }]),
      ...[null, [], 1, true, {}].map((value) => ["non-text action", (rows) => { rows[0].action = value; }]),
      ...["", "YES", null, 1, ...(field === "checks" ? ["yes", "no"] : ["pass", "fail"])].map((value) => ["invalid outcome", (rows) => { rows[0].outcome = value; }]),
    ];
    for (const [label, mutate] of cases) {
      const form = validForm(); mutate(form[field]); await reject(`${field}: ${label}`, form);
    }
    for (const blank of ["", "   ", "\t\n"]) {
      const form = issueForm(field); form[field][0].action = blank; await reject(`${field} issue has whitespace-only action`, form);
      const summary = issueForm(field); summary.approval.failedItemsAction = blank; await reject(`${field} issue has whitespace-only Office summary`, summary);
    }
    const noAction = issueForm(field); delete noAction[field][0].action; await reject(`${field} issue missing action`, noAction);
    const noSummary = issueForm(field); delete noSummary.approval.failedItemsAction; await reject(`${field} issue missing summary`, noSummary);
    const clearedIssue = issueForm(field); clearedIssue.proceedStatus = "cleared"; await reject(`${field} issue falsely cleared`, clearedIssue);
  }
  const inconsistent = validForm(); inconsistent.proceedStatus = "blocked"; await reject("no issues falsely blocked", inconsistent);
  const otherNo = issueForm("biologicalChecks"); otherNo.biologicalChecks[1].outcome = "no";
  await reject("each No requires its own action", otherNo);
  const legacyMissing = structuredClone(legacy2); delete legacyMissing.proceedStatus;
  await reject("legacy new write missing status now fails closed", legacyMissing);
  const legacyNonArray = structuredClone(legacy3); legacyNonArray.checks = {};
  await reject("legacy malformed array fails safely", legacyNonArray);
  console.log("PASS  malformed/missing rows, answers, actions, statuses and NULL fields reject via CHECK (23514)");

  // Reapply in the same database and verify preservation plus enforcement again.
  const beforeRepeat = await db.query("select id, form_type, details, submission_key from public.whs_forms order by id limit 1000");
  await db.exec(migration);
  const afterRepeat = await db.query("select id, form_type, details, submission_key from public.whs_forms order by id limit 1000");
  assert.deepEqual(afterRepeat.rows, beforeRepeat.rows);
  const constraint = await db.query("select convalidated from pg_constraint where conname = 'whs_forms_pre_mobilisation_integrity_chk' limit 1");
  assert.equal(constraint.rows[0].convalidated, false);
  const indexAfter = await db.query("select oid, indexname, indexdef from pg_indexes join pg_class on relname = indexname where schemaname = 'public' and indexname = 'whs_forms_created_by_submission_key_uidx' limit 1");
  assert.deepEqual(indexAfter.rows, indexBefore.rows);
  const fn = await db.query("select provolatile from pg_proc join pg_namespace on pg_namespace.oid = pronamespace where nspname = 'public' and proname = 'pre_mobilisation_details_integrity_valid' limit 1");
  assert.equal(fn.rows[0].provolatile, "i");
  await accept("Rev 4 after repeated migration", validForm());
  const repeatedInvalid = validForm(); repeatedInvalid.biologicalChecks = {};
  await reject("malformed Rev 4 after repeated migration", repeatedInvalid);
  await assert.rejects(() => insert(validForm(), "pre_mobilisation", "legacy-2"), (error) => error.code === "23505");
  assertions += 5;
  console.log("PASS  repeated migration preserves all rows, NOT VALID, immutable function and the same idempotency index");
  console.log(`\nPre-Mobilisation database behavior passed (${assertions} assertions; isolated PGlite only).`);
} finally {
  await db.close();
}
