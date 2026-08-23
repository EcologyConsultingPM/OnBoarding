import { requireSession, serverError } from "../../../lib/serverAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const COLUMNS = "id, parent_id, node_type, title, description, sort_order, visibility, approval_status, storage_path, file_name, file_kind, created_at, updated_at";

// List children of a node (or top-level sections when no parent given).
// RLS already restricts what staff can see (staff-visible + approved only);
// this endpoint just shapes the response and adds child counts.
export async function GET(request) {
  try {
    const access = await requireSession(request);
    if (access.error) return access.error;

    const url = new URL(request.url);
    const parent = url.searchParams.get("parent");

    let query = access.admin.from("ld_nodes").select(COLUMNS).order("sort_order", { ascending: true });
    // Apply the same visibility rules the RLS enforces, but through the service
    // client we must replicate them for non-admins.
    if (parent) query = query.eq("parent_id", parent);
    else query = query.is("parent_id", null);
    if (!access.isAdmin) query = query.eq("visibility", "staff").eq("approval_status", "approved");

    const { data, error } = await query;
    if (error) return Response.json({ error: error.message }, { status: 400 });
    const nodes = data || [];

    // Child counts (so folders show how many items inside). Cheap single query.
    const ids = nodes.map((n) => n.id);
    let counts = {};
    if (ids.length) {
      let cq = access.admin.from("ld_nodes").select("parent_id").in("parent_id", ids);
      if (!access.isAdmin) cq = cq.eq("visibility", "staff").eq("approval_status", "approved");
      const { data: kids } = await cq;
      for (const k of kids || []) counts[k.parent_id] = (counts[k.parent_id] || 0) + 1;
    }

    // Breadcrumb trail for the requested parent.
    let trail = [];
    if (parent) {
      let cur = parent;
      for (let i = 0; i < 8 && cur; i++) {
        const { data: node } = await access.admin.from("ld_nodes").select("id, parent_id, title").eq("id", cur).single();
        if (!node) break;
        trail.unshift({ id: node.id, title: node.title });
        cur = node.parent_id;
      }
    }

    return Response.json({
      nodes: nodes.map((n) => ({ ...n, childCount: counts[n.id] || 0 })),
      trail,
      isAdmin: access.isAdmin,
    });
  } catch (error) {
    return serverError(error);
  }
}

// Admin: create a node (folder or item) under a parent.
export async function POST(request) {
  try {
    const access = await requireSession(request);
    if (access.error) return access.error;
    if (!access.isAdmin) return Response.json({ error: "Administrators only." }, { status: 403 });
    const b = await request.json();
    const title = (b.title || "").toString().trim();
    if (!title) return Response.json({ error: "A title is required." }, { status: 400 });

    const { data, error } = await access.admin.from("ld_nodes").insert({
      parent_id: b.parent_id || null,
      node_type: ["section", "career_level", "module", "folder", "item"].includes(b.node_type) ? b.node_type : "folder",
      title,
      description: (b.description || "").toString().trim() || null,
      visibility: b.visibility === "admin" ? "admin" : "staff",
      approval_status: "draft",
      sort_order: Number.isFinite(b.sort_order) ? b.sort_order : 0,
      created_by: access.user.id,
    }).select(COLUMNS).single();
    if (error) return Response.json({ error: error.message }, { status: 400 });
    return Response.json({ node: data }, { status: 201 });
  } catch (error) {
    return serverError(error);
  }
}
