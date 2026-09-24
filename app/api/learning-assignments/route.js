import { requireSession, serverError } from "../../../lib/serverAuth";
import { requirePortalResource } from "../../../lib/portalVisibility";
import { compactAuditRecord, recordAudit } from "../../../lib/auditLog";

const COLUMNS = "id, node_id, user_id, assigned_by, status, due_date, started_at, submitted_at, assessed_at, verified_at, reviewer_id, assignment_note, submission_note, assessment_note, competency_scope, remediation_note, locked, archived_at, created_at, updated_at, ld_nodes(id,title,node_type,visibility,approval_status,publication_status,content_type,version_label)";
const date = (value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value || "")) ? String(value) : null;
const text = (value, maximum = 3000) => { const clean = String(value || "").trim(); return clean ? clean.slice(0, maximum) : null; };
const EVENT_SEVERITIES = new Set(["information", "review", "approval", "action_required", "critical"]);

async function notify(admin, recipientId, assignment, title, body, severity = "information") {
  if (!recipientId) return;
  try {
    await admin.from("portal_events").insert({
      recipient_id: recipientId,
      event_type: "learning_assignment",
      severity: EVENT_SEVERITIES.has(severity) ? severity : "information",
      title,
      body,
      href: "/?workspace=ldlibrary",
      source_table: "learning_assignments",
      source_id: assignment.id,
    });
  } catch (error) {
    console.warn("Learning assignment notification failed", error.message);
  }
}

export async function GET(request) {
  try {
    const access = await requireSession(request);
    if (access.error) return access.error;
    const staffAudience = new URL(request.url).searchParams.get("audience") === "staff" || !access.isAdmin;
    const denied = await requirePortalResource(access, staffAudience ? "staff.learning.assignments" : "admin.learning.governance");
    if (denied) return denied;

    let query = access.admin.from("learning_assignments").select(COLUMNS)
      .order("due_date", { ascending: true, nullsFirst: false }).order("created_at", { ascending: false });
    if (staffAudience) query = query.eq("user_id", access.user.id).neq("status", "archived");
    const { data, error } = await query;
    if (error) return Response.json({ error: error.message }, { status: 400 });

    let staff = [];
    let items = [];
    if (!staffAudience) {
      const { data: users } = await access.admin.auth.admin.listUsers({ page: 1, perPage: 200 });
      staff = (users?.users || [])
        .map((user) => ({ id: user.id, email: user.email || "", name: user.user_metadata?.full_name || user.user_metadata?.name || user.email || "Staff member" }))
        .sort((left, right) => left.name.localeCompare(right.name));
      const { data: learningItems } = await access.admin.from("ld_nodes")
        .select("id,title,approval_status,publication_status,locked,archived_at,content_type,module_content")
        .eq("node_type", "item").eq("content_type", "learning_module").is("archived_at", null).order("title");
      items = (learningItems || []).filter((item) => !item.locked && item.approval_status === "approved");
    }
    return Response.json({ assignments: data || [], staff, items, audience: staffAudience ? "staff" : "admin" });
  } catch (error) {
    return serverError(error);
  }
}

export async function POST(request) {
  try {
    const access = await requireSession(request);
    if (access.error) return access.error;
    if (!access.isAdmin) return Response.json({ error: "Administrators only." }, { status: 403 });
    const denied = await requirePortalResource(access, "admin.learning.governance");
    if (denied) return denied;

    const body = await request.json();
    if (!body.nodeId || !body.userId) return Response.json({ error: "Choose a learning module and staff member." }, { status: 400 });
    const { data: node, error: nodeError } = await access.admin.from("ld_nodes")
      .select("id,title,approval_status,publication_status,locked,archived_at,content_type")
      .eq("id", body.nodeId).single();
    if (nodeError || !node) return Response.json({ error: "Learning module not found." }, { status: 404 });
    if (node.content_type !== "learning_module") return Response.json({ error: "Only structured learning modules can be assigned." }, { status: 409 });
    if (node.locked || node.archived_at || node.approval_status !== "approved") return Response.json({ error: "Only approved, unlocked learning modules can be assigned." }, { status: 409 });

    const assignmentNote = text(body.note);
    const { data, error } = await access.admin.from("learning_assignments").upsert({
      node_id: body.nodeId,
      user_id: body.userId,
      assigned_by: access.user.id,
      status: "assigned",
      due_date: date(body.dueDate),
      assignment_note: assignmentNote,
      remediation_note: assignmentNote,
      submission_note: null,
      assessment_note: null,
      competency_scope: null,
      locked: false,
      archived_at: null,
    }, { onConflict: "node_id,user_id" }).select(COLUMNS).single();
    if (error) return Response.json({ error: error.message }, { status: 400 });

    await recordAudit(access.admin, {
      actorId: access.user.id,
      action: "assigned",
      entityType: "learning_assignment",
      entityId: data.id,
      resourceKey: "admin.learning.governance",
      afterData: compactAuditRecord(data, ["node_id", "user_id", "status", "due_date"]),
      reason: assignmentNote,
    });
    await notify(access.admin, data.user_id, data, `Learning assigned: ${node.title}`,
      data.due_date ? `Complete this learning by ${data.due_date}.` : "A learning module has been assigned to you.", "action_required");
    return Response.json({ assignment: data }, { status: 201 });
  } catch (error) {
    return serverError(error);
  }
}
