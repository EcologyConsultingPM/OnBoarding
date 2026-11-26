import { trackerChargeRole, trackerEntryChargeRate } from "./projectTrackerChargeRates";
import { isTrackerUnassignedEntry } from "./projectTrackerUnassignedActuals";

export const TRACKER_LABOUR_ROLES = Object.freeze(["Senior Ecologist", "Ecologist", "Project Manager"]);
export const TRACKER_INTERNAL_HOURLY_RATES = Object.freeze({ "Senior Ecologist": 81, Ecologist: 75, "Project Manager": 70 });
export const TRACKER_INTERNAL_MILEAGE_RATE = 0.90;

function nonNegative(value, description) {
  const number = typeof value === "number" || typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;
  if (!Number.isFinite(number) || number < 0) throw new Error(`Invalid ${description}.`);
  return number;
}
function optionalRate(value, description) {
  return value === null || value === undefined ? null : nonNegative(value, description);
}
function finiteTotals(values) {
  if (!values.every(Number.isFinite)) throw new Error("Invalid tracker cost totals.");
}

export function trackerInternalHourlyRate(staffUserId) {
  return TRACKER_INTERNAL_HOURLY_RATES[trackerChargeRole(staffUserId)];
}
export function trackerEntryLabourInternalCost(entry) {
  return nonNegative(entry?.hours, "tracker entry hours") * trackerInternalHourlyRate(entry?.staff_user_id);
}
export function trackerEntryKilometres(entry) {
  const value = entry?.custom_data?.km ?? entry?.custom_data?.kilometres;
  return value === null || value === undefined || typeof value === "string" && value.trim() === ""
    ? 0 : nonNegative(value, "tracker entry kilometres");
}
export function trackerEntryMileageInternalCost(entry, mileageInternalRate = TRACKER_INTERNAL_MILEAGE_RATE) {
  const total = trackerEntryKilometres(entry) * nonNegative(mileageInternalRate, "mileage internal rate");
  finiteTotals([total]);
  return total;
}
// This is the TOTAL internal cost. Use trackerEntryLabourInternalCost if the
// caller needs hours-only. Fixed current costing policy, not charge * 60% and
// not historical internal snapshots: 81/75/70 per hour plus 0.90 per recorded km.
export function trackerEntryInternalCost(entry, { includeMileage = true, mileageInternalRate = TRACKER_INTERNAL_MILEAGE_RATE } = {}) {
  const total = trackerEntryLabourInternalCost(entry) + (includeMileage ? trackerEntryMileageInternalCost(entry, mileageInternalRate) : 0);
  finiteTotals([total]);
  return total;
}
// Raw sums; round only at persistence/display boundaries, never per row.
export function sumTrackerInternalCosts(entries = [], options = {}) {
  const total = entries.reduce((sum, entry) => sum + trackerEntryInternalCost(entry, options), 0);
  finiteTotals([total]);
  return total;
}
export function trackerProfitMargin(chargeOutSpend, internalSpend) {
  return chargeOutSpend === 0 ? null : ((chargeOutSpend - internalSpend) / chargeOutSpend) * 100;
}

// Database-read metadata only. Unstamped OLD mileage has known zero charge
// under the prior reference-only policy. Never consult today's mileage card.
// A trusted, explicit zero snapshot means non-billable, not missing policy.
export function trackerEntryMileageChargeRate(entry) {
  const metadata = entry?.custom_data;
  if (metadata?.mileage_charge_stamped !== true) return 0;
  const snapshot = metadata.mileage_charge_rate_snapshot;
  if (typeof snapshot !== "number" || !Number.isFinite(snapshot) || snapshot < 0) {
    throw new Error("Invalid trusted tracker mileage charge rate snapshot.");
  }
  return snapshot;
}
export function trackerEntryMileageChargeOutSpend(entry) {
  const spend = trackerEntryKilometres(entry) * trackerEntryMileageChargeRate(entry);
  finiteTotals([spend]);
  return spend;
}

