import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import vm from "node:vm";

// Entirely offline: actual source + bounded PostgREST mock + SWC hook rendering.
// No credentials, application initialization, SQL, remote services or writes.
const root = new URL("../", import.meta.url);
const read = (file) => readFile(new URL(file, root), "utf8");
const moduleUrl = (source) => `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
const chargeUrl = moduleUrl(await read("lib/projectTrackerChargeRates.js"));
const charge = await import(chargeUrl);
const unassignedUrl = moduleUrl((await read("lib/projectTrackerUnassignedActuals.js")).replace('"./projectTrackerChargeRates"', JSON.stringify(chargeUrl)));
const unassigned = await import(unassignedUrl);
const helperSource = await read("lib/projectTrackerRoleCosts.js");
const role = await import(moduleUrl(helperSource.replace('"./projectTrackerChargeRates"', JSON.stringify(chargeUrl)).replace('"./projectTrackerUnassignedActuals"', JSON.stringify(unassignedUrl))));
const apiSource = await read("app/api/admin/project-tracker-role-costs/route.js");
const componentSource = await read("components/ProjectRoleCostOverview.js");
const uuid = (number) => `00000000-0000-4000-8000-${String(number).padStart(12, "0")}`;
const P = uuid(1), S = uuid(2), A = uuid(3), STAFF = uuid(4), ADMIN = uuid(5), CLOSED_S = uuid(6), CLOSED_A = uuid(7);
const SENIOR = "d07b78be-c1e7-4bf5-94fa-5366a59cb408";
const MANAGER = "577f0587-e75c-4c35-8013-1b334c348871";
const rates = new Map([[P, new Map([["Senior Ecologist", 250], ["Ecologist", 200], ["Project Manager", 150]])]]);
const project = { id: P, name: "Offline fixture project", default_hourly_rate: 95, status: "active", deleted_at: null };
const source = { id: S, project_id: P, source_type: "original", approval_status: "approved" };
const allocation = { id: A, project_id: P, budget_source_id: S, status: "active", hours_consumed: 6, charge_out_spend: 945 };
const closedSource = { ...source, id: CLOSED_S, approval_status: "closed" };
const closedAllocation = { ...allocation, id: CLOSED_A, budget_source_id: CLOSED_S, status: "closed", hours_consumed: 4, charge_out_spend: 440 };
const entry = (id, staff = STAFF, hours = 1, rate = 180, extra = {}) => ({
  id: uuid(id), project_id: P, staff_user_id: staff, budget_source_id: S, budget_allocation_id: A, hours,
  custom_data: { charge_rate_stamped: true, charge_role: charge.trackerChargeRole(staff), charge_rate_snapshot: rate }, ...extra,
});
const explicit = (id, staff = STAFF, hours = 1, rate = 180, extra = {}) => entry(id, staff, hours, rate, {
  budget_source_id: null, budget_allocation_id: null,
  custom_data: { budget_assignment: "unassigned", charge_rate_stamped: true, charge_role: charge.trackerChargeRole(staff), charge_rate_snapshot: rate }, ...extra,
});
const build = (entries = [], extra = {}) => role.summarizeTrackerRoleCosts({
  projectId: P, entries, sources: [source, closedSource], allocations: [allocation, closedAllocation], ratesByProject: rates,
  legacyRateByStaff: new Map([[STAFF, 125], [MANAGER, 0]]), defaultHourlyRate: 95, ...extra,
});
let assertions = 0;
const equal = (actual, expected, message) => { assert.equal(actual, expected, message); assertions += 1; };
const near = (actual, expected, message) => { assert(Math.abs(actual - expected) < 1e-9, `${message || "Values differ"}: ${actual} vs ${expected}`); assertions += 1; };

for (const id of [SENIOR, SENIOR.toUpperCase(), "4eef096c-91da-4135-839d-c8a67b3a5e6f", "abd4449e-5294-4e18-ad2a-08403cc3e1ce"]) equal(role.trackerInternalHourlyRate(id), 81);
for (const id of [MANAGER, MANAGER.toUpperCase(), "2c265989-7864-41ad-9e2d-202d64d9a954", "75b7ca74-86d9-4cf5-be17-31ac12947f40"]) equal(role.trackerInternalHourlyRate(id), 70);
for (const id of [STAFF, null, "unknown", "Job title does not change account policy"]) equal(role.trackerInternalHourlyRate(id), 75);
equal(role.trackerEntryInternalCost(entry(10, SENIOR, "2.25")), 2.25 * 81);
equal(role.sumTrackerInternalCosts([entry(11, SENIOR, 2), entry(12, STAFF, 3), entry(13, MANAGER, 1)]), 2 * 81 + 3 * 75 + 70);
equal(role.sumTrackerInternalCosts(), 0);
assert.throws(() => { role.TRACKER_INTERNAL_HOURLY_RATES.Ecologist = 60; }, TypeError);
for (const bad of [-1, null, undefined, "", " ", true, {}, NaN, Infinity]) assert.throws(() => role.trackerEntryInternalCost(entry(15, STAFF, 1, 180, { hours: bad })), /hours/);
for (const [custom_data, expected] of [[{ km: "12.5" }, 12.5], [{ kilometres: "7.25" }, 7.25], [{ km: 0, kilometres: 88 }, 0], [{ km: null, kilometres: 9 }, 9], [{ km: "" }, 0], [{}, 0]]) equal(role.trackerEntryKilometres({ custom_data }), expected);
for (const km of [-1, true, {}, NaN, Infinity]) assert.throws(() => role.trackerEntryKilometres({ custom_data: { km } }), /kilometres/);

const inputs = [
  entry(20, SENIOR, 2, 220, { custom_data: { charge_rate_stamped: true, charge_role: "Senior Ecologist", charge_rate_snapshot: 220, km: 10 } }),
  entry(21, STAFF, 3, 999, { custom_data: { charge_rate_snapshot: 999, kilometres: 7 } }), // Unstamped: 125/h, never 999 or today's 200.
  entry(22, MANAGER, 1, 130),
  explicit(23, STAFF, 0.5, 180, { custom_data: { budget_assignment: "unassigned", charge_rate_stamped: true, charge_role: "Ecologist", charge_rate_snapshot: 180, km: 3 } }),
  entry(24, STAFF, 4, 110, { budget_source_id: CLOSED_S, budget_allocation_id: CLOSED_A }),
  entry(25, STAFF, 0.25, 100, { budget_source_id: null, budget_allocation_id: null, custom_data: {} }),
  entry(26, STAFF, 0.75, 100, { budget_source_id: S, budget_allocation_id: null, custom_data: { budget_assignment: "unassigned" } }),
];
const before = structuredClone(inputs);
let overview = build([...inputs, inputs[3], entry(27, STAFF, 100, 900, { project_id: uuid(99) })]);
assert.deepEqual(inputs, before, "Pure aggregation never changes history or metadata.");
equal(overview.duplicateEntryCount, 1);
equal(overview.current.entryCount, 4);
equal(overview.current.assignedEntryCount, 3);
equal(overview.current.unassignedEntryCount, 1);
equal(overview.current.hours, 6.5);
equal(overview.current.kilometres, 20);
equal(overview.current.labourTotals.chargeOutSpend, 440 + 375 + 130 + 90);
equal(overview.current.labourTotals.internalSpend, 162 + 225 + 70 + 37.5);
equal(overview.historical.entryCount, 1);
equal(overview.historical.hours, 4);
equal(overview.historical.labourTotals.chargeOutSpend, 440);
equal(overview.otherHistory.entryCount, 2);
equal(overview.otherHistory.hours, 1);
equal(overview.lifetime.entryCount, 7);
equal(overview.lifetime.hours, 11.5);
equal(overview.lifetime.labourTotals.chargeOutSpend, 1035 + 440 + 0.25 * 125 + 0.75 * 125);
equal(overview.unassigned.entryCount, 1);
equal(overview.unassigned.labourTotals.chargeOutSpend, 90);
equal(overview.unassigned.labourTotals.internalSpend, 37.5);
equal(overview.current.totals.marginScope, "Labour and mileage");
equal(overview.current.totals.mileageIncluded, true);
equal(overview.current.rows.length, 4);
assert.deepEqual(overview.current.rows.map((row) => row.role), ["Senior Ecologist", "Ecologist", "Project Manager", "Mileage"]);
const seniorRow = overview.current.rows[0], ecoRow = overview.current.rows[1], managerRow = overview.current.rows[2], mileageRow = overview.current.rows[3];
equal(seniorRow.currentChargeRate, 250);
equal(seniorRow.chargeOutSpend, 440);
equal(seniorRow.internalRate, 81);
equal(seniorRow.historicalRatesDiffer, true);
equal(ecoRow.currentChargeRate, 200);
equal(ecoRow.quantity, 3.5);
equal(ecoRow.chargeOutSpend, 465);
equal(ecoRow.legacyEntryCount, 1);
equal(ecoRow.snapshotEntryCount, 1);
near(ecoRow.appliedEffectiveChargeRate, 465 / 3.5);
equal(managerRow.chargeOutSpend, 130);
equal(mileageRow.currentChargeRate, null);
equal(mileageRow.internalRate, 0.9);
equal(mileageRow.chargeOutSpend, 0);
equal(mileageRow.internalSpend, 18);
equal(mileageRow.profit, -18);
equal(mileageRow.profitMarginPercent, null);
equal(mileageRow.quantity, 20);
equal(overview.current.referenceOnlyKilometres, 20);
equal(overview.current.referenceOnlyMileageEntryCount, 3);
near(overview.current.totals.profit, 1035 - 494.5 - 18);
near(overview.current.totals.profitMarginPercent, (1035 - 494.5 - 18) / 1035 * 100);
const arithmeticMean = overview.current.rows.slice(0, 3).reduce((sum, row) => sum + row.profitMarginPercent, 0) / 3;
assert(Math.abs(arithmeticMean - overview.current.totals.profitMarginPercent) > 0.01, "Total margin is weighted, not a mean.");
equal(overview.allocationReconciliation.current.differs, false);
equal(overview.allocationReconciliation.historical.differs, false);
const discrepant = build(inputs, { allocations: [{ ...allocation, charge_out_spend: 9999 }, closedAllocation] });
equal(discrepant.allocationReconciliation.current.differs, true);
equal(discrepant.current.labourTotals.chargeOutSpend, 1035, "Never spread manual/stale cached allocation amounts into roles.");

const changedCard = new Map([[P, new Map([["Senior Ecologist", 900], ["Ecologist", 850], ["Project Manager", 800]])]]);
const changed = build(inputs, { ratesByProject: changedCard });
equal(changed.current.rows[1].currentChargeRate, 850);
equal(changed.current.labourTotals.chargeOutSpend, overview.current.labourTotals.chargeOutSpend, "Changing current cards cannot reprice recorded history.");
equal(role.trackerRoleEntryActuals(entry(30, STAFF, 1, 999, { custom_data: {} }), { ratesByProject: changedCard, legacyRateByStaff: new Map([[STAFF, 125]]), defaultHourlyRate: 95 }).chargeOutSpend, 125);
equal(role.trackerRoleEntryActuals(entry(31, MANAGER, 1, 999, { custom_data: {} }), { ratesByProject: changedCard, legacyRateByStaff: new Map([[MANAGER, 0]]), defaultHourlyRate: 95 }).chargeOutSpend, 95);
equal(role.trackerRoleEntryActuals(entry(32, STAFF, 1, 999, { custom_data: {} })).chargeOutSpend, 0);
equal(build(inputs, { ratesByProject: new Map() }).current.rows[0].currentChargeRate, null);
equal(build(inputs, { ratesByProject: new Map() }).current.labourTotals.chargeOutSpend, 1035);
for (const bad of [0, -1, "180", null, Infinity]) assert.throws(() => build([explicit(34, STAFF, 1, bad)]), /snapshot/);
assert.throws(() => build([explicit(35, STAFF, 1, 180, { custom_data: { budget_assignment: "unassigned" } })]), /trusted charge snapshot/);
assert.throws(() => build([explicit(36, STAFF, 1, 180, { custom_data: { budget_assignment: "unassigned", charge_rate_stamped: true, charge_role: "Project Manager", charge_rate_snapshot: 180 } })]), /trusted charge snapshot/);
// Existing trusted helper deliberately falls back for a mismatched legacy role.
equal(role.trackerRoleEntryActuals(entry(37, STAFF, 1, 999, { custom_data: { charge_rate_stamped: true, charge_role: "Project Manager", charge_rate_snapshot: 999 } }), { defaultHourlyRate: 95 }).chargeOutSpend, 95);
assert.deepEqual(role.summarizeTrackerLabourActuals(inputs.slice(0, 3), { ratesByProject: rates, legacyRateByStaff: new Map([[STAFF, 125]]), defaultHourlyRate: 95 }), {
  count: 3, hours: 6, chargeOutSpend: 945, internalCost: 457, profit: 488, profitMarginPercent: 488 / 945 * 100,
});
const fractional = role.summarizeTrackerLabourActuals([entry(38, STAFF, 0.001, 123.45), entry(39, STAFF, 0.001, 123.45)]);
near(fractional.chargeOutSpend, 0.2469, "No per-entry premature rounding.");
const zero = build([entry(40, STAFF, 0, 180)]);
equal(zero.current.totals.profitMarginPercent, null);
for (const row of zero.current.rows) equal(row.profitMarginPercent, null);
const freeLegacy = build([entry(41, STAFF, 1, 100, { custom_data: {} })], { legacyRateByStaff: new Map(), defaultHourlyRate: 0 });
equal(freeLegacy.current.totals.profit, -75);
equal(freeLegacy.current.totals.profitMarginPercent, null);
equal(role.trackerProfitMargin(0, 10), null);
equal(build().current.entryCount, 0);

// Confirmed internal policy is 0.90/km on ALL recorded kilometres. Current
// mileage card changes are display-only: old reference km cannot earn revenue.
equal(role.TRACKER_INTERNAL_MILEAGE_RATE, 0.9);
equal(role.trackerEntryMileageInternalCost(inputs[0]), 9);
equal(role.trackerEntryLabourInternalCost(inputs[0]), 162);
equal(role.trackerEntryInternalCost(inputs[0]), 171);
equal(role.trackerEntryInternalCost(inputs[0], { includeMileage: false }), 162);
equal(role.sumTrackerInternalCosts(inputs), 887.5);
equal(role.sumTrackerInternalCosts(inputs, { includeMileage: false }), 869.5);
equal(role.trackerEntryInternalCost({ ...inputs[0], custom_data: { ...inputs[0].custom_data, internal_rate_stamped: true, internal_rate_snapshot: 999, mileage_internal_rate_snapshot: 999 } }), 171, "Current fixed internal policy does not follow arbitrary rate metadata.");
const oldMileageWithNewCard = build(inputs, { mileageChargeRate: 1.5 });
equal(oldMileageWithNewCard.current.rows[3].currentChargeRate, 1.5);
equal(oldMileageWithNewCard.current.rows[3].chargeOutSpend, 0);
equal(oldMileageWithNewCard.current.rows[3].internalSpend, 18);
equal(oldMileageWithNewCard.current.totals.chargeOutSpend, 1035);
equal(oldMileageWithNewCard.current.totals.internalSpend, 512.5);
equal(oldMileageWithNewCard.current.rows[3].historicalRatesDiffer, true);
const pricedInputs = structuredClone(inputs);
Object.assign(pricedInputs[0].custom_data, { mileage_charge_stamped: true, mileage_charge_rate_snapshot: 1.5 });
Object.assign(pricedInputs[1].custom_data, { mileage_charge_stamped: true, mileage_charge_rate_snapshot: 2.25 });
Object.assign(pricedInputs[3].custom_data, { mileage_charge_stamped: true, mileage_charge_rate_snapshot: 0 });
const cardWithMileage = new Map([[P, new Map([...rates.get(P), ["Mileage", 2]])]]);
const mileageConfigured = build(pricedInputs, { ratesByProject: cardWithMileage });
equal(mileageConfigured.current.rows[3].currentChargeRate, 2);
equal(mileageConfigured.current.rows[3].chargeOutSpend, 10 * 1.5 + 7 * 2.25);
equal(mileageConfigured.current.rows[3].internalSpend, 18);
equal(mileageConfigured.current.rows[3].profit, 30.75 - 18);
near(mileageConfigured.current.rows[3].profitMarginPercent, (30.75 - 18) / 30.75 * 100);
equal(mileageConfigured.current.totals.chargeOutSpend, 1065.75);
equal(mileageConfigured.current.totals.internalSpend, 512.5);
near(mileageConfigured.current.totals.profitMarginPercent, (1065.75 - 512.5) / 1065.75 * 100);
equal(mileageConfigured.current.referenceOnlyKilometres, 0);
equal(build(pricedInputs, { mileageChargeRate: 999 }).current.rows[3].chargeOutSpend, 30.75, "Today's mileage rate cannot reprice snapshots.");
equal(role.trackerEntryMileageChargeRate(pricedInputs[3]), 0, "Explicit zero snapshot is permitted non-billable mileage.");
equal(role.trackerRoleEntryActuals(pricedInputs[3]).mileageReferenceOnly, false);
equal(role.trackerEntryMileageChargeOutSpend(pricedInputs[0]), 15);
equal(role.trackerEntryMileageChargeRate({ custom_data: { mileage_charge_rate_snapshot: 999 } }), 0, "Unstamped metadata is not authoritative.");
for (const bad of [-1, "1.5", null, undefined, true, NaN, Infinity]) assert.throws(() => role.trackerEntryMileageChargeRate({ custom_data: { mileage_charge_stamped: true, mileage_charge_rate_snapshot: bad } }), /snapshot/);
const totalActuals = role.summarizeTrackerActuals(pricedInputs.slice(0, 4), { legacyRateByStaff: new Map([[STAFF, 125]]), defaultHourlyRate: 95 });
equal(totalActuals.chargeOutSpend, 1065.75); equal(totalActuals.internalCost, 512.5); equal(totalActuals.kilometres, 20);
equal(totalActuals.mileageChargeOutSpend, 30.75); equal(totalActuals.mileageInternalCost, 18);
equal(totalActuals.referenceOnlyKilometres, 0);
const unknownInternal = build(pricedInputs, { mileageChargeRate: 2, mileageInternalRate: null });
equal(unknownInternal.current.rows[3].chargeOutSpend, 30.75);
equal(unknownInternal.current.rows[3].profit, null);
equal(unknownInternal.current.totals.chargeOutSpend, 1035);
equal(unknownInternal.current.totals.mileageIncluded, false);
assert.throws(() => role.summarizeTrackerActuals(inputs, { mileageInternalRate: null }), /internal rate/);
equal(build(inputs, { mileageChargeRate: 0, mileageInternalRate: 0 }).current.rows[3].profitMarginPercent, null);
assert.throws(() => build(inputs, { mileageChargeRate: -1 }), /mileage/);

// Match the admin accepted-scope policy, including variation-only funding.
const variation = { ...source, source_type: "variation" };
equal(build(inputs, { sources: [closedSource, variation] }).current.hours, 6.5);
equal(build(inputs, { sources: [closedSource] }).current.hours, 0.5);
equal(build(inputs, { sources: [] }).current.hours, 0.5, "No invented active funding for legacy allocations.");
equal(build(inputs, { sources: [{ ...source, source_type: "internal_reallocation" }] }).current.hours, 0.5);
equal(build(inputs, { sources: [{ ...source, approval_status: "pending_approval" }] }).current.hours, 0.5);
equal(build(inputs, { allocations: [{ ...allocation, status: "draft" }, closedAllocation] }).historical.hours, 10);
equal(build([entry(45, STAFF, 2, 180, { budget_source_id: null })]).current.hours, 2, "Known allocation identity is authoritative for legacy source pointers.");
equal(build([entry(46, STAFF, 2, 180, { budget_source_id: null, budget_allocation_id: null })]).otherHistory.hours, 2);
equal(build(inputs, { activities: [{ budget_hours: 9999, hours: 9999 }], plannedHours: 9999 }).current.hours, 6.5, "No Activity-derived planned hours.");

function mockAdmin(tables, errors = {}) {
  const calls = [];
  return { calls, from(table) {
    const operation = { table, columns: "*", filters: [], range: null, limit: 1000, order: null, single: false };
    const q = {
      select(columns) { operation.columns = columns; return q; },
      eq(key, value) { operation.filters.push(["eq", key, value]); return q; },
      neq(key, value) { operation.filters.push(["neq", key, value]); return q; },
      is(key, value) { operation.filters.push(["is", key, value]); return q; },
      in(key, value) { operation.filters.push(["in", key, Array.from(value)]); return q; },
      order(key, options) { operation.order = [key, options]; return q; },
      range(first, last) { operation.range = [first, last]; return q; },
      limit(value) { operation.limit = value; return q; },
      maybeSingle() { operation.single = true; return q; },
      then(resolve, reject) {
        calls.push(structuredClone(operation));
        if (errors[table]) return Promise.resolve({ data: null, error: { message: "Private SQL metadata", code: "XX000" } }).then(resolve, reject);
        let rows = (tables[table] || []).filter((row) => operation.filters.every(([kind, key, value]) => kind === "eq" ? row[key] === value : kind === "neq" ? row[key] !== value : kind === "is" ? (row[key] ?? null) === value : value.includes(row[key])));
        if (operation.order) rows = rows.slice().sort((a, b) => String(a[operation.order[0]]).localeCompare(String(b[operation.order[0]])));
        rows = operation.range ? rows.slice(operation.range[0], operation.range[1] + 1) : rows.slice(0, operation.limit);
        rows = rows.map((row) => Object.fromEntries(operation.columns.split(",").map((key) => [key.trim(), structuredClone(row[key.trim()])])));
        return Promise.resolve({ data: operation.single ? rows[0] || null : rows, error: null }).then(resolve, reject);
      },
    };
    return q;
  } };
}
const fixtureTables = (entries = inputs) => ({
  projects: [project], project_budget_sources: [source, closedSource], project_budget_allocations: [allocation, closedAllocation],
  project_allocations: [{ id: uuid(50), project_id: P, staff_user_id: STAFF, hourly_rate: 125 }, { id: uuid(51), project_id: P, staff_user_id: MANAGER, hourly_rate: 0 }],
  project_charge_rates: [{ project_id: P, senior_ecologist_rate: 250, ecologist_rate: 200, project_manager_rate: 150, confirmed_by: ADMIN, confirmed_at: "2026-11-24T00:00:00Z" }],
  project_tracker_entries: entries,
});
let apiScenarios = 0;
async function runApi({ tables = fixtureTables(), staff = false, unauthenticated = false, denied = false, query = `?projectId=${P}`, errors = {}, authThrows = false } = {}) {
  const admin = mockAdmin(tables, errors), authCalls = [];
  const context = vm.createContext({ Response, Headers, URL, ...charge, ...unassigned, ...role,
    console: { error() {} },
    requireSession: async () => { authCalls.push("session"); if (authThrows) throw new Error("Private credentials"); return {
      admin, user: { id: ADMIN }, isAdmin: !staff,
      error: unauthenticated ? Response.json({ error: "Not authenticated." }, { status: 401, headers: { Vary: "Accept" } }) : null,
    }; },
    requirePortalResource: async (_access, resource) => { authCalls.push(resource); assert.equal(resource, "admin.projects.tracker"); return denied ? Response.json({ error: "Resource denied." }, { status: 403 }) : null; },
  });
  vm.runInContext(apiSource.replace(/^import[^\n]*\n/gm, "").replace(/^export /gm, ""), context);
  const response = await context.GET(new Request(`https://offline.fixture.test/api/admin/project-tracker-role-costs${query}`, { headers: { Authorization: "Bearer fixture-token" } }));
  equal(response.headers.get("cache-control"), "private, no-store");
  assert(response.headers.get("vary").split(",").some((value) => value.trim().toLowerCase() === "authorization"));
  apiScenarios += 1;
  return { response, body: await response.json(), calls: admin.calls, authCalls };
}
for (const [options, expected] of [[{ staff: true }, 403], [{ unauthenticated: true }, 401], [{ denied: true }, 403]]) {
  const result = await runApi(options);
  equal(result.response.status, expected);
  equal(result.calls.length, 0, "No financial reads before successful authorization.");
  equal(result.body.overview, undefined);
  assert(!JSON.stringify(result.body).includes("rate_snapshot"));
}
equal((await runApi({ unauthenticated: true })).response.headers.get("vary"), "Accept, Authorization");
assert.deepEqual((await runApi({ staff: true })).authCalls, ["session"]);
assert.deepEqual((await runApi({ denied: true })).authCalls, ["session", "admin.projects.tracker"]);
for (const query of ["", "?projectId=bad", `?projectId=${P}&projectId=${P}`, `?projectId=${P}&mileageChargeRate=1`, `?projectId=${P}&extra=1`]) {
  const result = await runApi({ query }); equal(result.response.status, 400); equal(result.calls.length, 0);
}
for (const missing of [[], [{ ...project, deleted_at: "2026-11-24" }], [{ ...project, status: "archived" }]]) {
  const result = await runApi({ tables: { ...fixtureTables(), projects: missing } }); equal(result.response.status, 404); equal(result.calls.length, 1);
}
let result = await runApi();
equal(result.response.status, 200);
equal(result.body.overview.current.hours, 6.5);
equal(result.body.overview.current.labourTotals.chargeOutSpend, 1035);
equal(result.body.overview.historical.labourTotals.chargeOutSpend, 440);
equal(result.body.overview.current.labourTotals.internalSpend, 494.5);
equal(result.body.overview.current.rows[0].currentChargeRate, 250);
equal(result.body.overview.mileage.configured, false);
for (const sensitive of ["charge_rate_snapshot", "mileage_charge_rate_snapshot", "custom_data", SENIOR, MANAGER, "confirmed_by"]) assert(!JSON.stringify(result.body).includes(`"${sensitive}"`), "API returns aggregate fields, never raw metadata/identity.");
equal(result.body.overview.mileage.internalRate, 0.9);
equal(result.body.overview.current.totals.internalSpend, 512.5);
equal(result.body.overview.current.rows[3].chargeOutSpend, 0);
equal(result.body.overview.current.referenceOnlyKilometres, 20);
assert(result.calls.every((call) => !["project_activities", "project_role_rates"].includes(call.table)), "No Activity hours or company suggestions.");
assert(result.calls.every((call) => call.columns !== "*"), "Narrow projections only.");
for (const call of result.calls.filter((item) => !["projects", "project_charge_rates"].includes(item.table))) {
  assert.deepEqual(call.range, [0, 999]);
  equal(call.order[0], "id");
  assert(call.filters.some(([type, key, value]) => type === "eq" && key === "project_id" && value === P));
}
for (const table of ["projects", "project_tracker_entries", "project_budget_sources", "project_budget_allocations", "project_allocations", "project_charge_rates"]) {
  const failed = await runApi({ errors: { [table]: true } }); equal(failed.response.status, 500); assert(!JSON.stringify(failed.body).includes("Private")); equal(failed.body.overview, undefined);
}
equal((await runApi({ authThrows: true })).response.status, 500);
result = await runApi({ tables: { ...fixtureTables(), project_charge_rates: [{ ...fixtureTables().project_charge_rates[0], confirmed_at: null }] } });
equal(result.body.overview.chargeRatesConfirmed, false);
equal(result.body.overview.current.rows[1].currentChargeRate, null);
equal(result.body.overview.current.labourTotals.chargeOutSpend, 1035);
result = await runApi({ tables: fixtureTables([explicit(60, STAFF, 1, 0)]) });
equal(result.response.status, 500);
result = await runApi({ tables: fixtureTables(pricedInputs) });
equal(result.response.status, 200);
equal(result.body.overview.current.rows[3].chargeOutSpend, 30.75);
equal(result.body.overview.current.totals.chargeOutSpend, 1065.75);
equal(result.body.overview.current.totals.internalSpend, 512.5);
equal(result.body.overview.current.referenceOnlyKilometres, 0);
assert(!JSON.stringify(result.body).includes('"mileage_charge_rate_snapshot"'));
result = await runApi({ tables: fixtureTables([explicit(62, STAFF, 0, 180, { custom_data: { budget_assignment: "unassigned", charge_rate_stamped: true, charge_role: "Ecologist", charge_rate_snapshot: 180, km: 5, mileage_charge_stamped: true, mileage_charge_rate_snapshot: 0 } })]) });
equal(result.response.status, 200);
equal(result.body.overview.current.totals.chargeOutSpend, 0);
equal(result.body.overview.current.totals.internalSpend, 4.5);
equal(result.body.overview.current.totals.profit, -4.5);
equal(result.body.overview.current.totals.profitMarginPercent, null);
equal(result.body.overview.current.referenceOnlyKilometres, 0);
result = await runApi({ tables: fixtureTables([entry(63, STAFF, 1, 180, { custom_data: { km: 5, mileage_charge_stamped: true, mileage_charge_rate_snapshot: "1.5" } })]) });
equal(result.response.status, 500);
const many = Array.from({ length: 2005 }, (_, index) => index % 2 ? explicit(1000 + index, STAFF, 0.25, 180) : entry(1000 + index, STAFF, 0.25, 180));
result = await runApi({ tables: fixtureTables([...many, entry(9999, STAFF, 100, 999, { project_id: uuid(99) })]) });
equal(result.response.status, 200);
equal(result.body.overview.current.entryCount, 2005);
equal(result.body.overview.current.hours, 2005 * 0.25);
equal(result.body.overview.current.labourTotals.chargeOutSpend, 2005 * 0.25 * 180);
equal(result.body.overview.current.labourTotals.internalSpend, 2005 * 0.25 * 75);
equal(result.body.overview.current.unassignedEntryCount, 1002);
assert.deepEqual(result.calls.filter((call) => call.table === "project_tracker_entries").map((call) => call.range), [[0, 999], [1000, 1999], [2000, 2999]]);
// All supporting collections are complete too, not just actual entry history.
const manyTables = fixtureTables([entry(61)]);
manyTables.project_budget_sources = Array.from({ length: 1001 }, (_, index) => ({ ...source, id: index === 1000 ? S : uuid(20000 + index) }));
manyTables.project_budget_allocations = Array.from({ length: 1001 }, (_, index) => ({ ...allocation, id: index === 1000 ? A : uuid(30000 + index), hours_consumed: index === 1000 ? 1 : 0, charge_out_spend: index === 1000 ? 180 : 0 }));
manyTables.project_allocations = Array.from({ length: 1001 }, (_, index) => ({ id: uuid(40000 + index), project_id: P, staff_user_id: index === 1000 ? STAFF : uuid(50000 + index), hourly_rate: 125 }));
result = await runApi({ tables: manyTables });
equal(result.response.status, 200);
for (const table of ["project_budget_sources", "project_budget_allocations", "project_allocations"]) equal(result.calls.filter((call) => call.table === table).length, 2);

