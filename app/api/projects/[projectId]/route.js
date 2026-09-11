import { requireSession, serverError } from "../../../../lib/serverAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PROJECT_COLUMNS =
  "id, name, client_name, client_contact, sharepoint_link, sharepoint_label, description, scope_of_works, project_lead_user_id, start_date, end_date, budget_hours, budget_dollars, default_hourly_rate, status, created_at, updated_at";

function opt(value) {
  const t = typeof value === "string" ? value.trim() : "";
  return t || null;
}
function num(value) {
  if (value === "" || value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

async function projectAccess(access, projectId, staffWorkspace = false) {
  const { data: project, error } = await access.admin
    .from("projects")
    .select("id, created_by, name, status")
    .eq("id", projectId)
    .maybeSingle();
  if (error || !project) return { response: Response.json({ error: "Project not found." }, { status: 404 }) };
  if (!access.isAdmin || staffWorkspace) {
    const [allocationResult, activityResult] = await Promise.all([
      access.admin
        .from("project_allocations")
        .select("id")
        .eq("project_id", projectId)
        .eq("staff_user_id", access.user.id)
        .neq("active", false)
        .limit(1),
      access.admin
        .from("project_activities")
        .select("id")
        .eq("project_id", projectId)
        .eq("staff_user_id", access.user.id)
        .eq("is_active", true)
        .in("acceptance_status", ["accepted", "actioned"])
        .limit(1),
    ]);
    if (allocationResult.error) return { response: Response.json({ error: allocationResult.error.message }, { status: 400 }) };
    let activityRows = activityResult.data || [];
    if (activityResult.error) {
      const migrationPending = activityResult.error?.code === "42703" || /is_active/i.test(String(activityResult.error?.message || ""));
      if (!migrationPending) return { response: Response.json({ error: activityResult.error.message }, { status: 400 }) };
      const fallback = await access.admin.from("project_activities").select("id").eq("project_id", projectId).eq("staff_user_id", access.user.id).limit(1);
      if (fallback.error) return { response: Response.json({ error: fallback.error.message }, { status: 400 }) };
      activityRows = fallback.data || [];
    }
    if (!(allocationResult.data || []).length && !activityRows.length) {
      return { response: Response.json({ error: "You are not allocated to this project." }, { status: 403 }) };
    }
  }
  return { project };
}

// A dependency table that does not exist yet must not block a purge.
function unavailableTable(error) {
  const code = String(error?.code || "");
  const message = String(error?.message || "").toLowerCase();
  return code === "42P01" || code === "PGRST205" || message.includes("does not exist");
}

export async function GET(request, { params }) {
  try {
    const access = await requireSession(request);
    if (access.error) return access.error;
    const staffWorkspace = new URL(request.url).searchParams.get("audience") === "staff";
    const authorisation = await projectAccess(access, params.projectId, staffWorkspace);
    if (authorisation.response) return authorisation.response;

    const projectQuery = access.admin.from("projects").select(PROJECT_COLUMNS).eq("id", params.projectId).single();
    const allocationQuery = access.admin.from("project_allocations").select("id, staff_user_id, role_on_project, allocated_hours, hourly_rate").eq("project_id", params.projectId);
    let scheduleQuery = access.admin
      .from("project_schedule_items")
      .select("id, sort_order, title, detail, start_date, end_date, milestone, progress_percent, status, locked, is_active")
      .eq("project_id", params.projectId)
      .eq("is_active", true)
      .order("sort_order", { ascending: true });
    let [{ data: project }, scheduleResult, { data: allocations }, activitiesResult] = await Promise.all([
      projectQuery,
      scheduleQuery,
      allocationQuery,
      access.admin
        .from("project_activities")
        .select("id, schedule_item_id, staff_user_id, title, status, progress_percent, acceptance_status, is_active")
        .eq("project_id", params.projectId)
        .eq("is_active", true),
    ]);
    if (scheduleResult.error && (scheduleResult.error?.code === "42703" || /is_active|progress_percent/i.test(String(scheduleResult.error?.message || "")))) {
      scheduleResult = await access.admin
        .from("project_schedule_items")
        .select("id, sort_order, title, detail, start_date, end_date, milestone")
        .eq("project_id", params.projectId)
        .order("sort_order", { ascending: true });
    }
    if (scheduleResult.error) return Response.json({ error: scheduleResult.error.message }, { status: 400 });
    // The project query's error was discarded, so a missing or deleted project
    // returned HTTP 200 with project: null rather than a 404 — the caller had
    // no way to distinguish "gone" from "empty".
    if (!project) return Response.json({ error: "Project not found." }, { status: 404 });
    const schedule = scheduleResult.data || [];

    // Attach staff emails to allocations and linked schedule activities so project
    // team members can see who owns each delivery line without receiving data for
    // any project outside their server-checked project team.
    let allocationsWithEmail = allocations || [];
    const activityRows = activitiesResult?.error ? [] : (activitiesResult?.data || []);
    const staffIds = [...new Set([
      ...allocationsWithEmail.map((row) => row.staff_user_id),
      ...activityRows.map((row) => row.staff_user_id),
    ].filter(Boolean))];
    const { data: users } = staffIds.length ? await access.admin.auth.admin.listUsers() : { data: { users: [] } };
    const emailById = new Map((users?.users || []).map((user) => [user.id, user.email]));
    allocationsWithEmail = allocationsWithEmail.map((allocation) => ({ ...allocation, email: emailById.get(allocation.staff_user_id) || null }));
    const scheduleWithAssignments = (schedule || []).map((item) => {
      const linkedActivities = activityRows.filter((activity) => activity.schedule_item_id === item.id);
      const assignedStaff = linkedActivities.map((activity) => ({
        id: activity.staff_user_id,
        email: emailById.get(activity.staff_user_id) || "Allocated team member",
        activityId: activity.id,
        title: activity.title,
        status: activity.status || "not_commenced",
        progressPercent: Number(activity.progress_percent || 0),
        acceptanceStatus: activity.acceptance_status || "accepted",
      }));
      const liveStatuses = linkedActivities.map((activity) => activity.status).filter(Boolean);
      const averageProgress = linkedActivities.length ? Math.round(linkedActivities.reduce((sum, activity) => sum + Number(activity.progress_percent || 0), 0) / linkedActivities.length) : Number(item.progress_percent || 0);
      return { ...item, assigned_staff: assignedStaff, progress_percent: averageProgress, status: liveStatuses.includes("completed") && linkedActivities.every((activity) => activity.status === "completed") ? "completed" : (liveStatuses.find((status) => status !== "not_commenced") || item.status || "not_commenced") };
    });

    return Response.json({ project, schedule: scheduleWithAssignments, allocations: allocationsWithEmail });
  } catch (error) {
    return serverError(error);
  }
}

export async function PATCH(request, { params }) {
  try {
    const access = await requireSession(request);
    if (access.error) return access.error;
    if (!access.isAdmin) return Response.json({ error: "Only administrators can edit projects." }, { status: 403 });
    const authorisation = await projectAccess(access, params.projectId);
    if (authorisation.response) return authorisation.response;

    const body = await request.json();
    const { data, error } = await access.admin
      .from("projects")
      .update({
        name: opt(body.name) ?? undefined,
        client_name: opt(body.clientName),
        client_contact: opt(body.clientContact),
        sharepoint_link: opt(body.sharepointLink),
        sharepoint_label: opt(body.sharepointLabel),
        description: opt(body.description),
        scope_of_works: opt(body.scopeOfWorks),
        project_lead_user_id: opt(body.projectLeadUserId),
        start_date: opt(body.startDate),
        end_date: opt(body.endDate),
        budget_hours: num(body.budgetHours),
        budget_dollars: num(body.budgetDollars),
        default_hourly_rate: num(body.defaultHourlyRate),
        status: opt(body.status) || undefined,
        // Restoring from the recycle bin. Explicit action rather than an
        // arbitrary field write, so it can never happen by accident.
        ...(body.action === "restore" ? { deleted_at: null, deleted_by: null } : {}),
      })
      .eq("id", params.projectId)
      .select(PROJECT_COLUMNS)
      .single();

    if (error) return Response.json({ error: error.message }, { status: 400 });
    return Response.json({ project: data });
  } catch (error) {
    return serverError(error);
  }
}

// Replace the whole schedule for a project (admin only), renumbered in order.
// A project can be removed only while it has no delivery, allocation or audit
// records. This preserves timesheet/tracker history and avoids broad cascade
// deletion from a portfolio-management control.
// DELETE — soft delete by default, permanent purge on request.
//
// Previously this refused outright for any project with a delivery record,
// which was correct (a hard delete cascades away activities, tracker history
// and WHS-relevant records) but left no way to remove a project from the list.
// Archiving is a status, not a removal.
//
//   DELETE /api/projects/:id             -> soft delete, always succeeds, restorable
//   DELETE /api/projects/:id?purge=true  -> permanent, only when nothing depends on it
export async function DELETE(request, { params }) {
  try {
    const access = await requireSession(request);
    if (access.error) return access.error;
    if (!access.isAdmin) return Response.json({ error: "Only administrators can delete projects." }, { status: 403 });
    const authorisation = await projectAccess(access, params.projectId);
    if (authorisation.response) return authorisation.response;

    const purge = new URL(request.url).searchParams.get("purge") === "true";
    const now = new Date().toISOString();

    if (!purge) {
      // Soft delete: hide it everywhere, keep every dependent record intact.
      const { error } = await access.admin
        .from("projects")
        .update({ deleted_at: now, deleted_by: access.user.id, updated_at: now })
        .eq("id", params.projectId);
      if (error) return Response.json({ error: error.message }, { status: 400 });

      // Staff should not keep clickable cards for a project they can no longer
      // open. Dismissed rather than deleted, so the trail survives a restore.
      await access.admin
        .from("portal_events")
        .update({ dismissed_at: now })
        .eq("source_table", "project_tracker_settings")
        .eq("source_id", params.projectId)
        .is("dismissed_at", null);

      return Response.json({ success: true, deleted: "soft", restorable: true });
    }

    // Permanent deletion. The dependency guard stays exactly as it was: a
    // project carrying delivery or WHS history is never destroyed.
    const checks = await Promise.all([
      access.admin.from("project_allocations").select("id").eq("project_id", params.projectId).limit(1),
      access.admin.from("project_activities").select("id").eq("project_id", params.projectId).limit(1),
      access.admin.from("project_schedule_items").select("id").eq("project_id", params.projectId).limit(1),
      access.admin.from("project_activity_history").select("id").eq("project_id", params.projectId).limit(1),
      access.admin.from("project_tracker_entries").select("id").eq("project_id", params.projectId).limit(1),
    ]);
    const checkError = checks.find((result) => result.error && !unavailableTable(result.error))?.error;
    if (checkError) return Response.json({ error: checkError.message }, { status: 400 });
    if (checks.some((result) => (result.data || []).length > 0)) {
      return Response.json({
        error: "This project has allocations, activities, schedule items or tracker history, so it cannot be permanently deleted. It stays in the recycle bin, where its delivery record is retained.",
        dependencies: true,
      }, { status: 409 });
    }

    // portal_events.source_id is polymorphic, so there is no foreign key to
    // cascade from. Without this, deleting a project leaves staff holding
    // "Project Tracker access available" cards that link to nothing.
    const { error: eventError } = await access.admin
      .from("portal_events")
      .delete()
      .eq("source_table", "project_tracker_settings")
      .eq("source_id", params.projectId);
    if (eventError) return Response.json({ error: eventError.message }, { status: 400 });

    const { error } = await access.admin.from("projects").delete().eq("id", params.projectId);
    if (error) return Response.json({ error: error.message }, { status: 400 });
    return Response.json({ success: true, deleted: "permanent" });
  } catch (error) {
    return serverError(error);
  }
}

export async function PUT(request, { params }) {
  try {
    const access = await requireSession(request);
    if (access.error) return access.error;
    if (!access.isAdmin) return Response.json({ error: "Only administrators can edit the schedule." }, { status: 403 });
    const authorisation = await projectAccess(access, params.projectId);
    if (authorisation.response) return authorisation.response;

    const body = await request.json();
    if (!Array.isArray(body.schedule) || body.schedule.length > 200) {
      return Response.json({ error: "Provide no more than 200 schedule items." }, { status: 400 });
    }
    const incoming = body.schedule
      .filter((row) => row && typeof row.title === "string" && row.title.trim())
      .map((row, index) => ({ ...row, title: row.title.trim(), sortOrder: index + 1 }));
    const now = new Date().toISOString();

    const existingResult = await access.admin
      .from("project_schedule_items")
      .select("id, locked, is_active")
      .eq("project_id", params.projectId)
      .eq("is_active", true);
    if (existingResult.error) {
      const migrationNeeded = existingResult.error?.code === "42703" || /is_active|locked/i.test(String(existingResult.error?.message || ""));
      if (migrationNeeded) return Response.json({ error: "The connected Gantt workflow is awaiting its approved database migration." }, { status: 409 });
      return Response.json({ error: existingResult.error.message }, { status: 400 });
    }
    const existingById = new Map((existingResult.data || []).map((row) => [row.id, row]));
    const validId = (value) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ""));
    const incomingIds = new Set(incoming.map((row) => row.id).filter(validId));
    const retiring = [...existingById.keys()].filter((id) => !incomingIds.has(id));

    if (retiring.length) {
      const { data: linkedActivities, error: linkedError } = await access.admin
        .from("project_activities")
        .select("id, title")
        .in("schedule_item_id", retiring)
        .eq("is_active", true)
        .limit(20);
      if (linkedError) return Response.json({ error: linkedError.message }, { status: 400 });
      if ((linkedActivities || []).length) {
        return Response.json({ error: `A Gantt row linked to an active work activity cannot be removed. Retire or re-link the activity first: ${linkedActivities.map((activity) => activity.title).join(", ")}.` }, { status: 409 });
      }
      const { error } = await access.admin
        .from("project_schedule_items")
        .update({ is_active: false, updated_at: now })
        .in("id", retiring);
      if (error) return Response.json({ error: error.message }, { status: 400 });
    }

    const saved = [];
    for (const item of incoming) {
      const existing = validId(item.id) ? existingById.get(item.id) : null;
      const row = {
        project_id: params.projectId,
        sort_order: item.sortOrder,
        title: item.title,
        detail: opt(item.detail),
        start_date: opt(item.startDate),
        end_date: opt(item.endDate),
        milestone: !!item.milestone,
        progress_percent: Number.isFinite(Number(item.progressPercent)) ? Math.max(0, Math.min(100, Number(item.progressPercent))) : Number(existing?.progress_percent || 0),
        status: ["not_commenced", "active", "need_info", "paused_other", "qa_review", "completed"].includes(item.status) ? item.status : (existing?.status || "not_commenced"),
        locked: item.locked === true,
        is_active: true,
        updated_at: now,
      };
      if (existing) {
        if (existing.locked && item.locked !== false) {
          row.locked = true;
        }
        const { data, error } = await access.admin.from("project_schedule_items").update(row).eq("id", existing.id).select("id, sort_order, title, detail, start_date, end_date, milestone, progress_percent, status, locked, is_active").single();
        if (error) return Response.json({ error: error.message }, { status: 400 });
        saved.push(data);
      } else {
        const { data, error } = await access.admin.from("project_schedule_items").insert(row).select("id, sort_order, title, detail, start_date, end_date, milestone, progress_percent, status, locked, is_active").single();
        if (error) return Response.json({ error: error.message }, { status: 400 });
        saved.push(data);
      }
    }

    return Response.json({ success: true, count: saved.length, schedule: saved });
  } catch (error) {
    return serverError(error);
  }
}
