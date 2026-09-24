import { requireSession, serverError } from "../../../lib/serverAuth";
import { requirePortalResource } from "../../../lib/portalVisibility";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TYPE_LABEL = {
  daily_risk_assessment: "Daily Risk Assessment", office_risk_assessment: "Office Risk Assessment",
  injury_incident: "Injury / Incident", near_miss: "Near Miss", site_erp: "Site ERP",
  journey_plan: "Journey Plan", pre_mobilisation: "Pre-Mobilisation", toolbox_talk: "Toolbox Talk",
  hazard_report: "Hazard Report",
};

function isNewerAudit(candidate, current) {
  return new Date(candidate.audited_at || candidate.created_at || 0).getTime() > new Date(current.audited_at || current.created_at || 0).getTime();
}

export async function GET(request) {
  try {
    const access = await requireSession(request);
    if (access.error) return access.error;
    if (!access.isAdmin) return Response.json({ error: "Administrators only." }, { status: 403 });
    const denied = await requirePortalResource(access, "admin.whs_monitoring");
    if (denied) return denied;

    const [{ data: forms }, { data: audits }] = await Promise.all([
      access.admin.from("whs_forms").select("id, form_type, title, site, status, notifiable_flag, created_by, created_at, reviewed_at"),
      access.admin.from("whs_audits").select("id, form_id, outcome, checks, findings, corrective_action, corrective_due, corrective_status, audited_at, created_at, auditor_id").order("audited_at", { ascending: false }),
    ]);
    const F = forms || [];
    const auditByForm = new Map();
    for (const audit of audits || []) {
      const current = auditByForm.get(audit.form_id);
      if (!current || isNewerAudit(audit, current)) auditByForm.set(audit.form_id, audit);
    }
    const currentAudits = [...auditByForm.values()];

    // Every measure represents the current audit outcome for a submitted form.
    // Legacy duplicate audit rows are ignored so historical re-audits cannot
    // inflate compliance, failed-check or corrective-action figures.
    const audited = currentAudits.length;
    const passed = currentAudits.filter((audit) => audit.outcome === "pass" || audit.outcome === "pass_with_actions").length;
    const failed = currentAudits.filter((audit) => audit.outcome === "fail").length;
    const overall = audited ? Math.round((passed / audited) * 100) : null;

    const byForm = {};
    for (const form of F) {
      const label = TYPE_LABEL[form.form_type] || form.form_type;
      byForm[label] = (byForm[label] || 0) + 1;
    }

    const reviewStatus = { submitted: 0, reviewed: 0, actioned: 0, archived: 0 };
    for (const form of F) reviewStatus[form.status] = (reviewStatus[form.status] || 0) + 1;

    const times = F
      .filter((form) => form.reviewed_at)
      .map((form) => (new Date(form.reviewed_at) - new Date(form.created_at)) / 36e5)
      .sort((a, b) => a - b);
    const median = times.length ? times[Math.floor(times.length / 2)] : null;

    const openActions = currentAudits
      .filter((audit) => audit.corrective_status === "open")
      .map((audit) => {
        const form = F.find((item) => item.id === audit.form_id);
        return {
          audit_id: audit.id,
          form_id: audit.form_id,
          form_title: form?.title || "—",
          corrective_action: audit.corrective_action,
          due: audit.corrective_due,
          findings: audit.findings || "",
          outcome: audit.outcome,
        };
      });

    const failedByCat = {};
    for (const audit of currentAudits) {
      for (const check of (audit.checks || [])) {
        if (check?.status === "fail") failedByCat[check.label] = (failedByCat[check.label] || 0) + 1;
      }
    }
    const failedChecks = Object.values(failedByCat).reduce((sum, count) => sum + count, 0);

    return Response.json({
      totals: { submitted: F.length, awaiting: reviewStatus.submitted || 0, failedChecks, audited },
      overall,
      passed,
      failed,
      byForm,
      reviewStatus,
      medianReviewHours: median != null ? Math.round(median * 10) / 10 : null,
      openActions,
      failedByCat,
      auditByForm: Object.fromEntries(currentAudits.map((audit) => [audit.form_id, {
        audit_id: audit.id,
        outcome: audit.outcome,
        corrective_status: audit.corrective_status,
        corrective_action: audit.corrective_action,
        corrective_due: audit.corrective_due,
      }])),
    });
  } catch (error) {
    return serverError(error);
  }
}
