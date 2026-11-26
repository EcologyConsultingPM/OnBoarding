import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { createHash, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as XLSX from "xlsx";
import * as imports from "../lib/projectTimesheetImport.js";
import * as periods from "../lib/projectBudgetPeriods.js";
import * as reconciliation from "../lib/projectTimesheetReconciliation.js";

// All database/auth/rate/RPC behavior below is an in-memory fixture: no live calls.
const root = new URL("..", import.meta.url);
const [apiSource, uiSource] = await Promise.all([
  readFile(new URL("app/api/admin/project-tracker-timesheet-import/route.js", root), "utf8"),
  readFile(new URL("components/AdminTimesheetImporter.js", root), "utf8"),
]);
const stripImports = (source) => source.replace(/^import[\s\S]*?;\s*$/gm, "");
const id = (number) => `00000000-0000-4000-8000-${String(number).padStart(12, "0")}`;
const actor = id(1), staff = id(2), projectId = id(3), sourceId = id(4), otherProjectId = id(5);
const targets = ["General Project Management", "Fieldwork & Travel", "GIS/Mapping", "QA Review", "Desktop Assessment", "Internal Meeting", "Other"];
const rules = [
  ["External consultation", targets[0]], ["Travel", targets[1]], ["GIS/Mapping", targets[2]],
  ["Review", targets[3]], ["Desktop / Field plan", targets[4]], ["Internal consultation", targets[5]],
  ["Quotes and tenders", targets[6]],
];
assert.deepEqual(imports.TIMESHEET_IMPORT_CANONICAL_CATEGORIES, targets);
for (const [source, target] of rules) {
  const variants = [source, `  ${source.toUpperCase().replaceAll(" ", "   ")}  `, source.replaceAll("/", " - ").replaceAll(" ", ".")];
  for (const variant of variants) {
    assert.equal(imports.resolveTimesheetImportCategory(variant, [source]), target, `${variant} must beat the configured legacy source category`);
    const configured = target.toUpperCase().replaceAll("&", " / ").replaceAll("/", " - ");
    // Changing '&' to another separator keeps the same normalized category key.
    assert.equal(imports.resolveTimesheetImportCategory(variant, [configured, source]), configured);
  }
}
assert.equal(imports.resolveTimesheetImportCategory(" QOUTES --- AND TENDERS ", []), "Other");
assert.equal(imports.resolveTimesheetImportCategory("Not approved", []), "");
assert.equal(imports.timesheetImportCategoryOptions(["qa review"]).filter((value) => imports.normaliseImportText(value) === "qa review").length, 1);

let tables, currentEntries, confirmed, rpcCalls;
function reset() {
  currentEntries = [];
  confirmed = true;
  rpcCalls = [];
  tables = {
    projects: [
      { id: projectId, name: "Creek survey", client_name: "Shire", status: "active", deleted_at: null },
      { id: otherProjectId, name: "Other project", client_name: "Other client", status: "active", deleted_at: null },
    ],
    project_budget_sources: [{ id: sourceId, project_id: projectId, source_type: "original", source_name: "Original", approval_status: "approved" }],
    project_budget_allocations: targets.map((name, index) => ({ id: id(20 + index), project_id: projectId, budget_source_id: sourceId, allocation_name: name, allocation_code: name.toUpperCase().replace(/[^A-Z0-9]+/g, "_"), status: "active", staff_visible: true })),
    project_tracker_templates: [{ project_id: projectId, category_options: [...rules.map(([source]) => source), "general project management"] }],
    quote_draft_projects: [{ project_id: projectId, quote_id: id(6) }, { project_id: otherProjectId, quote_id: id(7) }],
    quote_drafts: [{ transferred_quote_id: id(6), project_number: "EC-1597" }, { transferred_quote_id: id(7), project_number: "1598" }],
  };
}
reset();
class Query {
  constructor(table) { this.table = table; this.filters = []; this.start = 0; this.end = 99999; }
  select() { return this; }
  eq(key, value) { this.filters.push((row) => row[key] === value); return this; }
  is(key, value) { this.filters.push((row) => (row[key] ?? null) === value); return this; }
  in(key, values) { this.filters.push((row) => values.includes(row[key])); return this; }
  gt(key, value) { this.filters.push((row) => Number(row[key]) > value); return this; }
  gte(key, value) { this.filters.push((row) => row[key] >= value); return this; }
  lte(key, value) { this.filters.push((row) => row[key] <= value); return this; }
  order() { return this; }
  range(start, end) { this.start = start; this.end = end; return this; }
  then(resolve) {
    const rows = this.table === "project_tracker_entries" ? currentEntries : tables[this.table] || [];
    return Promise.resolve({ data: rows.filter((row) => this.filters.every((filter) => filter(row))).slice(this.start, this.end + 1), error: null }).then(resolve);
  }
}
const admin = {
  from: (table) => new Query(table),
  auth: { admin: { listUsers: async () => ({ data: { users: [{ id: staff, email: "staff@example.test", user_metadata: { full_name: "Alex Ng" } }] } }) } },
  rpc: async (name, args) => {
    rpcCalls.push({ name, args });
    return { data: { success: true, importedCount: args.p_entries.length, totalHours: args.p_entries.reduce((sum, entry) => sum + entry.hours, 0), labourCharge: args.p_entries.reduce((sum, entry) => sum + entry.hours * entry.custom_data.import_expected_charge_rate, 0), allocationsRecalculated: args.p_entries.filter((entry) => entry.budget_allocation_id).length }, error: null };
  },
};
const access = { admin, user: { id: actor }, isAdmin: true };
const context = vm.createContext({
  ...imports, ...periods, ...reconciliation, Date, Response, Headers, Request, FormData, File,
  console, XLSX, createHash, randomUUID, Map, Set,
  requireSession: async () => access, requirePortalResource: async () => null,
  serverError: (error) => Response.json({ error: error.message }, { status: 400 }),
  trackerChargeRole: () => "Ecologist",
  loadTrackerChargeRates: async () => confirmed ? new Map(tables.projects.map((project) => [project.id, new Map([["Ecologist", project.id === projectId ? 180 : 240], ["Mileage", 1.25]])])) : new Map(),
});
vm.runInContext(stripImports(apiSource).replace(/export /g, "") + "\nthis.api = {normaliseRow, projectMatches, buildPreview, handleUpload, handleImport, POST};", context);
const row = (patch = {}) => ({ sourceRow: 2, workDate: "2026-11-05", staffName: "Alex Ng", clientName: "Shire", projectName: "Creek survey", projectNumber: "EC-1597", hours: 2, expenses: 25, km: 35, vehicle: "EC01", activityCategory: "Travel", sourceTask: "Travel", comments: "Fieldwork notes", ...patch });
const previewOne = async (input) => (await context.api.buildPreview(admin, [input])).rows[0];
const hasIssue = (row, code) => row.issues.some((issue) => issue.code === code);

for (const [source, target] of rules) {
  const actual = await previewOne(row({ activityCategory: source, sourceTask: source }));
  assert.equal(imports.normaliseImportText(actual.activityCategory), imports.normaliseImportText(target));
  assert.equal(actual.sourceTask, source);
  assert.equal(actual.isImportable, true);
  assert.equal(actual.budgetAssignment, "assigned");
  assert.equal(actual.budgetSourceId, sourceId);
  assert(actual.categoryOptions.includes(target) || actual.categoryOptions.includes(target.toLowerCase()));
}
assert.equal((await previewOne(row({ activityCategory: "qoutes and tenders" }))).activityCategory, "Other");
assert.equal((await previewOne(row({ activityCategory: "  external---CONSULTATION  " }))).activityCategory, "general project management");
const assigned = await previewOne(row());
assert.equal(assigned.budgetAllocationId, id(21));
assert.equal((await previewOne(assigned)).budgetAssignment, "assigned", "Assigned pointers survive repeated preview");
assert.equal((await context.api.handleImport(access, { rows: [assigned], fileName: "weekly.xls" })).status, 201);
assert.equal(rpcCalls.at(-1).args.p_entries[0].custom_data.budget_assignment, "assigned");

// Job# takes priority over another real project's exact name and client.
let actual = await previewOne(row({ projectNumber: " ec / 1597 ", projectName: "Other project", clientName: "Other client" }));
assert.equal(actual.projectId, projectId);
assert.equal(actual.chargeRate, 180);
assert(actual.warnings.some((warning) => warning.includes("Client job")));
assert(actual.warnings.some((warning) => warning.includes("client name")));
actual = await previewOne(row({ projectName: "Outdated name" }));
assert.equal(actual.projectId, projectId);
assert(actual.warnings.some((warning) => warning.includes("Job# is primary")));
actual = await previewOne(row({ projectNumber: "9999" }));
assert.equal(actual.projectId, "");
assert(hasIssue(actual, "unmatched_project"));
assert.equal((await previewOne(row({ projectNumber: "---" }))).projectId, "", "A supplied unusable number must not fall back to a name");
tables.quote_drafts[1].project_number = "EC1597";
actual = await previewOne(row());
assert.equal(actual.projectId, "");
assert(hasIssue(actual, "ambiguous_project"));
reset();
actual = await previewOne(row({ projectNumber: "" }));
assert.equal(actual.projectId, projectId, "No-number files retain unique-name matching");
actual = await previewOne(row({ projectId: otherProjectId, projectName: "Old source name", budgetAssignment: "unassigned" }));
assert.equal(actual.projectId, otherProjectId, "Explicit administrator resolution is allowed");
assert(actual.warnings.some((warning) => warning.includes("Source Job# differs")));
assert(actual.warnings.some((warning) => warning.includes("Client job")));
assert(actual.warnings.some((warning) => warning.includes("client name")));
tables.quote_drafts[0].project_number = "1597";
assert.equal((await previewOne(row({ projectNumber: 1597 }))).projectId, projectId, "Numeric spreadsheet Job# cells match their registered number");

// Exercise the real XLS reader and original eleven headers with verbatim Task/Notes.
reset();
const headings = ["Date", "Employee", "Client", "Job#", "Client job", "Hours", "Expenses", "Kms", "Vehicle", "Task", "Notes"];
const sourceTask = "  DESKTOP / Field plan  ", notes = "  Original Notes: access / habitat; retain punctuation.  ";
const workbook = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([headings, ["5/11/2026", "Alex Ng", "Shire", "EC-1597", "Outdated client job", 2, 25, 35, "EC01", sourceTask, notes]]), "Weekly");
const form = new FormData();
form.append("file", new File([XLSX.write(workbook, { type: "buffer", bookType: "biff8" })], "weekly.xls"));
const uploaded = await (await context.api.handleUpload(new Request("https://example.test/import", { method: "POST", body: form }))).json();
assert.deepEqual(uploaded.headers, headings);
const mapped = imports.mapRawTimesheetRows(uploaded.rawRows, imports.inferTimesheetColumnMap(uploaded.headers));
assert.equal(mapped[0].sourceTask, sourceTask);
assert.equal(mapped[0].comments, notes);
actual = await previewOne({ ...mapped[0], budgetAssignment: "unassigned", budgetSourceId: sourceId, budgetAllocationId: id(20) });
for (let index = 0; index < 3; index += 1) {
  actual = await previewOne(JSON.parse(JSON.stringify(actual)));
  assert.equal(actual.budgetAssignment, "unassigned");
  assert.equal(actual.budgetSourceId, null);
  assert.equal(actual.budgetAllocationId, null);
  assert.equal(actual.sourceTask, sourceTask);
  assert.equal(actual.comments, notes);
  assert.equal(actual.activityCategory, "Desktop Assessment");
}
const unassignedPreview = await context.api.buildPreview(admin, [actual]);
assert.equal(unassignedPreview.summary.unassigned, 1);
assert.equal(unassignedPreview.summary.unassignedReady, 1);
assert.equal(unassignedPreview.summary.unassignedReadyHours, 2);
assert.equal(unassignedPreview.summary.totalHours, 2);
assert.equal(unassignedPreview.summary.totalCharge, 360 + 35 * 1.25, "Labour plus configured job mileage");
assert.equal(unassignedPreview.reconciliation[0].newHours, 2);
assert.equal((await context.api.handleImport(access, { rows: [actual], fileName: "weekly.xls" })).status, 201);
let entry = rpcCalls.at(-1).args.p_entries[0];
assert.equal(rpcCalls.at(-1).name, "ec_import_weekly_timesheets_reviewed");
assert.equal(entry.budget_source_id, null);
assert.equal(entry.budget_allocation_id, null);
assert.equal(entry.custom_data.budget_assignment, "unassigned");
assert.equal(entry.custom_data.import_source_task, sourceTask);
assert.equal(entry.activity_information, notes);
assert.equal(entry.custom_data.import_source_notes, notes, "Original Notes survive any RPC whitespace normalization");
assert.equal(entry.custom_data.import_source_project_number, "EC-1597");
assert.equal(entry.custom_data.import_source_project_name, "Outdated client job");
assert.equal(entry.custom_data.import_source_client, "Shire");
assert.equal(entry.custom_data.expenses, 25);
assert.equal(entry.custom_data.vehicle, "EC01");
assert.equal(entry.custom_data.import_expected_charge_rate, 180);
assert.equal(entry.entered_by_admin_id, actor);

