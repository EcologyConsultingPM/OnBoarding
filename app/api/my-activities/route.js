import { requireSession, serverError } from "../../../lib/serverAuth";
import { requirePortalResource } from "../../../lib/portalVisibility";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_STATUSES = new Set(["not_commenced", "active", "need_info", "paused_other", "qa_review", "completed"]);
const ACCEPTANCE_STATES = new Set(["awaiting_response", "accepted", "declined", "actioned"]);
const COLUMNS = "id, project_id, staff_user_id, task_category, title, detail, budget_hours, due_date, status, pause_reason, sort_order, updated_at, created_at, schedule_item_id, acceptance_status, response_note, assigned_at, accepted_at, declined_at, actioned_at, started_at, completed_at, assigned_by, progress_percent, locked, is_active";
const ASSIGNMENT_COLUMNS = "id, activity_id, staff_user_id, allocated_hours, role, acceptance_status, response_note, assigned_at, accepted_at, declined_at, actioned_at, assigned_by, notified_at, removed_at, created_at, updated_at";

function text(value, limit = 5000) {
  return typeof value === "string" ? value.trim().slice(0, limit) : "";
}
function progress(value) {
  if (value === undefined || value === null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(100, Math.round(number * 100) / 100)) : null;
}
function isAssignmentSchemaError(error) {
  const code = String(error?.code || "");
  const message = String(error?.message || "").toLowerCase();
  return code === "42P01" || code === "PGRST205" || code === "PGRST200"
    || message.includes("project_activity_assignees")
    || message.includes("schema cache")
    || message.includes("does not exist");
}
function activeAssignments(rows) {
  return (rows || []).filter((row) => row.acceptance_status !== "removed");
}
function assignmentResponse(assignment) {
  return {
    id: assignment.id,
    staffUserId: assignment.staff_user_id,
    allocatedHours: Number(assignment.allocated_hours || 0),
    role: assignment.role || "contributor",
    acceptanceStatus: assignment.acceptance_status,
    acceptance_status: assignment.acceptance_status,
    responseNote: assignment.response_note || "",
    response_note: assignment.response_note || null,
    assignedAt: assignment.assigned_at || null,
    acceptedAt: assignment.accepted_at || null,
    declinedAt: assignment.declined_at || null,
    actionedAt: assignment.actioned_at || null,
    assignedBy: assignment.assigned_by || null,
    notifiedAt: assignment.notified_at || null,
  };
}
async function createEvent(admin, values) {
  const { error } = await admin.from("portal_events").insert(values);
  return error ? error.message : null;
}

async function refreshLinkedSchedule(admin, activity, now) {
  if (!activity.schedule_item_id) return null;
  const { data: related, error: relatedError } = await admin.from("project_activities").select("status, progress_percent").eq("schedule_item_id", activity.schedule_item_id).eq("is_active", true);
  if (relatedError) return relatedError.message;
  const activities = related || [];
  if (!activities.length) return null;
  const progressPercent = Math.round((activities.reduce((sum, item) => sum + Number(item.progress_percent || 0), 0) / activities.length) * 100) / 100;
  const statuses = new Set(activities.map((item) => item.status));
  const status = statuses.has("paused_other") || statuses.has("need_info")
    ? statuses.has("need_info") ? "need_info" : "paused_other"
    : statuses.has("active") || statuses.has("qa_review")
      ? statuses.has("qa_review") ? "qa_review" : "active"
      : statuses.size && [...statuses].every((value) => value === "completed") ? "completed" : "not_commenced";
  const { error } = await admin.from("project_schedule_items").update({ progress_percent: progressPercent, status, updated_at: now }).eq("id", activity.schedule_item_id);
  return error ? error.message : null;
}

async function joinedAssignmentsForActivities(admin, activityIds, staffUserId = null) {
  if (!activityIds.length) return { available: true, rows: [], byActivity: new Map() };
  let query = admin.from("project_activity_assignees").select(ASSIGNMENT_COLUMNS).in("activity_id", activityIds).neq("acceptance_status", "removed");
  if (staffUserId) query = query.eq("staff_user_id", staffUserId);
  const result = await query;
  if (result.error) {
    if (isAssignmentSchemaError(result.error)) return { available: false, rows: [], byActivity: new Map() };
    throw new Error(result.error.message);
  }
  const byActivity = new Map();
  for (const row of result.data || []) {
    const collection = byActivity.get(row.activity_id) || [];
    collection.push(row);
    byActivity.set(row.activity_id, collection);
  }
  return { available: true, rows: result.data || [], byActivity };
}

