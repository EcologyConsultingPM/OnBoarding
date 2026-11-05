import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import vm from "node:vm";

const root = new URL("..", import.meta.url);
const read = (file) => readFile(new URL(file, root), "utf8");
const helperSource = await read("lib/projectBudgetPeriods.js");
const helpers = await import(`data:text/javascript;base64,${Buffer.from(helperSource).toString("base64")}`);
const { monthBudgetPeriod, budgetPeriodPatch, budgetPeriodError, budgetSourceMatchesDate, budgetEntryPeriodError, budgetPeriodLabel, selectBudgetForDate, missingBudgetMessage, serviceMonthForSource, validBudgetDate } = helpers;
const allocation = (id, category) => ({ id, allocation_name: category, allocation_code: category.toLowerCase().replaceAll(" ", "_") });
const source = (id, month) => ({ id, ...(month ? monthBudgetPeriod(month) : {}), allocations: [allocation(`${id}-field`, "Fieldwork"), allocation(`${id}-report`, "Reporting")] });
const october = source("oct", "2026-10");
const november = source("nov", "2026-11");
const legacy = source("legacy");
const project = { id: "p", template: { category_options: ["Fieldwork", "Reporting"] }, sources: [legacy, october, november] };
assert.deepEqual(monthBudgetPeriod("2024-02"), { service_period_start: "2024-02-01", service_period_end: "2024-02-29" });
assert.deepEqual(monthBudgetPeriod("2026-02"), { service_period_start: "2026-02-01", service_period_end: "2026-02-28" });
assert.deepEqual(monthBudgetPeriod("2026-12"), { service_period_start: "2026-12-01", service_period_end: "2026-12-31" });
assert.deepEqual(monthBudgetPeriod(""), { service_period_start: null, service_period_end: null });
assert.throws(() => monthBudgetPeriod("2026-13"), /valid service month/);
assert.throws(() => monthBudgetPeriod("0000-01"), /valid service month/);
assert.equal(validBudgetDate("2026-02-30"), false);
assert.equal(validBudgetDate("2024-02-29"), true);
assert.deepEqual(budgetPeriodPatch({ sourceName: "Older input" }), {}, "Omission must preserve period columns on an update.");
assert.deepEqual(budgetPeriodPatch({ serviceMonth: "2026-11" }), monthBudgetPeriod("2026-11"));
assert.deepEqual(budgetPeriodPatch({ servicePeriodStart: "", servicePeriodEnd: "" }), monthBudgetPeriod(""));
assert.throws(() => budgetPeriodPatch({ service_period_start: "2026-11-01" }), /both/);
assert.match(budgetPeriodError({ service_period_start: "2026-11-02", service_period_end: "2026-11-01" }), /both valid dates/);
assert.equal(budgetSourceMatchesDate(october, "2026-10-01"), true);
assert.equal(budgetSourceMatchesDate(october, "2026-10-31"), true);
assert.equal(budgetSourceMatchesDate(october, "2026-11-01"), false);
assert.equal(budgetSourceMatchesDate(legacy, "1999-01-01"), true);
assert.equal(budgetPeriodLabel(november), "November 2026");
assert.equal(serviceMonthForSource({ service_period_start: "2026-11-05", service_period_end: "2026-11-20" }), "");
assert.equal(budgetEntryPeriodError(november, "2026-11-05", november.allocations[0], "Fieldwork"), "");
assert.match(budgetEntryPeriodError(november, "2026-10-31", november.allocations[0], "Fieldwork"), /service period/);
assert.match(budgetEntryPeriodError(november, "2026-11-05", november.allocations[0], "Reporting"), /matching the activity category/);
assert.equal(budgetEntryPeriodError(legacy, "2000-01-01", legacy.allocations[0], "Reporting"), "", "Non-perioded category behaviour is unchanged.");
let form = selectBudgetForDate(project, { workDate: "2026-11-05", category: "Reporting", sourceId: "legacy", allocationId: "legacy-field" });
assert.equal(form.sourceId, "nov"); assert.equal(form.allocationId, "nov-report");
form = selectBudgetForDate(project, { ...form, workDate: "2026-10-02" });
assert.equal(form.sourceId, "oct"); assert.equal(form.allocationId, "oct-report");
form = selectBudgetForDate(project, { ...form, workDate: "2026-12-01" });
assert.equal(form.sourceId, ""); assert.equal(form.allocationId, "");
assert.match(missingBudgetMessage(project, "2026-12-01"), /No approved service-month budget/);
form = selectBudgetForDate(project, { ...form, workDate: "2026-11-05", category: "Unconfigured" });
assert.equal(form.allocationId, "", "Never pick an unrelated category's first allocation.");
const historical = { workDate: "2026-10-02", category: "Fieldwork", sourceId: "legacy", allocationId: "legacy-field" };
assert.deepEqual(selectBudgetForDate(project, historical, { preserve: true }), historical);
assert.equal(selectBudgetForDate(project, historical, { preferredSourceId: "legacy" }).sourceId, "legacy", "Unrestricted sources remain explicitly selectable.");
assert.equal(selectBudgetForDate({ ...project, sources: [legacy] }, historical).sourceId, "legacy");
const closedOctober = { ...october, approval_status: "closed" };
const pastForm = { ...historical, sourceId: "oct", allocationId: "oct-field" };
assert.deepEqual(selectBudgetForDate({ ...project, sources: [legacy, closedOctober, november] }, pastForm, { preserve: true }), pastForm);
assert.equal(selectBudgetForDate({ ...project, sources: [legacy, closedOctober, november] }, { ...pastForm, workDate: "2026-11-02" }).sourceId, "nov");
assert.equal(selectBudgetForDate({ ...project, sources: [legacy, closedOctober, november] }, { ...pastForm, workDate: "2026-10-03" }).sourceId, "", "Never automatically reuse a closed historical monthly source.");
const closedAllocation = { ...november, allocations: november.allocations.map((row) => ({ ...row, historicalOnly: true })) };
assert.equal(selectBudgetForDate({ ...project, sources: [closedAllocation] }, { ...pastForm, workDate: "2026-11-02" }).allocationId, "");

