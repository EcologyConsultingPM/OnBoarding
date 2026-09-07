import { requireSession, serverError } from "../../../../../../lib/serverAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function slug(value) {
  return String(value || "other")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40) || "other";
}
function num(value) {
  const result = Number(value);
  return Number.isFinite(result) ? result : 0;
}

// Groups this project's Work Activities by category, prices each group using
// the assigned staff member's rate on this project (falling back to the
// project's default hourly rate when an activity has no assignee or that
// person has no rate set), and upserts one Project Tracker allocation per
// category under a single "Original scope" budget source. Safe to re-run —
// existing rows are matched by allocation_code and updated, not duplicated,
// so this can be used repeatedly as activities change rather than only once.
export async function POST(request, { params }) {
  try {
    const access = await requireSession(request);
    if (access.error) return access.error;
    if (!access.isAdmin) return Response.json({ error: "Only administrators can generate the Project Tracker." }, { status: 403 });

    const { projectId } = params;
    const [projectResult, activitiesResult, allocationsResult, sourcesResult] = await Promise.all([
      access.admin.from("projects").select("id, name, budget_hours, budget_dollars, default_hourly_rate").eq("id", projectId).maybeSingle(),
      access.admin.from("project_activities").select("task_category, budget_hours, staff_user_id").eq("project_id", projectId).eq("is_active", true),
      access.admin.from("project_allocations").select("staff_user_id, hourly_rate").eq("project_id", projectId),
      access.admin.from("project_budget_sources").select("id, source_code").eq("project_id", projectId),
    ]);
    if (projectResult.error) return Response.json({ error: projectResult.error.message }, { status: 400 });
    if (!projectResult.data) return Response.json({ error: "Project not found." }, { status: 404 });
    if (activitiesResult.error) return Response.json({ error: activitiesResult.error.message }, { status: 400 });
    if (allocationsResult.error) return Response.json({ error: allocationsResult.error.message }, { status: 400 });
    if (sourcesResult.error) return Response.json({ error: sourcesResult.error.message }, { status: 400 });

    const project = projectResult.data;
    const activities = activitiesResult.data || [];
    if (!activities.length) {
      return Response.json({ error: "This project has no Work Activities yet — add and save activities first, then generate the tracker." }, { status: 400 });
    }

    const rateByStaff = new Map((allocationsResult.data || []).map((a) => [a.staff_user_id, num(a.hourly_rate)]));
    const defaultRate = num(project.default_hourly_rate);
    const now = new Date().toISOString();

    // Find or create the single "Original scope" source this auto-generation
    // owns. Re-running never creates a second one — it's matched by code.
    const SOURCE_CODE = "AUTO-ORIGINAL";
    let source = (sourcesResult.data || []).find((s) => s.source_code === SOURCE_CODE);
    if (!source) {
      const { data, error } = await access.admin.from("project_budget_sources").insert({
        project_id: projectId,
        source_code: SOURCE_CODE,
        source_name: "Original scope",
        source_type: "original",
        approved_value: num(project.budget_dollars),
        approved_hours: num(project.budget_hours),
        approval_status: "approved",
        effective_date: now.slice(0, 10),
        created_by: access.user.id,
        updated_by: access.user.id,
      }).select("id, source_code").single();
      if (error) return Response.json({ error: error.message }, { status: 400 });
      source = data;
    }

    // Group activities by category, pricing each activity by its assignee's
    // rate on this project (falling back to the project's default rate).
    const byCategory = new Map();
    for (const activity of activities) {
      const category = activity.task_category || "Uncategorised";
      const hours = num(activity.budget_hours);
      const rate = activity.staff_user_id && rateByStaff.has(activity.staff_user_id)
        ? rateByStaff.get(activity.staff_user_id)
        : defaultRate;
      const entry = byCategory.get(category) || { hours: 0, value: 0 };
      entry.hours += hours;
      entry.value += hours * rate;
      byCategory.set(category, entry);
    }

    const { data: existingAllocations, error: existingAllocationsError } = await access.admin
      .from("project_budget_allocations")
      .select("id, allocation_code")
      .eq("project_id", projectId)
      .eq("budget_source_id", source.id);
    if (existingAllocationsError) return Response.json({ error: existingAllocationsError.message }, { status: 400 });
    const existingByCode = new Map((existingAllocations || []).map((a) => [a.allocation_code, a.id]));

    const results = [];
    for (const [category, totals] of byCategory.entries()) {
      const code = slug(category);
      const row = {
        project_id: projectId,
        budget_source_id: source.id,
        allocation_code: code,
        allocation_name: category,
        allocation_value: Math.round(totals.value * 100) / 100,
        allocation_hours: Math.round(totals.hours * 100) / 100,
        status: "active",
        staff_visible: true,
        updated_by: access.user.id,
        updated_at: now,
      };
      const existingId = existingByCode.get(code);
      if (existingId) {
        const { data, error } = await access.admin.from("project_budget_allocations").update(row).eq("id", existingId).select().single();
        if (error) return Response.json({ error: error.message }, { status: 400 });
        results.push(data);
      } else {
        row.created_by = access.user.id;
        row.created_at = now;
        const { data, error } = await access.admin.from("project_budget_allocations").insert(row).select().single();
        if (error) return Response.json({ error: error.message }, { status: 400 });
        results.push(data);
      }
    }

    return Response.json({ success: true, source, allocations: results, categoriesGenerated: results.length });
  } catch (error) {
    return serverError(error);
  }
}
