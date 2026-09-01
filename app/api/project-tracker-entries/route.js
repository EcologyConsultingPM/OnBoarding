import { requireSession, serverError } from "../../../lib/serverAuth";
import { requirePortalResource } from "../../../lib/portalVisibility";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATUSES = new Set(["not_commenced", "active", "need_info", "paused_other", "qa_review", "completed"]);

function jsonError(error, status = 400) { return Response.json({ error }, { status }); }
function unavailable(error) { const code = String(error?.code || ""); const message = String(error?.message || "").toLowerCase(); return code === "42P01" || code === "PGRST205" || message.includes("does not exist") || message.includes("schema cache"); }
function validId(value) { return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || "")); }
function text(value, maximum = 5000) { return typeof value === "string" ? value.trim().slice(0, maximum) : ""; }
function hours(value) { const result = Number(value); return Number.isFinite(result) && result >= 0 && result <= 24 ? result : null; }

async function eligibleProjects(access) {
  const { data: staffAllocations, error: allocationError } = await access.admin.from("project_allocations").select("project_id, active").eq("staff_user_id", access.user.id);
  if (allocationError) throw new Error(allocationError.message);
  const ids = [...new Set((staffAllocations || []).filter((row) => row.active !== false).map((row) => row.project_id).filter(Boolean))];
  if (!ids.length) return { available: true, projects: [] };

  const [projectsResult, settingsResult, templatesResult, sourcesResult, trackerAllocationsResult] = await Promise.all([
    access.admin.from("projects").select("id, name, client_name, status").in("id", ids).eq("status", "active"),
    access.admin.from("project_tracker_settings").select("project_id, tracker_visible").in("project_id", ids),
    access.admin.from("project_tracker_templates").select("project_id, template_name, instructions, category_options, column_definitions, guidance_rows, locked").in("project_id", ids),
    access.admin.from("project_budget_sources").select("id, project_id, source_code, source_name, approval_status").in("project_id", ids).eq("approval_status", "approved"),
    access.admin.from("project_budget_allocations").select("id, project_id, budget_source_id, allocation_code, allocation_name, status, staff_visible").in("project_id", ids).eq("status", "active").eq("staff_visible", true),
  ]);
  if ([settingsResult, templatesResult, sourcesResult, trackerAllocationsResult].some((result) => result.error && unavailable(result.error))) return { available: false, projects: [] };
  const failed = [projectsResult, settingsResult, templatesResult, sourcesResult, trackerAllocationsResult].find((result) => result.error);
  if (failed?.error) throw new Error(failed.error.message);
  const visible = new Set((settingsResult.data || []).filter((setting) => setting.tracker_visible).map((setting) => setting.project_id));
  const templateByProject = new Map((templatesResult.data || []).filter((template) => template.locked).map((template) => [template.project_id, template]));
  const sources = sourcesResult.data || [];
  const allocationBySource = new Map();
  (trackerAllocationsResult.data || []).forEach((allocation) => { if (!allocationBySource.has(allocation.budget_source_id)) allocationBySource.set(allocation.budget_source_id, []); allocationBySource.get(allocation.budget_source_id).push(allocation); });
  return { available: true, projects: (projectsResult.data || []).filter((project) => visible.has(project.id) && templateByProject.has(project.id)).map((project) => ({ id: project.id, name: project.name, clientName: project.client_name || "Client not recorded", template: templateByProject.get(project.id), sources: sources.filter((source) => source.project_id === project.id).map((source) => ({ ...source, allocations: allocationBySource.get(source.id) || [] })) })) };
}

