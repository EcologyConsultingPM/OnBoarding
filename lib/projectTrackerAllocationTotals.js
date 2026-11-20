import { loadTrackerChargeRates, trackerEntryChargeRate } from "./projectTrackerChargeRates";

const PAGE_SIZE = 1000;

export async function refreshProjectTrackerAllocation(access, projectId, allocationId) {
  const [ratesByProject, ratesResult, projectResult] = await Promise.all([
    loadTrackerChargeRates(access.admin, [projectId]),
    access.admin.from("project_allocations").select("staff_user_id, hourly_rate").eq("project_id", projectId),
    access.admin.from("projects").select("default_hourly_rate").eq("id", projectId).maybeSingle(),
  ]);
  if (ratesResult.error) throw new Error(ratesResult.error.message);
  if (projectResult.error) throw new Error(projectResult.error.message);
  if (!projectResult.data) throw new Error("Project not found for tracker allocation refresh.");
  const legacyRateByStaff = new Map((ratesResult.data || []).map((row) => [row.staff_user_id, Number(row.hourly_rate) || 0]));
  const defaultRate = Number(projectResult.data.default_hourly_rate) || 0;
  const entries = [];
  let offset = 0;
  while (true) {
    const { data, error } = await access.admin.from("project_tracker_entries")
      .select("project_id, hours, staff_user_id, custom_data")
      .eq("budget_allocation_id", allocationId)
      .eq("project_id", projectId)
      .order("id", { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    const page = data || [];
    entries.push(...page);
    if (page.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  let hoursConsumed = 0;
  let chargeOutSpend = 0;
  for (const entry of entries) {
    const hours = typeof entry.hours === "number" || typeof entry.hours === "string" ? Number(entry.hours) : NaN;
    if (!Number.isFinite(hours) || hours < 0) throw new Error("Invalid tracker entry hours; allocation totals were not updated.");
    const legacyRate = legacyRateByStaff.get(entry.staff_user_id) || defaultRate;
    hoursConsumed += hours;
    chargeOutSpend += hours * trackerEntryChargeRate(entry, ratesByProject, legacyRate);
  }
  if (!Number.isFinite(hoursConsumed) || !Number.isFinite(chargeOutSpend)) {
    throw new Error("Invalid tracker allocation totals; allocation totals were not updated.");
  }
  const roundedHours = Math.round(hoursConsumed * 100) / 100;
  const roundedSpend = Math.round(chargeOutSpend * 100) / 100;
  const { error: updateError } = await access.admin.from("project_budget_allocations").update({
    hours_consumed: roundedHours,
    charge_out_spend: roundedSpend,
    internal_cost: Math.round(roundedSpend * 0.6 * 100) / 100,
    updated_by: access.user.id,
    updated_at: new Date().toISOString(),
  }).eq("id", allocationId).eq("project_id", projectId);
  if (updateError) throw new Error(updateError.message);
  return { hoursConsumed: roundedHours, chargeOutSpend: roundedSpend };
}
