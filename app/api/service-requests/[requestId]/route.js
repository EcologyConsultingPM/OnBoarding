import { requireSession, serverError } from "../../../../lib/serverAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const COLUMNS = "id, request_type, title, details, status, admin_note, reviewed_by, reviewed_at, created_by, created_at, updated_at";

export async function PATCH(request, { params }) {
  try {
    const access = await requireSession(request);
    if (access.error) return access.error;
    const body = await request.json();
    const action = body.action;

    // Load the request to check ownership / permissions.
    const { data: existing, error: loadErr } = await access.admin
      .from("service_requests").select("id, created_by, status").eq("id", params.requestId).single();
    if (loadErr || !existing) return Response.json({ error: "Request not found." }, { status: 404 });

    // Admin actions: approve / decline (with optional note).
    if (action === "approve" || action === "decline") {
      if (!access.isAdmin) return Response.json({ error: "Administrators only." }, { status: 403 });
      const { data, error } = await access.admin
        .from("service_requests")
        .update({
          status: action === "approve" ? "approved" : "declined",
          admin_note: (body.admin_note || "").toString().trim() || null,
          reviewed_by: access.user.id,
          reviewed_at: new Date().toISOString(),
        })
        .eq("id", params.requestId).select(COLUMNS).single();
      if (error) return Response.json({ error: error.message }, { status: 400 });
      return Response.json({ request: data });
    }

    // Staff action: cancel own request while still submitted.
    if (action === "cancel") {
      if (existing.created_by !== access.user.id) return Response.json({ error: "You can only cancel your own request." }, { status: 403 });
      if (existing.status !== "submitted") return Response.json({ error: "Only submitted requests can be cancelled." }, { status: 400 });
      const { data, error } = await access.admin
        .from("service_requests").update({ status: "cancelled" }).eq("id", params.requestId).select(COLUMNS).single();
      if (error) return Response.json({ error: error.message }, { status: 400 });
      return Response.json({ request: data });
    }

    return Response.json({ error: "Unknown action." }, { status: 400 });
  } catch (error) {
    return serverError(error);
  }
}
