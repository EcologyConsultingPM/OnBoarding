import { requireSession, serverError } from "../../../lib/serverAuth";

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

function submissionInput(body) {
  const taxonName = String(body?.taxon_name || "").trim();
  const commonName = String(body?.common_name || "").trim();
  const photoData = String(body?.photo_data || "").trim();
  const note = String(body?.note || "").trim();

  if (!taxonName) return { error: "Scientific name is required." };
  if (!/^data:image\/(jpeg|jpg|png|webp);base64,/i.test(photoData)) {
    return { error: "Upload a valid JPG, PNG or WebP image." };
  }
  // Client-side image resizing targets 1100 px. Retain a conservative server-side
  // cap so base64 uploads cannot exhaust the serverless request budget.
  if (photoData.length > 5_000_000) return { error: "Image is too large. Use a smaller image." };

  return { taxonName, commonName, photoData, note };
}

// Staff receive only their own submissions; authorised administrators receive the
// full expert-review queue. Both outcomes are JSON, including access failures.
export async function GET(request) {
  try {
    const access = await requireSession(request);
    if (access.error) return access.error;

    let query = access.admin
      .from(TABLE)
      .select(COLUMNS)
      .order("created_at", { ascending: false });

    if (!access.isAdmin) query = query.eq("submitted_by", access.user.id);

    const { data, error } = await query;
    if (error) return jsonError(error.message);

    return Response.json({ submissions: data || [], isAdmin: access.isAdmin });
  } catch (error) {
    return serverError(error);
  }
}

// Any authenticated staff member may submit an observation for expert verification.
export async function POST(request) {
  try {
    const access = await requireSession(request);
    if (access.error) return access.error;

    const parsed = submissionInput(await request.json());
    if (parsed.error) return jsonError(parsed.error);

    const { data, error } = await access.admin
      .from(TABLE)
      .insert({
        submitted_by: access.user.id,
        taxon_name: parsed.taxonName,
        common_name: parsed.commonName || null,
        photo_data: parsed.photoData,
        note: parsed.note || null,
        status: "pending",
        seen_by_staff: false,
      })
      .select(COLUMNS)
      .single();

    if (error) return jsonError(error.message);
    return Response.json({ submission: data }, { status: 201 });
  } catch (error) {
    return serverError(error);
  }
}

// Expert verification is an administrator-only action. A verified/rejected result
// is deliberately recorded with reviewer and timestamp for auditability.
export async function PATCH(request, { params }) {
  try {
    const access = await requireSession(request);
    if (access.error) return access.error;
    if (!access.isAdmin) return jsonError("Only administrators can review fauna photos.", 403);

    const id = String(params?.id || "").trim();
    const body = await request.json();
    const status = String(body?.status || "").trim();
    const reviewNote = String(body?.review_note || "").trim();

    if (!id) return jsonError("Submission ID is required.");
    if (!['verified', 'rejected'].includes(status)) {
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

    if (error) return jsonError(error.message);
    if (!data) return jsonError("Photo submission not found.", 404);
    return Response.json({ submission: data });
  } catch (error) {
    return serverError(error);
  }
}

// Staff can withdraw only their own pending submission. Administrators can remove a
// submission if required for controlled-library or privacy management.
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

    if (lookupError) return jsonError(lookupError.message);
    if (!existing) return jsonError("Photo submission not found.", 404);

    const isOwner = existing.submitted_by === access.user.id;
    if (!access.isAdmin && (!isOwner || existing.status !== "pending")) {
      return jsonError("Only your pending submission can be removed.", 403);
    }

    const { error } = await access.admin.from(TABLE).delete().eq("id", id);
    if (error) return jsonError(error.message);
    return Response.json({ deleted: true, id });
  } catch (error) {
    return serverError(error);
  }
}
