import { requireSession, serverError } from "../../../../../../lib/serverAuth";
import { generateTrackerFromActivities } from "../../tracker/auto-generate/route";

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

    // Approval used to be the end of the road — an admin then had to
    // separately click "Auto-generate tracker from Work Activities" and
    // separately click "Enable staff timesheets" (which locks a template
    // and flips a visibility flag) before the project's tracker actually
    // did anything useful for staff. All three are now one action: approval
    // itself generates the accurate per-category budget, locks a standard
    // tracker template if one isn't already locked, and makes the tracker
    // visible — never overwriting an admin's own customised template.
    let trackerWarning = null;
    // Must exactly match TASK_CATEGORIES in components/AdminProjectSetup.js —
    // this was previously typed independently and drifted (different casing/
    // spacing, "Preparation" missing its parenthetical), which meant a
    // staff member's category choice from this template's dropdown wouldn't
    // string-match the category already recorded on the activity, silently
    // misallocating hours_consumed to the wrong budget bucket on any
    // subsequent tracker regeneration.
    const STANDARD_TRACKER_CATEGORIES = ["Desktop/Field plan", "Preparation (pre-fieldwork, pre-report set up)", "Fieldwork & travel", "Data Management", "Reporting", "GIS/Mapping", "QA Review", "Client Consultation", "General Project Management", "Other"];
    try {
      const generated = await generateTrackerFromActivities(access, projectId);
      if (generated.error && !generated.skipped) trackerWarning = generated.error;

      const { data: existingTemplate, error: templateError } = await access.admin
        .from("project_tracker_templates")
        .select("id, category_options, locked")
        .eq("project_id", projectId)
        .maybeSingle();
      if (templateError) throw new Error(templateError.message);
      if (!existingTemplate) {
        const { error } = await access.admin.from("project_tracker_templates").insert({
          project_id: projectId,
          template_name: "Project Tracker",
          instructions: "Record project activity accurately and identify issues requiring project-lead review.",
          category_options: STANDARD_TRACKER_CATEGORIES,
          column_definitions: [],
          guidance_rows: [],
          locked: true,
          locked_by: access.user.id,
          locked_at: now,
          created_by: access.user.id,
          updated_by: access.user.id,
        });
        if (error) throw new Error(error.message);
      } else if (!existingTemplate.locked) {
        const categories = Array.isArray(existingTemplate.category_options) && existingTemplate.category_options.length ? existingTemplate.category_options : STANDARD_TRACKER_CATEGORIES;
        const { error } = await access.admin.from("project_tracker_templates").update({
          category_options: categories, locked: true, locked_by: access.user.id, locked_at: now, updated_by: access.user.id, updated_at: now,
        }).eq("id", existingTemplate.id);
        if (error) throw new Error(error.message);
      }

      const { data: currentSettings } = await access.admin.from("project_tracker_settings").select("*").eq("project_id", projectId).maybeSingle();
      const { error: settingsError } = await access.admin.from("project_tracker_settings").upsert({
        project_id: projectId,
        tracker_visible: true,
        resources_ready: currentSettings?.resources_ready ?? false,
        training_checked: currentSettings?.training_checked ?? false,
        forms_configured: currentSettings?.forms_configured ?? false,
        whs_checked: currentSettings?.whs_checked ?? false,
        activated_by: currentSettings?.activated_by || access.user.id,
        activated_at: currentSettings?.activated_at || now,
        updated_by: access.user.id,
        updated_at: now,
      }, { onConflict: "project_id" });
      if (settingsError) throw new Error(settingsError.message);

      let team = [];
      const teamResult = await access.admin.from("project_allocations").select("staff_user_id").eq("project_id", projectId).eq("active", true);
      if (teamResult.error) {
        const fallback = await access.admin.from("project_allocations").select("staff_user_id").eq("project_id", projectId);
        team = fallback.data || [];
      } else {
        team = teamResult.data || [];
      }
      const recipients = [...new Set(team.map((row) => row.staff_user_id).filter(Boolean))];
      if (recipients.length) {
        await access.admin.from("portal_events").insert(recipients.map((recipientId) => ({
          recipient_id: recipientId,
          event_type: "project_tracker_enabled",
          severity: "information",
          title: "Project Tracker access available",
          body: `You can now log project activity and timesheet reference entries for ${project.name}.`,
          href: "/staff/projects",
          source_table: "project_tracker_settings",
          source_id: projectId,
        })));
      }
    } catch (trackerError) {
      trackerWarning = trackerWarning || trackerError.message;
    }

    return Response.json({ success: true, project: updatedProject, notified: events.length, event_warning: eventWarning, tracker_warning: trackerWarning });
  } catch (error) {
    return serverError(error);
  }
}