// A missing canonical target is available without changing templates or legacy allocations.
reset();
tables.project_tracker_templates[0].category_options = rules.map(([source]) => source);
tables.project_budget_allocations = [{ id: id(20), project_id: projectId, budget_source_id: sourceId, allocation_name: "Travel", status: "active", staff_visible: true }];
const untouched = JSON.stringify(tables);
actual = await previewOne(row());
assert.equal(actual.activityCategory, "Fieldwork & Travel");
assert.equal(actual.allocationOptions.length, 0, "Canonical targets cannot use the legacy single-allocation category fallback");
assert(hasIssue(actual, "no_budget_allocation"));
assert.notEqual(actual.budgetAssignment, "unassigned", "Blank selection is not an opt-out");
actual = await previewOne({ ...actual, budgetAssignment: "unassigned" });
assert(actual.isImportable);
assert(actual.categoryOptions.includes("Fieldwork & Travel"));
assert.equal(JSON.stringify(tables), untouched, "Importer must not modify project templates or source data");
assert(hasIssue(await previewOne(row({ activityCategory: "Not approved", budgetAssignment: "unassigned" })), "unmatched_category"));

// Invalid/stale allocated references never silently become unassigned or a single default.
reset();
for (const badId of ["invalid-id", id(999)]) {
  actual = await previewOne(row({ budgetAllocationId: badId }));
  assert(hasIssue(actual, "invalid_budget_allocation"));
  assert.equal(actual.budgetAllocationId, badId);
  actual = await previewOne(actual);
  assert(hasIssue(actual, "invalid_budget_allocation"));
  assert.notEqual(actual.budgetAssignment, "unassigned");
  const before = rpcCalls.length;
  assert.equal((await context.api.handleImport(access, { rows: [actual] })).status, 409);
  assert.equal(rpcCalls.length, before);
}
assert(hasIssue(await previewOne(row({ budgetAllocationId: id(21), budgetSourceId: id(999) })), "invalid_budget_allocation"));
assert(hasIssue(await previewOne(row({ budgetAssignment: "assigned", budgetAllocationId: "" })), "no_budget_allocation"));
actual = await previewOne(row({ budgetAssignment: "not-an-assignment" }));
assert(hasIssue(actual, "invalid_budget_assignment"));
assert(hasIssue(await previewOne(actual), "invalid_budget_assignment"));
const secondSource = { ...tables.project_budget_sources[0], id: id(40), source_type: "variation", source_name: "Variation" };
tables.project_budget_sources.push(secondSource);
tables.project_budget_allocations.push({ ...tables.project_budget_allocations[1], id: id(41), budget_source_id: secondSource.id });
actual = await previewOne(row());
assert.equal(actual.allocationOptions.length, 2);
assert(hasIssue(actual, "ambiguous_budget_allocation"));
assert.notEqual(actual.budgetAssignment, "unassigned");
assert((await previewOne(row({ budgetAllocationId: id(41), budgetAssignment: "assigned" }))).isImportable);
assert((await previewOne(row({ budgetAssignment: "unassigned" }))).isImportable);
reset();
tables.project_budget_sources[0].service_period_start = "2026-11-01";
tables.project_budget_sources[0].service_period_end = "2026-11-30";
actual = await previewOne(row({ workDate: "2026-12-01", budgetAllocationId: id(21), budgetAssignment: "assigned" }));
assert(hasIssue(actual, "invalid_budget_allocation"));
assert((await previewOne({ ...actual, budgetAssignment: "unassigned" })).isImportable);
tables.project_budget_sources[0].approval_status = "pending";
assert(hasIssue(await previewOne(row()), "no_budget_allocation"));
assert((await previewOne(row({ budgetAssignment: "unassigned" }))).isImportable);

