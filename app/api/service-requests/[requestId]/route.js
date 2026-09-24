import { requireSession, serverError } from "../../../../lib/serverAuth";
import { requirePortalResource } from "../../../../lib/portalVisibility";
import { compactAuditRecord, recordAudit } from "../../../../lib/auditLog";
import { sendPortalEmail } from "../../../../lib/transactionalEmail";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const COLUMNS = "id, request_type, title, details, status, decision_status, admin_note, return_reason, reviewed_by, reviewed_at, created_by, project_id, assigned_to, priority, due_date, estimated_hours, attachments, locked, archived_at, submission_key, seen_by_staff, created_at, updated_at";
const ADMIN_ACTIONS = new Set(["approve", "decline", "close"]);
const text = (value, maximum = 3000) => {
  const clean = String(value || "").trim();
  return clean ? clean.slice(0, maximum) : null;
};

async function notifyUser(admin, request, recipientId, eventType, severity, title, body, emailRequest) {
  if (!recipientId) return;
  try {
    await admin.from("portal_events").insert({ recipient_id: recipientId, event_type: eventType, severity, title, body, href: "/staff/service-requests", source_table: "service_requests", source_id: request.id });
    const { data } = await admin.auth.admin.getUserById(recipientId);
    const email = data?.user?.email;
    if (email) await sendPortalEmail({ request: emailRequest, to: email, subject: title, heading: title, body, ctaLabel: "Open Service Requests", ctaPath: "/staff/service-requests" });
  } catch (error) {
    console.error("Service request notification failed", error);
  }
}

export async function PATCH(request, { params }) {
  try {
    const access = await requireSession(request);
    if (access.error) return access.error;
    const denied = await requirePortalResource(access, access.isAdmin ? "admin.service_requests" : "staff.service_requests");
    if (denied) return denied;

    const body = await request.json();
    const action = String(body.action || "").trim();
    const now = new Date().toISOString();
    const { data: existing, error: loadError } = await access.admin.from("service_requests").select(COLUMNS).eq("id", params.requestId).single();
    if (loadError || !existing) return Response.json({ error: "Request not found." }, { status: 404 });
    if (existing.locked) return Response.json({ error: "This request is locked and retained as a closed record." }, { status: 409 });

    if (!access.isAdmin) {
      if (existing.created_by !== access.user.id) return Response.json({ error: "You can only update your own request." }, { status: 403 });
      if (action === "cancel" && existing.status === "submitted") {
        const { data, error } = await access.admin.from("service_requests").update({ status: "cancelled", updated_at: now }).eq("id", existing.id).select(COLUMNS).single();
        if (error) return Response.json({ error: error.message }, { status: 400 });
        await recordAudit(access.admin, { actorId: access.user.id, action: "cancelled", entityType: "service_request", entityId: data.id, projectId: data.project_id, resourceKey: "staff.service_requests", beforeData: compactAuditRecord(existing, ["status"]), afterData: compactAuditRecord(data, ["status"]) });
        return Response.json({ request: data });
      }
      return Response.json({ error: "This request cannot be changed at its current status." }, { status: 409 });
    }

    if (!ADMIN_ACTIONS.has(action)) return Response.json({ error: "Choose approve, deny, or close and lock." }, { status: 400 });
    if (["closed", "archived", "cancelled"].includes(existing.status)) return Response.json({ error: "This request is already closed or otherwise final." }, { status: 409 });

    const note = text(body.note ?? body.admin_note, 3000);
    const values = { updated_at: now };
    let event = null;

    if (action === "approve") {
      values.status = "approved";
      values.decision_status = "approved";
      values.admin_note = note;
      values.reviewed_by = access.user.id;
      values.reviewed_at = now;
      event = [existing.created_by, "service_request_approved", "information", `Service request approved: ${existing.title}`, note || "Your request has been approved."];
    }
    if (action === "decline") {
      values.status = "declined";
      values.decision_status = "declined";
      values.admin_note = note;
      values.reviewed_by = access.user.id;
      values.reviewed_at = now;
      event = [existing.created_by, "service_request_declined", "action", `Service request denied: ${existing.title}`, note || "Your request has been denied."];
    }
    if (action === "close") {
      values.status = "closed";
      values.locked = true;
      values.admin_note = note || existing.admin_note;
      event = [existing.created_by, "service_request_closed", "information", `Service request closed and locked: ${existing.title}`, note || "Your request has been closed and locked."];
    }
    const { data, error } = await access.admin.from("service_requests").update(values).eq("id", existing.id).select(COLUMNS).single();
    if (error) return Response.json({ error: error.message }, { status: 400 });

    await recordAudit(access.admin, {
      actorId: access.user.id,
      action,
      entityType: "service_request",
      entityId: data.id,
      projectId: data.project_id,
      resourceKey: "admin.service_requests",
      beforeData: compactAuditRecord(existing, ["status", "decision_status", "admin_note", "reviewed_by", "reviewed_at", "locked"]),
      afterData: compactAuditRecord(data, ["status", "decision_status", "admin_note", "reviewed_by", "reviewed_at", "locked"]),
      reason: note,
    });
    if (event) await notifyUser(access.admin, data, ...event, request);
    return Response.json({ request: data });
  } catch (error) {
    return serverError(error);
  }
}
