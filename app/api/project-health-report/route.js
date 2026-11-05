import { requireSession, serverError } from "../../../lib/serverAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function tableUnavailable(error) {
  const code = String(error?.code || "");
  const message = String(error?.message || "").toLowerCase();
  return code === "42P01" || code === "42703" || code === "PGRST205" || message.includes("does not exist") || message.includes("schema cache");
}

function number(value) {
  const result = Number(value);
  return Number.isFinite(result) ? result : 0;
}

function roundCurrency(value) {
  return Math.round((number(value) + Number.EPSILON) * 100) / 100;
}

// Admin-only portfolio rollup. Source-backed actuals use the same stored
// allocation totals as the admin tracker, never today's rates applied to old
// entries. Closed-source work is retained separately from current funding.
export async function GET(request) {
  try {
    const access = await requireSession(request);
    if (access.error) return access.error;
    if (!access.isAdmin) return Response.json({ error: "Administrators only." }, { status: 403 });

    const [projectsResult, activitiesResult, allocationsResult, entriesResult, sourcesResult, budgetAllocationsResult] = await Promise.all([
      access.admin.from("projects").select("id, name, client_name, status, budget_hours, budget_dollars, default_hourly_rate").is("deleted_at", null).neq("status", "archived"),
      access.admin.from("project_activities").select("project_id, status, budget_hours"),
      access.admin.from("project_allocations").select("project_id, staff_user_id, allocated_hours, hourly_rate, active"),
      access.admin.from("project_tracker_entries").select("project_id, staff_user_id, hours"),
      access.admin.from("project_budget_sources").select("id, project_id, source_type, approval_status, approved_value, approved_hours"),
      access.admin.from("project_budget_allocations").select("id, project_id, budget_source_id, status, hours_consumed, charge_out_spend, internal_cost"),
    ]);
    for (const result of [projectsResult, activitiesResult, allocationsResult, entriesResult]) {
      if (result.error) throw new Error(result.error.message);
    }
    if (sourcesResult.error && !tableUnavailable(sourcesResult.error)) throw new Error(sourcesResult.error.message);
    if (budgetAllocationsResult.error && !tableUnavailable(budgetAllocationsResult.error)) throw new Error(budgetAllocationsResult.error.message);
    const projects = projectsResult.data || [];
    const sources = sourcesResult.error ? [] : (sourcesResult.data || []);
    // Missing allocation data on a source-backed project is not a licence to
    // charge all legacy entries against its accepted scope or report zero spend.
    if (budgetAllocationsResult.error && sources.some((source) => projects.some((project) => project.id === source.project_id))) {
      throw new Error(budgetAllocationsResult.error.message);
    }
    const budgetAllocations = budgetAllocationsResult.error ? [] : (budgetAllocationsResult.data || []);

    const activitiesByProject = new Map();
    for (const a of activitiesResult.data || []) {
      if (!activitiesByProject.has(a.project_id)) activitiesByProject.set(a.project_id, []);
      activitiesByProject.get(a.project_id).push(a);
    }
    const allocByProject = new Map();
    for (const a of allocationsResult.data || []) {
      if (!allocByProject.has(a.project_id)) allocByProject.set(a.project_id, []);
      allocByProject.get(a.project_id).push(a);
    }
    const entriesByProject = new Map();
    for (const entry of entriesResult.data || []) {
      if (!entriesByProject.has(entry.project_id)) entriesByProject.set(entry.project_id, []);
      entriesByProject.get(entry.project_id).push(entry);
    }
    const sourcesByProject = new Map();
    for (const source of sources) {
      if (!sourcesByProject.has(source.project_id)) sourcesByProject.set(source.project_id, []);
      sourcesByProject.get(source.project_id).push(source);
    }
    const budgetAllocationsByProject = new Map();
    for (const allocation of budgetAllocations) {
      if (!budgetAllocationsByProject.has(allocation.project_id)) budgetAllocationsByProject.set(allocation.project_id, []);
      budgetAllocationsByProject.get(allocation.project_id).push(allocation);
    }

    const rows = projects.map((p) => {
      const acts = activitiesByProject.get(p.id) || [];
      const total = acts.length;
      const completed = acts.filter((a) => a.status === "completed").length;
      const taskCompletion = total ? Math.round((completed / total) * 100) : 0;

      const alloc = allocByProject.get(p.id) || [];
      const projectSources = sourcesByProject.get(p.id) || [];
      const approvedSources = projectSources.filter((source) => String(source.approval_status || "draft").toLowerCase() === "approved" && ["original", "variation"].includes(source.source_type));
      const approvedSourceIds = new Set(approvedSources.map((source) => source.id));
      // Only genuinely source-less legacy projects use register budgets/entry
      // rates. A project with closed sources and no approvals has no current
      // accepted funding, regardless of its cached project register budget.
      const legacyBudget = !projectSources.length;
      const budgetDollars = roundCurrency(legacyBudget ? number(p.budget_dollars) : approvedSources.reduce((sum, source) => sum + number(source.approved_value), 0));
      const budgetHours = legacyBudget ? number(p.budget_hours) : approvedSources.reduce((sum, source) => sum + number(source.approved_hours), 0);
      const projectBudgetAllocations = budgetAllocationsByProject.get(p.id) || [];
      const liveAllocations = projectBudgetAllocations.filter((allocation) => allocation.status === "active" && approvedSourceIds.has(allocation.budget_source_id));
      const historicalAllocations = projectBudgetAllocations.filter((allocation) => !(allocation.status === "active" && approvedSourceIds.has(allocation.budget_source_id)));
      const legacyEntries = legacyBudget ? (entriesByProject.get(p.id) || []) : [];
      const rateByStaff = new Map(alloc.filter((item) => item.active !== false).map((item) => [item.staff_user_id, number(item.hourly_rate)]));
      const fallbackRate = number(p.default_hourly_rate);
      const usedHours = legacyBudget ? legacyEntries.reduce((sum, entry) => sum + number(entry.hours), 0) : liveAllocations.reduce((sum, allocation) => sum + number(allocation.hours_consumed), 0);
      const currentSpend = roundCurrency(legacyBudget ? legacyEntries.reduce((sum, entry) => sum + number(entry.hours) * (rateByStaff.get(entry.staff_user_id) ?? fallbackRate), 0) : liveAllocations.reduce((sum, allocation) => sum + number(allocation.charge_out_spend), 0));
      const deliveryCost = roundCurrency(legacyBudget ? currentSpend * 0.6 : liveAllocations.reduce((sum, allocation) => sum + number(allocation.internal_cost), 0));
      const historicalUsedHours = legacyBudget ? 0 : historicalAllocations.reduce((sum, allocation) => sum + number(allocation.hours_consumed), 0);
      const historicalChargeOutSpend = legacyBudget ? 0 : roundCurrency(historicalAllocations.reduce((sum, allocation) => sum + number(allocation.charge_out_spend), 0));
      const historicalInternalCost = legacyBudget ? 0 : roundCurrency(historicalAllocations.reduce((sum, allocation) => sum + number(allocation.internal_cost), 0));
      const lifetimeUsedHours = usedHours + historicalUsedHours;
      const lifetimeChargeOutSpend = legacyBudget ? currentSpend : roundCurrency(projectBudgetAllocations.reduce((sum, allocation) => sum + number(allocation.charge_out_spend), 0));
      const remainingHours = budgetHours ? budgetHours - usedHours : null;
      const remainingBudget = budgetDollars ? roundCurrency(budgetDollars - currentSpend) : null;
      const estimatedProfit = budgetDollars ? roundCurrency(budgetDollars - deliveryCost) : null;

      // At-risk heuristic: budget hours exceeded, or a paused activity present,
      // or spend over budget. Otherwise On Track. (Conservative, transparent.)
      const hasPaused = acts.some((a) => a.status === "paused_other" || a.status === "need_info");
      const overHours = budgetHours > 0 && usedHours > budgetHours;
      const overBudget = budgetDollars > 0 && currentSpend > budgetDollars;
      const health = overHours || overBudget || hasPaused ? "At Risk" : "On Track";

      return {
        id: p.id, client: p.client_name || "—", project: p.name,
        taskCompletion, activities: total, teamSize: alloc.length,
        budgetDollars, usedHours, currentSpend, deliveryCost, estimatedProfit, remainingHours,
        historicalUsedHours, historicalChargeOutSpend, historicalInternalCost, lifetimeUsedHours, lifetimeChargeOutSpend,
        budgetHours, remainingBudget,
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
