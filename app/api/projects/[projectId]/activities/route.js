import { requireSession, serverError } from "../../../../../lib/serverAuth";
import { listDirectoryUsers } from "../../../../../lib/staffDirectory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const COLUMNS = "id, project_id, staff_user_id, task_category, title, detail, budget_hours, due_date, start_date, milestone, status, pause_reason, sort_order, updated_at, created_at, schedule_item_id, acceptance_status, response_note, assigned_at, accepted_at, declined_at, actioned_at, started_at, completed_at, assigned_by, notified_at, progress_percent, locked, is_active, deliverable_id";
const LEGACY_COLUMNS = "id, project_id, staff_user_id, task_category, title, detail, budget_hours, status, pause_reason, sort_order, updated_at, created_at";
const ASSIGNMENT_COLUMNS = "id, activity_id, staff_user_id, allocated_hours, role, acceptance_status, response_note, assigned_at, accepted_at, declined_at, actioned_at, assigned_by, notified_at, removed_at, created_at, updated_at";
const ACTIVITY_STATUSES = new Set(["not_commenced", "active", "need_info", "paused_other", "qa_review", "completed"]);

function opt(value) {
  const text = typeof value === "string" ? value.trim() : "";
  return text || null;
}

function dueDate(value) {
  const date = opt(value);
  return date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null;
}

function num(value) {
  if (value === "" || value == null) return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function percent(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(100, Math.round(number * 100) / 100)) : 0;
}

function validId(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ""));
}

function isConnectedSchemaError(error) {
  const code = String(error?.code || "");
  const message = String(error?.message || "").toLowerCase();
  return code === "42703" || code === "42P01" || code === "PGRST205" || message.includes("schedule_item_id") || message.includes("acceptance_status") || message.includes("is_active") || message.includes("schema cache");
}

// The join migration is intentionally optional at runtime while staged
// deployments refresh PostgREST. A missing/uncached table must keep the scalar
// assignment workflow usable rather than turn routine work-plan saves into 500s.
function isAssignmentSchemaError(error) {
  const code = String(error?.code || "");
  const message = String(error?.message || "").toLowerCase();
  return code === "42P01" || code === "PGRST205" || code === "PGRST200"
    || message.includes("project_activity_assignees")
    || message.includes("schema cache")
    || message.includes("does not exist");
}

function stripConnectedColumns(row) {
  const {
    due_date,
    schedule_item_id,
    acceptance_status,
    response_note,
    assigned_at,
    accepted_at,
    declined_at,
    actioned_at,
    started_at,
    completed_at,
    assigned_by,
    notified_at,
    progress_percent,
    locked,
    is_active,
    ...legacy
  } = row;
  return legacy;
}

// Content identity must deliberately exclude assignees. Changing a team is an
// update to the same work activity, not a request to create a second activity.
function contentSignature(row) {
  return [
    (row.deliverable_id ?? row.deliverableId) || "",
    String(row.title || "").trim().toLowerCase(),
    (row.detail ?? opt(row.detail)) || "",
    (row.due_date ?? dueDate(row.dueDate)) || "",
    (row.start_date ?? dueDate(row.startDate)) || "",
  ].join("|");
}

// Dates are deliberately omitted from this fallback identity. A local activity
// draft can be retained while an administrator adds dates in a later session;
// that must update the same planned row rather than create a duplicate row
// simply because its original saved dates were blank. sort_order keeps repeated
// otherwise-identical activities (for example two report packages) distinct.
function planIdentity(row) {
  return [
    Number(row.sort_order ?? row.sortOrder) || 0,
    (row.deliverable_id ?? row.deliverableId) || "",
    String(row.title || "").trim().toLowerCase(),
    String(row.detail || "").trim().toLowerCase(),
    String(row.task_category ?? row.taskCategory ?? "").trim().toLowerCase(),
    num(row.budget_hours ?? row.budgetHours) ?? "",
    row.milestone === true ? "1" : "0",
  ].join("|");
}

function formatDueDate(value) {
  if (!value) return "";
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? "" : ` · Due ${date.toLocaleDateString("en-AU", { day: "numeric", month: "short" })}`;
}

function hasAssignmentInput(row) {
  return Object.hasOwn(row || {}, "assignees")
    || Object.hasOwn(row || {}, "staffUserIds")
    || Object.hasOwn(row || {}, "staffUserId")
    || Object.hasOwn(row || {}, "staff_user_id");
}

function activeAssignees(rows) {
  return (rows || []).filter((row) => row.acceptance_status !== "removed");
}

