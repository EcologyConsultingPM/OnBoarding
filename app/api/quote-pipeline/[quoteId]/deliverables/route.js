import { requireSession, serverError } from "../../../../../lib/serverAuth";
import { requirePortalResource } from "../../../../../lib/portalVisibility";
import { compactAuditRecord, recordAudit } from "../../../../../lib/auditLog";

const COLUMNS = "id, quote_id, category_id, title, description, estimated_fee, estimated_hours, status, locked, archived_at, created_by, updated_by, created_at, updated_at, quote_deliverable_categories(id,label)";
const text = (value, maximum = 4000) => { const clean = String(value || "").trim(); return clean ? clean.slice(0, maximum) : null; };
const number = (value) => value === "" || value == null ? null : (Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : null);

async function allow(access) {
  if (!access.isAdmin) return Response.json({ error: "Administrators only." }, { status: 403 });
  return requirePortalResource(access, "admin.quote_pipeline.deliverables");
}

export async function GET(request, { params }) {
  try {
    const access = await requireSession(request); if (access.error) return access.error;
    const denied = await allow(access); if (denied) return denied;
    const { data, error } = await access.admin.from("quote_deliverables").select(COLUMNS).eq("quote_id", params.quoteId).order("created_at");
    if (error) return Response.json({ error: error.message }, { status: 400 });
    return Response.json({ deliverables: data || [] });
  } catch (error) { return serverError(error); }
}

export async function POST(request, { params }) {
  try {
    const access = await requireSession(request); if (access.error) return access.error;
    const denied = await allow(access); if (denied) return denied;
    const body = await request.json(); const title = text(body.title, 280);
    if (!title) return Response.json({ error: "Enter a deliverable title." }, { status: 400 });
    const { data: quote, error: quoteError } = await access.admin.from("quote_pipeline").select("id, superseded").eq("id", params.quoteId).single();
    if (quoteError || !quote || quote.superseded) return Response.json({ error: "Choose an active issued quote." }, { status: 400 });
    const { data, error } = await access.admin.from("quote_deliverables").insert({ quote_id: params.quoteId, category_id: body.categoryId || null, title, description: text(body.description, 5000), estimated_fee: number(body.estimatedFee), estimated_hours: number(body.estimatedHours), created_by: access.user.id, updated_by: access.user.id }).select(COLUMNS).single();
    if (error) return Response.json({ error: error.code === "23505" ? "A deliverable with this title already exists for this quote." : error.message }, { status: 400 });
    await recordAudit(access.admin, { actorId: access.user.id, action: "created", entityType: "quote_deliverable", entityId: data.id, resourceKey: "admin.quote_pipeline.deliverables", afterData: compactAuditRecord(data, ["quote_id", "title", "status", "locked"]) });
    return Response.json({ deliverable: data }, { status: 201 });
  } catch (error) { return serverError(error); }
}

export async function PATCH(request, { params }) {
  try {
    const access = await requireSession(request); if (access.error) return access.error;
    const denied = await allow(access); if (denied) return denied;
    const body = await request.json(); if (!body.id) return Response.json({ error: "Choose a deliverable." }, { status: 400 });
    const { data: current, error: readError } = await access.admin.from("quote_deliverables").select(COLUMNS).eq("id", body.id).eq("quote_id", params.quoteId).single();
    if (readError) return Response.json({ error: "Deliverable not found for this quote." }, { status: 404 });
    if (current.locked && body.action !== "unlock") return Response.json({ error: "This deliverable is locked. Unlock it with a recorded reason before editing." }, { status: 409 });
    const values = { updated_by: access.user.id, updated_at: new Date().toISOString() };
    if ("title" in body) { const title = text(body.title, 280); if (!title) return Response.json({ error: "Enter a deliverable title." }, { status: 400 }); values.title = title; }
    if ("description" in body) values.description = text(body.description, 5000);
    if ("categoryId" in body) values.category_id = body.categoryId || null;
    if ("estimatedFee" in body) values.estimated_fee = number(body.estimatedFee);
    if ("estimatedHours" in body) values.estimated_hours = number(body.estimatedHours);
    if (body.action === "lock") values.locked = true;
    if (body.action === "unlock") { if (!text(body.reason, 1000)) return Response.json({ error: "Provide an unlock reason." }, { status: 400 }); values.locked = false; }
    if (body.action === "archive") { values.status = "archived"; values.archived_at = new Date().toISOString(); }
    if (body.action === "restore") { values.status = "draft"; values.archived_at = null; }
    const { data, error } = await access.admin.from("quote_deliverables").update(values).eq("id", current.id).eq("quote_id", params.quoteId).select(COLUMNS).single();
    if (error) return Response.json({ error: error.message }, { status: 400 });
    await recordAudit(access.admin, { actorId: access.user.id, action: body.action || "updated", entityType: "quote_deliverable", entityId: data.id, resourceKey: "admin.quote_pipeline.deliverables", beforeData: compactAuditRecord(current, ["title", "status", "locked"]), afterData: compactAuditRecord(data, ["title", "status", "locked"]), reason: text(body.reason, 1000) });
    return Response.json({ deliverable: data });
  } catch (error) { return serverError(error); }
}
