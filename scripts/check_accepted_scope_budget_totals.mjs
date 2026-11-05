import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const root = new URL("..", import.meta.url);
const read = (file) => readFile(new URL(file, root), "utf8");
const adminSource = await read("app/api/admin/project-tracker/route.js");
const healthSource = await read("app/api/project-health-report/route.js");
const uiSource = await read("components/AdminProjectTracker.js");

// Execute the real calculation functions, not a reimplementation. All data is
// local fixtures; these tests never create a database or network connection.
const trackerContext = vm.createContext({ Response, Date, console });
vm.runInContext(`${adminSource.slice(0, adminSource.indexOf("async function trackerData(")).replace(/^import .*;\n/gm, "").replace(/^export /gm, "")}\nthis.build = buildProjectTracker;`, trackerContext);
const project = { id: "p", name: "Accepted scope", client_name: "Client", status: "active", budget_dollars: 7505, budget_hours: 33.5, default_hourly_rate: 150 };
const source = (id, type, value, hours, approval = "approved") => ({ id, project_id: project.id, source_type: type, approved_value: value, approved_hours: hours, approval_status: approval });
const allocation = (id, sourceId, hours = 0, spend = 0, cost = spend * 0.6, status = "active") => ({ id, project_id: project.id, budget_source_id: sourceId, status, hours_consumed: hours, charge_out_spend: spend, internal_cost: cost });
const entry = (sourceId, hours, staff = "staff") => ({ project_id: project.id, budget_source_id: sourceId, hours, staff_user_id: staff, status: "completed" });
const original = source("old", "original", 80000, 400, "closed");
const item1b = source("item1b", "variation", "7505", "33.5");
const oldActual = allocation("old-actual", "old", 297, 40414.50, 24248.70);
const staffAllocations = [{ project_id: project.id, staff_user_id: "staff", hourly_rate: 999, active: true }];

function tracker(fixture) {
  return trackerContext.build(fixture.project || project, fixture.sources || [], fixture.budgetAllocations || [], [], fixture.entries || [], 1, {}, new Map(), new Map(), true);
}

async function health(fixture, errors = {}) {
  const selected = new Map();
  const tables = {
    projects: [fixture.project || project], project_activities: [],
    project_allocations: fixture.staffAllocations || staffAllocations,
    project_tracker_entries: fixture.entries || [],
    project_budget_sources: fixture.sources || [],
    project_budget_allocations: fixture.budgetAllocations || [],
  };
  const admin = { from(table) {
    const query = {
      select(columns) { selected.set(table, columns.split(", ")); return query; },
      is() { return query; }, neq() { return query; },
      then(resolve, reject) {
        const data = (tables[table] || []).map((row) => Object.fromEntries(selected.get(table).map((column) => [column, row[column]])));
        return Promise.resolve({ data: errors[table] ? null : data, error: errors[table] || null }).then(resolve, reject);
      },
    };
    return query;
  } };
  const context = vm.createContext({
    Response, console,
    requireSession: async () => ({ admin, isAdmin: true }),
    serverError: (error) => Response.json({ error: error.message }, { status: 500 }),
  });
  vm.runInContext(`${healthSource.replace(/^import .*;\n/gm, "").replace(/^export /gm, "")}\nthis.get = GET;`, context);
  const response = await context.get(new Request("https://local.test/api/project-health-report"));
  return { status: response.status, body: await response.json(), selected };
}

async function check(fixture, expected) {
  const before = JSON.stringify(fixture);
  const result = tracker(fixture);
  const api = await health(fixture);
  assert.equal(api.status, 200, api.body.error);
  const row = api.body.rows[0];
  for (const [key, value] of Object.entries(expected)) assert.equal(result.financials[key], value, `Admin ${key}`);
  const shared = { overallBudget: "budgetDollars", chargeOutSpend: "currentSpend", internalCost: "deliveryCost" };
  for (const [key, value] of Object.entries(expected)) {
    if (Object.hasOwn(row, shared[key] || key)) assert.equal(row[shared[key] || key], value, `Portfolio ${key}`);
  }
  assert.equal(JSON.stringify(fixture), before, "Financial reads must not modify records or rates.");
  return { result, row };
}

// Regression: the register budget is the current variation, not an additional
// original. The closed source retains 297h/$40,414.50 even while still active
// at allocation level; source approval is what excludes it from current scope.
const brooklyn = {
  sources: [original, item1b], budgetAllocations: [oldActual, allocation("new-actual", "item1b")],
  entries: [entry("old", 297)],
};
let checked = await check(brooklyn, {
  originalBudget: 0, variationBudget: 7505, overallBudget: 7505, budgetHours: 33.5,
  chargeOutSpend: 0, internalCost: 0, usedHours: 0, estimatedProfit: 7505,
  historicalUsedHours: 297, historicalChargeOutSpend: 40414.50, historicalInternalCost: 24248.70,
  lifetimeUsedHours: 297, lifetimeChargeOutSpend: 40414.50,
});
assert.equal(checked.row.remainingBudget, 7505);
assert.equal(checked.row.remainingHours, 33.5);
assert.equal(checked.result.entrySummary.submittedHours, 297, "Entry history must remain visible.");
assert.equal(checked.result.entrySummary.all.length, 1);
assert.equal(checked.result.sources.length, 2, "Closed sources remain in audit details.");
assert.equal(checked.row.health, "On Track", "Closed work must not trigger current-scope overruns.");