// Confirmed job rates and valid dates remain mandatory for either assignment mode.
reset();
confirmed = false;
for (const assignment of ["", "unassigned"]) {
  actual = await previewOne(row({ budgetAssignment: assignment }));
  assert(hasIssue(actual, "missing_project_rates"));
  assert.equal(actual.isImportable, false);
  const before = rpcCalls.length;
  assert.equal((await context.api.handleImport(access, { rows: [actual] })).status, 409);
  assert.equal(rpcCalls.length, before);
}
confirmed = true;
actual = await previewOne(row({ budgetAssignment: "unassigned" }));
assert.equal((await context.api.handleImport(access, { rows: [{ ...actual, chargeRate: 999 }] })).status, 409);
assert(hasIssue(await previewOne(row({ workDate: "invalid", budgetAssignment: "unassigned" })), "invalid_date"));

// Assignment is not part of exact identities or overlap review tokens.
reset();
const asAssigned = await previewOne(row());
const asUnassigned = await previewOne(row({ budgetAssignment: "unassigned" }));
assert.equal(imports.timesheetDuplicateKey(asAssigned), imports.timesheetDuplicateKey(asUnassigned));
assert.equal(reconciliation.timesheetCoreKey(asAssigned), reconciliation.timesheetCoreKey(asUnassigned));
const existing = { id: id(50), project_id: projectId, staff_user_id: staff, work_date: "2026-11-05", activity_category: "Fieldwork & Travel", activity_information: "Fieldwork notes", hours: 2, custom_data: { km: 35, budget_assignment: "assigned" }, budget_source_id: sourceId, budget_allocation_id: id(21), updated_at: "2026-11-06T00:00:00Z" };
for (const existingAssignment of ["assigned", "unassigned"]) {
  currentEntries = [{ ...existing, custom_data: { ...existing.custom_data, budget_assignment: existingAssignment } }];
  for (const input of [asAssigned, asUnassigned]) {
    actual = await previewOne(input);
    assert(hasIssue(actual, "duplicate_existing"));
    assert(actual.isSkipped);
    assert.equal((await context.api.handleImport(access, { rows: [{ ...actual, duplicateDecision: "separate", duplicateReason: "Trying to bypass an exact duplicate" }] })).status, 409);
  }
}
currentEntries = [];
let preview = await context.api.buildPreview(admin, [asAssigned, { ...asUnassigned, sourceRow: 3 }]);
assert(hasIssue(preview.rows[1], "duplicate_file"));
assert.equal(preview.summary.ready, 1);
currentEntries = [{ ...existing, hours: 1, activity_information: "Prior work" }];
const overlapAssigned = await previewOne(asAssigned);
const overlapUnassigned = await previewOne(asUnassigned);
assert(overlapUnassigned.isSkipped);
assert.equal(overlapUnassigned.possibleDuplicates.length, 1);
assert.equal(overlapAssigned.duplicateReviewToken, overlapUnassigned.duplicateReviewToken);
actual = await previewOne({ ...overlapUnassigned, duplicateDecision: "separate", duplicateReason: "Separate afternoon work after the first visit." });
assert(actual.isImportable);
assert.equal((await context.api.handleImport(access, { rows: [actual] })).status, 201);
entry = rpcCalls.at(-1).args.p_entries[0];
assert.equal(entry.custom_data.import_duplicate_review.expected_entries.length, 1);
assert.equal(entry.custom_data.budget_assignment, "unassigned");
currentEntries[0].hours = 1.5;
assert.equal((await context.api.handleImport(access, { rows: [actual] })).status, 409, "Unassigned work cannot bypass stale overlap review");
currentEntries = [];
preview = await context.api.buildPreview(admin, [asUnassigned, { ...asAssigned, sourceRow: 3, hours: 1, comments: "Split work" }]);
assert(preview.rows.every((item) => item.isSkipped && item.fileOverlaps.length === 1));

