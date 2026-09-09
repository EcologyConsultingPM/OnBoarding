import { requireSession, serverError } from "../../../../lib/serverAuth";
import { requirePortalResource } from "../../../../lib/portalVisibility";
import { compactAuditRecord, recordAudit } from "../../../../lib/auditLog";
import { sendPortalEmail } from "../../../../lib/transactionalEmail";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const COLUMNS = "id, request_type, title, details, status, admin_note, return_reason, reviewed_by, reviewed_at, created_by, project_id, assigned_to, priority, due_date, estimated_hours, attachments, locked, archived_at, submission_key, seen_by_staff, created_at, updated_at";
const text = (value, maximum = 3000) => { const clean = String(value || "").trim(); return clean ? clean.slice(0, maximum) : null; };

async function notifyUser(admin, request, recipientId, eventType, severity, title, body, emailRequest) {
  if (!recipientId) return;
  try {
    await admin.from("portal_events").insert({ recipient_id: recipientId, event_type: eventType, severity, title, body, href: "/staff/service-requests", source_table: "service_requests", source_id: request.id });
    const { data } = await admin.auth.admin.getUserById(recipientId); const email = data?.user?.email;
    if (email) await sendPortalEmail({ request: emailRequest, to: email, subject: title, heading: title, body, ctaLabel: "Open Service Requests", ctaPath: "/staff/service-requests" });
  } catch (error) { console.error("Service request notification failed", error); }
}

export async function PATCH(request, { params }) {
  try {
    const access = await requireSession(request); if (access.error) return access.error;
    const denied = await requirePortalResource(access, access.isAdmin ? "admin.service_requests" : "staff.service_requests"); if (denied) return denied;
    const body = await request.json(); const action = String(body.action || "").trim(); const now = new Date().toISOString();
    const { data: existing, error: loadError } = await access.admin.from("service_requests").select(COLUMNS).eq("id", params.requestId).single();
    if (loadError || !existing) return Response.json({ error: "Request not found." }, { status: 404 });
    if (existing.locked && action !== "unlock") return Response.json({ error: "This request is locked. An administrator must unlock it with a recorded reason before changes can be made." }, { status: 409 });

    if (!access.isAdmin) {
      if (existing.created_by !== access.user.id) return Response.json({ error: "You can only update your own request." }, { status: 403 });
      if (action === "cancel" && ["submitted", "returned"].includes(existing.status)) {
        const { data, error } = await access.admin.from("service_requests").update({ status: "cancelled", updated_at: now }).eq("id", existing.id).select(COLUMNS).single();
        if (error) return Response.json({ error: error.message }, { status: 400 });
        await recordAudit(access.admin, { actorId: access.user.id, action: "cancelled", entityType: "service_request", entityId: data.id, projectId: data.project_id, resourceKey: "staff.service_requests", beforeData: compactAuditRecord(existing, ["status"]), afterData: compactAuditRecord(data, ["status"]) });
        return Response.json({ request: data });
      }
      if (action === "resubmit" && existing.status === "returned") {
        const { data, error } = await access.admin.from("service_requests").update({ status: "submitted", return_reason: null, updated_at: now }).eq("id", existing.id).select(COLUMNS).single();
        if (error) return Response.json({ error: error.message }, { status: 400 });
        await recordAudit(access.admin, { actorId: access.user.id, action: "resubmitted", entityType: "service_request", entityId: data.id, projectId: data.project_id, resourceKey: "staff.service_requests", beforeData: compactAuditRecord(existing, ["status"]), afterData: compactAuditRecord(data, ["status"]) });
        return Response.json({ request: data });
      }
      return Response.json({ error: "This request cannot be changed at its current status." }, { status: 409 });
    }

    if (!["approve", "decline", "return", "assign", "start", "close", "archive", "reopen", "lock", "unlock"].includes(action)) return Response.json({ error: "Choose a valid administrator action." }, { status: 400 });
    if (["archived", "closed"].includes(existing.status) && !["reopen", "archive"].includes(action)) return Response.json({ error: "Closed or archived requests must be reopened before further changes." }, { status: 409 });
    const note = text(body.note ?? body.admin_note, 3000); const values = { updated_at: now };
    let event = null;
    if (action === "approve") { values.status = "approved"; values.admin_note = note; values.reviewed_by = access.user.id; values.reviewed_at = now; event = [existing.created_by, "service_request_approved", "information", `Service request approved: ${existing.title}`, note || "Your request has been approved."]; }
    if (action === "decline") { if (!note) return Response.json({ error: "Provide a decision note when declining a request." }, { status: 400 }); values.status = "declined"; values.admin_note = note; values.reviewed_by = access.user.id; values.reviewed_at = now; event = [existing.created_by, "service_request_declined", "action", `Service request declined: ${existing.title}`, note]; }
    if (action === "return") { if (!note) return Response.json({ error: "Explain what needs to be updated before returning a request." }, { status: 400 }); values.status = "returned"; values.return_reason = note; values.reviewed_by = access.user.id; values.reviewed_at = now; event = [existing.created_by, "service_request_returned", "action", `Service request returned: ${existing.title}`, note]; }
    if (action === "assign") { if (!body.assignedTo) return Response.json({ error: "Choose an assignee." }, { status: 400 }); values.status = "assigned"; values.assigned_to = body.assignedTo; values.admin_note = note || existing.admin_note; event = [body.assignedTo, "service_request_assigned", "action", `Service request assigned: ${existing.title}`, note || "You have been assigned this approved request."]; }
    if (action === "start") values.status = "in_progress";
    if (action === "close") { values.status = "closed"; values.locked = true; values.reviewed_by = access.user.id; values.reviewed_at = now; event = [existing.created_by, "service_request_closed", "information", `Service request closed: ${existing.title}`, note || "Your request has been closed."]; }
    if (action === "archive") { values.status = "archived"; values.archived_at = now; values.locked = true; }
    if (action === "reopen") { if (!note) return Response.json({ error: "Provide a reopen reason." }, { status: 400 }); values.status = "submitted"; values.archived_at = null; values.locked = false; values.admin_note = note; event = [existing.created_by, "service_request_reopened", "information", `Service request reopened: ${existing.title}`, note]; }
    if (action === "lock") values.locked = true;
    if (action === "unlock") { if (!note) return Response.json({ error: "Provide an unlock reason." }, { status: 400 }); values.locked = false; }
    const { data, error } = await access.admin.from("service_requests").update(values).eq("id", existing.id).select(COLUMNS).single();
    if (error) return Response.json({ error: error.message }, { status: 400 });
    await recordAudit(access.admin, { actorId: access.user.id, action, entityType: "service_request", entityId: data.id, projectId: data.project_id, resourceKey: "admin.service_requests", beforeData: compactAuditRecord(existing, ["status", "assigned_to", "locked"]), afterData: compactAuditRecord(data, ["status", "assigned_to", "locked"]), reason: note });
    if (event) await notifyUser(access.admin, data, ...event, request);
    return Response.json({ request: data });
  } catch (error) { return serverError(error); }
}
