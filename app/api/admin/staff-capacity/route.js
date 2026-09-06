import { requireSession, serverError } from "../../../../lib/serverAuth";
import { canAccessPortalResource, requirePortalResource } from "../../../../lib/portalVisibility";
import { listDirectoryUsers } from "../../../../lib/staffDirectory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DAY = 24 * 60 * 60 * 1000;

function dateOnly(value) {
  const text = String(value || "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : "";
}

function asDate(value) {
  const normalised = dateOnly(value);
  if (!normalised) return null;
  const parsed = new Date(`${normalised}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function addDays(value, days) {
  const next = asDate(value) || new Date();
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString().slice(0, 10);
}

function validRange(start, end) {
  const from = asDate(start);
  const to = asDate(end);
  return from && to && from <= to && to.getTime() - from.getTime() <= 366 * DAY;
}

function intersects(start, end, rangeStart, rangeEnd) {
  const from = asDate(start);
  const to = asDate(end || start);
  const min = asDate(rangeStart);
  const max = asDate(rangeEnd);
  return Boolean(from && to && min && max && from <= max && to >= min);
}

function workingDaysInRange(start, end, rangeStart, rangeEnd) {
  const from = new Date(Math.max(asDate(start)?.getTime() || Infinity, asDate(rangeStart)?.getTime() || -Infinity));
  const to = new Date(Math.min(asDate(end || start)?.getTime() || -Infinity, asDate(rangeEnd)?.getTime() || Infinity));
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from > to) return 0;
  let days = 0;
  for (let cursor = from; cursor <= to; cursor = new Date(cursor.getTime() + DAY)) {
    const weekday = cursor.getUTCDay();
    if (weekday !== 0 && weekday !== 6) days += 1;
  }
  return days;
}

// Work activities (especially fieldwork) can legitimately span or land on
// weekends, unlike leave, so their hours are prorated across every calendar
// day of their span rather than working days only.
function calendarDaysInRange(start, end, rangeStart, rangeEnd) {
  const from = new Date(Math.max(asDate(start)?.getTime() || Infinity, asDate(rangeStart)?.getTime() || -Infinity));
  const to = new Date(Math.min(asDate(end || start)?.getTime() || -Infinity, asDate(rangeEnd)?.getTime() || Infinity));
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from > to) return 0;
  return Math.round((to.getTime() - from.getTime()) / DAY) + 1;
}

// An activity's real working span: start_date if set, else it collapses to
// a single day on due_date. Activities with neither date can't be placed in
// any period and are excluded from period-based capacity (previously they
// wrongly counted their full budget in every single period forever).
function activitySpan(activity) {
  const due = dateOnly(activity.due_date);
  const start = dateOnly(activity.start_date) || due;
  if (!start && !due) return null;
  const effectiveStart = start || due;
  const effectiveEnd = due || start;
  return effectiveStart <= effectiveEnd
    ? { start: effectiveStart, end: effectiveEnd }
    : { start: effectiveEnd, end: effectiveStart };
}

// Task Briefs (remote_tasks) have no start_date column — the work is
// understood to run from the moment the staff member accepted it through to
// the due date, so that's the span used both for calendar placement and
// hour-proration, matching the same shape as activitySpan.
function taskSpan(task) {
  const due = dateOnly(task.due_date);
  const start = dateOnly(task.accepted_at) || due;
  if (!start && !due) return null;
  const effectiveStart = start || due;
  const effectiveEnd = due || start;
  return effectiveStart <= effectiveEnd
    ? { start: effectiveStart, end: effectiveEnd }
    : { start: effectiveEnd, end: effectiveStart };
}

function number(value) {
  const result = Number(value);
  return Number.isFinite(result) && result >= 0 ? result : 0;
}

function capacityStatus(percent, onLeave) {
  if (onLeave) return "on_leave";
  if (percent > 100) return "over_capacity";
  if (percent >= 96) return "full";
  if (percent >= 81) return "near_capacity";
  return "available";
}

function unavailable(error) {
  const code = String(error?.code || "");
  const message = String(error?.message || "").toLowerCase();
  return code === "42P01" || code === "42703" || code === "PGRST205" || message.includes("does not exist") || message.includes("schema cache");
}

export async function capacityData(access, rangeStart, rangeEnd) {
  const [directory, profilesResult, activitiesResult, leavesResult, scheduleResult, projectsResult, tasksResult] = await Promise.all([
    listDirectoryUsers(access.admin, { activeOnly: true }),
    access.admin.from("staff_capacity_profiles").select("user_id, weekly_capacity_hours, notes, updated_at"),
    access.admin.from("project_activities").select("id, project_id, staff_user_id, task_category, title, budget_hours, due_date, start_date, status, acceptance_status, progress_percent, schedule_item_id, is_active").eq("is_active", true),
    access.admin.from("service_requests").select("id, created_by, details, title, reviewed_at").eq("request_type", "leave").eq("status", "approved"),
    access.admin.from("project_schedule_items").select("id, project_id, title, start_date, end_date, milestone, progress_percent, status, is_active").eq("is_active", true),
    access.admin.from("projects").select("id, name, client_name, status").neq("status", "archived"),
    access.admin.from("remote_tasks").select("id, assigned_to, project, task, due_date, budget_hours, status, accepted_at, completed_at, declined_at, withdrawn_at").not("accepted_at", "is", null).is("completed_at", null).is("declined_at", null).is("withdrawn_at", null),
  ]);

  const failures = [profilesResult, activitiesResult, scheduleResult].find((result) => result.error);
  if (failures?.error) {
    if (unavailable(failures.error)) return { ready: false, message: "The Staff Capacity Planner is awaiting its approved database migration." };
    throw new Error(failures.error.message);
  }
  if (leavesResult.error) throw new Error(leavesResult.error.message);
  if (projectsResult.error) throw new Error(projectsResult.error.message);

  const projectById = new Map((projectsResult.data || []).map((project) => [project.id, project]));
  const profileByUser = new Map((profilesResult.data || []).map((profile) => [profile.user_id, profile]));
  const activities = (activitiesResult.data || []).filter((activity) => activity.staff_user_id && activity.acceptance_status !== "declined");
  const tasks = (tasksResult.error ? [] : (tasksResult.data || [])).filter((task) => task.assigned_to);
  const leaves = (leavesResult.data || []).map((record) => ({
    ...record,
    startDate: dateOnly(record.details?.start_date),
    endDate: dateOnly(record.details?.end_date || record.details?.start_date),
  })).filter((record) => record.startDate && record.endDate && intersects(record.startDate, record.endDate, rangeStart, rangeEnd));
  const today = new Date().toISOString().slice(0, 10);
  const rangeDays = Math.max(1, Math.ceil(((asDate(rangeEnd)?.getTime() || 0) - (asDate(rangeStart)?.getTime() || 0) + DAY) / DAY));
  const rangeWeeks = Math.max(1, rangeDays / 7);

  const people = directory.map((person) => {
    const profile = profileByUser.get(person.id);
    const weeklyCapacityHours = number(profile?.weekly_capacity_hours) || 38;
    const staffActivities = activities.filter((activity) => activity.staff_user_id === person.id);
    // Each activity's budgeted hours are prorated across the calendar days of
    // its real span (start_date → due_date) and only the portion that falls
    // inside the period being viewed is counted — a multi-week task no
    // longer dumps its entire budget onto whichever week contains its due
    // date, and a task with no dates at all contributes nothing until it is
    // scheduled.
    const allocatedHours = staffActivities.reduce((sum, activity) => {
      const span = activitySpan(activity);
      if (!span || !intersects(span.start, span.end, rangeStart, rangeEnd)) return sum;
      const totalDays = calendarDaysInRange(span.start, span.end, span.start, span.end) || 1;
      const overlapDays = calendarDaysInRange(span.start, span.end, rangeStart, rangeEnd);
      return sum + number(activity.budget_hours) * (overlapDays / totalDays);
    }, 0);
    const staffTasks = tasks.filter((task) => task.assigned_to === person.id);
    // Accepted Task Briefs consume capacity exactly like project activities —
    // same proration, same span logic — so a staff member's workload total
    // reflects both delivery routes, not just formally allocated activities.
    const taskHours = staffTasks.reduce((sum, task) => {
      const span = taskSpan(task);
      if (!span || !intersects(span.start, span.end, rangeStart, rangeEnd)) return sum;
      const totalDays = calendarDaysInRange(span.start, span.end, span.start, span.end) || 1;
      const overlapDays = calendarDaysInRange(span.start, span.end, rangeStart, rangeEnd);
      return sum + number(task.budget_hours) * (overlapDays / totalDays);
    }, 0);
    const combinedAllocatedHours = allocatedHours + taskHours;
    const personLeaves = leaves.filter((leave) => leave.created_by === person.id);
    const leaveDays = personLeaves.reduce((sum, leave) => sum + workingDaysInRange(leave.startDate, leave.endDate, rangeStart, rangeEnd), 0);
    const leaveHours = leaveDays * (weeklyCapacityHours / 5);
    const totalCapacityHours = Math.round(weeklyCapacityHours * rangeWeeks * 100) / 100;
    const capacityPercent = totalCapacityHours ? Math.round(((combinedAllocatedHours + leaveHours) / totalCapacityHours) * 100) : 0;
    const activeProjectIds = [...new Set(staffActivities.map((activity) => activity.project_id).filter(Boolean))];
    const upcomingActivities = staffActivities.filter((activity) => activity.due_date && activity.due_date >= today && activity.due_date <= rangeEnd && activity.status !== "completed");
    const upcomingTasks = staffTasks.filter((task) => task.due_date && task.due_date >= today && task.due_date <= rangeEnd);
    const onLeave = personLeaves.some((leave) => intersects(leave.startDate, leave.endDate, today, today));
    return {
      ...person,
      weeklyCapacityHours,
      capacityPercent,
      allocatedHours: Math.round(combinedAllocatedHours * 100) / 100,
      leaveDays,
      leaveHours: Math.round(leaveHours * 100) / 100,
      availableHours: Math.round(Math.max(0, totalCapacityHours - combinedAllocatedHours - leaveHours) * 100) / 100,
      activeProjectCount: activeProjectIds.length,
      upcomingDueCount: upcomingActivities.length + upcomingTasks.length,
      status: capacityStatus(capacityPercent, onLeave),
      onLeave,
      notes: profile?.notes || "",
      projects: activeProjectIds.map((id) => projectById.get(id)).filter(Boolean).map((project) => ({ id: project.id, name: project.name, clientName: project.client_name || "" })),
      upcomingActivities: upcomingActivities.map((activity) => ({ id: activity.id, title: activity.title, dueDate: activity.due_date, projectName: projectById.get(activity.project_id)?.name || "Project", taskCategory: activity.task_category || "" })),
      upcomingTasks: upcomingTasks.map((task) => ({ id: task.id, title: task.task, dueDate: task.due_date, projectName: task.project || "Task Brief" })),
      leave: personLeaves.map((leave) => ({ id: leave.id, title: leave.title, startDate: leave.startDate, endDate: leave.endDate })),
    };
  });

  const calendarEvents = [
    ...activities.filter((activity) => {
      const span = activitySpan(activity);
      return span && intersects(span.start, span.end, rangeStart, rangeEnd);
    }).map((activity) => {
      const span = activitySpan(activity);
      return {
        id: `activity-${activity.id}`,
        type: activity.task_category === "Fieldwork & travel" ? "field_survey" : "activity",
        startDate: span.start,
        endDate: span.end,
        title: activity.title,
        staffUserId: activity.staff_user_id,
        projectName: projectById.get(activity.project_id)?.name || "Project",
        status: activity.status,
      };
    }),
    ...leaves.map((leave) => ({ id: `leave-${leave.id}`, type: "leave", startDate: leave.startDate, endDate: leave.endDate, title: leave.title, staffUserId: leave.created_by })),
    ...tasks.filter((task) => {
      const span = taskSpan(task);
      return span && intersects(span.start, span.end, rangeStart, rangeEnd);
    }).map((task) => {
      const span = taskSpan(task);
      return {
        id: `task-${task.id}`,
        type: "task_brief",
        startDate: span.start,
        endDate: span.end,
        title: task.task,
        staffUserId: task.assigned_to,
        projectName: task.project || "Task Brief",
        status: task.status,
      };
    }),
    ...(scheduleResult.data || []).filter((item) => intersects(item.start_date || item.end_date, item.end_date || item.start_date, rangeStart, rangeEnd)).map((item) => ({
      id: `schedule-${item.id}`,
      type: item.milestone ? "milestone" : "schedule",
      startDate: item.start_date || item.end_date,
      endDate: item.end_date || item.start_date,
      title: item.title,
      projectName: projectById.get(item.project_id)?.name || "Project",
      progressPercent: number(item.progress_percent),
      status: item.status,
    })),
  ];

  return { ready: true, rangeStart, rangeEnd, people, calendarEvents };
}

export async function GET(request) {
  try {
    const access = await requireSession(request);
    if (access.error) return access.error;
    const denied = await requirePortalResource(access, "admin.staff_capacity");
    if (denied) return denied;
    const { searchParams } = new URL(request.url);
    const requestedStart = dateOnly(searchParams.get("start"));
    const requestedEnd = dateOnly(searchParams.get("end"));
    const rangeStart = requestedStart || new Date().toISOString().slice(0, 10);
    const rangeEnd = requestedEnd || addDays(rangeStart, 27);
    if (!validRange(rangeStart, rangeEnd)) return Response.json({ error: "Choose a valid period of up to 12 months." }, { status: 400 });
    const [data, canEdit] = await Promise.all([
      capacityData(access, rangeStart, rangeEnd),
      canAccessPortalResource(access, "admin.staff_capacity.edit"),
    ]);
    return Response.json({ ...data, canEdit });
  } catch (error) {
    return serverError(error);
  }
}

export async function POST(request) {
  try {
    const access = await requireSession(request);
    if (access.error) return access.error;
    const denied = await requirePortalResource(access, "admin.staff_capacity.edit");
    if (denied) return denied;
    const body = await request.json();
    const userId = String(body?.userId || "");
    const weeklyCapacityHours = Number(body?.weeklyCapacityHours);
    const notes = typeof body?.notes === "string" ? body.notes.trim().slice(0, 2000) : "";
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(userId)) return Response.json({ error: "Choose a valid staff member." }, { status: 400 });
    if (!Number.isFinite(weeklyCapacityHours) || weeklyCapacityHours < 0 || weeklyCapacityHours > 168) return Response.json({ error: "Weekly capacity must be between 0 and 168 hours." }, { status: 400 });
    const directory = await listDirectoryUsers(access.admin, { activeOnly: true });
    if (!directory.some((person) => person.id === userId)) return Response.json({ error: "Choose an available staff member from the Staff List." }, { status: 400 });
    const now = new Date().toISOString();
    const { data, error } = await access.admin.from("staff_capacity_profiles").upsert({ user_id: userId, weekly_capacity_hours: weeklyCapacityHours, notes: notes || null, updated_by: access.user.id, updated_at: now }, { onConflict: "user_id" }).select("user_id, weekly_capacity_hours, notes, updated_at").single();
    if (error) return Response.json({ error: error.message }, { status: 400 });
    return Response.json({ profile: data });
  } catch (error) {
    return serverError(error);
  }
}

