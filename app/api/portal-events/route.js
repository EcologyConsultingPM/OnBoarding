import { requireSession, serverError } from "../../../lib/serverAuth";
import { requirePortalResource } from "../../../lib/portalVisibility";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET: Staff receive their own active workflow events. Administrators may use
// the same endpoint for a read-only operational view by applying their own user ID.
export async function GET(request) {
  try {
    const access = await requireSession(request);
    if (access.error) return access.error;
    const denied = await requirePortalResource(access, "staff.notifications");
    if (denied) return denied;
    const limit = Math.min(Math.max(Number(new URL(request.url).searchParams.get("limit")) || 6, 1), 30);

    const { data, error } = await access.admin
      .from("portal_events")
      .select("id, event_type, severity, title, body, href, created_at, read_at, deferred_until, source_table, source_id")
      .eq("recipient_id", access.user.id)
      .is("dismissed_at", null)
      .or(`deferred_until.is.null,deferred_until.lte.${new Date().toISOString()}`)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) return Response.json({ error: error.message }, { status: 400 });

    const events = data || [];

    // Project the CURRENT state of the underlying activity onto each event.
    // Without this the client had nothing to gate its Accept/Decline buttons on
    // (it checked `event.response_action`, a field nothing ever wrote), so the
    // buttons rendered on every assignment notification forever — including
    // ones whose activity had since been deleted (is_active = false), which is
    // why responding returned "Activity not found." with a bare 404. The client
    // can now render those as withdrawn, and already-answered ones as resolved.
    const activityIds = [...new Set(
      events
        .filter((event) => event.source_table === "project_activities" && event.source_id)
        .map((event) => event.source_id),
    )];

    let activityById = new Map();
    if (activityIds.length) {
      const { data: activities, error: activityError } = await access.admin
        .from("project_activities")
        .select("id, is_active, acceptance_status, response_note, title, detail, due_date, task_category, budget_hours, projects!project_activities_project_id_fkey(name)")
        .in("id", activityIds);
      // A failure here must not break the inbox: fall back to leaving the
      // activity fields undefined, which the client treats as "unknown" and
      // behaves exactly as it did before.
      if (!activityError) activityById = new Map((activities || []).map((activity) => [activity.id, activity]));
    }

    const enriched = events.map((event) => {
      if (event.source_table !== "project_activities" || !event.source_id) return event;
      const activity = activityById.get(event.source_id) || null;
      return {
        ...event,
        activity_exists: Boolean(activity),
        activity_active: activity ? activity.is_active === true : false,
        acceptance_status: activity?.acceptance_status || null,
        response_note: activity?.response_note || "",
        activity_title: activity?.title || "",
        project_name: activity?.projects?.name || "",
        due_date: activity?.due_date || null,
        task_category: activity?.task_category || "",
        budget_hours: activity?.budget_hours ?? null,
        detail: activity?.detail || "",
      };
    });

    return Response.json({ events: enriched, unread_count: enriched.filter((event) => !event.read_at).length });
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

    const { data, error } = await access.admin
      .from("portal_events")
      .update(values)
      .eq("id", id)
      .eq("recipient_id", access.user.id)
      .select("id, read_at, deferred_until, dismissed_at")
      .maybeSingle();
    if (error) return Response.json({ error: error.message }, { status: 400 });
    if (!data) return Response.json({ error: "Event not found." }, { status: 404 });

    return Response.json({ event: data, action: requestedAction });
  } catch (error) {
    return serverError(error);
  }
}
