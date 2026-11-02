import { normaliseCloseoutReport, validateCloseoutSubmission } from "./projectCloseoutTemplate";

export const CLOSEOUT_PROJECT_COLUMNS = "id, name, client_name, start_date, end_date, status, project_lead_user_id, overseeing_senior_ecologist_user_id";
export const MASTER_ACTIONS = new Set(["save_report", "lock_report", "submit_report", "reopen_report", "invite_team", "override_close", "archive_project", "legacy_update"]);
const LEGACY_STATUSES = new Set(["not_started", "initiated", "awaiting_reviews", "awaiting_manager_approval", "closed"]);
const IMPROVEMENT_STATUSES = new Set(["draft", "assigned", "in_progress", "completed", "verified", "archived"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class CloseoutError extends Error {
  constructor(message, status = 400, code = "INVALID_INPUT", details = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function validCloseoutId(value, label = "Project") {
  if (typeof value !== "string" || !UUID.test(value)) throw new CloseoutError(`${label} ID is invalid.`);
  return value;
}

function field(value, label, { required = false, cap = 5000 } = {}) {
  if (value === undefined || value === null) {
    if (required) throw new CloseoutError(`${label} is required.`);
    return null;
  }
  if (typeof value !== "string" || value.length > cap) throw new CloseoutError(`${label} must be text of at most ${cap} characters.`);
  const result = value.trim();
  if (required && !result) throw new CloseoutError(`${label} is required.`);
  return result || null;
}

function date(value, label) {
  const result = field(value, label);
  if (result && (!/^\d{4}-\d{2}-\d{2}$/.test(result) || !Number.isFinite(Date.parse(`${result}T00:00:00Z`)) || new Date(`${result}T00:00:00Z`).toISOString().slice(0, 10) !== result)) {
    throw new CloseoutError(`${label} must be a valid YYYY-MM-DD date.`);
  }
  return result;
}

function report(value, project, submitting = false) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new CloseoutError("A report object is required.");
  let result;
  try { result = normaliseCloseoutReport(value, project); }
  catch (error) { throw new CloseoutError(error.message || "The report is invalid."); }
  if (submitting) {
    const errors = validateCloseoutSubmission(result);
    if (errors.length) throw new CloseoutError(errors.join(" "), 400, "REPORT_INCOMPLETE", { errors });
  }
  return result;
}

export function normaliseOwnResponse(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new CloseoutError("A response object is required.");
  if (Object.keys(value).some((key) => !["hurdles", "lessons"].includes(key))) throw new CloseoutError("Your response may contain only hurdles and lessons.");
  // Use the identical row/date/status validation as the master report. Never
  // accept a staff-supplied master report or another recipient's identity.
  const normalised = report({ hurdles: Object.hasOwn(value, "hurdles") ? value.hurdles : [], lessons: Object.hasOwn(value, "lessons") ? value.lessons : [] }, {});
  return { hurdles: normalised.hurdles, lessons: normalised.lessons };
}

export function prepareCloseoutMutation(body, project) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new CloseoutError("A JSON object is required.");
  const action = body.action === undefined ? "legacy_update" : body.action;
  if (typeof action !== "string" || (!MASTER_ACTIONS.has(action) && !["save_feedback", "submit_feedback", "upsert_improvement", "archive_improvement"].includes(action))) throw new CloseoutError("Unknown close-out action.");
  let expectedRevision = null;
  if (MASTER_ACTIONS.has(action)) {
    if (!Number.isSafeInteger(body.expectedRevision) || body.expectedRevision < 0 || body.expectedRevision > 2147483646) throw new CloseoutError("expectedRevision must be the current non-negative report revision (0 for a new report).", 400, "REVISION_REQUIRED");
    expectedRevision = body.expectedRevision;
  }
  let payload = {};
  if (["save_report", "lock_report", "submit_report"].includes(action)) payload.report = report(body.report, project, action === "submit_report");
  if (["reopen_report", "override_close"].includes(action)) payload.reason = field(body.reason, "A reason", { required: true });
  if (action === "invite_team") {
    if (!Array.isArray(body.staffUserIds) || !body.staffUserIds.length || body.staffUserIds.length > 500) throw new CloseoutError("Select between 1 and 500 project team members.");
    payload.staffUserIds = [...new Set(body.staffUserIds.map((id) => validCloseoutId(id, "Staff user")))];
  }
  if (["save_feedback", "submit_feedback"].includes(action)) {
    for (const key of ["staffUserId", "staff_user_id", "feedbackId", "closeoutId", "report"]) {
      if (Object.hasOwn(body, key)) throw new CloseoutError("You may edit only your own invited response.", 403, "OWN_RESPONSE_ONLY");
    }
    payload.response = normaliseOwnResponse(body.response);
  }
  if (["upsert_improvement", "archive_improvement"].includes(action)) {
    if (body.actionId) payload.actionId = validCloseoutId(body.actionId, "Improvement action");
    if (action === "archive_improvement" && !payload.actionId) throw new CloseoutError("An improvement action is required.");
    if (action === "upsert_improvement") {
      if (body.status !== undefined && !IMPROVEMENT_STATUSES.has(body.status)) throw new CloseoutError("Invalid improvement status.");
      payload = { ...payload, title: field(body.title, "An improvement action title", { required: true }), description: field(body.description, "Description"), assignedTo: body.assignedTo ? validCloseoutId(body.assignedTo, "Assignee") : null, closeoutId: body.closeoutId ? validCloseoutId(body.closeoutId, "Close-out") : null, status: body.status || "draft", dueDate: date(body.dueDate, "Due date") };
    }
  }
  if (action === "legacy_update") {
    if (!LEGACY_STATUSES.has(body.status)) throw new CloseoutError("Invalid close-out status. Use archive_project to archive.");
    let successScore = null;
    if (body.successScore !== undefined && body.successScore !== null && body.successScore !== "") {
      successScore = Number(body.successScore);
      if (!Number.isInteger(successScore) || successScore < 1 || successScore > 5) throw new CloseoutError("Success score must be between 1 and 5.");
    }
    payload = { status: body.status, success_score: successScore };
    for (const [input, column] of Object.entries({ clientOutcome: "client_outcome", deliverySummary: "delivery_summary", lessonsLearned: "lessons_learned", stakeholderFeedback: "stakeholder_feedback", financialReviewNotes: "financial_review_notes", recommendations: "recommendations", approvalNote: "approval_note" })) payload[column] = field(body[input], input);
    if (body.status === "closed" && (!successScore || ["client_outcome", "delivery_summary", "financial_review_notes", "approval_note"].some((key) => !payload[key]))) throw new CloseoutError("Complete the success score, client outcome, delivery summary, financial review and approval note before approving and locking the close-out.");
  }
  return { action, expectedRevision, payload };
}

export function closeoutRpcError(error) {
  const message = String(error?.message || "");
  const marker = message.match(/CLOSEOUT_([A-Z_]+)(?::\s*(.*))?/);
  if (marker) {
    const code = marker[1];
    const status = code === "NOT_FOUND" ? 404 : ["FORBIDDEN", "NOT_INVITED", "NOT_TEAM"].includes(code) ? 403 : ["REVISION_CONFLICT", "LOCKED", "OUTSTANDING_REVIEWS", "STATE_CONFLICT", "OPEN_IMPROVEMENTS", "RESPONSE_SUBMITTED"].includes(code) ? 409 : 400;
    const revision = code === "REVISION_CONFLICT" ? message.match(/current revision (\d+)/) : null;
    return new CloseoutError(marker[2] || "The close-out request could not be completed.", status, code, revision ? { currentRevision: Number(revision[1]) } : {});
  }
  if (["PGRST202", "PGRST204", "PGRST205", "42P01", "42703", "42883"].includes(error?.code)) return new CloseoutError("The Project Close Report database upgrade has not been installed. Ask an administrator to apply the approved Ecology migration.", 503, "MIGRATION_REQUIRED");
  return null;
}

export function closeoutErrorResponse(error) {
  const known = error instanceof CloseoutError ? error : closeoutRpcError(error);
  return known ? Response.json({ error: known.message, code: known.code, ...known.details }, { status: known.status }) : null;
}

async function pages(makeQuery) {
  const result = [];
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await makeQuery().range(offset, offset + 499);
    if (error) throw error;
    result.push(...(data || []));
    if ((data || []).length < 500) return result;
  }
}

export async function closeoutTeam(admin, project) {
  const [allocations, activities] = await Promise.all([
    pages(() => admin.from("project_allocations").select("id, staff_user_id, role_on_project").eq("project_id", project.id).eq("active", true).order("id")),
    pages(() => admin.from("project_activities").select("id, staff_user_id, acceptance_status").eq("project_id", project.id).eq("is_active", true).order("id")),
  ]);
  const roles = new Map();
  const add = (id, role) => { if (id && !roles.has(id)) roles.set(id, role || "Project team"); };
  add(project.project_lead_user_id, "Project lead");
  add(project.overseeing_senior_ecologist_user_id, "Overseeing senior ecologist");
  allocations.forEach((row) => add(row.staff_user_id, row.role_on_project));
  for (let offset = 0; offset < activities.length; offset += 100) {
    const batch = activities.slice(offset, offset + 100);
    const assignments = await pages(() => admin.from("project_activity_assignees").select("id, activity_id, staff_user_id, role, acceptance_status, removed_at").in("activity_id", batch.map((row) => row.id)).order("id"));
    const assignedActivities = new Set(assignments.map((row) => row.activity_id));
    for (const row of assignments) if (!row.removed_at && !["removed", "declined"].includes(row.acceptance_status)) add(row.staff_user_id, row.role);
    for (const row of batch) if (!assignedActivities.has(row.id) && !["removed", "declined"].includes(row.acceptance_status)) add(row.staff_user_id, "Project activity team");
  }
  const team = [];
  // The auth directory is paginated; projects may include identities after page 1.
  for (let page = 1; ; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const users = data?.users || [];
    for (const user of users) {
      if (!roles.has(user.id) || user.deleted_at || user.user_metadata?.staff_directory_active === false || (user.banned_until && new Date(user.banned_until) > new Date())) continue;
      const meta = user.user_metadata || {};
      team.push({ id: user.id, name: String(meta.full_name || meta.name || [meta.first_name || meta.firstName, meta.last_name || meta.lastName].filter(Boolean).join(" ") || user.email || user.id), email: user.email || "", role: roles.get(user.id) });
    }
    if (users.length < 200) break;
  }
  return team.sort((a, b) => a.name.localeCompare(b.name, "en-AU"));
}

export async function closeoutRows(admin, table, closeoutId, userId = null) {
  return pages(() => {
    let query = admin.from(table).select("*").eq("closeout_id", closeoutId).order("created_at").order("id");
    if (userId) query = query.eq("staff_user_id", userId);
    return query;
  });
}
