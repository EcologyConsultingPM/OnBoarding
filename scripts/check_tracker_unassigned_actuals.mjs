import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { createRequire } from "node:module";

const root = new URL("..", import.meta.url);
const read = (file) => readFile(new URL(file, root), "utf8");
const dataUrl = (source) => `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
const chargeUrl = dataUrl(await read("lib/projectTrackerChargeRates.js"));
const charge = await import(chargeUrl);
const actuals = await import(dataUrl((await read("lib/projectTrackerUnassignedActuals.js")).replace('"./projectTrackerChargeRates"', JSON.stringify(chargeUrl))));
const { refreshProjectTrackerAllocation } = await import(dataUrl((await read("lib/projectTrackerAllocationTotals.js")).replace('"./projectTrackerChargeRates"', JSON.stringify(chargeUrl))));
const periods = await import(dataUrl(await read("lib/projectBudgetPeriods.js")));
const staffSource = await read("app/api/project-tracker-entries/route.js");
const adminSource = await read("app/api/admin/project-tracker/route.js");
const correctionSource = await read("app/api/admin/project-tracker-entries/route.js");
const workSource = await read("app/api/my-project-tracker/route.js");
const uiSource = await read("components/StaffProjectTracker.js");
const adminUi = await read("components/AdminProjectTracker.js");
const uuid = (number) => `00000000-0000-4000-8000-${String(number).padStart(12, "0")}`;
const P = uuid(1), S = uuid(2), A = uuid(3), STAFF = uuid(4), ADMIN = uuid(5), OTHER = uuid(6);
const project = { id: P, name: "Local fixture only", client_name: "Test client", status: "active", deleted_at: null, budget_dollars: 5000, budget_hours: 30, default_hourly_rate: 999, created_by: ADMIN };
const source = { id: S, project_id: P, source_type: "original", approval_status: "approved", approved_value: 5000, approved_hours: 30 };
const allocation = { id: A, project_id: P, budget_source_id: S, status: "active", staff_visible: true, allocation_name: "Fieldwork & Travel", allocation_code: "FIELD", allocation_hours: 30, hours_consumed: 2, charge_out_spend: 360, internal_cost: 216 };
const stamp = { budget_assignment: "unassigned", charge_role: "Ecologist", charge_rate_stamped: true, charge_rate_snapshot: 180, charge_rate_source: "confirmed_project_card", import_source: "weekly_timesheet", import_batch_id: "fixture-batch", km: 12, original_task: "Travel", import_duplicate_review: { charge_out_spend: 999, role: "private" } };
const unassigned = (number, overrides = {}) => ({ id: uuid(number), project_id: P, staff_user_id: STAFF, entered_by_admin_id: ADMIN, budget_source_id: null, budget_allocation_id: null, activity_id: null, work_date: "2026-11-20", activity_category: "Fieldwork & Travel", activity_information: "Local fieldwork", hours: 1, status: "completed", notable_issues: null, custom_data: structuredClone(stamp), created_at: "2026-11-21T00:00:00Z", ...overrides });
const allocated = (number, overrides = {}) => unassigned(number, { budget_source_id: S, budget_allocation_id: A, custom_data: { ...structuredClone(stamp), budget_assignment: "allocated" }, ...overrides });

// A PostgREST-like in-memory mock with the default server cap, projections,
// left relation joins, deterministic ordering, pagination, audit and write logs.
// No HTTP, credentials, sockets, remote database, RPC, or live writes are used.
function mockAdmin(input = {}, failures = {}) {
  const tables = structuredClone(input), calls = [], writes = [];
  const admin = { tables, calls, writes, auth: { admin: { listUsers: async () => ({ data: { users: [{ id: STAFF, email: "fixture@example.test" }] }, error: null }) } }, from(table) {
    let columns = "*", operation = "read", payload = null, single = false, range = null, maximum = 1000;
    const filters = [], sort = [];
    const pathValue = (row, key) => key.includes("->>") ? row[key.split("->>")[0]]?.[key.split("->>")[1]] : row[key];
    const q = {
      select(value) { columns = value; return q; },
      eq(key, value) { filters.push((row) => pathValue(row, key) === value); return q; },
      neq(key, value) { filters.push((row) => row[key] !== value); return q; },
      is(key, value) { filters.push((row) => (row[key] ?? null) === value); return q; },
      in(key, values) { filters.push((row) => values.includes(row[key])); return q; },
      order(key, options = {}) { sort.push([key, options.ascending !== false]); return q; },
      limit(value) { maximum = value; return q; },
      range(first, last) { range = [first, last]; return q; },
      maybeSingle() { single = true; return q; }, single() { single = true; return q; },
      insert(value) { operation = "insert"; payload = value; return q; },
      update(value) { operation = "update"; payload = value; return q; },
      delete() { operation = "delete"; return q; },
      then(resolve, reject) {
        calls.push({ table, columns, operation, range });
        const failed = failures[`${table}:${operation}`] || failures[table];
        if (failed) return Promise.resolve({ data: null, error: { message: failed, code: "42501" } }).then(resolve, reject);
        let rows = (tables[table] || []).filter((row) => filters.every((predicate) => predicate(row)));
        if (operation !== "read") writes.push({ table, operation, payload: structuredClone(payload) });
        if (operation === "insert") {
          rows = (Array.isArray(payload) ? payload : [payload]).map((row) => ({ id: uuid(500000 + (tables[table] || []).length), ...structuredClone(row) }));
          (tables[table] ||= []).push(...rows);
        } else if (operation === "update") rows.forEach((row) => Object.assign(row, structuredClone(payload)));
        else if (operation === "delete") tables[table] = (tables[table] || []).filter((row) => !rows.includes(row));
        rows = rows.slice().sort((left, right) => {
          for (const [key, asc] of sort) { const result = String(left[key] || "").localeCompare(String(right[key] || "")); if (result) return asc ? result : -result; }
          return 0;
        });
        rows = range ? rows.slice(range[0], range[1] + 1) : rows.slice(0, maximum);
        const fields = columns.split(/,(?![^()]*\))/).map((value) => value.trim());
        const joined = rows.map((row) => {
          if (columns === "*") return structuredClone(row);
          const result = {};
          for (const field of fields) {
            if (!field.includes(":")) result[field] = structuredClone(row[field]);
            else {
              const alias = field.split(":")[0];
              const relation = { project: ["projects", "project_id"], source: ["project_budget_sources", "budget_source_id"], allocation: ["project_budget_allocations", "budget_allocation_id"], activity: ["project_activities", "activity_id"] }[alias];
              const linked = relation && (tables[relation[0]] || []).find((item) => item.id === row[relation[1]]);
              result[alias] = linked ? structuredClone(linked) : null;
            }
          }
          return result;
        });
        return Promise.resolve({ data: single ? joined[0] || null : joined, error: null }).then(resolve, reject);
      },
    };
    return q;
  } };
  return admin;
}
function context(sourceText, injected = {}) {
  const ctx = vm.createContext({ Response, Request, URL, Date, console, ...charge, ...actuals, ...periods,
    refreshProjectTrackerAllocation,
    requireSession: async () => injected.access,
    requirePortalResource: async () => null,
    listDirectoryUsers: async () => [{ id: STAFF, name: "Fixture staff" }],
    loadStaffProjectAssignments: async () => ({ legacy: true, rows: [], activities: [] }),
    summarizeStaffProjectAssignments: () => new Map(), emptyStaffProjectAssignmentSummary: () => ({}),
    selectWithHoursFlags: async (query, columns) => query(columns), hoursPayload: () => ({}),
    serverError: (error) => Response.json({ error: error.message }, { status: 500 }),
    ...injected });
  vm.runInContext(sourceText.replace(/^import .*;\n/gm, "").replace(/^export /gm, ""), ctx);
  return ctx;
}
const tracker = context(adminSource);
function build(sources = [], allocations = [], entries = [], p = project) {
  return tracker.buildProjectTracker(p, sources, allocations, [], entries, 1, {}, new Map(), new Map(), true);
}
const accessFor = (admin, isAdmin = false, userId = STAFF) => ({ admin, isAdmin, user: { id: userId } });
const tables = (entries = []) => ({ projects: [project], project_budget_sources: [source], project_budget_allocations: [allocation], project_tracker_entries: entries,
  project_allocations: [{ project_id: P, staff_user_id: STAFF, active: true, allocated_hours: 30, hourly_rate: 1234 }],
  project_charge_rates: [{ project_id: P, senior_ecologist_rate: 888, ecologist_rate: 777, project_manager_rate: 666, confirmed_by: ADMIN, confirmed_at: "2026-11-24" }],
  project_tracker_settings: [{ project_id: P, tracker_visible: true }], project_tracker_templates: [{ project_id: P, locked: true, category_options: ["Fieldwork & Travel"], column_definitions: [] }], project_activities: [], portal_events: [] });
const request = (method, body, query = "") => new Request(`https://fixture.test/api/tracker${query}`, { method, body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });

