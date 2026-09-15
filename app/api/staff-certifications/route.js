import { requireSession, serverError } from "../../../lib/serverAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function jsonError(error, status = 400) {
  return Response.json({ error }, { status });
}

export async function GET(request) {
  try {
    const access = await requireSession(request);
    if (access.error) return access.error;

    let query = access.admin.from("staff_certifications").select("*").eq("is_active", true).order("expiry_date", { ascending: true, nullsFirst: false });
    if (!access.isAdmin) query = query.eq("staff_user_id", access.user.id);
    const { data, error } = await query;
    if (error) return jsonError(error.message);

    return Response.json({ certifications: data || [] });
  } catch (error) {
    return serverError(error);
  }
}

export async function POST(request) {
  try {
    const access = await requireSession(request);
    if (access.error) return access.error;
    if (!access.isAdmin) return jsonError("Only administrators can record staff certifications.", 403);

    const body = await request.json();
    if (!body.staffUserId) return jsonError("A staff member is required.");
    const competency = String(body.competency || "").trim();
    if (!competency) return jsonError("A competency/certification name is required.");

    const { data, error } = await access.admin.from("staff_certifications").insert({
      staff_user_id: body.staffUserId,
      competency,
      issued_date: body.issuedDate || null,
      expiry_date: body.expiryDate || null,
      certificate_number: body.certificateNumber || null,
      created_by: access.user.id,
    }).select("*").single();
    if (error) return jsonError(error.message);

    return Response.json({ certification: data }, { status: 201 });
  } catch (error) {
    return serverError(error);
  }
}

export async function DELETE(request) {
  try {
    const access = await requireSession(request);
    if (access.error) return access.error;
    if (!access.isAdmin) return jsonError("Only administrators can remove staff certifications.", 403);

    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");
    if (!id) return jsonError("A certification id is required.");

    const { error } = await access.admin.from("staff_certifications").update({ is_active: false }).eq("id", id);
    if (error) return jsonError(error.message);

    return Response.json({ success: true });
  } catch (error) {
    return serverError(error);
  }
}