function normaliseAssignees(row, budgetHours, fallback = []) {
  const explicit = hasAssignmentInput(row);
  let raw = [];
  let scalarFallback = false;
  if (Object.hasOwn(row || {}, "assignees")) {
    if (!Array.isArray(row.assignees)) return { error: "assignees must be an array." };
    raw = row.assignees;
  } else if (Object.hasOwn(row || {}, "staffUserIds")) {
    if (!Array.isArray(row.staffUserIds)) return { error: "staffUserIds must be an array." };
    raw = row.staffUserIds;
  } else if (Object.hasOwn(row || {}, "staffUserId") || Object.hasOwn(row || {}, "staff_user_id")) {
    const staffUserId = row.staffUserId ?? row.staff_user_id;
    raw = staffUserId ? [{ staffUserId, allocatedHours: row.allocatedHours, role: row.role }] : [];
    scalarFallback = true;
  } else {
    raw = fallback;
  }

  const seen = new Set();
  const assignees = [];
  for (const candidate of raw) {
    const source = typeof candidate === "string" ? { staffUserId: candidate } : (candidate || {});
    const staffUserId = String(source.staffUserId ?? source.staff_user_id ?? source.id ?? "").trim();
    if (!staffUserId) continue;
    if (!validId(staffUserId)) return { error: "Choose valid staff members for this activity." };
    if (seen.has(staffUserId)) continue;
    const providedHours = source.allocatedHours ?? source.allocated_hours;
    const allocatedHours = providedHours === undefined || providedHours === null || providedHours === ""
      ? (scalarFallback ? Number(budgetHours || 0) : Number(source.allocated_hours || 0))
      : Number(providedHours);
    if (!Number.isFinite(allocatedHours) || allocatedHours < 0) return { error: "Allocated hours must be a nonnegative number." };
    const role = opt(source.role) || "contributor";
    seen.add(staffUserId);
    assignees.push({ staffUserId, allocatedHours, role });
  }
  return { assignees, explicit };
}

function legacyPrimary(assignees, previousStaffUserId = null) {
  const previous = (assignees || []).find((assignee) => assignee.staffUserId === previousStaffUserId);
  return previous?.staffUserId || assignees?.[0]?.staffUserId || null;
}

function assignmentPayload(assignment, email = null) {
  return {
    id: assignment.id,
    staffUserId: assignment.staff_user_id,
    staff_user_id: assignment.staff_user_id,
    email,
    allocatedHours: Number(assignment.allocated_hours || 0),
    allocated_hours: Number(assignment.allocated_hours || 0),
    role: assignment.role || "contributor",
    acceptanceStatus: assignment.acceptance_status,
    acceptance_status: assignment.acceptance_status,
    responseStatus: assignment.acceptance_status,
    responseNote: assignment.response_note || "",
    response_note: assignment.response_note || null,
    assignedAt: assignment.assigned_at || null,
    acceptedAt: assignment.accepted_at || null,
    declinedAt: assignment.declined_at || null,
    actionedAt: assignment.actioned_at || null,
    assignedBy: assignment.assigned_by || null,
    notifiedAt: assignment.notified_at || null,
  };
}

async function loadAssignments(admin, activityIds) {
  if (!activityIds.length) return { available: true, rows: [], byActivity: new Map() };
  const result = await admin.from("project_activity_assignees").select(ASSIGNMENT_COLUMNS).in("activity_id", activityIds);
  if (result.error) {
    if (isAssignmentSchemaError(result.error)) return { available: false, rows: [], byActivity: new Map() };
    throw new Error(result.error.message);
  }
  const byActivity = new Map();
  for (const row of result.data || []) {
    const rows = byActivity.get(row.activity_id) || [];
    rows.push(row);
    byActivity.set(row.activity_id, rows);
  }
  return { available: true, rows: result.data || [], byActivity };
}

async function loadProject(access, projectId) {
  const { data, error } = await access.admin.from("projects").select("id, name, created_by, status, activities_approval_status, deleted_at").eq("id", projectId).maybeSingle();
  if (error) throw new Error(error.message);
  return data || null;
}

async function canReadProject(access, projectId, staffWorkspace = false) {
  if (access.isAdmin && !staffWorkspace) return true;
  const { data: liveProject, error: projectError } = await access.admin
    .from("projects")
    .select("id")
    .eq("id", projectId)
    .eq("status", "active")
    .is("deleted_at", null)
    .maybeSingle();
  if (projectError) throw new Error(projectError.message);
  if (!liveProject) return false;

  const [allocationResult, activityResult] = await Promise.all([
    access.admin.from("project_allocations").select("id").eq("project_id", projectId).eq("staff_user_id", access.user.id).neq("active", false).limit(1),
    access.admin.from("project_activities").select("id, staff_user_id, acceptance_status").eq("project_id", projectId).eq("is_active", true),
  ]);
  if (allocationResult.error) throw new Error(allocationResult.error.message);
  if (activityResult.error && !isConnectedSchemaError(activityResult.error)) throw new Error(activityResult.error.message);
  let activities = activityResult.data || [];
  if (activityResult.error) {
    const fallback = await access.admin.from("project_activities").select("id, staff_user_id, acceptance_status").eq("project_id", projectId);
    if (fallback.error) throw new Error(fallback.error.message);
    activities = fallback.data || [];
  }
  const assignmentState = await loadAssignments(access.admin, activities.map((activity) => activity.id));
  const assigned = assignmentState.available
    ? activities.some((activity) => {
      const rows = assignmentState.byActivity.get(activity.id);
      return rows
        ? activeAssignees(rows).some((row) => row.staff_user_id === access.user.id && ["accepted", "actioned"].includes(row.acceptance_status))
        : activity.staff_user_id === access.user.id && ["accepted", "actioned"].includes(activity.acceptance_status || "accepted");
    })
    : activities.some((row) => row.staff_user_id === access.user.id && ["accepted", "actioned"].includes(row.acceptance_status || "accepted"));
  return Boolean((allocationResult.data || []).length || assigned);
}

