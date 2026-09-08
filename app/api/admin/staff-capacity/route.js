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

    const { data: updated, error: updateError } = await access.admin
      .from("project_activities")
      .update(patch)
      .eq("id", activityId)
      .select("id, project_id, staff_user_id, task_category, title, detail, budget_hours, due_date, start_date, milestone, status, acceptance_status, schedule_item_id")
      .single();
    if (updateError) return Response.json({ error: updateError.message }, { status: 400 });

    // Keep the linked schedule/Gantt line's date span consistent with any
    // date change here, mirroring the same cascade the bulk save performs.
    if (updated.schedule_item_id && (body?.startDate !== undefined || body?.dueDate !== undefined || body?.title !== undefined)) {
      await access.admin.from("project_schedule_items").update({
        title: updated.title,
        start_date: updated.start_date,
        end_date: updated.due_date || updated.start_date,
        updated_at: now,
      }).eq("id", updated.schedule_item_id);
    }

    let notifyWarning = null;
    if (newlyAssignedTo) {
      const { data: project } = await access.admin.from("projects").select("name").eq("id", projectId).maybeSingle();
      const { error: notifyError } = await access.admin.from("portal_events").insert({
        recipient_id: newlyAssignedTo,
        event_type: "project_activity_assigned",
        severity: "action_required",
        title: "Project activity assigned",
        body: `${project?.name || "A project"}: ${updated.title}${formatDueDate(updated.due_date)}`,
        href: "/staff/notifications",
        source_table: "project_activities",
        source_id: updated.id,
      });
      if (notifyError) notifyWarning = notifyError.message;
    }

    return Response.json({ activity: updated, notify_warning: notifyWarning });
  } catch (error) {
    return serverError(error);
  }
}
