import { requireSession, serverError } from "../../../lib/serverAuth";
import { requirePortalResource } from "../../../lib/portalVisibility";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UPDATE_COLUMNS = `
  id, source_id, title, summary, source_url, source_published_at, detected_at,
  affected_domains, severity, status, assigned_reviewer_id, review_due_date,
  review_note, reviewed_by, reviewed_at, staff_notified_at, created_at, updated_at,
  regulatory_sources (title, category, authority_name, source_url)
`;
const SEVERITIES = new Set(["critical", "action", "review", "information"]);
const STATUSES = new Set(["new", "reviewing", "assessed", "actioned", "not_applicable"]);

function jsonError(error, status = 400) {
  return Response.json({ error }, { status });
}

async function staffRecipients(admin) {
  const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (error) throw new Error(error.message);
  return (data?.users || []).map((user) => user.id);
}

async function createAdminEvent(admin, userId, update) {
  const { error } = await admin.from("portal_events").insert({
    recipient_id: userId,
    event_type: "regulatory_update",
    severity: update.severity === "critical" ? "action" : "review",
    title: `Regulatory review required: ${update.title}`,
    body: update.summary,
    href: "/?portal=admin&area=whsmonitor&tab=regulatory-watch",
    source_table: "regulatory_updates",
    source_id: update.id,
  });
  if (error) throw new Error(error.message);
}

// GET is admin-only and returns sources plus pending/assessed updates. Staff are
// deliberately not given unreviewed regulatory content.
export async function GET(request) {
  try {
    const access = await requireSession(request);
    if (access.error) return access.error;
    if (!access.isAdmin) return jsonError("Administrators only.", 403);
    const denied = await requirePortalResource(access, "admin.regulatory_watch");
    if (denied) return denied;

    const [sourcesResult, updatesResult] = await Promise.all([
      access.admin.from("regulatory_sources").select("*").order("category").order("title"),
      access.admin.from("regulatory_updates").select(UPDATE_COLUMNS).order("detected_at", { ascending: false }).limit(150),
    ]);
    if (sourcesResult.error) return jsonError(sourcesResult.error.message);
    if (updatesResult.error) return jsonError(updatesResult.error.message);
    return Response.json({ sources: sourcesResult.data || [], updates: updatesResult.data || [] });
  } catch (error) {
    return serverError(error);
  }
}

// POST permits an administrator to register a manual alert or add an official
// source. Automated detections use the separately protected job route.
export async function POST(request) {
  try {
    const access = await requireSession(request);
    if (access.error) return access.error;
    if (!access.isAdmin) return jsonError("Administrators only.", 403);
    const denied = await requirePortalResource(access, "admin.regulatory_watch");
    if (denied) return denied;
    const body = await request.json();

    if (body.action === "add_source") {
      const title = String(body.title || "").trim();
      const sourceUrl = String(body.source_url || "").trim();
      const category = String(body.category || "").trim();
      if (!title || !sourceUrl || !["whs", "biodiversity", "flora_fauna", "environmental_reform"].includes(category)) {
        return jsonError("Title, official source URL and valid category are required.");
      }
      const { data, error } = await access.admin.from("regulatory_sources").insert({
        source_key: `manual_${Date.now()}`,
        title,
        source_url: sourceUrl,
        category,
        authority_name: String(body.authority_name || "Ecology Consulting review source").trim(),
      }).select().single();
      if (error) return jsonError(error.message);
      return Response.json({ source: data }, { status: 201 });
    }

    if (body.action === "add_manual_update") {
      const title = String(body.title || "").trim();
      const summary = String(body.summary || "").trim();
      const sourceUrl = String(body.source_url || "").trim();
      if (!title || !summary || !sourceUrl) return jsonError("Title, summary and official source URL are required.");
      const severity = SEVERITIES.has(body.severity) ? body.severity : "review";
      const { data, error } = await access.admin.from("regulatory_updates").insert({
        source_id: body.source_id || null,
        title,
        summary,
        source_url: sourceUrl,
        affected_domains: Array.isArray(body.affected_domains) ? body.affected_domains : [],
        severity,
        status: "new",
        review_due_date: body.review_due_date || null,
      }).select(UPDATE_COLUMNS).single();
      if (error) return jsonError(error.message);
      await createAdminEvent(access.admin, access.user.id, data);
      return Response.json({ update: data }, { status: 201 });
    }

    return jsonError("Unknown Regulatory Watch action.");
  } catch (error) {
    return serverError(error);
  }
}