const fixedInternal = (hours, km) => Math.round((hours * 75 + km * 0.90 + Number.EPSILON) * 100) / 100;
let checks = 0;
function expectTotals(result, expected) { for (const [key, value] of Object.entries(expected)) { assert.equal(result.financials[key], value, key); checks++; } }

assert.deepEqual(actuals.summarizeTrackerUnassignedActuals(), { count: 0, hours: 0, chargeOutSpend: 0, internalCost: 0 });
const sample = [unassigned(10), unassigned(11, { hours: "2.25" }), allocated(12), unassigned(13, { custom_data: {} }), unassigned(14, { budget_source_id: S })];
const snapshotSpend = (1 + 2.25) * 180;
assert.deepEqual(actuals.summarizeTrackerUnassignedActuals(sample), { count: 2, hours: 1 + 2.25, chargeOutSpend: snapshotSpend, internalCost: fixedInternal(1 + 2.25, 2 * 12) });
for (const invalid of [null, 0, -1, "180", Infinity]) assert.throws(() => actuals.summarizeTrackerUnassignedActuals([unassigned(15, { custom_data: { ...stamp, charge_rate_snapshot: invalid } })]), /snapshot/);
assert.throws(() => actuals.summarizeTrackerUnassignedActuals([unassigned(15, { custom_data: { ...stamp, charge_role: "Project Manager" } })]), /trusted charge snapshot/);
assert.throws(() => actuals.summarizeTrackerUnassignedActuals([unassigned(15, { hours: -1 })]), /hours/);
const senior = unassigned(16, { staff_user_id: "d07b78be-c1e7-4bf5-94fa-5366a59cb408", custom_data: { ...stamp, charge_role: "Senior Ecologist", charge_rate_snapshot: 220 } });
assert.equal(actuals.summarizeTrackerUnassignedActuals([senior]).chargeOutSpend, 220);

