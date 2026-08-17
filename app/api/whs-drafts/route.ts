import { requireSession, serverError } from "../../../lib/serverAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const allowedDocumentTypes = new Set(["swms", "psychosocial"]);

function cleanOptional(value) {
  const text = typeof value === "string" ? value.trim() : "";
  return text || null;
}

export async function GET(request) {
  try {
    const access = await requireSession(request);
    if (access.error) return access.error;

    let query = access.admin
      .from("whs_drafts")
      .select("id, document_type, title, project_name, site_location, work_activity, team_and_roles, emergency_arrangements, consultation_notes, review_date, status, created_by, reviewed_by, reviewed_at, created_at, updated_at")
      .order("updated_at", { ascending: false });

    if (!access.isAdmin) query = query.eq("created_by", access.user.id);

    const { data, error } = await query;
    if (error) return Response.json({ error: error.message }, { status: 400 });
    return Response.json({ drafts: data || [] });
  } catch (error) {
    return serverError(error);
  }
}

export async function POST(request) {
  try {
    const access = await requireSession(request);
    if (access.error) return access.error;
    const body = await request.json();

    const documentType = body.documentType;
    const title = typeof body.title === "string" ? body.title.trim() : "";
    const workActivity = typeof body.workActivity === "string" ? body.workActivity.trim() : "";

    if (!allowedDocumentTypes.has(documentType)) {
      return Response.json({ error: "Document type must be SWMS or psychosocial." }, { status: 400 });
    }
    if (title.length < 3 || workActivity.length < 3) {
      return Response.json({ error: "A title and work activity are required." }, { status: 400 });
    }

    const { data, error } = await access.admin
      .from("whs_drafts")
      .insert({
        created_by: access.user.id,
        document_type: documentType,
        title,
        project_name: cleanOptional(body.projectName),
        site_location: cleanOptional(body.siteLocation),
        work_activity: workActivity,
        team_and_roles: cleanOptional(body.teamAndRoles),
        emergency_arrangements: cleanOptional(body.emergencyArrangements),
        consultation_notes: cleanOptional(body.consultationNotes),
        review_date: cleanOptional(body.reviewDate),
        status: "draft",
      })
      .select()
      .single();

    if (error) return Response.json({ error: error.message }, { status: 400 });
    return Response.json({ draft: data }, { status: 201 });
  } catch (error) {
    return serverError(error);
  }
}