// Existing snapshot helper is the sole labour history authority. Current cards
// are display metadata; unstamped labour retains staffRate || projectDefault.
export function trackerRoleEntryActuals(entry, {
  ratesByProject = null, legacyRateByStaff = new Map(), defaultHourlyRate = 0,
  mileageInternalRate = TRACKER_INTERNAL_MILEAGE_RATE,
} = {}) {
  const role = trackerChargeRole(entry?.staff_user_id);
  const hours = nonNegative(entry?.hours, "tracker entry hours");
  if (isTrackerUnassignedEntry(entry) && (entry.custom_data.charge_rate_stamped !== true || entry.custom_data.charge_role !== role)) {
    throw new Error("Unassigned tracker entry is missing its trusted charge snapshot.");
  }
  const legacyRate = Number(legacyRateByStaff?.get(entry?.staff_user_id)) || Number(defaultHourlyRate) || 0;
  const appliedChargeRate = trackerEntryChargeRate(entry, ratesByProject, legacyRate);
  const internalRate = trackerInternalHourlyRate(entry?.staff_user_id);
  const chargeOutSpend = hours * appliedChargeRate;
  const internalSpend = hours * internalRate;
  const kilometres = trackerEntryKilometres(entry);
  const mileageChargeRate = trackerEntryMileageChargeRate(entry);
  const mileageRate = optionalRate(mileageInternalRate, "mileage internal rate");
  const mileageChargeOutSpend = kilometres * mileageChargeRate;
  const mileageInternalSpend = mileageRate === null ? null : kilometres * mileageRate;
  finiteTotals([chargeOutSpend, internalSpend, mileageChargeOutSpend, ...(mileageInternalSpend === null ? [] : [mileageInternalSpend])]);
  return { role, hours, kilometres, appliedChargeRate, internalRate, chargeOutSpend, internalSpend,
    profit: chargeOutSpend - internalSpend, profitMarginPercent: trackerProfitMargin(chargeOutSpend, internalSpend),
    snapshotApplied: entry?.custom_data?.charge_rate_stamped === true && entry.custom_data.charge_role === role,
    mileageChargeRate, mileageChargeOutSpend, mileageInternalSpend,
    mileageSnapshotApplied: entry?.custom_data?.mileage_charge_stamped === true,
    mileageReferenceOnly: kilometres > 0 && entry?.custom_data?.mileage_charge_stamped !== true };
}

// Hours-only totals for consumers that explicitly do NOT want mileage. Does not
// filter assignment or deduplicate: pass the caller's authoritative entry set.
export function summarizeTrackerLabourActuals(entries = [], options = {}) {
  let hours = 0, chargeOutSpend = 0, internalCost = 0;
  for (const entry of entries) {
    const actual = trackerRoleEntryActuals(entry, options);
    hours += actual.hours; chargeOutSpend += actual.chargeOutSpend; internalCost += actual.internalSpend;
  }
  finiteTotals([hours, chargeOutSpend, internalCost]);
  return { count: entries.length, hours, chargeOutSpend, internalCost, profit: chargeOutSpend - internalCost,
    profitMarginPercent: trackerProfitMargin(chargeOutSpend, internalCost) };
}
// Total actuals for allocation recalculation / project summaries: labour plus
// trusted mileage revenue (old reference-only mileage = zero), fixed km cost.
export function summarizeTrackerActuals(entries = [], options = {}) {
  let hours = 0, kilometres = 0, labourChargeOutSpend = 0, mileageChargeOutSpend = 0, labourInternalCost = 0, mileageInternalCost = 0;
  let referenceOnlyKilometres = 0;
  for (const entry of entries) {
    const actual = trackerRoleEntryActuals(entry, options);
    if (actual.mileageInternalSpend === null) throw new Error("A mileage internal rate is required for total tracker actuals.");
    hours += actual.hours; kilometres += actual.kilometres;
    labourChargeOutSpend += actual.chargeOutSpend; mileageChargeOutSpend += actual.mileageChargeOutSpend;
    labourInternalCost += actual.internalSpend; mileageInternalCost += actual.mileageInternalSpend;
    if (actual.mileageReferenceOnly) referenceOnlyKilometres += actual.kilometres;
  }
  const chargeOutSpend = labourChargeOutSpend + mileageChargeOutSpend;
  const internalCost = labourInternalCost + mileageInternalCost;
  finiteTotals([hours, kilometres, chargeOutSpend, internalCost]);
  return { count: entries.length, hours, kilometres, labourChargeOutSpend, mileageChargeOutSpend,
    labourInternalCost, mileageInternalCost, chargeOutSpend, internalCost, referenceOnlyKilometres,
    profit: chargeOutSpend - internalCost, profitMarginPercent: trackerProfitMargin(chargeOutSpend, internalCost) };
}

