import { requireSession, serverError } from "../../../lib/serverAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const INCIDENT_COLUMNS =
  "id, organisation, site_location, incident_date, incident_time, report_date, reported_by, supervisor_notified, supervisor_contact, incident_types, severity_rating, investigation_target, notifiable, safework_reference, scene_preserved, notified_datetime, person_name, person_dob, person_position, employment_type, employer_company, years_experience, years_with_org, injury_nature, body_parts, medical_treatment, task_performed, exact_location, environmental_conditions, incident_description, witnesses, corrective_actions, signoff, status, created_by, reviewed_by, reviewed_at, created_at, updated_at";

function opt(value) {
  const text = typeof value === "string" ? value.trim() : "";
  return text || null;
}

function stringList(list) {
  if (!Array.isArray(list)) return [];
  return list.map((v) => String(v || "").trim()).filter(Boolean);
}

function cleanRows(list, keyField, fields) {
  if (!Array.isArray(list)) return [];
  return list
    .filter((row) => row && typeof row[keyField] === "string" && row[keyField].trim())
    .map((row) => {
      const out = {};
      for (const f of fields) out[f] = String(row[f] || "").trim();
      return out;
    });
}

// Shared mapper used by both create and update so the two routes stay in sync.
export function incidentValues(body) {
  return {
    organisation: opt(body.organisation),
    site_location: opt(body.siteLocation),
    incident_date: opt(body.incidentDate),
    incident_time: opt(body.incidentTime),
    report_date: opt(body.reportDate),
    reported_by: opt(body.reportedBy),
    supervisor_notified: opt(body.supervisorNotified),
    supervisor_contact: opt(body.supervisorContact),
    incident_types: stringList(body.incidentTypes),
    severity_rating: opt(body.severityRating),
    investigation_target: opt(body.investigationTarget),
    notifiable: opt(body.notifiable),
    safework_reference: opt(body.safeworkReference),
    scene_preserved: opt(body.scenePreserved),
    notified_datetime: opt(body.notifiedDatetime),
    person_name: opt(body.personName),
    person_dob: opt(body.personDob),
    person_position: opt(body.personPosition),
    employment_type: opt(body.employmentType),
    employer_company: opt(body.employerCompany),
    years_experience: opt(body.yearsExperience),
    years_with_org: opt(body.yearsWithOrg),
    injury_nature: opt(body.injuryNature),
    body_parts: opt(body.bodyParts),
    medical_treatment: opt(body.medicalTreatment),
    task_performed: opt(body.taskPerformed),
    exact_location: opt(body.exactLocation),
    environmental_conditions: opt(body.environmentalConditions),
    incident_description: opt(body.incidentDescription),
    witnesses: cleanRows(body.witnesses, "name", ["name", "contact", "type", "statement"]),
    corrective_actions: cleanRows(body.correctiveActions, "action", ["action", "responsible", "dateCompleted"]),
    signoff: cleanRows(body.signoff, "name", ["role", "name", "signature", "date"]),
  };
}

export async function GET(request) {
  try {
    const access = await requireSession(request);
    if (access.error) return access.error;

    let query = access.admin
      .from("incident_reports")
      .select(INCIDENT_COLUMNS)
      .order("updated_at", { ascending: false });

    if (!access.isAdmin) query = query.eq("created_by", access.user.id);

    const { data, error } = await query;
    if (error) return Response.json({ error: error.message }, { status: 400 });
    return Response.json({ reports: data || [] });
  } catch (error) {
    return serverError(error);
  }
}

export async function POST(request) {
  try {
    const access = await requireSession(request);
    if (access.error) return access.error;
    const body = await request.json();

    const { data, error } = await access.admin
      .from("incident_reports")
      .insert({ ...incidentValues(body), created_by: access.user.id, status: "draft" })
      .select(INCIDENT_COLUMNS)
      .single();

    if (error) return Response.json({ error: error.message }, { status: 400 });
    return Response.json({ report: data }, { status: 201 });
  } catch (error) {
    return serverError(error);
  }
}