expectTotals(build(), { originalBudget: 5000, overallBudget: 5000, usedHours: 0, chargeOutSpend: 0, internalCost: 0 });
expectTotals(build([source], [allocation]), { usedHours: 2, chargeOutSpend: 360, internalCost: 216, estimatedProfit: 5000 - 216 });
expectTotals(build([], [], [unassigned(20)]), { usedHours: 1, chargeOutSpend: 180, internalCost: fixedInternal(1, 12), remainingHours: 30 - 1, remainingBudget: 5000 - 180, lifetimeUsedHours: 1, lifetimeChargeOutSpend: 180, lifetimeInternalCost: fixedInternal(1, 12) });
expectTotals(build([], [], [unassigned(20)], { ...project, budget_hours: 0, budget_dollars: 0 }), { usedHours: 1, chargeOutSpend: 180, remainingHours: -1, remainingBudget: -180, estimatedProfit: -(fixedInternal(1, 12)) });
const closedSource = { ...source, id: uuid(30), approval_status: "closed" };
const closedAllocation = { ...allocation, id: uuid(31), budget_source_id: closedSource.id, hours_consumed: 5, charge_out_spend: 901, internal_cost: 540.6 };
const closedEntry = allocated(32, { budget_source_id: closedSource.id, budget_allocation_id: closedAllocation.id, hours: 5 });
let mixed = build([source, closedSource], [allocation, closedAllocation], [allocated(21, { hours: 2 }), unassigned(22), closedEntry]);
expectTotals(mixed, { usedHours: 2 + 1, chargeOutSpend: 360 + 180, internalCost: Math.round((fixedInternal(2, 12) + fixedInternal(1, 12)) * 100) / 100, remainingHours: 30 - 3, remainingBudget: 5000 - 540, historicalUsedHours: 5, historicalChargeOutSpend: 901, lifetimeUsedHours: 2 + 5 + 1, lifetimeChargeOutSpend: 360 + 901 + 180 });
assert.equal(mixed.sources[1].allocations[0].charge_out_spend, 901, "Allocated history retains stored prices.");
assert.deepEqual(mixed.financials.unassigned, mixed.entrySummary.unassigned);
assert.equal(mixed.entrySummary.all.length, 3);
expectTotals(build([closedSource], [closedAllocation], [unassigned(22), closedEntry]), { overallBudget: 0, chargeOutSpend: 180, usedHours: 1, historicalUsedHours: 5, historicalChargeOutSpend: 901 });
const variation = { ...source, id: uuid(33), source_type: "variation", approved_value: 700, approved_hours: 4 };
expectTotals(build([closedSource, variation], [closedAllocation], [unassigned(22)]), { originalBudget: 0, variationBudget: 700, overallBudget: 700, remainingBudget: 700 - 180 });
const beforeRead = structuredClone(sample); build([source], [allocation], sample); assert.deepEqual(sample, beforeRead, "Reads must not modify or reprice stored entries.");

