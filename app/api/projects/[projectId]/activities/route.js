import { requireSession, serverError } from "../../../../../lib/serverAuth";

import { listDirectoryUsers } from "../../../../../lib/staffDirectory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const COLUMNS = "id, project_id, staff_user_id, task_category, title, detail, budget_hours, due_date, status, pause_reason, sort_order, updated_at";
const LEGACY_COLUMNS = "id, project_id, staff_user_id, task_category, title, detail, budget_hours, status, pause_reason, sort_order, updated_at";

function opt(value) {
  const text = typeof value === "string" ? value.trim() : "";
  return text || null;
}

function dueDate(value) {
  const date = opt(value);
  if (!date) return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null;
}

function missingDueDateColumn(error) {
  return error?.code === "42703" || /due_date/i.test(String(error?.message || ""));
}

function assignmentKey(activity) {
  return [activity.staff_user_id || "", String(activity.title || "").trim().toLowerCase(), activity.due_date || ""].join("|");
}

function formatDueDate(value) {
  if (!value) return "";
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? "" : ` · Due ${date.toLocaleDateString("en-AU", { day: "numeric", month: "short" })}`;
}

function num(value) {
  if (value === "" || value == null) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function withoutDueDate(row) {
  const { due_date, ...legacy } = row;
  return legacy;
}

async function getProject(access, projectId) {
  const { data, error } = await access.admin
    .from("projects")
    .select("id, name")
    .eq("id", projectId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data || null;
}

async function createAssignmentEvents(admin, project, activities) {
  const events = activities
    .filter((activity) => activity.staff_user_id)
    .map((activity) => ({
      recipient_id: activity.staff_user_id,
      event_type: "project_activity_assigned",
      severity: "action_required",
      title: "New project activity assigned",
      body: `${project.name}: ${activity.title}${formatDueDate(activity.due_date)}`,
      href: "/staff/projects",
      source_table: "project_activities",
      source_id: activity.id,
    }));

  if (!events.length) return null;
  const { error } = await admin.from("portal_events").insert(events);
  return error ? error.message : null;
}

// GET: Activities for a project. Administrators can inspect any project; staff
// receive only records permitted by the existing database policies.
export async function GET(request, { params }) {
  try {
    const access = await requireSession(request);
    if (access.error) return access.error;

    let calendarReady = true;
    let result = await access.admin
      .from("project_activities")
      .select(COLUMNS)
      .eq("project_id", params.projectId)
      .order("sort_order", { ascending: true });
    if (result.error && missingDueDateColumn(result.error)) {
      calendarReady = false;
      result = await access.admin
        .from("project_activities")
        .select(LEGACY_COLUMNS)
        .eq("project_id", params.projectId)
        .order("sort_order", { ascending: true });
    }
    if (result.error) return Response.json({ error: result.error.message }, { status: 400 });

    let rows = result.data || [];
    if (rows.length) {
      const { data: users } = await access.admin.auth.admin.listUsers();
      const emailById = new Map((users?.users || []).map((user) => [user.id, user.email]));
      rows = rows.map((row) => ({
        ...row,
        due_date: row.due_date || null,
        staff_email: row.staff_user_id ? emailById.get(row.staff_user_id) || null : null,
      }));
    }
    return Response.json({ activities: rows, calendarReady });
  } catch (error) {
    return serverError(error);
  }
}

// PUT: Administrators replace the activity plan for a project. New or reassigned
// staff activities create an in-portal workflow event immediately. Calendar
// entries are rendered only where an activity has the optional due date.
export async function PUT(request, { params }) {
  try {
    const access = await requireSession(request);
    if (access.error) return access.error;
    if (!access.isAdmin) return Response.json({ error: "Only administrators can manage activities." }, { status: 403 });

    const project = await getProject(access, params.projectId);
    if (!project) return Response.json({ error: "Project not found." }, { status: 404 });

    const body = await request.json();
    if (!Array.isArray(body.activities) || body.activities.length > 200) {
      return Response.json({ error: "Provide no more than 200 activities." }, { status: 400 });
    }

    let calendarReady = true;
    let existingResult = await access.admin
      .from("project_activities")
      .select("staff_user_id, title, due_date")
      .eq("project_id", params.projectId);
    if (existingResult.error && missingDueDateColumn(existingResult.error)) {
      calendarReady = false;
      existingResult = await access.admin
        .from("project_activities")
        .select("staff_user_id, title")
        .eq("project_id", params.projectId);
    }
    if (existingResult.error) return Response.json({ error: existingResult.error.message }, { status: 400 });

    const existingAssignments = new Set((existingResult.data || []).map((activity) => assignmentKey({ ...activity, due_date: activity.due_date || null })));
    const rows = body.activities
      .filter((activity) => activity && typeof activity.title === "string" && activity.title.trim())
      .map((activity, index) => ({
        project_id: params.projectId,
        staff_user_id: opt(activity.staffUserId),
        task_category: opt(activity.taskCategory),
        title: activity.title.trim(),
        detail: opt(activity.detail),
        budget_hours: num(activity.budgetHours),
        due_date: dueDate(activity.dueDate),
        status: activity.status || "not_commenced",
        pause_reason: opt(activity.pauseReason),
        sort_order: index + 1,
        created_by: access.user.id,
      }));

    const directory = await listDirectoryUsers(access.admin, { activeOnly: true });
    const availableIds = new Set(directory.map((person) => person.id));
    if (rows.some((row) => row.staff_user_id && !availableIds.has(row.staff_user_id))) {
      return Response.json({ error: "Project activities must be assigned to an available staff member from the Staff List." }, { status: 400 });
    }

    const { error: deleteError } = await access.admin.from("project_activities").delete().eq("project_id", params.projectId);
    if (deleteError) return Response.json({ error: deleteError.message }, { status: 400 });

    let created = [];
    if (rows.length) {
      const writeRows = calendarReady ? rows : rows.map(withoutDueDate);
      const columns = calendarReady ? COLUMNS : LEGACY_COLUMNS;
      const { data, error } = await access.admin.from("project_activities").insert(writeRows).select(columns);
      if (error) return Response.json({ error: error.message }, { status: 400 });
      created = (data || []).map((activity) => ({ ...activity, due_date: activity.due_date || null }));
    }

    const newlyAssigned = created.filter((activity) => activity.staff_user_id && !existingAssignments.has(assignmentKey(activity)));
    const eventWarning = await createAssignmentEvents(access.admin, project, newlyAssigned);

    return Response.json({
      success: true,
      count: created.length,
      notified: newlyAssigned.length,
      calendarReady,
      event_warning: eventWarning || null,
    });
  } catch (error) {
    return serverError(error);
  }
}
