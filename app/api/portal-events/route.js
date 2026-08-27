import { requireSession, serverError } from "../../../lib/serverAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET: Staff receive their own active workflow events. Administrators may use
// the same endpoint for a read-only operational view by applying their own user ID.
export async function GET(request) {
  try {
    const access = await requireSession(request);
    if (access.error) return access.error;
    const limit = Math.min(Math.max(Number(new URL(request.url).searchParams.get("limit")) || 6, 1), 30);

    const { data, error } = await access.admin
      .from("portal_events")
      .select("id, event_type, severity, title, body, href, created_at, read_at")
      .eq("recipient_id", access.user.id)
      .is("dismissed_at", null)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) return Response.json({ error: error.message }, { status: 400 });

    const events = data || [];
    return Response.json({ events, unread_count: events.filter((event) => !event.read_at).length });
  } catch (error) {
    return serverError(error);
  }
}

// PATCH: A staff member may mark only their own event as read. Event content,
// severity and recipient are never client-editable.
export async function PATCH(request) {
  try {
    const access = await requireSession(request);
    if (access.error) return access.error;
    const { id } = await request.json();
    if (!id) return Response.json({ error: "Event id is required." }, { status: 400 });

    const { data, error } = await access.admin
      .from("portal_events")
      .update({ read_at: new Date().toISOString() })
      .eq("id", id)
      .eq("recipient_id", access.user.id)
      .select("id, read_at")
      .maybeSingle();
    if (error) return Response.json({ error: error.message }, { status: 400 });
    if (!data) return Response.json({ error: "Event not found." }, { status: 404 });

    return Response.json({ event: data });
  } catch (error) {
    return serverError(error);
  }
}
