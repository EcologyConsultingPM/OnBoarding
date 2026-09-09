import { requireSession, serverError } from "../../../../lib/serverAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PROJECT_COLUMNS = "id, name, client_name, description, start_date, end_date, budget_hours, budget_dollars, default_hourly_rate, status, updated_at";
const SOURCE_COLUMNS = "id, project_id, source_code, source_name, source_type, approved_value, approved_hours, approval_status, variation_reason, effective_date, created_at, updated_at";
const ALLOCATION_COLUMNS = "id, project_id, budget_source_id, allocation_code, allocation_name, allocation_value, allocation_hours, hours_consumed, charge_out_spend, internal_cost, threshold_percent, status, staff_visible, created_at, updated_at";

function jsonError(error, status = 400) {
  return Response.json({ error }, { status });
}

function tableUnavailable(error) {
  const code = String(error?.code || "");
  const message = String(error?.message || "").toLowerCase();
  return code === "42P01" || code === "42703" || code === "PGRST205" || message.includes("does not exist") || message.includes("schema cache");
}

function number(value) {
  const result = Number(value);
  return Number.isFinite(result) ? result : 0;
}

function optionalNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const result = Number(value);
  return Number.isFinite(result) && result >= 0 ? result : null;
}

function validId(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ""));
}

async function requireAdmin(request) {
  const access = await requireSession(request);
  if (access.error) return { error: access.error };
  if (!access.isAdmin) return { error: jsonError("Administrator access is required.", 403) };
  return { access };
}

function sourceStatus(source) {
  return String(source.approval_status || "draft").toLowerCase();
}

function healthForAllocation(allocation) {
  const budget = number(allocation.allocation_value);
  const spent = number(allocation.charge_out_spend);
  const hours = number(allocation.allocation_hours);
  const consumed = number(allocation.hours_consumed);
  const threshold = number(allocation.threshold_percent) || 80;
  const valueRatio = budget > 0 ? (spent / budget) * 100 : 0;
  const hourRatio = hours > 0 ? (consumed / hours) * 100 : 0;
  const ratio = Math.max(valueRatio, hourRatio);
  // "At risk" means 10% or less of budget/hours remaining (90%+ consumed) —
  // previously this only triggered once the budget was already fully or
  // over-consumed (100%+), which is a warning that arrives too late to act
  // on. "Watch" keeps the existing configurable threshold (defaulting 80%).
  if (ratio >= 90) return "at_risk";
  if (ratio >= threshold) return "watch";
  return "on_track";
}

