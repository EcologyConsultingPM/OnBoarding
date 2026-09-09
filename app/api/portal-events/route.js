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
    return Response.json({ events, unread_count: events.filter((event) => !event.read_at).length });
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
