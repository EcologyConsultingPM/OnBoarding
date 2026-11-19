import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  inferTimesheetColumnMap,
  mapRawTimesheetRows,
  normaliseImportNumber,
  normaliseWorkDate,
  timesheetDuplicateKey,
  decimalImportFixed2,
} from "../lib/projectTimesheetImport.js";
import { projectOperationsBudgetSync } from "../lib/projectSetupBudgetBasis.js";

const root = new URL("..", import.meta.url);
const [importRoute, trackerRoute, adminEntriesRoute, trackerComponent, operationsRoute, operationsComponent, styles] = await Promise.all([
  readFile(new URL("app/api/admin/project-tracker-timesheet-import/route.js", root), "utf8"),
  readFile(new URL("app/api/admin/project-tracker/route.js", root), "utf8"),
  readFile(new URL("app/api/admin/project-tracker-entries/route.js", root), "utf8"),
  readFile(new URL("components/AdminProjectTracker.js", root), "utf8"),
  readFile(new URL("app/api/projects/[projectId]/route.js", root), "utf8"),
  readFile(new URL("components/AdminProjectSetup.js", root), "utf8"),
  readFile(new URL("app/globals.css", root), "utf8"),
]);

const headers = ["Work Date", "Employee Name", "Client", "Project Name", "Project Number", "Total Hours", "Kilometres", "Activity Category", "Comments"];
const mapping = inferTimesheetColumnMap(headers);
assert.deepEqual(mapping, {
  workDate: 0,
  staffName: 1,
  clientName: 2,
  projectName: 3,
  projectNumber: 4,
  hours: 5,
  km: 6,
  activityCategory: 7,
  comments: 8,
}, "Australian weekly timesheet column names should auto-map to import fields.");

const mappedRows = mapRawTimesheetRows([{ rowNumber: 4, values: ["19/11/2026", "Alex Ng", "Mallee Shire", "Creek Survey", "EC-204", 7.5, 42, "Field survey", "Waterway assessment"] }], mapping);
assert.equal(mappedRows.length, 1);
assert.equal(mappedRows[0].sourceRow, 4);
assert.equal(mappedRows[0].projectNumber, "EC-204");
assert.equal(mappedRows[0].km, 42);
assert.equal(normaliseWorkDate("19/11/2026"), "2026-11-19", "Ambiguous dates must follow the staff portal's day/month/year convention.");
assert.equal(normaliseWorkDate("2026-11-19T00:00:00"), "2026-11-19");
assert.equal(normaliseWorkDate("31/11/2026"), "", "Invalid calendar dates must be rejected.");
assert.equal(normaliseImportNumber("7,5"), 7.5, "Comma decimals should be accepted for Australian CSVs.");
assert.equal(normaliseImportNumber("1,234"), 1234, "Comma-grouped kilometre values should retain their thousands magnitude.");
assert.equal(decimalImportFixed2(1.005), "1.01", "Duplicate keys must use the same decimal half-up rounding as SQL.");
assert.equal(normaliseImportNumber("-2"), Number.NaN);
assert.equal(normaliseImportNumber("", { allowBlank: true }), null);

const duplicateA = timesheetDuplicateKey({ workDate: "2026-11-19", staffUserId: "staff-1", projectId: "project-1", activityCategory: "Field Survey", hours: 7.5, km: 42, comments: "Waterway assessment" });
const duplicateB = timesheetDuplicateKey({ workDate: "2026-11-19", staffUserId: "staff-1", projectId: "project-1", activityCategory: " field   survey ", hours: "7.50", km: "42.00", comments: "Waterway assessment" });
assert.equal(duplicateA, duplicateB, "Duplicate keys should normalize activity text and numeric precision.");

const original = { id: "original-source", source_type: "original", approval_status: "approved", approved_value: 5000, approved_hours: 100, service_period_start: null, service_period_end: null };
const variation = { id: "variation-source", source_type: "variation", approval_status: "approved", approved_value: 900, approved_hours: 20, service_period_start: null, service_period_end: null };
const sync = projectOperationsBudgetSync({
  approvedSources: [original, variation],
  allSources: [original, variation],
  body: { budgetHours: "120.50", budgetDollars: "6500.00" },
  masterBudgetChanged: true,
});
assert.equal(sync.sourceId, original.id, "Project Operations should update only the unique approved original source.");
assert.deepEqual(sync.patch, { approved_hours: 120.5, approved_value: 6500 });
assert.equal(sync.synchronized, true);
assert.equal(sync.patch.approved_value, 6500, "Approved variations remain additive and are not folded into the original source.");

const monthlySync = projectOperationsBudgetSync({
  approvedSources: [{ ...original, service_period_start: "2026-11-01", service_period_end: "2026-11-30" }],
  allSources: [{ ...original, service_period_start: "2026-11-01", service_period_end: "2026-11-30" }],
  body: { budgetHours: "200", budgetDollars: "10000" },
  monthlyBudgetControlled: true,
  masterBudgetChanged: true,
});
assert.equal(monthlySync.sourceId, "", "Monthly source budgets must remain under the established monthly baseline workflow.");
assert.equal(monthlySync.synchronized, false);

