import { requireSession, serverError } from "../../../lib/serverAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const COLUMNS = "id, project_id, staff_user_id, task_category, title, detail, budget_hours, status, pause_reason, sort_order, updated_at";
const VALID = ["not_commenced", "active", "need_info", "paused_other", "qa_review", "completed"];

// GET: all activities assigned to the signed-in staff member, across projects.
export async function GET(request) {
  try {
    const access = await requireSession(request);
    if (access.error) return access.error;
    const { data, error } = await access.admin
      .from("project_activities").select(COLUMNS)
      .eq("staff_user_id", access.user.id).order("updated_at", { ascending: false });
    if (error) return Response.json({ error: error.message }, { status: 400 });
    return Response.json({ activities: data || [] });
  } catch (error) {
    return serverError(error);
  }
}

// PATCH: the assigned staff member updates the status of their own activity.
// paused_other requires a written reason (matches the business rule).
export async function PATCH(request) {
  try {
    const access = await requireSession(request);
    if (access.error) return access.error;
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");
    if (!id) return Response.json({ error: "Activity id is required." }, { status: 400 });

    const body = await request.json();
    const status = body.status;
    if (!VALID.includes(status)) return Response.json({ error: "Invalid status." }, { status: 400 });
    const pauseReason = typeof body.pauseReason === "string" ? body.pauseReason.trim() : "";
    if (status === "paused_other" && !pauseReason) {
      return Response.json({ error: "A reason is required when pausing." }, { status: 400 });
    }

    // Confirm this activity belongs to the caller before updating.
    const { data: existing } = await access.admin
      .from("project_activities").select("id, staff_user_id").eq("id", id).maybeSingle();
    if (!existing) return Response.json({ error: "Activity not found." }, { status: 404 });
    if (existing.staff_user_id !== access.user.id && !access.isAdmin) {
      return Response.json({ error: "This activity is not assigned to you." }, { status: 403 });
    }

    const { data, error } = await access.admin
      .from("project_activities")
      .update({ status, pause_reason: status === "paused_other" ? pauseReason : null })
      .eq("id", id).select(COLUMNS).single();
    if (error) return Response.json({ error: error.message }, { status: 400 });
    return Response.json({ activity: data });
  } catch (error) {
    return serverError(error);
  }
}
