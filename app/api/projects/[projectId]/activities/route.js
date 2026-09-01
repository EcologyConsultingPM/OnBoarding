import { requireSession, serverError } from "../../../../../lib/serverAuth";
import { listDirectoryUsers } from "../../../../../lib/staffDirectory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const COLUMNS = "id, project_id, staff_user_id, task_category, title, detail, budget_hours, due_date, status, pause_reason, sort_order, updated_at, created_at, schedule_item_id, acceptance_status, response_note, assigned_at, accepted_at, declined_at, actioned_at, started_at, completed_at, assigned_by, progress_percent, locked, is_active";
const LEGACY_COLUMNS = "id, project_id, staff_user_id, task_category, title, detail, budget_hours, status, pause_reason, sort_order, updated_at, created_at";
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
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{12}$/i.test(String(value || ""));
}

function isConnectedSchemaError(error) {
  const code = String(error?.code || "");
  const message = String(error?.message || "").toLowerCase();
  return code === "42703" || code === "42P01" || code === "PGRST205" || message.includes("schedule_item_id") || message.includes("acceptance_status") || message.includes("is_active") || message.includes("schema cache");
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
    progress_percent,
    locked,
    is_active,
    ...legacy
  } = row;
  return legacy;
}

function assignmentSignature(activity) {
  return [activity.staff_user_id || "", String(activity.title || "").trim().toLowerCase(), activity.due_date || ""].join("|");
}

function formatDueDate(value) {
  if (!value) return "";
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? "" : ` · Due ${date.toLocaleDateString("en-AU", { day: "numeric", month: "short" })}`;
}

async function loadProject(access, projectId) {
  const { data, error } = await access.admin.from("projects").select("id, name, created_by").eq("id", projectId).maybeSingle();
  if (error) throw new Error(error.message);
  return data || null;
}

async function canReadProject(access, projectId) {
  if (access.isAdmin) return true;
  const [allocationResult, activityResult] = await Promise.all([
    access.admin.from("project_allocations").select("id").eq("project_id", projectId).eq("staff_user_id", access.user.id).neq("active", false).limit(1),
    access.admin.from("project_activities").select("id").eq("project_id", projectId).eq("staff_user_id", access.user.id).eq("is_active", true).limit(1),
  ]);
  if (allocationResult.error) throw new Error(allocationResult.error.message);
  if (activityResult.error && !isConnectedSchemaError(activityResult.error)) throw new Error(activityResult.error.message);
  if (activityResult.error) {
    const fallback = await access.admin.from("project_activities").select("id").eq("project_id", projectId).eq("staff_user_id", access.user.id).limit(1);
    if (fallback.error) throw new Error(fallback.error.message);
    return Boolean((allocationResult.data || []).length || (fallback.data || []).length);
  }
  return Boolean((allocationResult.data || []).length || (activityResult.data || []).length);
}

async function createAssignmentEvents(admin, project, activities) {
  const events = activities
    .filter((activity) => activity.staff_user_id)
    .map((activity) => ({
      recipient_id: activity.staff_user_id,
      event_type: "project_activity_assigned",
      severity: "action_required",
      title: "Project activity awaiting acceptance",
      body: `${project.name}: ${activity.title}${formatDueDate(activity.due_date)}`,
      href: "/staff/notifications",
      source_table: "project_activities",
      source_id: activity.id,
    }));
  if (!events.length) return null;
  const { error } = await admin.from("portal_events").insert(events);
  return error ? error.message : null;
}

async function hydrateStaffEmails(access, rows) {
  if (!rows.length) return rows;
  const { data: users } = await access.admin.auth.admin.listUsers({ page: 1, perPage: 200 });
  const emailById = new Map((users?.users || []).map((user) => [user.id, user.email]));
  return rows.map((row) => ({
    ...row,
    staff_email: row.staff_user_id ? emailById.get(row.staff_user_id) || null : null,
  }));
}

