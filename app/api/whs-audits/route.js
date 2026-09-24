import { requireSession, serverError } from "../../../lib/serverAuth";
import { requirePortalResource } from "../../../lib/portalVisibility";
import { compactAuditRecord, recordAudit } from "../../../lib/auditLog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function formatDueDate(value) {
  if (!value) return "No due date was recorded.";
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime())
    ? `Due ${value}.`
    : `Due ${date.toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric" })}.`;
}

function outcomeLabel(outcome) {
  if (outcome === "fail") return "failed";
  if (outcome === "pass_with_actions") return "passed with corrective actions";
  return "passed";
}

function reviewNote({ outcome, findings, correctiveAction, correctiveDue, correctiveClosedAt = null }) {
  const parts = [`Audit outcome: ${outcomeLabel(outcome)}.`];
  if (findings) parts.push(`Reasoning: ${findings}`);
  if (correctiveAction) parts.push(`Corrective action: ${correctiveAction}`);
  if (correctiveAction) parts.push(formatDueDate(correctiveDue));
  if (correctiveClosedAt) parts.push(`Corrective action closed on ${new Date(correctiveClosedAt).toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric" })}.`);
  return parts.join(" ");
}

async function requireWhsAdmin(request) {
  const access = await requireSession(request);
  if (access.error) return { access, error: access.error };
  if (!access.isAdmin) return { access, error: Response.json({ error: "Administrators only." }, { status: 403 }) };
  const denied = await requirePortalResource(access, "admin.whs_monitoring");
  if (denied) return { access, error: denied };
  return { access, error: null };
}

async function notifySubmitter(admin, { form, audit, findings, correctiveAction, correctiveDue, closed = false }) {
  if (!form?.created_by) return { sent: false, reason: "no_submitter" };
  const title = closed
    ? "WHS corrective action closed"
    : audit.outcome === "fail"
      ? "WHS audit failed — corrective action required"
      : "WHS audit completed — corrective action required";
  const body = closed
    ? `${form.title || "Your submission"}: the recorded corrective action has been closed. ${findings ? `Original audit reasoning: ${findings}` : ""}`.trim()
    : `${form.title || "Your submission"} was audited and ${outcomeLabel(audit.outcome)}. Reasoning: ${findings}. Corrective action: ${correctiveAction}. ${formatDueDate(correctiveDue)}`;
  const { error } = await admin.from("portal_events").insert({
    recipient_id: form.created_by,
    event_type: closed ? "whs_corrective_action_closed" : "whs_audit_outcome",
    severity: closed ? "information" : "action_required",
    title,
    body,
    href: "/staff/notifications",
    source_table: "whs_audits",
    source_id: audit.id,
  });
  if (error) {
    console.warn("WHS audit notification could not be created:", error.message);
    return { sent: false, reason: error.message };
  }
  return { sent: true };
}

export async function POST(request) {
  try {
    const { access, error: accessError } = await requireWhsAdmin(request);
    if (accessError) return accessError;
    const b = await request.json();
    if (!b.form_id) return Response.json({ error: "form_id is required." }, { status: 400 });
    if (!["pass", "pass_with_actions", "fail"].includes(b.outcome)) return Response.json({ error: "Invalid outcome." }, { status: 400 });

    const checks = Array.isArray(b.checks) ? b.checks : [];
    const failedChecks = checks.filter((check) => check?.status === "fail");
    const findings = String(b.findings || "").trim();
    const correctiveAction = String(b.corrective_action || "").trim();
    const correctiveDue = b.corrective_due || null;
    const needsAction = b.outcome === "fail" || b.outcome === "pass_with_actions";

    if (b.outcome === "pass" && failedChecks.length) {
      return Response.json({ error: "A failed compliance check requires either a failed outcome or a pass with corrective actions." }, { status: 400 });
    }
    if (needsAction && !findings) {
      return Response.json({ error: "Record the audit reasoning before assigning a corrective action." }, { status: 400 });
    }
    if (needsAction && !correctiveAction) {
      return Response.json({ error: "Record the required corrective action for this outcome." }, { status: 400 });
    }
    if (needsAction && !correctiveDue) {
      return Response.json({ error: "Set a due date for the corrective action." }, { status: 400 });
    }

    const [{ data: form, error: formLookupError }, { data: existingAudit, error: auditLookupError }] = await Promise.all([
      access.admin.from("whs_forms").select("id, title, created_by, status, review_note").eq("id", b.form_id).maybeSingle(),
      access.admin.from("whs_audits").select("id").eq("form_id", b.form_id).order("audited_at", { ascending: false }).limit(1).maybeSingle(),
    ]);
    if (formLookupError) return Response.json({ error: formLookupError.message }, { status: 400 });
    if (!form) return Response.json({ error: "Submitted WHS form not found." }, { status: 404 });
    if (auditLookupError) return Response.json({ error: auditLookupError.message }, { status: 400 });
    if (existingAudit) return Response.json({ error: "This submission has already been audited. Close the recorded corrective action or contact an administrator to correct the audit." }, { status: 409 });

    const { data: audit, error: auditError } = await access.admin.from("whs_audits").insert({
      form_id: form.id,
      auditor_id: access.user.id,
      outcome: b.outcome,
      checks,
      findings: findings || null,
      corrective_action: correctiveAction || null,
      corrective_due: correctiveDue,
      corrective_status: needsAction ? "open" : "none",
    }).select("*").single();
    if (auditError) return Response.json({ error: auditError.message }, { status: 400 });

    const note = reviewNote({ outcome: b.outcome, findings, correctiveAction, correctiveDue });
    const { data: updatedForm, error: formError } = await access.admin.from("whs_forms").update({
      status: needsAction ? "actioned" : "reviewed",
      review_note: note,
      reviewed_by: access.user.id,
      reviewed_at: new Date().toISOString(),
      seen_by_staff: false,
    }).eq("id", form.id).select("id, title, created_by, status, review_note, reviewed_at").single();
    if (formError) {
      console.error("WHS audit was recorded but its form status could not be synchronised:", formError.message);
    }

    const notification = needsAction
      ? await notifySubmitter(access.admin, { form: updatedForm || form, audit, findings, correctiveAction, correctiveDue })
      : { sent: false, reason: "pass" };

    await recordAudit(access.admin, {
      actorId: access.user.id,
      action: "audited",
      entityType: "whs_audit",
      entityId: audit.id,
      resourceKey: "admin.whs_monitoring.audit",
      afterData: compactAuditRecord(audit, ["form_id", "outcome", "corrective_status", "corrective_due"]),
      reason: note,
    });

    return Response.json({
      audit,
      form: updatedForm || form,
      notification,
      warning: formError ? "The audit was recorded but the form status could not be synchronised. Contact an administrator before re-auditing." : null,
    }, { status: 201 });
  } catch (error) {
    return serverError(error);
  }
}

