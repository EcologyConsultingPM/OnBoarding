import { requireSession, serverError } from "../../../../../lib/serverAuth";
import { listDirectoryUsers } from "../../../../../lib/staffDirectory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const COLUMNS = "id, project_id, staff_user_id, task_category, title, detail, budget_hours, due_date, start_date, milestone, status, pause_reason, sort_order, updated_at, created_at, schedule_item_id, acceptance_status, response_note, assigned_at, accepted_at, declined_at, actioned_at, started_at, completed_at, assigned_by, progress_percent, locked, is_active, deliverable_id";
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
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ""));
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

// Content signature used to recognise "this is actually the same activity
// I already saved" across SEPARATE save requests, not just within one. The
// previous version of this route only deduped rows within a single PUT
// payload (a Set scoped to that one request) — it had no defence at all
// against a "new" row (no real id) being re-submitted in a later, separate
// save, which silently created a fresh duplicate activity AND a fresh
// duplicate Gantt/schedule line every single time. This is what was
// producing the same activity title appearing dozens of times.
function contentSignature(row) {
  return [
    (row.staff_user_id ?? row.staffUserId) || "",
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
    (row.staff_user_id ?? row.staffUserId) || "",
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

// This emitter is used only after the original approval gate has been passed:
// later activity creation/reassignment must notify the new assignee without
// asking administrators to approve the already-active project again.
async function createAssignmentEvents(admin, project, activities) {
  const events = activities
    .filter((activity) => activity.staff_user_id)
    .map((activity) => ({
      recipient_id: activity.staff_user_id,
      event_type: "project_activity_assigned",
      severity: "action_required",
      title: `Work assignment: ${activity.title}`,
      body: `${project.name}${activity.task_category ? ` · ${activity.task_category}` : ""}${activity.budget_hours != null ? ` · ${activity.budget_hours} budgeted hours` : ""}${formatDueDate(activity.due_date)}`,
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
    if (!access.isAdmin || staffWorkspace) rows = rows.filter((row) => row.staff_user_id === access.user.id && ["accepted", "actioned"].includes(row.acceptance_status || "accepted"));
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
    const activeActivityCountByScheduleId = new Map();
    for (const activity of existingResult.data || []) {
      if (!validId(activity.schedule_item_id)) continue;
      activeActivityCountByScheduleId.set(
        activity.schedule_item_id,
        (activeActivityCountByScheduleId.get(activity.schedule_item_id) || 0) + 1,
      );
    }
    const existingBySignature = new Map();
    const existingByPlanIdentity = new Map();
    for (const activity of existingResult.data || []) {
      const sig = contentSignature(activity);
      if (!existingBySignature.has(sig)) existingBySignature.set(sig, activity);
      const stablePlanSig = planIdentity(activity);
      if (!existingByPlanIdentity.has(stablePlanSig)) existingByPlanIdentity.set(stablePlanSig, activity);
    }

    const [directory, deliverablesResult] = await Promise.all([
      listDirectoryUsers(access.admin, { activeOnly: true }),
      access.admin.from("project_deliverables").select("id").eq("project_id", params.projectId).eq("is_active", true),
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
            opt(normalised.staffUserId) || "",
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
    if (inputRows.some((row) => row.staffUserId && !availableIds.has(row.staffUserId))) return Response.json({ error: "Project activities must be assigned to an available staff member from the Staff List." }, { status: 400 });
    if (inputRows.some((row) => row.deliverableId && (!validId(row.deliverableId) || !availableDeliverableIds.has(row.deliverableId)))) return Response.json({ error: "Choose an active deliverable from this project for each linked work activity." }, { status: 400 });

    // Concurrency check: if a client's copy of an activity is stale — someone
    // else saved a change to it since this client loaded the page — reject
    // the whole save rather than silently overwriting their change. This
    // previously had no check at all: two admins editing the same project's
    // activities at once meant the second save always won with no warning.
    const conflicts = [];
    for (const input of inputRows) {
      if (!validId(input.id)) continue;
      const previous = existingById.get(input.id);
      if (previous && input.loadedUpdatedAt && previous.updated_at && new Date(previous.updated_at).getTime() !== new Date(input.loadedUpdatedAt).getTime()) {
        conflicts.push({ id: input.id, title: previous.title });
      }
    }
    if (conflicts.length) {
      return Response.json({
        error: `${conflicts.length} activit${conflicts.length === 1 ? "y was" : "ies were"} changed by someone else since you loaded this page. Reload to see the current version before saving.`,
        conflicts,
      }, { status: 409 });
    }

    const scheduleResult = await access.admin.from("project_schedule_items").select("id, generated_from_activity_id").eq("project_id", params.projectId).eq("is_active", true);
    if (scheduleResult.error) return Response.json({ error: scheduleResult.error.message }, { status: 400 });
    const scheduleIds = new Set((scheduleResult.data || []).map((item) => item.id));
    const generatedScheduleByActivityId = new Map(
      (scheduleResult.data || [])
        .filter((item) => validId(item.generated_from_activity_id))
        .map((item) => [item.generated_from_activity_id, item.id]),
    );
    const invalidScheduleSelection = inputRows.find((row) => {
      if (!row.scheduleItemId || scheduleIds.has(row.scheduleItemId)) return false;
      // A browser draft can retain a Schedule UUID that was retired during an
      // interrupted prior save. If the activity itself can be recovered, the
      // current generated Schedule row will be adopted inside the upsert loop.
      const recoveredActivity = (validId(row.id) ? existingById.get(row.id) : null)
        || existingBySignature.get(contentSignature({ staffUserId: row.staffUserId, deliverableId: row.deliverableId, title: row.title, detail: row.detail, dueDate: row.dueDate, startDate: row.startDate }))
        || existingByPlanIdentity.get(planIdentity(row));
      return !recoveredActivity;
    });
    if (invalidScheduleSelection) return Response.json({ error: "Choose a Gantt schedule item from this project." }, { status: 400 });

    const now = new Date().toISOString();
    let nextScheduleSort = (scheduleResult.data || []).length + 1;
    // NOTE: this save is a pure upsert. It used to also retire (is_active:
    // false) any existing activity whose id was missing from the payload —
    // inferring "not sent this time" as "delete this". That silently wiped
    // out activities whenever a save happened with an incomplete local list
    // (e.g. adding a row before the initial load had finished), and left
    // their linked Gantt/schedule entries orphaned, which is what caused
    // the schedule to visibly "double up" when the same work was re-added.
    // Deletion is now the DELETE handler below: explicit, immediate,
    // one activity at a time — never inferred from what's absent here.

    const createdOrReassigned = [];
    const persisted = [];
    const retiredSharedScheduleCandidates = new Set();
    for (const input of inputRows) {
      // A browser draft can carry a UUID from an earlier partial save. Treat an
      // ID that no longer exists in this project exactly like a new row, then
      // recover the current activity by its stable plan identity below.
      const existingForInputId = validId(input.id) ? existingById.get(input.id) : null;
      const matchedBySignature = !existingForInputId ? existingBySignature.get(contentSignature({ staffUserId: input.staffUserId, deliverableId: input.deliverableId, title: input.title, detail: input.detail, dueDate: input.dueDate, startDate: input.startDate })) : null;
      const matchedByPlanIdentity = !existingForInputId ? existingByPlanIdentity.get(planIdentity(input)) : null;
      const previous = existingForInputId || matchedBySignature || matchedByPlanIdentity;
      const assignedTo = opt(input.staffUserId);
      const changedAssignee = Boolean(previous && previous.staff_user_id !== assignedTo);
      const requestedStatus = ACTIVITY_STATUSES.has(input.status) ? input.status : (previous?.status || "not_commenced");
      // A source-owned generated Schedule row is authoritative. It may already
      // exist after an interrupted earlier save, even where the activity link
      // itself was never persisted. Re-adopting it makes retries idempotent and
      // avoids a second row violating project_schedule_generated_activity_unique.
      const recoveredGeneratedScheduleId = previous ? generatedScheduleByActivityId.get(previous.id) : null;
      let scheduleItemId = recoveredGeneratedScheduleId || (validId(input.scheduleItemId) ? input.scheduleItemId : (previous?.schedule_item_id || null));
      // Each Step 4 work activity needs its own source-owned Gantt row. Older
      // data sometimes linked several activities to a single schedule row, so
      // editing one activity appeared to leave the other activity's dates in
      // Step 5. Split that legacy shared link on the next activity save.
      const retainsExistingLink = previous?.schedule_item_id === scheduleItemId;
      if (retainsExistingLink && (activeActivityCountByScheduleId.get(scheduleItemId) || 0) > 1) {
        retiredSharedScheduleCandidates.add(scheduleItemId);
        scheduleItemId = null;
      }
      let createdScheduleItem = false;
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
            milestone: input.milestone === true,
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

      if (previous) {
        if (changedAssignee) {
          row.acceptance_status = assignedTo ? "awaiting_response" : "accepted";
          row.response_note = null;
          // Must clear notified_at: the approval emitter only notifies rows
          // where notified_at IS NULL, so leaving it set meant reassigning an
          // activity silently failed to notify the new assignee, forever.
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
        persisted.push(data);
        if (createdScheduleItem) {
          const { error: provenanceError } = await access.admin
            .from("project_schedule_items")
            .update({ generated_from_activity_id: data.id, updated_at: now })
            .eq("id", scheduleItemId);
          if (provenanceError) return Response.json({ error: provenanceError.message }, { status: 400 });
        }
        if (changedAssignee && assignedTo) createdOrReassigned.push(data);
      } else {
        row.created_by = access.user.id;
        row.assigned_by = access.user.id;
        row.assigned_at = now;
        row.acceptance_status = assignedTo ? "awaiting_response" : "accepted";
        const { data, error } = await access.admin.from("project_activities").insert(row).select(COLUMNS).single();
        if (error) return Response.json({ error: error.message }, { status: 400 });
        persisted.push(data);
        if (createdScheduleItem) {
          const { error: provenanceError } = await access.admin
            .from("project_schedule_items")
            .update({ generated_from_activity_id: data.id, updated_at: now })
            .eq("id", scheduleItemId);
          if (provenanceError) return Response.json({ error: provenanceError.message }, { status: 400 });
        }
        if (assignedTo) createdOrReassigned.push(data);
      }
    }

    // Shared legacy rows are retired only after every active activity has been
    // moved onto its own schedule row. This keeps the Gantt clear without
    // deleting history or ever retiring a deliberately shared phase early.
    for (const scheduleItemId of retiredSharedScheduleCandidates) {
      const { count, error: remainingLinksError } = await access.admin
        .from("project_activities")
        .select("id", { count: "exact", head: true })
        .eq("schedule_item_id", scheduleItemId)
        .eq("is_active", true);
      if (remainingLinksError) return Response.json({ error: remainingLinksError.message }, { status: 400 });
      if (!count) {
        const { error: retireScheduleError } = await access.admin
          .from("project_schedule_items")
          .update({ is_active: false, updated_at: now })
          .eq("id", scheduleItemId);
        if (retireScheduleError) return Response.json({ error: retireScheduleError.message }, { status: 400 });
      }
    }

    const linkedScheduleIds = [...new Set(persisted.map((activity) => activity.schedule_item_id).filter(validId))];
    for (const scheduleItemId of linkedScheduleIds) {
      const { data: scheduleActivities, error: scheduleActivitiesError } = await access.admin
        .from("project_activities")
        .select("id, title, detail, start_date, due_date, milestone, status, progress_percent")
        .eq("schedule_item_id", scheduleItemId)
        .eq("is_active", true);
      if (scheduleActivitiesError) return Response.json({ error: scheduleActivitiesError.message }, { status: 400 });
      const linked = scheduleActivities || [];
      const progressPercent = linked.length ? Math.round((linked.reduce((sum, activity) => sum + percent(activity.progress_percent), 0) / linked.length) * 100) / 100 : 0;
      const states = new Set(linked.map((activity) => activity.status));
      const status = states.has("need_info") ? "need_info" : states.has("paused_other") ? "paused_other" : states.has("qa_review") ? "qa_review" : states.has("active") ? "active" : linked.length && [...states].every((value) => value === "completed") ? "completed" : "not_commenced";
      const { data: scheduleItem, error: scheduleItemError } = await access.admin
        .from("project_schedule_items")
        .select("id, generated_from_activity_id")
        .eq("id", scheduleItemId)
        .maybeSingle();
      if (scheduleItemError) return Response.json({ error: scheduleItemError.message }, { status: 400 });
      // Step 4 is the source of truth for every one-to-one activity/Gantt
      // link. Older projects pre-date generated_from_activity_id, so adopt a
      // single linked activity on save. Shared Gantt phases remain manual:
      // their title and dates are not overwritten, but their delivery state
      // still aggregates from the linked activities below.
      const sourceActivity = linked.find((activity) => activity.id === scheduleItem?.generated_from_activity_id)
        || (linked.length === 1 ? linked[0] : null);
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
      const { error: updateScheduleError } = await access.admin
        .from("project_schedule_items")
        .update(scheduleUpdate)
        .eq("id", scheduleItemId);
      if (updateScheduleError) return Response.json({ error: updateScheduleError.message }, { status: 400 });
    }

    // Draft setup remains behind the Senior Ecologist gate. Once the project is
    // already approved and active, however, a newly created or reassigned item
    // must reach the new assignee immediately; requiring an impossible second
    // approval left later assignments permanently silent.
    let eventWarning = null;
    let notified = 0;
    if (project.activities_approval_status === "approved" && project.status === "active" && !project.deleted_at && createdOrReassigned.length) {
      eventWarning = await createAssignmentEvents(access.admin, project, createdOrReassigned);
      if (!eventWarning) {
        const notifiedIds = createdOrReassigned.map((activity) => activity.id);
        const { error: markError } = await access.admin.from("project_activities").update({ notified_at: now }).in("id", notifiedIds);
        eventWarning = markError?.message || null;
        notified = markError ? 0 : notifiedIds.length;
      }
    }
    return Response.json({ success: true, count: persisted.length, activities: persisted, notified, event_warning: eventWarning });
  } catch (error) {
    return serverError(error);
  }
}

// Explicit, immediate, single-activity deletion — replaces the old
// infer-from-absence retirement that used to run inside PUT. Also retires
// the activity's auto-created schedule/Gantt line, but only if no other
// still-active activity is still linked to it (an admin can group several
// activities under one shared schedule phase via the schedule dropdown, so
// that shared phase must not disappear just because one of its activities
// was deleted).
export async function DELETE(request, { params }) {
  try {
    const access = await requireSession(request);
    if (access.error) return access.error;
    if (!access.isAdmin) return Response.json({ error: "Only administrators can manage activities." }, { status: 403 });

    const { searchParams } = new URL(request.url);
    const activityId = searchParams.get("id");
    if (!validId(activityId)) return Response.json({ error: "A valid activity id is required." }, { status: 400 });

    const { data: activity, error: fetchError } = await access.admin
      .from("project_activities")
      .select("id, project_id, schedule_item_id")
      .eq("id", activityId)
      .eq("project_id", params.projectId)
      .eq("is_active", true)
      .maybeSingle();
    if (fetchError) return Response.json({ error: fetchError.message }, { status: 400 });
    if (!activity) return Response.json({ error: "Activity not found." }, { status: 404 });

    const now = new Date().toISOString();
    const { error: retireError } = await access.admin
      .from("project_activities")
      .update({ is_active: false, updated_at: now })
      .eq("id", activityId);
    if (retireError) return Response.json({ error: retireError.message }, { status: 400 });

    // Retire any unactioned notification for this activity. Without this the
    // staff member keeps a clickable "awaiting acceptance" card whose target no
    // longer satisfies is_active = true, so every response attempt failed.
    // Answered notifications (read_at set) are left alone so the audit trail of
    // who accepted or declined survives the activity being retired.
    const { error: eventRetireError } = await access.admin
      .from("portal_events")
      .update({ dismissed_at: now })
      .eq("source_table", "project_activities")
      .eq("source_id", activityId)
      .eq("event_type", "project_activity_assigned")
      .is("read_at", null)
      .is("dismissed_at", null);
    if (eventRetireError) return Response.json({ error: eventRetireError.message }, { status: 400 });

    if (validId(activity.schedule_item_id)) {
      const { count, error: countError } = await access.admin
        .from("project_activities")
        .select("id", { count: "exact", head: true })
        .eq("schedule_item_id", activity.schedule_item_id)
        .eq("is_active", true);
      if (countError) return Response.json({ error: countError.message }, { status: 400 });
      if (!count) {
        const { error: scheduleRetireError } = await access.admin
          .from("project_schedule_items")
          .update({ is_active: false, updated_at: now })
          .eq("id", activity.schedule_item_id);
        if (scheduleRetireError) return Response.json({ error: scheduleRetireError.message }, { status: 400 });
      }
    }

    return Response.json({ success: true });
  } catch (error) {
    return serverError(error);
  }
}
