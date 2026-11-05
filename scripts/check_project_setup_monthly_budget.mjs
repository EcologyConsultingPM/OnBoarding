import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const root = new URL("..", import.meta.url);
const read = (file) => readFile(new URL(file, root), "utf8");
const source = await read("app/api/projects/[projectId]/route.js");
const ui = await read("components/AdminProjectSetup.js");
const withoutImports = (text) => text.replace(/^import[^\n]*\n/gm, "");
const periods = await import(`data:text/javascript;base64,${Buffer.from(await read("lib/projectBudgetPeriods.js")).toString("base64")}`);
const helpersContext = { ...periods, Date };
vm.createContext(helpersContext);
vm.runInContext(withoutImports(await read("lib/projectSetupBudgetBasis.js")).replace(/export /g, "") + "\nthis.helpers = { monthlyBudgetBaselineForSources, monthlyBudgetInputError, validMonthlyBudgetAmount };", helpersContext);
const helpers = helpersContext.helpers;
const plain = (value) => JSON.parse(JSON.stringify(value));
const projectId = "11111111-1111-4111-8111-111111111111";
const actorId = "11111111-1111-4111-8111-111111111112";
const months = Array.from({ length: 4 }, (_, i) => ({
  approved_value: 2548.50, approved_hours: 18,
  ...periods.monthBudgetPeriod(`2026-${String(i + 9).padStart(2, "0")}`),
}));
const explicit = { budgetBasis: "monthly", monthlyBudgetValue: "2500", monthlyBudgetHours: "30" };
const project = { id: projectId, name: "Monthly project", status: "active", budget_dollars: 10194, budget_hours: 72, client_name: "Client", description: "Notes", scope_of_works: "Scope", project_lead_user_id: actorId };

// Execute the real route functions, not a copy of their business logic. All
// database calls are isolated doubles; this script never connects to Supabase.
async function run({ method = "PATCH", sources = months, budgetError = null, rpcError = null, rpcData, isAdmin = true, audience = "", projectFound = true, assigned = true, body = { budgetDollars: 2548.50, budgetHours: 30, name: "Monthly project" } } = {}) {
  const writes = [], queries = [], rpcCalls = [], events = [];
  let current = { ...project };
  const admin = {
    auth: { admin: { listUsers: async () => ({ data: { users: [] } }) } },
    async rpc(name, args) {
      rpcCalls.push({ name, args: plain(args) }); events.push("rpc");
      if (rpcError) return { data: null, error: rpcError };
      if (rpcData !== undefined) return { data: rpcData, error: null };
      const eligible = sources.filter((row) => Boolean(periods.serviceMonthForSource(row)));
      const changed = eligible.some((row) => row.approved_value !== args.p_monthly_value || row.approved_hours !== args.p_monthly_hours);
      const updated = sources.map((row) => eligible.includes(row) ? { ...row, approved_value: args.p_monthly_value, approved_hours: args.p_monthly_hours } : row);
      const canonical = helpers.monthlyBudgetBaselineForSources(updated);
      return { data: { monthlyValue: args.p_monthly_value, monthlyHours: args.p_monthly_hours, monthCount: eligible.length, aggregateValue: canonical.aggregateValue, aggregateHours: canonical.aggregateHours, changed }, error: null };
    },
    from(table) {
      let values = null;
      const filters = [];
      const result = () => {
        if (table === "project_budget_sources") return { data: sources, error: budgetError };
        if (table === "project_allocations") return { data: assigned && (!isAdmin || audience === "staff") ? [{ id: "allocation", staff_user_id: actorId }] : [], error: null };
        return { data: [], error: null };
      };
      const query = {
        select(columns) { queries.push({ table, columns, filters }); return query; },
        eq(key, value) { filters.push([key, value]); return query; },
        is(key, value) { filters.push([key, value]); return query; },
        neq() { return query; }, in() { return query; }, limit() { return query; }, order() { return query; },
        update(input) { values = Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)); writes.push({ table, values: structuredClone(values) }); events.push(`update:${table}`); return query; },
        async maybeSingle() { return { data: projectFound ? current : null, error: null }; },
        async single() { if (values) current = { ...current, ...values }; return { data: projectFound ? current : null, error: null }; },
        then(resolve, reject) { return Promise.resolve(result()).then(resolve, reject); },
      };
      return query;
    },
  };
  const context = { ...periods, ...helpers, Response, URL, Date, requireSession: async () => ({ user: { id: actorId }, isAdmin, admin }), serverError: (error) => Response.json({ error: error.message }, { status: 500 }) };
  vm.createContext(context);
  vm.runInContext(withoutImports(source).replace(/export /g, "") + `\nthis.handler = ${method};`, context);
  const request = new Request(`https://example.test/api/projects/${projectId}${audience ? `?audience=${audience}` : ""}`, { method, ...(method === "PATCH" ? { headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {}) });
  const response = await context.handler(request, { params: { projectId } });
  return { response, body: await response.json(), writes, queries, rpcCalls, events };
}