const staffRoute = await read("app/api/project-tracker-entries/route.js");
const adminRoute = await read("app/api/admin/project-tracker/route.js");
const adminEntries = await read("app/api/admin/project-tracker-entries/route.js");
const staffUi = await read("components/StaffProjectTracker.js");
const adminUi = await read("components/AdminProjectTracker.js");
const migration = await read("sql/2026-11-05-project-budget-service-periods.sql");
assert.match(adminRoute, /SOURCE_COLUMNS = .*service_period_start, service_period_end/);
assert.match(adminRoute, /budgetPeriodPatch\(body\)/);
assert.match(adminRoute, /outside\?\.length.*Cannot change service period/);
assert.match(staffRoute, /service_period_start: source\.service_period_start \?\? null/);
assert.match(staffRoute, /service_period_end: source\.service_period_end \?\? null/);
assert.match(staffRoute, /budgetSource: entry\.source/);
assert.match(staffRoute, /const periodError = budgetEntryPeriodError/);
assert.match(staffRoute, /const budget = await validateTrackerBudgetCorrection/);
assert.match(adminEntries, /const budget = await validateTrackerBudgetCorrection/);
assert.match(staffRoute, /if \(budget\.allocationId !== current\.budget_allocation_id\) await refreshTrackerAllocation/);
assert.match(adminUi, /Service month \(optional\)/);
assert.match(adminUi, /type="month"/);
assert.match(staffUi, /filter\(\(source\) => budgetSourceMatchesDate\(source, form\.workDate\)\)/);
assert.match(staffUi, /current\.workDate === editingEntry\?\.workDate/);
assert.match(staffUi, /hasBudgetPeriod\(originalSource\) && budgetSourceMatchesDate\(originalSource, current\.workDate\)/);
assert.match(staffUi, /allocationMatchesCategory\(allocation, form\.category\)/);
assert.match(staffUi, /accessTokenRef\.current = session\?\.access_token/);
assert.doesNotMatch(migration.replace(/--[^\n]*/g, ""), /security definer|alter policy|create policy|disable row level security/i);