function buildProjectTracker(project, sources, allocations, activities, trackerEntries, teamCount, settings) {
  const projectSources = sources.filter((source) => source.project_id === project.id);
  const projectAllocations = allocations.filter((allocation) => allocation.project_id === project.id);
  const original = projectSources.filter((source) => source.source_type === "original");
  const variations = projectSources.filter((source) => source.source_type === "variation" && sourceStatus(source) === "approved");
  const originalBudget = original.length ? original.reduce((sum, source) => sum + number(source.approved_value), 0) : number(project.budget_dollars);
  const variationBudget = variations.reduce((sum, source) => sum + number(source.approved_value), 0);
  const overallBudget = originalBudget + variationBudget;
  const chargeOutSpend = projectAllocations.reduce((sum, allocation) => sum + number(allocation.charge_out_spend), 0);
  const internalCost = projectAllocations.reduce((sum, allocation) => sum + number(allocation.internal_cost), 0);
  const estimatedProfit = chargeOutSpend - internalCost;
  const budgetHours = projectSources.length ? projectSources.filter((source) => sourceStatus(source) === "approved").reduce((sum, source) => sum + number(source.approved_hours), 0) : number(project.budget_hours);
  const usedHours = projectAllocations.reduce((sum, allocation) => sum + number(allocation.hours_consumed), 0);
  const relevantActivities = activities.filter((activity) => activity.project_id === project.id);
  const projectEntries = trackerEntries.filter((entry) => entry.project_id === project.id);
  const completedActivities = relevantActivities.filter((activity) => activity.status === "completed").length;
  const taskCompletion = relevantActivities.length ? Math.round((relevantActivities.reduce((sum, activity) => sum + Math.max(0, Math.min(100, number(activity.progress_percent))), 0) / relevantActivities.length) * 100) / 100 : 0;
  const pausedActivities = relevantActivities.filter((activity) => ["need_info", "paused_other"].includes(activity.status)).length;
  const today = new Date().toISOString().slice(0, 10);
  const overdueActivities = relevantActivities.filter((activity) => activity.due_date && activity.due_date < today && activity.status !== "completed").length;
  const completionDurations = relevantActivities
    .filter((activity) => activity.assigned_at && activity.completed_at)
    .map((activity) => Math.max(0, (new Date(activity.completed_at).getTime() - new Date(activity.assigned_at).getTime()) / 86400000));
  const averageDeliveryDays = completionDurations.length ? Math.round((completionDurations.reduce((sum, days) => sum + days, 0) / completionDurations.length) * 10) / 10 : null;
  const utilisationPercent = budgetHours > 0 ? Math.round((usedHours / budgetHours) * 1000) / 10 : null;
  const profitabilityPercent = overallBudget > 0 ? Math.round((estimatedProfit / overallBudget) * 1000) / 10 : null;
  const atRiskAllocations = projectAllocations.filter((allocation) => healthForAllocation(allocation) === "at_risk").length;
  const watchAllocations = projectAllocations.filter((allocation) => healthForAllocation(allocation) === "watch").length;
  // 90% consumed = "10% remaining", matching atRiskAllocations' own threshold
  // above — previously this only fired once fully over-budget (100%+).
  const budgetNearlyGone = overallBudget > 0 && chargeOutSpend >= overallBudget * 0.9;
  const hoursNearlyGone = budgetHours > 0 && usedHours >= budgetHours * 0.9;
  const healthReasons = [];
  if (atRiskAllocations) healthReasons.push(`${atRiskAllocations} budget allocation${atRiskAllocations === 1 ? "" : "s"} at 90%+ of its limit`);
  if (pausedActivities) healthReasons.push(`${pausedActivities} activit${pausedActivities === 1 ? "y" : "ies"} paused or needing information`);
  if (overdueActivities) healthReasons.push(`${overdueActivities} activit${overdueActivities === 1 ? "y" : "ies"} overdue`);
  if (budgetNearlyGone) healthReasons.push(`Charge-out spend at ${Math.round((chargeOutSpend / overallBudget) * 100)}% of the overall budget`);
  if (hoursNearlyGone) healthReasons.push(`Hours consumed at ${Math.round((usedHours / budgetHours) * 100)}% of budgeted hours`);
  if (!healthReasons.length && watchAllocations) healthReasons.push(`${watchAllocations} allocation${watchAllocations === 1 ? "" : "s"} approaching its threshold`);
  if (!healthReasons.length && utilisationPercent !== null && utilisationPercent >= 80) healthReasons.push(`Overall hours utilisation at ${utilisationPercent}%`);
  const health = atRiskAllocations || pausedActivities || overdueActivities || budgetNearlyGone || hoursNearlyGone ? "At Risk" : watchAllocations || (utilisationPercent !== null && utilisationPercent >= 80) ? "Watch" : "On Track";

  return {
    id: project.id,
    name: project.name,
    clientName: project.client_name || "Client not recorded",
    description: project.description || "",
    startDate: project.start_date,
    endDate: project.end_date,
    status: project.status,
    teamCount,
    trackerVisible: Boolean(settings?.tracker_visible),
    taskCompletion,
    health,
    healthReasons,
    financials: { originalBudget, variationBudget, overallBudget, chargeOutSpend, internalCost, estimatedProfit, profitabilityPercent, budgetHours, usedHours, utilisationPercent, remainingBudget: overallBudget - chargeOutSpend, remainingHours: budgetHours ? budgetHours - usedHours : null },
    sources: projectSources.map((source) => ({ ...source, allocations: projectAllocations.filter((allocation) => allocation.budget_source_id === source.id).map((allocation) => ({ ...allocation, health: healthForAllocation(allocation) })) })),
    activitySummary: { total: relevantActivities.length, completed: completedActivities, paused: pausedActivities, overdue: overdueActivities, completionPercent: taskCompletion, averageDeliveryDays, atRiskAllocations, watchAllocations },
    entrySummary: { count: projectEntries.length, submittedHours: projectEntries.reduce((sum, entry) => sum + number(entry.hours), 0), recent: projectEntries.sort((left, right) => new Date(right.created_at || 0) - new Date(left.created_at || 0)).slice(0, 8) },
  };
}

