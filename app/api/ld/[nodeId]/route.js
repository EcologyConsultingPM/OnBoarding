import { requireSession, serverError } from "../../../../lib/serverAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const COLUMNS = "id, parent_id, node_type, title, description, sort_order, visibility, approval_status, reviewed_by, reviewed_at, review_note, storage_path, file_name, file_kind, created_at, updated_at";

export async function PATCH(request, { params }) {
  try {
    const access = await requireSession(request);
    if (access.error) return access.error;
    if (!access.isAdmin) return Response.json({ error: "Administrators only." }, { status: 403 });
    const b = await request.json();

    // Approval workflow actions.
    if (b.action === "submit_review") {
      const { data, error } = await access.admin.from("ld_nodes")
        .update({ approval_status: "pending_review" }).eq("id", params.nodeId).select(COLUMNS).single();
      if (error) return Response.json({ error: error.message }, { status: 400 });
      return Response.json({ node: data });
    }
    if (b.action === "approve") {
      const { data, error } = await access.admin.from("ld_nodes")
        .update({ approval_status: "approved", reviewed_by: access.user.id, reviewed_at: new Date().toISOString(), review_note: (b.review_note || "").toString().trim() || null })
        .eq("id", params.nodeId).select(COLUMNS).single();
      if (error) return Response.json({ error: error.message }, { status: 400 });
      return Response.json({ node: data });
    }
    if (b.action === "archive") {
      const { data, error } = await access.admin.from("ld_nodes")
        .update({ approval_status: "archived" }).eq("id", params.nodeId).select(COLUMNS).single();
      if (error) return Response.json({ error: error.message }, { status: 400 });
      return Response.json({ node: data });
    }

    // Plain edit (rename, description, visibility).
    const patch = {};
    if ("title" in b) patch.title = (b.title || "").toString().trim();
    if ("description" in b) patch.description = (b.description || "").toString().trim() || null;
    if ("visibility" in b) patch.visibility = b.visibility === "admin" ? "admin" : "staff";
    if (Number.isFinite(b.sort_order)) patch.sort_order = b.sort_order;
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
    const { error } = await access.admin.from("ld_nodes").delete().eq("id", params.nodeId);
    if (error) return Response.json({ error: error.message }, { status: 400 });
    return Response.json({ success: true });
  } catch (error) {
    return serverError(error);
  }
}
