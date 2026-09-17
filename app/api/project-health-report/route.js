import { requireSession, serverError } from "../../../lib/serverAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Admin-only portfolio rollup. Finance is driven by real Project Tracker rows:
// remaining budget uses quote/charge-out rates, whereas estimated profitability
// uses the agreed delivery-cost basis of 60% of each person's quote rate.
export async function GET(request) {
  try {
    const access = await requireSession(request);
    if (access.error) return access.error;
    if (!access.isAdmin) return Response.json({ error: "Administrators only." }, { status: 403 });

    const [{ data: projects }, { data: activities }, { data: allocations }, { data: entries }, { data: sources }] = await Promise.all([
      access.admin.from("projects").select("id, name, client_name, status, budget_hours, budget_dollars, default_hourly_rate").is("deleted_at", null).neq("status", "archived"),
      access.admin.from("project_activities").select("project_id, status, budget_hours"),
      access.admin.from("project_allocations").select("project_id, staff_user_id, allocated_hours, hourly_rate, active"),
      access.admin.from("project_tracker_entries").select("project_id, staff_user_id, hours"),
      access.admin.from("project_budget_sources").select("project_id, source_type, approval_status, approved_value, approved_hours"),
    ]);

    const activitiesByProject = new Map();
    for (const a of activities || []) {
      if (!activitiesByProject.has(a.project_id)) activitiesByProject.set(a.project_id, []);
      activitiesByProject.get(a.project_id).push(a);
    }
    const allocByProject = new Map();
    for (const a of allocations || []) {
      if (!allocByProject.has(a.project_id)) allocByProject.set(a.project_id, []);
      allocByProject.get(a.project_id).push(a);
    }
    const entriesByProject = new Map();
    for (const entry of entries || []) {
      if (!entriesByProject.has(entry.project_id)) entriesByProject.set(entry.project_id, []);
      entriesByProject.get(entry.project_id).push(entry);
    }
    const sourcesByProject = new Map();
    for (const source of sources || []) {
      if (!sourcesByProject.has(source.project_id)) sourcesByProject.set(source.project_id, []);
      sourcesByProject.get(source.project_id).push(source);
    }

    const rows = (projects || []).map((p) => {
      const acts = activitiesByProject.get(p.id) || [];
      const total = acts.length;
      const completed = acts.filter((a) => a.status === "completed").length;
      const taskCompletion = total ? Math.round((completed / total) * 100) : 0;

      const alloc = allocByProject.get(p.id) || [];
      const liveEntries = entriesByProject.get(p.id) || [];
      const approvedSources = (sourcesByProject.get(p.id) || []).filter((source) => source.approval_status === "approved" && ["original", "variation"].includes(source.source_type));
      const budgetDollars = approvedSources.length ? approvedSources.reduce((sum, source) => sum + (Number(source.approved_value) || 0), 0) : (Number(p.budget_dollars) || 0);
      const budgetHours = approvedSources.length ? approvedSources.reduce((sum, source) => sum + (Number(source.approved_hours) || 0), 0) : (Number(p.budget_hours) || 0);
      const rateByStaff = new Map(alloc.filter((item) => item.active !== false).map((item) => [item.staff_user_id, Number(item.hourly_rate) || 0]));
      const fallbackRate = Number(p.default_hourly_rate) || 0;
      const usedHours = liveEntries.reduce((sum, entry) => sum + (Number(entry.hours) || 0), 0);
      const currentSpend = liveEntries.reduce((sum, entry) => sum + (Number(entry.hours) || 0) * (rateByStaff.get(entry.staff_user_id) ?? fallbackRate), 0);
      const deliveryCost = currentSpend * 0.6;
      const remainingHours = budgetHours ? budgetHours - usedHours : null;
      const remainingBudget = budgetDollars ? budgetDollars - currentSpend : null;
      const estimatedProfit = budgetDollars ? budgetDollars - deliveryCost : null;

      // At-risk heuristic: budget hours exceeded, or a paused activity present,
      // or spend over budget. Otherwise On Track. (Conservative, transparent.)
      const hasPaused = acts.some((a) => a.status === "paused_other" || a.status === "need_info");
      const overHours = budgetHours > 0 && usedHours > budgetHours;
      const overBudget = budgetDollars > 0 && currentSpend > budgetDollars;
      const health = overHours || overBudget || hasPaused ? "At Risk" : "On Track";

      return {
        id: p.id, client: p.client_name || "—", project: p.name,
        taskCompletion, activities: total, teamSize: alloc.length,
        currentSpend: Math.round(currentSpend * 100) / 100, deliveryCost: Math.round(deliveryCost * 100) / 100, estimatedProfit: estimatedProfit == null ? null : Math.round(estimatedProfit * 100) / 100, remainingHours,
        budgetHours, remainingBudget: remainingBudget != null ? Math.round(remainingBudget) : null,
        health,
      };
    });

    const active = rows.length;
    const atRisk = rows.filter((r) => r.health === "At Risk").length;
    const onTrack = active - atRisk;
    const avgCompletion = active ? Math.round(rows.reduce((s, r) => s + r.taskCompletion, 0) / active) : 0;

    return Response.json({
      summary: { active, onTrack, atRisk, avgCompletion },
      rows,
      costBasisPercent: 60,
    });
  } catch (error) {
    return serverError(error);
  }
}
