import { requireSession, serverError } from "../../../lib/serverAuth";
import { requirePortalResource } from "../../../lib/portalVisibility";

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
const ACCEPTANCE_STATES = new Set(["awaiting_response", "accepted", "declined", "actioned"]);
const COLUMNS = "id, project_id, staff_user_id, task_category, title, detail, budget_hours, due_date, status, pause_reason, sort_order, updated_at, created_at, schedule_item_id, acceptance_status, response_note, assigned_at, accepted_at, declined_at, actioned_at, started_at, completed_at, assigned_by, progress_percent, locked, is_active";

function text(value, limit = 5000) {
  return typeof value === "string" ? value.trim().slice(0, limit) : "";
}

function progress(value) {
  if (value === undefined || value === null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(100, Math.round(number * 100) / 100)) : null;
}

async function createEvent(admin, values) {
  const { error } = await admin.from("portal_events").insert(values);
  return error ? error.message : null;
}

async function refreshLinkedSchedule(admin, activity, now) {
  if (!activity.schedule_item_id) return null;
  const { data: related, error: relatedError } = await admin
    .from("project_activities")
    .select("status, progress_percent")
    .eq("schedule_item_id", activity.schedule_item_id)
    .eq("is_active", true);
  if (relatedError) return relatedError.message;
  const activities = related || [];
  if (!activities.length) return null;
  const progressPercent = Math.round((activities.reduce((sum, item) => sum + Number(item.progress_percent || 0), 0) / activities.length) * 100) / 100;
  const statuses = new Set(activities.map((item) => item.status));
  const status = statuses.has("paused_other") || statuses.has("need_info")
    ? statuses.has("need_info") ? "need_info" : "paused_other"
    : statuses.has("active") || statuses.has("qa_review")
      ? statuses.has("qa_review") ? "qa_review" : "active"
      : statuses.size && [...statuses].every((value) => value === "completed")
        ? "completed"
        : "not_commenced";
  const { error } = await admin
    .from("project_schedule_items")
    .update({ progress_percent: progressPercent, status, updated_at: now })
    .eq("id", activity.schedule_item_id);
  return error ? error.message : null;
}

export async function GET(request) {
  try {
    const access = await requireSession(request);
    if (access.error) return access.error;
    const denied = await requirePortalResource(access, "staff.projects.activities");
    if (denied) return denied;

    const { data, error } = await access.admin
      .from("project_activities")
      .select("id, project_id, title, task_category, detail, budget_hours, due_date, status, acceptance_status, progress_percent, response_note, projects!project_activities_project_id_fkey(name)")
      .eq("staff_user_id", access.user.id)
      .eq("is_active", true)
      .neq("acceptance_status", "declined")
      .order("due_date", { ascending: true, nullsFirst: false })
      .limit(200);
    if (error) return Response.json({ error: error.message }, { status: 400 });
    return Response.json({
      activities: (data || []).map((activity) => ({
        id: activity.id,
        projectId: activity.project_id,
        project: activity.projects?.name || "Project",
        title: activity.title,
        taskCategory: activity.task_category || "",
        detail: activity.detail || "",
        budgetHours: activity.budget_hours,
        dueDate: activity.due_date || null,
        status: activity.status,
        acceptanceStatus: activity.acceptance_status,
        progressPercent: activity.progress_percent,
        responseNote: activity.response_note || "",
      })),
    });
  } catch (error) {
    return serverError(error);
  }
}

