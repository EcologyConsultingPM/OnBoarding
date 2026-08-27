import { requireSession, serverError } from "../../../lib/serverAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_STATUSES = new Set([
  "not_commenced",
  "active",
  "need_info",
  "paused_other",
  "qa_review",
  "completed",
]);

// PATCH: Staff can update only their own allocated activity. Every actual change
// is appended to project_activity_history so the Timesheets domain has a genuine
// tracker-entry history rather than only the current project_activity state.
export async function PATCH(request) {
  try {
    const access = await requireSession(request);
    if (access.error) return access.error;

    const body = await request.json();
    const id = body.id;
    const status = body.status;
    const pauseReason = typeof body.pauseReason === "string" ? body.pauseReason.trim() : null;

    if (!id) return Response.json({ error: "Activity id is required." }, { status: 400 });
    if (!ALLOWED_STATUSES.has(status)) return Response.json({ error: "Invalid activity status." }, { status: 400 });
    if (status === "paused_other" && !pauseReason) {
      return Response.json({ error: "A reason is required when an activity is paused." }, { status: 400 });
    }

    const { data: existing, error: readError } = await access.admin
      .from("project_activities")
      .select("id, project_id, staff_user_id, status, pause_reason")
      .eq("id", id)
      .maybeSingle();

    if (readError) return Response.json({ error: readError.message }, { status: 400 });
    if (!existing) return Response.json({ error: "Activity not found." }, { status: 404 });
    if (!access.isAdmin && existing.staff_user_id !== access.user.id) {
      return Response.json({ error: "You can update only your own project activities." }, { status: 403 });
    }

    const newPauseReason = status === "paused_other" ? pauseReason : null;
    const unchanged = existing.status === status && (existing.pause_reason || null) === newPauseReason;
    const now = new Date().toISOString();

    const { data: activity, error: updateError } = await access.admin
      .from("project_activities")
      .update({ status, pause_reason: newPauseReason, updated_at: now })
      .eq("id", existing.id)
      .select("*")
      .single();

    if (updateError) return Response.json({ error: updateError.message }, { status: 400 });

    if (!unchanged) {
      const note = status === "paused_other"
        ? newPauseReason
        : `Status changed to ${status.replaceAll("_", " ")}.`;
      const { error: historyError } = await access.admin
        .from("project_activity_history")
        .insert({
          activity_id: existing.id,
          project_id: existing.project_id,
          staff_user_id: existing.staff_user_id,
          previous_status: existing.status,
          new_status: status,
          note,
          changed_by: access.user.id,
          changed_at: now,
        });
      if (historyError) return Response.json({ error: `Activity was updated but history could not be recorded: ${historyError.message}` }, { status: 500 });
    }

    return Response.json({ activity });
  } catch (error) {
    return serverError(error);
  }
}
