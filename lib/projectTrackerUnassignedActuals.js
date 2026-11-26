import { trackerChargeRole, trackerEntryChargeTotal, trackerEntryInternalCost } from "./projectTrackerChargeRates";

export const TRACKER_PAGE_SIZE = 1000;

// A null reference alone is not an explicit assignment choice. Never sweep
// legacy/orphan/partially allocated records into the new project-level subtotal.
export function isTrackerUnassignedEntry(entry) {
  return entry?.budget_source_id === null && entry?.budget_allocation_id === null &&
    entry?.custom_data?.budget_assignment === "unassigned";
}

function rounded(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function summarizeTrackerUnassignedActuals(entries = []) {
  let count = 0;
  let hours = 0;
  let spend = 0;
  let cost = 0;
  for (const entry of entries) {
    if (!isTrackerUnassignedEntry(entry)) continue;
    const amount = typeof entry.hours === "number" || typeof entry.hours === "string" ? Number(entry.hours) : NaN;
    if (!Number.isFinite(amount) || amount < 0) throw new Error("Invalid unassigned tracker hours.");
    // Explicit unassigned imports require trusted historical snapshots. Do not
    // consult today's card, a default/staff rate, or silently price bad data at 0.
    if (entry.custom_data.charge_rate_stamped !== true || entry.custom_data.charge_role !== trackerChargeRole(entry.staff_user_id)) {
      throw new Error("Unassigned tracker entry is missing its trusted charge snapshot.");
    }
    count += 1;
    hours += amount;
    spend += trackerEntryChargeTotal(entry, null);
    cost += trackerEntryInternalCost(entry);
  }
  if (!Number.isFinite(hours) || !Number.isFinite(spend) || !Number.isFinite(cost)) throw new Error("Invalid unassigned tracker actuals.");
  const chargeOutSpend = rounded(spend);
  return { count, hours: rounded(hours), chargeOutSpend, internalCost: rounded(cost) };
}

// Read-only view: preserve stored hours/charge-out and manual/historical costs
// when there are no attributable person entries. Never invent a staff role for
// an allocation-level manual total or persist a historical cost backfill.
export function trackerAllocationsWithDerivedInternalCosts(allocations = [], entries = []) {
  return allocations.map((allocation) => {
    const recorded = entries.filter((entry) => entry.budget_allocation_id === allocation.id && entry.project_id === allocation.project_id);
    return { ...allocation,
      internal_cost: recorded.length ? rounded(recorded.reduce((sum, entry) => sum + trackerEntryInternalCost(entry), 0)) : allocation.internal_cost,
      stored_internal_cost: allocation.internal_cost,
      internal_cost_basis: recorded.length ? "recorded_entries_fixed_role_and_mileage" : "legacy_stored_unattributed",
      recorded_entry_count: recorded.length,
    };
  });
}

// Deterministic, bounded pages rather than a history/UI limit or the server's
// default 1,000-row cap. Callers choose the narrow projection and authorization.
export async function loadTrackerEntryPages(buildQuery) {
  const rows = [];
  for (let offset = 0; ; offset += TRACKER_PAGE_SIZE) {
    const { data, error } = await buildQuery().order("id", { ascending: true })
      .range(offset, offset + TRACKER_PAGE_SIZE - 1);
    if (error) return { data: null, error };
    const page = data || [];
    rows.push(...page);
    if (page.length < TRACKER_PAGE_SIZE) return { data: rows, error: null };
  }
}

export async function loadTrackerUnassignedEntries(admin, projectIds = []) {
  const ids = [...new Set(projectIds.filter(Boolean))];
  const entries = [];
  for (let offset = 0; offset < ids.length; offset += 500) {
    const result = await loadTrackerEntryPages(() => admin.from("project_tracker_entries")
      .select("id, project_id, staff_user_id, budget_source_id, budget_allocation_id, hours, custom_data")
      .in("project_id", ids.slice(offset, offset + 500))
      .is("budget_source_id", null).is("budget_allocation_id", null)
      .eq("custom_data->>budget_assignment", "unassigned"));
    if (result.error) return result;
    entries.push(...result.data);
  }
  return { data: entries, error: null };
}