let r = await run();
assert.equal(r.response.status, 200);
assert.equal(r.body.monthlyBudgetControlled, true);
assert.equal(r.body.project.budget_dollars, 10194);
assert.equal(r.body.project.budget_hours, 72);
assert.equal(r.rpcCalls.length, 0, "A stale generic save must not edit approved monthly sources.");
assert.deepEqual(r.body.monthlyBudgetBaseline, { monthlyValue: 2548.5, monthlyHours: 18, monthCount: 4, aggregateValue: 10194, aggregateHours: 72, uniform: true });
const sourceQuery = r.queries.find((q) => q.table === "project_budget_sources");
assert(sourceQuery.filters.some(([key, value]) => key === "approval_status" && value === "approved"));
assert(sourceQuery.filters.some(([key, value]) => key === "project_id" && value === projectId));
const nonMonthlySource = { approved_value: 100.10, approved_hours: 0.25, service_period_start: null, service_period_end: null };
r = await run({ sources: [...months, nonMonthlySource] });
assert.equal(r.body.project.budget_dollars, 10294.10);
assert.equal(r.body.project.budget_hours, 72.25);
assert.equal(r.body.monthlyBudgetBaseline.monthCount, 4);
assert.equal(r.body.monthlyBudgetBaseline.monthlyValue, 2548.5);