// Compile the actual JSX component, inspect serialization/patch behavior, and render a no-option row.
const swc = createRequire(import.meta.url)("next/dist/build/swc");
const compiled = await swc.transform(stripImports(uiSource).replace("export default function", "function") + "\nglobalThis.ui = {inputRowPayload, patchImportRow, AdminTimesheetImporter};", { jsc: { parser: { syntax: "ecmascript", jsx: true }, transform: { react: { runtime: "classic" } } }, module: { type: "commonjs" } });
let hookValues = [], hookIndex = 0;
const icon = () => null;
const uiContext = vm.createContext({ React, ...imports, Intl, Number, Date, console,
  AlertTriangle: icon, ArrowDownUp: icon, CheckCircle2: icon, FileSpreadsheet: icon, Loader2: icon, Upload: icon, X: icon,
  useMemo: (callback) => callback(), useRef: (value) => ({ current: value }),
  useState: (value) => [hookIndex < hookValues.length ? hookValues[hookIndex++] : value, () => {}],
});
vm.runInContext(compiled.code, uiContext);
let changed = uiContext.ui.patchImportRow(asAssigned, { budgetAssignment: "unassigned", budgetAllocationId: null });
for (const patch of [{ workDate: "2026-11-12" }, { staffUserId: staff }, { projectId: otherProjectId }, { activityCategory: "QA Review" }]) {
  changed = uiContext.ui.patchImportRow(changed, patch);
  const payload = uiContext.ui.inputRowPayload(changed);
  assert.equal(payload.budgetAssignment, "unassigned");
  assert.equal(payload.budgetSourceId, null);
  assert.equal(payload.budgetAllocationId, null);
}
changed = uiContext.ui.patchImportRow(changed, { budgetAssignment: "assigned", budgetAllocationId: id(23) });
assert.equal(changed.budgetAssignment, "assigned");
assert.equal(changed.budgetAllocationId, id(23));
assert.equal(changed.budgetSourceId, "", "Leaving unassigned must not reuse a stale source");
changed = uiContext.ui.patchImportRow(changed, { budgetAssignment: "", budgetAllocationId: "" });
assert.notEqual(changed.budgetAssignment, "unassigned");
assert.equal(uiContext.ui.patchImportRow(asAssigned, { workDate: "2026-12-01" }).budgetAllocationId, "");
assert.equal(uiContext.ui.inputRowPayload({ ...asUnassigned, budgetSourceId: sourceId, budgetAllocationId: id(21) }).budgetAllocationId, null);
const previouslySkipped = uiContext.ui.patchImportRow({ ...asUnassigned, duplicateDecision: "skip", isSkipped: true }, { activityCategory: "QA Review" });
assert.equal(previouslySkipped.duplicateDecision, "skip", "Identity revalidation preserves a prior row exclusion");
assert.equal(previouslySkipped.isSkipped, true);
assert.equal((await previewOne(previouslySkipped)).isSkipped, true);
reset();
tables.project_budget_allocations = [];
const noOptionsPreview = await context.api.buildPreview(admin, [row({ budgetAssignment: "unassigned" })]);
hookValues = [{ ...uploaded, rawRows: [{ rowNumber: 2, values: ["5/11/2026", "Alex Ng", "Shire", "EC-1597", "Creek survey", 2, 25, 35, "EC01", "Travel", "Fieldwork notes"] }] }, imports.inferTimesheetColumnMap(headings), noOptionsPreview.rows, noOptionsPreview, true, {}, 0, "", "", "all", "date", null];
hookIndex = 0;
const markup = renderToStaticMarkup(React.createElement(uiContext.ui.AdminTimesheetImporter, { session: { access_token: "mock-token" } }));
const budgetSelect = markup.match(/<select aria-label="Budget allocation for source row 2"[\s\S]*?<\/select>/)?.[0];
assert(budgetSelect);
assert(!budgetSelect.includes("disabled"), "No budget assignment stays enabled even with zero allocations");
assert(budgetSelect.includes('value="unassigned" selected=""'));
assert(budgetSelect.includes("No budget assignment"));
assert(markup.includes("Ready · unassigned"));
assert(markup.includes("Unassigned ready hours"));
assert(markup.includes("project-level actuals"));
assert(markup.includes("individual budgets are unchanged"));
assert(markup.includes("Job# is the primary project match"));
assert(markup.includes('value="Desktop Assessment"'));
const mainTable = markup.match(/<table class="ati-table">[\s\S]*?<\/table>/)?.[0];
assert(mainTable);
assert.equal((mainTable.match(/<th scope="col">/g) || []).length, 10);
for (const heading of ["Comments / source references", "Import decision", "Review / compare entries"]) assert(!mainTable.includes(heading));
assert(!mainTable.includes("View uploaded source"));
assert(!markup.includes('aria-label="Items requiring review"'), "Clean included rows do not need a separate review section");