function assignmentEvent(project, activity, recipientId) {
  return {
    recipient_id: recipientId,
    event_type: "project_activity_assigned",
    severity: "action_required",
    title: `Work assignment: ${activity.title}`,
    body: `${project.name}${activity.task_category ? ` · ${activity.task_category}` : ""}${activity.budget_hours != null ? ` · ${activity.budget_hours} budgeted hours` : ""}${formatDueDate(activity.due_date)}`,
    href: "/staff/notifications",
    source_table: "project_activities",
    source_id: activity.id,
  };
}

async function createAssignmentEvents(admin, project, pendingAssignments) {
  const events = (pendingAssignments || []).map(({ activity, assignment }) => assignmentEvent(project, activity, assignment.staff_user_id));
  if (!events.length) return null;
  const { error } = await admin.from("portal_events").insert(events);
  return error ? error.message : null;
}

async function hydrateActivities(access, rows, assignmentState) {
  const ids = new Set();
  for (const row of rows || []) {
    if (row.staff_user_id) ids.add(row.staff_user_id);
    for (const assignment of assignmentState.available ? activeAssignees(assignmentState.byActivity.get(row.id)) : []) ids.add(assignment.staff_user_id);
  }
  const { data: users } = ids.size ? await access.admin.auth.admin.listUsers({ page: 1, perPage: 200 }) : { data: { users: [] } };
  const emailById = new Map((users?.users || []).map((user) => [user.id, user.email]));
  return (rows || []).map((row) => {
    const joinedRows = assignmentState.byActivity.get(row.id);
    const joined = assignmentState.available ? activeAssignees(joinedRows) : [];
    const legacy = row.staff_user_id ? [{
      id: null,
      activity_id: row.id,
      staff_user_id: row.staff_user_id,
      allocated_hours: row.budget_hours || 0,
      role: "contributor",
      acceptance_status: row.acceptance_status || "accepted",
      response_note: row.response_note,
      assigned_at: row.assigned_at,
      accepted_at: row.accepted_at,
      declined_at: row.declined_at,
      actioned_at: row.actioned_at,
      assigned_by: row.assigned_by,
      notified_at: row.notified_at,
    }] : [];
    // A scalar-only row can exist briefly when an older deployment path writes
    // an activity after this migration. Fall back only when there is no join
    // record at all—not where a response-bearing row was deliberately removed.
    const assignees = (assignmentState.available && joinedRows ? joined : legacy).map((assignment) => assignmentPayload(assignment, emailById.get(assignment.staff_user_id) || null));
    return {
      ...row,
      staffUserId: row.staff_user_id || assignees[0]?.staffUserId || null,
      staff_email: row.staff_user_id ? emailById.get(row.staff_user_id) || null : null,
      assignees,
    };
  });
}

async function activeProjectAllocationIds(admin, projectId) {
  let result = await admin.from("project_allocations").select("staff_user_id").eq("project_id", projectId).neq("active", false);
  if (result.error && (String(result.error.code || "") === "42703" || /active/i.test(String(result.error.message || "")))) {
    result = await admin.from("project_allocations").select("staff_user_id").eq("project_id", projectId);
  }
  if (result.error) throw new Error(result.error.message);
  return new Set((result.data || []).map((row) => row.staff_user_id).filter(Boolean));
}

async function dismissRemovedRecipientEvents(admin, activityId, staffUserId, now) {
  const { error } = await admin.from("portal_events")
    .update({ dismissed_at: now })
    .eq("recipient_id", staffUserId)
    .eq("source_table", "project_activities")
    .eq("source_id", activityId)
    .eq("event_type", "project_activity_assigned")
    .is("read_at", null)
    .is("dismissed_at", null);
  if (error) throw new Error(error.message);
}

