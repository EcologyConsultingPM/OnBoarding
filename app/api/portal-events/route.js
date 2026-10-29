import { requireSession, serverError } from "../../../lib/serverAuth";
import { requirePortalResource } from "../../../lib/portalVisibility";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isAssignmentSchemaError(error) {
  const code = String(error?.code || "");
  const message = String(error?.message || "").toLowerCase();
  return code === "42P01" || code === "PGRST205" || code === "PGRST200"
    || message.includes("project_activity_assignees")
    || message.includes("schema cache")
    || message.includes("does not exist");
}

// GET: Staff receive their own active workflow events. Administrators may use
// the same endpoint for a read-only operational view by applying their own user ID.
export async function GET(request) {
  try {
    const access = await requireSession(request);
    if (access.error) return access.error;
    const denied = await requirePortalResource(access, "staff.notifications");
    if (denied) return denied;
    const limit = Math.min(Math.max(Number(new URL(request.url).searchParams.get("limit")) || 6, 1), 30);

    const { data, error } = await access.admin.from("portal_events")
      .select("id, event_type, severity, title, body, href, created_at, read_at, deferred_until, source_table, source_id")
      .eq("recipient_id", access.user.id)
      .is("dismissed_at", null)
      .or(`deferred_until.is.null,deferred_until.lte.${new Date().toISOString()}`)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) return Response.json({ error: error.message }, { status: 400 });
    const events = data || [];

    // Project CURRENT activity delivery state and the CURRENT caller's response
    // state onto each event. A shared activity has one delivery status but one
    // independent acceptance/decline/actioned lifecycle for each recipient.
    const activityIds = [...new Set(events.filter((event) => event.source_table === "project_activities" && event.source_id).map((event) => event.source_id))];
    let activityById = new Map();
    if (activityIds.length) {
      const { data: activities, error: activityError } = await access.admin.from("project_activities")
        .select("id, is_active, staff_user_id, acceptance_status, response_note, title, detail, due_date, task_category, budget_hours, projects!project_activities_project_id_fkey(name)")
        .in("id", activityIds);
      if (!activityError) activityById = new Map((activities || []).map((activity) => [activity.id, activity]));
    }

    let assignmentByActivity = new Map();
    let assignmentSchemaAvailable = true;
    if (activityIds.length) {
      const { data: assignments, error: assignmentError } = await access.admin.from("project_activity_assignees")
        .select("id, activity_id, staff_user_id, allocated_hours, role, acceptance_status, response_note, assigned_at, accepted_at, declined_at, actioned_at, assigned_by, notified_at")
        .in("activity_id", activityIds)
        .eq("staff_user_id", access.user.id)
        .neq("acceptance_status", "removed");
      if (assignmentError) {
        if (isAssignmentSchemaError(assignmentError)) assignmentSchemaAvailable = false;
      } else assignmentByActivity = new Map((assignments || []).map((assignment) => [assignment.activity_id, assignment]));
    }

    const enriched = events.map((event) => {
      if (event.source_table !== "project_activities" || !event.source_id) return event;
      const activity = activityById.get(event.source_id) || null;
      const assignment = assignmentSchemaAvailable ? assignmentByActivity.get(event.source_id) || null : null;
      // Legacy scalar lifecycle applies only while migration is unavailable. If
      // the table exists but the recipient was removed, the card remains safely
      // resolvable and is marked withdrawn instead of leaking another user's row.
      const legacy = !assignmentSchemaAvailable ? activity : null;
      return {
        ...event,
        activity_exists: Boolean(activity),
        activity_active: Boolean(activity && activity.is_active === true && (assignmentSchemaAvailable ? assignment : true)),
        acceptance_status: assignment?.acceptance_status || legacy?.acceptance_status || null,
        response_note: assignment?.response_note || legacy?.response_note || "",
        assignment: assignment ? {
          id: assignment.id,
          staffUserId: assignment.staff_user_id,
          allocatedHours: Number(assignment.allocated_hours || 0),
          role: assignment.role || "contributor",
          acceptanceStatus: assignment.acceptance_status,
          responseNote: assignment.response_note || "",
          assignedAt: assignment.assigned_at || null,
          acceptedAt: assignment.accepted_at || null,
          declinedAt: assignment.declined_at || null,
          actionedAt: assignment.actioned_at || null,
          assignedBy: assignment.assigned_by || null,
          notifiedAt: assignment.notified_at || null,
        } : null,
        activity_title: activity?.title || "",
        project_name: activity?.projects?.name || "",
        due_date: activity?.due_date || null,
        task_category: activity?.task_category || "",
        budget_hours: activity?.budget_hours ?? null,
        detail: activity?.detail || "",
      };
    });
    return Response.json({ events: enriched, unread_count: enriched.filter((event) => !event.read_at).length, multiAssigneeReady: assignmentSchemaAvailable });
  } catch (error) {
    return serverError(error);
  }
}

// PATCH: A staff member may manage only their own notification. Event content,
// severity, source and recipient remain server-controlled and cannot be edited.
export async function PATCH(request) {
  try {
    const access = await requireSession(request);
    if (access.error) return access.error;
    const denied = await requirePortalResource(access, "staff.notifications");
    if (denied) return denied;
    const { id, action } = await request.json();
    if (!id) return Response.json({ error: "Event id is required." }, { status: 400 });
    const now = new Date();
    const requestedAction = String(action || "read");
    if (!["read", "defer", "delete"].includes(requestedAction)) return Response.json({ error: "Choose read, defer or delete." }, { status: 400 });
    const values = requestedAction === "delete"
      ? { dismissed_at: now.toISOString(), read_at: now.toISOString() }
      : requestedAction === "defer"
        ? { deferred_until: new Date(now.getTime() + 86400000).toISOString(), read_at: now.toISOString() }
        : { read_at: now.toISOString(), deferred_until: null };
    const { data, error } = await access.admin.from("portal_events").update(values).eq("id", id).eq("recipient_id", access.user.id).select("id, read_at, deferred_until, dismissed_at").maybeSingle();
    if (error) return Response.json({ error: error.message }, { status: 400 });
    if (!data) return Response.json({ error: "Event not found." }, { status: 404 });
    return Response.json({ event: data, action: requestedAction });
  } catch (error) {
    return serverError(error);
  }
}