const many = Array.from({ length: 2005 }, (_, i) => unassigned(1000 + i, { hours: 0.25 }));
const largeAdmin = mockAdmin(tables([...many, unassigned(4000, { project_id: uuid(99) }), allocated(4001)]));
const complete = await actuals.loadTrackerUnassignedEntries(largeAdmin, [P]);
assert.equal(complete.data.length, many.length);
assert.equal(largeAdmin.calls.filter((call) => call.table === "project_tracker_entries").length, 3);
assert.ok(largeAdmin.calls.every((call) => call.range && call.range[1] - call.range[0] < 1000));
expectTotals(build([source], [allocation], complete.data), { usedHours: 2 + many.length * 0.25, chargeOutSpend: 360 + many.length * 0.25 * 180 });
const loaded = await tracker.loadTrackerEntries(largeAdmin, [P]);
assert.equal(loaded.data.length, many.length + 1);
assert.ok(largeAdmin.calls.some((call) => call.columns.includes("budget_source_id") && call.columns.includes("budget_allocation_id")));
const failedPage = mockAdmin(tables(many), { project_tracker_entries: "Read failed" });
assert.equal((await actuals.loadTrackerUnassignedEntries(failedPage, [P])).error.message, "Read failed");

const staffAdmin = mockAdmin({ ...tables([...many, closedEntry, unassigned(5000, { staff_user_id: OTHER })]), project_budget_sources: [source, closedSource], project_budget_allocations: [allocation, closedAllocation] });
let staffAccess = accessFor(staffAdmin);
let staff = context(staffSource, { access: staffAccess });
const eligible = await staff.eligibleProjects(staffAccess);
assert.equal(eligible.projects[0].financials.actualSpend, 360 + (many.length * 0.25 + 1) * 180);
assert.equal(eligible.projects[0].financials.usedHours, 2 + many.length * 0.25 + 1);
assert.equal(eligible.projects[0].financials.remainingHours, 30 - (2 + many.length * 0.25 + 1));
assert.ok(!JSON.stringify(eligible.projects).includes("charge_rate_snapshot"));
const own = await staff.ownEntries(staffAccess);
assert.equal(own.entries.length, many.length + 1, "Own history is complete and excludes other staff.");
assert.equal(own.entries.find((row) => row.id === many[0].id).allocation, "No budget assignment");
assert.equal(own.entries.find((row) => row.id === many[0].id).correctionAvailable, true);
assert.equal(own.entries.find((row) => row.id === closedEntry.id).sourceId, closedSource.id);
assert.ok(!JSON.stringify(own.entries).includes("charge_rate_snapshot"));
assert.ok(!JSON.stringify(own.entries).includes("import_duplicate_review"));
const board = await staff.teamEntries(staffAccess, P, eligible);
assert.equal(board.entries.length, many.length + 2);
assert.equal(board.totals.hoursConsumed, 2 + many.length * 0.25 + 1, "Closed-source work stays in history, not funded totals.");
assert.equal(board.totals.unassignedCount, many.length + 1);
assert.equal(board.allocations[0].hoursConsumed, 2, "Unassigned hours must not change individual allocation rows.");
assert.ok(!JSON.stringify(board).includes("charge_rate_snapshot"));
assert.ok(!JSON.stringify(board).includes("custom_data"));
assert.ok(!JSON.stringify(board).includes("charge_out_spend"));
assert.equal((await staff.teamEntries(staffAccess, uuid(99), eligible)).allowed, false);
assert.ok(staffAdmin.calls.every((call) => !call.columns.includes("!inner")), "Nullable budget joins must stay left joins.");
const work = context(workSource, { access: staffAccess });
let response = await work.GET(new Request("https://fixture.test/work"));
assert.equal(response.status, 200, (await response.clone().json()).error);
const workBody = await response.json();
assert.equal(workBody.entries.length, many.length + 1);
assert.equal(workBody.entries.find((entry) => entry.id === `tracker-${many[0].id}`).allocation, "No budget assignment");
assert.ok(!JSON.stringify(workBody).includes("charge_rate_snapshot"));