async function ownEntries(access) {
  let result = await access.admin.from("project_tracker_entries").select("id, project_id, budget_source_id, budget_allocation_id, activity_id, work_date, activity_category, activity_information, hours, status, notable_issues, custom_data, created_at, updated_at, project:projects!project_tracker_entries_project_id_fkey(name, client_name), allocation:project_budget_allocations!project_tracker_entries_budget_allocation_id_fkey(allocation_code, allocation_name), activity:project_activities!project_tracker_entries_activity_id_fkey(title)").eq("staff_user_id", access.user.id).order("work_date", { ascending: false }).order("created_at", { ascending: false }).limit(500);
  if (result.error && unavailable(result.error)) {
    result = await access.admin.from("project_tracker_entries").select("id, project_id, budget_source_id, budget_allocation_id, work_date, activity_category, activity_information, hours, status, notable_issues, custom_data, created_at, updated_at, project:projects!project_tracker_entries_project_id_fkey(name, client_name), allocation:project_budget_allocations!project_tracker_entries_budget_allocation_id_fkey(allocation_code, allocation_name)").eq("staff_user_id", access.user.id).order("work_date", { ascending: false }).order("created_at", { ascending: false }).limit(500);
  }
  if (result.error) { if (unavailable(result.error)) return { available: false, entries: [] }; throw new Error(result.error.message); }
  return { available: true, entries: (result.data || []).map((entry) => ({ id: entry.id, projectId: entry.project_id, projectName: entry.project?.name || "Unrecorded project", projectClient: entry.project?.client_name || "", allocation: entry.allocation ? `${entry.allocation.allocation_code} · ${entry.allocation.allocation_name}` : "Unallocated", activityId: entry.activity_id || null, activityTitle: entry.activity?.title || "", workDate: entry.work_date, category: entry.activity_category, information: entry.activity_information, hours: entry.hours, status: entry.status, notableIssues: entry.notable_issues || "", customData: entry.custom_data || {}, createdAt: entry.created_at, updatedAt: entry.updated_at })) };
}

export async function GET(request) {
  try {
    const access = await requireSession(request); if (access.error) return access.error;
    const denied = await requirePortalResource(access, "staff.projects.tracker"); if (denied) return denied;
    const [eligible, entries] = await Promise.all([eligibleProjects(access), ownEntries(access)]);
    return Response.json({ ready: eligible.available && entries.available, eligibleProjects: eligible.projects, entries: entries.entries });
  } catch (error) { return serverError(error); }
}

