import { requireSession } from "../../../../lib/serverAuth";
import { requirePortalResource } from "../../../../lib/portalVisibility";

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
    BIO_FORBIDDEN: [403, "You do not have access to this record."], BIO_NOT_FOUND: [404, "Record not found."],
    BIO_VERSION_CONFLICT: [409, "This record has changed. Reload before saving."],
    BIO_INVALID_INPUT: [400, "Check the update fields and try again."],
    BIO_CLOSURE_REQUIRED: [400, "Closing requires a reason and completed exposure/illness follow-up."],
  };
  const [status, message] = known[marker] || (['42P01', '42883', 'PGRST202', 'PGRST205'].includes(error?.code) ? [503, "The biological register is not yet available."] : [500, "The server could not complete that request."]);
  return reply({ error: message }, status);
}
async function authorize(request, eventId, mutation = false) {
  const access = await requireSession(request);
  if (access.error) return { error: access.error };
  const scope = new URL(request.url).searchParams.get("scope") || (access.isAdmin ? "admin" : "mine");
  if (!['mine', 'admin'].includes(scope)) return { error: reply({ error: "Use scope=mine or scope=admin." }, 400) };
  const denied = await requirePortalResource(access, scope === "admin" ? "admin.whs_monitoring" : "staff.forms");
  if (denied) return { error: denied };
  if (mutation && scope !== 'admin') return { error: reply({ error: "Only WHS administrators may update the register." }, 403) };
  if (scope === 'admin') {
    if (!access.isAdmin) return { error: reply({ error: "Administrator access is required." }, 403) };
    const { data, error } = await access.admin.rpc("biological_hazard_can_manage", { p_actor_id: access.user.id });
    if (error) return { error: failure(error) };
    if (data !== true) return { error: reply({ error: "Administrator access is required." }, 403) };
  }
  if (!UUID.test(eventId || "")) return { error: reply({ error: "Record not found." }, 404) };
  let query = access.admin.from("biological_hazard_events").select(COLUMNS).eq("id", eventId);
  if (scope === "mine") query = query.eq("created_by", access.user.id);
  const { data: event, error } = await query.maybeSingle();
  if (error) return { error: failure(error) };
  if (!event) return { error: reply({ error: "Record not found." }, 404) };
  return { access, scope, event };
}
function redactEvent(event) {
  const { admin_notes, follow_up_notes, closure_reason, ...safe } = event;
  return safe;
}
function redactUpdate(update) {
  const safe = (data) => data ? Object.fromEntries(Object.entries(data).filter(([key]) => ['status', 'version', 'follow_up_date', 'closed_by', 'closed_at', 'updated_at'].includes(key))) : null;
  return { id: update.id, event_id: update.event_id, version: update.version, action: update.action, created_at: update.created_at, before_data: safe(update.before_data), after_data: safe(update.after_data) };
}
export async function GET(request, context) {
  try {
    const { eventId } = await context.params;
    const auth = await authorize(request, eventId);
    if (auth.error) return auth.error;
    const { access, scope, event } = auth;
    const params = new URL(request.url).searchParams;
    const raw = params.get('updatesOffset') || '0';
    if (!/^\d+$/.test(raw) || !Number.isSafeInteger(Number(raw)) || Number(raw) > 1000000) return reply({ error: "Invalid history offset." }, 400);
    const offset = Number(raw);
    const [photosResult, updatesResult] = await Promise.all([
      access.admin.from("biological_hazard_photos").select("id,event_id,file_name,mime_type,size_bytes,created_by,created_at").eq("event_id", eventId).order("created_at", { ascending: true }).limit(5),
      access.admin.from("biological_hazard_updates").select("id,event_id,version,action,actor_id,before_data,after_data,reason,created_at", { count: "exact" }).eq("event_id", eventId).order("created_at", { ascending: false }).order("id", { ascending: false }).range(offset, offset + 99),
    ]);
    if (photosResult.error || updatesResult.error) return failure(photosResult.error || updatesResult.error);
    const updates = updatesResult.data || [];
    const photos = (photosResult.data || []).map(({ id, event_id, file_name, mime_type, size_bytes, created_by, created_at }) => ({ id, event_id, file_name, mime_type, size_bytes, created_by, created_at }));
    const history = (scope === 'mine' ? updates.map(redactUpdate) : updates).map(update => ({ ...update, before: update.before_data, after: update.after_data }));
    return reply({ event: scope === 'mine' ? redactEvent(event) : event, photos, updates: history, canManage: scope === 'admin', updatesTotal: updatesResult.count, updatesOffset: offset, updatesHasMore: updatesResult.count == null ? updates.length === 100 : offset + updates.length < updatesResult.count });
  } catch { return failure(); }
}
function validDate(value) {
  if (value === null || value === '') return true;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000')) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
export async function PATCH(request, context) {
  try {
    const { eventId } = await context.params;
    const auth = await authorize(request, eventId, true);
    if (auth.error) return auth.error;
    let body;
    try {
      const text = await boundedText(request, 20000);
      if (text === null) return reply({ error: "The update is too large." }, 413);
      body = JSON.parse(text);
    } catch { return reply({ error: "A valid JSON update is required." }, 400); }
    const allowed = ['version', 'status', 'admin_notes', 'follow_up_date', 'follow_up_notes', 'closure_reason', 'action_owner_id'];
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(k => !allowed.includes(k)) || !Number.isInteger(body.version) || body.version < 1 || body.version > 2147483646 || Object.keys(body).length < 2) return reply({ error: "Supply the current version and only administrator update fields." }, 400);
    if ('status' in body && !['Open', 'In progress', 'Closed'].includes(body.status)) return reply({ error: "Invalid register status." }, 400);
    for (const key of ['admin_notes', 'follow_up_notes', 'closure_reason']) {
      if (key in body && (typeof body[key] !== 'string' || body[key].length > 4000)) return reply({ error: "Notes must be text of at most 4000 characters." }, 400);
    }
    if ('follow_up_date' in body && !validDate(body.follow_up_date)) return reply({ error: "Use a valid follow-up date." }, 400);
    if ('action_owner_id' in body && body.action_owner_id !== null && !UUID.test(body.action_owner_id || '')) return reply({ error: "Use an existing staff action owner." }, 400);
    const { version, ...patch } = body;
    const { data, error } = await auth.access.admin.rpc("biological_hazard_update", { p_actor_id: auth.access.user.id, p_event_id: eventId, p_version: version, p_patch: patch });
    if (error) return failure(error);
    return reply({ event: data });
  } catch { return failure(); }
}