const nestedMetadata = { ...stamp, import_provenance: { task: "Travel", hourly_rate: 999, role: "Ecologist", financials: { profit: 777 } }, rows: [{ notes: "Keep", charge_role: "Private" }] };
const stripped = charge.trackerResponseCustomData(nestedMetadata);
assert.equal(stripped.budget_assignment, "unassigned");
assert.deepEqual(stripped.import_provenance, { task: "Travel" });
assert.deepEqual(stripped.rows, [{ notes: "Keep" }]);
assert.equal(charge.trackerResponseCustomData(nestedMetadata, true), nestedMetadata);

const correctionBody = { id: uuid(6000), projectId: uuid(99), staffUserId: OTHER, sourceId: null, allocationId: null, workDate: "2026-11-23", activityCategory: "Fieldwork & Travel", activityInformation: "Corrected local fixture", hours: 2.5, status: "completed", customData: { budget_assignment: "allocated", charge_role: "Project Manager", charge_rate_snapshot: 1, charge_rate_stamped: false, km: 0, import_batch_id: "spoofed" } };
const original = unassigned(6000);
const correctionAdmin = mockAdmin({ ...tables([original]), project_budget_sources: [], project_budget_allocations: [], project_allocations: [], project_tracker_templates: [], project_tracker_settings: [] });
staffAccess = accessFor(correctionAdmin);
staff = context(staffSource, { access: staffAccess });
const noBudgets = await staff.GET(new Request("https://fixture.test/tracker"));
assert.equal(noBudgets.status, 200, (await noBudgets.clone().json()).error);
const noBudgetsBody = await noBudgets.json();
assert.equal(noBudgetsBody.entryProjects.length, 0, "Own history must not grant new-entry eligibility.");
assert.equal(noBudgetsBody.entries[0].budgetAssignment, "unassigned");
assert.equal(noBudgetsBody.entries[0].correctionAvailable, true);
response = await staff.PATCH(request("PATCH", correctionBody));
assert.equal(response.status, 200, (await response.clone().json()).error);
const correctedBody = await response.json();
assert.equal(correctedBody.entry.sourceId, null);
assert.equal(correctedBody.entry.allocationId, null);
assert.ok(!JSON.stringify(correctedBody).includes("charge_rate_snapshot"));
let stored = correctionAdmin.tables.project_tracker_entries[0];
assert.equal(stored.project_id, P, "Original project identity remains locked.");
assert.equal(stored.staff_user_id, STAFF, "Original staff identity remains locked.");
assert.deepEqual(stored.custom_data, stamp, "Pricing, import provenance and assignment survive a stripped/tampered staff payload.");
assert.equal(stored.hours, correctionBody.hours);
assert.equal(correctionAdmin.tables.project_tracker_entry_audit[0].action, "staff_corrected");
assert.deepEqual(correctionAdmin.tables.project_tracker_entry_audit[0].after_data.custom_data, stamp);
assert.ok(!correctionAdmin.calls.some((call) => call.table === "project_budget_allocations" && call.operation === "update"));
expectTotals(build([], [], [stored]), { chargeOutSpend: correctionBody.hours * 180, usedHours: correctionBody.hours, remainingBudget: 5000 - correctionBody.hours * 180 });
assert.equal((await staff.PATCH(request("PATCH", { ...correctionBody, sourceId: S, allocationId: A }))).status, 400);
assert.equal((await staff.PATCH(request("PATCH", { ...correctionBody, workDate: "2026-02-30" }))).status, 400);
const foreign = context(staffSource, { access: accessFor(correctionAdmin, false, OTHER) });
assert.equal((await foreign.PATCH(request("PATCH", correctionBody))).status, 404);
assert.ok((await staff.createTrackerEntry(staffAccess, { ...correctionBody, budgetAssignment: "unassigned" })).error);
assert.ok((await staff.createTrackerEntry(staffAccess, { ...correctionBody, customData: { budget_assignment: "unassigned" }, sourceId: S, allocationId: A })).error);
correctionAdmin.tables.projects[0].status = "completed";
assert.equal((await staff.PATCH(request("PATCH", correctionBody))).status, 400);
correctionAdmin.tables.projects[0].status = "active";

