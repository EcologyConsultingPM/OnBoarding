import { requireSession, serverError } from "../../../lib/serverAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Admin-only portfolio rollup. Collates each project's budget, allocations and
// activity statuses into the health view from the Project_Health_Report sheet:
// task completion %, planned spend, remaining hours/budget, and an On Track /
// At Risk status. Actual timesheet hours live in the external timesheet system,
// so "spend to date" is derived from completed-activity budget hours here; when
// a timesheet feed is connected it can replace that input directly.
export async function GET(request) {
  try {
    const access = await requireSession(request);
    if (access.error) return access.error;
    if (!access.isAdmin) return Response.json({ error: "Administrators only." }, { status: 403 });

    const [{ data: projects }, { data: activities }, { data: allocations }, { data: roleRates }] = await Promise.all([
      access.admin.from("projects").select("id, name, client_name, status, budget_hours, budget_dollars, default_hourly_rate").neq("status", "archived"),
      access.admin.from("project_activities").select("project_id, status, budget_hours"),
      access.admin.from("project_allocations").select("project_id, allocated_hours, hourly_rate"),
      access.admin.from("project_role_rates").select("role_name, charge_rate"),
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

    const rows = (projects || []).map((p) => {
      const acts = activitiesByProject.get(p.id) || [];
      const total = acts.length;
      const completed = acts.filter((a) => a.status === "completed").length;
      const taskCompletion = total ? Math.round((completed / total) * 100) : 0;

      // Planned/used hours: completed activities' budget hours as a proxy for
      // spend-to-date until the timesheet feed is connected.
      const usedHours = acts.filter((a) => a.status === "completed").reduce((s, a) => s + (Number(a.budget_hours) || 0), 0);
      const budgetHours = Number(p.budget_hours) || 0;
      const remainingHours = budgetHours ? Math.max(budgetHours - usedHours, 0) : null;

      const alloc = allocByProject.get(p.id) || [];
      const rate = Number(p.default_hourly_rate) || 0;
      const currentSpend = usedHours * rate;
      const budgetDollars = Number(p.budget_dollars) || 0;
      const remainingBudget = budgetDollars ? budgetDollars - currentSpend : null;

      // At-risk heuristic: budget hours exceeded, or a paused activity present,
      // or spend over budget. Otherwise On Track. (Conservative, transparent.)
      const hasPaused = acts.some((a) => a.status === "paused_other" || a.status === "need_info");
      const overHours = budgetHours > 0 && usedHours > budgetHours;
      const overBudget = budgetDollars > 0 && currentSpend > budgetDollars;
      const health = overHours || overBudget || hasPaused ? "At Risk" : "On Track";

      return {
        id: p.id, client: p.client_name || "—", project: p.name,
        taskCompletion, activities: total, teamSize: alloc.length,
        currentSpend: Math.round(currentSpend), remainingHours,
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
      roleRates: roleRates || [],
    });
  } catch (error) {
    return serverError(error);
  }
}
