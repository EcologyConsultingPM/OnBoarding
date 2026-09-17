import { requireSession, serverError } from "../../../../../../lib/serverAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
const ACTIVITY_STATUSES = new Set(["not_commenced", "active", "need_info", "paused_other", "qa_review", "completed"]);
function formatDueDate(value) {
  if (!value) return "";
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? "" : ` · Due ${date.toLocaleDateString("en-AU", { day: "numeric", month: "short" })}`;
}

// Quick single-activity edit — built specifically for the Staff Capacity
// Planner's "unassigned calendar item" workflow, where an admin double-clicks
// one item and needs to assign, edit or delete it without the bulk-save
// semantics (and full activity list) the main activities route requires.
// Assigning a previously-unassigned activity notifies the staff member
// immediately — this is a targeted, ad-hoc fix to one gap, not part of the
// batch SE-approval flow, so there's no review cycle to gate it behind.
export async function PATCH(request, { params }) {
  try {
    const access = await requireSession(request);
    if (access.error) return access.error;
    if (!access.isAdmin) return Response.json({ error: "Only administrators can manage activities." }, { status: 403 });

    const { projectId, activityId } = params;
    if (!validId(projectId) || !validId(activityId)) return Response.json({ error: "A valid project and activity id are required." }, { status: 400 });

    const { data: current, error: currentError } = await access.admin
      .from("project_activities")
      .select("id, project_id, staff_user_id, title, is_active")
      .eq("id", activityId)
      .eq("project_id", projectId)
      .maybeSingle();
    if (currentError) return Response.json({ error: currentError.message }, { status: 400 });
    if (!current || !current.is_active) return Response.json({ error: "Activity not found." }, { status: 404 });

    const body = await request.json();
    const now = new Date().toISOString();
    const patch = { updated_at: now };

    let newlyAssignedTo = null;
    if (body?.staffUserId !== undefined) {
      const staffUserId = body.staffUserId ? String(body.staffUserId) : null;
      if (staffUserId && !validId(staffUserId)) return Response.json({ error: "Choose a valid staff member." }, { status: 400 });
      patch.staff_user_id = staffUserId;
      if (staffUserId && staffUserId !== current.staff_user_id) {
        newlyAssignedTo = staffUserId;
        patch.acceptance_status = "awaiting_response";
        patch.notified_at = null;
        patch.assigned_at = now;
        patch.assigned_by = access.user.id;
      }
    }
    if (body?.title !== undefined) {
      const title = text(body.title, 500);
      if (!title) return Response.json({ error: "A title is required." }, { status: 400 });
      patch.title = title;
    }
    if (body?.taskCategory !== undefined) patch.task_category = text(body.taskCategory, 200) || null;
    if (body?.detail !== undefined) patch.detail = text(body.detail, 5000) || null;
    if (body?.budgetHours !== undefined) {
      const hours = Number(body.budgetHours);
      patch.budget_hours = Number.isFinite(hours) && hours >= 0 ? hours : null;
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
      const progress = Number(body.progressPercent);
      if (!Number.isFinite(progress) || progress < 0 || progress > 100) return Response.json({ error: "Progress must be between 0 and 100." }, { status: 400 });
      patch.progress_percent = Math.round(progress * 100) / 100;
    }

    let { data: updated, error: updateError } = await access.admin
      .from("project_activities")
      .update(patch)
      .eq("id", activityId)
      .select("id, project_id, staff_user_id, task_category, title, detail, budget_hours, due_date, start_date, milestone, status, progress_percent, acceptance_status, schedule_item_id, sort_order")
      .single();
    if (updateError) return Response.json({ error: updateError.message }, { status: 400 });

    const affectsSchedule = body?.startDate !== undefined || body?.dueDate !== undefined || body?.title !== undefined || body?.detail !== undefined || body?.milestone !== undefined || body?.status !== undefined || body?.progressPercent !== undefined;
    // An activity added outside Project Setup can legitimately pre-date the
    // Gantt link. Its first dated calendar edit creates a source-owned schedule
    // row, so later calendar moves always remain visible in the project plan.
    if (affectsSchedule && !updated.schedule_item_id && (updated.start_date || updated.due_date)) {
      const { data: generatedSchedule, error: generatedScheduleError } = await access.admin
        .from("project_schedule_items")
        .insert({
          project_id: projectId,
          sort_order: updated.sort_order || 0,
          title: updated.title,
          detail: updated.detail,
          start_date: updated.start_date || updated.due_date,
          end_date: updated.due_date || updated.start_date,
          milestone: updated.milestone === true,
          status: updated.status,
          progress_percent: updated.progress_percent,
          generated_from_activity_id: updated.id,
          is_active: true,
          updated_at: now,
        })
        .select("id")
        .single();
      if (generatedScheduleError) return Response.json({ error: generatedScheduleError.message }, { status: 400 });
      const { error: linkError } = await access.admin.from("project_activities").update({ schedule_item_id: generatedSchedule.id, updated_at: now }).eq("id", updated.id);
      if (linkError) return Response.json({ error: linkError.message }, { status: 400 });
      updated = { ...updated, schedule_item_id: generatedSchedule.id };
    }

    // Keep an activity-created schedule line in sync with a calendar edit.
    // A manual Gantt phase may intentionally group several activities, so it
    // retains its independent title/dates. A legacy one-to-one link is safely
    // adopted here, making the activity the source of truth from this edit on.
    if (updated.schedule_item_id && affectsSchedule) {
      const { data: linkedSchedule, error: scheduleLookupError } = await access.admin
        .from("project_schedule_items")
        .select("id, generated_from_activity_id")
        .eq("id", updated.schedule_item_id)
        .maybeSingle();
      if (scheduleLookupError) return Response.json({ error: scheduleLookupError.message }, { status: 400 });
      const { data: linkedActivities, error: linkedActivitiesError } = await access.admin
        .from("project_activities")
        .select("id")
        .eq("schedule_item_id", updated.schedule_item_id)
        .eq("is_active", true);
      if (linkedActivitiesError) return Response.json({ error: linkedActivitiesError.message }, { status: 400 });
      const activityOwnsSchedule = linkedSchedule?.generated_from_activity_id === updated.id
        || (!linkedSchedule?.generated_from_activity_id && (linkedActivities || []).length === 1 && linkedActivities[0]?.id === updated.id);
      if (activityOwnsSchedule) {
        const { error: scheduleUpdateError } = await access.admin.from("project_schedule_items").update({
          generated_from_activity_id: updated.id,
          title: updated.title,
          detail: updated.detail,
          start_date: updated.start_date || updated.due_date,
          end_date: updated.due_date || updated.start_date,
          milestone: updated.milestone === true,
          status: updated.status,
          progress_percent: updated.progress_percent,
          updated_at: now,
        }).eq("id", updated.schedule_item_id);
        if (scheduleUpdateError) return Response.json({ error: scheduleUpdateError.message }, { status: 400 });
      }
    }

    let notifyWarning = null;
    if (newlyAssignedTo) {
      const { data: project } = await access.admin.from("projects").select("name").eq("id", projectId).maybeSingle();
      const { error: notifyError } = await access.admin.from("portal_events").insert({
        recipient_id: newlyAssignedTo,
        event_type: "project_activity_assigned",
        severity: "action_required",
        title: `Work assignment: ${updated.title}`,
        body: `${project?.name || "A project"}${updated.task_category ? ` · ${updated.task_category}` : ""}${updated.budget_hours != null ? ` · ${updated.budget_hours} budgeted hours` : ""}${formatDueDate(updated.due_date)}`,
        href: "/staff/notifications",
        source_table: "project_activities",
        source_id: updated.id,
      });
      if (notifyError) notifyWarning = notifyError.message;
      else await access.admin.from("project_activities").update({ notified_at: now }).eq("id", updated.id);
    }

    return Response.json({ activity: updated, notify_warning: notifyWarning });
  } catch (error) {
    return serverError(error);
  }
}