const noUniqueOriginal = projectOperationsBudgetSync({
  approvedSources: [variation],
  allSources: [variation],
  body: { budgetHours: "130", budgetDollars: "8000" },
  masterBudgetChanged: true,
});
assert.equal(noUniqueOriginal.status, 409, "A changed project master with no unique original source must be rejected clearly.");
assert.match(noUniqueOriginal.error, /no unique approved original-scope baseline/i);
const invalidBudget = projectOperationsBudgetSync({ approvedSources: [original], allSources: [original], body: { budgetHours: "1e3" }, masterBudgetChanged: true });
assert.equal(invalidBudget.status, 400);
assert.equal(projectOperationsBudgetSync({ allSources: [], body: { budgetHours: "1" }, masterBudgetChanged: true }).synchronized, false, "Legacy projects without source rows retain their existing workflow.");

assert.match(importRoute, /access\.isAdmin/, "Only administrators may import timesheets.");
assert.match(importRoute, /requirePortalResource\(access, "admin.projects.tracker"\)/, "Explicit Project Tracker resource denials must prevent uploads, previews and imports.");
assert.match(importRoute, /\.eq\("status", "active"\)/, "Imports must only route rows to active projects.");
assert.match(importRoute, /\.is\("deleted_at", null\)/, "Deleted projects must not appear as import targets.");
assert.match(importRoute, /inferTimesheetColumnMap/, "The upload workflow must detect header rows and map columns.");
assert.match(importRoute, /findExistingDuplicates/, "The preview must detect existing tracker duplicates.");
assert.match(importRoute, /seenInFile/, "The preview must detect duplicates within the uploaded file.");
assert.match(importRoute, /Source client name does not match/, "A mismatched source client should be visibly flagged for administrator review.");
assert.match(importRoute, /entered_by_admin_id: access\.user\.id/, "Imported entries must retain their administrator provenance.");
assert.match(importRoute, /import_batch_id: batchId/, "Imported entries must retain a batch identifier.");
assert.match(importRoute, /import_source_row: row\.sourceRow/, "Imported entries must retain source-row provenance.");
assert.match(importRoute, /\{ km: row\.km \}/, "Kilometres must be retained on each imported entry.");
assert.match(importRoute, /blocked\.length \|\| !preview\.rows\.length/, "Rows with unresolved matches or duplicates must not be imported.");
const importMigration = await readFile(new URL("sql/2026-11-19-timesheet-import-atomic.sql", root), "utf8");
assert.match(importRoute, /rpc\("ec_import_weekly_timesheets"/, "Entries, totals and notifications must commit atomically.");
assert.match(importMigration, /hours_consumed=round\(consumed,2\)/, "Imports must recalculate affected allocation consumption and spend.");
assert.match(importMigration, /'project_tracker_entry_on_behalf'/, "Affected staff must receive a committed import notification.");
assert.match(importMigration, /project_tracker_import_fingerprint_unique/, "Concurrent duplicate submissions must be rejected by a unique database index.");
assert.match(importRoute, /ambiguous_budget_allocation/, "Multiple matching original or variation sources must require explicit resolution.");
assert.match(importRoute, /MAX_IMPORT_ROWS = 1000/, "The upload must enforce a bounded import size.");

assert.match(trackerRoute, /notable_issues, custom_data, created_at/, "The admin tracker response must return custom data for imported km values.");
assert.match(trackerComponent, /<AdminTimesheetImporter session=\{session\}/, "The importer must be accessible from Project Tracker timesheets.");
assert.match(trackerComponent, /Kilometres recorded/, "The timesheet summary should surface kilometres.");
assert.match(trackerComponent, /entry\.custom_data\?\.km/, "The timesheet table should display imported kilometres.");
assert.match(trackerComponent, /PROJECT_SOURCES_CHANGED/, "Project Tracker should refresh when Project Operations updates budgets.");
assert.match(adminEntriesRoute, /refreshProjectTrackerAllocation/, "Admin corrections and deletes must use the same full-history allocation recalculation.");

assert.match(operationsRoute, /projectOperationsBudgetSync/, "Project Operations budget changes must resolve their tracker baseline.");
const budgetMigration = await readFile(new URL("sql/2026-11-19-project-budget-save-atomic.sql", root), "utf8");
assert.match(operationsRoute, /rpc\("ec_save_project_original_budget"/, "Project and original-source budget edits must commit atomically.");
assert.match(budgetMigration, /s\.approval_status = 'approved'/, "Budget sync must update only the currently approved original source.");
assert.match(budgetMigration, /s\.source_type = 'original'/, "Budget sync must never update a variation source.");
assert.match(operationsComponent, /approved original-scope Project Tracker budget was synchronised/, "Admins must be told when the tracker baseline was synchronized.");
assert.match(styles, /\.ati-map-grid[\s\S]*?@media \(max-width: 640px\)/, "The importer must have responsive column-mapping and preview styles.");

console.log("Bulk weekly timesheet import and Project Operations budget-sync contract passed.");