export async function GET(request, { params }) {
  try {
    const access = await requireSession(request);
    if (access.error) return access.error;
    if (!(await canReadProject(access, params.projectId))) return Response.json({ error: "You are not allocated to this project." }, { status: 403 });

    let connected = true;
    let result = await access.admin.from("project_activities").select(COLUMNS).eq("project_id", params.projectId).eq("is_active", true).order("sort_order", { ascending: true });
    if (result.error && isConnectedSchemaError(result.error)) {
      connected = false;
      result = await access.admin.from("project_activities").select(LEGACY_COLUMNS).eq("project_id", params.projectId).order("sort_order", { ascending: true });
    }
    if (result.error) return Response.json({ error: result.error.message }, { status: 400 });

    let rows = result.data || [];
    if (!access.isAdmin) rows = rows.filter((row) => row.staff_user_id === access.user.id && ["accepted", "actioned"].includes(row.acceptance_status || "accepted"));
    const hydrated = await hydrateStaffEmails(access, rows);
    return Response.json({ activities: hydrated, connectedWorkflowReady: connected });
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
    const existingById = new Map((existingResult.data || []).map((activity) => [activity.id, activity]));

    const directory = await listDirectoryUsers(access.admin, { activeOnly: true });
    const availableIds = new Set(directory.map((person) => person.id));
    const inputRows = body.activities
      .filter((activity) => activity && typeof activity.title === "string" && activity.title.trim())
      .map((activity, index) => ({ ...activity, title: activity.title.trim(), sortOrder: index + 1 }));
    if (inputRows.some((row) => row.staffUserId && !availableIds.has(row.staffUserId))) return Response.json({ error: "Project activities must be assigned to an available staff member from the Staff List." }, { status: 400 });

    const scheduleResult = await access.admin.from("project_schedule_items").select("id").eq("project_id", params.projectId).eq("is_active", true);
    if (scheduleResult.error) return Response.json({ error: scheduleResult.error.message }, { status: 400 });
    const scheduleIds = new Set((scheduleResult.data || []).map((item) => item.id));
    if (inputRows.some((row) => row.scheduleItemId && !scheduleIds.has(row.scheduleItemId))) return Response.json({ error: "Choose a Gantt schedule item from this project." }, { status: 400 });

    const now = new Date().toISOString();
    let nextScheduleSort = (scheduleResult.data || []).length + 1;
    const incomingIds = new Set(inputRows.map((row) => row.id).filter(validId));
    const retiredIds = [...existingById.keys()].filter((id) => !incomingIds.has(id));
    if (retiredIds.length) {
      const { error } = await access.admin.from("project_activities").update({ is_active: false, updated_at: now }).in("id", retiredIds);
      if (error) return Response.json({ error: error.message }, { status: 400 });
    }

    const createdOrReassigned = [];
    const persisted = [];
    for (const input of inputRows) {
      const previous = validId(input.id) ? existingById.get(input.id) : null;
      const assignedTo = opt(input.staffUserId);
      const changedAssignee = Boolean(previous && previous.staff_user_id !== assignedTo);
      const requestedStatus = ACTIVITY_STATUSES.has(input.status) ? input.status : (previous?.status || "not_commenced");
      let scheduleItemId = validId(input.scheduleItemId) ? input.scheduleItemId : (previous?.schedule_item_id || null);
      // Each delivery activity must be visible in the project Gantt. Where an
      // administrator has not selected an existing phase, create a dedicated
      // activity schedule line using the due date as the delivery milestone.
      if (!scheduleItemId) {
        const { data: scheduleItem, error: scheduleError } = await access.admin
          .from("project_schedule_items")
          .insert({
            project_id: params.projectId,
            sort_order: nextScheduleSort,
            title: input.title,
            detail: opt(input.detail),
            start_date: dueDate(input.startDate) || dueDate(input.dueDate),
            end_date: dueDate(input.dueDate),
            milestone: false,
            progress_percent: requestedStatus === "completed" ? 100 : percent(input.progressPercent),
            status: requestedStatus,
            is_active: true,
          })
          .select("id")
          .single();
        if (scheduleError) return Response.json({ error: scheduleError.message }, { status: 400 });
        scheduleItemId = scheduleItem.id;
        scheduleIds.add(scheduleItemId);
        nextScheduleSort += 1;
      }
      const row = {
        project_id: params.projectId,
        staff_user_id: assignedTo,
        task_category: opt(input.taskCategory),
        title: input.title,
        detail: opt(input.detail),
        budget_hours: num(input.budgetHours),
        due_date: dueDate(input.dueDate),
        schedule_item_id: scheduleItemId,
        status: changedAssignee ? "not_commenced" : requestedStatus,
        pause_reason: requestedStatus === "paused_other" ? opt(input.pauseReason) : null,
        sort_order: input.sortOrder,
        progress_percent: requestedStatus === "completed" ? 100 : percent(input.progressPercent ?? previous?.progress_percent),
        locked: input.locked === true,
        is_active: true,
        updated_at: now,
      };

      if (previous) {
        if (changedAssignee) {
          row.acceptance_status = assignedTo ? "awaiting_response" : "accepted";
          row.response_note = null;
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
        persisted.push(data);
        if (changedAssignee && assignedTo) createdOrReassigned.push(data);
      } else {
        row.created_by = access.user.id;
        row.assigned_by = access.user.id;
        row.assigned_at = now;
        row.acceptance_status = assignedTo ? "awaiting_response" : "accepted";
        const { data, error } = await access.admin.from("project_activities").insert(row).select(COLUMNS).single();
        if (error) return Response.json({ error: error.message }, { status: 400 });
        persisted.push(data);
        if (assignedTo) createdOrReassigned.push(data);
      }
    }

    const linkedScheduleIds = [...new Set(persisted.map((activity) => activity.schedule_item_id).filter(validId))];
    for (const scheduleItemId of linkedScheduleIds) {
      const { data: scheduleActivities, error: scheduleActivitiesError } = await access.admin
        .from("project_activities")
        .select("status, progress_percent")
        .eq("schedule_item_id", scheduleItemId)
        .eq("is_active", true);
      if (scheduleActivitiesError) return Response.json({ error: scheduleActivitiesError.message }, { status: 400 });
      const linked = scheduleActivities || [];
      const progressPercent = linked.length ? Math.round((linked.reduce((sum, activity) => sum + percent(activity.progress_percent), 0) / linked.length) * 100) / 100 : 0;
      const states = new Set(linked.map((activity) => activity.status));
      const status = states.has("need_info") ? "need_info" : states.has("paused_other") ? "paused_other" : states.has("qa_review") ? "qa_review" : states.has("active") ? "active" : linked.length && [...states].every((value) => value === "completed") ? "completed" : "not_commenced";
      const { error: updateScheduleError } = await access.admin
        .from("project_schedule_items")
        .update({ progress_percent: progressPercent, status, updated_at: now })
        .eq("id", scheduleItemId);
      if (updateScheduleError) return Response.json({ error: updateScheduleError.message }, { status: 400 });
    }

    const eventWarning = await createAssignmentEvents(access.admin, project, createdOrReassigned);
    return Response.json({ success: true, count: persisted.length, activities: persisted, retired: retiredIds.length, notified: createdOrReassigned.length, event_warning: eventWarning || null });
  } catch (error) {
    return serverError(error);
  }
}
