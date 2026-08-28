import { requireSession, serverError } from "../../../lib/serverAuth";
import { requirePortalResource } from "../../../lib/portalVisibility";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const COLUMNS = "id, request_type, title, details, status, admin_note, reviewed_by, reviewed_at, created_by, created_at, updated_at";
const TYPES = ["leave", "training", "equipment"];
const TYPE_LABELS = {
  leave: "leave request",
  training: "training request",
  equipment: "equipment request",
};

async function notifyAdministrators(admin, requestRecord, submittedBy) {
  try {
    const { data: adminRecords, error: adminError } = await admin
      .from("admin_emails")
      .select("email");
    if (adminError) throw adminError;

    const administratorEmails = new Set(
      (adminRecords || [])
        .map((record) => String(record.email || "").toLowerCase())
        .filter(Boolean),
    );
    if (!administratorEmails.size) return;

    const { data: usersData, error: usersError } = await admin.auth.admin.listUsers({
      page: 1,
      perPage: 200,
    });
    if (usersError) throw usersError;

    const recipientIds = (usersData?.users || [])
      .filter((user) => administratorEmails.has(String(user.email || "").toLowerCase()))
      .map((user) => user.id);
    if (!recipientIds.length) return;

    const { error: eventError } = await admin.from("portal_events").insert(
      recipientIds.map((recipientId) => ({
        recipient_id: recipientId,
        event_type: "service_request_submitted",
        severity: "action",
        title: `New ${TYPE_LABELS[requestRecord.request_type] || "service request"}`,
        body: `${submittedBy || "A staff member"} submitted: ${requestRecord.title}`,
        href: "/",
        source_table: "service_requests",
        source_id: requestRecord.id,
      })),
    );
    if (eventError) throw eventError;
  } catch (notificationError) {
    // The request is already recorded. A transient notification failure must not
    // discard a valid staff submission; it remains visible in the admin queue.
    console.error("Could not create service request administrator events", notificationError);
  }
}

export async function GET(request) {
  try {
    const access = await requireSession(request);
    if (access.error) return access.error;
    const denied = await requirePortalResource(
      access,
      access.isAdmin ? "admin.service_requests" : "staff.projects.service_requests",
    );
    if (denied) return denied;

    // Admins see all requests (the Service Requests queue); staff see their own.
    let query = access.admin.from("service_requests").select(COLUMNS).order("updated_at", { ascending: false });
    if (!access.isAdmin) query = query.eq("created_by", access.user.id);
    const { data, error } = await query;
    if (error) return Response.json({ error: error.message }, { status: 400 });
    const rows = data || [];

    // Attach author emails for the admin queue.
    let emailById = new Map();
    if (access.isAdmin && rows.length) {
      const { data: usersData } = await access.admin.auth.admin.listUsers({ page: 1, perPage: 200 });
      emailById = new Map((usersData?.users || []).map((u) => [u.id, u.email]));
    }
    const enriched = rows.map((r) => ({ ...r, author: emailById.get(r.created_by) || null }));

    const pending = enriched.filter((r) => r.status === "submitted").length;
    return Response.json({ requests: enriched, summary: { pending, total: enriched.length } });
  } catch (error) {
    return serverError(error);
  }
}

export async function POST(request) {
  try {
    const access = await requireSession(request);
    if (access.error) return access.error;
    const denied = await requirePortalResource(
      access,
      access.isAdmin ? "admin.service_requests" : "staff.projects.service_requests",
    );
    if (denied) return denied;
    const body = await request.json();
    if (!TYPES.includes(body.request_type)) return Response.json({ error: "Invalid request type." }, { status: 400 });
    const title = (body.title || "").toString().trim();
    if (title.length < 2) return Response.json({ error: "A short title is required." }, { status: 400 });

    const { data, error } = await access.admin
      .from("service_requests")
      .insert({
        created_by: access.user.id,
        request_type: body.request_type,
        title,
        details: body.details && typeof body.details === "object" ? body.details : {},
        status: "submitted",
      })
      .select(COLUMNS).single();
    if (error) return Response.json({ error: error.message }, { status: 400 });
    await notifyAdministrators(access.admin, data, access.user.email);
    return Response.json({ request: data }, { status: 201 });
  } catch (error) {
    return serverError(error);
  }
}