// Compile and render the actual JSX with an installed Next SWC compiler.
const require = createRequire(import.meta.url);
const swc = require("next/dist/build/swc");
const compiled = await swc.transform(componentSource, {
  filename: "ProjectRoleCostOverview.js", jsc: { parser: { syntax: "ecmascript", jsx: true }, target: "es2022", transform: { react: { runtime: "classic", pragma: "createElement" } } }, module: { type: "es6" },
});
const code = compiled.code.replace(/^import[^\n]*\n/gm, "").replace("export default function", "function") + "\nthis.Component = ProjectRoleCostOverview;";
const settle = () => new Promise((resolve) => setImmediate(resolve));
function uiHarness(initialProps) {
  let props = initialProps, cursor = 0, effects = [], tree;
  const slots = [], requests = [];
  const context = vm.createContext({ AbortController, React: { Fragment: "fragment" },
    createElement: (type, attributes, ...children) => ({ type, props: { ...attributes, children } }),
    useState(initial) { const position = cursor++; if (!slots[position]) slots[position] = { value: typeof initial === "function" ? initial() : initial }; return [slots[position].value, (next) => { slots[position].value = typeof next === "function" ? next(slots[position].value) : next; }]; },
    useRef(initial) { const position = cursor++; if (!slots[position]) slots[position] = { current: initial }; return slots[position]; },
    useEffect(callback, dependencies) { const position = cursor++, previous = slots[position]; if (!previous || dependencies.some((value, index) => value !== previous.dependencies[index])) effects.push(() => { previous?.cleanup?.(); slots[position] = { dependencies, cleanup: callback() }; }); },
    fetch(url, init) { return new Promise((resolve, reject) => requests.push({ url, init, respond: (body, status = 200) => resolve(Response.json(body, { status })), fail: reject })); },
  });
  vm.runInContext(code, context);
  const render = (nextProps = props) => { props = nextProps; cursor = 0; tree = context.Component(props); const pending = effects; effects = []; pending.forEach((effect) => effect()); return tree; };
  const nodes = (type) => { const found = []; const walk = (node) => { if (Array.isArray(node)) return node.forEach(walk); if (!node || typeof node !== "object") return; if (node.type === type) found.push(node); walk(node.props.children); }; walk(tree); return found; };
  const text = () => { const collect = (node) => Array.isArray(node) ? node.map(collect).join(" ") : node && typeof node === "object" ? node.type === "style" ? "" : collect(node.props.children) : typeof node === "string" || typeof node === "number" ? String(node) : ""; return collect(tree).replace(/\s+/g, " "); };
  render();
  return { render, nodes, text, requests };
}
const props = { session: { access_token: "fixture-token" }, projectId: P, projectName: project.name, isAdmin: true };
const payload = { projectId: P, projectName: project.name, overview: build(inputs) };
let ui = uiHarness({ ...props, isAdmin: false });
equal(ui.requests.length, 0); equal(ui.nodes("table").length, 0); equal(ui.text(), "");
ui = uiHarness({ ...props, isAdmin: undefined }); equal(ui.requests.length, 0);
ui = uiHarness({ ...props, projectId: null }); assert.match(ui.text(), /Select a project/); equal(ui.requests.length, 0);
ui = uiHarness({ ...props, session: null }); assert.match(ui.text(), /Sign in again/); equal(ui.requests.length, 0);
let refreshCalls = 0;
ui = uiHarness({ ...props, onRefresh: () => { refreshCalls += 1; } });
assert.match(ui.text(), /Loading complete recorded actuals/);
equal(ui.requests.length, 1);
equal(ui.requests[0].init.method, "GET"); equal(ui.requests[0].init.cache, "no-store"); equal(ui.requests[0].init.headers.Authorization, "Bearer fixture-token");
ui.requests[0].respond(payload); await settle(); ui.render();
equal(ui.nodes("table").length, 1); equal(ui.nodes("thead").length, 1); equal(ui.nodes("tfoot").length, 1); equal(ui.nodes("caption").length, 1);
equal(ui.nodes("th").filter((node) => node.props.scope === "col").length, 8);
for (const label of ["Senior Ecologist", "Ecologist", "Project Manager", "Mileage", "Labour and mileage", "Historical reference-only mileage", "Not configured", "Current confirmed card rates differ", "Applied effective", "$81.00/h", "$75.00/h", "$70.00/h", "$0.90/km"]) assert(ui.text().includes(label), `Rendered output includes ${label}.`);
equal(ui.nodes("label")[0].props.htmlFor, ui.nodes("select")[0].props.id);
equal(ui.nodes("option").length, 4);
const region = ui.nodes("div").find((node) => node.props.role === "region"); equal(region.props.tabIndex, 0);
ui.nodes("select")[0].props.onChange({ target: { value: "historical" } }); ui.render(); assert.match(ui.text(), /Known allocations outside current accepted funding/); assert.match(ui.text(), /4 h/);
ui.nodes("select")[0].props.onChange({ target: { value: "lifetime" } }); ui.render(); assert.match(ui.text(), /Not a current budget comparison/); assert.match(ui.text(), /11.5 h/);
ui.nodes("button")[0].props.onClick(); ui.render(); equal(refreshCalls, 1); equal(ui.requests.length, 2); equal(ui.requests[0].init.signal.aborted, true);
ui.requests[1].respond({ error: "Fixture read denied" }, 403); await settle(); ui.render(); assert.match(ui.text(), /Fixture read denied/); equal(ui.nodes("table").length, 0); equal(ui.nodes("p").filter((node) => node.props.role === "alert").length, 1);
ui.nodes("button")[0].props.onClick(); ui.render(); ui.requests[2].respond(payload); await settle(); ui.render(); equal(ui.nodes("table").length, 1);
ui.render({ ...props, refreshKey: 1 }); equal(ui.requests.length, 4);
ui.requests[3].respond({ ...payload, overview: build([]) }); await settle(); ui.render(); assert.match(ui.text(), /No recorded actuals/); assert(ui.text().includes("—"));
ui = uiHarness(props); ui.requests[0].respond({ ...payload, overview: discrepant }); await settle(); ui.render(); assert.match(ui.text(), /Stored allocation summaries differ/);
ui = uiHarness(props); ui.requests[0].respond({ ...payload, overview: build(inputs, { ratesByProject: new Map() }) }); await settle(); ui.render(); assert.match(ui.text(), /No confirmed project labour rate card/); assert.match(ui.text(), /Not confirmed/);
ui = uiHarness(props); ui.requests[0].respond({ ...payload, overview: mileageConfigured }); await settle(); ui.render(); assert.match(ui.text(), /\$2.00\/km/); assert.match(ui.text(), /\$30.75/); assert(!ui.text().includes("Historical reference-only mileage"));
ui = uiHarness(props); ui.requests[0].respond({ ...payload, overview: unknownInternal }); await settle(); ui.render(); assert.match(ui.text(), /Labour-only pending mileage internal rate/);
ui = uiHarness(props); ui.requests[0].fail(new Error("Fixture network failure")); await settle(); ui.render(); assert.match(ui.text(), /Fixture network failure/);
ui = uiHarness(props); ui.requests[0].respond({ ...payload, projectId: uuid(99) }); await settle(); ui.render(); assert.match(ui.text(), /could not be verified/); equal(ui.nodes("table").length, 0);
// Late responses from another job/token/admin scope must never render balances.
ui = uiHarness(props);
const otherProps = { ...props, projectId: uuid(99), projectName: "Other fixture" };
ui.render(otherProps); equal(ui.requests[0].init.signal.aborted, true);
const otherPayload = { projectId: uuid(99), overview: role.summarizeTrackerRoleCosts({ projectId: uuid(99) }) };
ui.requests[1].respond(otherPayload); await settle(); ui.render();
ui.requests[0].respond(payload); await settle(); ui.render(); assert(!ui.text().includes("Current confirmed card rates differ")); assert.match(ui.text(), /No recorded actuals/);
ui = uiHarness(props); ui.requests[0].respond(payload); await settle(); ui.render();
ui.render({ ...props, session: { access_token: "changed-token" } }); equal(ui.nodes("table").length, 0); equal(ui.requests.length, 2);
ui.render({ ...props, isAdmin: false }); equal(ui.nodes("table").length, 0); equal(ui.requests[1].init.signal.aborted, true);
ui.requests[1].respond(payload); await settle(); ui.render(); equal(ui.text(), "");
assert(!componentSource.includes("localStorage"), "Financial values are not cached in browser storage.");
assert.match(componentSource, /@media\(max-width:640px\)/);
assert.match(componentSource, /focus-visible/);
assert.match(componentSource, /overflow-x:auto/);
assert.doesNotMatch(apiSource, /\.update\(|\.insert\(|\.delete\(|\.rpc\(/, "Read-only endpoint, no persistence.");

console.log(`Role Cost Overview PASS: ${assertions} counted assertions, ${apiScenarios} mocked API scenarios plus validation assertions. Fixed 81/75/70 hourly and 0.90/km internal rates; account-policy grouping; mixed assigned/both-null unassigned counted once; trusted labour/mileage snapshots vs changed card; unchanged legacy fallback; old mileage reference-only zero charge (no retropricing), explicit zero non-billable snapshot; km/legacy kilometres; optional missing internal policy excludes mileage from totals; zero/null and weighted margins; raw sums; active/closed/other/lifetime funding; cache reconciliation; no planned Activity hours; 2,005 entries and >1,000 supporting rows paginated; staff/resource/auth denial and metadata privacy; sanitized failures and private no-store Authorization Vary. Actual SWC-rendered JSX: accessible eight-column table, loading/error/empty/refresh states, history selector, reference-mileage footnote, card differences, session/project/admin stale-response suppression and responsive local styling. No live services or writes.`);