async function trackerData(access, requestedProjectId = "") {
  const projectsQuery = access.admin.from("projects").select(PROJECT_COLUMNS).neq("status", "archived").order("updated_at", { ascending: false });
  const projectsResult = requestedProjectId ? await projectsQuery.eq("id", requestedProjectId) : await projectsQuery.eq("status", "active");
  if (projectsResult.error) throw new Error(projectsResult.error.message);
  const projects = projectsResult.data || [];
  if (requestedProjectId && !projects.length) return { projects: [], financialReady: true };
  const ids = projects.map((project) => project.id);
  if (!ids.length) return { projects: [], financialReady: true };

  let [activitiesResult, allocationsResult, settingsResult, sourcesResult, trackerAllocationsResult, trackerEntriesResult] = await Promise.all([
    access.admin.from("project_activities").select("id, project_id, status, acceptance_status, progress_percent, due_date, assigned_at, completed_at, is_active").in("project_id", ids).eq("is_active", true),
    access.admin.from("project_allocations").select("project_id, staff_user_id, active").in("project_id", ids),
    access.admin.from("project_tracker_settings").select("project_id, tracker_visible").in("project_id", ids),
    access.admin.from("project_budget_sources").select(SOURCE_COLUMNS).in("project_id", ids).order("effective_date", { ascending: true }),
    access.admin.from("project_budget_allocations").select(ALLOCATION_COLUMNS).in("project_id", ids).order("allocation_code", { ascending: true }),
    access.admin.from("project_tracker_entries").select("id, project_id, staff_user_id, work_date, activity_category, activity_information, hours, status, notable_issues, created_at").in("project_id", ids).order("created_at", { ascending: false }).limit(500),
  ]);

  if (activitiesResult.error && tableUnavailable(activitiesResult.error)) {
    activitiesResult = await access.admin.from("project_activities").select("id, project_id, status").in("project_id", ids);
  }
  if (activitiesResult.error) throw new Error(activitiesResult.error.message);
  if (allocationsResult.error && !tableUnavailable(allocationsResult.error)) throw new Error(allocationsResult.error.message);
  if (settingsResult.error && !tableUnavailable(settingsResult.error)) throw new Error(settingsResult.error.message);
  const financialReady = !sourcesResult.error && !trackerAllocationsResult.error;
  if (!financialReady && !(tableUnavailable(sourcesResult.error) || tableUnavailable(trackerAllocationsResult.error))) {
    throw new Error(sourcesResult.error?.message || trackerAllocationsResult.error?.message || "Could not load tracker budgets.");
  }
  if (trackerEntriesResult.error && !tableUnavailable(trackerEntriesResult.error)) throw new Error(trackerEntriesResult.error.message);

  const teamCounts = new Map();
  (allocationsResult.data || []).filter((row) => row.active !== false).forEach((row) => {
    if (row.staff_user_id) teamCounts.set(row.project_id, (teamCounts.get(row.project_id) || 0) + 1);
  });
  const settingsByProject = new Map((settingsResult.data || []).map((setting) => [setting.project_id, setting]));
  return {
    financialReady,
    projects: projects.map((project) => buildProjectTracker(project, financialReady ? (sourcesResult.data || []) : [], financialReady ? (trackerAllocationsResult.data || []) : [], activitiesResult.data || [], trackerEntriesResult.error ? [] : (trackerEntriesResult.data || []), teamCounts.get(project.id) || 0, settingsByProject.get(project.id))),
  };
}

export async function GET(request) {
  try {
    const auth = await requireAdmin(request);
    if (auth.error) return auth.error;
    const { searchParams } = new URL(request.url);
    const projectId = String(searchParams.get("projectId") || "").trim();
    if (projectId && !validId(projectId)) return jsonError("A valid project is required.");
    const data = await trackerData(auth.access, projectId);
    if (projectId && !data.projects.length) return jsonError("Active project not found.", 404);
    return Response.json(projectId ? { project: data.projects[0], financialReady: data.financialReady } : data);
  } catch (error) {
    return serverError(error);
  }
}

