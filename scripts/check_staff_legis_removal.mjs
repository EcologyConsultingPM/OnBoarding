#!/usr/bin/env node
// Run from any directory: node /home/ubuntu/repo-review-onboarding/scripts/check_staff_legis_removal.mjs
// Repository-root equivalent: node scripts/check_staff_legis_removal.mjs
// Native Node only. Executes the current GET route bodies with mocked auth and
// an in-memory, recorded query builder. No application imports, DB/network or Git.
// UI, generation and cron checks are source contracts, not browser/live tests.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const root = new URL("../", import.meta.url);
const read = (file) => readFile(new URL(file, root), "utf8");
const [legisSource, eventsSource, staffUI, adminUI, briefUI, jobSource, cronSource] = await Promise.all([
  "app/api/legis/route.js", "app/api/portal-events/route.js",
  "components/StaffNotifications.js", "components/AdminRegulatoryWatch.js",
  "components/Legis.js", "app/api/jobs/legis-brief/route.js", "vercel.json",
].map(read));

class MockContractError extends Error {}
function splitTopLevel(text) {
  const parts = [];
  let depth = 0, start = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "(") depth++;
    if (text[i] === ")") depth--;
    if (text[i] === "," && depth === 0) { parts.push(text.slice(start, i)); start = i + 1; }
    if (depth < 0) throw new MockContractError(`Unbalanced filter: ${text}`);
  }
  if (depth !== 0) throw new MockContractError(`Unbalanced filter: ${text}`);
  parts.push(text.slice(start));
  return parts;
}
// Deliberately small PostgREST evaluator. Nested AND/OR and known atoms only;
// neq excludes SQL NULL, so explicit null alternatives must really be present.
function evaluateFilter(expression, row) {
  const group = /^(and|or)\((.*)\)$/.exec(expression);
  if (group) {
    const results = splitTopLevel(group[2]).map((part) => evaluateFilter(part, row));
    return group[1] === "and" ? results.every(Boolean) : results.some(Boolean);
  }
  const atom = /^(\w+)\.(is|eq|neq|lte)\.(.+)$/.exec(expression);
  if (!atom) throw new MockContractError(`Unsupported PostgREST expression: ${expression}`);
  const [, field, operator, value] = atom;
  const actual = row[field] ?? null;
  if (operator === "is") {
    if (value !== "null") throw new MockContractError(`Unsupported is value: ${value}`);
    return actual === null;
  }
  if (operator === "eq") return actual !== null && String(actual) === value;
  if (operator === "neq") return actual !== null && String(actual) !== value;
  return actual !== null && String(actual) <= value;
}
function mockDB(tables) {
  const records = [];
  return {
    records,
    from(table) {
      if (!(table in tables)) throw new MockContractError(`Unexpected table: ${table}`);
      const calls = [];
      const record = { table, calls };
      records.push(record);
      let single = false;
      const q = {};
      for (const method of ["select", "eq", "is", "or", "order", "limit", "in", "neq"]) {
        q[method] = (...args) => { calls.push({ method, args }); return q; };
      }
      q.maybeSingle = () => { single = true; calls.push({ method: "maybeSingle", args: [] }); return q; };
      q.then = (resolve, reject) => {
        try {
          let rows = tables[table].map((row) => ({ ...row }));
          // Execute filters at their recorded positions: a limit-before-filter
          // bug loses real rows instead of receiving pre-filtered mock data.
          for (const { method, args: [field, value] } of calls) {
            if (method === "eq") rows = rows.filter((row) => row[field] === value);
            if (method === "neq") rows = rows.filter((row) => row[field] != null && row[field] !== value);
            if (method === "is") rows = rows.filter((row) => (row[field] ?? null) === value);
            if (method === "in") rows = rows.filter((row) => value.includes(row[field]));
            if (method === "or") rows = rows.filter((row) => splitTopLevel(field).some((part) => evaluateFilter(part, row)));
            if (method === "order") rows.sort((a, b) => String(a[field]).localeCompare(String(b[field])) * (value.ascending ? 1 : -1));
            if (method === "limit") rows = rows.slice(0, field);
          }
          return Promise.resolve({ data: single ? rows[0] || null : rows, error: null }).then(resolve, reject);
        } catch (error) { return Promise.reject(error).then(resolve, reject); }
      };
      return q;
    },
  };
}
function loadGET(source, state) {
  const unexpectedErrors = [];
  const imports = [...source.matchAll(/^import[^;]+;\s*$/gm)].map((match) => match[0]);
  if (imports.length !== 2 || imports.some((line) => !/lib\/(serverAuth|portalVisibility)/.test(line))) {
    throw new MockContractError("Route imports changed; review isolated VM mock bindings.");
  }
  const code = source.replace(/^import[^;]+;\s*$/gm, "").replace(/\bexport\s+/g, "");
  const context = vm.createContext({
    Response, Request, URL, Date, console,
    requireSession: async () => state.access,
    requirePortalResource: async (access, resource) => {
      state.permissions.push({ access, resource, dbCalls: state.db.records.length });
      return state.denied ? Response.json({ error: "Resource denied" }, { status: 403 }) : null;
    },
    serverError: (error) => { unexpectedErrors.push(error); return Response.json({ error: String(error.message) }, { status: 500 }); },
  });
  vm.runInContext(`${code}\nglobalThis.__GET = GET;`, context);
  return async (request) => {
    const response = await context.__GET(request);
    if (unexpectedErrors.length) throw unexpectedErrors.shift();
    return response;
  };
}
const request = (path) => new Request(`https://fixture.invalid${path}`);
const userId = "signed-in-user";
function setup(source, tables, { admin = false, denied = false, unauthenticated = false } = {}) {
  const db = mockDB(tables);
  const state = { db, permissions: [], denied, access: unauthenticated
    ? { error: Response.json({ error: "Unauthenticated" }, { status: 401 }) }
    : { user: { id: userId }, isAdmin: admin, admin: db } };
  return { ...state, state, get: loadGET(source, state) };
}
let passed = 0, failed = 0;
async function test(label, fn) {
  try { await fn(); passed++; console.log(`PASS ${label}`); }
  catch (error) {
    failed++;
    console.error(`FAIL [${error instanceof MockContractError ? "MOCK CONTRACT: review harness" : "BEHAVIOR/SOURCE: review route or assertion"}] ${label}\n${error.stack}`);
  }
}
const legacy = {
  id: "latest", week_of: "2026-11-09", status: "ready", summary: "Saved full report",
  watchlist: ["Legacy reform", { issue: "Structured reform", likelihood: "High" }, null, 17],
  developments: null, actions_this_week: "old", status_matrix: {}, department_summaries: [],
};
const briefs = [
  { id: "failed-newest", week_of: "2026-11-16", status: "failed" },
  legacy, { id: "older", week_of: "2026-11-02", status: "ready", watchlist: ["Earlier reform"] },
];
for (const history of [false, true]) {
  const path = `/api/legis${history ? "?history=true" : ""}`;
  await test(`Legis ${history ? "history" : "latest"}: unauthenticated 401 before DB`, async () => {
    const h = setup(legisSource, { monday_briefs: briefs }, { unauthenticated: true });
    assert.equal((await h.get(request(path))).status, 401);
    assert.equal(h.db.records.length, 0); assert.equal(h.permissions.length, 0);
  });
  await test(`Legis ${history ? "history" : "latest"}: ordinary staff 403 before resource/DB`, async () => {
    const h = setup(legisSource, { monday_briefs: briefs });
    assert.equal((await h.get(request(path))).status, 403);
    assert.equal(h.db.records.length, 0); assert.equal(h.permissions.length, 0);
  });
  await test(`Legis ${history ? "history" : "latest"}: locked admin resource 403 before DB`, async () => {
    const h = setup(legisSource, { monday_briefs: briefs }, { admin: true, denied: true });
    assert.equal((await h.get(request(path))).status, 403);
    assert.deepEqual(h.permissions.map((p) => [p.resource, p.dbCalls]), [["admin.regulatory_watch", 0]]);
    assert.equal(h.permissions[0].access, h.state.access); assert.equal(h.db.records.length, 0);
  });
  await test(`Legis ${history ? "history" : "latest"}: admin saved reports and legacy normalization`, async () => {
    const h = setup(legisSource, { monday_briefs: briefs }, { admin: true });
    const response = await h.get(request(path)); assert.equal(response.status, 200);
    const payload = await response.json();
    const result = history ? payload.briefs[0] : payload.brief;
    assert.equal(result.id, "latest"); assert.equal(result.summary, legacy.summary);
    assert.deepEqual(result.watchlist.map((w) => w.issue), ["Legacy reform", "Structured reform"]);
    assert.equal(result.watchlist[0].likelihood, "Monitor");
    assert.equal(typeof result.watchlist[0].potential_impact, "string");
    for (const field of ["developments", "actions_this_week", "status_matrix", "no_material_change_categories"]) assert.deepEqual(result[field], []);
    assert.deepEqual(result.department_summaries, {});
    if (history) { assert.deepEqual(payload.briefs.map((b) => b.id), ["latest", "older"]); assert.equal(payload.briefs[1].watchlist[0].issue, "Earlier reform"); }
    assert.deepEqual(h.permissions.map((p) => [p.resource, p.dbCalls]), [["admin.regulatory_watch", 0]]);
    const calls = h.db.records[0].calls;
    assert.equal(h.db.records[0].table, "monday_briefs");
    assert.deepEqual(calls.find((c) => c.method === "eq").args, ["status", "ready"]);
    assert.equal(calls.find((c) => c.method === "limit").args[0], history ? 12 : 1);
    assert.ok(calls.find((c) => c.method === "select").args[0].includes("watchlist"));
  });
}
const now = Date.now();
const event = (id, overrides = {}) => ({
  id, recipient_id: userId, event_type: "governance_update", source_table: null, source_id: null,
  title: id, created_at: new Date(now - 100000).toISOString(), read_at: null,
  dismissed_at: null, deferred_until: null, ...overrides,
});
const notifications = [
  ...Array.from({ length: 35 }, (_, i) => event(`old-legis-${i}`, { event_type: "legis_brief_ready", created_at: new Date(now - i).toISOString() })),
  event("source-only", { source_table: "monday_briefs", event_type: "some_legacy_type", created_at: new Date(now - 40).toISOString() }),
  event("null-type-legis-source", { event_type: null, source_table: "monday_briefs" }),
  event("null-source-generic"), event("both-null", { event_type: null }),
  event("task", { event_type: "remote_task_assigned", source_table: "remote_tasks" }),
  event("assignment", { event_type: "project_activity_assigned", source_table: "project_activities" }),
  event("review", { event_type: "review_requested", source_table: "review_requests", read_at: new Date(now - 5000).toISOString() }),
  event("service", { event_type: "service_request_approved", source_table: "service_requests" }),
  event("due-deferred", { deferred_until: new Date(now - 60000).toISOString() }),
  event("future-deferred", { deferred_until: new Date(now + 86400000).toISOString() }),
  event("dismissed", { dismissed_at: new Date(now).toISOString() }),
  event("other-recipient", { recipient_id: "someone-else" }),
];
const visibleIds = ["null-source-generic", "both-null", "task", "assignment", "review", "service", "due-deferred"];
for (const admin of [false, true]) {
  await test(`Staff inbox (${admin ? "admin caller" : "staff caller"}): own recipient, compound filter before limit, unrelated/null notifications retained`, async () => {
    const h = setup(eventsSource, { portal_events: notifications }, { admin });
    const response = await h.get(request("/api/portal-events?limit=30")); assert.equal(response.status, 200);
    const payload = await response.json();
    assert.deepEqual(payload.events.map((e) => e.id).sort(), [...visibleIds].sort());
    assert.equal(payload.unread_count, visibleIds.length - 1);
    assert.equal(h.db.records.length, 1);
    const calls = h.db.records[0].calls;
    const ors = calls.filter((c) => c.method === "or");
    assert.equal(ors.length, 1, "PostgREST or key must not be overwritten by a second .or()");
    assert.deepEqual(calls.filter((c) => c.method === "eq").map((c) => c.args), [["recipient_id", userId]]);
    assert.deepEqual(calls.find((c) => c.method === "is").args, ["dismissed_at", null]);
    assert.ok(calls.findIndex((c) => c.method === "or") < calls.findIndex((c) => c.method === "limit"));
    assert.ok(calls.findIndex((c) => c.method === "eq") < calls.findIndex((c) => c.method === "limit"));
    assert.deepEqual(h.permissions.map((p) => p.resource), ["staff.notifications"]);
    const filter = ors[0].args[0];
    for (const atom of ["deferred_until.is.null", "deferred_until.lte.", "event_type.is.null", "event_type.neq.legis_brief_ready", "source_table.is.null", "source_table.neq.monday_briefs"]) assert.ok(filter.includes(atom), `Missing ${atom}`);
    const cutoff = /deferred_until\.lte\.([^,)]+)/.exec(filter)[1];
    assert.ok(Number.isFinite(Date.parse(cutoff)));
    assert.equal(evaluateFilter(filter, event("exact-due", { deferred_until: cutoff })), true);
    assert.equal(evaluateFilter(filter, event("future", { deferred_until: new Date(Date.parse(cutoff) + 1).toISOString() })), false);
  });
}
await test("Staff inbox filtering preserves a full small page despite newer Legis rows", async () => {
  const h = setup(eventsSource, { portal_events: notifications });
  const response = await h.get(request("/api/portal-events?limit=2"));
  assert.equal(response.status, 200);
  const data = await response.json(); assert.equal(data.events.length, 2);
  assert.ok(data.events.every((row) => visibleIds.includes(row.id)));
  assert.equal(h.db.records[0].calls.find((c) => c.method === "limit").args[0], 2);
});
await test("SOURCE ONLY: staff Legis panel/import/icon absent; ordinary workspace panels retained", async () => {
  assert.doesNotMatch(staffUI, /import[^;]*\bLegis\b|<Legis\b|\bScale\b|sn-legis|Legis briefing/i);
  assert.match(staffUI, /EXCLUDED_EVENT_TYPES\s*=\s*\[[^\]]*["']legis_brief_ready["']/);
  assert.match(staffUI, /<StaffPortalEvents\b[^>]*excludeTypes=\{EXCLUDED_EVENT_TYPES\}/);
  for (const component of ["RemoteTasks", "StaffPortalTaskCalendar", "StaffPortalEvents"]) assert.match(staffUI, new RegExp(`<${component}\\b`));
  assert.match(staffUI, /isAdmin=\{false\}/);
});
await test("SOURCE ONLY: admin Regulatory Watch and saved latest/history UI remain wired", async () => {
  assert.match(adminUI, /import Legis from ["']\.\/Legis["']/); assert.match(adminUI, /<Legis\s*\/>/);
  assert.match(adminUI, /Legis regulatory watchlist/);
  assert.match(briefUI, /fetch\(["']\/api\/legis["']/);
  assert.match(briefUI, /fetch\(["']\/api\/legis\?history=true["']/);
  assert.match(briefUI, /\/api\/admin\/legis\/generate/);
});
await test("SOURCE ONLY: no automatic staff broadcast; saved report generation, result and Regulatory Watch feed retained", async () => {
  assert.doesNotMatch(jobSource, /\bnotifyAllStaff\b|\.from\(["']portal_events["']\)|legis_brief_ready/);
  assert.match(jobSource, /async function feedRegulatoryWatch\(/);
  assert.match(jobSource, /await feedRegulatoryWatch\(admin, briefRow\.id, weekOf, result\.developments\)/);
  assert.match(jobSource, /\.from\(["']regulatory_updates["']\)\.insert\(updateRows\)/);
  assert.match(jobSource, /\.from\(["']compliance_register_items["']\)\.insert\(registerRows\)/);
  assert.match(jobSource, /existing\?\.status === ["']ready["']/);
  assert.match(jobSource, /await generateBrief\(weekOf, previousBrief\?\.watchlist, projectRoster\)/);
  assert.match(jobSource, /\.from\(["']monday_briefs["']\)\.upsert/);
  for (const field of ["summary", "developments", "actions_this_week", "watchlist", "status_matrix", "department_summaries"]) assert.match(jobSource, new RegExp(`${field}: result\\.`));
  assert.match(jobSource, /return \{ ok: true, brief_id: briefRow\.id, developments_found:.*immediate_procedure_change: urgentCount, self_audit_passed:/);
  assert.match(jobSource, /Response\.json\(await runLegisBrief\(\)\)/);
});
await test("SOURCE ONLY: weekly Legis cron cadence remains Sunday 22:00 UTC", async () => {
  const cron = JSON.parse(cronSource).crons.filter((c) => c.path === "/api/jobs/legis-brief");
  assert.deepEqual(cron, [{ path: "/api/jobs/legis-brief", schedule: "0 22 * * 0" }]);
});
console.log(`\nStaff Legis removal: ${passed} passed, ${failed} failed.`);
console.log("Scope: real GET bodies with recorded in-memory query fixtures; source-only UI/job/cron contracts. No live auth, Supabase/PostgREST, browser, model generation, DB migrations or deployed cron tested. Retained wiring is checked, not historical byte-for-byte identity.");
if (failed) process.exitCode = 1;
