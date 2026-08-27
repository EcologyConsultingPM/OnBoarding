import { requireSession, serverError } from "../../../lib/serverAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET: a staff member receives only their own project activity history. The
// service-role query is deliberately constrained by the verified session user ID,
// rather than relying on unrestricted client-side table access.
export async function GET(request) {
  try {
    const access = await requireSession(request);
    if (access.error) return access.error;

    const { data, error } = await access.admin
      .from("project_activity_history")
      .select(`
        id,
        activity_id,
        project_id,
        previous_status,
        new_status,
        note,
        changed_at,
        project:projects!project_activity_history_project_id_fkey(name, client_name),
        activity:project_activities!project_activity_history_activity_id_fkey(title, task_category, budget_hours)
      `)
      .eq("staff_user_id", access.user.id)
      .order("changed_at", { ascending: false });

    if (error) return Response.json({ error: error.message }, { status: 400 });

    const entries = (data || []).map((entry) => ({
      id: entry.id,
      activity_id: entry.activity_id,
      project_id: entry.project_id,
      project_name: entry.project?.name || "Unrecorded project",
      project_client: entry.project?.client_name || "",
      title: entry.activity?.title || "Unrecorded activity",
      task_category: entry.activity?.task_category || "",
      budget_hours: entry.activity?.budget_hours ?? null,
      previous_status: entry.previous_status,
      status: entry.new_status,
      note: entry.note || "",
      changed_at: entry.changed_at,
    }));

    return Response.json({ entries });
  } catch (error) {
    return serverError(error);
  }
}