// Deliberately matches admin accepted scope: approved original/variation source
// and active allocation. No month/date filter or invented legacy funding.
export function trackerCurrentFundedAllocationIds(sources = [], allocations = [], projectId) {
  const sourceIds = new Set(sources.filter((source) => (!projectId || source.project_id === projectId) &&
    String(source.approval_status || "draft").toLowerCase() === "approved" && ["original", "variation"].includes(source.source_type)).map((source) => source.id));
  return new Set(allocations.filter((allocation) => (!projectId || allocation.project_id === projectId) &&
    allocation.status === "active" && sourceIds.has(allocation.budget_source_id)).map((allocation) => allocation.id));
}
function newScope(currentRates, mileageChargeRate, mileageInternalRate) {
  return { entryCount: 0, assignedEntryCount: 0, unassignedEntryCount: 0, hours: 0, kilometres: 0,
    referenceOnlyKilometres: 0, referenceOnlyMileageEntryCount: 0,
    rows: [...TRACKER_LABOUR_ROLES.map((role) => ({ role, unit: "h", quantity: 0,
      currentChargeRate: currentRates?.get(role) ?? null, internalRate: TRACKER_INTERNAL_HOURLY_RATES[role] })),
      { role: "Mileage", unit: "km", quantity: 0, currentChargeRate: mileageChargeRate, internalRate: mileageInternalRate }]
      .map((row) => ({ ...row, chargeOutSpend: 0, internalSpend: row.internalRate === null ? null : 0,
        snapshotEntryCount: 0, legacyEntryCount: 0, historicalRatesDiffer: false, appliedChargeRateMin: null, appliedChargeRateMax: null })),
  };
}
function addRow(row, quantity, chargeOutSpend, internalSpend, appliedRate, stamped) {
  row.quantity += quantity; row.chargeOutSpend += chargeOutSpend;
  if (row.internalSpend !== null) row.internalSpend += internalSpend;
  row[stamped ? "snapshotEntryCount" : "legacyEntryCount"] += 1;
  if (quantity > 0) {
    row.appliedChargeRateMin = row.appliedChargeRateMin === null ? appliedRate : Math.min(row.appliedChargeRateMin, appliedRate);
    row.appliedChargeRateMax = row.appliedChargeRateMax === null ? appliedRate : Math.max(row.appliedChargeRateMax, appliedRate);
    if (row.currentChargeRate !== null && Math.abs(row.currentChargeRate - appliedRate) > 1e-9) row.historicalRatesDiffer = true;
  }
}
function addActual(scope, actual, assignment) {
  scope.entryCount += 1;
  scope.assignedEntryCount += assignment === "assigned" ? 1 : 0;
  scope.unassignedEntryCount += assignment === "unassigned" ? 1 : 0;
  scope.hours += actual.hours; scope.kilometres += actual.kilometres;
  addRow(scope.rows.find((row) => row.role === actual.role), actual.hours, actual.chargeOutSpend, actual.internalSpend, actual.appliedChargeRate, actual.snapshotApplied);
  addRow(scope.rows[3], actual.kilometres, actual.mileageChargeOutSpend, actual.mileageInternalSpend, actual.mileageChargeRate, actual.mileageSnapshotApplied);
  if (actual.mileageReferenceOnly) { scope.referenceOnlyKilometres += actual.kilometres; scope.referenceOnlyMileageEntryCount += 1; }
}
function finishScope(scope) {
  let labourCharge = 0, labourInternal = 0;
  for (const row of scope.rows) {
    row.profit = row.internalSpend === null ? null : row.chargeOutSpend - row.internalSpend;
    row.profitMarginPercent = row.internalSpend === null ? null : trackerProfitMargin(row.chargeOutSpend, row.internalSpend);
    row.appliedEffectiveChargeRate = row.quantity > 0 ? row.chargeOutSpend / row.quantity : null;
    if (row.unit === "h") { labourCharge += row.chargeOutSpend; labourInternal += row.internalSpend; }
  }
  scope.labourTotals = { hours: scope.hours, chargeOutSpend: labourCharge, internalSpend: labourInternal,
    profit: labourCharge - labourInternal, profitMarginPercent: trackerProfitMargin(labourCharge, labourInternal) };
  const mileage = scope.rows[3];
  const mileageIncluded = mileage.internalRate !== null;
  const chargeOutSpend = labourCharge + (mileageIncluded ? mileage.chargeOutSpend : 0);
  const internalSpend = labourInternal + (mileageIncluded ? mileage.internalSpend : 0);
  scope.totals = { hours: scope.hours, kilometres: scope.kilometres, chargeOutSpend, internalSpend,
    profit: chargeOutSpend - internalSpend, profitMarginPercent: trackerProfitMargin(chargeOutSpend, internalSpend),
    marginScope: mileageIncluded ? "Labour and mileage" : "Labour-only pending mileage internal rate", mileageIncluded };
  finiteTotals([scope.hours, scope.kilometres, chargeOutSpend, internalSpend, scope.totals.profit]);
  return scope;
}
function reconcile(allocations, scope, unassigned) {
  const storedHours = allocations.reduce((sum, row) => sum + (Number(row.hours_consumed) || 0), 0);
  const storedChargeOutSpend = allocations.reduce((sum, row) => sum + (Number(row.charge_out_spend) || 0), 0);
  const recordedAssignedHours = scope.hours - unassigned.hours;
  const recordedAssignedChargeOutSpend = scope.totals.chargeOutSpend - unassigned.totals.chargeOutSpend;
  return { storedHours, storedChargeOutSpend, recordedAssignedHours, recordedAssignedChargeOutSpend,
    hoursDifference: recordedAssignedHours - storedHours, chargeOutSpendDifference: recordedAssignedChargeOutSpend - storedChargeOutSpend,
    differs: Math.abs(recordedAssignedHours - storedHours) >= 0.005 || Math.abs(recordedAssignedChargeOutSpend - storedChargeOutSpend) >= 0.005 };
}

