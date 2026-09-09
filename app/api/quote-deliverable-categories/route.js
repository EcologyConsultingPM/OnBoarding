import { requireSession, serverError } from "../../../lib/serverAuth";
import { requirePortalResource } from "../../../lib/portalVisibility";
import { compactAuditRecord, recordAudit } from "../../../lib/auditLog";

const COLUMNS = "id, label, description, sort_order, active, locked, archived_at, created_by, updated_by, created_at, updated_at";
const text = (value, maximum = 2000) => { const clean = String(value || "").trim(); return clean ? clean.slice(0, maximum) : null; };

export async function GET(request) {
  try {
    const access = await requireSession(request); if (access.error) return access.error;
    if (!access.isAdmin) return Response.json({ error: "Administrators only." }, { status: 403 });
    const denied = await requirePortalResource(access, "admin.quote_pipeline.deliverables"); if (denied) return denied;
    const { data, error } = await access.admin.from("quote_deliverable_categories").select(COLUMNS).order("active", { ascending: false }).order("sort_order").order("label");
    if (error) return Response.json({ error: error.message }, { status: 400 });
    return Response.json({ categories: data || [] });
  } catch (error) { return serverError(error); }
}

export async function POST(request) {
  try {
    const access = await requireSession(request); if (access.error) return access.error;
    if (!access.isAdmin) return Response.json({ error: "Administrators only." }, { status: 403 });
    const denied = await requirePortalResource(access, "admin.quote_pipeline.deliverables"); if (denied) return denied;
    const body = await request.json(); const label = text(body.label, 180);
    if (!label) return Response.json({ error: "Enter a category name." }, { status: 400 });
    const { data, error } = await access.admin.from("quote_deliverable_categories").insert({ label, description: text(body.description, 2000), sort_order: Number.isFinite(Number(body.sortOrder)) ? Number(body.sortOrder) : 0, created_by: access.user.id, updated_by: access.user.id }).select(COLUMNS).single();
    if (error) return Response.json({ error: error.message }, { status: 400 });
    await recordAudit(access.admin, { actorId: access.user.id, action: "created", entityType: "quote_deliverable_category", entityId: data.id, resourceKey: "admin.quote_pipeline.deliverables", afterData: compactAuditRecord(data, ["label", "active", "locked"]) });
    return Response.json({ category: data }, { status: 201 });
  } catch (error) { return serverError(error); }
}

export async function PATCH(request) {
  try {
    const access = await requireSession(request); if (access.error) return access.error;
    if (!access.isAdmin) return Response.json({ error: "Administrators only." }, { status: 403 });
    const denied = await requirePortalResource(access, "admin.quote_pipeline.deliverables"); if (denied) return denied;
    const body = await request.json(); if (!body.id) return Response.json({ error: "Choose a category." }, { status: 400 });
    const { data: current, error: readError } = await access.admin.from("quote_deliverable_categories").select(COLUMNS).eq("id", body.id).single();
    if (readError) return Response.json({ error: readError.message }, { status: 404 });
    if (current.locked && body.unlock !== true) return Response.json({ error: "This category is locked. Unlock it with an audit reason before editing." }, { status: 409 });
    const values = { updated_by: access.user.id, updated_at: new Date().toISOString() };
    if ("label" in body) { const label = text(body.label, 180); if (!label) return Response.json({ error: "Enter a category name." }, { status: 400 }); values.label = label; }
    if ("description" in body) values.description = text(body.description, 2000);
    if ("sortOrder" in body) values.sort_order = Number.isFinite(Number(body.sortOrder)) ? Number(body.sortOrder) : current.sort_order;
    if ("active" in body) values.active = body.active === true;
    if (body.action === "lock") values.locked = true;
    if (body.action === "unlock") { if (!text(body.reason, 1000)) return Response.json({ error: "Provide an unlock reason." }, { status: 400 }); values.locked = false; }
    if (body.action === "archive") { values.active = false; values.archived_at = new Date().toISOString(); }
    if (body.action === "restore") { values.active = true; values.archived_at = null; }
    const { data, error } = await access.admin.from("quote_deliverable_categories").update(values).eq("id", current.id).select(COLUMNS).single();
    if (error) return Response.json({ error: error.message }, { status: 400 });
    await recordAudit(access.admin, { actorId: access.user.id, action: body.action || "updated", entityType: "quote_deliverable_category", entityId: data.id, resourceKey: "admin.quote_pipeline.deliverables", beforeData: compactAuditRecord(current, ["label", "active", "locked"]), afterData: compactAuditRecord(data, ["label", "active", "locked"]), reason: text(body.reason, 1000) });
    return Response.json({ category: data });
  } catch (error) { return serverError(error); }
}
