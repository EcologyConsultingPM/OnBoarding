import { requireSession, serverError } from "../../../lib/serverAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request) {
  try {
    const access = await requireSession(request);
    if (access.error) return access.error;
    if (!access.isAdmin) return Response.json({ error: "Administrators only." }, { status: 403 });
    const b = await request.json();
    if (!b.form_id) return Response.json({ error: "form_id is required." }, { status: 400 });
    if (!["pass", "pass_with_actions", "fail"].includes(b.outcome)) return Response.json({ error: "Invalid outcome." }, { status: 400 });

    const checks = Array.isArray(b.checks) ? b.checks : [];
    const hasCorrective = b.outcome !== "pass" && (b.corrective_action || "").toString().trim();

    const { data, error } = await access.admin.from("whs_audits").insert({
      form_id: b.form_id,
      auditor_id: access.user.id,
      outcome: b.outcome,
      checks,
      findings: (b.findings || "").toString().trim() || null,
      corrective_action: (b.corrective_action || "").toString().trim() || null,
      corrective_due: b.corrective_due || null,
      corrective_status: hasCorrective ? "open" : "none",
    }).select("*").single();
    if (error) return Response.json({ error: error.message }, { status: 400 });

    // Mark the underlying form as reviewed/actioned to keep statuses in sync,
    // and make sure the person who submitted it actually finds out — this
    // previously updated the form silently with no notification and without
    // clearing seen_by_staff, so a failed audit requiring corrective action
    // had no way of reaching the person who needs to act on it.
    const { data: updatedForm, error: formError } = await access.admin.from("whs_forms").update({
      status: b.outcome === "fail" ? "actioned" : "reviewed",
      reviewed_by: access.user.id,
      reviewed_at: new Date().toISOString(),
      seen_by_staff: false,
    }).eq("id", b.form_id).select("id, title, created_by").single();

    if (!formError && updatedForm?.created_by && b.outcome !== "pass") {
      await access.admin.from("portal_events").insert({
        recipient_id: updatedForm.created_by,
        event_type: "whs_audit_outcome",
        severity: b.outcome === "fail" ? "action_required" : "information",
        title: b.outcome === "fail" ? "WHS audit failed — corrective action required" : "WHS audit completed with actions",
        body: hasCorrective ? `${updatedForm.title || "Your submission"}: ${(b.corrective_action || "").toString().trim()}` : `${updatedForm.title || "Your submission"} has been audited.`,
        href: "/?portal=staff&area=forms",
        source_table: "whs_audits",
        source_id: data.id,
      });
    }

    return Response.json({ audit: data }, { status: 201 });
  } catch (error) {
    return serverError(error);
  }
}

export async function PATCH(request) {
  try {
    const access = await requireSession(request);
    if (access.error) return access.error;
    if (!access.isAdmin) return Response.json({ error: "Administrators only." }, { status: 403 });
    const b = await request.json();
    if (!b.audit_id) return Response.json({ error: "audit_id required." }, { status: 400 });
    // Close a corrective action.
    const { data, error } = await access.admin.from("whs_audits")
      .update({ corrective_status: b.corrective_status === "closed" ? "closed" : "open" })
      .eq("id", b.audit_id).select("*").single();
    if (error) return Response.json({ error: error.message }, { status: 400 });
    return Response.json({ audit: data });
  } catch (error) {
    return serverError(error);
  }
}
