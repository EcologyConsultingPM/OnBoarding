const PAGE_SIZE = 1000;

export async function refreshProjectTrackerAllocation(access, projectId, allocationId) {
  const entries = [];
  let offset = 0;
  while (true) {
    const { data, error } = await access.admin.from("project_tracker_entries")
      .select("hours, staff_user_id")
      .eq("budget_allocation_id", allocationId)
      .order("id", { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    const page = data || [];
    entries.push(...page);
    if (page.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  const [{ data: rates, error: ratesError }, { data: project, error: projectError }] = await Promise.all([
    access.admin.from("project_allocations").select("staff_user_id, hourly_rate").eq("project_id", projectId),
    access.admin.from("projects").select("default_hourly_rate").eq("id", projectId).maybeSingle(),
  ]);
  if (ratesError) throw new Error(ratesError.message);
  if (projectError) throw new Error(projectError.message);

  const rateByStaff = new Map((rates || []).map((row) => [row.staff_user_id, Number(row.hourly_rate) || 0]));
  const defaultRate = Number(project?.default_hourly_rate) || 0;
  const hoursConsumed = entries.reduce((sum, entry) => sum + Number(entry.hours || 0), 0);
  const chargeOutSpend = entries.reduce((sum, entry) => sum + Number(entry.hours || 0) * (rateByStaff.get(entry.staff_user_id) || defaultRate), 0);
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