// Diff against recipient identity, not the activity scalar. Existing recipient
// lifecycle fields never change merely because another colleague is added.
async function syncAssignments(admin, activity, requestedAssignees, currentRows, actorId, now) {
  const current = activeAssignees(currentRows);
  const byStaff = new Map((currentRows || []).map((row) => [row.staff_user_id, row]));
  const requestedByStaff = new Map((requestedAssignees || []).map((row) => [row.staffUserId, row]));
  const additions = [];

  for (const requested of requestedAssignees || []) {
    const previous = byStaff.get(requested.staffUserId);
    if (!previous) {
      const { data, error } = await admin.from("project_activity_assignees").insert({
        activity_id: activity.id,
        staff_user_id: requested.staffUserId,
        allocated_hours: requested.allocatedHours,
        role: requested.role,
        acceptance_status: "awaiting_response",
        assigned_at: now,
        assigned_by: actorId,
        created_at: now,
        updated_at: now,
      }).select(ASSIGNMENT_COLUMNS).single();
      if (error) throw new Error(error.message);
      additions.push({ activity, assignment: data });
    } else if (previous.acceptance_status === "removed") {
      const { data, error } = await admin.from("project_activity_assignees").update({
        allocated_hours: requested.allocatedHours,
        role: requested.role,
        acceptance_status: "awaiting_response",
        response_note: null,
        assigned_at: now,
        accepted_at: null,
        declined_at: null,
        actioned_at: null,
        assigned_by: actorId,
        notified_at: null,
        removed_at: null,
        updated_at: now,
      }).eq("id", previous.id).select(ASSIGNMENT_COLUMNS).single();
      if (error) throw new Error(error.message);
      additions.push({ activity, assignment: data });
    } else if (previous.allocated_hours !== requested.allocatedHours || previous.role !== requested.role) {
      const { error } = await admin.from("project_activity_assignees").update({
        allocated_hours: requested.allocatedHours,
        role: requested.role,
        updated_at: now,
      }).eq("id", previous.id);
      if (error) throw new Error(error.message);
    }
  }

  for (const previous of current) {
    if (requestedByStaff.has(previous.staff_user_id)) continue;
    // A never-responded assignment is disposable. Once it records a response or
    // action, retain it as removed so operational history remains auditable.
    if (!previous.accepted_at && !previous.declined_at && !previous.actioned_at) {
      const { error } = await admin.from("project_activity_assignees").delete().eq("id", previous.id);
      if (error) throw new Error(error.message);
    } else {
      const { error } = await admin.from("project_activity_assignees").update({
        acceptance_status: "removed",
        removed_at: now,
        updated_at: now,
      }).eq("id", previous.id);
      if (error) throw new Error(error.message);
    }
    await dismissRemovedRecipientEvents(admin, activity.id, previous.staff_user_id, now);
  }
  return additions;
}

export async function GET(request, { params }) {
  try {
    const access = await requireSession(request);
    if (access.error) return access.error;
    const staffWorkspace = new URL(request.url).searchParams.get("audience") === "staff";
    if (!(await canReadProject(access, params.projectId, staffWorkspace))) return Response.json({ error: "You are not allocated to this project." }, { status: 403 });

    let connected = true;
    let result = await access.admin.from("project_activities").select(COLUMNS).eq("project_id", params.projectId).eq("is_active", true).order("sort_order", { ascending: true });
    if (result.error && isConnectedSchemaError(result.error)) {
      connected = false;
      result = await access.admin.from("project_activities").select(LEGACY_COLUMNS).eq("project_id", params.projectId).order("sort_order", { ascending: true });
    }
    if (result.error) return Response.json({ error: result.error.message }, { status: 400 });

    let rows = result.data || [];
    const assignmentState = await loadAssignments(access.admin, rows.map((row) => row.id));
    if (!access.isAdmin || staffWorkspace) {
      rows = assignmentState.available
        ? rows.filter((row) => {
          const assignments = assignmentState.byActivity.get(row.id);
          return assignments
            ? activeAssignees(assignments).some((assignment) => assignment.staff_user_id === access.user.id && ["accepted", "actioned"].includes(assignment.acceptance_status))
            : row.staff_user_id === access.user.id && ["accepted", "actioned"].includes(row.acceptance_status || "accepted");
        })
        : rows.filter((row) => row.staff_user_id === access.user.id && ["accepted", "actioned"].includes(row.acceptance_status || "accepted"));
    }
    const hydrated = await hydrateActivities(access, rows, assignmentState);
    return Response.json({ activities: hydrated, connectedWorkflowReady: connected, multiAssigneeReady: assignmentState.available });
  } catch (error) {
    return serverError(error);
  }
}

