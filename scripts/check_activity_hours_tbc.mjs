import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

// Offline only: evaluate the real route bodies with explicit import bindings and
// a projection-aware database double. No credentials or live connections.
const root = new URL("..", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");
const helperSource = await read("lib/workActivityHours.js");
const helpers = await import(`data:text/javascript;base64,${Buffer.from(helperSource).toString("base64")}`);
const { resolveHoursInput, resolveAssigneeInput, hoursPayload, allocationBudgetError, selectWithHoursFlags } = helpers;
const uuid = (n) => `${String(n).padStart(8, "0")}-1111-4111-8111-111111111111`;
const projectId = uuid(1), activityId = uuid(2), scheduleId = uuid(3), staffId = uuid(4), colleagueId = uuid(5), actorId = uuid(6);
let checks = 0;
const check = async (name, run) => { await run(); checks += 1; console.log(`PASS ${name}`); };
const plain = (value) => JSON.parse(JSON.stringify(value));
const responseHistory = {
  acceptance_status: "accepted", response_note: "Agreed original scope", assigned_at: "2026-10-01T00:00:00Z",
  accepted_at: "2026-10-02T00:00:00Z", declined_at: null, actioned_at: "2026-10-03T00:00:00Z",
  assigned_by: actorId, notified_at: "2026-10-01T01:00:00Z",
};
function fixture({ budget = 30, budgetTbc = false, allocated = 10, allocatedTbc = false, shared = false } = {}) {
  return {
    projects: [{ id: projectId, name: "Rail", status: "active", activities_approval_status: "approved", deleted_at: null }],
    project_activities: [{ id: activityId, project_id: projectId, staff_user_id: staffId, title: "BAR mapping", detail: "Original detail", task_category: "Mapping", budget_hours: budget, budget_hours_tbc: budgetTbc, due_date: "2026-11-20", start_date: "2026-11-16", schedule_item_id: scheduleId, sort_order: 1, status: "active", progress_percent: 25, milestone: false, is_active: true, updated_at: "2026-11-01T00:00:00Z", ...responseHistory }],
    project_activity_assignees: [{ id: uuid(7), activity_id: activityId, staff_user_id: staffId, allocated_hours: allocated, allocated_hours_tbc: allocatedTbc, role: "lead", ...responseHistory }, ...(shared ? [{ id: uuid(8), activity_id: activityId, staff_user_id: colleagueId, allocated_hours: 5, allocated_hours_tbc: false, role: "contributor", ...responseHistory }] : [])],
    project_schedule_items: [{ id: scheduleId, project_id: projectId, title: "BAR mapping", detail: "Original detail", start_date: "2026-11-16", end_date: "2026-11-20", generated_from_activity_id: activityId, sort_order: 1, is_active: true, status: "active", progress_percent: 25 }],
    project_allocations: [{ id: uuid(9), project_id: projectId, staff_user_id: staffId, active: true, allocated_hours: 40, hourly_rate: 123 }, { id: uuid(10), project_id: projectId, staff_user_id: colleagueId, active: true, allocated_hours: 40, hourly_rate: 234 }],
    project_budget_sources: [{ id: uuid(11), project_id: projectId, approved_hours: 30, approved_value: 5000 }],
    project_budget_allocations: [{ id: uuid(12), project_id: projectId, allocation_hours: 30, hours_consumed: 3, charge_out_spend: 321, internal_cost: 123, staff_visible: true, status: "active" }],
    project_tracker_entries: [{ id: uuid(13), project_id: projectId, staff_user_id: staffId, activity_id: activityId, hours: 3, historic_rate: 107, work_date: "2026-11-01" }],
    project_activity_history: [{ id: uuid(14), activity_id: activityId, note: "Original record" }],
    staff_capacity_profiles: [], remote_tasks: [], service_requests: [], policy_documents: [], portal_events: [], project_deliverables: [],
  };
}
function mockDatabase(input, { assignmentMissing = false, flagsMissing = false } = {}) {
  const tables = structuredClone(input), calls = [];
  let nextId = 100;
  const directory = [{ id: staffId, name: "Staff" }, { id: colleagueId, name: "Colleague" }];
  const admin = {
    auth: { admin: { listUsers: async () => ({ data: { users: directory.map((p) => ({ ...p, email: `${p.id}@example.test` })) } }) } },
    from(table) {
      const call = { table, kind: "select", filters: [], columns: "", values: null, options: null };
      const matches = (row) => call.filters.every(([op, key, value]) => op === "eq" ? row[key] === value : op === "neq" ? row[key] !== value : op === "in" ? value.includes(row[key]) : op === "is" ? (row[key] ?? null) === value : op === "not" ? row[key] != null : true);
      const execute = (single = false) => {
        calls.push(structuredClone(call));
        const flagColumns = call.columns.match(/\b(?:budget|allocated)_hours_tbc\b/g) || [];
        for (const flag of flagColumns) assert.equal(table, flag === "budget_hours_tbc" ? "project_activities" : "project_activity_assignees", `TBC column ${flag} cannot be selected from ${table}`);
        if (assignmentMissing && table === "project_activity_assignees") return { data: null, error: { code: "42P01", message: "project_activity_assignees does not exist" } };
        if (flagsMissing && flagColumns.length) return { data: null, error: { code: "42703", message: `column ${flagColumns[0]} does not exist` } };
        tables[table] ||= [];
        let rows = tables[table].filter(matches);
        if (call.kind === "update") rows.forEach((row) => Object.assign(row, call.values));
        if (call.kind === "insert") {
          rows = (Array.isArray(call.values) ? call.values : [call.values]).map((row) => ({ id: uuid(nextId++), ...row }));
          tables[table].push(...rows);
        }
        if (call.kind === "delete") { tables[table] = tables[table].filter((row) => !matches(row)); rows = []; }
        if (call.options?.head) return { data: null, error: null, count: rows.length };
        if (call.limit != null) rows = rows.slice(0, call.limit);
        rows = rows.map((row) => {
          // Respect projection: a forgotten flag SELECT must fail the tests.
          const result = {};
          for (const [key, value] of Object.entries(row)) if (call.columns === "*" || new RegExp(`\\b${key}\\b`).test(call.columns)) result[key] = value;
          if (call.columns.includes("projects!")) result.projects = { name: "Rail" };
          return structuredClone(result);
        });
        return { data: single ? rows[0] || null : rows, error: null };
      };
      const query = {
        select(columns, options) { call.columns = columns; call.options = options; return query; },
        eq(key, value) { call.filters.push(["eq", key, value]); return query; },
        neq(key, value) { call.filters.push(["neq", key, value]); return query; },
        in(key, value) { call.filters.push(["in", key, value]); return query; },
        is(key, value) { call.filters.push(["is", key, value]); return query; },
        not(key, op, value) { call.filters.push(["not", key, value]); return query; },
        order() { return query; }, limit(n) { call.limit = n; return query; },
        update(values) { call.kind = "update"; call.values = values; return query; },
        insert(values) { call.kind = "insert"; call.values = values; return query; },
        delete() { call.kind = "delete"; return query; },
        async single() { return execute(true); }, async maybeSingle() { return execute(true); },
        then(resolve, reject) { return Promise.resolve().then(() => execute()).then(resolve, reject); },
      };
      return query;
    },
  };
  return { admin, tables, calls, directory };
}
const paths = {
  collection: "app/api/projects/[projectId]/activities/route.js",
  single: "app/api/projects/[projectId]/activities/[activityId]/route.js",
  capacity: "app/api/admin/staff-capacity/route.js",
  mine: "app/api/my-activities/route.js",
  tracker: "app/api/project-tracker-entries/route.js",
};
const sources = Object.fromEntries(await Promise.all(Object.entries(paths).map(async ([key, path]) => [key, await read(path)])));
function loadRoutes(db, isAdmin = true) {
  const access = { admin: db.admin, isAdmin, user: { id: isAdmin ? actorId : staffId } };
  const common = {
    ...helpers, Response, Request, URL, Date, console,
    requireSession: async () => access, serverError: (error) => Response.json({ error: error.message }, { status: 500 }),
    requirePortalResource: async () => null, listDirectoryUsers: async () => db.directory,
    compactAuditRecord: (v) => v, recordAudit: async () => {},
  };
  const load = (source, names, extra = {}) => {
    const context = vm.createContext({ ...common, ...extra });
    vm.runInContext(source.replace(/^import[^\n]*\n/gm, "").replace(/^export /gm, "") + `\nthis.handlers = { ${names.join(", ")} };`, context);
    return context.handlers;
  };
  const single = load(sources.single, ["PATCH", "normaliseAssignees", "assignmentView"]);
  return {
    access, single,
    collection: load(sources.collection, ["GET", "PUT", "normaliseAssignees"]),
    capacity: load(sources.capacity, ["GET", "POST", "capacityData", "assignmentCapacityHours"], { patchWorkActivity: single.PATCH }),
    mine: load(sources.mine, ["GET", "assignmentResponse"]),
    tracker: load(sources.tracker, ["teamEntries", "assignmentProjection"]),
  };
}
const request = (body, method = "PATCH") => new Request(`https://example.test/api/projects/${projectId}/activities/${activityId}`, { method, headers: { "Content-Type": "application/json", Authorization: "test" }, body: JSON.stringify(body) });
const params = { params: { projectId, activityId } };
async function edit(db, body, collection = false) {
  const routes = loadRoutes(db);
  const result = collection ? await routes.collection.PUT(request({ activities: [{ id: activityId, title: "BAR mapping", ...body }] }, "PUT"), params) : await routes.single.PATCH(request(body), params);
  return { status: result.status, body: await result.json() };
}
function assertProtected(db, before) {
  for (const table of ["project_allocations", "project_budget_sources", "project_budget_allocations", "project_tracker_entries", "project_activity_history"]) {
    assert.deepEqual(db.tables[table], before[table], `${table}: plan edits must preserve financial/time/history data`);
    assert(!db.calls.some((call) => call.table === table && call.kind !== "select"));
  }
  for (const key of Object.keys(responseHistory)) assert.equal(db.tables.project_activities[0][key], before.project_activities[0][key], `Parent response ${key} must be preserved`);
  for (const row of db.tables.project_activity_assignees) {
    const previous = before.project_activity_assignees.find((old) => old.id === row.id);
    if (!previous || row.acceptance_status === "removed") continue;
    for (const key of Object.keys(responseHistory)) assert.equal(row[key], previous[key], `Recipient response ${key} must be preserved`);
  }
}
await check("input helper: blank/null/whitespace creates numeric zero plus TBC", () => {
  for (const value of ["", null, "  "]) assert.deepEqual(resolveHoursInput({ budgetHours: value }, { budget_hours: 27 }), { value: 0, tbc: true, supplied: true });
  assert.deepEqual(resolveHoursInput({}), { value: 0, tbc: true, supplied: false });
});
await check("input helper: flag-only keeps estimate; numeric including zero confirms", () => {
  assert.deepEqual(resolveHoursInput({ budgetHoursTbc: true }, { budget_hours: 27 }), { value: 27, tbc: true, supplied: true });
  for (const value of [0, "0", 8]) assert.equal(resolveHoursInput({ budgetHours: value }, { budget_hours: 27, budget_hours_tbc: true }).tbc, false);
  assert.deepEqual(resolveHoursInput({}, { budget_hours: 27, budget_hours_tbc: true }), { value: 27, tbc: true, supplied: false });
  assert.equal(resolveHoursInput({ budgetHours: undefined }, { budget_hours: 27 }).value, 27);
  assert(resolveHoursInput({ budgetHoursTbc: false }, { budget_hours: 27, budget_hours_tbc: true }).error);
  for (const value of [-1, "NaN", true, []]) assert(resolveHoursInput({ budgetHours: value }).error);
  assert(resolveHoursInput({ budgetHoursTbc: "true" }).error);
  assert.equal(resolveHoursInput({ budget_hours: 0, budget_hours_tbc: false }).tbc, false);
});
await check("allocation helper: unknown is not confirmed zero; guard still enforces known allocations", () => {
  const team = [{ allocatedHours: 500, allocatedHoursTbc: true }, { allocatedHours: 7 }];
  assert.equal(helpers.knownAllocationTotal(team), 7);
  assert.equal(allocationBudgetError(team, 7, false), null);
  assert(allocationBudgetError(team, 6, false));
  assert.equal(allocationBudgetError(team, 0, true), null);
  assert.equal(hoursPayload({ budget_hours: 27, budget_hours_tbc: true }).budgetHours, null);
  assert.equal(hoursPayload({ budget_hours: 0 }).budgetHours, 0);
});
await check("assignee helper: omitted team/hours retain backing estimate and role", () => {
  const fallback = [{ staffUserId: staffId, allocatedHours: 17, allocatedHoursTbc: true, role: "lead" }];
  assert.equal(resolveAssigneeInput({}, 30, false, fallback).supplied, false);
  const result = resolveAssigneeInput({ assignees: [{ staffUserId: staffId }] }, 30, false, fallback);
  assert.deepEqual(result.assignees, fallback);
  assert.equal(resolveAssigneeInput({ staffUserId: colleagueId }, 0, true).assignees[0].allocatedHoursTbc, true);
  assert.equal(resolveAssigneeInput({ assignees: [{ staffUserId: colleagueId }] }, 30, false).assignees[0].allocatedHoursTbc, true);
});
for (const collection of [false, true]) {
  const label = collection ? "collection PUT" : "fast PATCH";
  await check(`${label}: blank budget/allocation stores zero/TBC and retains all histories`, async () => {
    const before = fixture({ shared: true }); const db = mockDatabase(before);
    const result = await edit(db, { budgetHours: "", assignees: [{ staffUserId: staffId, allocatedHours: "" }, { staffUserId: colleagueId }] }, collection);
    assert.equal(result.status, 200, JSON.stringify(result.body));
    assert.equal(db.tables.project_activities[0].budget_hours, 0); assert.equal(db.tables.project_activities[0].budget_hours_tbc, true);
    assert.equal(db.tables.project_activity_assignees[0].allocated_hours, 0); assert.equal(db.tables.project_activity_assignees[0].allocated_hours_tbc, true);
    assert.equal(db.tables.project_activity_assignees[1].allocated_hours, 5);
    const output = collection ? result.body.activities[0] : result.body.activity;
    assert.equal(output.budgetHours, null); assert.equal(output.budget_hours_tbc, true);
    assert.equal(output.assignees[0].allocatedHours, null); assert.equal(output.assignees[0].allocatedHoursTbc, true);
    assertProtected(db, before); assert.equal(db.tables.portal_events.length, 0);
  });
  await check(`${label}: flag-only preserves old estimate; date/status and ID-only team saves preserve both`, async () => {
    const before = fixture({ budgetTbc: true, allocatedTbc: true }); const db = mockDatabase(before);
    let result = await edit(db, { budgetHoursTbc: true, assignees: [{ staffUserId: staffId, allocatedHoursTbc: true }] }, collection);
    assert.equal(result.status, 200, JSON.stringify(result.body));
    result = await edit(db, { dueDate: "2026-11-21", status: "qa_review", assignees: [{ staffUserId: staffId }] }, collection);
    assert.equal(result.status, 200, JSON.stringify(result.body));
    assert.equal(db.tables.project_activities[0].budget_hours, 30); assert.equal(db.tables.project_activities[0].budget_hours_tbc, true);
    assert.equal(db.tables.project_activity_assignees[0].allocated_hours, 10); assert.equal(db.tables.project_activity_assignees[0].allocated_hours_tbc, true);
    assert.equal(db.tables.project_activity_assignees[0].role, "lead"); assertProtected(db, before);
  });
  await check(`${label}: confirmed numeric/zero clears flags; known-budget overrun is rejected before writes`, async () => {
    const db = mockDatabase(fixture({ budgetTbc: true, allocatedTbc: true }));
    let result = await edit(db, { budgetHours: 0, assignees: [{ staffUserId: staffId, allocatedHours: 0 }] }, collection);
    assert.equal(result.status, 200, JSON.stringify(result.body));
    assert.equal(db.tables.project_activities[0].budget_hours_tbc, false); assert.equal(db.tables.project_activity_assignees[0].allocated_hours_tbc, false);
    const output = collection ? result.body.activities[0] : result.body.activity;
    assert.equal(output.budgetHours, 0); assert.equal(output.assignees[0].allocatedHours, 0);
    db.calls.length = 0;
    result = await edit(db, { budgetHours: 8, assignees: [{ staffUserId: staffId, allocatedHours: 7 }] }, collection);
    assert.equal(result.status, 200, JSON.stringify(result.body));
    assert.equal(db.tables.project_activities[0].budget_hours, 8); assert.equal(db.tables.project_activity_assignees[0].allocated_hours, 7);
    assert.equal(db.tables.project_activities[0].budget_hours_tbc, false); assert.equal(db.tables.project_activity_assignees[0].allocated_hours_tbc, false);
    db.calls.length = 0;
    result = await edit(db, { budgetHours: 4, assignees: [{ staffUserId: staffId, allocatedHours: 5 }] }, collection);
    assert.equal(result.status, 400); assert.match(result.body.error, /cannot exceed/);
    assert(!db.calls.some((call) => call.kind !== "select"));
  });
  await check(`${label}: read/write roundtrip keeps explicit TBC; omitted hours keep confirmed estimates`, async () => {
    const db = mockDatabase(fixture({ budgetTbc: true, allocatedTbc: true }));
    const routes = loadRoutes(db);
    const response = await routes.collection.GET(new Request(`https://example.test/api/projects/${projectId}/activities`), params);
    const output = (await response.json()).activities[0];
    assert.equal(output.budgetHours, null); assert.equal(output.assignees[0].allocatedHours, null);
    const result = await edit(db, { budgetHours: output.budgetHours, budgetHoursTbc: output.budgetHoursTbc, assignees: output.assignees }, collection);
    assert.equal(result.status, 200, JSON.stringify(result.body)); assert.equal(db.tables.project_activities[0].budget_hours_tbc, true);
    const known = mockDatabase(fixture());
    const saved = await edit(known, { dueDate: "2026-11-21", staffUserId: staffId }, collection);
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    assert.equal(known.tables.project_activities[0].budget_hours, 30); assert.equal(known.tables.project_activity_assignees[0].allocated_hours, 10);
    assert.equal(known.tables.project_activity_assignees[0].allocated_hours_tbc, false);
  });
  await check(`${label}: missing parent budget is TBC, not a zero ceiling`, async () => {
    const db = mockDatabase(fixture({ budget: null }));
    const result = await edit(db, { dueDate: "2026-11-21" }, collection);
    assert.equal(result.status, 200, JSON.stringify(result.body));
    const output = collection ? result.body.activities[0] : result.body.activity;
    assert.equal(output.budgetHours, null); assert.equal(output.budgetHoursTbc, true);
  });
  await check(`${label}: scalar fallback preserves omitted flags and financial/response records`, async () => {
    const before = fixture({ budgetTbc: true }); const db = mockDatabase(before, { assignmentMissing: true });
    const result = await edit(db, { dueDate: "2026-11-21", staffUserId: staffId }, collection);
    assert.equal(result.status, 200, JSON.stringify(result.body));
    assert.equal(db.tables.project_activities[0].budget_hours, 30); assert.equal(db.tables.project_activities[0].budget_hours_tbc, true);
    assertProtected(db, before);
    const output = collection ? result.body.activities[0] : result.body.activity;
    assert.equal(output.assignees[0].allocatedHours, null); assert.equal(output.assignees[0].allocatedHoursTbc, true);
  });
}
await check("fast PATCH: legacy scalar team replacement retains responded removals and does not silently append", async () => {
  const db = mockDatabase(fixture({ shared: true }));
  const result = await edit(db, { staffUserId: colleagueId });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal(db.tables.project_activity_assignees.find((row) => row.staff_user_id === staffId).acceptance_status, "removed");
  const remaining = db.tables.project_activity_assignees.find((row) => row.staff_user_id === colleagueId);
  assert.equal(remaining.allocated_hours, 5); assert.equal(remaining.accepted_at, responseHistory.accepted_at);
  assert.equal(result.body.activity.assignees.length, 1);
});
await check("staff outputs: my activities and tracker board return nullable parent/personal hours plus flags", async () => {
  const db = mockDatabase(fixture({ budgetTbc: true, allocatedTbc: true })); const routes = loadRoutes(db, false);
  const response = await routes.mine.GET(new Request("https://example.test/api/my-activities"));
  const output = (await response.json()).activities[0];
  assert.equal(output.budgetHours, null); assert.equal(output.budgetHoursTbc, true);
  assert.equal(output.assignment.allocatedHours, null); assert.equal(output.assignment.allocatedHoursTbc, true);
  const board = await routes.tracker.teamEntries(routes.access, projectId, { projects: [{ id: projectId }] });
  assert.equal(board.activities[0].budgetHours, null); assert.equal(board.activities[0].budgetHoursTbc, true);
  assert.equal(board.activities[0].assignees[0].allocatedHours, null); assert.equal(board.activities[0].assignees[0].allocatedHoursTbc, true);
  assert.equal(board.totals.hoursConsumed, 3); assert(!db.calls.some((call) => call.kind !== "select"));
});
await check("capacity: unknown dated allocation displays but excludes retained numeric effort; known zero remains known", async () => {
  const tables = fixture({ budgetTbc: true, allocated: 500, allocatedTbc: true, shared: true });
  tables.project_activities[0].task_category = "Fieldwork & Travel";
  tables.project_activities.push({ ...tables.project_activities[0], id: uuid(20), title: "Zero effort milestone", budget_hours: 0, budget_hours_tbc: false });
  tables.project_activity_assignees.push({ id: uuid(21), activity_id: uuid(20), staff_user_id: staffId, allocated_hours: 0, allocated_hours_tbc: false, acceptance_status: "awaiting_response" });
  tables.remote_tasks.push({ id: uuid(22), assigned_to: staffId, task: "Unestimated brief", budget_hours: null, start_date: "2026-11-16", due_date: "2026-11-20", completed_at: null, declined_at: null, withdrawn_at: null });
  const db = mockDatabase(tables); const routes = loadRoutes(db);
  const output = await routes.capacity.capacityData(routes.access, "2026-11-16", "2026-11-22");
  assert.equal(output.ready, true);
  const person = output.people.find((row) => row.id === staffId), colleague = output.people.find((row) => row.id === colleagueId);
  assert.equal(person.allocatedHours, 0); assert.equal(person.unknownAllocationCount, 2); assert.equal(person.capacityIncomplete, true);
  assert.equal(colleague.allocatedHours, 5); assert.equal(colleague.capacityIncomplete, false);
  const event = output.calendarEvents.find((row) => row.id === `activity-${activityId}` && row.staffUserId === staffId);
  assert.equal(event.budgetHours, null); assert.equal(event.hoursTbc, true); assert.equal(event.activityBudgetHours, null);
  assert.equal(event.type, "field_survey", "Fieldwork & Travel must match the field-survey calendar type regardless of case.");
  const zero = output.calendarEvents.find((row) => row.id === `activity-${uuid(20)}`);
  assert.equal(zero.budgetHours, 0); assert.equal(zero.hoursTbc, false);
  const task = output.calendarEvents.find((row) => row.type === "task_brief"); assert.equal(task.budgetHours, null); assert.equal(task.hoursTbc, true);
  assert(!db.calls.some((call) => call.kind !== "select"));
});
await check("capacity: unassigned unknown task remains visible and unknown/out-of-period counting is honest", async () => {
  const tables = fixture({ budgetTbc: true, allocatedTbc: true });
  tables.project_activities.push({ ...tables.project_activities[0], id: uuid(30), staff_user_id: null, title: "Unassigned unknown" });
  const db = mockDatabase(tables); const routes = loadRoutes(db);
  let output = await routes.capacity.capacityData(routes.access, "2026-11-16", "2026-11-22");
  const event = output.calendarEvents.find((row) => row.id === `activity-${uuid(30)}`);
  assert.equal(event.staffUserId, null); assert.equal(event.budgetHours, null); assert.equal(event.hoursTbc, true);
  output = await routes.capacity.capacityData(routes.access, "2026-12-01", "2026-12-07");
  assert.equal(output.people.find((row) => row.id === staffId).unknownAllocationCount, 0);
  assert.equal(output.people.find((row) => row.id === staffId).capacityIncomplete, false);
  const legacy = mockDatabase(fixture({ budgetTbc: true }), { assignmentMissing: true }); const legacyRoutes = loadRoutes(legacy);
  output = await legacyRoutes.capacity.capacityData(legacyRoutes.access, "2026-11-16", "2026-11-22");
  assert.equal(output.people.find((row) => row.id === staffId).unknownAllocationCount, 1);
  assert.equal(output.calendarEvents.find((row) => row.id === `activity-${activityId}`).budgetHours, null);
});
await check("capacity: legacy equal split is kept only for confirmed parent hours, never unknown estimates", () => {
  const db = mockDatabase(fixture()); const routes = loadRoutes(db);
  assert.equal(routes.capacity.assignmentCapacityHours({ budget_hours: 30 }, { allocated_hours: null }, [{}, {}]), 15);
  assert.equal(routes.capacity.assignmentCapacityHours({ budget_hours: 30, budget_hours_tbc: true }, { allocated_hours: null }, [{}, {}]), null);
  assert.equal(routes.capacity.assignmentCapacityHours({ budget_hours: 30, budget_hours_tbc: true }, { allocated_hours: 0 }, [{}]), 0);
});
await check("schedule reassignment: linked date/hour edits reuse recipient-safe PATCH and preserve unrelated stores", async () => {
  const before = fixture({ budgetTbc: true, allocatedTbc: true }); const db = mockDatabase(before); const routes = loadRoutes(db);
  const response = await routes.capacity.POST(request({ action: "assign_schedule_item", scheduleItemId: scheduleId, staffUserId: staffId, startDate: "2026-11-17", dueDate: "2026-11-21" }, "POST"));
  const output = await response.json(); assert.equal(response.status, 200, JSON.stringify(output));
  assert.equal(db.tables.project_activities[0].budget_hours, 30); assert.equal(db.tables.project_activities[0].budget_hours_tbc, true);
  assert.equal(db.tables.project_activity_assignees[0].allocated_hours, 10); assert.equal(db.tables.project_activity_assignees[0].allocated_hours_tbc, true);
  assertProtected(db, before); assert.equal(db.tables.portal_events.length, 0);
});
await check("schedule materialization: omitted budget creates numeric-backed TBC and recipient assignment", async () => {
  const tables = fixture(); tables.project_activities = []; tables.project_activity_assignees = []; tables.project_schedule_items[0].generated_from_activity_id = null;
  const db = mockDatabase(tables); const routes = loadRoutes(db);
  const response = await routes.capacity.POST(request({ action: "assign_schedule_item", scheduleItemId: scheduleId, staffUserId: staffId }, "POST"));
  const output = await response.json(); assert.equal(response.status, 200, JSON.stringify(output));
  assert.equal(db.tables.project_activities[0].budget_hours, 0); assert.equal(db.tables.project_activities[0].budget_hours_tbc, true);
  assert.equal(db.tables.project_activity_assignees[0].allocated_hours, 0); assert.equal(db.tables.project_activity_assignees[0].allocated_hours_tbc, true);
  assert.equal(db.tables.portal_events.length, 1); assert.match(db.tables.portal_events[0].body, /TBC/);
});
await check("all save APIs: malformed flags/numbers and ineligible recipients fail before writes", async () => {
  for (const collection of [false, true]) {
    for (const body of [{ budgetHoursTbc: "true" }, { budgetHours: -1 }, { assignees: [{ staffUserId: staffId, allocatedHoursTbc: "true" }] }, { staffUserId: uuid(999) }]) {
      const db = mockDatabase(fixture()); const result = await edit(db, body, collection);
      assert.equal(result.status, 400, JSON.stringify(result.body));
      assert(!db.calls.some((call) => call.kind !== "select"));
    }
    const mixed = mockDatabase(fixture({ allocated: 500, allocatedTbc: true, shared: true }));
    let result = await edit(mixed, { budgetHours: 5 }, collection);
    assert.equal(result.status, 200, JSON.stringify(result.body));
    mixed.calls.length = 0;
    result = await edit(mixed, { budgetHours: 4 }, collection);
    assert.equal(result.status, 400, "Known colleague allocation must still fit a confirmed parent despite unknown sibling effort.");
    assert(!mixed.calls.some((call) => call.kind !== "select"));
  }
  const tables = fixture(); tables.project_activities = []; tables.project_activity_assignees = []; tables.project_allocations = []; tables.project_schedule_items[0].generated_from_activity_id = null;
  const db = mockDatabase(tables); const routes = loadRoutes(db);
  const response = await routes.capacity.POST(request({ action: "assign_schedule_item", scheduleItemId: scheduleId, staffUserId: staffId }, "POST"));
  assert.equal(response.status, 400); assert(!db.calls.some((call) => call.kind !== "select"));
});
await check("staged flag migration: read fallback keeps authoritative join relation, without scalar resurrection", async () => {
  const db = mockDatabase(fixture({ shared: true }), { flagsMissing: true });
  const routes = loadRoutes(db);
  const response = await routes.collection.GET(new Request(`https://example.test/api/projects/${projectId}/activities`), params);
  const output = await response.json(); assert.equal(response.status, 200, JSON.stringify(output));
  assert.equal(output.multiAssigneeReady, true); assert.equal(output.activities[0].assignees.length, 2);
  let queries = [];
  const result = await selectWithHoursFlags(async (columns) => { queries.push(columns); return queries.length === 1 ? { error: { message: "column allocated_hours_tbc does not exist" } } : { data: [], error: null }; }, "id, allocated_hours, allocated_hours_tbc, role");
  assert.equal(result.hoursTbcReady, false); assert.equal(queries[1], "id, allocated_hours, role");
});
await check("migration: additive flags only, no historical backfill or destructive financial changes", async () => {
  const migration = await read("sql/2026-11-13-work-activity-hours-tbc.sql");
  assert.match(migration, /ALTER TABLE public\.project_activities\s+ADD COLUMN IF NOT EXISTS budget_hours_tbc boolean NOT NULL DEFAULT false/i);
  assert.match(migration, /ALTER TABLE public\.project_activity_assignees\s+ADD COLUMN IF NOT EXISTS allocated_hours_tbc boolean NOT NULL DEFAULT false/i);
  assert(!/\b(?:UPDATE|DELETE|DROP|TRUNCATE)\b/i.test(migration.replace(/^--.*$/gm, "")));
  assert(!/public\.(?:projects|remote_tasks|project_tracker_entries|project_budget_allocations)\b/.test(migration));
});
console.log(`Activity hours TBC behavioral regressions passed: ${checks}/${checks} groups, offline actual-route mocks; no live mutations.`);
