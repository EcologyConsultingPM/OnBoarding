import { requireSession, serverError } from "../../../lib/serverAuth";
import { loadTrackerChargeRates, trackerEntryChargeTotal, trackerEntryInternalCost } from "../../../lib/projectTrackerChargeRates";
import { loadTrackerEntryPages, summarizeTrackerUnassignedActuals, trackerAllocationsWithDerivedInternalCosts } from "../../../lib/projectTrackerUnassignedActuals";

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
function privateResponse(response) {
  const headers = new Headers(response.headers);
  headers.set("Cache-Control", "private, no-store");
  const vary = headers.get("Vary");
  if (!vary?.split(",").some((value) => value.trim().toLowerCase() === "authorization")) headers.set("Vary", vary ? `${vary}, Authorization` : "Authorization");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
const group = (rows) => {
  const map = new Map();
  for (const row of rows || []) {
    if (!map.has(row.project_id)) map.set(row.project_id, []);
    map.get(row.project_id).push(row);
  }
  return map;
};

// Source-backed charging retains stored actuals and closed-funding distinctions.
// Internal cost is a read-only derivation from attributable person entries where
// available; no-entry manual allocations retain explicitly unattributed costs.
async function report(request) {
  const access = await requireSession(request);
  if (access.error) return access.error;
  if (!access.isAdmin) return Response.json({ error: "Administrators only." }, { status: 403 });
  const [projectsResult, activitiesResult, allocationsResult, entriesResult, sourcesResult, budgetAllocationsResult] = await Promise.all([
    access.admin.from("projects").select("id, name, client_name, status, budget_hours, budget_dollars, default_hourly_rate").is("deleted_at", null).neq("status", "archived"),
    access.admin.from("project_activities").select("project_id, status, budget_hours"),
    access.admin.from("project_allocations").select("project_id, staff_user_id, allocated_hours, hourly_rate, active"),
    loadTrackerEntryPages(() => access.admin.from("project_tracker_entries").select("id, project_id, staff_user_id, budget_source_id, budget_allocation_id, hours, custom_data")),
    access.admin.from("project_budget_sources").select("id, project_id, source_type, approval_status, approved_value, approved_hours"),
    access.admin.from("project_budget_allocations").select("id, project_id, budget_source_id, status, hours_consumed, charge_out_spend, internal_cost"),
  ]);
  for (const result of [projectsResult, activitiesResult, allocationsResult, entriesResult]) if (result.error) throw new Error(result.error.message);
  if (sourcesResult.error && !tableUnavailable(sourcesResult.error)) throw new Error(sourcesResult.error.message);
  if (budgetAllocationsResult.error && !tableUnavailable(budgetAllocationsResult.error)) throw new Error(budgetAllocationsResult.error.message);
  const projects = projectsResult.data || [];
  const sources = sourcesResult.error ? [] : (sourcesResult.data || []);
  if (budgetAllocationsResult.error && sources.some((source) => projects.some((project) => project.id === source.project_id))) throw new Error(budgetAllocationsResult.error.message);
  const activitiesByProject = group(activitiesResult.data);
  const allocByProject = group(allocationsResult.data);
  const entriesByProject = group(entriesResult.data);
  const sourcesByProject = group(sources);
  const budgetAllocationsByProject = group(budgetAllocationsResult.data);
  const ratesByProject = await loadTrackerChargeRates(access.admin, projects.filter((project) => !sourcesByProject.has(project.id)).map((project) => project.id));

  const rows = projects.map((p) => {
    const acts = activitiesByProject.get(p.id) || [];
    const total = acts.length;
    const completed = acts.filter((a) => a.status === "completed").length;
    const taskCompletion = total ? Math.round((completed / total) * 100) : 0;
    const alloc = allocByProject.get(p.id) || [];
    const projectSources = sourcesByProject.get(p.id) || [];
    const approvedSources = projectSources.filter((source) => String(source.approval_status || "draft").toLowerCase() === "approved" && ["original", "variation"].includes(source.source_type));
    const approvedSourceIds = new Set(approvedSources.map((source) => source.id));
    const legacyBudget = !projectSources.length;
    const budgetDollars = roundCurrency(legacyBudget ? number(p.budget_dollars) : approvedSources.reduce((sum, source) => sum + number(source.approved_value), 0));
    const budgetHours = legacyBudget ? number(p.budget_hours) : approvedSources.reduce((sum, source) => sum + number(source.approved_hours), 0);
    const projectEntries = entriesByProject.get(p.id) || [];
    const unassigned = summarizeTrackerUnassignedActuals(projectEntries);
    const projectBudgetAllocations = trackerAllocationsWithDerivedInternalCosts(budgetAllocationsByProject.get(p.id) || [], projectEntries);
    const liveAllocations = projectBudgetAllocations.filter((allocation) => allocation.status === "active" && approvedSourceIds.has(allocation.budget_source_id));
    const historicalAllocations = projectBudgetAllocations.filter((allocation) => !(allocation.status === "active" && approvedSourceIds.has(allocation.budget_source_id)));
    const rateByStaff = new Map(alloc.filter((item) => item.active !== false).map((item) => [item.staff_user_id, number(item.hourly_rate)]));
    const fallbackRate = number(p.default_hourly_rate);
    // Legacy branch already includes every entry: do NOT add unassigned twice.
    const usedHours = legacyBudget ? projectEntries.reduce((sum, entry) => sum + number(entry.hours), 0) : liveAllocations.reduce((sum, allocation) => sum + number(allocation.hours_consumed), 0) + unassigned.hours;
    const currentSpend = roundCurrency(legacyBudget ? projectEntries.reduce((sum, entry) => sum + trackerEntryChargeTotal(entry, ratesByProject, rateByStaff.get(entry.staff_user_id) || fallbackRate), 0) : liveAllocations.reduce((sum, allocation) => sum + number(allocation.charge_out_spend), 0) + unassigned.chargeOutSpend);
    const deliveryCost = roundCurrency(legacyBudget ? projectEntries.reduce((sum, entry) => sum + trackerEntryInternalCost(entry), 0) : liveAllocations.reduce((sum, allocation) => sum + number(allocation.internal_cost), 0) + unassigned.internalCost);
    const historicalUsedHours = legacyBudget ? 0 : historicalAllocations.reduce((sum, allocation) => sum + number(allocation.hours_consumed), 0);
    const historicalChargeOutSpend = legacyBudget ? 0 : roundCurrency(historicalAllocations.reduce((sum, allocation) => sum + number(allocation.charge_out_spend), 0));
    const historicalInternalCost = legacyBudget ? 0 : roundCurrency(historicalAllocations.reduce((sum, allocation) => sum + number(allocation.internal_cost), 0));
    const lifetimeUsedHours = usedHours + historicalUsedHours;
    const lifetimeChargeOutSpend = roundCurrency(currentSpend + historicalChargeOutSpend);
    const lifetimeInternalCost = roundCurrency(deliveryCost + historicalInternalCost);
    const remainingHours = budgetHours ? budgetHours - usedHours : usedHours ? -usedHours : null;
    const remainingBudget = budgetDollars ? roundCurrency(budgetDollars - currentSpend) : currentSpend ? -currentSpend : null;
    const estimatedProfit = budgetDollars ? roundCurrency(budgetDollars - deliveryCost) : deliveryCost ? -deliveryCost : null;
    const hasPaused = acts.some((a) => a.status === "paused_other" || a.status === "need_info");
    const health = budgetHours > 0 && usedHours > budgetHours || budgetDollars > 0 && currentSpend > budgetDollars || hasPaused ? "At Risk" : "On Track";
    return {
      id: p.id, client: p.client_name || "—", project: p.name,
      taskCompletion, activities: total, teamSize: alloc.length,
      budgetDollars, usedHours, currentSpend, deliveryCost, estimatedProfit, remainingHours,
      historicalUsedHours, historicalChargeOutSpend, historicalInternalCost, lifetimeUsedHours, lifetimeChargeOutSpend, lifetimeInternalCost,
      budgetHours, remainingBudget, health, unassigned,
      internalCostBasis: "recorded_entries_fixed_role_and_mileage_with_legacy_stored_unattributed_fallback",
      legacyUnattributedAllocationIds: projectBudgetAllocations.filter((allocation) => allocation.internal_cost_basis === "legacy_stored_unattributed").map((allocation) => allocation.id),
    };
  });
  const active = rows.length;
  const atRisk = rows.filter((r) => r.health === "At Risk").length;
  const avgCompletion = active ? Math.round(rows.reduce((s, r) => s + r.taskCompletion, 0) / active) : 0;
  return Response.json({ summary: { active, onTrack: active - atRisk, atRisk, avgCompletion }, rows,
    costBasisPercent: null,
    costBasis: { currency: "AUD", hourly: { "Senior Ecologist": 81, Ecologist: 75, "Project Manager": 70 }, mileagePerKilometre: 0.90,
      legacyManual: "Stored unattributed allocation costs are retained where no recorded person entries exist." },
  });
}

export async function GET(request) {
  try { return privateResponse(await report(request)); }
  catch (error) { return privateResponse(serverError(error)); }
}