export async function PATCH(request) {
  try {
    const access = await requireSession(request);
    if (access.error) return access.error;
    const denied = await requirePortalResource(access, "staff.projects.activities");
    if (denied) return denied;

    const body = await request.json();
    const id = body.id || new URL(request.url).searchParams.get("id");
    const action = String(body.action || "");
    if (!id) return Response.json({ error: "Activity id is required." }, { status: 400 });

    const { data: existing, error: readError } = await access.admin
      .from("project_activities")
      .select(COLUMNS)
      .eq("id", id)
      .eq("is_active", true)
      .maybeSingle();
    if (readError) return Response.json({ error: readError.message }, { status: 400 });
    if (!existing) return Response.json({ error: "Activity not found." }, { status: 404 });
    if (!access.isAdmin && existing.staff_user_id !== access.user.id) return Response.json({ error: "You can update only your own project activities." }, { status: 403 });
    if (existing.locked && !access.isAdmin) return Response.json({ error: "This activity is locked for project-lead review." }, { status: 409 });

    const now = new Date().toISOString();
    const values = { updated_at: now };
    const responseNote = text(body.responseNote ?? body.pauseReason);
    let event = null;
    let recordHistory = false;
    let previousStatus = existing.status;

    if (action === "accept") {
      if (existing.acceptance_status !== "awaiting_response") return Response.json({ error: "This activity is no longer awaiting acceptance." }, { status: 409 });
      values.acceptance_status = "accepted";
      values.accepted_at = now;
      values.response_note = responseNote || null;
      event = { type: "project_activity_accepted", severity: "information", title: "Project activity accepted", body: `${existing.title}${responseNote ? ` · ${responseNote}` : ""}` };
    } else if (action === "decline") {
      if (existing.acceptance_status !== "awaiting_response") return Response.json({ error: "Only activities awaiting a response can be declined." }, { status: 409 });
      if (!responseNote) return Response.json({ error: "Please provide a reason or reassignment request." }, { status: 400 });
      values.acceptance_status = "declined";
      values.declined_at = now;
      values.response_note = responseNote;
      event = { type: "project_activity_declined", severity: "action_required", title: "Project activity declined / reassignment requested", body: `${existing.title} · ${responseNote}` };
    } else if (action === "actioned") {
      if (!ACCEPTANCE_STATES.has(existing.acceptance_status) || existing.acceptance_status === "declined") return Response.json({ error: "This activity cannot be actioned." }, { status: 409 });
      values.acceptance_status = "actioned";
      values.actioned_at = now;
      values.response_note = responseNote || existing.response_note || null;
      event = { type: "project_activity_actioned", severity: "information", title: "Project activity actioned", body: `${existing.title}${responseNote ? ` · ${responseNote}` : ""}` };
    } else {
      if (!["accepted", "actioned"].includes(existing.acceptance_status) && !access.isAdmin) return Response.json({ error: "Accept this activity before updating its delivery status." }, { status: 409 });
      const status = String(body.status || "");
      if (!ALLOWED_STATUSES.has(status)) return Response.json({ error: "Choose a valid activity status." }, { status: 400 });
      if (status === "paused_other" && !responseNote) return Response.json({ error: "A reason is required when an activity is paused." }, { status: 400 });
      const requestedProgress = progress(body.progressPercent);
      values.status = status;
      values.pause_reason = status === "paused_other" ? responseNote : null;
      values.progress_percent = status === "completed" ? 100 : requestedProgress ?? Number(existing.progress_percent || 0);
      values.response_note = responseNote || existing.response_note || null;
      if (status === "active" && !existing.started_at) values.started_at = now;
      if (status === "completed") values.completed_at = now;
      recordHistory = existing.status !== status || (existing.pause_reason || null) !== values.pause_reason;
      if (recordHistory || status === "completed" || status === "paused_other") {
        event = { type: "project_activity_status", severity: status === "paused_other" || status === "need_info" ? "action_required" : "information", title: `Project activity ${status.replaceAll("_", " ")}`, body: `${existing.title} · ${values.progress_percent}%${responseNote ? ` · ${responseNote}` : ""}` };
      }
    }

    const { data: activity, error: updateError } = await access.admin
      .from("project_activities")
      .update(values)
      .eq("id", existing.id)
      .select(COLUMNS)
      .single();
    if (updateError) return Response.json({ error: updateError.message }, { status: 400 });

    if (recordHistory) {
      const note = values.pause_reason || values.response_note || `Status changed to ${activity.status.replaceAll("_", " ")}.`;
      const { error: historyError } = await access.admin.from("project_activity_history").insert({
        activity_id: activity.id,
        project_id: activity.project_id,
        staff_user_id: activity.staff_user_id,
        previous_status: previousStatus,
        new_status: activity.status,
        note,
        changed_by: access.user.id,
        changed_at: now,
      });
      if (historyError) return Response.json({ error: `Activity updated, but its audit history could not be recorded: ${historyError.message}` }, { status: 500 });
    }

    const scheduleWarning = await refreshLinkedSchedule(access.admin, activity, now);
    if (["accept", "decline"].includes(action)) {
      await access.admin.from("portal_events")
        .update({ read_at: now })
        .eq("recipient_id", access.user.id)
        .eq("source_table", "project_activities")
        .eq("source_id", activity.id)
        .is("read_at", null);
    }

    const recipientId = existing.assigned_by || null;
    const eventWarning = event && recipientId && recipientId !== access.user.id
      ? await createEvent(access.admin, {
          recipient_id: recipientId,
          event_type: event.type,
          severity: event.severity,
          title: event.title,
          body: event.body,
          href: `/?portal=admin&area=adminprojects&project=${activity.project_id}`,
          source_table: "project_activities",
          source_id: activity.id,
        })
      : null;

    return Response.json({ activity, schedule_warning: scheduleWarning || null, event_warning: eventWarning || null });
  } catch (error) {
    return serverError(error);
  }
}
