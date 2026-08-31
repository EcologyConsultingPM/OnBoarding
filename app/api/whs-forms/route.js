import { requireSession, serverError } from "../../../lib/serverAuth";
import { PRIMARY_ADMIN_EMAILS, requirePortalResource } from "../../../lib/portalVisibility";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const COLUMNS = "id, form_type, title, site, form_date, details, status, notifiable_flag, review_note, reviewed_by, reviewed_at, created_by, created_at, updated_at";

const FORM_TYPES = [
  "daily_risk_assessment", "office_risk_assessment", "injury_incident", "near_miss",
  "site_erp", "journey_plan", "pre_mobilisation", "toolbox_talk", "hazard_report",
  "job_safety_analysis", "first_aid_kit",
];

export async function GET(request) {
  try {
    const access = await requireSession(request);
    if (access.error) return access.error;
    const denied = await requirePortalResource(
      access,
      access.isAdmin ? "admin.whs_monitoring" : "staff.forms",
    );
    if (denied) return denied;
    const url = new URL(request.url);
    const typeFilter = url.searchParams.get("type");

    let query = access.admin.from("whs_forms").select(COLUMNS).order("created_at", { ascending: false });
    if (!access.isAdmin) query = query.eq("created_by", access.user.id);
    if (typeFilter && FORM_TYPES.includes(typeFilter)) query = query.eq("form_type", typeFilter);
    const { data, error } = await query;
    if (error) return Response.json({ error: error.message }, { status: 400 });
    let rows = data || [];

    // Attach author emails for the admin monitoring view.
    if (access.isAdmin && rows.length) {
      const { data: usersData } = await access.admin.auth.admin.listUsers({ page: 1, perPage: 200 });
      const emailById = new Map((usersData?.users || []).map((u) => [u.id, u.email]));
      rows = rows.map((r) => ({ ...r, author: emailById.get(r.created_by) || null }));
    }
    return Response.json({ forms: rows, isAdmin: access.isAdmin });
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
      access.isAdmin ? "admin.whs_monitoring" : "staff.forms",
    );
    if (denied) return denied;
    const b = await request.json();
    if (!FORM_TYPES.includes(b.form_type)) return Response.json({ error: "Invalid form type." }, { status: 400 });
    const title = (b.title || "").toString().trim();
    if (title.length < 2) return Response.json({ error: "A title is required." }, { status: 400 });

    const { data, error } = await access.admin.from("whs_forms").insert({
      created_by: access.user.id,
      form_type: b.form_type,
      title,
      site: (b.site || "").toString().trim() || null,
      form_date: b.form_date || null,
      details: b.details && typeof b.details === "object" ? b.details : {},
      notifiable_flag: b.notifiable_flag === true,
      status: "submitted",
    }).select(COLUMNS).single();
    if (error) return Response.json({ error: error.message }, { status: 400 });

    // Daily Risk Assessments are stored in the WHS monitor and actively
    // surfaced to each administrator as a portal report. Notification failure
    // is non-fatal because the submitted assessment remains authoritative.
    if (b.form_type === "daily_risk_assessment") {
      try {
        const { data: adminRows } = await access.admin.from("admin_emails").select("email");
        const recipientEmails = new Set([
          ...PRIMARY_ADMIN_EMAILS,
          ...(adminRows || []).map((row) => String(row.email || "").trim().toLowerCase()),
        ]);
        const { data: usersData } = await access.admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
        const recipients = (usersData?.users || [])
          .filter((user) => recipientEmails.has(String(user.email || "").trim().toLowerCase()))
          .map((user) => user.id)
          .filter(Boolean);
        if (recipients.length) {
          await access.admin.from("portal_events").insert(recipients.map((recipientId) => ({
            recipient_id: recipientId,
            event_type: "daily_risk_assessment_submitted",
            severity: "information",
            title: "Daily Risk Assessment submitted",
            body: `${title}${data.site ? ` · ${data.site}` : ""} is ready for WHS review.`,
            href: "/?mode=whsmonitor",
            source_table: "whs_forms",
            source_id: data.id,
          })));
        }
      } catch (notificationError) {
        console.warn("Daily Risk Assessment notification could not be created:", notificationError?.message);
      }
    }

    // Mirror a copy into the admin service-requests queue so incidents surface
    // alongside other approvals (compliance visibility). The incident form carries
    // an incidentType ("Near miss" / "Dangerous incident" / "Injury" etc.) which
    // we use to label and route the queue item. Non-fatal if it fails.
    try {
      if (b.form_type === "injury_incident") {
        const incidentType = (b.details && b.details.incidentType) || "";
        const isNearMiss = /near miss|dangerous/i.test(incidentType);
        await access.admin.from("service_requests").insert({
          created_by: access.user.id,
          request_type: isNearMiss ? "whs_near_miss" : "whs_incident",
          title: `${isNearMiss ? "Near miss / dangerous incident" : "Injury/Incident"}: ${title}`,
          details: { whs_form_id: data.id, incident_type: incidentType, notifiable: b.notifiable_flag === true, site: data.site },
          status: "submitted",
        });
      }
    } catch { /* non-fatal mirror */ }

    return Response.json({ form: data }, { status: 201 });
  } catch (error) {
    return serverError(error);
  }
}