r = await run({ body: explicit });
assert.equal(r.response.status, 200);
assert.deepEqual(r.rpcCalls, [{ name: "ec_set_monthly_project_budget", args: { p_project_id: projectId, p_actor_id: actorId, p_monthly_value: 2500, p_monthly_hours: 30 } }]);
assert.deepEqual(r.events, ["rpc", "update:projects"]);
assert.equal(r.body.project.budget_dollars, 10000);
assert.equal(r.body.project.budget_hours, 120);
assert.equal(r.body.monthlyBudgetBaseline.monthlyValue, 2500);
assert.equal(r.body.monthlyBudgetBaseline.monthlyHours, 30);
assert.equal(r.body.monthlyBudgetBaseline.changed, true);
assert.equal(r.body.project.client_name, project.client_name, "A budget-only PATCH must preserve client, scope, description and team fields.");
assert.equal(r.body.project.scope_of_works, project.scope_of_works);
assert.equal(r.body.project.description, project.description);
assert.equal(r.body.project.project_lead_user_id, project.project_lead_user_id);
r = await run({ body: { ...explicit, budgetDollars: 999, budgetHours: 999 }, sources: [...months, nonMonthlySource] });
assert.equal(r.body.project.budget_dollars, 10100.10);
assert.equal(r.body.project.budget_hours, 120.25);
r = await run({ sources: months.map((row) => ({ ...row, approved_value: 2500, approved_hours: 30 })), body: explicit });
assert.equal(r.body.monthlyBudgetBaseline.changed, false, "Same-value baseline remains a successful RPC no-op.");
r = await run({ body: { ...explicit, monthlyBudgetValue: 0, monthlyBudgetHours: "0.00" } });
assert.equal(r.response.status, 200);
assert.equal(r.body.project.budget_dollars, 0);
assert.equal(r.body.project.budget_hours, 0);
assert.equal(r.body.monthlyBudgetBaseline.monthlyValue, 0);
r = await run({ body: { ...explicit, monthlyBudgetValue: "2500.01", monthlyBudgetHours: "30.25" } });
assert.equal(r.body.project.budget_dollars, 10000.04);
assert.equal(r.body.project.budget_hours, 121);
for (const value of [0, "0", "0.00", "2500.50", ".25", 1000000000]) assert(helpers.validMonthlyBudgetAmount(value));
for (const value of ["", " ", null, undefined, true, false, [], {}, "NaN", "Infinity", Infinity, NaN, -1, "-0", "1e3", "0x10", "1,000", "1.001", "30.000", 30.001, 1000000000.01]) {
  assert.equal(helpers.validMonthlyBudgetAmount(value), false, `Reject invalid amount ${String(value)}`);
  for (const key of ["monthlyBudgetValue", "monthlyBudgetHours"]) {
    r = await run({ body: { ...explicit, [key]: value } });
    assert.equal(r.response.status, 400, `PATCH rejects ${key}: ${String(value)}`);
    assert.equal(r.rpcCalls.length, 0);
    assert.equal(r.writes.length, 0);
  }
}
for (const body of [{ budgetBasis: "monthly" }, { budgetBasis: "monthly", budgetDollars: 2500, budgetHours: 30 }, { monthlyBudgetValue: 2500, monthlyBudgetHours: 30 }, { ...explicit, status: "unrecognised" }, { ...explicit, projectLeadUserId: "invalid" }, { ...explicit, startDate: "2026-02-30" }, { ...explicit, description: {} }, { ...explicit, defaultHourlyRate: "not a rate" }, []]) {
  r = await run({ body }); assert.equal(r.response.status, 400); assert.equal(r.rpcCalls.length, 0); assert.equal(r.writes.length, 0);
}
const varying = months.map((row, i) => ({ ...row, approved_hours: i === 1 ? 20 : 18 }));
r = await run({ sources: varying, method: "GET" });
assert.equal(r.body.monthlyBudgetBaseline.uniform, false);
assert.equal(r.body.monthlyBudgetBaseline.monthlyValue, null);
assert.equal(r.body.monthlyBudgetBaseline.monthlyHours, null);
for (const sources of [months.map((row, i) => ({ ...row, approved_value: i === 2 ? 2500 : row.approved_value })), months.map((row) => ({ ...row, approved_hours: null }))]) {
  r = await run({ sources, method: "GET" }); assert.equal(r.body.monthlyBudgetBaseline.uniform, false); assert.equal(r.body.monthlyBudgetBaseline.monthlyValue, null);
  r = await run({ sources, body: explicit }); assert.equal(r.response.status, 409); assert.equal(r.rpcCalls.length, 0); assert.equal(r.writes.length, 0);
}
r = await run({ body: { ...explicit, monthlyBudgetValue: "1000000000.00", monthlyBudgetHours: 1000000000 } });
assert.equal(r.response.status, 200); assert.equal(r.rpcCalls[0].args.p_monthly_value, 1000000000);
r = await run({ sources: varying, body: explicit });
assert.equal(r.response.status, 409); assert.equal(r.rpcCalls.length, 0); assert.equal(r.writes.length, 0);
r = await run({ sources: varying });
assert.equal(r.response.status, 200); assert.equal(r.rpcCalls.length, 0); assert.equal(r.body.project.budget_hours, 74);
for (const sources of [[], [nonMonthlySource], [{ ...months[0], service_period_start: "2026-02-30" }], [{ ...months[0], service_period_end: "2026-01-01" }], [{ ...months[0], service_period_end: null }]]) {
  r = await run({ sources, method: "GET" }); assert.equal(r.body.monthlyBudgetBaseline, null);
  r = await run({ sources, body: explicit }); assert.equal(r.response.status, 409); assert.equal(r.rpcCalls.length, 0); assert.equal(r.writes.length, 0);
}
r = await run({ sources: [...months, { ...months[0], approved_value: 99, service_period_start: "not-a-date" }, nonMonthlySource], method: "GET" });
assert.equal(r.body.monthlyBudgetBaseline.monthCount, 4);
assert.equal(r.body.monthlyBudgetBaseline.aggregateValue, 10393.1, "All approved sources contribute to the aggregate, not just valid perioded sources.");
assert.equal(r.body.project.budget_dollars, 10194, "GET keeps persisted project aggregate fields, not per-month values.");
for (const options of [{ sources: [nonMonthlySource] }, { sources: [] }, { sources: null, budgetError: { code: "42703", message: "Period columns awaiting migration" } }]) {
  r = await run(options); assert.equal(r.response.status, 200); assert.equal(r.body.monthlyBudgetControlled, false); assert.equal(r.body.project.budget_dollars, 2548.5); assert.equal(r.body.project.budget_hours, 30);
}
for (const code of ["42P01", "42703", "PGRST204", "PGRST205"]) {
  const options = { sources: null, budgetError: { code, message: "Budget schema awaiting migration" } };
  r = await run({ ...options, method: "GET" }); assert.equal(r.response.status, 200); assert.equal(r.body.monthlyBudgetBaseline, null);
  r = await run({ ...options, body: explicit }); assert.equal(r.response.status, 409); assert.equal(r.rpcCalls.length, 0); assert.equal(r.writes.length, 0);
}
r = await run({ budgetError: { code: "08006", message: "Database unavailable" } });
assert.equal(r.response.status, 400); assert.equal(r.writes.length, 0);
r = await run({ method: "GET", budgetError: { code: "08006", message: "Database unavailable" } });
assert.equal(r.response.status, 400); assert.equal(r.writes.length, 0);
for (const code of ["42883", "PGRST202", "42501", "P0001"]) {
  r = await run({ body: explicit, rpcError: { code, message: "Monthly RPC rejected" } });
  assert.equal(r.response.status, ["42883", "PGRST202"].includes(code) ? 409 : 400); assert.equal(r.writes.length, 0);
}
r = await run({ body: explicit, rpcData: null });
assert.equal(r.response.status, 502); assert.equal(r.writes.length, 0);
for (const options of [{ isAdmin: false }, { isAdmin: false, body: explicit }, { projectFound: false, body: explicit }]) {
  r = await run(options); assert.equal(r.response.status, options.isAdmin === false ? 403 : 404); assert.equal(r.writes.length, 0); assert.equal(r.rpcCalls.length, 0); assert(!r.queries.some((q) => q.table === "project_budget_sources"));
}
for (const options of [{ isAdmin: false }, { isAdmin: true, audience: "staff" }]) {
  r = await run({ ...options, method: "GET" }); assert.equal(r.response.status, 200); assert(!Object.hasOwn(r.body, "monthlyBudgetBaseline")); assert(!r.queries.some((q) => q.table === "project_budget_sources"));
  r = await run({ ...options, method: "GET", assigned: false }); assert.equal(r.response.status, 403);
}

