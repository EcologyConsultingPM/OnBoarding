import { requireSession, serverError } from "../../../../lib/serverAuth";
import { INCIDENT_COLUMNS, incidentValues } from "../route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function reportAccess(access, reportId) {
  const { data: report, error } = await access.admin
    .from("incident_reports")
    .select("id, created_by, status")
    .eq("id", reportId)
    .maybeSingle();

  if (error || !report) return { response: Response.json({ error: "Incident report not found." }, { status: 404 }) };
  if (!access.isAdmin && report.created_by !== access.user.id) {
    return { response: Response.json({ error: "You do not have access to this incident report." }, { status: 403 }) };
  }
  return { report };
}

export async function PATCH(request, { params }) {
  try {
    const access = await requireSession(request);
    if (access.error) return access.error;
    const authorisation = await reportAccess(access, params.reportId);
    if (authorisation.response) return authorisation.response;
    if (authorisation.report.status === "approved") {
      return Response.json({ error: "Approved reports cannot be edited. Create a new report for changes." }, { status: 409 });
    }

    const body = await request.json();
    const { data, error } = await access.admin
      .from("incident_reports")
      .update(incidentValues(body))
      .eq("id", params.reportId)
      .select(INCIDENT_COLUMNS)
      .single();

    if (error) return Response.json({ error: error.message }, { status: 400 });
    return Response.json({ report: data });
  } catch (error) {
    return serverError(error);
  }
}

export async function POST(request, { params }) {
  try {
    const access = await requireSession(request);
    if (access.error) return access.error;
    const authorisation = await reportAccess(access, params.reportId);
    if (authorisation.response) return authorisation.response;

    const { data, error } = await access.admin
      .from("incident_reports")
      .update({ status: "ready_for_review" })
      .eq("id", params.reportId)
      .select(INCIDENT_COLUMNS)
      .single();

    if (error) return Response.json({ error: error.message }, { status: 400 });
    return Response.json({ report: data });
  } catch (error) {
    return serverError(error);
  }
}
