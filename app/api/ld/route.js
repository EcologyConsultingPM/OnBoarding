import { requireSession, serverError } from "../../../lib/serverAuth";
import { requirePortalResource } from "../../../lib/portalVisibility";
import { createDefaultModuleContent, normaliseModuleContent } from "../../../lib/learningModule";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const COLUMNS = "id, parent_id, node_type, title, description, sort_order, visibility, approval_status, storage_path, file_name, file_kind, content_type, module_content, version_label, review_date, locked, archived_at, created_at, updated_at";

// List children of a node (or top-level sections when no parent is given).
export async function GET(request) {
  try {
    const access = await requireSession(request);
    if (access.error) return access.error;

    const url = new URL(request.url);
    const parent = url.searchParams.get("parent");
    const staffAudience = url.searchParams.get("audience") === "staff" || !access.isAdmin;
    const denied = await requirePortalResource(access, staffAudience ? "staff.learning" : "admin.learning");
    if (denied) return denied;

    let query = access.admin.from("ld_nodes").select(COLUMNS).is("archived_at", null).order("sort_order", { ascending: true });
    if (parent) query = query.eq("parent_id", parent);
    else query = query.is("parent_id", null);
    if (staffAudience) query = query.eq("visibility", "staff").eq("approval_status", "approved").is("archived_at", null);

    const { data, error } = await query;
    if (error) return Response.json({ error: error.message }, { status: 400 });
    const nodes = data || [];

    const ids = nodes.map((node) => node.id);
    const counts = {};
    if (ids.length) {
      let childrenQuery = access.admin.from("ld_nodes").select("parent_id").in("parent_id", ids).is("archived_at", null);
      if (staffAudience) childrenQuery = childrenQuery.eq("visibility", "staff").eq("approval_status", "approved");
      const { data: children } = await childrenQuery;
      for (const child of children || []) counts[child.parent_id] = (counts[child.parent_id] || 0) + 1;
    }

    const trail = [];
    if (parent) {
      let current = parent;
      for (let index = 0; index < 8 && current; index += 1) {
        let breadcrumbQuery = access.admin.from("ld_nodes").select("id, parent_id, title").eq("id", current);
        if (staffAudience) breadcrumbQuery = breadcrumbQuery.eq("visibility", "staff").eq("approval_status", "approved").is("archived_at", null);
        const { data: breadcrumb } = await breadcrumbQuery.maybeSingle();
        if (!breadcrumb) break;
        trail.unshift({ id: breadcrumb.id, title: breadcrumb.title });
        current = breadcrumb.parent_id;
      }
    }

    const shapedNodes = nodes
      .map((node) => ({ ...node, childCount: counts[node.id] || 0 }))
      .filter((node) => !staffAudience || node.node_type === "item" || node.childCount > 0);

    return Response.json({ nodes: shapedNodes, trail, isAdmin: access.isAdmin, audience: staffAudience ? "staff" : "admin" });
  } catch (error) {
    return serverError(error);
  }
}

// Admin: create a folder, structural node or structured learning module.
export async function POST(request) {
  try {
    const access = await requireSession(request);
    if (access.error) return access.error;
    if (!access.isAdmin) return Response.json({ error: "Administrators only." }, { status: 403 });
    const denied = await requirePortalResource(access, "admin.learning");
    if (denied) return denied;

    const body = await request.json();
    const title = String(body.title || "").trim();
    if (!title) return Response.json({ error: "A title is required." }, { status: 400 });
    const nodeType = ["section", "career_level", "module", "folder", "item"].includes(body.node_type) ? body.node_type : "item";
    const contentType = nodeType === "item" && body.content_type === "learning_module" ? "learning_module" : null;

    const { data, error } = await access.admin.from("ld_nodes").insert({
      parent_id: body.parent_id || null,
      node_type: nodeType,
      title,
      description: String(body.description || "").trim() || null,
      visibility: body.visibility === "admin" ? "admin" : "staff",
      approval_status: "draft",
      content_type: contentType,
      module_content: contentType ? normaliseModuleContent(body.module_content || createDefaultModuleContent()) : {},
      sort_order: Number.isFinite(body.sort_order) ? body.sort_order : 0,
      created_by: access.user.id,
    }).select(COLUMNS).single();
    if (error) return Response.json({ error: error.message }, { status: 400 });
    return Response.json({ node: data }, { status: 201 });
  } catch (error) {
    return serverError(error);
  }
}
