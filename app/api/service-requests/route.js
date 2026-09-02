import { requireSession, serverError } from "../../../lib/serverAuth";
import { requirePortalResource } from "../../../lib/portalVisibility";
import { compactAuditRecord, recordAudit } from "../../../lib/auditLog";
import { sendPortalEmail } from "../../../lib/transactionalEmail";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const COLUMNS = "id, request_type, title, details, status, admin_note, return_reason, reviewed_by, reviewed_at, created_by, project_id, assigned_to, priority, due_date, estimated_hours, attachments, locked, archived_at, submission_key, seen_by_staff, created_at, updated_at";
const TYPES = ["leave", "training", "equipment", "task", "other"];
const TYPE_LABELS = { leave: "leave request", training: "training request", equipment: "equipment request", task: "task request", other: "service request" };
const PRIORITIES = new Set(["low", "normal", "high", "urgent"]);
const text = (value, maximum = 5000) => { const clean = String(value || "").trim(); return clean ? clean.slice(0, maximum) : null; };
const date = (value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value || "")) ? String(value) : null;
const number = (value) => value === "" || value == null ? null : (Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : null);

async function notifyAdministrators(admin, requestRecord, submittedBy, request) {
  try {
    const { data: adminRecords, error: adminError } = await admin.from("admin_emails").select("email"); if (adminError) throw adminError;
    const administratorEmails = new Set((adminRecords || []).map((record) => String(record.email || "").toLowerCase()).filter(Boolean)); if (!administratorEmails.size) return;
    const { data: usersData, error: usersError } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 }); if (usersError) throw usersError;
    const recipientUsers = (usersData?.users || []).filter((user) => administratorEmails.has(String(user.email || "").toLowerCase())); if (!recipientUsers.length) return;
    await admin.from("portal_events").insert(recipientUsers.map((user) => ({ recipient_id: user.id, event_type: "service_request_submitted", severity: "action", title: `New ${TYPE_LABELS[requestRecord.request_type] || "service request"}`, body: `${submittedBy || "A staff member"} submitted: ${requestRecord.title}`, href: "/", source_table: "service_requests", source_id: requestRecord.id })));
    await Promise.allSettled(recipientUsers.map((user) => sendPortalEmail({ request, to: user.email, subject: `New ${TYPE_LABELS[requestRecord.request_type] || "service request"} awaiting review`, heading: "Service request awaiting review", body: `${submittedBy || "A staff member"} submitted: ${requestRecord.title}. Review the request in the Service Desk.`, ctaLabel: "Open Service Desk", ctaPath: "/" })));
  } catch (error) { console.error("Could not notify service request administrators", error); }
}

async function verifyProjectScope(access, projectId) {
  if (!projectId) return null;
  const { data: project, error } = await access.admin.from("projects").select("id,status").eq("id", projectId).maybeSingle();
  if (error || !project || project.status === "archived") throw new Error("Choose an active project for this request.");
  if (!access.isAdmin) {
    const { data: allocation } = await access.admin.from("project_allocations").select("id").eq("project_id", projectId).eq("staff_user_id", access.user.id).eq("active", true).maybeSingle();
    if (!allocation) throw new Error("You are not allocated to the selected project.");
  }
  return project.id;
}

export async function GET(request) {
  try {
    const access = await requireSession(request); if (access.error) return access.error;
    const denied = await requirePortalResource(access, access.isAdmin ? "admin.service_requests" : "staff.service_requests"); if (denied) return denied;
    let query = access.admin.from("service_requests").select(COLUMNS).order("updated_at", { ascending: false }); if (!access.isAdmin) query = query.eq("created_by", access.user.id);
    const { data, error } = await query; if (error) return Response.json({ error: error.message }, { status: 400 });
    const rows = data || []; let emailById = new Map(); let staff = [];
    if (access.isAdmin) {
      const { data: usersData } = await access.admin.auth.admin.listUsers({ page: 1, perPage: 200 });
      const users = usersData?.users || [];
      emailById = new Map(users.map((user) => [user.id, user.email]));
      staff = users.map((user) => ({ id: user.id, email: user.email || "", name: user.user_metadata?.full_name || user.user_metadata?.name || user.email || "Staff member" })).sort((left, right) => left.name.localeCompare(right.name));
    }
    const requests = rows.map((row) => ({ ...row, author: emailById.get(row.created_by) || null }));
    const pending = requests.filter((row) => ["submitted", "returned"].includes(row.status)).length;
    return Response.json({ requests, staff, summary: { pending, total: requests.length } });
  } catch (error) { return serverError(error); }
}

export async function POST(request) {
  try {
    const access = await requireSession(request); if (access.error) return access.error;
    const denied = await requirePortalResource(access, access.isAdmin ? "admin.service_requests" : "staff.service_requests"); if (denied) return denied;
    const body = await request.json(); const requestType = String(body.request_type || "").trim(); const title = text(body.title, 280); const submissionKey = text(body.submissionKey, 160);
    if (!TYPES.includes(requestType)) return Response.json({ error: "Choose a valid request type." }, { status: 400 });
    if (!title || title.length < 2) return Response.json({ error: "A short title is required." }, { status: 400 });
    if (submissionKey) { const { data: prior, error: priorError } = await access.admin.from("service_requests").select(COLUMNS).eq("created_by", access.user.id).eq("submission_key", submissionKey).maybeSingle(); if (priorError) return Response.json({ error: priorError.message }, { status: 400 }); if (prior) return Response.json({ request: prior, replayed: true }); }
    const details = body.details && typeof body.details === "object" ? body.details : {};
    const priorityValue = String(body.priority || details.priority || "normal").toLowerCase(); const priority = PRIORITIES.has(priorityValue) ? priorityValue : "normal";
    const projectId = await verifyProjectScope(access, text(body.projectId, 100));
    const values = { created_by: access.user.id, request_type: requestType, title, details, status: "submitted", submission_key: submissionKey, project_id: projectId, priority, due_date: date(body.dueDate || details.due_date || details.required_by), estimated_hours: number(body.estimatedHours || details.estimated_hours), attachments: Array.isArray(body.attachments) ? body.attachments.slice(0, 20) : [] };
    const { data, error } = await access.admin.from("service_requests").insert(values).select(COLUMNS).single();
    if (error) {
      if (error.code === "23505" && submissionKey) { const { data: prior } = await access.admin.from("service_requests").select(COLUMNS).eq("created_by", access.user.id).eq("submission_key", submissionKey).maybeSingle(); if (prior) return Response.json({ request: prior, replayed: true }); }
      return Response.json({ error: error.message }, { status: 400 });
    }
    await recordAudit(access.admin, { actorId: access.user.id, action: "submitted", entityType: "service_request", entityId: data.id, projectId: data.project_id, resourceKey: access.isAdmin ? "admin.service_requests" : "staff.service_requests", afterData: compactAuditRecord(data, ["request_type", "title", "status", "priority", "project_id"]) });
    await notifyAdministrators(access.admin, data, access.user.email, request);
    await sendPortalEmail({ request, to: access.user.email, subject: "Service request received", heading: "Your service request has been received", body: `Your ${TYPE_LABELS[data.request_type] || "service request"} is awaiting administrator review: ${data.title}`, ctaLabel: "View your request", ctaPath: "/staff/service-requests" });
    return Response.json({ request: data }, { status: 201 });
  } catch (error) { return serverError(error); }
}