// PATCH records an accountable review decision. Staff notification is allowed
// only after an administrator has assessed/actioned the source change.
export async function PATCH(request) {
  try {
    const access = await requireSession(request);
    if (access.error) return access.error;
    if (!access.isAdmin) return jsonError("Administrators only.", 403);
    const denied = await requirePortalResource(access, "admin.regulatory_watch");
    if (denied) return denied;
    const body = await request.json();
    const id = String(body.id || "");
    if (!id) return jsonError("Choose a Regulatory Watch update.");

    const { data: current, error: currentError } = await access.admin
      .from("regulatory_updates").select(UPDATE_COLUMNS).eq("id", id).maybeSingle();
    if (currentError) return jsonError(currentError.message);
    if (!current) return jsonError("Regulatory Watch update not found.", 404);

    if (body.action === "update_source") {
      const { data, error } = await access.admin.from("regulatory_sources").update({
        active: typeof body.active === "boolean" ? body.active : undefined,
        title: body.title?.trim() || undefined,
        source_url: body.source_url?.trim() || undefined,
        updated_at: new Date().toISOString(),
      }).eq("id", current.source_id).select().single();
      if (error) return jsonError(error.message);
      return Response.json({ source: data });
    }

    if (body.action !== "review") return jsonError("Unknown Regulatory Watch action.");
    const status = STATUSES.has(body.status) ? body.status : current.status;
    const values = {
      status,
      severity: SEVERITIES.has(body.severity) ? body.severity : current.severity,
      review_note: typeof body.review_note === "string" ? body.review_note.trim() || null : current.review_note,
      review_due_date: body.review_due_date || null,
      assigned_reviewer_id: body.assigned_reviewer_id || null,
      reviewed_by: ["assessed", "actioned", "not_applicable"].includes(status) ? access.user.id : null,
      reviewed_at: ["assessed", "actioned", "not_applicable"].includes(status) ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    };
    const { data, error } = await access.admin.from("regulatory_updates").update(values).eq("id", id).select(UPDATE_COLUMNS).single();
    if (error) return jsonError(error.message);

    if (body.notify_staff === true) {
      if (!["assessed", "actioned"].includes(data.status)) return jsonError("Assess or action the update before notifying staff.");
      const recipientIds = await staffRecipients(access.admin);
      if (recipientIds.length) {
        const { error: eventError } = await access.admin.from("portal_events").insert(recipientIds.map((recipientId) => ({
          recipient_id: recipientId,
          event_type: "regulatory_update_assessed",
          severity: data.severity === "critical" || data.severity === "action" ? "action" : "information",
          title: `Practice update: ${data.title}`,
          body: data.review_note || data.summary,
          href: "/staff/governance",
          source_table: "regulatory_updates",
          source_id: data.id,
        })));
        if (eventError) throw new Error(eventError.message);
      }
      const { data: notified, error: notifyError } = await access.admin.from("regulatory_updates")
        .update({ staff_notified_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq("id", id).select(UPDATE_COLUMNS).single();
      if (notifyError) return jsonError(notifyError.message);
      return Response.json({ update: notified });
    }
    return Response.json({ update: data });
  } catch (error) {
    return serverError(error);
  }
}


// DELETE removes a selected review item and its linked in-portal alerts. It is
// intentionally administrator-only and does not remove the official source record.
export async function DELETE(request) {
  try {
    const access = await requireSession(request);
    if (access.error) return access.error;
    if (!access.isAdmin) return jsonError("Administrators only.", 403);
    const denied = await requirePortalResource(access, "admin.regulatory_watch");
    if (denied) return denied;

    const { searchParams } = new URL(request.url);
    const id = String(searchParams.get("id") || "");
    if (!id) return jsonError("Choose a Regulatory Watch update to delete.");

    const { data: current, error: currentError } = await access.admin
      .from("regulatory_updates")
      .select("id, title")
      .eq("id", id)
      .maybeSingle();
    if (currentError) return jsonError(currentError.message);
    if (!current) return jsonError("Regulatory Watch update not found.", 404);

    const { error: eventError } = await access.admin
      .from("portal_events")
      .delete()
      .eq("source_table", "regulatory_updates")
      .eq("source_id", id);
    if (eventError) return jsonError(eventError.message);

    const { error } = await access.admin.from("regulatory_updates").delete().eq("id", id);
    if (error) return jsonError(error.message);
    return Response.json({ success: true, deleted: { id: current.id, title: current.title } });
  } catch (error) {
    return serverError(error);
  }
}
