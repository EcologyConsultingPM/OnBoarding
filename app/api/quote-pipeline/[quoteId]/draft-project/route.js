import { requireSession, serverError } from "../../../../../lib/serverAuth";
import { requirePortalResource } from "../../../../../lib/portalVisibility";
import { compactAuditRecord, recordAudit } from "../../../../../lib/auditLog";

const COLUMNS = "id, quote_id, project_id, status, approval_note, reviewed_by, reviewed_at, activated_by, activated_at, created_by, created_at, updated_at, projects(id,name,client_name,status)";
const text = (value, maximum = 3000) => { const clean = String(value || "").trim(); return clean ? clean.slice(0, maximum) : null; };

async function allow(access) {
  if (!access.isAdmin) return Response.json({ error: "Administrators only." }, { status: 403 });
  return requirePortalResource(access, "admin.quote_pipeline.draft_projects");
}
async function readLink(admin, quoteId) {
  const { data, error } = await admin.from("quote_draft_projects").select(COLUMNS).eq("quote_id", quoteId).maybeSingle();
  if (error) throw new Error(error.message); return data;
}

export async function GET(request, { params }) {
  try { const access = await requireSession(request); if (access.error) return access.error; const denied = await allow(access); if (denied) return denied; return Response.json({ draftProject: await readLink(access.admin, params.quoteId) }); }
  catch (error) { return serverError(error); }
}

export async function POST(request, { params }) {
  try {
    const access = await requireSession(request); if (access.error) return access.error;
    const denied = await allow(access); if (denied) return denied;
    const body = await request.json(); const action = String(body.action || "create");
    if (action === "create") {
      const { data, error } = await access.admin.rpc("ensure_quote_draft_project", { p_quote_id: params.quoteId, p_actor_id: access.user.id });
      if (error) return Response.json({ error: error.message }, { status: 400 });
      const draftProject = await readLink(access.admin, params.quoteId);
      await recordAudit(access.admin, { actorId: access.user.id, action: "created", entityType: "quote_draft_project", entityId: draftProject?.id, projectId: draftProject?.project_id, resourceKey: "admin.quote_pipeline.draft_projects", afterData: compactAuditRecord(draftProject, ["quote_id", "project_id", "status"]) });
      return Response.json({ draftProject, created: Boolean(data?.length) }, { status: 201 });
    }
    const current = await readLink(access.admin, params.quoteId);
    if (!current) return Response.json({ error: "Create the draft project before reviewing it." }, { status: 404 });
    if (["activated", "archived"].includes(current.status)) return Response.json({ error: "This draft-project link is closed and cannot be changed here." }, { status: 409 });
    const note = text(body.note, 3000);
    if (!note) return Response.json({ error: "Record the review or decision note." }, { status: 400 });
    if (!['approve','reject','activate','archive'].includes(action)) return Response.json({ error: "Choose an approved draft-project action." }, { status: 400 });
    if (action === "activate" && current.status !== "approved") return Response.json({ error: "Approve the draft project before activating it." }, { status: 409 });
    const now = new Date().toISOString();
    const values = { approval_note: note, updated_at: now };
    if (action === "approve") Object.assign(values, { status: "approved", reviewed_by: access.user.id, reviewed_at: now });
    if (action === "reject") Object.assign(values, { status: "rejected", reviewed_by: access.user.id, reviewed_at: now });
    if (action === "activate") Object.assign(values, { status: "activated", activated_by: access.user.id, activated_at: now });
    if (action === "archive") Object.assign(values, { status: "archived", reviewed_by: access.user.id, reviewed_at: now });
    const { data: draftProject, error } = await access.admin.from("quote_draft_projects").update(values).eq("id", current.id).select(COLUMNS).single();
    if (error) return Response.json({ error: error.message }, { status: 400 });
    if (action === "activate") {
      const { error: projectError } = await access.admin.from("projects").update({ status: "active", updated_at: now }).eq("id", current.project_id).eq("status", "draft");
      if (projectError) return Response.json({ error: projectError.message }, { status: 400 });
    }
    await recordAudit(access.admin, { actorId: access.user.id, action, entityType: "quote_draft_project", entityId: current.id, projectId: current.project_id, resourceKey: "admin.quote_pipeline.draft_projects", beforeData: compactAuditRecord(current, ["status", "approval_note"]), afterData: compactAuditRecord(draftProject, ["status", "approval_note"]), reason: note });
    return Response.json({ draftProject });
  } catch (error) { return serverError(error); }
}
