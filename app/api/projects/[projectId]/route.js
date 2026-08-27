import { requireSession, serverError } from "../../../../lib/serverAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PROJECT_COLUMNS =
  "id, name, client_name, client_contact, sharepoint_link, description, start_date, end_date, budget_hours, budget_dollars, default_hourly_rate, status, created_at, updated_at";

function opt(value) {
  const t = typeof value === "string" ? value.trim() : "";
  return t || null;
}
function num(value) {
  if (value === "" || value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

async function projectAccess(access, projectId) {
  const { data: project, error } = await access.admin
    .from("projects")
    .select("id, created_by, name, status")
    .eq("id", projectId)
    .maybeSingle();
  if (error || !project) return { response: Response.json({ error: "Project not found." }, { status: 404 }) };
  if (!access.isAdmin) {
    const { data: alloc } = await access.admin
      .from("project_allocations")
      .select("id")
      .eq("project_id", projectId)
      .eq("staff_user_id", access.user.id)
      .maybeSingle();
    if (!alloc) return { response: Response.json({ error: "You are not allocated to this project." }, { status: 403 }) };
  }
  return { project };
}

export async function GET(request, { params }) {
  try {
    const access = await requireSession(request);
    if (access.error) return access.error;
    const authorisation = await projectAccess(access, params.projectId);
    if (authorisation.response) return authorisation.response;

    const [{ data: project }, { data: schedule }, { data: allocations }] = await Promise.all([
      access.admin.from("projects").select(PROJECT_COLUMNS).eq("id", params.projectId).single(),
      access.admin.from("project_schedule_items").select("id, sort_order, title, detail, start_date, end_date, milestone").eq("project_id", params.projectId).order("sort_order", { ascending: true }),
      access.admin.from("project_allocations").select("id, staff_user_id, role_on_project, allocated_hours, hourly_rate").eq("project_id", params.projectId),
    ]);

    // Attach staff emails to allocations so the team is legible (admin API only).
    let allocationsWithEmail = allocations || [];
    if (allocationsWithEmail.length) {
      const ids = allocationsWithEmail.map((a) => a.staff_user_id);
      const { data: users } = await access.admin.auth.admin.listUsers();
      const emailById = new Map((users?.users || []).map((u) => [u.id, u.email]));
      allocationsWithEmail = allocationsWithEmail.map((a) => ({ ...a, email: emailById.get(a.staff_user_id) || null }));
    }

    return Response.json({ project, schedule: schedule || [], allocations: allocationsWithEmail });
  } catch (error) {
    return serverError(error);
  }
}

export async function PATCH(request, { params }) {
  try {
    const access = await requireSession(request);
    if (access.error) return access.error;
    if (!access.isAdmin) return Response.json({ error: "Only administrators can edit projects." }, { status: 403 });
    const authorisation = await projectAccess(access, params.projectId);
    if (authorisation.response) return authorisation.response;

    const body = await request.json();
    const { data, error } = await access.admin
      .from("projects")
      .update({
        name: opt(body.name) ?? undefined,
        client_name: opt(body.clientName),
        client_contact: opt(body.clientContact),
        sharepoint_link: opt(body.sharepointLink),
        description: opt(body.description),
        start_date: opt(body.startDate),
        end_date: opt(body.endDate),
        budget_hours: num(body.budgetHours),
        budget_dollars: num(body.budgetDollars),
        default_hourly_rate: num(body.defaultHourlyRate),
        status: opt(body.status) || undefined,
      })
      .eq("id", params.projectId)
      .select(PROJECT_COLUMNS)
      .single();

    if (error) return Response.json({ error: error.message }, { status: 400 });
    return Response.json({ project: data });
  } catch (error) {
    return serverError(error);
  }
}

// Replace the whole schedule for a project (admin only), renumbered in order.
// A project can be removed only while it has no delivery, allocation or audit
// records. This preserves timesheet/tracker history and avoids broad cascade
// deletion from a portfolio-management control.
export async function DELETE(request, { params }) {
  try {
    const access = await requireSession(request);
    if (access.error) return access.error;
    if (!access.isAdmin) return Response.json({ error: "Only administrators can delete projects." }, { status: 403 });
    const authorisation = await projectAccess(access, params.projectId);
    if (authorisation.response) return authorisation.response;

    const checks = await Promise.all([
      access.admin.from("project_allocations").select("id").eq("project_id", params.projectId).limit(1),
      access.admin.from("project_activities").select("id").eq("project_id", params.projectId).limit(1),
      access.admin.from("project_schedule_items").select("id").eq("project_id", params.projectId).limit(1),
      access.admin.from("project_activity_history").select("id").eq("project_id", params.projectId).limit(1),
    ]);
    const checkError = checks.find((result) => result.error)?.error;
    if (checkError) return Response.json({ error: checkError.message }, { status: 400 });
    if (checks.some((result) => (result.data || []).length > 0)) {
      return Response.json({ error: "This project has allocations, activities, schedule items or tracker history. Archive it instead so its delivery record is retained." }, { status: 409 });
    }

    const { error } = await access.admin.from("projects").delete().eq("id", params.projectId);
    if (error) return Response.json({ error: error.message }, { status: 400 });
    return Response.json({ success: true });
  } catch (error) {
    return serverError(error);
  }
}

export async function PUT(request, { params }) {
  try {
    const access = await requireSession(request);
    if (access.error) return access.error;
    if (!access.isAdmin) return Response.json({ error: "Only administrators can edit the schedule." }, { status: 403 });
    const authorisation = await projectAccess(access, params.projectId);
    if (authorisation.response) return authorisation.response;

    const body = await request.json();
    if (!Array.isArray(body.schedule) || body.schedule.length > 200) {
      return Response.json({ error: "Provide no more than 200 schedule items." }, { status: 400 });
    }
    const rows = body.schedule
      .filter((r) => r && typeof r.title === "string" && r.title.trim())
      .map((r, i) => ({
        project_id: params.projectId,
        sort_order: i + 1,
        title: r.title.trim(),
        detail: opt(r.detail),
        start_date: opt(r.startDate),
        end_date: opt(r.endDate),
        milestone: !!r.milestone,
      }));

    await access.admin.from("project_schedule_items").delete().eq("project_id", params.projectId);
    if (rows.length) {
      const { error } = await access.admin.from("project_schedule_items").insert(rows);
      if (error) return Response.json({ error: error.message }, { status: 400 });
    }
    return Response.json({ success: true, count: rows.length });
  } catch (error) {
    return serverError(error);
  }
}