// Administrators maintain an activity plan without deleting the historical
// activity IDs used by response records, tracker entries and Gantt links.
export async function PUT(request, { params }) {
  try {
    const access = await requireSession(request);
    if (access.error) return access.error;
    if (!access.isAdmin) return Response.json({ error: "Only administrators can manage activities." }, { status: 403 });

    const project = await loadProject(access, params.projectId);
    if (!project) return Response.json({ error: "Project not found." }, { status: 404 });
    const body = await request.json();
    if (!Array.isArray(body.activities) || body.activities.length > 200) return Response.json({ error: "Provide no more than 200 activities." }, { status: 400 });

    const existingResult = await access.admin.from("project_activities").select(COLUMNS).eq("project_id", params.projectId).eq("is_active", true);
    if (existingResult.error) {
      if (isConnectedSchemaError(existingResult.error)) return Response.json({ error: "The connected activity workflow is awaiting its approved database migration." }, { status: 409 });
      return Response.json({ error: existingResult.error.message }, { status: 400 });
    }
    const existingRows = existingResult.data || [];
    const existingById = new Map(existingRows.map((activity) => [activity.id, activity]));
    const assignmentState = await loadAssignments(access.admin, existingRows.map((activity) => activity.id));
    const activeActivityCountByScheduleId = new Map();
    for (const activity of existingRows) {
      if (!validId(activity.schedule_item_id)) continue;
      activeActivityCountByScheduleId.set(activity.schedule_item_id, (activeActivityCountByScheduleId.get(activity.schedule_item_id) || 0) + 1);
    }
    const existingBySignature = new Map();
    const existingByPlanIdentity = new Map();
    for (const activity of existingRows) {
      const sig = contentSignature(activity);
      if (!existingBySignature.has(sig)) existingBySignature.set(sig, activity);
      const stablePlanSig = planIdentity(activity);
      if (!existingByPlanIdentity.has(stablePlanSig)) existingByPlanIdentity.set(stablePlanSig, activity);
    }

    const [directory, deliverablesResult, allocatedIds] = await Promise.all([
      listDirectoryUsers(access.admin, { activeOnly: true }),
      access.admin.from("project_deliverables").select("id").eq("project_id", params.projectId).eq("is_active", true),
      activeProjectAllocationIds(access.admin, params.projectId),
    ]);
    if (deliverablesResult.error) return Response.json({ error: deliverablesResult.error.message }, { status: 400 });
    const availableIds = new Set(directory.map((person) => person.id));
    const availableDeliverableIds = new Set((deliverablesResult.data || []).map((deliverable) => deliverable.id));
    const inputRows = [];
    const incomingSignatures = new Set();
    for (const activity of body.activities) {
      if (!activity || typeof activity.title !== "string" || !activity.title.trim()) continue;
      const normalised = { ...activity, title: activity.title.trim() };
      const signature = validId(normalised.id)
        ? `id:${normalised.id}`
        : [
            validId(normalised.deliverableId) ? normalised.deliverableId : "",
            normalised.title.toLowerCase(),
            opt(normalised.detail) || "",
            dueDate(normalised.dueDate) || "",
            dueDate(normalised.startDate) || "",
            num(normalised.budgetHours) ?? "",
            validId(normalised.scheduleItemId) ? normalised.scheduleItemId : "",
          ].join("|");
      if (incomingSignatures.has(signature)) continue;
      incomingSignatures.add(signature);
      inputRows.push({ ...normalised, sortOrder: inputRows.length + 1 });
    }
    if (inputRows.some((row) => row.deliverableId && (!validId(row.deliverableId) || !availableDeliverableIds.has(row.deliverableId)))) return Response.json({ error: "Choose an active deliverable from this project for each linked work activity." }, { status: 400 });

    // Concurrency check: if a client's copy of an activity is stale — someone
    // else saved a change to it since this client loaded the page — reject
    // the whole save rather than silently overwriting their change.
    const conflicts = [];
    for (const input of inputRows) {
      if (!validId(input.id)) continue;
      const previous = existingById.get(input.id);
      if (previous && input.loadedUpdatedAt && previous.updated_at && new Date(previous.updated_at).getTime() !== new Date(input.loadedUpdatedAt).getTime()) conflicts.push({ id: input.id, title: previous.title });
    }
    if (conflicts.length) {
      return Response.json({
        error: `${conflicts.length} activit${conflicts.length === 1 ? "y was" : "ies were"} changed by someone else since you loaded this page. Reload to see the current version before saving.`,
        conflicts,
      }, { status: 409 });
    }

    // Resolve all assignment changes before making any schedule/activity write so
    // a late validation failure cannot partially persist a team replacement.
    for (const input of inputRows) {
      const existingForInputId = validId(input.id) ? existingById.get(input.id) : null;
      const matchedBySignature = !existingForInputId ? existingBySignature.get(contentSignature({ deliverableId: input.deliverableId, title: input.title, detail: input.detail, dueDate: input.dueDate, startDate: input.startDate })) : null;
      const matchedByPlanIdentity = !existingForInputId ? existingByPlanIdentity.get(planIdentity(input)) : null;
      const previous = existingForInputId || matchedBySignature || matchedByPlanIdentity;
      const joinedRows = previous ? assignmentState.byActivity.get(previous.id) : null;
      const fallbackAssignees = assignmentState.available && joinedRows
        ? activeAssignees(joinedRows).map((assignment) => ({ staffUserId: assignment.staff_user_id, allocatedHours: assignment.allocated_hours, role: assignment.role }))
        : (previous?.staff_user_id ? [{ staffUserId: previous.staff_user_id, allocatedHours: previous.budget_hours || 0 }] : []);
      const budgetHours = num(input.budgetHours) ?? num(previous?.budget_hours) ?? 0;
      const requested = normaliseAssignees(input, budgetHours, fallbackAssignees);
      if (requested.error) return Response.json({ error: requested.error }, { status: 400 });
      if (!assignmentState.available && requested.assignees.length > 1) {
        return Response.json({ error: "Multi-staff assignments are awaiting the project activity assignees migration.", migration_pending: true }, { status: 409 });
      }
      const invalidAssignee = (requested.assignees || []).find((assignment) => !availableIds.has(assignment.staffUserId) || !allocatedIds.has(assignment.staffUserId));
      if (invalidAssignee) return Response.json({ error: "Project activities must be assigned to active Staff List members allocated to this project." }, { status: 400 });
      const assignedHours = (requested.assignees || []).reduce((total, assignment) => total + assignment.allocatedHours, 0);
      if (assignedHours > budgetHours) return Response.json({ error: "Total allocated staff hours cannot exceed this activity's budget hours." }, { status: 400 });
      input._previous = previous;
      input._assignees = requested.assignees || [];
    }

    const scheduleResult = await access.admin.from("project_schedule_items").select("id, generated_from_activity_id").eq("project_id", params.projectId).eq("is_active", true);
    if (scheduleResult.error) return Response.json({ error: scheduleResult.error.message }, { status: 400 });
    const scheduleIds = new Set((scheduleResult.data || []).map((item) => item.id));
    const generatedScheduleByActivityId = new Map((scheduleResult.data || []).filter((item) => validId(item.generated_from_activity_id)).map((item) => [item.generated_from_activity_id, item.id]));
    const invalidScheduleSelection = inputRows.find((row) => {
      if (!row.scheduleItemId || scheduleIds.has(row.scheduleItemId)) return false;
      // A browser draft can retain a Schedule UUID that was retired during an
      // interrupted prior save. If the activity itself can be recovered, the
      // current generated Schedule row will be adopted inside the upsert loop.
      const recoveredActivity = (validId(row.id) ? existingById.get(row.id) : null)
        || existingBySignature.get(contentSignature({ deliverableId: row.deliverableId, title: row.title, detail: row.detail, dueDate: row.dueDate, startDate: row.startDate }))
        || existingByPlanIdentity.get(planIdentity(row));
      return !recoveredActivity;
    });
    if (invalidScheduleSelection) return Response.json({ error: "Choose a Gantt schedule item from this project." }, { status: 400 });

    const now = new Date().toISOString();
    let nextScheduleSort = (scheduleResult.data || []).length + 1;
    // This remains a pure upsert. Missing from a client payload never means
    // delete: DELETE below is the only explicit retirement path.
    const legacyCreatedOrReassigned = [];
    const newAssignmentNotifications = [];
    const persisted = [];
    const retiredSharedScheduleCandidates = new Set();
    for (const input of inputRows) {
      const previous = input._previous;
      const requestedAssignees = input._assignees;
      const assignedTo = legacyPrimary(requestedAssignees, previous?.staff_user_id);
      const changedAssignee = !assignmentState.available && Boolean(previous && previous.staff_user_id !== assignedTo);
      const requestedStatus = ACTIVITY_STATUSES.has(input.status) ? input.status : (previous?.status || "not_commenced");
      const recoveredGeneratedScheduleId = previous ? generatedScheduleByActivityId.get(previous.id) : null;
      let scheduleItemId = recoveredGeneratedScheduleId || (validId(input.scheduleItemId) ? input.scheduleItemId : (previous?.schedule_item_id || null));
      const retainsExistingLink = previous?.schedule_item_id === scheduleItemId;
      if (retainsExistingLink && (activeActivityCountByScheduleId.get(scheduleItemId) || 0) > 1) {
        retiredSharedScheduleCandidates.add(scheduleItemId);
        scheduleItemId = null;
      }
      let createdScheduleItem = false;
      if (!scheduleItemId) {
        const { data: scheduleItem, error: scheduleError } = await access.admin.from("project_schedule_items").insert({
          project_id: params.projectId,
          sort_order: nextScheduleSort,
          title: input.title,
          detail: opt(input.detail),
          start_date: dueDate(input.startDate) || dueDate(input.dueDate),
          end_date: dueDate(input.dueDate),
          milestone: input.milestone === true,
          progress_percent: requestedStatus === "completed" ? 100 : percent(input.progressPercent),
          status: requestedStatus,
          is_active: true,
        }).select("id").single();
        if (scheduleError) return Response.json({ error: scheduleError.message }, { status: 400 });
        scheduleItemId = scheduleItem.id;
        scheduleIds.add(scheduleItemId);
        nextScheduleSort += 1;
        createdScheduleItem = true;
      }
      const row = {
        project_id: params.projectId,
        staff_user_id: assignedTo,
        deliverable_id: validId(input.deliverableId) ? input.deliverableId : null,
        task_category: opt(input.taskCategory),
        title: input.title,
        detail: opt(input.detail),
        budget_hours: num(input.budgetHours),
        due_date: dueDate(input.dueDate),
        start_date: dueDate(input.startDate) || dueDate(input.dueDate),
        schedule_item_id: scheduleItemId,
        milestone: input.milestone === true,
        status: changedAssignee ? "not_commenced" : requestedStatus,
        pause_reason: requestedStatus === "paused_other" ? opt(input.pauseReason) : null,
        sort_order: input.sortOrder,
        progress_percent: requestedStatus === "completed" ? 100 : percent(input.progressPercent ?? previous?.progress_percent),
        locked: input.locked === true,
        is_active: true,
        updated_at: now,
      };

      let saved;
      if (previous) {
        if (changedAssignee) {
          row.acceptance_status = assignedTo ? "awaiting_response" : "accepted";
          row.response_note = null;
          row.notified_at = null;
          row.assigned_at = now;
          row.assigned_by = access.user.id;
          row.accepted_at = null;
          row.declined_at = null;
          row.actioned_at = null;
          row.started_at = null;
          row.completed_at = null;
        }
        const { data, error } = await access.admin.from("project_activities").update(row).eq("id", previous.id).select(COLUMNS).single();
        if (error) return Response.json({ error: error.message }, { status: 400 });
        saved = data;
        if (createdScheduleItem) {
          const { error: provenanceError } = await access.admin.from("project_schedule_items").update({ generated_from_activity_id: data.id, updated_at: now }).eq("id", scheduleItemId);
          if (provenanceError) return Response.json({ error: provenanceError.message }, { status: 400 });
        }
        if (changedAssignee && assignedTo) legacyCreatedOrReassigned.push(saved);
      } else {
        row.created_by = access.user.id;
        row.assigned_by = access.user.id;
        row.assigned_at = now;
        row.acceptance_status = assignedTo ? "awaiting_response" : "accepted";
        const { data, error } = await access.admin.from("project_activities").insert(row).select(COLUMNS).single();
        if (error) return Response.json({ error: error.message }, { status: 400 });
        saved = data;
        if (createdScheduleItem) {
          const { error: provenanceError } = await access.admin.from("project_schedule_items").update({ generated_from_activity_id: data.id, updated_at: now }).eq("id", scheduleItemId);
          if (provenanceError) return Response.json({ error: provenanceError.message }, { status: 400 });
        }
        if (!assignmentState.available && assignedTo) legacyCreatedOrReassigned.push(saved);
      }
      persisted.push(saved);
      if (assignmentState.available) {
        const additions = await syncAssignments(access.admin, saved, requestedAssignees, previous ? assignmentState.byActivity.get(previous.id) || [] : [], access.user.id, now);
        newAssignmentNotifications.push(...additions);
      }
    }

    for (const scheduleItemId of retiredSharedScheduleCandidates) {
      const { count, error: remainingLinksError } = await access.admin.from("project_activities").select("id", { count: "exact", head: true }).eq("schedule_item_id", scheduleItemId).eq("is_active", true);
      if (remainingLinksError) return Response.json({ error: remainingLinksError.message }, { status: 400 });
      if (!count) {
        const { error: retireScheduleError } = await access.admin.from("project_schedule_items").update({ is_active: false, updated_at: now }).eq("id", scheduleItemId);
        if (retireScheduleError) return Response.json({ error: retireScheduleError.message }, { status: 400 });
      }
    }

    const linkedScheduleIds = [...new Set(persisted.map((activity) => activity.schedule_item_id).filter(validId))];
    for (const scheduleItemId of linkedScheduleIds) {
      const { data: scheduleActivities, error: scheduleActivitiesError } = await access.admin.from("project_activities").select("id, title, detail, start_date, due_date, milestone, status, progress_percent").eq("schedule_item_id", scheduleItemId).eq("is_active", true);
      if (scheduleActivitiesError) return Response.json({ error: scheduleActivitiesError.message }, { status: 400 });
      const linked = scheduleActivities || [];
      const progressPercent = linked.length ? Math.round((linked.reduce((sum, activity) => sum + percent(activity.progress_percent), 0) / linked.length) * 100) / 100 : 0;
      const states = new Set(linked.map((activity) => activity.status));
      const status = states.has("need_info") ? "need_info" : states.has("paused_other") ? "paused_other" : states.has("qa_review") ? "qa_review" : states.has("active") ? "active" : linked.length && [...states].every((value) => value === "completed") ? "completed" : "not_commenced";
      const { data: scheduleItem, error: scheduleItemError } = await access.admin.from("project_schedule_items").select("id, generated_from_activity_id").eq("id", scheduleItemId).maybeSingle();
      if (scheduleItemError) return Response.json({ error: scheduleItemError.message }, { status: 400 });
      // Step 4 is source of truth. This also protects the
      // project_schedule_generated_activity_unique relationship during retries.
      const sourceActivity = linked.find((activity) => activity.id === scheduleItem?.generated_from_activity_id) || (linked.length === 1 ? linked[0] : null);
      const scheduleUpdate = {
        progress_percent: progressPercent,
        status,
        updated_at: now,
        ...(sourceActivity ? {
          generated_from_activity_id: sourceActivity.id,
          title: sourceActivity.title,
          detail: opt(sourceActivity.detail),
          start_date: dueDate(sourceActivity.start_date) || dueDate(sourceActivity.due_date),
          end_date: dueDate(sourceActivity.due_date),
          milestone: sourceActivity.milestone === true,
        } : {}),
      };
      const { error: updateScheduleError } = await access.admin.from("project_schedule_items").update(scheduleUpdate).eq("id", scheduleItemId);
      if (updateScheduleError) return Response.json({ error: updateScheduleError.message }, { status: 400 });
    }

    let eventWarning = null;
    let notified = 0;
    if (project.activities_approval_status === "approved" && project.status === "active" && !project.deleted_at) {
      if (assignmentState.available && newAssignmentNotifications.length) {
        eventWarning = await createAssignmentEvents(access.admin, project, newAssignmentNotifications);
        if (!eventWarning) {
          const assignmentIds = newAssignmentNotifications.map(({ assignment }) => assignment.id);
          const { error: markError } = await access.admin.from("project_activity_assignees").update({ notified_at: now, updated_at: now }).in("id", assignmentIds);
          eventWarning = markError?.message || null;
          notified = markError ? 0 : assignmentIds.length;
        }
      } else if (!assignmentState.available && legacyCreatedOrReassigned.length) {
        const legacyNotifications = legacyCreatedOrReassigned.map((activity) => ({ activity, assignment: { staff_user_id: activity.staff_user_id } }));
        eventWarning = await createAssignmentEvents(access.admin, project, legacyNotifications);
        if (!eventWarning) {
          const notifiedIds = legacyCreatedOrReassigned.map((activity) => activity.id);
          const { error: markError } = await access.admin.from("project_activities").update({ notified_at: now }).in("id", notifiedIds);
          eventWarning = markError?.message || null;
          notified = markError ? 0 : notifiedIds.length;
        }
      }
    }
    const finalAssignments = await loadAssignments(access.admin, persisted.map((activity) => activity.id));
    const hydrated = await hydrateActivities(access, persisted, finalAssignments.available ? finalAssignments : { available: false, rows: [], byActivity: new Map() });
    return Response.json({ success: true, count: persisted.length, activities: hydrated, notified, event_warning: eventWarning, multiAssigneeReady: assignmentState.available });
  } catch (error) {
    return serverError(error);
  }
}

