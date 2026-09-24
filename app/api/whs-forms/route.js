import crypto from "node:crypto";
import { requireSession, serverError } from "../../../lib/serverAuth";
import { PRIMARY_ADMIN_EMAILS, requirePortalResource } from "../../../lib/portalVisibility";
import { normalisePreMobilisationDetails } from "../../../lib/preMobilisationChecklist";
import { OFFICE_RISK_ITEM_IDS } from "../../../lib/officeRiskChecklist";
import { normaliseEcologicalFieldSwmsDetails } from "../../../lib/ecologicalFieldSwms";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const COLUMNS = "id, form_type, title, site, form_date, details, status, notifiable_flag, review_note, reviewed_by, reviewed_at, created_by, created_at, updated_at, submission_key";

function makeSubmissionKey({ createdBy, formType, title, site, formDate, notifiableFlag, details }) {
  return crypto.createHash("md5").update([
    createdBy,
    formType,
    title,
    site || "",
    formDate || "",
    String(notifiableFlag),
    JSON.stringify(details || {}),
  ].join("|")).digest("hex");
}

const FORM_TYPES = [
  "daily_risk_assessment", "office_risk_assessment", "injury_incident", "near_miss",
  "site_erp", "journey_plan", "pre_mobilisation", "toolbox_talk", "hazard_report",
  "job_safety_analysis", "first_aid_kit", "ecological_field_swms",
];

function normaliseOfficeRiskDetails(value) {
  const details = value && typeof value === "object" ? value : {};
  const area = String(details.area || "").trim();
  const assessedBy = String(details.assessedBy || "").trim();
  const date = String(details.date || "").trim();
  const checks = details.checks && typeof details.checks === "object" ? details.checks : {};
  if (details.version !== 2) return { error: "This Office Risk Assessment is out of date. Refresh the form and try again." };
  if (!area || !assessedBy || !date) return { error: "Enter the office area, assessor and assessment date." };

  const cleanedChecks = {};
  for (const id of OFFICE_RISK_ITEM_IDS) {
    const check = checks[id] && typeof checks[id] === "object" ? checks[id] : {};
    if (!["yes", "no"].includes(check.injuryRisk) || !["yes", "no"].includes(check.actionRequired)) {
      return { error: `Complete both Yes or No choices for check ${id}.` };
    }
    const notes = String(check.notes || "").trim();
    if (notes.length > 2000) return { error: `The note for check ${id} is too long.` };
    cleanedChecks[id] = { injuryRisk: check.injuryRisk, actionRequired: check.actionRequired, notes };
  }
  const signature = String(details.signature || "");
  if (!signature.startsWith("data:image/png;base64,") || signature.length < 100 || signature.length > 360000) {
    return { error: "Sign the Office Risk Assessment before submitting." };
  }
  return {
    details: {
      version: 2,
      area,
      assessedBy,
      date,
      reviewDate: String(details.reviewDate || "").trim(),
      manager: String(details.manager || "").trim(),
      workersConsulted: String(details.workersConsulted || "").trim(),
      checks: cleanedChecks,
      signature,
      signedAt: String(details.signedAt || "").trim(),
    },
  };
}

export async function GET(request) {
  try {
    const access = await requireSession(request);
    if (access.error) return access.error;
    const url = new URL(request.url);
    // A person can be both an administrator and a staff member. The staff
    // history screen must always return that person's own forms, rather than
    // switching to the administrative monitoring feed (or its permissions)
    // merely because their account is an administrator account.
    const personalHistory = url.searchParams.get("scope") === "mine";
    const denied = await requirePortalResource(
      access,
      personalHistory || !access.isAdmin ? "staff.forms" : "admin.whs_monitoring",
    );
    if (denied) return denied;
    const typeFilter = url.searchParams.get("type");

    let query = access.admin.from("whs_forms").select(COLUMNS).order("created_at", { ascending: false });
    if (personalHistory || !access.isAdmin) query = query.eq("created_by", access.user.id);
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
    return Response.json({ forms: rows, isAdmin: access.isAdmin, personalHistory });
  } catch (error) {
    return serverError(error);
  }
}