export async function POST(request) {
  try {
    const auth = await requireAdmin(request);
    if (auth.error) return auth.error;
    const body = await request.json();
    const action = String(body.action || "");
    const projectId = String(body.projectId || "");
    if (!validId(projectId)) return jsonError("A valid project is required.");

    const { data: project, error: projectError } = await auth.access.admin.from("projects").select("id, name").eq("id", projectId).maybeSingle();
    if (projectError) return jsonError(projectError.message);
    if (!project) return jsonError("Project not found.", 404);

    if (action === "save_source") {
      const sourceCode = String(body.sourceCode || "").trim().toUpperCase();
      const sourceName = String(body.sourceName || "").trim();
      const sourceType = ["original", "variation", "internal_reallocation"].includes(body.sourceType) ? body.sourceType : "variation";
      const approvalStatus = ["draft", "pending_approval", "approved", "rejected", "closed"].includes(body.approvalStatus) ? body.approvalStatus : "draft";
      const approvedValue = optionalNumber(body.approvedValue);
      const approvedHours = optionalNumber(body.approvedHours);
      if (!sourceCode || !sourceName || approvedValue === null || approvedHours === null) return jsonError("Source code, name, approved value and approved hours are required.");
      if (sourceType === "variation" && !String(body.variationReason || "").trim()) return jsonError("A variation reason is required.");
      const payload = { project_id: projectId, source_code: sourceCode, source_name: sourceName, source_type: sourceType, approved_value: approvedValue, approved_hours: approvedHours, approval_status: approvalStatus, variation_reason: String(body.variationReason || "").trim() || null, effective_date: body.effectiveDate || new Date().toISOString().slice(0, 10), updated_by: auth.access.user.id, updated_at: new Date().toISOString() };
      if (body.id && validId(body.id)) {
        const { data, error } = await auth.access.admin.from("project_budget_sources").update(payload).eq("id", body.id).eq("project_id", projectId).select(SOURCE_COLUMNS).single();
        if (error) return jsonError(error.message);
        return Response.json({ source: data });
      }
      if (sourceType === "original") {
        const { data: existing, error: existingError } = await auth.access.admin.from("project_budget_sources").select("id").eq("project_id", projectId).eq("source_type", "original").limit(1);
        if (existingError) return jsonError(existingError.message);
        if ((existing || []).length) return jsonError("This project already has an original contract source.", 409);
      }
      const { data, error } = await auth.access.admin.from("project_budget_sources").insert({ ...payload, created_by: auth.access.user.id }).select(SOURCE_COLUMNS).single();
      if (error) return jsonError(error.message);
      return Response.json({ source: data }, { status: 201 });
    }

    if (action === "save_allocation") {
      const sourceId = String(body.sourceId || "");
      const allocationCode = String(body.allocationCode || "").trim().toUpperCase();
      const allocationName = String(body.allocationName || "").trim();
      const allocationValue = optionalNumber(body.allocationValue);
      const allocationHours = optionalNumber(body.allocationHours);
      const hoursConsumed = optionalNumber(body.hoursConsumed);
      const chargeOutSpend = optionalNumber(body.chargeOutSpend);
      const internalCost = optionalNumber(body.internalCost);
      if (!validId(sourceId) || !allocationCode || !allocationName || allocationValue === null || allocationHours === null) return jsonError("Source, allocation code, name, value and hours are required.");
      const { data: source, error: sourceError } = await auth.access.admin.from("project_budget_sources").select("id, project_id").eq("id", sourceId).eq("project_id", projectId).maybeSingle();
      if (sourceError) return jsonError(sourceError.message);
      if (!source) return jsonError("Budget source not found for this project.", 404);
      const payload = { project_id: projectId, budget_source_id: sourceId, allocation_code: allocationCode, allocation_name: allocationName, allocation_value: allocationValue, allocation_hours: allocationHours, hours_consumed: hoursConsumed || 0, charge_out_spend: chargeOutSpend || 0, internal_cost: internalCost || 0, threshold_percent: Math.min(100, Math.max(1, Number(body.thresholdPercent) || 80)), status: ["draft", "active", "closed"].includes(body.status) ? body.status : "draft", staff_visible: body.staffVisible === true, updated_by: auth.access.user.id, updated_at: new Date().toISOString() };
      if (body.id && validId(body.id)) {
        const { data, error } = await auth.access.admin.from("project_budget_allocations").update(payload).eq("id", body.id).eq("project_id", projectId).select(ALLOCATION_COLUMNS).single();
        if (error) return jsonError(error.message);
        return Response.json({ allocation: data });
      }
      const { data, error } = await auth.access.admin.from("project_budget_allocations").insert({ ...payload, created_by: auth.access.user.id }).select(ALLOCATION_COLUMNS).single();
      if (error) return jsonError(error.message);
      return Response.json({ allocation: data }, { status: 201 });
    }
    return jsonError("Unknown Project Tracker action.");
  } catch (error) {
    return serverError(error);
  }
}

export async function DELETE(request) {
  try {
    const auth = await requireAdmin(request);
    if (auth.error) return auth.error;
    const { searchParams } = new URL(request.url);
    const action = String(searchParams.get("action") || "");
    const id = String(searchParams.get("id") || "");
    const projectId = String(searchParams.get("projectId") || "");
    if (!validId(id) || !validId(projectId)) return jsonError("A valid project record is required.");
    if (action === "source") {
      const { data: source, error: sourceError } = await auth.access.admin.from("project_budget_sources").select("id, source_type").eq("id", id).eq("project_id", projectId).maybeSingle();
      if (sourceError) return jsonError(sourceError.message);
      if (!source) return jsonError("Budget source not found.", 404);
      if (source.source_type === "original") return jsonError("The original contract source is retained as the project baseline. Close it instead of deleting it.", 409);
      const { error } = await auth.access.admin.from("project_budget_sources").delete().eq("id", id).eq("project_id", projectId);
      if (error) return jsonError(error.message);
      return Response.json({ success: true });
    }
    if (action === "allocation") {
      const { error } = await auth.access.admin.from("project_budget_allocations").delete().eq("id", id).eq("project_id", projectId);
      if (error) return jsonError(error.message);
      return Response.json({ success: true });
    }
    return jsonError("Unknown Project Tracker deletion.");
  } catch (error) {
    return serverError(error);
  }
}
