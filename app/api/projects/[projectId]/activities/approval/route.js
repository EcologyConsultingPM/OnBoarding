import { requireSession, serverError } from "../../../../../../lib/serverAuth";
import { generateTrackerFromActivities } from "../../tracker/auto-generate/route";
import { TIME_CATEGORIES } from "../../../../../../lib/ecologicalWbs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

// Hold point: a project's Work Activities save as a draft with no staff
// notification. An admin must explicitly request Senior Ecologist review, then
// separately record approval. Re-running after adding activities only reaches
// recipient rows whose notified_at remains null.
export async function POST(request, { params }) {
  try {
    const access = await requireSession(request);
    if (access.error) return access.error;
    if (!access.isAdmin) return Response.json({ error: "Only administrators can manage the approval gate." }, { status: 403 });

    const { projectId } = params;
    const body = await request.json().catch(() => ({}));
    const action = body?.action;
    if (!["request_review", "approve", "administrator_override", "reset"].includes(action)) return Response.json({ error: "action must be request_review, approve, administrator_override or reset." }, { status: 400 });

    const { data: project, error: projectError } = await access.admin.from("projects").select("id, name, activities_approval_status").eq("id", projectId).maybeSingle();
    if (projectError) return Response.json({ error: projectError.message }, { status: 400 });
    if (!project) return Response.json({ error: "Project not found." }, { status: 404 });
    const now = new Date().toISOString();

    if (action === "request_review") {
      const { count: activeCount, error: activeCountError } = await access.admin.from("project_activities").select("id", { count: "exact", head: true }).eq("project_id", projectId).eq("is_active", true);
      if (activeCountError) return Response.json({ error: activeCountError.message }, { status: 400 });
      if (!activeCount) return Response.json({ error: "Add at least one work activity before requesting Senior Ecologist review." }, { status: 400 });
      const { data, error } = await access.admin.from("projects").update({ activities_approval_status: "pending_se_review", activities_se_review_requested_at: now, activities_se_review_requested_by: access.user.id }).eq("id", projectId).select("activities_approval_status, activities_se_review_requested_at").single();
      if (error) return Response.json({ error: error.message }, { status: 400 });
      const { error: auditError } = await access.admin.from("project_approval_history").insert({ project_id: projectId, action: "senior_ecologist_review_requested", performed_by: access.user.id });
      if (auditError) return Response.json({ error: `Review state was saved but its audit record could not be written: ${auditError.message}` }, { status: 400 });
      return Response.json({ success: true, project: data });
    }

    if (action === "reset") {
      const { data, error } = await access.admin.from("projects").update({ activities_approval_status: "draft", activities_se_review_requested_at: null, activities_se_review_requested_by: null }).eq("id", projectId).select("activities_approval_status").single();
      if (error) return Response.json({ error: error.message }, { status: 400 });
      const { error: auditError } = await access.admin.from("project_approval_history").insert({ project_id: projectId, action: "returned_to_draft", performed_by: access.user.id });
      if (auditError) return Response.json({ error: `Draft state was saved but its audit record could not be written: ${auditError.message}` }, { status: 400 });
      return Response.json({ success: true, project: data });
    }

    if (project.activities_approval_status === "approved") return Response.json({ error: "Activities for this project are already approved." }, { status: 409 });
    if (action === "approve" && project.activities_approval_status !== "pending_se_review") return Response.json({ error: "Request Senior Ecologist review before recording approval, or use the administrator override with a reason." }, { status: 409 });
    const overrideReason = typeof body?.reason === "string" ? body.reason.trim() : "";
    if (action === "administrator_override" && overrideReason.length < 10) return Response.json({ error: "Enter a clear administrator override reason (at least 10 characters)." }, { status: 400 });

    const { data: allActivities, error: activitiesError } = await access.admin
      .from("project_activities")
      .select("id, title, detail, task_category, budget_hours, start_date, due_date, staff_user_id, notified_at")
      .eq("project_id", projectId)
      .eq("is_active", true);
    if (activitiesError) return Response.json({ error: activitiesError.message }, { status: 400 });
    if (!(allActivities || []).length) return Response.json({ error: "Add and save at least one work activity before activating this project." }, { status: 400 });

    const activityById = new Map((allActivities || []).map((activity) => [activity.id, activity]));
    let assignmentSchemaAvailable = true;
    let pendingAssignments = [];
    const assigneeResult = await access.admin
      .from("project_activity_assignees")
      .select("id, activity_id, staff_user_id")
      .in("activity_id", [...activityById.keys()])
      .neq("acceptance_status", "removed")
      .is("notified_at", null);
    if (assigneeResult.error) {
      if (!isAssignmentSchemaError(assigneeResult.error)) return Response.json({ error: assigneeResult.error.message }, { status: 400 });
      assignmentSchemaAvailable = false;
    } else {
      pendingAssignments = assigneeResult.data || [];
    }

    // The legacy scalar branch is deliberately retained only where the join
    // table is unavailable. In the joined mode one event is inserted for each
    // unnotified recipient row, including colleagues on the same activity.
    const pendingActivities = !assignmentSchemaAvailable
      ? (allActivities || []).filter((activity) => activity.staff_user_id && !activity.notified_at)
      : [];
    const events = assignmentSchemaAvailable
      ? pendingAssignments.map((assignment) => assignmentEvent(project, activityById.get(assignment.activity_id), assignment.staff_user_id))
      : pendingActivities.map((activity) => assignmentEvent(project, activity, activity.staff_user_id));

    let eventWarning = null;
    if (events.length) {
      const { error: eventError } = await access.admin.from("portal_events").insert(events);
      if (eventError) eventWarning = eventError.message;
      else if (assignmentSchemaAvailable) {
        const { error: markError } = await access.admin.from("project_activity_assignees").update({ notified_at: now, updated_at: now }).in("id", pendingAssignments.map((assignment) => assignment.id));
        if (markError) eventWarning = markError.message;
      } else {
        const { error: markError } = await access.admin.from("project_activities").update({ notified_at: now }).in("id", pendingActivities.map((activity) => activity.id));
        if (markError) eventWarning = markError.message;
      }
    }

    const { data: updatedProject, error: approveError } = await access.admin.from("projects").update({ activities_approval_status: "approved", activities_approved_at: now, activities_approved_by: access.user.id, status: "active", updated_at: now }).eq("id", projectId).select("activities_approval_status, activities_approved_at").single();
    if (approveError) return Response.json({ error: approveError.message }, { status: 400 });
    const { error: approvalAuditError } = await access.admin.from("project_approval_history").insert({ project_id: projectId, action: action === "administrator_override" ? "administrator_override_activated" : "senior_ecologist_approved", reason: action === "administrator_override" ? overrideReason : null, performed_by: access.user.id });
    if (approvalAuditError) return Response.json({ error: `Project activated but the required approval audit record could not be written: ${approvalAuditError.message}` }, { status: 400 });

    let trackerWarning = null;
    const STANDARD_TRACKER_CATEGORIES = TIME_CATEGORIES;
    try {
      const generated = await generateTrackerFromActivities(access, projectId);
      if (generated.error && !generated.skipped) trackerWarning = generated.error;
      else if (generated.warning) trackerWarning = generated.warning;
      const { data: existingTemplate, error: templateError } = await access.admin.from("project_tracker_templates").select("id, category_options, locked").eq("project_id", projectId).maybeSingle();
      if (templateError) throw new Error(templateError.message);
      if (!existingTemplate) {
        const { error } = await access.admin.from("project_tracker_templates").insert({ project_id: projectId, template_name: "Project Tracker", instructions: "Record project activity accurately and identify issues requiring project-lead review.", category_options: STANDARD_TRACKER_CATEGORIES, column_definitions: [], guidance_rows: [], locked: true, locked_by: access.user.id, locked_at: now, created_by: access.user.id, updated_by: access.user.id });
        if (error) throw new Error(error.message);
      } else if (!existingTemplate.locked) {
        const categories = Array.isArray(existingTemplate.category_options) && existingTemplate.category_options.length ? existingTemplate.category_options : STANDARD_TRACKER_CATEGORIES;
        const { error } = await access.admin.from("project_tracker_templates").update({ category_options: categories, locked: true, locked_by: access.user.id, locked_at: now, updated_by: access.user.id, updated_at: now }).eq("id", existingTemplate.id);
        if (error) throw new Error(error.message);
      }
      const { data: currentSettings } = await access.admin.from("project_tracker_settings").select("*").eq("project_id", projectId).maybeSingle();
      const { error: settingsError } = await access.admin.from("project_tracker_settings").upsert({ project_id: projectId, tracker_visible: true, resources_ready: currentSettings?.resources_ready ?? false, training_checked: currentSettings?.training_checked ?? false, forms_configured: currentSettings?.forms_configured ?? false, whs_checked: currentSettings?.whs_checked ?? false, activated_by: currentSettings?.activated_by || access.user.id, activated_at: currentSettings?.activated_at || now, updated_by: access.user.id, updated_at: now }, { onConflict: "project_id" });
      if (settingsError) throw new Error(settingsError.message);

      let team = [];
      const teamResult = await access.admin.from("project_allocations").select("staff_user_id").eq("project_id", projectId).eq("active", true);
      if (teamResult.error) {
        const fallback = await access.admin.from("project_allocations").select("staff_user_id").eq("project_id", projectId);
        team = fallback.data || [];
      } else team = teamResult.data || [];
      const recipients = [...new Set(team.map((row) => row.staff_user_id).filter(Boolean))];
      if (recipients.length && !currentSettings?.tracker_visible) {
        await access.admin.from("portal_events").insert(recipients.map((recipientId) => ({ recipient_id: recipientId, event_type: "project_tracker_enabled", severity: "information", title: "Project Tracker access available", body: `You can now log project activity and timesheet reference entries for ${project.name}.`, href: "/staff/projects", source_table: "project_tracker_settings", source_id: projectId })));
      }
    } catch (trackerError) {
      trackerWarning = trackerWarning || trackerError.message;
    }

    return Response.json({ success: true, approval_mode: action, project: updatedProject, notified: events.length, event_warning: eventWarning, tracker_warning: trackerWarning, multiAssigneeReady: assignmentSchemaAvailable });
  } catch (error) {
    return serverError(error);
  }
}
