import { requireSession, serverError } from "../../../lib/serverAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TYPE_LABEL = {
  daily_risk_assessment: "Daily Risk Assessment", office_risk_assessment: "Office Risk Assessment",
  injury_incident: "Injury / Incident", near_miss: "Near Miss", site_erp: "Site ERP",
  journey_plan: "Journey Plan", pre_mobilisation: "Pre-Mobilisation", toolbox_talk: "Toolbox Talk",
  hazard_report: "Hazard Report",
};

export async function GET(request) {
  try {
    const access = await requireSession(request);
    if (access.error) return access.error;
    if (!access.isAdmin) return Response.json({ error: "Administrators only." }, { status: 403 });

    const [{ data: forms }, { data: audits }] = await Promise.all([
      access.admin.from("whs_forms").select("id, form_type, title, site, status, notifiable_flag, created_by, created_at, reviewed_at"),
      access.admin.from("whs_audits").select("id, form_id, outcome, checks, findings, corrective_action, corrective_due, corrective_status, audited_at, auditor_id"),
    ]);
    const F = forms || [], A = audits || [];

    const auditByForm = new Map();
    for (const a of A) { if (!auditByForm.has(a.form_id)) auditByForm.set(a.form_id, a); }

    // Overall compliance: of audited forms, share that passed (incl. pass_with_actions).
    const audited = A.length;
    const passed = A.filter((a) => a.outcome === "pass" || a.outcome === "pass_with_actions").length;
    const failed = A.filter((a) => a.outcome === "fail").length;
    const overall = audited ? Math.round((passed / audited) * 100) : null;

    // Submissions by form type.
    const byForm = {};
    for (const f of F) { const k = TYPE_LABEL[f.form_type] || f.form_type; byForm[k] = (byForm[k] || 0) + 1; }

    // Review status counts.
    const reviewStatus = { submitted: 0, reviewed: 0, actioned: 0, archived: 0 };
    for (const f of F) reviewStatus[f.status] = (reviewStatus[f.status] || 0) + 1;

    // Median review time (submission -> reviewed_at), in hours.
    const times = F.filter((f) => f.reviewed_at).map((f) => (new Date(f.reviewed_at) - new Date(f.created_at)) / 36e5).sort((a, b) => a - b);
    const median = times.length ? times[Math.floor(times.length / 2)] : null;

    // Open corrective actions.
    const openActions = A.filter((a) => a.corrective_status === "open").map((a) => {
      const form = F.find((f) => f.id === a.form_id);
      return { audit_id: a.id, form_title: form?.title || "—", corrective_action: a.corrective_action, due: a.corrective_due };
    });

    // Failed items by category (across all audit checks).
    const failedByCat = {};
    for (const a of A) for (const c of (a.checks || [])) if (c.status === "fail") failedByCat[c.label] = (failedByCat[c.label] || 0) + 1;

    return Response.json({
      totals: { submitted: F.length, awaiting: reviewStatus.submitted || 0, failedChecks: failed, audited },
      overall, passed, failed,
      byForm, reviewStatus,
      medianReviewHours: median != null ? Math.round(median * 10) / 10 : null,
      openActions,
      failedByCat,
    });
  } catch (error) {
    return serverError(error);
  }
}
