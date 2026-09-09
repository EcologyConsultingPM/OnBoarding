import { requireSession, serverError } from "../../../lib/serverAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TABLE = "flora_photo_submissions";
const COLUMNS = [
  "id", "submitted_by", "taxon_name", "common_name", "photo_data", "note",
  "status", "reviewed_by", "reviewed_at", "review_note", "seen_by_staff",
  "created_at", "updated_at",
].join(", ");

function jsonError(error, status = 400) {
  return Response.json({ error }, { status });
}

async function enrichEmails(admin, rows) {
  const ids = Array.from(new Set(rows.flatMap((row) => [row.submitted_by, row.reviewed_by]).filter(Boolean)));
  const emailById = {};
  await Promise.all(ids.map(async (id) => {
    try {
      const { data } = await admin.auth.admin.getUserById(id);
      if (data?.user?.email) emailById[id] = data.user.email;
    } catch {
      // Best-effort enrichment; the submission remains usable without email metadata.
    }
  }));
  return rows.map((row) => ({
    ...row,
    submitted_by_email: emailById[row.submitted_by] || null,
    reviewed_by_email: row.reviewed_by ? emailById[row.reviewed_by] || null : null,
  }));
}

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
    if (error) return jsonError(error.message, 500);

    const submissions = access.isAdmin ? await enrichEmails(access.admin, data || []) : (data || []);
    return Response.json({ submissions });
  } catch (error) {
    return serverError(error);
  }
}

export async function POST(request) {
  try {
    const access = await requireSession(request);
    if (access.error) return access.error;

    const body = await request.json().catch(() => ({}));
    const taxonName = String(body?.taxon_name || "").trim();
    const commonName = String(body?.common_name || "").trim();
    const photoData = String(body?.photo_data || "").trim();
    const note = String(body?.note || "").trim();
    if (!taxonName || !photoData) return jsonError("Missing taxon_name or photo_data.");
    if (photoData.length > 8_000_000) return jsonError("That image is too large. Please choose a smaller photo.");

    const { data, error } = await access.admin
      .from(TABLE)
      .insert({
        submitted_by: access.user.id,
        taxon_name: taxonName,
        common_name: commonName || null,
        photo_data: photoData,
        note: note || null,
        status: "pending",
      })
      .select(COLUMNS)
      .single();
    if (error) return jsonError(error.message, 500);
    return Response.json({ submission: data });
  } catch (error) {
    return serverError(error);
  }
}
