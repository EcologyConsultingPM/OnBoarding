import { requireSession } from "../../../lib/serverAuth";
import { requirePortalResource } from "../../../lib/portalVisibility";
import { isEcologyStaffEmail, staffDirectoryRecord } from "../../../lib/staffDirectory";
import { REGISTER_UUID, normaliseRegisterStaff, normaliseTrainingRecord, normaliseRegisterText } from "../../../lib/internalTrainingRegister";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const STAFF_COLUMNS = "id,staff_name,position,employment_type,linked_user_id,version,archived_at,created_at,updated_at";
const TRAINING_COLUMNS = "id,staff_id,qualification,training_organisation,completion_date,expiry_date,version,archived_at,created_at,updated_at";
const MAX_BODY = 50000;
const reply = (data, status = 200) => Response.json(data, { status, headers: { "Cache-Control": "private, no-store", Vary: "Authorization" } });
const invalid = (message, errors) => reply({ code: "IR_INVALID_INPUT", error: message, ...(errors ? { errors } : {}) }, 400);
const known = {
  IR_FORBIDDEN: [403, "Administrator access to Internal Registers is required."],
  IR_NOT_FOUND: [404, "Record not found."],
  IR_VERSION_CONFLICT: [409, "This record has changed. Reload before saving."],
  IR_MUTATION_CONFLICT: [409, "This retry key was used for another request. Reload before saving."],
  IR_DUPLICATE_STAFF: [409, "An active staff record already has that name."],
  IR_STAFF_HAS_TRAINING: [409, "Archive this staff member's active training records first."],
  IR_ARCHIVED: [409, "This record is already archived."],
  IR_IMMUTABLE: [409, "Archived records and audit history must be retained."],
  IR_INVALID_INPUT: [400, "Check the required fields and archive reason."],
};
async function failure(error, context, operation) {
  const marker = String(error?.message || "").split(":")[0];
  if (known[marker]) return reply({ code: marker, error: known[marker][1] }, known[marker][0]);
  const unavailable = ["42P01", "42883", "PGRST202", "PGRST205"].includes(error?.code);
  const code = unavailable ? "IR_UNAVAILABLE" : "IR_STORAGE_ERROR";
  // Never persist or print the raw exception: it may contain personal values.
  try {
    if (context.access?.admin) {
      const { error: healthError } = await context.access.admin.from("system_health_runs").insert({
        service_key: "internal_registers", status: "degraded", summary: "Internal register request could not be completed.", details: { error_code: code, operation },
        checked_at: new Date().toISOString(),
      });
      if (healthError) console.error("IR_HEALTH_LOG_FAILED", operation);
    } else console.error(code, operation);
  } catch { console.error("IR_HEALTH_LOG_FAILED", operation); }
  return reply({ code, error: unavailable ? "Internal Registers is not yet available." : "The server could not complete that request." }, unavailable ? 503 : 500);
}
async function authorize(request, context, operation) {
  const access = await requireSession(request);
  context.access = access;
  if (access.error) return access.error;
  if (!access.isAdmin) return reply({ code: "IR_FORBIDDEN", error: known.IR_FORBIDDEN[1] }, 403);
  for (const key of ["admin.internal_registers", "admin.internal_registers.training"]) {
    if (await requirePortalResource(access, key)) return reply({ code: "IR_FORBIDDEN", error: known.IR_FORBIDDEN[1] }, 403);
  }
  const { data, error } = await access.admin.rpc("internal_register_can_manage", { p_actor_id: access.user.id });
  if (error) return failure(error, context, operation);
  return data === true ? null : reply({ code: "IR_FORBIDDEN", error: known.IR_FORBIDDEN[1] }, 403);
}
async function boundedText(request) {
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_BODY) { await reader.cancel().catch(() => null); return null; }
      chunks.push(Buffer.from(value));
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks, length).toString("utf8");
}
async function directory(admin) {
  const rows = [];
  // Optional account linking only. No register records are seeded or inferred.
  // Bound the account read itself, not only the eventual output.
  for (let page = 1; page <= 10; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const users = data?.users || [];
    for (const user of users) {
      if (!isEcologyStaffEmail(user.email) || user.deleted_at || (user.banned_until && Date.parse(user.banned_until) > Date.now()) || String(user.user_metadata?.staff_directory_active) === "false") continue;
      const person = staffDirectoryRecord(user);
      rows.push({ id: person.id, name: person.name && person.name !== user.email ? person.name : "Account" });
    }
    if (users.length < 200) break;
  }
  return rows.sort((a, b) => a.name.localeCompare(b.name, "en-AU") || a.id.localeCompare(b.id));
}
export async function GET(request) {
  const context = {};
  try {
    const denied = await authorize(request, context, "read");
    if (denied) return denied;
    const params = new URL(request.url).searchParams;
    const entity = params.get("entity") || "staff";
    const integer = (key, fallback) => params.has(key) ? /^\d+$/.test(params.get(key)) ? Number(params.get(key)) : NaN : fallback;
    const limit = integer("limit", 100), offset = integer("offset", 0);
    const archived = params.get("includeArchived") || "false";
    const staffId = params.get("staff_id");
    if (!["staff", "training", "directory"].includes(entity) || !Number.isSafeInteger(limit) || limit < 1 || limit > 100 || !Number.isSafeInteger(offset) || offset < 0 || offset > 1000000 || !["true", "false"].includes(archived) || (staffId !== null && !REGISTER_UUID.test(staffId))) return invalid("Use a valid entity, limit 1–100, bounded offset, and optional staff UUID.");
    if (entity === "directory") {
      const all = await directory(context.access.admin);
      const rows = all.slice(offset, offset + limit);
      return reply({ rows, total: all.length, hasMore: offset + rows.length < all.length, limit, offset });
    }
    let query = context.access.admin.from(entity === "staff" ? "internal_register_staff" : "internal_training_records")
      .select(entity === "staff" ? STAFF_COLUMNS : `${TRAINING_COLUMNS},internal_register_staff!inner(staff_name)`, { count: "exact" });
    if (archived === "false") query = query.is("archived_at", null);
    if (staffId) query = query.eq(entity === "staff" ? "id" : "staff_id", staffId);
    query = query.order(entity === "staff" ? "staff_name" : "internal_register_staff(staff_name)", { ascending: true });
    if (entity === "training") query = query.order("qualification", { ascending: true });
    const { data, count, error } = await query.order("id", { ascending: true }).range(offset, offset + limit - 1);
    if (error) return failure(error, context, "read");
    if (!Number.isSafeInteger(count) || count < 0) return failure(null, context, "read");
    const rows = (data || []).map(row => { const { internal_register_staff, ...safe } = row; return safe; });
    return reply({ rows, total: count, hasMore: offset + rows.length < count, limit, offset });
  } catch (error) { return failure(error, context, "read"); }
}
export async function POST(request) {
  const context = {};
  try {
    const denied = await authorize(request, context, "mutate");
    if (denied) return denied;
    if (Number(request.headers.get("content-length") || 0) > MAX_BODY) return reply({ code: "IR_PAYLOAD_TOO_LARGE", error: "The request is too large." }, 413);
    let body;
    try {
      const text = await boundedText(request);
      if (text === null) return reply({ code: "IR_PAYLOAD_TOO_LARGE", error: "The request is too large." }, 413);
      body = JSON.parse(text);
    } catch { return invalid("Provide a valid JSON request."); }
    if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some(key => !["entity", "action", "id", "expected_version", "values", "reason", "mutation_key"].includes(key)) || !["staff", "training"].includes(body.entity) || !["create", "update", "archive"].includes(body.action) || typeof body.mutation_key !== "string" || !REGISTER_UUID.test(body.mutation_key)) return invalid("Provide a valid entity, action and UUID mutation_key.");
    if (body.action === "create" ? body.id != null || body.expected_version != null : typeof body.id !== "string" || !REGISTER_UUID.test(body.id) || !Number.isInteger(body.expected_version) || body.expected_version < 1 || body.expected_version > 2147483646) return invalid("Provide a record UUID and current version for update or archive.");
    let values = {}, reason = null;
    if (body.action === "archive") {
      reason = normaliseRegisterText(body.reason, 1000);
      if (!reason || (body.values !== undefined && (!body.values || typeof body.values !== "object" || Array.isArray(body.values) || Object.keys(body.values).length))) return invalid("Provide a plain-text archive reason (maximum 1000 characters).", { reason: "An archive reason is required." });
    } else {
      if (body.reason != null && body.reason !== "") return invalid("A reason is supported only when archiving.");
      const result = body.entity === "staff" ? normaliseRegisterStaff(body.values) : normaliseTrainingRecord(body.values);
      if (Object.keys(result.errors).length) return invalid("Check the required fields.", result.errors);
      values = result.value;
    }
    const { data, error } = await context.access.admin.rpc("internal_register_mutate", {
      p_actor_id: context.access.user.id, p_entity: body.entity, p_action: body.action,
      p_id: body.id || null, p_expected_version: body.expected_version || null,
      p_values: values, p_reason: reason, p_mutation_key: body.mutation_key,
    });
    if (error) return failure(error, context, "mutate");
    if (!data?.row) return failure(null, context, "mutate");
    return reply({ row: data.row, duplicate: Boolean(data.duplicate) }, body.action === "create" && !data.duplicate ? 201 : 200);
  } catch (error) { return failure(error, context, "mutate"); }
}