export async function POST(request) {
  try {
    const access = await requireSession(request); if (access.error) return access.error;
    const denied = await requirePortalResource(access, "staff.projects.tracker"); if (denied) return denied;
    const body = await request.json();
    const projectId = String(body?.projectId || ""); const sourceId = String(body?.sourceId || ""); const allocationId = String(body?.allocationId || ""); const activityId = String(body?.activityId || "");
    const workDate = text(body?.workDate, 10); const activityCategory = text(body?.activityCategory, 120); const activityInformation = text(body?.activityInformation, 5000); const notableIssues = text(body?.notableIssues, 5000); const amount = hours(body?.hours); const status = String(body?.status || "");
    if (!validId(projectId) || !validId(sourceId) || !validId(allocationId)) return jsonError("Choose an eligible project, budget source and allocation.");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(workDate) || !activityCategory || !activityInformation || amount === null || !STATUSES.has(status)) return jsonError("Work date, activity category, activity information, hours and a valid status are required.");
    if (status !== "not_commenced" && amount <= 0) return jsonError("Active, paused and completed entries must record positive hours.");

    const eligibility = await eligibleProjects(access);
    if (!eligibility.available) return jsonError("Project Tracker entries are awaiting the approved tracker migration.", 409);
    const project = eligibility.projects.find((item) => item.id === projectId);
    if (!project) return jsonError("This Project Tracker is not enabled, allocated to you, or its template is not locked.", 403);
    const source = project.sources.find((item) => item.id === sourceId);
    const allocation = source?.allocations.find((item) => item.id === allocationId);
    if (!source || !allocation) return jsonError("Choose an active staff-visible budget allocation for this project.", 403);
    if (!(project.template.category_options || []).includes(activityCategory)) return jsonError("Choose an activity category from the locked project template.", 400);
    const customData = body?.customData && typeof body.customData === "object" && !Array.isArray(body.customData) ? body.customData : {};
    for (const column of project.template.column_definitions || []) { if (column?.required && !text(String(customData[column.key] || ""), 5000)) return jsonError(`${column.label || "A custom field"} is required by the locked tracker template.`); }

    let linkedActivity = null;
    if (activityId) {
      if (!validId(activityId)) return jsonError("Choose a valid assigned activity.");
      const { data: activity, error: activityError } = await access.admin
        .from("project_activities")
        .select("id, title, project_id, staff_user_id, acceptance_status, locked, progress_percent, schedule_item_id")
        .eq("id", activityId)
        .eq("project_id", projectId)
        .eq("staff_user_id", access.user.id)
        .eq("is_active", true)
        .maybeSingle();
      if (activityError) return jsonError(activityError.message);
      if (!activity) return jsonError("That assigned activity is not available for this project.", 403);
      if (!["accepted", "actioned"].includes(activity.acceptance_status)) return jsonError("Accept this activity before recording tracker work against it.", 409);
      if (activity.locked) return jsonError("This activity is locked for project-lead review.", 409);
      linkedActivity = activity;
    }

    const now = new Date().toISOString();
    const { data: entry, error: entryError } = await access.admin.from("project_tracker_entries").insert({ project_id: projectId, budget_source_id: sourceId, budget_allocation_id: allocationId, activity_id: linkedActivity?.id || null, staff_user_id: access.user.id, work_date: workDate, activity_category: activityCategory, activity_information: activityInformation, hours: amount, status, notable_issues: notableIssues || null, custom_data: customData, created_at: now, updated_at: now }).select("id, activity_id, work_date, activity_category, activity_information, hours, status, notable_issues, custom_data, created_at").single();
    if (entryError) return jsonError(entryError.message);

    const { data: entryRows, error: sumError } = await access.admin.from("project_tracker_entries").select("hours").eq("budget_allocation_id", allocationId).limit(10000);
    if (sumError) return jsonError(`Entry was saved, but allocation consumption could not be calculated: ${sumError.message}`, 500);
    const consumed = (entryRows || []).reduce((sum, row) => sum + Number(row.hours || 0), 0);
    const { error: allocationError } = await access.admin.from("project_budget_allocations").update({ hours_consumed: consumed, updated_by: access.user.id, updated_at: now }).eq("id", allocationId).eq("project_id", projectId);
    if (allocationError) return jsonError(`Entry was saved, but allocation consumption could not be updated: ${allocationError.message}`, 500);

    if (linkedActivity) {
      const nextProgress = status === "completed" ? 100 : Number(linkedActivity.progress_percent || 0);
      const { error: activityUpdateError } = await access.admin
        .from("project_activities")
        .update({ status, progress_percent: nextProgress, pause_reason: status === "paused_other" ? notableIssues || null : null, started_at: status === "active" ? now : undefined, completed_at: status === "completed" ? now : undefined, updated_at: now })
        .eq("id", linkedActivity.id);
      if (activityUpdateError) return jsonError(`Tracker entry was saved, but the linked activity could not be updated: ${activityUpdateError.message}`, 500);
      if (linkedActivity.schedule_item_id) {
        const { data: linkedActivities, error: linkedActivitiesError } = await access.admin
          .from("project_activities")
          .select("status, progress_percent")
          .eq("schedule_item_id", linkedActivity.schedule_item_id)
          .eq("is_active", true);
        if (linkedActivitiesError) return jsonError(`Tracker entry was saved, but Gantt progress could not be calculated: ${linkedActivitiesError.message}`, 500);
        const rows = linkedActivities || [];
        const averageProgress = rows.length ? Math.round((rows.reduce((sum, row) => sum + Number(row.progress_percent || 0), 0) / rows.length) * 100) / 100 : 0;
        const statusSet = new Set(rows.map((row) => row.status));
        const scheduleStatus = statusSet.has("need_info") ? "need_info" : statusSet.has("paused_other") ? "paused_other" : statusSet.has("qa_review") ? "qa_review" : statusSet.has("active") ? "active" : rows.length && [...statusSet].every((value) => value === "completed") ? "completed" : "not_commenced";
        const { error: scheduleError } = await access.admin
          .from("project_schedule_items")
          .update({ progress_percent: averageProgress, status: scheduleStatus, updated_at: now })
          .eq("id", linkedActivity.schedule_item_id);
        if (scheduleError) return jsonError(`Tracker entry was saved, but Gantt progress could not be updated: ${scheduleError.message}`, 500);
      }
    }

    const { data: owner } = await access.admin.from("projects").select("created_by, name").eq("id", projectId).maybeSingle();
    if (owner?.created_by && owner.created_by !== access.user.id) await access.admin.from("portal_events").insert({ recipient_id: owner.created_by, event_type: "project_tracker_entry", severity: status === "paused_other" ? "action" : "information", title: `Project Tracker entry: ${project.name}`, body: `${activityCategory} · ${amount} hours · ${status.replaceAll("_", " ")}${notableIssues ? " · notable issue recorded" : ""}.`, href: "/?portal=admin&area=adminprojects", source_table: "project_tracker_entries", source_id: entry.id });

    return Response.json({ entry: { id: entry.id, projectId, projectName: project.name, projectClient: project.clientName, allocation: `${allocation.allocation_code} · ${allocation.allocation_name}`, activityId: entry.activity_id || null, activityTitle: linkedActivity?.title || "", workDate: entry.work_date, category: entry.activity_category, information: entry.activity_information, hours: entry.hours, status: entry.status, notableIssues: entry.notable_issues || "", customData: entry.custom_data || {}, createdAt: entry.created_at } }, { status: 201 });
  } catch (error) { return serverError(error); }
}