// Execute the component's actual saveDetails and load functions independently
// of JSX. React setters are simulated, including edits made while awaiting API.
const saveCode = ui.slice(ui.indexOf("  const saveDetails = async () => {"), ui.indexOf("  const saveSchedule = async () => {"));
async function runSave({ baseline = helpers.monthlyBudgetBaselineForSources(months), inputs = { value: 2500, hours: 30 }, response, ok = true } = {}) {
  const calls = [], errors = [], messages = [];
  const teamDraft = [{ staffUserId: actorId, allocatedHours: "66", roleOnProject: "User-written role" }];
  const state = { project: { ...project, name: "User name", scope_of_works: "User scope", description: "User notes", client_name: "User client", client_contact: "User contact", overseeing_senior_ecologist_user_id: actorId }, baseline, inputs, teamDraft };
  const context = {
    ...helpers, projectId, project: state.project, monthlyBudgetBaseline: baseline, monthlyBudgetInputs: inputs,
    setProject: (value) => { state.project = typeof value === "function" ? value(state.project) : value; },
    setMonthlyBudgetBaseline: (value) => { state.baseline = value; },
    setMonthlyBudgetInputs: (value) => { state.inputs = value; },
    notify: (message) => messages.push(message), fail: (error) => errors.push(error.message || error),
    auth: async (method, url, body) => {
      calls.push({ method, url, body: plain(body) });
      state.project.description = "User notes edited during save";
      return { ok, json: async () => response || { project: { ...project, name: "Stale server wording", budget_dollars: 10000, budget_hours: 120 }, monthlyBudgetControlled: true, monthlyBudgetBaseline: { monthlyValue: 2500, monthlyHours: 30, monthCount: 4, aggregateValue: 10000, aggregateHours: 120, uniform: true, changed: true } } };
    },
  };
  vm.createContext(context); vm.runInContext(saveCode + "\nthis.save = saveDetails;", context);
  const saved = await context.save();
  return { saved, calls, errors, messages, state };
}
let saved = await runSave();
assert.equal(saved.saved, true);
assert.equal(saved.calls[0].body.budgetBasis, "monthly");
assert.equal(saved.calls[0].body.monthlyBudgetValue, 2500);
assert.equal(saved.calls[0].body.monthlyBudgetHours, 30);
assert(!Object.hasOwn(saved.calls[0].body, "budgetDollars"));
assert(!Object.hasOwn(saved.calls[0].body, "budgetHours"));
assert.equal(saved.state.project.name, "User name");
assert.equal(saved.state.project.scope_of_works, "User scope");
assert.equal(saved.state.project.description, "User notes edited during save");
assert.equal(saved.state.project.client_name, "User client");
assert.equal(saved.state.project.client_contact, "User contact");
assert.equal(saved.state.project.overseeing_senior_ecologist_user_id, actorId);
assert.equal(saved.state.project.project_lead_user_id, actorId);
assert.equal(saved.state.teamDraft[0].allocatedHours, "66");
assert.equal(saved.state.project.budget_dollars, 10000);
assert.deepEqual(plain(saved.state.inputs), { value: 2500, hours: 30 }, "Canonical refresh uses per-month response, never aggregate input amounts.");
for (const options of [{ baseline: helpers.monthlyBudgetBaselineForSources(varying) }, { inputs: { value: "", hours: 30 } }, { inputs: { value: 2500, hours: "30.001" } }]) {
  saved = await runSave(options); assert.equal(saved.saved, false); assert.equal(saved.calls.length, 0);
}
saved = await runSave({ inputs: { value: 0, hours: 0 }, response: { project: { ...project, budget_dollars: 0, budget_hours: 0 }, monthlyBudgetControlled: true, monthlyBudgetBaseline: { monthlyValue: 0, monthlyHours: 0, monthCount: 4, aggregateValue: 0, aggregateHours: 0, uniform: true } } });
assert.equal(saved.saved, true); assert.deepEqual(plain(saved.state.inputs), { value: 0, hours: 0 });
saved = await runSave({ baseline: null, response: { project, monthlyBudgetControlled: false, monthlyBudgetBaseline: null } });
assert.equal(saved.calls[0].body.budgetDollars, 10194); assert.equal(saved.calls[0].body.budgetHours, 72); assert(!Object.hasOwn(saved.calls[0].body, "budgetBasis"));
saved = await runSave({ ok: false, response: { error: "Migration pending" } });
assert.equal(saved.saved, false); assert.equal(saved.state.project.budget_dollars, 10194); assert.equal(saved.state.inputs.value, 2500);

