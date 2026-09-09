import { requireSession, serverError } from "../../../../lib/serverAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TABLE = "fauna_photo_submissions";
const COLUMNS = [
  "id", "submitted_by", "taxon_name", "common_name", "photo_data", "note",
  "status", "reviewed_by", "reviewed_at", "review_note", "seen_by_staff",
  "created_at", "updated_at",
].join(", ");

function jsonError(error, status = 400) {
  return Response.json({ error }, { status });
}

export async function PATCH(request, { params }) {
  try {
    const access = await requireSession(request);
    if (access.error) return access.error;
    if (!access.isAdmin) return jsonError("Only administrators can review fauna photos.", 403);

    const id = String(params?.id || "").trim();
    const body = await request.json().catch(() => ({}));
    const status = String(body?.status || "").trim();
    const reviewNote = String(body?.review_note || "").trim();
    if (!id) return jsonError("Submission ID is required.");
    if (!["verified", "rejected"].includes(status)) {
      return jsonError("Review status must be verified or rejected.");
    }

    const { data, error } = await access.admin
      .from(TABLE)
      .update({
        status,
        review_note: reviewNote || null,
        reviewed_by: access.user.id,
        reviewed_at: new Date().toISOString(),
        seen_by_staff: false,
      })
      .eq("id", id)
      .select(COLUMNS)
      .maybeSingle();

    if (error) return jsonError(error.message, 500);
    if (!data) return jsonError("Photo submission not found.", 404);
    return Response.json({ submission: data });
  } catch (error) {
    return serverError(error);
  }
}

export async function DELETE(request, { params }) {
  try {
    const access = await requireSession(request);
    if (access.error) return access.error;

    const id = String(params?.id || "").trim();
    if (!id) return jsonError("Submission ID is required.");

    const { data: existing, error: lookupError } = await access.admin
      .from(TABLE)
      .select("id, submitted_by, status")
      .eq("id", id)
      .maybeSingle();
    if (lookupError) return jsonError(lookupError.message, 500);
    if (!existing) return jsonError("Photo submission not found.", 404);

    const isOwner = existing.submitted_by === access.user.id;
    if (!access.isAdmin && (!isOwner || existing.status !== "pending")) {
      return jsonError("Only your pending submission can be removed.", 403);
    }

    const { error } = await access.admin.from(TABLE).delete().eq("id", id);
    if (error) return jsonError(error.message, 500);
    return Response.json({ deleted: true, id });
  } catch (error) {
    return serverError(error);
  }
}
