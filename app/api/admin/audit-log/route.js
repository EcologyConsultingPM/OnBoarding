import { requireSession, serverError } from "../../../../lib/serverAuth";
import { requirePortalResource } from "../../../../lib/portalVisibility";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    const access = await requireSession(request); if (access.error) return access.error;
    if (!access.isAdmin) return Response.json({ error: "Administrators only." }, { status: 403 });
    const denied = await requirePortalResource(access, "admin.portal_management.audit_log"); if (denied) return denied;
    const params = new URL(request.url).searchParams;
    const entityType = String(params.get("entityType") || "").trim();
    const resourceKey = String(params.get("resourceKey") || "").trim();
    const page = Math.max(0, Number(params.get("page")) || 0);
    const limit = Math.min(100, Math.max(10, Number(params.get("limit")) || 50));
    let query = access.admin.from("admin_audit_log").select("id, actor_id, action, entity_type, entity_id, project_id, resource_key, before_data, after_data, reason, created_at", { count: "exact" }).order("created_at", { ascending: false }).range(page * limit, page * limit + limit - 1);
    if (entityType) query = query.eq("entity_type", entityType);
    if (resourceKey) query = query.eq("resource_key", resourceKey);
    const { data, error, count } = await query;
    if (error) return Response.json({ error: error.message }, { status: 400 });
    return Response.json({ records: data || [], total: count || 0, page, limit });
  } catch (error) { return serverError(error); }
}
