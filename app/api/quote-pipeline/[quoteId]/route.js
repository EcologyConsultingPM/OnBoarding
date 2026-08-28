import { requireSession, serverError } from "../../../../lib/serverAuth";
import { requirePortalResource } from "../../../../lib/portalVisibility";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const COLUMNS = "id, client, project, project_folder_link, quote_link, hyperlink, quote_total, initial_sent, sent_on, follow_up_on, status, comments, fully_invoiced, superseded, superseded_note, created_at, updated_at";

function opt(v) { const t = typeof v === "string" ? v.trim() : ""; return t || null; }
function num(v) { if (v === "" || v == null) return null; const n = Number(v); return Number.isFinite(n) ? n : null; }
function bool(v) { return v === true || v === "true"; }

function deriveFollowUp(sentOn, explicit) {
  if (opt(explicit)) return opt(explicit);
  if (!opt(sentOn)) return null;
  const d = new Date(sentOn);
  if (isNaN(d.getTime())) return null;
  d.setDate(d.getDate() + 7);
  return d.toISOString().slice(0, 10);
}

export async function PATCH(request, { params }) {
  try {
    const access = await requireSession(request);
    if (access.error) return access.error;
    if (!access.isAdmin) return Response.json({ error: "Administrators only." }, { status: 403 });
    const denied = await requirePortalResource(access, "admin.quote_pipeline");
    if (denied) return denied;

    const body = await request.json();
    const { data, error } = await access.admin
      .from("quote_pipeline")
      .update({
        client: opt(body.client), project: opt(body.project),
        project_folder_link: opt(body.projectFolderLink), quote_link: opt(body.quoteLink),
        hyperlink: opt(body.hyperlink), quote_total: num(body.quoteTotal),
        initial_sent: bool(body.initialSent), sent_on: opt(body.sentOn),
        follow_up_on: deriveFollowUp(body.sentOn, body.followUpOn),
        status: ["pending", "successful", "unsuccessful"].includes(body.status) ? body.status : "pending",
        comments: opt(body.comments), fully_invoiced: bool(body.fullyInvoiced),
        superseded: bool(body.superseded), superseded_note: opt(body.supersededNote),
      })
      .eq("id", params.quoteId).select(COLUMNS).single();
    if (error) return Response.json({ error: error.message }, { status: 400 });
    return Response.json({ quote: data });
  } catch (error) {
    return serverError(error);
  }
}

export async function DELETE(request, { params }) {
  try {
    const access = await requireSession(request);
    if (access.error) return access.error;
    if (!access.isAdmin) return Response.json({ error: "Administrators only." }, { status: 403 });
    const denied = await requirePortalResource(access, "admin.quote_pipeline");
    if (denied) return denied;
    const { error } = await access.admin.from("quote_pipeline").delete().eq("id", params.quoteId);
    if (error) return Response.json({ error: error.message }, { status: 400 });
    return Response.json({ success: true });
  } catch (error) {
    return serverError(error);
  }
}
