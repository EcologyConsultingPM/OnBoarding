import { requireSession } from "../../../lib/serverAuth";
import { requirePortalResource } from "../../../lib/portalVisibility";
import { normaliseBiologicalHazardDetails } from "../../../lib/biologicalHazardRegister";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COLUMNS = "id,register_number,created_by,details,status,version,admin_notes,follow_up_date,follow_up_notes,closure_reason,action_owner_id,closed_by,closed_at,created_at,updated_at";
const reply = (data, status = 200) => Response.json(data, { status, headers: { "Cache-Control": "private, no-store", Vary: "Authorization" } });
async function boundedText(request, maximum) {
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maximum) { await reader.cancel().catch(() => null); return null; }
      chunks.push(Buffer.from(value));
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks, total).toString('utf8');
}
function failure(error) {
  const marker = String(error?.message || "").split(":")[0];
  const known = {
    BIO_FORBIDDEN: [403, "You do not have access to this record."],
    BIO_NOT_FOUND: [404, "Record not found."],
    BIO_VERSION_CONFLICT: [409, "This record has changed. Reload before saving."],
    BIO_PHOTO_LIMIT: [409, "This record already has five photos."],
    BIO_INVALID_INPUT: [400, "Check the required fields and try again."],
    BIO_CLOSURE_REQUIRED: [400, "Closing requires a reason and completed exposure/illness follow-up."],
  };
  const [status, message] = known[marker] || (['42P01', '42883', 'PGRST202', 'PGRST205'].includes(error?.code)
    ? [503, "The biological register is not yet available."] : [500, "The server could not complete that request."]);
  // Do not log raw database errors: they can include signed forms/medical data.
  return reply({ error: message }, status);
}
async function authorize(request) {
  const access = await requireSession(request);
  if (access.error) return { error: access.error };
  const scope = new URL(request.url).searchParams.get("scope") || (access.isAdmin ? "admin" : "mine");
  if (!['mine', 'admin'].includes(scope)) return { error: reply({ error: "Use scope=mine or scope=admin." }, 400) };
  const denied = await requirePortalResource(access, scope === "admin" ? "admin.whs_monitoring" : "staff.forms");
  if (denied) return { error: denied };
  if (scope === "admin") {
    if (!access.isAdmin) return { error: reply({ error: "Administrator access is required." }, 403) };
    const { data, error } = await access.admin.rpc("biological_hazard_can_manage", { p_actor_id: access.user.id });
    if (error) return { error: failure(error) };
    if (data !== true) return { error: reply({ error: "Administrator access is required." }, 403) };
  }
  return { access, scope };
}
function ownEvent(row) {
  // Follow-up/closure prose is also internal: a note may contain another person's information.
  const { admin_notes, follow_up_notes, closure_reason, ...safe } = row;
  return safe;
}
export async function GET(request) {
  try {
    const auth = await authorize(request);
    if (auth.error) return auth.error;
    const { access, scope } = auth;
    const params = new URL(request.url).searchParams;
    const integer = (value, fallback) => value === null ? fallback : /^\d+$/.test(value) ? Number(value) : NaN;
    const limit = integer(params.get("limit"), 50);
    const page = integer(params.get("page"), 1);
    const offset = integer(params.get("offset"), (page - 1) * limit);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100 || !Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(offset) || offset < 0 || offset > 1000000) {
      return reply({ error: "Use a limit from 1 to 100 and a valid page or offset." }, 400);
    }
    let query = access.admin.from("biological_hazard_events").select(COLUMNS, { count: "exact" });
    if (scope === "mine") query = query.eq("created_by", access.user.id);
    const { data, count, error } = await query.order("created_at", { ascending: false }).order("id", { ascending: false }).range(offset, offset + limit - 1);
    if (error) return failure(error);
    const rows = scope === "mine" ? (data || []).map(ownEvent) : (data || []);
    // No statistics derived from a truncated page; UI aggregates all authorized pages.
    return reply({ events: rows, total: count, limit, offset, page: Math.floor(offset / limit) + 1, hasMore: count === null || count === undefined ? rows.length === limit : offset + rows.length < count });
  } catch { return failure(); }
}
export async function POST(request) {
  try {
    const access = await requireSession(request);
    if (access.error) return access.error;
    const denied = await requirePortalResource(access, "staff.forms");
    if (denied) return denied;
    const length = Number(request.headers.get("content-length") || 0);
    if (length > 600000) return reply({ error: "The submission is too large." }, 413);
    let body;
    try {
      const text = await boundedText(request, 600000);
      if (text === null) return reply({ error: "The submission is too large." }, 413);
      body = JSON.parse(text);
    } catch { return reply({ error: "A valid JSON submission is required." }, 400); }
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(k => !['details', 'submission_key'].includes(k)) || !UUID.test(body.submission_key || "")) {
      return reply({ error: "Provide details and a UUID submission_key; reuse the same key when retrying." }, 400);
    }
    const { details, errors } = normaliseBiologicalHazardDetails(body.details);
    if (Object.keys(errors || {}).length) return reply({ error: "Complete the required report fields and declaration.", errors }, 400);
    const { data, error } = await access.admin.rpc("biological_hazard_submit", { p_actor_id: access.user.id, p_details: details, p_submission_key: body.submission_key });
    if (error) return failure(error);
    return reply({ event: ownEvent(data.event), duplicate: Boolean(data.duplicate) }, data.duplicate ? 200 : 201);
  } catch { return failure(); }
}