export async function GET(request) {
  try {
    const access = await requireSession(request);
    if (access.error) return access.error;
    const denied = await requirePortalResource(access, "staff.projects.activities");
    if (denied) return denied;
    const { data: activeProjects, error: activeError } = await access.admin.from("projects").select("id").eq("status", "active").is("deleted_at", null);
    if (activeError) return Response.json({ error: activeError.message }, { status: 400 });
    const activeIds = (activeProjects || []).map((project) => project.id);
    if (!activeIds.length) return Response.json({ activities: [] });

    const { data: candidates, error: candidateError } = await access.admin
      .from("project_activities")
      .select("id, project_id, staff_user_id, title, task_category, detail, budget_hours, due_date, status, acceptance_status, progress_percent, response_note, projects!project_activities_project_id_fkey(name)")
      .eq("is_active", true)
      .in("project_id", activeIds)
      .order("due_date", { ascending: true, nullsFirst: false })
      .limit(400);
    if (candidateError) return Response.json({ error: candidateError.message }, { status: 400 });

    const assignmentState = await joinedAssignmentsForActivities(access.admin, (candidates || []).map((activity) => activity.id), access.user.id);
    const visible = assignmentState.available
      ? (candidates || []).filter((activity) => (assignmentState.byActivity.get(activity.id) || []).some((assignment) => assignment.staff_user_id === access.user.id && assignment.acceptance_status !== "declined"))
      : (candidates || []).filter((activity) => activity.staff_user_id === access.user.id && activity.acceptance_status !== "declined");
    return Response.json({
      activities: visible.slice(0, 200).map((activity) => {
        const assignment = assignmentState.available ? (assignmentState.byActivity.get(activity.id) || [])[0] : null;
        return {
          id: activity.id,
          projectId: activity.project_id,
          project: activity.projects?.name || "Project",
          title: activity.title,
          taskCategory: activity.task_category || "",
          detail: activity.detail || "",
          budgetHours: activity.budget_hours,
          dueDate: activity.due_date || null,
          status: activity.status,
          acceptanceStatus: assignment?.acceptance_status || activity.acceptance_status,
          progressPercent: activity.progress_percent,
          responseNote: assignment?.response_note || activity.response_note || "",
          assignment: assignment ? assignmentResponse(assignment) : null,
        };
      }),
      multiAssigneeReady: assignmentState.available,
    });
  } catch (error) {
    return serverError(error);
  }
}

