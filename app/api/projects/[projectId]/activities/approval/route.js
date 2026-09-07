import { requireSession, serverError } from "../../../../../../lib/serverAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function formatDueDate(value) {
  if (!value) return "";
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? "" : ` · Due ${date.toLocaleDateString("en-AU", { day: "numeric", month: "short" })}`;
}

// Hold point: a project's Work Activities save as a draft with no staff
// notification. An admin must explicitly request Senior Ecologist review
// (an offline Teams meeting confirming the schedule and assignments), then
// separately record that approval was granted — only that second step
// actually notifies staff. Re-running approval after adding more activities
// later only notifies staff about the newly-added ones (tracked via
// notified_at), never re-notifies everyone.
export async function POST(request, { params }) {
  try {
    const access = await requireSession(request);
    if (access.error) return access.error;
    if (!access.isAdmin) return Response.json({ error: "Only administrators can manage the approval gate." }, { status: 403 });

    const { projectId } = params;
    const body = await request.json().catch(() => ({}));
    const action = body?.action;
    if (!["request_review", "approve", "reset"].includes(action)) {
      return Response.json({ error: "action must be request_review, approve or reset." }, { status: 400 });
    }

    const { data: project, error: projectError } = await access.admin
      .from("projects")
      .select("id, name, activities_approval_status")
      .eq("id", projectId)
      .maybeSingle();
    if (projectError) return Response.json({ error: projectError.message }, { status: 400 });
    if (!project) return Response.json({ error: "Project not found." }, { status: 404 });

    const now = new Date().toISOString();

    if (action === "request_review") {
      const { data: activeActivities } = await access.admin.from("project_activities").select("id", { count: "exact", head: true }).eq("project_id", projectId).eq("is_active", true);
      const { data, error } = await access.admin
        .from("projects")
        .update({ activities_approval_status: "pending_se_review", activities_se_review_requested_at: now, activities_se_review_requested_by: access.user.id })
        .eq("id", projectId)
        .select("activities_approval_status, activities_se_review_requested_at")
        .single();
      if (error) return Response.json({ error: error.message }, { status: 400 });
      return Response.json({ success: true, project: data });
    }

    if (action === "reset") {
      const { data, error } = await access.admin
        .from("projects")
        .update({ activities_approval_status: "draft", activities_se_review_requested_at: null, activities_se_review_requested_by: null })
        .eq("id", projectId)
        .select("activities_approval_status")
        .single();
      if (error) return Response.json({ error: error.message }, { status: 400 });
      return Response.json({ success: true, project: data });
    }

    // action === "approve"
    const { data: pendingActivities, error: activitiesError } = await access.admin
      .from("project_activities")
      .select("id, title, due_date, staff_user_id")
      .eq("project_id", projectId)
      .eq("is_active", true)
      .not("staff_user_id", "is", null)
      .is("notified_at", null);
    if (activitiesError) return Response.json({ error: activitiesError.message }, { status: 400 });

    const events = (pendingActivities || []).map((activity) => ({
      recipient_id: activity.staff_user_id,
      event_type: "project_activity_assigned",
      severity: "action_required",
      title: "Project activity awaiting acceptance",
      body: `${project.name}: ${activity.title}${formatDueDate(activity.due_date)}`,
      href: "/staff/notifications",
      source_table: "project_activities",
      source_id: activity.id,
    }));

    let eventWarning = null;
    if (events.length) {
      const { error: eventError } = await access.admin.from("portal_events").insert(events);
      if (eventError) eventWarning = eventError.message;
      else {
        const notifiedIds = pendingActivities.map((activity) => activity.id);
        const { error: markError } = await access.admin.from("project_activities").update({ notified_at: now }).in("id", notifiedIds);
        if (markError) eventWarning = markError.message;
      }
    }

    const { data: updatedProject, error: approveError } = await access.admin
      .from("projects")
      .update({ activities_approval_status: "approved", activities_approved_at: now, activities_approved_by: access.user.id })
      .eq("id", projectId)
      .select("activities_approval_status, activities_approved_at")
      .single();
    if (approveError) return Response.json({ error: approveError.message }, { status: 400 });

    return Response.json({ success: true, project: updatedProject, notified: events.length, event_warning: eventWarning });
  } catch (error) {
    return serverError(error);
  }
}