// A variation-only project also works without a historical original. Approved
// allocations' stored cost/spend win over current team rates and old entries.
checked = await check({ sources: [item1b], budgetAllocations: [allocation("new", "item1b", 2, 450, 270)], entries: [entry("item1b", 2), entry("old", 297), entry(null, 900)] }, {
  originalBudget: 0, variationBudget: 7505, overallBudget: 7505, budgetHours: 33.5,
  usedHours: 2, chargeOutSpend: 450, internalCost: 270, estimatedProfit: 7235,
  historicalUsedHours: 0, historicalChargeOutSpend: 0,
});
assert.equal(checked.row.remainingBudget, 7055);

// Ordinary approved original + variation still add exactly once. Inactive
// allocations on an approved source are historical, not current actuals.
await check({
  project: { ...project, budget_dollars: 99999, budget_hours: 999 },
  sources: [source("base", "original", 10000, 50), source("extra", "variation", 2500, 10), source("pending", "variation", 5000, 20, "pending_approval")],
  budgetAllocations: [allocation("base-live", "base", 5, 1000, 600), allocation("extra-live", "extra", 2, 400, 240), allocation("base-closed", "base", 3, 600, 360, "closed"), allocation("pending-actual", "pending", 1, 200, 120)],
}, {
  originalBudget: 10000, variationBudget: 2500, overallBudget: 12500, budgetHours: 60,
  usedHours: 7, chargeOutSpend: 1400, internalCost: 840, estimatedProfit: 11660,
  historicalUsedHours: 4, historicalChargeOutSpend: 800, historicalInternalCost: 480,
  lifetimeUsedHours: 11, lifetimeChargeOutSpend: 2200,
});

// Four individually accepted service months: aggregate funding remains
// $10,000/120h; it is not one month plus the register's portfolio total.
const months = ["2026-10", "2026-11", "2026-12", "2027-01"];
await check({
  project: { ...project, budget_dollars: 10000, budget_hours: 120 },
  sources: months.map((month, index) => ({ ...source(month, index === 0 ? "original" : "variation", 2500, 30), service_period_start: `${month}-01` })),
  budgetAllocations: months.map((month) => allocation(`${month}-actual`, month, 1, 150, 90)),
}, {
  originalBudget: 2500, variationBudget: 7500, overallBudget: 10000, budgetHours: 120,
  usedHours: 4, chargeOutSpend: 600, internalCost: 360, estimatedProfit: 9640,
  historicalUsedHours: 0, historicalChargeOutSpend: 0,
});

// Approved internal reallocations are not new contract funding and must not
// activate a cached-original fallback. Closed-only scope has no current profit
// from the closed contract, regardless of the old register budget.
await check({ sources: [source("move", "internal_reallocation", 7505, 33.5)] }, { originalBudget: 0, variationBudget: 0, overallBudget: 0, budgetHours: 0 });
checked = await check({ sources: [original], budgetAllocations: [oldActual], entries: [entry("old", 297)] }, {
  originalBudget: 0, variationBudget: 0, overallBudget: 0, budgetHours: 0,
  usedHours: 0, chargeOutSpend: 0, historicalUsedHours: 297, historicalChargeOutSpend: 40414.50,
});
assert.equal(checked.row.estimatedProfit, null, "Historical contract profit is not current funding.");

// Genuine legacy fallback keeps register budgets and the portfolio's existing
// staff/default entry-rate semantics. Do not invent source allocations.
const legacy = { project: { ...project, budget_dollars: 1200, budget_hours: 8 }, entries: [entry(null, 2), entry(null, 1, "ad-hoc")], staffAllocations: [{ project_id: project.id, staff_user_id: "staff", hourly_rate: 200, active: true }] };
const legacyTracker = tracker(legacy);
assert.equal(legacyTracker.financials.originalBudget, 1200);
assert.equal(legacyTracker.financials.overallBudget, 1200);
assert.equal(legacyTracker.financials.budgetHours, 8);
let api = await health(legacy);
assert.equal(api.status, 200);
assert.equal(api.body.rows[0].usedHours, 3);
assert.equal(api.body.rows[0].currentSpend, 550);
assert.equal(api.body.rows[0].deliveryCost, 330);
assert.equal(api.body.rows[0].estimatedProfit, 870);
assert.equal(api.body.rows[0].lifetimeChargeOutSpend, 550);
const missingTable = { code: "42P01", message: "relation does not exist" };
api = await health(legacy, { project_budget_sources: missingTable, project_budget_allocations: missingTable });
assert.equal(api.status, 200, "Missing source schema must retain legacy compatibility.");
assert.equal(api.body.rows[0].currentSpend, 550);
api = await health(brooklyn, { project_budget_allocations: missingTable });
assert.equal(api.status, 500, "A source-backed read must not silently substitute all project entries when allocations are unavailable.");
api = await health(brooklyn, { project_budget_sources: { code: "42501", message: "Permission denied" } });
assert.equal(api.status, 500, "Permission failures are not legacy schema fallbacks.");

assert.match(uiSource, /Historical work retained:/);
assert.match(uiSource, /historicalUsedHours/);
assert.match(uiSource, /historicalChargeOutSpend/);
assert.match(uiSource, /Excluded from current accepted-scope budgets, spend and profit/);
assert.match(uiSource, /Full entry history remains available/);
console.log("Accepted scope budgets: variation-only $7,505, closed original 297h/$40,414.50 history, stored actuals/no entry leakage, mixed approvals, four months $10,000/120h, closed-only/internal-reallocation guards, legacy fallback and historical UI notice passed.");
