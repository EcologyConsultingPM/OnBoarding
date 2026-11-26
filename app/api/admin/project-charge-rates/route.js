import { requireSession } from "../../../../lib/serverAuth";
import { requirePortalResource } from "../../../../lib/portalVisibility";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 8 * 1024;
const RATE_FIELDS = ["project_manager_rate", "senior_ecologist_rate", "ecologist_rate"];
const ROLE_FIELDS = new Map([
  ["project manager", "project_manager_rate"],
  ["senior ecologist", "senior_ecologist_rate"],
  ["ecologist", "ecologist_rate"],
]);
const ROLE_LABELS = ["Project Manager", "Senior Ecologist", "Ecologist"];
const CARD_FIELDS = ["project_id", ...RATE_FIELDS, "mileage_rate", "confirmed_at", "confirmed_by", "updated_at"];
const CARD_COLUMNS = CARD_FIELDS.join(", ");
const MIGRATION_MESSAGE = "Project charge rates are awaiting the approved database migration. Reload after it has been applied.";
const CONFLICT_MESSAGE = "These project rates changed since you loaded them. Reload rates and review the latest card before saving again.";

function privateResponse(response) {
  const headers = new Headers(response.headers);
  headers.set("Cache-Control", "private, no-store");
  const vary = headers.get("Vary");
  if (!vary?.split(",").some((value) => value.trim().toLowerCase() === "authorization")) {
    headers.set("Vary", vary ? `${vary}, Authorization` : "Authorization");
  }
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function json(body, status = 200) {
  return privateResponse(Response.json(body, { status }));
}

function fail(message, status = 400, code) {
  return json({ error: message, ...(code ? { code } : {}) }, status);
}

class InputError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

function object(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactFields(value, fields) {
  return object(value) && Object.keys(value).length === fields.length &&
    fields.every((field) => Object.prototype.hasOwnProperty.call(value, field));
}

function validProjectId(value) {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function validRate(value) {
  // JSON numbers only; do not coerce blanks, booleans or financial metadata.
  return typeof value === "number" && Number.isFinite(value) && value >= 0.01 && value <= 1000000 &&
    /^\d+(?:\.\d{1,2})?$/.test(String(value));
}

function validMileageRate(value) {
  return value === null || typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1000000 &&
    /^\d+(?:\.\d{1,2})?$/.test(String(value));
}

function validCard(row, projectId) {
  const dbNumber = (value) => typeof value === "number" || typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;
  return object(row) && String(row.project_id).toLowerCase() === projectId.toLowerCase() &&
    RATE_FIELDS.every((field) => validRate(dbNumber(row[field]))) &&
    (row.mileage_rate === null || row.mileage_rate === undefined || validMileageRate(dbNumber(row.mileage_rate))) &&
    validTimestamp(row.updated_at) && validTimestamp(row.confirmed_at) && validProjectId(row.confirmed_by);
}

function validTimestamp(value) {
  // Preserve the original database timestamp, including microseconds, for CAS.
  return typeof value === "string" && value.length <= 64 &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) &&
    Number.isFinite(Date.parse(value));
}

function databaseFailure(error) {
  const code = String(error?.code || "");
  if (code === "40001") return fail(CONFLICT_MESSAGE, 409, "STALE_RATES");
  if (["42P01", "42703", "PGRST204", "PGRST205", "42883", "PGRST202"].includes(code)) {
    return fail(MIGRATION_MESSAGE, 409, "MIGRATION_PENDING");
  }
  if (code === "P0002") return fail("Project not found.", 404);
  if (code === "42501") return fail("You do not have permission to manage project charge rates.", 403);
  if (["22023", "23514", "22P02", "22003", "22007", "22008"].includes(code)) {
    return fail("Enter all three positive hourly rates; Mileage is optional, blank for unconfigured or zero for non-billable. Use no more than two decimal places, up to $1,000,000 per unit.");
  }
  return fail("The server could not complete the project charge rates request.", 500);
}

async function requireAdmin(request) {
  const access = await requireSession(request);
  if (access.error) return { error: privateResponse(access.error) };
  if (!access.isAdmin) return { error: fail("Administrator access is required.", 403) };
  const denial = await requirePortalResource(access, "admin.projects.setup");
  if (denial) return { error: privateResponse(denial) };
  return { access };
}

async function requireProject(access, projectId) {
  const { data, error } = await access.admin.from("projects")
    .select("id, name")
    .is("deleted_at", null)
    .eq("id", projectId)
    .limit(1)
    .maybeSingle();
  if (error) return databaseFailure(error);
  return data ? null : fail("Project not found.", 404);
}

async function readBody(request) {
  const contentType = request.headers.get("content-type") || "";
  if (contentType.split(";")[0].trim().toLowerCase() !== "application/json") {
    throw new InputError("Send an application/json request body.", 415);
  }
  const declaredLength = request.headers.get("content-length");
  if (declaredLength && Number(declaredLength) > MAX_BODY_BYTES) {
    throw new InputError("The request body must not exceed 8 KB.", 413);
  }
  if (!request.body) throw new InputError("A JSON request body is required.");
  const reader = request.body.getReader();
  const chunks = [];
  let length = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_BODY_BYTES) {
        await reader.cancel();
        throw new InputError("The request body must not exceed 8 KB.", 413);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new InputError("A valid JSON request body is required.");
  }
}

function publicCard(row) {
  return Object.fromEntries(CARD_FIELDS.map((field) => [field, row[field] ?? null]));
}

export async function GET(request) {
  try {
    const auth = await requireAdmin(request);
    if (auth.error) return auth.error;
    const params = new URL(request.url).searchParams;
    if ([...params.keys()].some((key) => key !== "projectId") || params.getAll("projectId").length !== 1) {
      return fail("Provide only one projectId query parameter.");
    }
    const projectId = params.get("projectId");
    if (!validProjectId(projectId)) return fail("A valid project ID is required.");
    const projectError = await requireProject(auth.access, projectId);
    if (projectError) return projectError;

    // GET must never create a card or confirm company suggestions.
    const cardResult = await auth.access.admin.from("project_charge_rates")
      .select(CARD_COLUMNS)
      .eq("project_id", projectId)
      .limit(1)
      .maybeSingle();
    if (cardResult.error) return databaseFailure(cardResult.error);
    if (cardResult.data && !validCard(cardResult.data, projectId)) return databaseFailure(null);
    const suggestionResult = await auth.access.admin.from("project_role_rates")
      .select("role_name, charge_rate")
      .in("role_name", ROLE_LABELS)
      .limit(20);
    if (suggestionResult.error) return databaseFailure(suggestionResult.error);

    const suggestions = Object.fromEntries(RATE_FIELDS.map((field) => [field, null]));
    const seen = new Set();
    for (const row of suggestionResult.data || []) {
      const normalizedRole = String(row.role_name || "").trim().replace(/\s+/g, " ").toLowerCase();
      const field = ROLE_FIELDS.get(normalizedRole);
      if (!field) continue;
      // Ambiguous or invalid global suggestions stay blank, never arbitrary.
      if (seen.has(field)) {
        suggestions[field] = null;
        continue;
      }
      seen.add(field);
      const rate = typeof row.charge_rate === "number" || typeof row.charge_rate === "string" ? Number(row.charge_rate) : NaN;
      suggestions[field] = validRate(rate) ? rate : null;
    }
    return json({ rates: cardResult.data ? publicCard(cardResult.data) : null, suggestions });
  } catch {
    return databaseFailure(null);
  }
}

export async function POST(request) {
  try {
    const auth = await requireAdmin(request);
    if (auth.error) return auth.error;
    const body = await readBody(request);
    if (!exactFields(body, ["projectId", "rates", "expectedUpdatedAt"])) {
      return fail("Provide only projectId, rates and expectedUpdatedAt.");
    }
    if (!validProjectId(body.projectId)) return fail("A valid project ID is required.");
    const hasMileage = object(body.rates) && Object.prototype.hasOwnProperty.call(body.rates, "mileage_rate");
    if (!exactFields(body.rates, hasMileage ? [...RATE_FIELDS, "mileage_rate"] : RATE_FIELDS) ||
        !RATE_FIELDS.every((field) => validRate(body.rates[field])) || hasMileage && !validMileageRate(body.rates.mileage_rate)) {
      return fail("Enter all three positive hourly rates and an optional non-negative Mileage rate with no more than two decimal places, up to $1,000,000 per unit. Use null for unconfigured Mileage, zero for non-billable.");
    }
    if (body.expectedUpdatedAt !== null && !validTimestamp(body.expectedUpdatedAt)) {
      return fail("expectedUpdatedAt must be the saved card timestamp or null for a new card.");
    }
    const projectError = await requireProject(auth.access, body.projectId);
    if (projectError) return projectError;

    // Service-role RPC owns locking, confirmation and auditing atomically. Do
    // not upsert directly, change company rates or touch historical/budget rows.
    // Omitting Mileage preserves an existing card's value for old three-field
    // callers; explicit null clears configuration and zero is non-billable.
    const { data, error } = await auth.access.admin.rpc("ec_save_project_charge_rates", {
      p_project_id: body.projectId,
      p_actor_id: auth.access.user.id,
      p_expected_updated_at: body.expectedUpdatedAt,
      p_rates: {
        ...Object.fromEntries(ROLE_LABELS.map((role) => [role, body.rates[ROLE_FIELDS.get(role.toLowerCase())]])),
        ...(hasMileage ? { Mileage: body.rates.mileage_rate } : {}),
      },
    });
    if (error) return databaseFailure(error);
    const saved = object(data) && Object.prototype.hasOwnProperty.call(data, "rates") ? data.rates : data;
    if (!validCard(saved, body.projectId)) {
      return databaseFailure(null);
    }
    return json({ rates: publicCard(saved) });
  } catch (error) {
    if (error instanceof InputError) return fail(error.message, error.status);
    return databaseFailure(null);
  }
}