export async function POST(request) {
  try {
    const access = await requireSession(request);
    if (access.error) return access.error;
    // Submitting a form is a staff action even when the submitter is also an
    // admin — staff.forms is always-visible by design. The isAdmin branch
    // here previously routed admins through admin.whs_monitoring (a
    // separate, review-dashboard-only resource), which could deny an admin
    // submitting their own form from the staff-side forms page.
    const denied = await requirePortalResource(access, "staff.forms");
    if (denied) return denied;
    let b;
    try {
      b = await request.json();
    } catch {
      return Response.json({ error: "Invalid JSON body." }, { status: 400 });
    }
    if (!FORM_TYPES.includes(b.form_type)) return Response.json({ error: "Invalid form type." }, { status: 400 });
    let title = (b.title || "").toString().trim();
    if (title.length < 2) return Response.json({ error: "A title is required." }, { status: 400 });
    let site = (b.site || "").toString().trim() || null;
    let formDate = b.form_date || null;
    let details = b.details && typeof b.details === "object" ? b.details : {};
    // EC-OPS-PMC-001 Rev 3 is a controlled document with a fixed row set and
    // enumerations. Validate and reduce its stored JSON only for this form so
    // established generic WHS form payloads remain backward compatible.
    if (b.form_type === "pre_mobilisation") {
      const checked = normalisePreMobilisationDetails(details);
      if (checked.errors.length) return Response.json({ error: checked.errors.join(" ") }, { status: 400 });
      details = checked.details;
      title = `Pre-Mobilisation Checklist: ${details.metadata.project} — ${details.metadata.vehicleRegistration}`;
      site = details.metadata.location;
      formDate = details.metadata.date;
    }
    if (b.form_type === "office_risk_assessment") {
      const checked = normaliseOfficeRiskDetails(details);
      if (checked.error) return Response.json({ error: checked.error }, { status: 400 });
      details = checked.details;
      title = `Office Risk Assessment: ${details.area}`;
      site = details.area;
      formDate = details.date;
    }
    if (b.form_type === "ecological_field_swms") {
      const checked = normaliseEcologicalFieldSwmsDetails(details);
      if (checked.errors.length) return Response.json({ error: checked.errors.join(" ") }, { status: 400 });
      details = checked.details;
      title = `Generic SWMS — Ecological Field Surveys: ${details.project} — ${details.activity}`;
      site = details.site;
      formDate = details.date;
    }
    const notifiableFlag = b.notifiable_flag === true;
    const submissionKey = makeSubmissionKey({
      createdBy: access.user.id,
      formType: b.form_type,
      title,
      site,
      formDate,
      notifiableFlag,
      details,
    });

    const { data, error } = await access.admin.from("whs_forms").insert({
      created_by: access.user.id,
      form_type: b.form_type,
      title,
      site,
      form_date: formDate,
      details,
      notifiable_flag: notifiableFlag,
      submission_key: submissionKey,
      status: "submitted",
    }).select(COLUMNS).single();
    if (error) {
      // A repeated tap, browser retry, or mobile network replay is treated as
      // an idempotent replay. Return the original record and do not re-send
      // notifications or create a second history entry.
      if (error.code === "23505" || String(error.message || "").includes("whs_forms_created_by_submission_key_uidx")) {
        const { data: existing } = await access.admin.from("whs_forms").select(COLUMNS).eq("created_by", access.user.id).eq("submission_key", submissionKey).maybeSingle();
        if (existing) return Response.json({ form: existing, duplicate: true }, { status: 200 });
      }
      if (b.form_type === "pre_mobilisation") {
        return Response.json({ error: "The checklist could not be saved. Please try again or contact the Ecology Consulting Office." }, { status: 400 });
      }
      return Response.json({ error: error.message }, { status: 400 });
    }

    // Daily Risk Assessments and ecological survey SWMS records are surfaced
    // to administrators. Notification failure is non-fatal because the saved
    // WHS record remains authoritative and visible in the monitoring register.
    if (["daily_risk_assessment", "ecological_field_swms"].includes(b.form_type)) {
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
            event_type: b.form_type === "ecological_field_swms" ? "ecological_field_swms_submitted" : "daily_risk_assessment_submitted",
            severity: "information",
            title: b.form_type === "ecological_field_swms" ? "Ecological field survey SWMS submitted" : "Daily Risk Assessment submitted",
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