export async function PATCH(request) {
  try {
    const { access, error: accessError } = await requireWhsAdmin(request);
    if (accessError) return accessError;
    const b = await request.json();
    if (!b.audit_id) return Response.json({ error: "audit_id required." }, { status: 400 });
    if (b.corrective_status !== "closed") return Response.json({ error: "Only a recorded corrective action can be closed here." }, { status: 400 });

    const { data: currentAudit, error: auditLookupError } = await access.admin.from("whs_audits")
      .select("*").eq("id", b.audit_id).maybeSingle();
    if (auditLookupError) return Response.json({ error: auditLookupError.message }, { status: 400 });
    if (!currentAudit) return Response.json({ error: "WHS audit not found." }, { status: 404 });
    if (currentAudit.corrective_status !== "open") return Response.json({ error: "This corrective action is already closed or was not required." }, { status: 409 });

    const { data: form, error: formLookupError } = await access.admin.from("whs_forms")
      .select("id, title, created_by, review_note").eq("id", currentAudit.form_id).maybeSingle();
    if (formLookupError) return Response.json({ error: formLookupError.message }, { status: 400 });
    if (!form) return Response.json({ error: "The submission linked to this audit was not found." }, { status: 404 });

    const closedAt = new Date().toISOString();
    const { data: audit, error } = await access.admin.from("whs_audits")
      .update({ corrective_status: "closed" }).eq("id", currentAudit.id).select("*").single();
    if (error) return Response.json({ error: error.message }, { status: 400 });

    const note = reviewNote({
      outcome: currentAudit.outcome,
      findings: currentAudit.findings || "",
      correctiveAction: currentAudit.corrective_action || "",
      correctiveDue: currentAudit.corrective_due,
      correctiveClosedAt: closedAt,
    });
    const { data: updatedForm, error: formError } = await access.admin.from("whs_forms").update({
      status: "reviewed",
      review_note: note,
      reviewed_by: access.user.id,
      reviewed_at: closedAt,
      seen_by_staff: false,
    }).eq("id", form.id).select("id, title, created_by, status, review_note, reviewed_at").single();
    if (formError) console.error("WHS corrective-action closure could not update the form status:", formError.message);

    const notification = await notifySubmitter(access.admin, {
      form: updatedForm || form,
      audit,
      findings: currentAudit.findings || "",
      correctiveAction: currentAudit.corrective_action || "",
      correctiveDue: currentAudit.corrective_due,
      closed: true,
    });

    await recordAudit(access.admin, {
      actorId: access.user.id,
      action: "corrective_action_closed",
      entityType: "whs_audit",
      entityId: audit.id,
      resourceKey: "admin.whs_monitoring.audit",
      beforeData: compactAuditRecord(currentAudit, ["outcome", "corrective_status", "corrective_action", "corrective_due"]),
      afterData: compactAuditRecord(audit, ["outcome", "corrective_status", "corrective_action", "corrective_due"]),
      reason: note,
    });

    return Response.json({ audit, form: updatedForm || form, notification, warning: formError ? "The corrective action was closed but the form status could not be synchronised." : null });
  } catch (error) {
    return serverError(error);
  }
}
