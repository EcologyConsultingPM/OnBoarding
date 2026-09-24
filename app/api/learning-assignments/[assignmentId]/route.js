import { requireSession, serverError } from "../../../../lib/serverAuth";
import { requirePortalResource } from "../../../../lib/portalVisibility";
import { compactAuditRecord, recordAudit } from "../../../../lib/auditLog";

const COLUMNS = "id, node_id, user_id, assigned_by, status, due_date, started_at, submitted_at, assessed_at, verified_at, reviewer_id, assignment_note, submission_note, assessment_note, competency_scope, remediation_note, locked, archived_at, created_at, updated_at, ld_nodes(id,title,content_type)";
const text = (value, maximum = 3000) => { const clean = String(value || "").trim(); return clean ? clean.slice(0, maximum) : null; };
const EVENT_SEVERITIES = new Set(["information", "review", "approval", "action_required", "critical"]);

async function event(admin, recipientId, assignment, title, body, severity = "information") {
  if (!recipientId) return;
  try {
    await admin.from("portal_events").insert({
      recipient_id: recipientId,
      event_type: "learning_assignment_status",
      severity: EVENT_SEVERITIES.has(severity) ? severity : "information",
      title,
      body,
      href: "/?workspace=ldlibrary",
      source_table: "learning_assignments",
      source_id: assignment.id,
    });
  } catch (error) {
    console.warn("Learning assignment event failed", error.message);
  }
}

export async function PATCH(request, { params }) {
  try {
    const access = await requireSession(request);
    if (access.error) return access.error;
    const body = await request.json();
    const action = String(body.action || "").trim();
    const now = new Date().toISOString();
    const { data: current, error: loadError } = await access.admin.from("learning_assignments").select(COLUMNS).eq("id", params.assignmentId).single();
    if (loadError || !current) return Response.json({ error: "Learning assignment not found." }, { status: 404 });

    const staffAction = ["start", "submit"].includes(action);
    const denied = await requirePortalResource(access, staffAction && !access.isAdmin ? "staff.learning.assignments" : "admin.learning.governance");
    if (denied) return denied;
    if (current.locked && action !== "unlock") return Response.json({ error: "This learning assignment is locked." }, { status: 409 });

    const values = { updated_at: now };
    let title = "";
    let bodyText = "";
    let target = null;
    if (!access.isAdmin) {
      if (current.user_id !== access.user.id) return Response.json({ error: "You can only update your own learning assignment." }, { status: 403 });
      if (action === "start" && current.status === "assigned") {
        values.status = "started";
        values.started_at = now;
      } else if (action === "submit" && ["assigned", "started", "returned"].includes(current.status)) {
        const submissionNote = text(body.submissionNote);
        if (!submissionNote) return Response.json({ error: "Record the evidence you are submitting before sending this module for review." }, { status: 400 });
        values.status = "submitted";
        values.submitted_at = now;
        values.submission_note = submissionNote;
        values.remediation_note = null;
        if (current.assigned_by) {
          title = `Ready for review: ${current.ld_nodes?.title || "Learning"}`;
          bodyText = "A staff member has submitted learning evidence for assessment.";
          target = current.assigned_by;
        }
      } else {
        return Response.json({ error: "This learning action is not available at the current status." }, { status: 409 });
      }
    } else {
      if (!["assess", "verify", "return", "lock", "unlock", "archive", "restore"].includes(action)) return Response.json({ error: "Choose a valid learning administration action." }, { status: 400 });
      const note = text(body.note);
      if (["assess", "verify", "return", "unlock"].includes(action) && !note) return Response.json({ error: "Record a decision note for this action." }, { status: 400 });

      if (action === "assess") {
        if (current.status !== "submitted") return Response.json({ error: "Only submitted learning can be assessed." }, { status: 409 });
        values.status = "assessed";
        values.assessed_at = now;
        values.reviewer_id = access.user.id;
        values.assessment_note = note;
        values.remediation_note = null;
        title = `Learning assessed: ${current.ld_nodes?.title || "Learning"}`;
        bodyText = note;
        target = current.user_id;
      }
      if (action === "verify") {
        if (current.status !== "assessed") return Response.json({ error: "Assess submitted learning before verifying competency." }, { status: 409 });
        values.status = "competency_verified";
        values.verified_at = now;
        values.reviewer_id = access.user.id;
        values.competency_scope = note;
        title = `Competency verified: ${current.ld_nodes?.title || "Learning"}`;
        bodyText = note;
        target = current.user_id;
      }
      if (action === "return") {
        if (!["submitted", "assessed"].includes(current.status)) return Response.json({ error: "Only submitted or assessed learning can be returned for further work." }, { status: 409 });
        values.status = "returned";
        values.reviewer_id = access.user.id;
        values.assessed_at = now;
        values.remediation_note = note;
        title = `Learning returned: ${current.ld_nodes?.title || "Learning"}`;
        bodyText = note;
        target = current.user_id;
      }
      if (action === "lock") values.locked = true;
      if (action === "unlock") values.locked = false;
      if (action === "archive") { values.status = "archived"; values.archived_at = now; values.locked = true; }
      if (action === "restore") { values.status = "assigned"; values.archived_at = null; values.locked = false; values.submission_note = null; values.assessment_note = null; values.competency_scope = null; }
    }

    const { data, error } = await access.admin.from("learning_assignments").update(values).eq("id", current.id).select(COLUMNS).single();
    if (error) return Response.json({ error: error.message }, { status: 400 });
    await recordAudit(access.admin, {
      actorId: access.user.id,
      action: access.isAdmin ? action : `${action}ed`,
      entityType: "learning_assignment",
      entityId: data.id,
      resourceKey: access.isAdmin ? "admin.learning.governance" : "staff.learning.assignments",
      beforeData: compactAuditRecord(current, ["status", "locked"]),
      afterData: compactAuditRecord(data, ["status", "locked"]),
      reason: text(body.note) || text(body.submissionNote),
    });
    if (target) await event(access.admin, target, data, title, bodyText, action === "return" ? "action_required" : action === "assess" ? "review" : "information");
    return Response.json({ assignment: data });
  } catch (error) {
    return serverError(error);
  }
}