// Execute actual route functions with isolated query doubles. Failed validation
// must be observed before *any* write, not merely by source-string contracts.
const ids = {
  project: "10000000-0000-4000-8000-000000000001", staff: "10000000-0000-4000-8000-000000000002",
  source: "10000000-0000-4000-8000-000000000003", allocation: "10000000-0000-4000-8000-000000000004",
  nextSource: "10000000-0000-4000-8000-000000000005", nextAllocation: "10000000-0000-4000-8000-000000000006",
};
const apiSource = { ...november, id: ids.source, project_id: ids.project, approval_status: "approved", allocations: [{ ...november.allocations[0], id: ids.allocation }] };
const apiProject = { id: ids.project, isAssigned: true, template: { category_options: ["Fieldwork", "Reporting"] }, sources: [apiSource] };
let writes = [];
let tables = { project_budget_sources: [apiSource], project_budget_allocations: [{ ...apiSource.allocations[0], project_id: ids.project, budget_source_id: ids.source, status: "active", staff_visible: true }] };
const admin = { from(table) {
  let filters = [];
  const q = { select() { return q; }, eq(k, value) { filters.push((row) => row[k] === value); return q; },
    maybeSingle() { return Promise.resolve({ data: (tables[table] || []).find((row) => filters.every((f) => f(row))) || null, error: null }); },
    insert(payload) { writes.push({ table, payload }); throw new Error("Unexpected write during failed validation"); },
    update(payload) { writes.push({ table, payload }); throw new Error("Unexpected write during failed validation"); },
  }; return q;
} };
const context = {
  ...helpers, Response, Date, console,
  validId: (value) => /^[0-9a-f-]{36}$/.test(value), text: (value, max) => typeof value === "string" ? value.trim().slice(0, max) : "",
  hours: (value) => Number(value), STATUSES: new Set(["active"]),
  eligibleProjects: async () => ({ available: true, projects: [apiProject] }),
};
vm.createContext(context);
const createCode = staffRoute.slice(staffRoute.indexOf("export async function createTrackerEntry("), staffRoute.indexOf("export async function POST(request)")).replace("export async function", "async function");
const correctionCode = staffRoute.slice(staffRoute.indexOf("export async function validateTrackerBudgetCorrection("), staffRoute.indexOf("export async function PATCH(request)")).replace("export async function", "async function");
vm.runInContext(`${createCode}\n${correctionCode}\nthis.create = createTrackerEntry; this.correct = validateTrackerBudgetCorrection;`, context);
const access = { admin, user: { id: ids.staff }, isAdmin: false };
const input = { projectId: ids.project, sourceId: ids.source, allocationId: ids.allocation, workDate: "2026-10-31", activityCategory: "Fieldwork", activityInformation: "Work", hours: 1, status: "active" };
assert.match((await context.create(access, input)).error, /service period/);
assert.match((await context.create(access, { ...input, workDate: "2026-11-05", activityCategory: "Reporting" })).error, /matching the activity category/);
assert.equal(writes.length, 0);
const current = { project_id: ids.project, staff_user_id: ids.staff, budget_source_id: ids.source, budget_allocation_id: ids.allocation };
assert.match((await context.correct(access, current, {}, "2026-10-31", "Fieldwork")).error, /service period/);
assert.equal((await context.correct(access, current, {}, "2026-11-05", "Fieldwork")).sourceId, ids.source, "Older PATCH input retains its current source.");
apiSource.approval_status = "closed";
assert.equal((await context.correct(access, current, {}, "2026-11-05", "Fieldwork")).sourceId, ids.source, "In-period historical corrections retain a closed source.");
assert.equal(writes.length, 0);
const nextApiSource = { ...apiSource, id: ids.nextSource, ...monthBudgetPeriod("2026-12"), approval_status: "approved", allocations: [{ ...apiSource.allocations[0], id: ids.nextAllocation }] };
tables.project_budget_sources.push(nextApiSource);
tables.project_budget_allocations.push({ ...nextApiSource.allocations[0], project_id: ids.project, budget_source_id: ids.nextSource, status: "active", staff_visible: true });
apiProject.sources = [apiSource, nextApiSource];
const moved = await context.correct(access, current, { sourceId: ids.nextSource, allocationId: ids.nextAllocation }, "2026-12-01", "Fieldwork");
assert.equal(moved.sourceId, ids.nextSource); assert.equal(moved.allocationId, ids.nextAllocation);
assert.match((await context.correct(access, current, { sourceId: ids.nextSource, allocationId: ids.allocation }, "2026-12-01", "Fieldwork")).error, /must belong/);
apiProject.sources = [apiSource];
assert.match((await context.correct(access, current, { sourceId: ids.nextSource, allocationId: ids.nextAllocation }, "2026-12-01", "Fieldwork")).error, /approved active staff-visible/);
assert.equal(writes.length, 0);
console.log("Budget periods: pure helpers, UI/API contracts and actual pre-write route validation passed.");

