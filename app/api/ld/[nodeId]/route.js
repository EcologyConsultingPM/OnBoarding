import { requireSession, serverError } from "../../../../lib/serverAuth";
import { requirePortalResource } from "../../../../lib/portalVisibility";
import { getModuleReadiness, normaliseModuleContent } from "../../../../lib/learningModule";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const COLUMNS = "id, parent_id, node_type, title, description, sort_order, visibility, approval_status, reviewed_by, reviewed_at, review_note, storage_path, file_name, file_kind, content_type, module_content, version_label, review_date, locked, archived_at, created_at, updated_at";

export async function GET(request, { params }) {
  try {
    const access = await requireSession(request);
    if (access.error) return access.error;
    const staffAudience = new URL(request.url).searchParams.get("audience") === "staff" || !access.isAdmin;
    const denied = await requirePortalResource(access, staffAudience ? "staff.learning" : "admin.learning");
    if (denied) return denied;

    let query = access.admin.from("ld_nodes").select(COLUMNS).eq("id", params.nodeId).is("archived_at", null);
    if (staffAudience) query = query.eq("visibility", "staff").eq("approval_status", "approved");
    const { data, error } = await query.maybeSingle();
    if (error) return Response.json({ error: error.message }, { status: 400 });
    if (!data) return Response.json({ error: "Learning module not found." }, { status: 404 });
    return Response.json({ node: { ...data, module_content: normaliseModuleContent(data.module_content) } });
  } catch (error) {
    return serverError(error);
  }
}

export async function PATCH(request, { params }) {
  try {
    const access = await requireSession(request);
    if (access.error) return access.error;
    if (!access.isAdmin) return Response.json({ error: "Administrators only." }, { status: 403 });
    const denied = await requirePortalResource(access, "admin.learning");
    if (denied) return denied;
    const body = await request.json();

    const { data: current, error: currentError } = await access.admin.from("ld_nodes")
      .select(COLUMNS).eq("id", params.nodeId).maybeSingle();
    if (currentError) return Response.json({ error: currentError.message }, { status: 400 });
    if (!current) return Response.json({ error: "Learning module not found." }, { status: 404 });

    if (body.action === "submit_review") {
      if (current.approval_status !== "draft") return Response.json({ error: "Only draft content can be submitted for review." }, { status: 409 });
      if (current.content_type === "learning_module") {
        const readiness = getModuleReadiness(current.module_content);
        if (!readiness.ready) return Response.json({ error: `Complete the module before review: ${readiness.missing.join(", ")}.` }, { status: 409 });
      }
      const { data, error } = await access.admin.from("ld_nodes")
        .update({ approval_status: "pending_review" }).eq("id", params.nodeId).select(COLUMNS).single();
      if (error) return Response.json({ error: error.message }, { status: 400 });
      return Response.json({ node: data });
    }
    if (body.action === "approve") {
      if (current.approval_status !== "pending_review") return Response.json({ error: "Submit this content for review before approving it." }, { status: 409 });
      const { data, error } = await access.admin.from("ld_nodes")
        .update({ approval_status: "approved", reviewed_by: access.user.id, reviewed_at: new Date().toISOString(), review_note: String(body.review_note || "").trim() || null })
        .eq("id", params.nodeId).select(COLUMNS).single();
      if (error) return Response.json({ error: error.message }, { status: 400 });
      return Response.json({ node: data });
    }
    if (body.action === "archive") {
      const { data, error } = await access.admin.from("ld_nodes")
        .update({ approval_status: "archived", archived_at: new Date().toISOString() }).eq("id", params.nodeId).select(COLUMNS).single();
      if (error) return Response.json({ error: error.message }, { status: 400 });
      return Response.json({ node: data });
    }

    const patch = {};
    if ("title" in body) patch.title = String(body.title || "").trim();
    if ("description" in body) patch.description = String(body.description || "").trim() || null;
    if ("visibility" in body) patch.visibility = body.visibility === "admin" ? "admin" : "staff";
    if (Number.isFinite(body.sort_order)) patch.sort_order = body.sort_order;
    if ("module_content" in body) {
      if (current.content_type !== "learning_module") return Response.json({ error: "Only structured learning modules can store module content." }, { status: 409 });
      patch.module_content = normaliseModuleContent(body.module_content);
    }
    if (!Object.keys(patch).length) return Response.json({ error: "Choose a learning module change." }, { status: 400 });
    if ("title" in patch && !patch.title) return Response.json({ error: "A title is required." }, { status: 400 });

    const { data, error } = await access.admin.from("ld_nodes").update(patch).eq("id", params.nodeId).select(COLUMNS).single();
    if (error) return Response.json({ error: error.message }, { status: 400 });
    return Response.json({ node: data });
  } catch (error) {
    return serverError(error);
  }
}

export async function DELETE(request, { params }) {
  try {
    const access = await requireSession(request);
    if (access.error) return access.error;
    if (!access.isAdmin) return Response.json({ error: "Administrators only." }, { status: 403 });
    const denied = await requirePortalResource(access, "admin.learning");
    if (denied) return denied;
    const { error } = await access.admin.from("ld_nodes").delete().eq("id", params.nodeId);
    if (error) return Response.json({ error: error.message }, { status: 400 });
    return Response.json({ success: true });
  } catch (error) {
    return serverError(error);
  }
}