const loadCode = ui.slice(ui.indexOf("  const load = useCallback(async () => {", ui.indexOf("function ProjectDetail(")), ui.indexOf("  useEffect(() => {\n    load();", ui.indexOf("function ProjectDetail(")));
for (const baseline of [helpers.monthlyBudgetBaselineForSources(months), helpers.monthlyBudgetBaselineForSources(varying), { ...helpers.monthlyBudgetBaselineForSources(months), monthlyValue: 0, monthlyHours: 0 }, null]) {
  const state = {};
  const context = { projectId, activitiesDraftKey: "", deletingActivitiesRef: { current: false }, useCallback: (fn) => fn, fail: (error) => { throw error; },
    auth: async (_method, url) => ({ ok: true, json: async () => url.endsWith(projectId) ? { project, monthlyBudgetBaseline: baseline, allocations: [], schedule: [] } : {} }),
  };
  for (const name of ["Project", "MonthlyBudgetBaseline", "MonthlyBudgetInputs", "Schedule", "Allocations", "Activities", "LoadingProject", "SelectedActivityKeys", "DeletionResult", "ActivitiesDraftAvailable", "ActivitiesDraftRestored", "ScheduleNeedsRefresh", "KnownMaxUpdatedAt", "Deliverables"]) context[`set${name}`] = (value) => { state[name] = value; };
  vm.createContext(context); vm.runInContext(loadCode + "\nthis.runLoad = load;", context); await context.runLoad();
  assert.equal(state.Project.budget_dollars, 10194); assert.equal(state.MonthlyBudgetBaseline, baseline);
  assert.deepEqual(plain(state.MonthlyBudgetInputs), { value: baseline?.monthlyValue ?? "", hours: baseline?.monthlyHours ?? "" });
}
assert(ui.includes('"Budget hours per month"'));
assert(ui.includes('"Budget $ per month"'));
assert(ui.includes("Actuals remain month-specific"));
assert.equal((ui.match(/disabled=\{Boolean\(monthlyBudgetBaseline && !monthlyBudgetBaseline.uniform\)\}/g) || []).length, 2);
assert.equal((ui.match(/disabled=\{activitiesBusy \|\| \(activeStage === "details" && Boolean\(monthlyBudgetBaseline && !monthlyBudgetBaseline.uniform\)\)\}/g) || []).length, 2);
const readinessCode = ui.slice(ui.indexOf("  const stageChecks = {"), ui.indexOf("  const stageIndex ="));
const readiness = { ...helpers, project, monthlyBudgetBaseline: { uniform: true }, monthlyBudgetInputs: { value: 0, hours: 0 }, allocations: [], deliverables: [], activities: [], schedule: [] };
vm.createContext(readiness); vm.runInContext(readinessCode + "\nthis.ready = stageChecks.details;", readiness);
assert.equal(readiness.ready, true, "A valid zero monthly baseline must not be treated as blank or prevent details progression.");
const pkg = JSON.parse(await read("package.json"));
assert(pkg.scripts.pretest.includes("node scripts/check_project_setup_monthly_budget.mjs"));
console.log("Monthly setup budgets passed: real administrator-only GET/PATCH, uniform/mixed periods, stale generic protection, 2500/30 -> 10000/120, decimals and zero, legacy/schema compatibility, fail-closed RPC, Setup load/save and wording/team preservation.");
