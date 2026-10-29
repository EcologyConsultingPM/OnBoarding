import { requireSession, serverError } from "../../../../../../lib/serverAuth";
import { listDirectoryUsers } from "../../../../../../lib/staffDirectory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ASSIGNMENT_COLUMNS = "id, activity_id, staff_user_id, allocated_hours, role, acceptance_status, response_note, assigned_at, accepted_at, declined_at, actioned_at, assigned_by, notified_at, removed_at, created_at, updated_at";

function validId(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ""));
}
function text(value, maximum = 5000) {
  return typeof value === "string" ? value.trim().slice(0, maximum) : undefined;
}
function dueDate(value) {
  const clean = String(value || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(clean) ? clean : null;
}
function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
const ACTIVITY_STATUSES = new Set(["not_commenced", "active", "need_info", "paused_other", "qa_review", "completed"]);
function formatDueDate(value) {
  if (!value) return "";
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? "" : ` · Due ${date.toLocaleDateString("en-AU", { day: "numeric", month: "short" })}`;
}
function isAssignmentSchemaError(error) {
  const code = String(error?.code || "");
  const message = String(error?.message || "").toLowerCase();
  return code === "42P01" || code === "PGRST205" || code === "PGRST200"
    || message.includes("project_activity_assignees")
    || message.includes("schema cache")
    || message.includes("does not exist");
}
function activeAssignees(rows) {
  return (rows || []).filter((row) => row.acceptance_status !== "removed");
}
function assignmentView(row, email = null) {
  return {
    id: row.id,
    staffUserId: row.staff_user_id,
    staff_user_id: row.staff_user_id,
    email,
    allocatedHours: Number(row.allocated_hours || 0),
    allocated_hours: Number(row.allocated_hours || 0),
    role: row.role || "contributor",
    acceptanceStatus: row.acceptance_status,
    acceptance_status: row.acceptance_status,
    responseStatus: row.acceptance_status,
    responseNote: row.response_note || "",
    response_note: row.response_note || null,
    assignedAt: row.assigned_at || null,
    acceptedAt: row.accepted_at || null,
    declinedAt: row.declined_at || null,
    actionedAt: row.actioned_at || null,
    assignedBy: row.assigned_by || null,
    notifiedAt: row.notified_at || null,
  };
}
function hasArrayAssigneeInput(body) {
  return Object.hasOwn(body || {}, "assignees") || Object.hasOwn(body || {}, "staffUserIds");
}
function normaliseAssignees(body, budgetHours, fallback) {
  let raw;
  let scalarMode = false;
  if (Object.hasOwn(body || {}, "assignees")) {
    if (!Array.isArray(body.assignees)) return { error: "assignees must be an array." };
    raw = body.assignees;
  } else if (Object.hasOwn(body || {}, "staffUserIds")) {
    if (!Array.isArray(body.staffUserIds)) return { error: "staffUserIds must be an array." };
    raw = body.staffUserIds;
  } else if (Object.hasOwn(body || {}, "staffUserId")) {
    raw = body.staffUserId ? [{ staffUserId: body.staffUserId, allocatedHours: body.allocatedHours, role: body.role }] : [];
    scalarMode = true;
  } else return { assignees: fallback, supplied: false };

  const ids = new Set();
  const assignees = [];
  for (const candidate of raw) {
    const source = typeof candidate === "string" ? { staffUserId: candidate } : (candidate || {});
    const staffUserId = String(source.staffUserId ?? source.staff_user_id ?? source.id ?? "").trim();
    if (!staffUserId) continue;
    if (!validId(staffUserId)) return { error: "Choose valid staff members." };
    if (ids.has(staffUserId)) continue;
    const suppliedHours = source.allocatedHours ?? source.allocated_hours;
    const allocatedHours = suppliedHours === undefined || suppliedHours === null || suppliedHours === ""
      ? (scalarMode ? Number(budgetHours || 0) : 0)
      : Number(suppliedHours);
    if (!Number.isFinite(allocatedHours) || allocatedHours < 0) return { error: "Allocated hours must be a nonnegative number." };
    ids.add(staffUserId);
    assignees.push({ staffUserId, allocatedHours, role: text(source.role, 100) || "contributor" });
  }
  return { assignees, supplied: true, scalarMode };
}

async function allocationIds(admin, projectId) {
  let result = await admin.from("project_allocations").select("staff_user_id").eq("project_id", projectId).neq("active", false);
  if (result.error && (String(result.error.code || "") === "42703" || /active/i.test(String(result.error.message || "")))) result = await admin.from("project_allocations").select("staff_user_id").eq("project_id", projectId);
  if (result.error) throw new Error(result.error.message);
  return new Set((result.data || []).map((row) => row.staff_user_id).filter(Boolean));
}

async function dismissRemovedEvent(admin, activityId, staffUserId, now) {
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

async function syncAssignments(admin, activityId, requested, existingRows, actorId, now) {
  const byStaff = new Map((existingRows || []).map((row) => [row.staff_user_id, row]));
  const requestedByStaff = new Map((requested || []).map((row) => [row.staffUserId, row]));
  const additions = [];
  for (const next of requested || []) {
    const previous = byStaff.get(next.staffUserId);
    if (!previous) {
      const { data, error } = await admin.from("project_activity_assignees").insert({ activity_id: activityId, staff_user_id: next.staffUserId, allocated_hours: next.allocatedHours, role: next.role, acceptance_status: "awaiting_response", assigned_at: now, assigned_by: actorId, created_at: now, updated_at: now }).select(ASSIGNMENT_COLUMNS).single();
      if (error) throw new Error(error.message);
      additions.push(data);
    } else if (previous.acceptance_status === "removed") {
      const { data, error } = await admin.from("project_activity_assignees").update({ allocated_hours: next.allocatedHours, role: next.role, acceptance_status: "awaiting_response", response_note: null, assigned_at: now, accepted_at: null, declined_at: null, actioned_at: null, assigned_by: actorId, notified_at: null, removed_at: null, updated_at: now }).eq("id", previous.id).select(ASSIGNMENT_COLUMNS).single();
      if (error) throw new Error(error.message);
      additions.push(data);
    } else if (Number(previous.allocated_hours || 0) !== next.allocatedHours || previous.role !== next.role) {
      const { error } = await admin.from("project_activity_assignees").update({ allocated_hours: next.allocatedHours, role: next.role, updated_at: now }).eq("id", previous.id);
      if (error) throw new Error(error.message);
    }
  }
  for (const previous of activeAssignees(existingRows)) {
    if (requestedByStaff.has(previous.staff_user_id)) continue;
    if (!previous.accepted_at && !previous.declined_at && !previous.actioned_at) {
      const { error } = await admin.from("project_activity_assignees").delete().eq("id", previous.id);
      if (error) throw new Error(error.message);
    } else {
      const { error } = await admin.from("project_activity_assignees").update({ acceptance_status: "removed", removed_at: now, updated_at: now }).eq("id", previous.id);
      if (error) throw new Error(error.message);
    }
    await dismissRemovedEvent(admin, activityId, previous.staff_user_id, now);
  }
  return additions;
}

async function hydrateAssignees(admin, rows) {
  const active = activeAssignees(rows);
  const { data: users } = active.length ? await admin.auth.admin.listUsers({ page: 1, perPage: 200 }) : { data: { users: [] } };
  const emailById = new Map((users?.users || []).map((user) => [user.id, user.email]));
  return active.map((row) => assignmentView(row, emailById.get(row.staff_user_id) || null));
}

// Quick single-activity edit — built specifically for the Staff Capacity
// Planner's "unassigned calendar item" workflow. A scalar staffUserId remains
// a compatibility replacement for that client; new clients send assignees or
// staffUserIds so a shared team is never collapsed to one recipient.
export async function PATCH(request, { params }) {
  try {
    const access = await requireSession(request);
    if (access.error) return access.error;
    if (!access.isAdmin) return Response.json({ error: "Only administrators can manage activities." }, { status: 403 });
    const { projectId, activityId } = params;
    if (!validId(projectId) || !validId(activityId)) return Response.json({ error: "A valid project and activity id are required." }, { status: 400 });

    const { data: current, error: currentError } = await access.admin.from("project_activities")
      .select("id, project_id, staff_user_id, title, task_category, detail, budget_hours, due_date, start_date, milestone, status, progress_percent, acceptance_status, response_note, assigned_at, accepted_at, declined_at, actioned_at, assigned_by, notified_at, schedule_item_id, sort_order, is_active")
      .eq("id", activityId).eq("project_id", projectId).maybeSingle();
    if (currentError) return Response.json({ error: currentError.message }, { status: 400 });
    if (!current || !current.is_active) return Response.json({ error: "Activity not found." }, { status: 404 });

    const body = await request.json();
    const now = new Date().toISOString();
    const patch = { updated_at: now };
    if (body?.title !== undefined) {
      const title = text(body.title, 500);
      if (!title) return Response.json({ error: "A title is required." }, { status: 400 });
      patch.title = title;
    }
    if (body?.taskCategory !== undefined) patch.task_category = text(body.taskCategory, 200) || null;
    if (body?.detail !== undefined) patch.detail = text(body.detail, 5000) || null;
    if (body?.budgetHours !== undefined) {
      const hours = number(body.budgetHours);
      if (hours == null || hours < 0) return Response.json({ error: "Budget hours must be a nonnegative number." }, { status: 400 });
      patch.budget_hours = hours;
    }
    if (body?.startDate !== undefined) patch.start_date = dueDate(body.startDate);
    if (body?.dueDate !== undefined) patch.due_date = dueDate(body.dueDate);
    if (body?.milestone !== undefined) patch.milestone = body.milestone === true;
    if (body?.status !== undefined) {
      const status = String(body.status || "");
      if (!ACTIVITY_STATUSES.has(status)) return Response.json({ error: "Choose a valid delivery status." }, { status: 400 });
      patch.status = status;
      if (status === "completed") {
        patch.progress_percent = 100;
        patch.completed_at = now;
      }
    }
    if (body?.progressPercent !== undefined && patch.status !== "completed") {
      const progress = number(body.progressPercent);
      if (progress == null || progress < 0 || progress > 100) return Response.json({ error: "Progress must be between 0 and 100." }, { status: 400 });
      patch.progress_percent = Math.round(progress * 100) / 100;
    }

    let assignmentRows = [];
    let assignmentSchemaAvailable = true;
    const assignmentResult = await access.admin.from("project_activity_assignees").select(ASSIGNMENT_COLUMNS).eq("activity_id", activityId);
    if (assignmentResult.error) {
      if (!isAssignmentSchemaError(assignmentResult.error)) return Response.json({ error: assignmentResult.error.message }, { status: 400 });
      assignmentSchemaAvailable = false;
    } else assignmentRows = assignmentResult.data || [];

    const priorAssignees = assignmentSchemaAvailable
      ? activeAssignees(assignmentRows).map((row) => ({ staffUserId: row.staff_user_id, allocatedHours: Number(row.allocated_hours || 0), role: row.role }))
      : (current.staff_user_id ? [{ staffUserId: current.staff_user_id, allocatedHours: Number(current.budget_hours || 0) }] : []);
    const effectiveBudget = patch.budget_hours ?? Number(current.budget_hours || 0);
    const requested = normaliseAssignees(body, effectiveBudget, priorAssignees);
    if (requested.error) return Response.json({ error: requested.error }, { status: 400 });
    const suppliedTeam = requested.supplied;

    if (suppliedTeam) {
      const [directory, projectAllocationIds] = await Promise.all([listDirectoryUsers(access.admin, { activeOnly: true }), allocationIds(access.admin, projectId)]);
      const availableIds = new Set(directory.map((person) => person.id));
      if (requested.assignees.some((assignee) => !availableIds.has(assignee.staffUserId) || !projectAllocationIds.has(assignee.staffUserId))) return Response.json({ error: "Activity assignees must be active staff allocated to this project." }, { status: 400 });
    }
    const totalAllocated = requested.assignees.reduce((sum, assignee) => sum + assignee.allocatedHours, 0);
    if (totalAllocated > effectiveBudget) return Response.json({ error: "Total allocated staff hours cannot exceed this activity's budget hours." }, { status: 400 });

    // Keep scalar identity for old clients. In joined mode it is a projection
    // only: it never controls recipient response state or notification flags.
    const primaryAssignee = requested.assignees.find((assignee) => assignee.staffUserId === current.staff_user_id)?.staffUserId || requested.assignees[0]?.staffUserId || null;
    if (assignmentSchemaAvailable && suppliedTeam) patch.staff_user_id = primaryAssignee;
    if (!assignmentSchemaAvailable && suppliedTeam) {
      if (requested.assignees.length > 1) return Response.json({ error: "Multi-staff assignments are awaiting the project activity assignees migration.", migration_pending: true }, { status: 409 });
      const staffUserId = requested.assignees[0]?.staffUserId || null;
      patch.staff_user_id = staffUserId;
      if (staffUserId !== current.staff_user_id) {
        patch.acceptance_status = staffUserId ? "awaiting_response" : "accepted";
        patch.response_note = null;
        patch.notified_at = null;
        patch.assigned_at = now;
        patch.accepted_at = null;
        patch.declined_at = null;
        patch.actioned_at = null;
        patch.assigned_by = access.user.id;
      }
    }

    let { data: updated, error: updateError } = await access.admin.from("project_activities").update(patch).eq("id", activityId).select("id, project_id, staff_user_id, task_category, title, detail, budget_hours, due_date, start_date, milestone, status, progress_percent, acceptance_status, response_note, assigned_at, accepted_at, declined_at, actioned_at, assigned_by, notified_at, schedule_item_id, sort_order").single();
    if (updateError) return Response.json({ error: updateError.message }, { status: 400 });

    let additions = [];
    if (assignmentSchemaAvailable && suppliedTeam) additions = await syncAssignments(access.admin, updated.id, requested.assignees, assignmentRows, access.user.id, now);

    const affectsSchedule = body?.startDate !== undefined || body?.dueDate !== undefined || body?.title !== undefined || body?.detail !== undefined || body?.milestone !== undefined || body?.status !== undefined || body?.progressPercent !== undefined;
    if (affectsSchedule && !updated.schedule_item_id && (updated.start_date || updated.due_date)) {
      const { data: generatedSchedule, error: generatedScheduleError } = await access.admin.from("project_schedule_items").insert({ project_id: projectId, sort_order: updated.sort_order || 0, title: updated.title, detail: updated.detail, start_date: updated.start_date || updated.due_date, end_date: updated.due_date || updated.start_date, milestone: updated.milestone === true, status: updated.status, progress_percent: updated.progress_percent, generated_from_activity_id: updated.id, is_active: true, updated_at: now }).select("id").single();
      if (generatedScheduleError) return Response.json({ error: generatedScheduleError.message }, { status: 400 });
      const { error: linkError } = await access.admin.from("project_activities").update({ schedule_item_id: generatedSchedule.id, updated_at: now }).eq("id", updated.id);
      if (linkError) return Response.json({ error: linkError.message }, { status: 400 });
      updated = { ...updated, schedule_item_id: generatedSchedule.id };
    }
    if (updated.schedule_item_id && affectsSchedule) {
      const { data: linkedSchedule, error: scheduleLookupError } = await access.admin.from("project_schedule_items").select("id, generated_from_activity_id").eq("id", updated.schedule_item_id).maybeSingle();
      if (scheduleLookupError) return Response.json({ error: scheduleLookupError.message }, { status: 400 });
      const { data: linkedActivities, error: linkedActivitiesError } = await access.admin.from("project_activities").select("id").eq("schedule_item_id", updated.schedule_item_id).eq("is_active", true);
      if (linkedActivitiesError) return Response.json({ error: linkedActivitiesError.message }, { status: 400 });
      const activityOwnsSchedule = linkedSchedule?.generated_from_activity_id === updated.id || (!linkedSchedule?.generated_from_activity_id && (linkedActivities || []).length === 1 && linkedActivities[0]?.id === updated.id);
      if (activityOwnsSchedule) {
        const { error: scheduleUpdateError } = await access.admin.from("project_schedule_items").update({ generated_from_activity_id: updated.id, title: updated.title, detail: updated.detail, start_date: updated.start_date || updated.due_date, end_date: updated.due_date || updated.start_date, milestone: updated.milestone === true, status: updated.status, progress_percent: updated.progress_percent, updated_at: now }).eq("id", updated.schedule_item_id);
        if (scheduleUpdateError) return Response.json({ error: scheduleUpdateError.message }, { status: 400 });
      }
    }

    let notifyWarning = null;
    if (assignmentSchemaAvailable && additions.length) {
      const { data: project } = await access.admin.from("projects").select("name").eq("id", projectId).maybeSingle();
      const { error: notifyError } = await access.admin.from("portal_events").insert(additions.map((assignment) => ({ recipient_id: assignment.staff_user_id, event_type: "project_activity_assigned", severity: "action_required", title: `Work assignment: ${updated.title}`, body: `${project?.name || "A project"}${updated.task_category ? ` · ${updated.task_category}` : ""}${updated.budget_hours != null ? ` · ${updated.budget_hours} budgeted hours` : ""}${formatDueDate(updated.due_date)}`, href: "/staff/notifications", source_table: "project_activities", source_id: updated.id })));
      if (notifyError) notifyWarning = notifyError.message;
      else {
        const { error: markError } = await access.admin.from("project_activity_assignees").update({ notified_at: now, updated_at: now }).in("id", additions.map((assignment) => assignment.id));
        if (markError) notifyWarning = markError.message;
      }
    } else if (!assignmentSchemaAvailable && suppliedTeam && patch.staff_user_id && patch.staff_user_id !== current.staff_user_id) {
      const { data: project } = await access.admin.from("projects").select("name").eq("id", projectId).maybeSingle();
      const { error: notifyError } = await access.admin.from("portal_events").insert({ recipient_id: patch.staff_user_id, event_type: "project_activity_assigned", severity: "action_required", title: `Work assignment: ${updated.title}`, body: `${project?.name || "A project"}${updated.task_category ? ` · ${updated.task_category}` : ""}${updated.budget_hours != null ? ` · ${updated.budget_hours} budgeted hours` : ""}${formatDueDate(updated.due_date)}`, href: "/staff/notifications", source_table: "project_activities", source_id: updated.id });
      if (notifyError) notifyWarning = notifyError.message;
      else await access.admin.from("project_activities").update({ notified_at: now }).eq("id", updated.id);
    }

    let assignees = [];
    if (assignmentSchemaAvailable) {
      const { data: finalRows, error: finalError } = await access.admin.from("project_activity_assignees").select(ASSIGNMENT_COLUMNS).eq("activity_id", updated.id);
      if (!finalError) assignees = await hydrateAssignees(access.admin, finalRows || []);
    }
    if (!assignmentSchemaAvailable && updated.staff_user_id) assignees = [{ staffUserId: updated.staff_user_id, staff_user_id: updated.staff_user_id, email: null, allocatedHours: Number(updated.budget_hours || 0), allocated_hours: Number(updated.budget_hours || 0), role: "contributor", acceptanceStatus: updated.acceptance_status, acceptance_status: updated.acceptance_status, responseStatus: updated.acceptance_status, responseNote: updated.response_note || "", response_note: updated.response_note || null, assignedAt: updated.assigned_at || null, acceptedAt: updated.accepted_at || null, declinedAt: updated.declined_at || null, actionedAt: updated.actioned_at || null, assignedBy: updated.assigned_by || null, notifiedAt: updated.notified_at || null }];
    return Response.json({ activity: { ...updated, staffUserId: updated.staff_user_id || null, assignees }, notify_warning: notifyWarning, multiAssigneeReady: assignmentSchemaAvailable });
  } catch (error) {
    return serverError(error);
  }
}