// Real PostgreSQL (PGlite), never a live connection. Resolve the normal package
// first; this review sandbox supplies a temporary, already-installed fallback.
const require = createRequire(import.meta.url);
let modulePath;
try { modulePath = require.resolve("@electric-sql/pglite"); }
catch { modulePath = require.resolve("/home/ubuntu/tmp/closeout-db-test/node_modules/@electric-sql/pglite"); }
const { PGlite } = await import(pathToFileURL(modulePath).href);
const db = new PGlite();
try {
  await db.exec(`
    create table public.project_budget_sources (id uuid primary key, project_id uuid not null, source_type text default 'original', approved_value numeric default 100);
    create table public.project_budget_allocations (id uuid primary key, project_id uuid not null, budget_source_id uuid not null references public.project_budget_sources(id));
    create table public.project_tracker_entries (id uuid primary key, project_id uuid not null, budget_source_id uuid not null references public.project_budget_sources(id), budget_allocation_id uuid not null references public.project_budget_allocations(id), work_date date not null, hours numeric default 1);
    alter table public.project_budget_sources enable row level security;
    create policy unchanged_policy on public.project_budget_sources using (true);
    insert into public.project_budget_sources(id, project_id) values ('${ids.source}', '${ids.project}');
    insert into public.project_budget_allocations values ('${ids.allocation}', '${ids.project}', '${ids.source}');
    insert into public.project_tracker_entries(id, project_id, budget_source_id, budget_allocation_id, work_date) values ('20000000-0000-4000-8000-000000000001', '${ids.project}', '${ids.source}', '${ids.allocation}', '1999-01-01');
  `);
  const policyBefore = (await db.query("select policyname, qual from pg_policies where schemaname = 'public' limit 10")).rows;
  await db.exec(migration);
  await db.exec(migration); // Additive migration is re-runnable.
  assert.deepEqual((await db.query("select policyname, qual from pg_policies where schemaname = 'public' limit 10")).rows, policyBefore);
  assert.equal((await db.query("select relrowsecurity from pg_class where oid = 'public.project_budget_sources'::regclass limit 1")).rows[0].relrowsecurity, true);
  assert.equal((await db.query("select service_period_start, service_period_end from public.project_budget_sources limit 1")).rows[0].service_period_start, null);
  await db.exec(`update public.project_tracker_entries set hours = 2 where id = '20000000-0000-4000-8000-000000000001';`);
  await assert.rejects(db.exec(`update public.project_budget_sources set service_period_start = '2026-11-01', service_period_end = '2026-11-30' where id = '${ids.source}';`), /existing tracker entries/);
  assert.equal((await db.query("select service_period_start from public.project_budget_sources where id = $1 limit 1", [ids.source])).rows[0].service_period_start, null);
  await db.exec(`insert into public.project_budget_sources(id, project_id, service_period_start, service_period_end) values ('${ids.nextSource}', '${ids.project}', '2026-11-01', '2026-11-30');
    insert into public.project_budget_allocations values ('${ids.nextAllocation}', '${ids.project}', '${ids.nextSource}');`);
  await assert.rejects(db.exec(`update public.project_budget_sources set service_period_end = null where id = '${ids.nextSource}';`), /service_period_bounds/);
  await assert.rejects(db.exec(`update public.project_budget_sources set service_period_end = '2026-10-31' where id = '${ids.nextSource}';`), /service_period_bounds/);
  await assert.rejects(db.exec(`update public.project_budget_sources set service_period_end = 'infinity' where id = '${ids.nextSource}';`), /service_period_bounds/);
  let entryNumber = 10;
  const insert = (date, { projectId = ids.project, sourceId = ids.nextSource, allocationId = ids.nextAllocation } = {}) => db.exec(`insert into public.project_tracker_entries(id, project_id, budget_source_id, budget_allocation_id, work_date) values ('20000000-0000-4000-8000-${String(entryNumber++).padStart(12, "0")}', '${projectId}', '${sourceId}', '${allocationId}', '${date}');`);
  await insert("2026-11-01"); await insert("2026-11-30");
  await assert.rejects(insert("2026-10-31"), /Work date must fall within/);
  await assert.rejects(insert("2026-12-01"), /Work date must fall within/);
  await assert.rejects(insert("2026-11-05", { projectId: ids.staff }), /Budget source must belong/);
  await assert.rejects(insert("2026-11-05", { allocationId: ids.allocation }), /Budget allocation must belong/);
  const foreignAllocation = "10000000-0000-4000-8000-000000000007";
  await db.exec(`insert into public.project_budget_allocations values ('${foreignAllocation}', '${ids.staff}', '${ids.nextSource}');`);
  await assert.rejects(insert("2026-11-05", { allocationId: foreignAllocation }), /Budget allocation must belong/);
  await assert.rejects(db.exec("update public.project_tracker_entries set work_date = '2026-12-01' where id = '20000000-0000-4000-8000-000000000010';"), /Work date must fall within/);
  await assert.rejects(db.exec(`update public.project_tracker_entries set budget_source_id = '${ids.source}' where id = '20000000-0000-4000-8000-000000000010';`), /Budget allocation must belong/);
  await assert.rejects(db.exec(`update public.project_budget_sources set service_period_start = '2026-11-02' where id = '${ids.nextSource}';`), /existing tracker entries/);
  await assert.rejects(db.exec(`update public.project_budget_sources set project_id = '${ids.staff}' where id = '${ids.nextSource}';`), /Cannot move a budget source/);
  assert.equal((await db.query("select service_period_start::text as start from public.project_budget_sources where id = $1 limit 1", [ids.nextSource])).rows[0].start, "2026-11-01");
  // Demonstrate real transactional rollback: neither a preceding valid change
  // nor the invalid period edit survives the failed transaction.
  await db.exec("begin; update public.project_tracker_entries set hours = 9 where id = '20000000-0000-4000-8000-000000000010';");
  await assert.rejects(db.exec(`update public.project_budget_sources set service_period_end = '2026-11-29' where id = '${ids.nextSource}';`), /existing tracker entries/);
  await db.exec("rollback;");
  assert.equal(Number((await db.query("select hours from public.project_tracker_entries where id = '20000000-0000-4000-8000-000000000010' limit 1")).rows[0].hours), 1);
  // An explicit correction moves both IDs and work date together, not a cascade.
  await db.exec(`update public.project_tracker_entries set budget_source_id = '${ids.source}', budget_allocation_id = '${ids.allocation}', work_date = '2001-01-01' where id = '20000000-0000-4000-8000-000000000010';`);
  await insert("1990-01-01", { sourceId: ids.source, allocationId: ids.allocation });
  await db.exec(`update public.project_budget_sources set service_period_start = '2026-10-15', service_period_end = '2026-12-15' where id = '${ids.nextSource}';`);
  await insert("2026-10-15"); await insert("2026-12-15");
  await db.exec(`update public.project_budget_sources set service_period_start = null, service_period_end = null where id = '${ids.nextSource}';`);
  await insert("2027-01-01");
  const functions = (await db.query("select proname, prosecdef, proconfig from pg_proc where proname in ('check_project_tracker_entry_service_period', 'check_project_budget_source_period_edit') limit 2")).rows;
  assert.equal(functions.length, 2);
  assert(functions.every((fn) => !fn.prosecdef && fn.proconfig.includes("search_path=pg_catalog, public")));
  const columns = (await db.query("select column_name, data_type, is_nullable from information_schema.columns where table_schema = 'public' and table_name = 'project_budget_sources' and column_name in ('service_period_start', 'service_period_end') order by column_name limit 2")).rows;
  assert(columns.every((column) => column.data_type === "date" && column.is_nullable === "YES"));
  console.log("Budget periods: real PostgreSQL/PGlite migration, insert/update guards, inclusive bounds, project/source/allocation integrity, period-edit rollback, legacy dates, idempotence and unchanged RLS passed.");
} finally { await db.close(); }