reset();
currentEntries = [existing];
const flaggedPreview = await context.api.buildPreview(admin, [
  row({ hours: "invalid", workDate: "2026-11-06", budgetAssignment: "unassigned" }),
  row({ sourceRow: 3, budgetAssignment: "unassigned" }),
  row({ sourceRow: 4, hours: 1, comments: "Distinct later work", budgetAssignment: "unassigned" }),
]);
hookValues[2] = flaggedPreview.rows;
hookValues[3] = flaggedPreview;
hookIndex = 0;
let flaggedMarkup = renderToStaticMarkup(React.createElement(uiContext.ui.AdminTimesheetImporter, { session: { access_token: "mock-token" } }));
const flaggedMain = flaggedMarkup.match(/<table class="ati-table">[\s\S]*?<\/table>/)?.[0];
const reviewSection = flaggedMarkup.match(/<section class="ati-reconciliation" aria-label="Items requiring review">[\s\S]*?<\/section>/)?.[0];
assert(reviewSection, "Flagged rows retain an accessible separate review section");
assert(reviewSection.includes('aria-label="Import decision for source row 2"'));
assert(reviewSection.includes('value="skip">Skip</option>'), "Invalid rows can still be explicitly skipped");
assert(reviewSection.includes("Hours must be a positive number"));
assert(reviewSection.includes("exact duplicate always skipped"));
assert(reviewSection.match(/<select aria-label="Import decision for source row 3: exact duplicate always skipped"[^>]*disabled/));
assert(reviewSection.includes('aria-label="Overlap decision for source row 4"'));
assert(reviewSection.includes('value="skip" selected=""'));
assert(reviewSection.includes("Import as separate work"));
assert(reviewSection.includes("View uploaded source"));
assert(!flaggedMain.includes("Import decision for source row"));
assert(!flaggedMain.includes("Overlap decision for source row"));
assert(!flaggedMain.includes("View uploaded source"));
hookValues[5] = { 4: { decision: "separate", reason: "short" } };
hookIndex = 0;
flaggedMarkup = renderToStaticMarkup(React.createElement(uiContext.ui.AdminTimesheetImporter, { session: { access_token: "mock-token" } }));
assert(flaggedMarkup.includes("Why is this distinct work?"));
assert(flaggedMarkup.includes("Draft not applied — import is disabled."));
assert(flaggedMarkup.match(/<button[^>]*disabled[^>]*aria-label="Apply review decision for source row 4"/));
hookValues[5] = { 4: { decision: "separate", reason: "Separate afternoon work after the first visit." } };
flaggedPreview.rows[2].duplicateReviewToken = "";
hookIndex = 0;
flaggedMarkup = renderToStaticMarkup(React.createElement(uiContext.ui.AdminTimesheetImporter, { session: { access_token: "mock-token" } }));
assert(flaggedMarkup.includes("Refresh the preview before approving separate work."));
assert(flaggedMarkup.match(/<button[^>]*disabled[^>]*aria-label="Apply review decision for source row 4"/));
assert.match(uiSource, /action: "preview", rows: rows\.map\(inputRowPayload\)/);
assert.match(uiSource, /action: "import", rows: rows\.map\(inputRowPayload\)/);
assert.match(apiSource, /budget_assignment: row\.budgetAssignment/);
assert.match(apiSource, /import_source_task: row\.sourceTask/);
assert.match(apiSource, /import_source_project_name: row\.projectName/);
assert.match(apiSource, /rpc\("ec_import_weekly_timesheets_reviewed"/);
assert(!/\.from\("project_tracker_templates"\)[\s\S]{0,150}\.(update|upsert|insert)\(/.test(apiSource));

console.log("Timesheet import categories/unassigned checks passed: all seven canonical rules and variants, configured/missing targets, legacy precedence, original XLS Task/Notes and Job# provenance, primary-number resolution, repeated preview/commit null pointers, enabled UI option, explicit choices, stale/invalid/source/date/category guards, confirmed rates, assignment-independent exact/overlap checks, ten-column preview with separate flagged-item safeguards, preserved exclusions and transactional payload.");
