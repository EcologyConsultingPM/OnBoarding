import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

// Execute the shipped helper and route, not duplicated reconciliation logic.
// Projection-aware doubles can deliberately ignore query filters to prove the
// route itself rejects tombstones. No credentials, imports of old source data,
// network requests, or live mutations are used by this regression suite.
const root = new URL("..", import.meta.url);
const read = (file) => readFile(new URL(file, root), "utf8");
const loadHelper = async (file) => import(`data:text/javascript;base64,${Buffer.from(await read(file)).toString("base64")}`);
const scheduling = await loadHelper("lib/staffCalendarScheduling.js");
const hours = await loadHelper("lib/workActivityHours.js");
const { calendarDayPolicy, scheduledDaysInRange, eventFallsOnWorkDay, isNonWorkingDay } = scheduling;
const routeSource = await read("app/api/admin/staff-capacity/route.js");
const plain = (value) => JSON.parse(JSON.stringify(value));
const uuid = (n) => `${String(n).padStart(8, "0")}-1111-4111-8111-111111111111`;
const projectId = uuid(1), staffId = uuid(2), otherId = uuid(3), activityId = uuid(4), scheduleId = uuid(5);
const directory = [{ id: staffId, name: "Staff" }, { id: otherId, name: "Colleague" }];
let checks = 0;
const check = async (name, run) => { await run(); checks += 1; console.log(`PASS ${name}`); };
const activity = (extra = {}) => ({ id: activityId, project_id: projectId, staff_user_id: staffId, title: "Saved edited Monaro fieldwork", detail: "Latest saved scope", task_category: "Fieldwork & Travel", budget_hours: 30, budget_hours_tbc: false, start_date: "2026-11-13", due_date: "2026-11-17", status: "active", acceptance_status: "accepted", is_active: true, updated_at: "2026-11-13T00:00:00Z", ...extra });
const assignment = (extra = {}) => ({ activity_id: activityId, staff_user_id: staffId, allocated_hours: 30, allocated_hours_tbc: false, acceptance_status: "awaiting_response", removed_at: null, updated_at: "2026-11-13T00:00:00Z", ...extra });
const schedule = (extra = {}) => ({ id: scheduleId, project_id: projectId, title: "Saved manual schedule", detail: "Edited schedule detail", start_date: "2026-11-13", end_date: "2026-11-17", status: "active", is_active: true, generated_from_activity_id: null, ...extra });
function fixture() {
  return { projects: [{ id: projectId, name: "User-edited project", client_name: "Client", status: "active", deleted_at: null }], project_activities: [activity()], project_activity_assignees: [assignment()], project_schedule_items: [], staff_capacity_profiles: [], remote_tasks: [], service_requests: [], policy_documents: [] };
}
function database(input, { ignoreFilters = false, assignmentMissing = false, flagsMissing = false, onRead } = {}) {
  const tables = structuredClone(input), calls = [];
  const admin = { from(table) {
    const call = { table, columns: "", filters: [] };
    const query = {
      select(columns) { call.columns = columns; return query; },
      eq(key, value) { call.filters.push(["eq", key, value]); return query; },
      neq(key, value) { call.filters.push(["neq", key, value]); return query; },
      in(key, value) { call.filters.push(["in", key, value]); return query; },
      is(key, value) { call.filters.push(["is", key, value]); return query; },
      not(key, op, value) { call.filters.push(["not", key, value]); return query; },
      limit() { return query; },
      insert() { throw new Error("Unexpected source resurrection/write"); },
      update() { throw new Error("Unexpected source mutation"); },
      delete() { throw new Error("Unexpected source deletion"); },
      maybeSingle: async () => execute(true),
      then(resolve, reject) { return Promise.resolve().then(() => execute(false)).then(resolve, reject); },
    };
    function execute(single) {
      calls.push(structuredClone(call));
      onRead?.(call, tables, calls);
      if (assignmentMissing && table === "project_activity_assignees") return { data: null, error: { code: "42P01", message: "project_activity_assignees does not exist" } };
      const flag = call.columns.match(/\b(?:budget|allocated)_hours_tbc\b/)?.[0];
      if (flagsMissing && flag) return { data: null, error: { code: "42703", message: `column ${flag} does not exist` } };
      let rows = tables[table] || [];
      if (!ignoreFilters) rows = rows.filter((row) => call.filters.every(([op, key, value]) => op === "eq" ? row[key] === value : op === "neq" ? row[key] !== value : op === "in" ? value.includes(row[key]) : op === "is" ? (row[key] ?? null) === value : op === "not" ? row[key] != null : true));
      rows = rows.map((row) => Object.fromEntries(Object.entries(row).filter(([key]) => call.columns.split(",").map((part) => part.trim()).includes(key))));
      return { data: structuredClone(single ? rows[0] || null : rows), error: null };
    }
    return query;
  } };
  return { admin, tables, calls };
}
function routes(db) {
  const access = { admin: db.admin, user: { id: uuid(100) }, isAdmin: true };
  const edits = [];
  const context = vm.createContext({ ...scheduling, ...hours, Response, Request, URL, Date, console,
    requireSession: async () => access, requirePortalResource: async () => null,
    serverError: (error) => Response.json({ error: error.message }, { status: 500 }),
    listDirectoryUsers: async () => directory, compactAuditRecord: (record) => record,
    recordAudit: async () => { throw new Error("Unexpected audit write"); },
    patchWorkActivity: async (request, params) => { edits.push({ params, body: await request.json() }); return Response.json({ activity: { id: params.params.activityId } }); },
  });
  vm.runInContext(routeSource.replace(/^import[^\n]*\n/gm, "").replace(/^export /gm, "") + "\nthis.handlers = { capacityData, POST };", context);
  return { access, edits, ...context.handlers };
}
async function capacity(tables, start = "2026-11-13", end = "2026-11-17", options = {}) {
  const db = database(tables, options), loaded = routes(db);
  const output = plain(await loaded.capacityData(loaded.access, start, end));
  assert.equal(output.ready, true);
  return { output, db, loaded, person: output.people.find((row) => row.id === staffId) };
}
const occurrences = (event, dates) => dates.filter((date) => eventFallsOnWorkDay(event, date));
const period = ["2026-11-13", "2026-11-14", "2026-11-15", "2026-11-16", "2026-11-17"];
const postRequest = (body) => new Request("https://example.test/api/admin/staff-capacity", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

await check("helper: Fri–Tue uses full-span weekday policy even in a weekend-only viewport", () => {
  assert.equal(calendarDayPolicy("2026-11-13", "2026-11-17"), "working_days");
  assert.equal(scheduledDaysInRange("2026-11-13", "2026-11-17", "2026-11-13", "2026-11-17"), 3);
  assert.equal(scheduledDaysInRange("2026-11-13", "2026-11-17", "2026-11-14", "2026-11-15"), 0);
  assert.deepEqual(occurrences({ type: "activity", startDate: period[0], endDate: period[4] }, period), [period[0], period[3], period[4]]);
});
await check("helper: weekend-only spans are blocked by default; only explicit manual opt-in schedules them", () => {
  for (const [start, end] of [["2026-11-14", "2026-11-14"], ["2026-11-15", "2026-11-15"], ["2026-11-14", "2026-11-15"], ["2026-10-10", "2026-10-11"]]) {
    assert.equal(calendarDayPolicy(start, end), "working_days");
    assert.equal(calendarDayPolicy(start, end, false), "working_days");
    assert.equal(scheduledDaysInRange(start, end, start, end), 0);
    assert.equal(eventFallsOnWorkDay({ type: "field_survey", start_date: start, end_date: end, dayPolicy: "calendar_days" }, start), false);
    assert.equal(calendarDayPolicy(start, end, true), "calendar_days");
    assert.equal(scheduledDaysInRange(start, end, start, end, true), start === end ? 1 : 2);
    assert(eventFallsOnWorkDay({ type: "task_brief", start_date: start, due_date: end }, start));
    assert.equal(eventFallsOnWorkDay({ type: "task_brief", start_date: start, due_date: end, dayPolicy: "working_days" }, start), false);
    assert.equal(eventFallsOnWorkDay({ type: "task_brief", start_date: start, due_date: end, day_policy: "working_days", dayPolicy: "calendar_days" }, start), false);
  }
  assert(eventFallsOnWorkDay({ type: "task_brief", date: "2026-11-14" }, "2026-11-14"));
  assert.equal(calendarDayPolicy("2026-11-14", "2026-11-15", "true"), "working_days");
  assert.equal(scheduledDaysInRange("2026-11-15", "2026-11-14", "2026-11-14", "2026-11-15", true), 2);
  assert.equal(scheduledDaysInRange("2026-11-17", "2026-11-13", period[0], period[4]), 3);
  assert.equal(scheduledDaysInRange("2026-02-30", "2026-03-01", period[0], period[4]), 0);
  assert.equal(calendarDayPolicy("2026-02-30", "2026-03-01", true), "working_days");
  assert.equal(calendarDayPolicy("bad", "2026-11-14", true), "working_days");
  assert.equal(scheduledDaysInRange("bad", "2026-11-14", period[1], period[2], true), 0);
  assert.equal(eventFallsOnWorkDay({ startDate: "bad" }, "2026-11-14"), false);
  assert.equal(eventFallsOnWorkDay({}, "bad"), false);
});
await check("helper: non-working-day detection accepts only real UTC date-only Saturday/Sunday", () => {
  for (const date of ["2026-11-14", "2026-11-15", "2026-10-10", "2026-10-11"]) assert.equal(isNonWorkingDay(date), true);
  for (const date of ["2026-11-13", "2026-11-16", "2026-02-30", "2026-13-01", "2026-11-31", "2026-11-14T00:00:00Z", "2026-11-14 extra", " 2026-11-14", "2026-11-14 ", "bad", "", null, undefined, new Date("2026-11-14T00:00:00Z")]) assert.equal(isNonWorkingDay(date), false);
});
await check("helper: broad monthly spans retain weekdays, not implicit Saturdays/Sundays", () => {
  const event = { type: "activity", startDate: "2026-11-01", endDate: "2026-11-30" };
  const dates = Array.from({ length: 30 }, (_, index) => `2026-11-${String(index + 1).padStart(2, "0")}`);
  const weekdays = dates.filter((date) => ![0, 6].includes(new Date(`${date}T00:00:00Z`).getUTCDay()));
  assert.equal(calendarDayPolicy(event.startDate, event.endDate), "working_days");
  assert.deepEqual(occurrences(event, dates), weekdays);
  assert.equal(scheduledDaysInRange(event.startDate, event.endDate, event.startDate, event.endDate), weekdays.length);
  for (const [start, end] of [[period[0], period[4]], [event.startDate, event.endDate], [period[1], "2026-11-22"]]) {
    assert.equal(calendarDayPolicy(start, end, true), "working_days", "A weekday anywhere in the full manual span prevents weekend booking.");
    assert.equal(scheduledDaysInRange(start, end, period[1], period[2], true), 0);
    assert.equal(eventFallsOnWorkDay({ type: "task_brief", startDate: start, endDate: end, dayPolicy: "calendar_days", manualWeekend: true }, period[1]), false);
  }
  assert.deepEqual(occurrences({ ...event, type: "task_brief", dayPolicy: "calendar_days" }, dates), weekdays);
});
await check("helper: every non-task type blocks weekends regardless of payload policy or manual flag", () => {
  for (const type of ["activity", "field_survey", "schedule", "milestone", "leave", "training", "deadline", "document_review", undefined]) {
    for (const policy of [undefined, "working_days", "calendar_days"]) {
      assert.equal(eventFallsOnWorkDay({ type, date: period[1], dayPolicy: policy, day_policy: "calendar_days", manualWeekend: true }, period[1]), false);
      assert.equal(eventFallsOnWorkDay({ type, date: period[3], dayPolicy: policy }, period[3]), true);
      assert.deepEqual(occurrences({ type, startDate: period[0], endDate: period[4], dayPolicy: policy }, period), [period[0], period[3], period[4]]);
    }
  }
});
await check("capacity: Nov13–17 effort and events reconcile exactly, excluding Nov14–15", async () => {
  const tables = fixture(); tables.project_schedule_items.push(schedule());
  tables.remote_tasks.push({ id: uuid(10), assigned_to: staffId, task: "Latest task brief", start_date: period[0], due_date: period[4], budget_hours: 15, status: "awaiting_response" });
  const { output, person, db } = await capacity(tables);
  assert.equal(person.allocatedHours, 45);
  assert.equal(person.activeProjectCount, 1);
  for (const event of output.calendarEvents) { assert.equal(event.dayPolicy, "working_days"); assert.deepEqual(occurrences(event, period), [period[0], period[3], period[4]]); }
  for (const date of period) {
    const daily = await capacity(tables, date, date);
    assert.equal(daily.person.allocatedHours, [period[1], period[2]].includes(date) ? 0 : 15);
  }
  const weekend = await capacity(tables, period[1], period[2]); assert.equal(weekend.person.allocatedHours, 0);
  assert.deepEqual(db.tables, tables, "Reading capacity must not alter sources.");
  assert.equal(person.availableHours, 0, "Keep existing minimum one-week capacity baseline, not a new weekday capacity model.");
  assert.equal(person.capacityPercent, Math.round(45 / 38 * 100));
});
await check("capacity: Saturday-only project items are blocked; manual task keeps its 2h booking, not old 10h", async () => {
  const tables = fixture(); tables.project_activities[0] = activity({ start_date: period[1], due_date: period[1], budget_hours: 8 }); tables.project_activity_assignees[0].allocated_hours = 8;
  tables.remote_tasks.push({ id: uuid(10), assigned_to: staffId, task: "Intentional Saturday task", start_date: period[1], due_date: period[1], budget_hours: 2 });
  tables.project_schedule_items.push(schedule({ start_date: period[1], end_date: period[1] }));
  const { output, person, db } = await capacity(tables, period[1], period[2]); assert.equal(person.allocatedHours, 2);
  assert.equal(output.calendarEvents.length, 3, "Keep dated source payloads for the non-working warning without booking weekend work.");
  for (const event of output.calendarEvents) {
    const manual = event.type === "task_brief";
    assert.equal(event.dayPolicy, manual ? "calendar_days" : "working_days");
    assert.deepEqual(occurrences(event, period), manual ? [period[1]] : []);
    assert.equal(event.manualWeekend, manual ? true : undefined);
    assert.equal(event.startDate, period[1]); assert.equal(event.endDate, period[1]);
  }
  assert.equal((await capacity(tables, period[1], period[1])).person.allocatedHours, 2);
  assert.equal((await capacity(tables, period[2], period[2])).person.allocatedHours, 0);
  assert.deepEqual(db.tables, tables, "Source dates and 8h project budget/allocation remain unchanged.");
});
await check("capacity: manual two-day weekend and Sunday-only hours reconcile without leaking into weekdays", async () => {
  const tables = fixture(); tables.project_activities = []; tables.project_activity_assignees = [];
  tables.remote_tasks.push({ id: uuid(10), assigned_to: staffId, task: "Manual weekend task", start_date: period[1], due_date: period[2], budget_hours: 2 });
  for (const [start, end, hours] of [[period[1], period[2], 2], [period[1], period[1], 1], [period[2], period[2], 1], [period[3], period[4], 0]]) {
    const { output, person, db } = await capacity(tables, start, end); assert.equal(person.allocatedHours, hours);
    for (const event of output.calendarEvents) { assert.equal(event.dayPolicy, "calendar_days"); assert.equal(event.manualWeekend, true); assert.deepEqual(occurrences(event, period), [period[1], period[2]]); }
    assert.deepEqual(db.tables, tables);
  }
  tables.remote_tasks[0].start_date = period[2];
  const sunday = await capacity(tables, period[1], period[2]); assert.equal(sunday.person.allocatedHours, 2);
  assert.deepEqual(occurrences(sunday.output.calendarEvents[0], period), [period[2]]);
});
await check("capacity: historical October weekend records remain intact, not booked as calendar work", async () => {
  const tables = fixture(); tables.project_activities[0] = activity({ start_date: "2026-10-10", due_date: "2026-10-11" });
  tables.policy_documents.push({ id: uuid(11), title: "Saved policy", next_review_date: "2026-10-10", review_assigned_to: staffId, review_completed_at: null });
  tables.project_tracker_entries = [{ id: uuid(12), project_id: projectId, activity_id: activityId, staff_user_id: staffId, work_date: "2026-10-10", hours: 8, historic_rate: 107 }];
  tables.project_activity_history = [{ id: uuid(13), activity_id: activityId, note: "Original October weekend actuals" }];
  tables.project_budget_allocations = [{ id: uuid(14), project_id: projectId, hours_consumed: 8, charge_out_spend: 856 }];
  const { output, person, db } = await capacity(tables, "2026-10-10", "2026-10-11"); assert.equal(person.allocatedHours, 0);
  assert.equal(output.calendarEvents.length, 2);
  const review = output.calendarEvents.find((event) => event.type === "document_review"); assert(review); assert.equal(review.startDate, "2026-10-10");
  assert.equal(output.calendarEvents.find((event) => event.type === "field_survey").dayPolicy, "working_days");
  for (const event of output.calendarEvents) assert.deepEqual(occurrences(event, ["2026-10-10", "2026-10-11"]), []);
  assert.deepEqual(db.tables, tables, "Do not edit saved source dates, hours, budgets, historical actuals, or history.");
});
await check("capacity: generated schedule and reciprocal-only schedule each appear once", async () => {
  for (const generated of [activityId, null]) {
    const tables = fixture(); tables.project_activities[0].schedule_item_id = scheduleId; tables.project_schedule_items.push(schedule({ generated_from_activity_id: generated }));
    const { output, person } = await capacity(tables);
    assert.deepEqual(output.calendarEvents.map((event) => event.id), [`activity-${activityId}`]); assert.equal(person.allocatedHours, 30);
  }
});
await check("capacity: retired/missing generated origins and retired reciprocal origins do not resurrect schedules", async () => {
  for (const variant of ["retired_generated", "missing_generated", "retired_reciprocal"]) {
    const tables = fixture(); tables.project_activities[0].schedule_item_id = scheduleId;
    tables.project_schedule_items.push(schedule({ generated_from_activity_id: variant === "retired_reciprocal" ? null : activityId }));
    if (variant === "missing_generated") tables.project_activities = []; else tables.project_activities[0].is_active = false;
    const { output, person } = await capacity(tables); assert.equal(output.calendarEvents.length, 0, variant); assert.equal(person.allocatedHours, 0);
  }
});
await check("capacity: missing, archived, and soft-deleted projects reject activities AND schedules in memory", async () => {
  for (const variant of ["missing", "archived", "deleted"]) {
    const tables = fixture(); tables.project_schedule_items.push(schedule());
    if (variant === "missing") tables.projects = []; else if (variant === "archived") tables.projects[0].status = "archived"; else tables.projects[0].deleted_at = "2026-11-13T01:00:00Z";
    const { output, person } = await capacity(tables, period[0], period[4], { ignoreFilters: true });
    assert.equal(output.calendarEvents.length, 0, variant); assert.equal(person.allocatedHours, 0); assert.equal(person.activeProjectCount, 0);
  }
});
await check("capacity: inactive activity/schedule flags are honored even if query filters are ignored", async () => {
  const tables = fixture(); tables.project_activities[0].is_active = false; tables.project_schedule_items.push(schedule({ is_active: false }));
  const { output, person } = await capacity(tables, period[0], period[4], { ignoreFilters: true }); assert.equal(output.calendarEvents.length, 0); assert.equal(person.allocatedHours, 0);
});
await check("capacity: removed/declined/tombstoned assignments never leak legacy scalar staff", async () => {
  for (const extra of [{ acceptance_status: "removed" }, { acceptance_status: "declined" }, { acceptance_status: "accepted", removed_at: "2026-11-13T01:00:00Z" }]) {
    const tables = fixture(); tables.project_activity_assignees[0] = assignment(extra);
    const { output, person } = await capacity(tables, period[0], period[4], { ignoreFilters: true });
    assert.equal(person.allocatedHours, 0); assert.equal(output.calendarEvents.length, 1); assert.equal(output.calendarEvents[0].staffUserId, null); assert.equal(output.calendarEvents[0].budgetHours, 0);
  }
  const tables = fixture(); tables.project_activity_assignees = [];
  const { output, person } = await capacity(tables); assert.equal(person.allocatedHours, 0); assert.equal(output.calendarEvents[0].staffUserId, null);
});
await check("capacity: active shared allocations and latest saved edits retained; sources never replaced", async () => {
  const tables = fixture(); tables.project_activities[0].schedule_item_id = scheduleId;
  tables.project_schedule_items.push(schedule({ title: "Different saved schedule label", generated_from_activity_id: null }));
  tables.project_activity_assignees[0].allocated_hours = 18; tables.project_activity_assignees.push(assignment({ staff_user_id: otherId, allocated_hours: 12, acceptance_status: "actioned" }));
  tables.project_activities.push(activity({ id: uuid(12), staff_user_id: null, title: "New retained unassigned Broula item", start_date: "2026-11-16", due_date: "2026-11-17", budget_hours: 6, detail: "User-authored details" }));
  const { output, db, person } = await capacity(tables); assert.equal(person.allocatedHours, 18); assert.equal(output.people.find((row) => row.id === otherId).allocatedHours, 12);
  assert.equal(output.calendarEvents.length, 3); const event = output.calendarEvents.find((row) => row.id === `activity-${uuid(12)}`);
  assert.equal(event.title, "New retained unassigned Broula item"); assert.equal(event.detail, "User-authored details"); assert.equal(event.staffUserId, null); assert.equal(event.activityBudgetHours, 6);
  for (const row of output.calendarEvents.filter((entry) => entry.id === `activity-${activityId}`)) { assert.equal(row.title, tables.project_activities[0].title); assert.equal(row.startDate, period[0]); assert.equal(row.endDate, period[4]); }
  assert.deepEqual(db.tables, tables);
});
await check("capacity: consecutive reads reconcile current edits, retirement, replacement, and manual rows", async () => {
  const db = database(fixture()), loaded = routes(db);
  const current = async () => plain(await loaded.capacityData(loaded.access, period[0], period[4]));
  let output = await current(); assert.equal(output.people[0].allocatedHours, 30);
  Object.assign(db.tables.project_activities[0], { title: "Broula latest saved title", detail: "Manually edited detail", start_date: period[3], due_date: period[4], budget_hours: 12, updated_at: "2026-11-13T02:00:00Z" });
  db.tables.project_activity_assignees[0].allocated_hours = 12;
  output = await current(); assert.equal(output.people[0].allocatedHours, 12); assert.equal(output.calendarEvents[0].title, "Broula latest saved title"); assert.equal(output.calendarEvents[0].startDate, period[3]); assert.equal(output.calendarEvents[0].detail, "Manually edited detail");
  db.tables.project_activities[0].is_active = false;
  db.tables.project_activities.push(activity({ id: uuid(40), title: "Newly saved replacement", budget_hours: 9 }));
  db.tables.project_activity_assignees.push(assignment({ activity_id: uuid(40), allocated_hours: 9 }));
  db.tables.project_schedule_items.push(schedule({ id: uuid(41), title: "Retained manual schedule" }), schedule({ id: uuid(42), title: "Deleted manual schedule", is_active: false }));
  output = await current(); assert.equal(output.people[0].allocatedHours, 9);
  assert.deepEqual(output.calendarEvents.map((event) => event.title).sort(), ["Newly saved replacement", "Retained manual schedule"].sort());
  db.tables.project_activity_assignees.find((row) => row.activity_id === uuid(40)).acceptance_status = "removed";
  output = await current(); assert.equal(output.people[0].allocatedHours, 0); assert.equal(output.calendarEvents.find((row) => row.id === `activity-${uuid(40)}`).staffUserId, null);
});
await check("capacity: dated/undated TBC retained without invented effort; implicit weekend is not unknown allocation", async () => {
  const tables = fixture(); tables.project_activities[0].budget_hours_tbc = true; tables.project_activity_assignees[0].allocated_hours_tbc = true; tables.project_activity_assignees[0].allocated_hours = 500;
  tables.remote_tasks.push({ id: uuid(13), assigned_to: staffId, task: "TBC brief", start_date: period[0], due_date: period[4], budget_hours: null });
  const { output, person } = await capacity(tables); assert.equal(person.allocatedHours, 0); assert.equal(person.unknownAllocationCount, 2); assert.equal(person.capacityIncomplete, true);
  for (const event of output.calendarEvents) { assert.equal(event.budgetHours, null); assert.equal(event.hoursTbc, true); }
  const weekend = await capacity(tables, period[1], period[2]); assert.equal(weekend.person.unknownAllocationCount, 0);
  tables.project_activities[0].start_date = null; tables.project_activities[0].due_date = null;
  const undated = await capacity(tables); assert.equal(undated.person.unknownAllocationCount, 2); assert.equal(undated.output.calendarEvents.length, 1);
});
await check("capacity: manual Saturday TBC counts unknown, project Saturday TBC does not; known weekday hours survive", async () => {
  const tables = fixture();
  tables.project_activities.push(activity({ id: uuid(30), start_date: period[1], due_date: period[1], budget_hours: 500, budget_hours_tbc: true }));
  tables.project_activity_assignees.push(assignment({ activity_id: uuid(30), allocated_hours: 500, allocated_hours_tbc: true }));
  tables.remote_tasks.push({ id: uuid(31), assigned_to: staffId, task: "Manual Saturday TBC", start_date: period[1], due_date: period[1], budget_hours: null });
  tables.remote_tasks.push({ id: uuid(32), assigned_to: staffId, task: "Known weekday brief", start_date: period[0], due_date: period[4], budget_hours: 15 });
  const full = await capacity(tables); assert.equal(full.person.allocatedHours, 45); assert.equal(full.person.unknownAllocationCount, 1); assert.equal(full.person.capacityIncomplete, true);
  const manual = full.output.calendarEvents.find((event) => event.id === `task-${uuid(31)}`); assert.equal(manual.dayPolicy, "calendar_days"); assert.equal(manual.manualWeekend, true); assert.equal(manual.budgetHours, null); assert.equal(manual.hoursTbc, true);
  const weekend = await capacity(tables, period[1], period[2]); assert.equal(weekend.person.allocatedHours, 0); assert.equal(weekend.person.unknownAllocationCount, 1);
  const weekday = await capacity(tables, period[3], period[3]); assert.equal(weekday.person.allocatedHours, 15); assert.equal(weekday.person.unknownAllocationCount, 0); assert.equal(weekday.person.capacityIncomplete, false);
  const sunday = await capacity(tables, period[2], period[2]); assert.equal(sunday.person.unknownAllocationCount, 0);
  assert.deepEqual(full.db.tables, tables);
});
await check("capacity: confirmed zero and all-inactive sources retain empty effort/event reconciliation", async () => {
  const tables = fixture(); tables.project_activities[0].budget_hours = 0; tables.project_activity_assignees[0].allocated_hours = 0;
  tables.remote_tasks.push({ id: uuid(33), assigned_to: staffId, task: "Manual zero-hour Saturday", start_date: period[1], due_date: period[1], budget_hours: 0 });
  const zero = await capacity(tables); assert.equal(zero.person.allocatedHours, 0); assert.equal(zero.person.unknownAllocationCount, 0); assert.equal(zero.person.capacityIncomplete, false);
  for (const event of zero.output.calendarEvents) { assert.equal(event.budgetHours, 0); assert.equal(event.hoursTbc, false); }
  tables.project_activities[0].is_active = false; tables.project_activity_assignees[0].acceptance_status = "removed";
  tables.remote_tasks[0].status = "inactive"; tables.project_schedule_items.push(schedule({ is_active: false }));
  const inactive = await capacity(tables, period[0], period[4], { ignoreFilters: true }); assert.equal(inactive.output.calendarEvents.length, 0); assert.equal(inactive.person.allocatedHours, 0); assert.equal(inactive.person.unknownAllocationCount, 0);
  assert.deepEqual(inactive.db.tables, tables);
});
await check("capacity: fallback only when assignment table unavailable; declined scalar remains unassigned", async () => {
  const tables = fixture(); let result = await capacity(tables, period[0], period[4], { assignmentMissing: true }); assert.equal(result.person.allocatedHours, 30);
  tables.project_activities[0].acceptance_status = "declined"; result = await capacity(tables, period[0], period[4], { assignmentMissing: true }); assert.equal(result.person.allocatedHours, 0); assert.equal(result.output.calendarEvents[0].staffUserId, null);
  tables.project_activity_assignees = []; result = await capacity(tables, period[0], period[4], { flagsMissing: true }); assert.equal(result.person.allocatedHours, 0); assert.equal(result.output.calendarEvents[0].staffUserId, null);
});
await check("capacity: removed task briefs excluded in memory and leave weekday effort remains unchanged", async () => {
  const tables = fixture(); tables.remote_tasks.push({ id: uuid(20), assigned_to: staffId, task: "Removed brief", start_date: period[0], due_date: period[4], budget_hours: 100, withdrawn_at: "2026-11-13T01:00:00Z" });
  tables.service_requests.push({ id: uuid(21), created_by: staffId, request_type: "leave", status: "approved", title: "Approved leave", details: { start_date: period[0], end_date: period[4] } });
  const normal = await capacity(tables); assert.equal(normal.person.leaveDays, 3); assert.equal(normal.person.leaveHours, 22.8); assert.equal(normal.person.allocatedHours, 30);
  const ignored = await capacity(tables, period[0], period[4], { ignoreFilters: true }); assert(!ignored.output.calendarEvents.some((event) => event.type === "task_brief")); assert.equal(ignored.person.allocatedHours, 30);
});
await check("capacity: later reciprocal read observes async retirement and rejects earlier active snapshot", async () => {
  const tables = fixture(); tables.project_activities[0].schedule_item_id = scheduleId; tables.project_schedule_items.push(schedule());
  const { output, person } = await capacity(tables, period[0], period[4], { onRead(call, current) {
    if (call.table === "project_activities" && call.filters.some(([op, key]) => op === "in" && key === "schedule_item_id")) { current.project_activities[0].is_active = false; current.project_activities[0].updated_at = "2026-11-13T01:00:00Z"; }
  } });
  assert.equal(output.calendarEvents.length, 0); assert.equal(person.allocatedHours, 0);
});
await check("allocation action: stale generated or retired reciprocal source returns conflict before any write", async () => {
  for (const variant of ["missing_generated", "retired_generated", "retired_reciprocal"]) {
    const tables = fixture(); tables.project_activities[0].schedule_item_id = scheduleId; tables.project_activities[0].is_active = false;
    if (variant === "missing_generated") tables.project_activities = [];
    tables.project_schedule_items.push(schedule({ generated_from_activity_id: variant === "retired_reciprocal" ? null : activityId }));
    const db = database(tables), loaded = routes(db);
    const response = await loaded.POST(postRequest({ action: "assign_schedule_item", scheduleItemId: scheduleId, staffUserId: staffId }));
    assert.equal(response.status, 409, `${variant}: ${JSON.stringify(await response.json())}`); assert.equal(loaded.edits.length, 0); assert.deepEqual(db.tables, tables);
  }
});
await check("allocation action: a reciprocal-only live source reuses its ID rather than materialising a duplicate", async () => {
  const tables = fixture(); tables.project_activities[0].schedule_item_id = scheduleId; tables.project_schedule_items.push(schedule());
  const db = database(tables), loaded = routes(db);
  const response = await loaded.POST(postRequest({ action: "assign_schedule_item", scheduleItemId: scheduleId, staffUserId: otherId, title: "Latest administrator title", startDate: "2026-11-16", dueDate: "2026-11-17" }));
  assert.equal(response.status, 200, JSON.stringify(await response.json())); assert.equal(loaded.edits.length, 1); assert.equal(loaded.edits[0].params.params.activityId, activityId); assert.equal(loaded.edits[0].body.title, "Latest administrator title"); assert.deepEqual(db.tables, tables);
});
console.log(`Staff calendar reconciliation behavioral regressions passed: ${checks}/${checks} groups, offline actual-route mocks; no live mutations.`);
