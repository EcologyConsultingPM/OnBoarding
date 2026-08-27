import { requireSession, serverError } from "../../../lib/serverAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function unavailable(error) {
  const code = String(error?.code || ""); const message = String(error?.message || "").toLowerCase();
  return code === "42P01" || code === "PGRST205" || message.includes("does not exist") || message.includes("schema cache");
}

// GET: a staff member receives only their own immutable activity history and
// their own structured Project Tracker entries. The service-role query is always
// constrained by the verified session user ID, never by a browser-supplied ID.
export async function GET(request) {
  try {
    const access = await requireSession(request);
    if (access.error) return access.error;

    const [historyResult, trackerResult] = await Promise.all([
      access.admin.from("project_activity_history").select(`
        id, activity_id, project_id, previous_status, new_status, note, changed_at,
        project:projects!project_activity_history_project_id_fkey(name, client_name),
        activity:project_activities!project_activity_history_activity_id_fkey(title, task_category, budget_hours)
      `).eq("staff_user_id", access.user.id).order("changed_at", { ascending: false }),
      access.admin.from("project_tracker_entries").select(`
        id, project_id, work_date, activity_category, activity_information, hours, status, notable_issues, created_at, updated_at,
        project:projects!project_tracker_entries_project_id_fkey(name, client_name),
        allocation:project_budget_allocations!project_tracker_entries_budget_allocation_id_fkey(allocation_code, allocation_name)
      `).eq("staff_user_id", access.user.id).order("work_date", { ascending: false }).order("created_at", { ascending: false }).limit(500),
    ]);
    if (historyResult.error) return Response.json({ error: historyResult.error.message }, { status: 400 });
    if (trackerResult.error && !unavailable(trackerResult.error)) return Response.json({ error: trackerResult.error.message }, { status: 400 });

    const activityEntries = (historyResult.data || []).map((entry) => ({
      id: `activity-${entry.id}`,
      entry_type: "activity_status",
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
      work_date: null,
      hours: null,
      notable_issues: "",
    }));
    const trackerEntries = (trackerResult.data || []).map((entry) => ({
      id: `tracker-${entry.id}`,
      entry_type: "tracker_entry",
      activity_id: null,
      project_id: entry.project_id,
      project_name: entry.project?.name || "Unrecorded project",
      project_client: entry.project?.client_name || "",
      title: entry.activity_information || "Project Tracker entry",
      task_category: entry.activity_category || "",
      budget_hours: null,
      previous_status: null,
      status: entry.status,
      note: entry.activity_information || "",
      notable_issues: entry.notable_issues || "",
      allocation: entry.allocation ? `${entry.allocation.allocation_code} · ${entry.allocation.allocation_name}` : "",
      work_date: entry.work_date,
      hours: entry.hours,
      changed_at: entry.created_at || entry.updated_at,
    }));
    const entries = [...trackerEntries, ...activityEntries].sort((left, right) => new Date(right.changed_at || 0) - new Date(left.changed_at || 0));
    return Response.json({ entries, trackerEntriesAvailable: !trackerResult.error });
  } catch (error) {
    return serverError(error);
  }
}
