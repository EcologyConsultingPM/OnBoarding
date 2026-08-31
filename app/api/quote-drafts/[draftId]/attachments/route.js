import { requireSession, serverError } from "../../../../../lib/serverAuth";
import { requirePortalResource } from "../../../../../lib/portalVisibility";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BUCKET = "quote-draft-attachments";
const MAX_FILE_BYTES = 15 * 1024 * 1024;
const ALLOWED_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/msword",
  "application/vnd.ms-excel",
  "text/plain",
]);

function jsonError(error, status = 400) {
  return Response.json({ error }, { status });
}

async function authorisedAccess(request) {
  const access = await requireSession(request);
  if (access.error) return { error: access.error };
  if (!access.isAdmin) return { error: jsonError("Administrators only.", 403) };
  const denied = await requirePortalResource(access, "admin.quote_pipeline");
  if (denied) return { error: denied };
  return { access };
}

async function readDraft(admin, id) {
  const { data, error } = await admin
    .from("quote_drafts")
    .select("id, attachments, quote_pdf_path, transferred_quote_id")
    .eq("id", id)
    .single();
  if (error) throw new Error(error.message);
  return data;
}

function safeFileName(value) {
  return String(value || "attachment").replace(/[^a-zA-Z0-9._-]/g, "-").slice(-160);
}

function normaliseAttachments(value) {
  return Array.isArray(value) ? value.filter((item) => item && typeof item.path === "string") : [];
}

export async function POST(request, { params }) {
  try {
    const authorised = await authorisedAccess(request);
    if (authorised.error) return authorised.error;
    const { access } = authorised;
    const draft = await readDraft(access.admin, params.draftId);
    if (draft.transferred_quote_id) return jsonError("Transferred enquiries are retained as audit records and cannot accept new files.", 409);

    const form = await request.formData();
    const file = form.get("file");
    const quotePdf = form.get("quotePdf") === "true";
    if (!(file instanceof File)) return jsonError("Choose a supporting file to upload.");
    if (!file.size) return jsonError("The selected file is empty.");
    if (file.size > MAX_FILE_BYTES) return jsonError("Files must be 15 MB or smaller.");
    if (file.type && !ALLOWED_TYPES.has(file.type)) return jsonError("Upload a PDF, image, Word, Excel or text file.");

    const path = `drafts/${draft.id}/${Date.now()}-${safeFileName(file.name)}`;
    const { error: uploadError } = await access.admin.storage.from(BUCKET).upload(path, file, {
      upsert: false,
      contentType: file.type || undefined,
    });
    if (uploadError) return jsonError(uploadError.message);

    const attachments = normaliseAttachments(draft.attachments);
    const nextAttachments = [...attachments, {
      path,
      name: safeFileName(file.name),
      type: file.type || "application/octet-stream",
      size: file.size,
      uploadedAt: new Date().toISOString(),
    }];
    const values = { attachments: nextAttachments, updated_at: new Date().toISOString() };
    if (quotePdf) values.quote_pdf_path = path;
    const { data, error } = await access.admin
      .from("quote_drafts")
      .update(values)
      .eq("id", draft.id)
      .select("id, attachments, quote_pdf_path")
      .single();
    if (error) return jsonError(error.message);
    return Response.json({ draft: data, attachment: nextAttachments.at(-1) }, { status: 201 });
  } catch (error) {
    return serverError(error);
  }
}

export async function GET(request, { params }) {
  try {
    const authorised = await authorisedAccess(request);
    if (authorised.error) return authorised.error;
    const { access } = authorised;
    const url = new URL(request.url);
    const path = String(url.searchParams.get("path") || "");
    const draft = await readDraft(access.admin, params.draftId);
    const attachments = normaliseAttachments(draft.attachments);
    if (!attachments.some((attachment) => attachment.path === path)) return jsonError("That attachment is not linked to this draft enquiry.", 404);
    const { data, error } = await access.admin.storage.from(BUCKET).createSignedUrl(path, 300);
    if (error) return jsonError(error.message);
    return Response.json({ url: data?.signedUrl || null });
  } catch (error) {
    return serverError(error);
  }
}