// Pure read-only aggregate. Optional mileageChargeRate is CURRENT DISPLAY ONLY;
// changing it NEVER prices old entries. Mileage revenue always uses the trusted
// per-entry snapshot helper. Fixed 0.90/km internal applies to all recorded km.
export function summarizeTrackerRoleCosts({ projectId, entries = [], sources = [], allocations = [],
  ratesByProject = null, legacyRateByStaff = new Map(), defaultHourlyRate = 0,
  mileageChargeRate, mileageInternalRate = TRACKER_INTERNAL_MILEAGE_RATE,
} = {}) {
  const currentRates = ratesByProject?.get(projectId);
  const mileageCharge = optionalRate(mileageChargeRate === undefined ? currentRates?.get("Mileage") : mileageChargeRate, "current mileage charge-out rate");
  const mileageInternal = optionalRate(mileageInternalRate, "mileage internal rate");
  if (currentRates) for (const role of TRACKER_LABOUR_ROLES) {
    if (nonNegative(currentRates.get(role), "confirmed project charge rate") <= 0) throw new Error("Invalid confirmed project charge rate.");
  }
  const projectAllocations = allocations.filter((row) => !projectId || row.project_id === projectId);
  const allocationsById = new Map(projectAllocations.map((row) => [row.id, row]));
  const currentIds = trackerCurrentFundedAllocationIds(sources, projectAllocations, projectId);
  const makeScope = () => newScope(currentRates, mileageCharge, mileageInternal);
  const scopes = Object.fromEntries(["current", "historical", "otherHistory", "unassigned", "lifetime"].map((key) => [key, makeScope()]));
  const seen = new Set();
  let duplicateEntryCount = 0;
  for (const entry of entries) {
    if (projectId && entry.project_id !== projectId) continue;
    if (entry.id && seen.has(entry.id)) { duplicateEntryCount += 1; continue; }
    if (entry.id) seen.add(entry.id);
    const actual = trackerRoleEntryActuals(entry, { ratesByProject, legacyRateByStaff, defaultHourlyRate, mileageInternalRate: mileageInternal });
    const unassigned = isTrackerUnassignedEntry(entry);
    const allocation = allocationsById.get(entry.budget_allocation_id);
    const assignment = unassigned ? "unassigned" : allocation ? "assigned" : "other";
    // Known allocation identity is authoritative like existing recalculation.
    const scopeKey = unassigned || allocation && currentIds.has(allocation.id) ? "current" : allocation ? "historical" : "otherHistory";
    addActual(scopes[scopeKey], actual, assignment); addActual(scopes.lifetime, actual, assignment);
    if (unassigned) addActual(scopes.unassigned, actual, assignment);
  }
  for (const scope of Object.values(scopes)) finishScope(scope);
  const allocationReconciliation = {
    current: reconcile(projectAllocations.filter((row) => currentIds.has(row.id)), scopes.current, scopes.unassigned),
    historical: reconcile(projectAllocations.filter((row) => !currentIds.has(row.id)), scopes.historical, finishScope(makeScope())),
  };
  return { projectId: projectId || null, currency: "AUD", chargeRatesConfirmed: Boolean(currentRates),
    mileage: { chargeRate: mileageCharge, internalRate: mileageInternal, configured: mileageCharge !== null && mileageInternal !== null,
      chargeRateConfigured: mileageCharge !== null, internalRateConfigured: mileageInternal !== null },
    ...scopes, duplicateEntryCount, allocationReconciliation,
    basis: {
      current: "Active allocations on approved original/variation sources plus explicit both-null unassigned actuals, counted once.",
      historical: "Known allocations outside current accepted funding; excluded from current funded figures.",
      otherHistory: "Legacy, orphan or partially assigned entries without a known allocation; lifetime only, not current funded figures.",
      lifetime: "All recorded project entries, including other history. Not a current budget comparison.",
      labour: "Recorded hours only; trusted historical snapshots or unchanged legacy staff/default fallback. Fixed internal hourly rates, not a percentage of charge-out.",
      mileage: "custom_data.km or legacy custom_data.kilometres. Trusted mileage snapshots only; old unstamped kilometres are reference-only zero revenue. Fixed current internal cost applies to all recorded km.",
      profit: "Recorded charge-out spend minus internal spend; weighted total margin, not accepted-budget forecast profit.",
    },
  };
}