const allocatedAdmin = mockAdmin(tables([allocated(6100, { entered_by_admin_id: null })]));
const allocatedAccess = accessFor(allocatedAdmin);
const allocatedCtx = context(staffSource, { access: allocatedAccess });
const allocatedBody = { ...correctionBody, id: uuid(6100), sourceId: S, allocationId: A, customData: { km: 21, charge_rate_snapshot: 1 }, hours: 3 };
response = await allocatedCtx.PATCH(request("PATCH", allocatedBody));
assert.equal(response.status, 200, (await response.clone().json()).error);
assert.equal(allocatedAdmin.tables.project_budget_allocations[0].hours_consumed, 3);
assert.equal(allocatedAdmin.tables.project_budget_allocations[0].charge_out_spend, 3 * 180, "Allocated correction retains snapshot rather than current 777/h card.");
assert.equal(allocatedAdmin.tables.project_budget_allocations[0].internal_cost, fixedInternal(3, 21), "Corrected kilometres use the fixed 0.90/km internal rate.");
assert.equal((await allocatedCtx.PATCH(request("PATCH", { ...allocatedBody, sourceId: null, allocationId: null }))).status, 400);
assert.equal((await allocatedCtx.PATCH(request("PATCH", { ...allocatedBody, budgetAssignment: "unassigned" }))).status, 400);
allocatedAdmin.tables.project_budget_sources[0].service_period_start = "2026-11-01";
allocatedAdmin.tables.project_budget_sources[0].service_period_end = "2026-11-30";
assert.equal((await allocatedCtx.PATCH(request("PATCH", { ...allocatedBody, workDate: "2026-12-01" }))).status, 400, "Allocated work-date guards are unchanged.");
const closedAdmin = mockAdmin({ ...tables([closedEntry]), project_budget_sources: [closedSource], project_budget_allocations: [closedAllocation] });
const closedAccess = accessFor(closedAdmin);
const closedCtx = context(staffSource, { access: closedAccess });
response = await closedCtx.PATCH(request("PATCH", { ...allocatedBody, id: closedEntry.id, sourceId: closedSource.id, allocationId: closedAllocation.id }));
assert.equal(response.status, 200, "Closed historical allocation can be corrected in its original unrestricted period.");

