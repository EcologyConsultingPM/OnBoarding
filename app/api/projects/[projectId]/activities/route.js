import { requireSession, serverError } from "../../../../../lib/serverAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const COLUMNS = "id, project_id, staff_user_id, task_category, title, detail, budget_hours, status, pause_reason, sort_order, updated_at";

function opt(v) { const t = typeof v === "string" ? v.trim() : ""; return t || null; }
function num(v) { if (v === "" || v == null) return null; const n = Number(v); return Number.isFinite(n) ? n : null; }

async function requireProject(access, projectId) {
  const { data } = await access.admin.from("projects").select("id").eq("id", projectId).maybeSingle();
  return !!data;
}

// GET: activities for a project (admin any; staff only if allocated — RLS enforces).
export async function GET(request, { params }) {
  try {
    const access = await requireSession(request);
    if (access.error) return access.error;

    const { data, error } = await access.admin
      .from("project_activities").select(COLUMNS)
      .eq("project_id", params.projectId).order("sort_order", { ascending: true });
    if (error) return Response.json({ error: error.message }, { status: 400 });

    let rows = data || [];
    if (rows.length) {
      const { data: users } = await access.admin.auth.admin.listUsers();
      const emailById = new Map((users?.users || []).map((u) => [u.id, u.email]));
      rows = rows.map((r) => ({ ...r, staff_email: r.staff_user_id ? emailById.get(r.staff_user_id) || null : null }));
    }
    return Response.json({ activities: rows });
  } catch (error) {
    return serverError(error);
  }
}

// PUT: admin replaces the full activity list for a project (setup/allocation).
export async function PUT(request, { params }) {
  try {
    const access = await requireSession(request);
    if (access.error) return access.error;
    if (!access.isAdmin) return Response.json({ error: "Only administrators can manage activities." }, { status: 403 });
    if (!(await requireProject(access, params.projectId))) return Response.json({ error: "Project not found." }, { status: 404 });

    const body = await request.json();
    if (!Array.isArray(body.activities) || body.activities.length > 200) {
      return Response.json({ error: "Provide no more than 200 activities." }, { status: 400 });
    }
    const rows = body.activities
      .filter((a) => a && typeof a.title === "string" && a.title.trim())
      .map((a, i) => ({
        project_id: params.projectId,
        staff_user_id: opt(a.staffUserId),
        task_category: opt(a.taskCategory),
        title: a.title.trim(),
        detail: opt(a.detail),
        budget_hours: num(a.budgetHours),
        status: a.status || "not_commenced",
        pause_reason: opt(a.pauseReason),
        sort_order: i + 1,
        created_by: access.user.id,
      }));

    await access.admin.from("project_activities").delete().eq("project_id", params.projectId);
    if (rows.length) {
      const { error } = await access.admin.from("project_activities").insert(rows);
      if (error) return Response.json({ error: error.message }, { status: 400 });
    }
    return Response.json({ success: true, count: rows.length });
  } catch (error) {
    return serverError(error);
  }
}