export async function PATCH(request) {
  try {
    const access = await requireSession(request);
    if (access.error) return access.error;
    const body = await request.json();
    const adminOverride = access.isAdmin && body?.administratorOverride === true;
    if (body?.administratorOverride === true && !access.isAdmin) return Response.json({ error: "Only administrators can override a work activity status." }, { status: 403 });
    const denied = await requirePortalResource(access, adminOverride ? "admin.projects.tracker" : "staff.projects.activities");
    if (denied) return denied;

    const id = body.id || new URL(request.url).searchParams.get("id");
    const action = String(body.action || "");
    if (!id) return Response.json({ error: "Activity id is required." }, { status: 400 });
    if (adminOverride && action) return Response.json({ error: "An administrator override can update delivery status only." }, { status: 400 });
    const { data: existing, error: readError } = await access.admin.from("project_activities").select(COLUMNS).eq("id", id).eq("is_active", true).maybeSingle();
    if (readError) return Response.json({ error: readError.message }, { status: 400 });
    if (!existing) {
      const { data: retired } = await access.admin.from("project_activities").select("id").eq("id", id).maybeSingle();
      return retired ? Response.json({ error: "This activity was withdrawn or replaced by the project lead. No action is needed.", withdrawn: true }, { status: 410 }) : Response.json({ error: "Activity not found." }, { status: 404 });
    }

    const assignmentState = await joinedAssignmentsForActivities(access.admin, [existing.id]);
    const allAssignments = assignmentState.available ? activeAssignments(assignmentState.byActivity.get(existing.id)) : [];
    const callerAssignment = assignmentState.available ? allAssignments.find((assignment) => assignment.staff_user_id === access.user.id) || null : null;
    // Joined assignments are authoritative. A staff member cannot operate a
    // colleague's response merely because the legacy scalar happens to point to
    // that colleague; legacy scalar checks remain only before the migration.
    if (!access.isAdmin && assignmentState.available && !callerAssignment) return Response.json({ error: "You can update only your own project activities." }, { status: 403 });
    if (!access.isAdmin && !assignmentState.available && existing.staff_user_id !== access.user.id) return Response.json({ error: "You can update only your own project activities." }, { status: 403 });
    if (adminOverride && assignmentState.available && !allAssignments.length) return Response.json({ error: "Assign this activity to a staff member before recording an administrator status override." }, { status: 409 });
    if (adminOverride && !assignmentState.available && !existing.staff_user_id) return Response.json({ error: "Assign this activity to a staff member before recording an administrator status override." }, { status: 409 });
    if (existing.locked && !access.isAdmin) return Response.json({ error: "This activity is locked for project-lead review." }, { status: 409 });
    if (!access.isAdmin) {
      const { data: liveProject, error: projectError } = await access.admin.from("projects").select("id").eq("id", existing.project_id).eq("status", "active").is("deleted_at", null).maybeSingle();
      if (projectError) return Response.json({ error: projectError.message }, { status: 400 });
      if (!liveProject) return Response.json({ error: "This project is no longer active." }, { status: 410 });
    }

    const now = new Date().toISOString();
    const values = { updated_at: now };
    const assignmentValues = { updated_at: now };
    const responseNote = text(body.responseNote ?? body.pauseReason);
    const overrideReason = adminOverride ? text(body.overrideReason) : "";
    let event = null;
    let recordHistory = false;
    const previousStatus = existing.status;
    const currentAcceptance = assignmentState.available ? callerAssignment?.acceptance_status : existing.acceptance_status;
    const currentResponse = assignmentState.available ? callerAssignment?.response_note : existing.response_note;

    if (action === "accept") {
      if (adminOverride) return Response.json({ error: "An administrator override can update delivery status only." }, { status: 400 });
      if (currentAcceptance !== "awaiting_response") return Response.json({ error: "This activity is no longer awaiting acceptance.", acceptance_status: currentAcceptance }, { status: 409 });
      assignmentValues.acceptance_status = "accepted";
      assignmentValues.accepted_at = now;
      assignmentValues.response_note = responseNote || null;
      if (!assignmentState.available) Object.assign(values, assignmentValues);
      event = { type: "project_activity_accepted", severity: "information", title: "Project activity accepted", body: `${existing.title}${responseNote ? ` · ${responseNote}` : ""}` };
    } else if (action === "decline") {
      if (adminOverride) return Response.json({ error: "An administrator override can update delivery status only." }, { status: 400 });
      if (currentAcceptance !== "awaiting_response") return Response.json({ error: "Only activities awaiting a response can be declined.", acceptance_status: currentAcceptance }, { status: 409 });
      if (!responseNote) return Response.json({ error: "Please provide a reason or reassignment request." }, { status: 400 });
      assignmentValues.acceptance_status = "declined";
      assignmentValues.declined_at = now;
      assignmentValues.response_note = responseNote;
      if (!assignmentState.available) Object.assign(values, assignmentValues);
      event = { type: "project_activity_declined", severity: "action_required", title: "Project activity declined / reassignment requested", body: `${existing.title} · ${responseNote}` };
    } else if (action === "actioned") {
      if (adminOverride) return Response.json({ error: "An administrator override can update delivery status only." }, { status: 400 });
      if (!ACCEPTANCE_STATES.has(currentAcceptance) || currentAcceptance === "declined") return Response.json({ error: "This activity cannot be actioned." }, { status: 409 });
      assignmentValues.acceptance_status = "actioned";
      assignmentValues.actioned_at = now;
      assignmentValues.response_note = responseNote || currentResponse || null;
      if (!assignmentState.available) Object.assign(values, assignmentValues);
      event = { type: "project_activity_actioned", severity: "information", title: "Project activity actioned", body: `${existing.title}${responseNote ? ` · ${responseNote}` : ""}` };
    } else {
      // Activity delivery status is shared, but a normal staff update is gated
      // by that caller's own accepted/actioned assignment—not the scalar row.
      if (!adminOverride && !["accepted", "actioned"].includes(currentAcceptance)) return Response.json({ error: "Accept this activity before updating its delivery status." }, { status: 409 });
      const status = String(body.status || "");
      if (!ALLOWED_STATUSES.has(status)) return Response.json({ error: "Choose a valid activity status." }, { status: 400 });
      if (adminOverride && overrideReason.length < 10) return Response.json({ error: "Enter a clear administrator override reason (at least 10 characters)." }, { status: 400 });
      if (status === "paused_other" && !(adminOverride ? overrideReason : responseNote)) return Response.json({ error: "A reason is required when an activity is paused." }, { status: 400 });
      const requestedProgress = progress(body.progressPercent);
      const auditNote = adminOverride ? `Administrator override: ${overrideReason}` : responseNote;
      values.status = status;
      values.pause_reason = status === "paused_other" ? auditNote : null;
      values.progress_percent = status === "completed" ? 100 : requestedProgress ?? Number(existing.progress_percent || 0);
      // A staff delivery note is their own response context; do not overwrite
      // any other recipient's response_note in joined mode.
      if (assignmentState.available && callerAssignment && !adminOverride && auditNote) assignmentValues.response_note = auditNote;
      if (!assignmentState.available) values.response_note = auditNote || existing.response_note || null;
      if (status === "active" && !existing.started_at) values.started_at = now;
      if (status === "completed") values.completed_at = now;
      recordHistory = adminOverride || existing.status !== status || (existing.pause_reason || null) !== values.pause_reason;
      if (recordHistory) event = adminOverride
        ? { type: "project_activity_administrator_override", severity: status === "paused_other" || status === "need_info" ? "action_required" : "information", title: "Work activity status updated by an administrator", body: `${existing.title} · ${status.replaceAll("_", " ")} · ${overrideReason}` }
        : { type: "project_activity_status", severity: status === "paused_other" || status === "need_info" ? "action_required" : "information", title: `Project activity ${status.replaceAll("_", " ")}`, body: `${existing.title} · ${values.progress_percent}%${responseNote ? ` · ${responseNote}` : ""}` };
    }

    let responseAssignment = callerAssignment;
    if (assignmentState.available && callerAssignment && Object.keys(assignmentValues).length > 1) {
      const { data, error } = await access.admin.from("project_activity_assignees").update(assignmentValues).eq("id", callerAssignment.id).select(ASSIGNMENT_COLUMNS).single();
      if (error) return Response.json({ error: error.message }, { status: 400 });
      responseAssignment = data;
    }
    const { data: activity, error: updateError } = await access.admin.from("project_activities").update(values).eq("id", existing.id).select(COLUMNS).single();
    if (updateError) return Response.json({ error: updateError.message }, { status: 400 });

    if (recordHistory) {
      // The history actor is always the caller. For normal staff work, the staff
      // identity is the caller; a controlled admin override writes one row for
      // each currently active recipient so each notified recipient has traceable
      // delivery history without inventing a scalar owner.
      const historyStaffIds = adminOverride
        ? (assignmentState.available ? allAssignments.map((assignment) => assignment.staff_user_id) : [existing.staff_user_id]).filter(Boolean)
        : [access.user.id];
      for (const staffUserId of [...new Set(historyStaffIds)]) {
        const note = values.pause_reason || (assignmentState.available ? assignmentValues.response_note : values.response_note) || `Status changed to ${activity.status.replaceAll("_", " ")}.`;
        const { error: historyError } = await access.admin.from("project_activity_history").insert({ activity_id: activity.id, project_id: activity.project_id, staff_user_id: staffUserId, previous_status: previousStatus, new_status: activity.status, note, changed_by: access.user.id, changed_at: now });
        if (historyError) return Response.json({ error: `Activity updated, but its audit history could not be recorded: ${historyError.message}` }, { status: 500 });
      }
    }

    const scheduleWarning = await refreshLinkedSchedule(access.admin, activity, now);
    if (["accept", "decline"].includes(action)) {
      await access.admin.from("portal_events").update({ read_at: now }).eq("recipient_id", access.user.id).eq("source_table", "project_activities").eq("source_id", activity.id).is("read_at", null);
    }

    const recipients = adminOverride
      ? (assignmentState.available ? allAssignments.map((assignment) => assignment.staff_user_id) : [existing.staff_user_id]).filter(Boolean)
      : [assignmentState.available ? callerAssignment?.assigned_by : existing.assigned_by].filter(Boolean);
    let eventWarning = null;
    if (event && recipients.length) {
      const targets = [...new Set(recipients)].filter((recipientId) => recipientId !== access.user.id);
      if (targets.length) eventWarning = await createEvent(access.admin, targets.map((recipientId) => ({ recipient_id: recipientId, event_type: event.type, severity: event.severity, title: event.title, body: event.body, href: adminOverride ? "/staff/project-tracker" : `/?portal=admin&area=adminprojects&project=${activity.project_id}`, source_table: "project_activities", source_id: activity.id })));
    }

    // Kept as an explicit scalar-compatible expression for older source
    // consumers. Joined override notifications above fan out to all assignees.
    const recipientId = adminOverride ? existing.staff_user_id : existing.assigned_by || null;
    return Response.json({ activity: { ...activity, acceptance_status: responseAssignment?.acceptance_status || activity.acceptance_status, response_note: responseAssignment?.response_note || activity.response_note, assignment: responseAssignment ? assignmentResponse(responseAssignment) : null }, schedule_warning: scheduleWarning || null, event_warning: eventWarning || null, multiAssigneeReady: assignmentState.available, recipientId });
  } catch (error) {
    return serverError(error);
  }
}