const deleteAdmin = mockAdmin(tables([unassigned(6200), allocated(6201), unassigned(6202)]));
const deleteAccess = accessFor(deleteAdmin, true, ADMIN);
const adminEntries = context(correctionSource, { access: deleteAccess, createTrackerEntry: staff.createTrackerEntry, validateTrackerBudgetCorrection: staff.validateTrackerBudgetCorrection });
response = await adminEntries.PATCH(request("PATCH", { ...correctionBody, id: uuid(6200), customData: {} }));
assert.equal(response.status, 200, (await response.clone().json()).error);
assert.deepEqual(deleteAdmin.tables.project_tracker_entries.find((entry) => entry.id === uuid(6200)).custom_data, stamp);
assert.equal(deleteAdmin.tables.project_tracker_entry_audit[0].after_data.custom_data.charge_rate_snapshot, 180);
response = await adminEntries.DELETE(request("DELETE", { reason: "Local fixture single delete" }, `?id=${uuid(6200)}`));
assert.equal(response.status, 200);
assert.ok(deleteAdmin.tables.project_tracker_entry_audit.some((entry) => entry.tracker_entry_id === uuid(6200) && entry.action === "voided"));
expectTotals(build([source], [allocation], deleteAdmin.tables.project_tracker_entries), { chargeOutSpend: 360 + 180, usedHours: 2 + 1 });
response = await adminEntries.DELETE(request("DELETE", { ids: [uuid(6201), uuid(6202)], reason: "Local mixed allocated unassigned delete" }));
assert.equal(response.status, 200, (await response.clone().json()).error);
assert.equal(deleteAdmin.tables.project_tracker_entries.length, 0);
assert.equal(deleteAdmin.tables.project_budget_allocations[0].hours_consumed, 0);
assert.equal(deleteAdmin.tables.project_budget_allocations[0].charge_out_spend, 0);
assert.equal(deleteAdmin.tables.project_tracker_entry_audit.filter((row) => row.action === "voided").length, 3);
assert.equal(deleteAdmin.writes.filter((write) => write.table === "project_budget_allocations").length, 1, "Mixed delete refreshes only real allocations.");
expectTotals(build([source], deleteAdmin.tables.project_budget_allocations, deleteAdmin.tables.project_tracker_entries), { usedHours: 0, chargeOutSpend: 0, remainingBudget: 5000 });
const auditFailure = mockAdmin(tables([unassigned(6300), unassigned(6301)]), { "project_tracker_entry_audit:insert": "Mandatory audit failed" });
const failureCtx = context(correctionSource, { access: accessFor(auditFailure, true, ADMIN) });
response = await failureCtx.DELETE(request("DELETE", { ids: [uuid(6300), uuid(6301)], reason: "Local fixture audit failure" }));
assert.equal(response.status, 500);
assert.equal(auditFailure.tables.project_tracker_entries.length, 2);
assert.ok(!auditFailure.writes.some((write) => write.operation === "delete"));

assert.match(adminUi, /No budget assignment:<\/strong>/);
assert.match(adminUi, /financials\.unassigned\?\.count/);
assert.match(adminUi, /financials\.unassigned\?\.internalCost/);
assert.match(uiSource, /historyOnly: true/);
assert.match(uiSource, /editingUnassigned \? null : form\.sourceId/);
assert.match(uiSource, /Budget assignment<span className="st-readonly">No budget assignment/);
assert.match(uiSource, /Show more of your entries/);
assert.match(uiSource, /Show more project entries/);
assert.doesNotMatch(uiSource, /charge_rate_snapshot|charge_role|internal_cost/);

// Parse JSX without a browser/server/build or any application initialization.
const require = createRequire(import.meta.url);
const swc = require("next/dist/build/swc");
for (const [filename, sourceText] of [["StaffProjectTracker.js", uiSource], ["AdminProjectTracker.js", adminUi]]) {
  await swc.transform(sourceText, { filename, jsc: { parser: { syntax: "ecmascript", jsx: true }, target: "es2022" }, module: { type: "commonjs" } });
}
console.log(`Tracker unassigned actuals passed (${checks} financial assertions): zero/mixed/unassigned-only, 2,005-row pages, stored allocated/closed history and master-budget regression, future card isolation, real staff/admin correction and deletion routes, owner/date/identity guards, audit-first mixed delete, private complete own/team/work history, nested metadata stripping, and JSX parsing. No live services or writes.`);