// Explicit, immediate, single-activity deletion — replaces the old
// infer-from-absence retirement that used to run inside PUT.
export async function DELETE(request, { params }) {
  try {
    const access = await requireSession(request);
    if (access.error) return access.error;
    if (!access.isAdmin) return Response.json({ error: "Only administrators can manage activities." }, { status: 403 });

    const { searchParams } = new URL(request.url);
    const activityId = searchParams.get("id");
    if (!validId(activityId)) return Response.json({ error: "A valid activity id is required." }, { status: 400 });

    const { data: activity, error: fetchError } = await access.admin.from("project_activities").select("id, project_id, schedule_item_id").eq("id", activityId).eq("project_id", params.projectId).eq("is_active", true).maybeSingle();
    if (fetchError) return Response.json({ error: fetchError.message }, { status: 400 });
    if (!activity) return Response.json({ error: "Activity not found." }, { status: 404 });

    const now = new Date().toISOString();
    const { error: retireError } = await access.admin.from("project_activities").update({ is_active: false, updated_at: now }).eq("id", activityId);
    if (retireError) return Response.json({ error: retireError.message }, { status: 400 });

    const { error: eventRetireError } = await access.admin.from("portal_events").update({ dismissed_at: now }).eq("source_table", "project_activities").eq("source_id", activityId).eq("event_type", "project_activity_assigned").is("read_at", null).is("dismissed_at", null);
    if (eventRetireError) return Response.json({ error: eventRetireError.message }, { status: 400 });

    if (validId(activity.schedule_item_id)) {
      const { count, error: countError } = await access.admin.from("project_activities").select("id", { count: "exact", head: true }).eq("schedule_item_id", activity.schedule_item_id).eq("is_active", true);
      if (countError) return Response.json({ error: countError.message }, { status: 400 });
      if (!count) {
        const { error: scheduleRetireError } = await access.admin.from("project_schedule_items").update({ is_active: false, updated_at: now }).eq("id", activity.schedule_item_id);
        if (scheduleRetireError) return Response.json({ error: scheduleRetireError.message }, { status: 400 });
      }
    }
    return Response.json({ success: true });
  } catch (error) {
    return serverError(error);
  }
}
