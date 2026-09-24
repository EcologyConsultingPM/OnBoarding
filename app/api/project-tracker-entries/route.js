import { requireSession, serverError } from "../../../lib/serverAuth";
import { requirePortalResource } from "../../../lib/portalVisibility";
import { listDirectoryUsers } from "../../../lib/staffDirectory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATUSES = new Set(["not_commenced", "active", "need_info", "paused_other", "qa_review", "completed"]);

function jsonError(error, status = 400) { return Response.json({ error }, { status }); }
function unavailable(error) { const code = String(error?.code || ""); const message = String(error?.message || "").toLowerCase(); return code === "42P01" || code === "PGRST205" || message.includes("does not exist") || message.includes("schema cache"); }
function validId(value) { return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || "")); }
function text(value, maximum = 5000) { return typeof value === "string" ? value.trim().slice(0, maximum) : ""; }
function hours(value) { const result = Number(value); return Number.isFinite(result) && result >= 0 && result <= 24 ? result : null; }

// `includeOtherActiveProjects` supplies the time-entry picker with active,
// tracker-enabled projects that have a staff-visible allocation. It deliberately
// does not grant the staff member project-board visibility or a work-activity
// assignment; it only lets them record genuine ad-hoc time against a controlled
// allocation when they have worked on a project outside their formal allocation.
export async function eligibleProjects(access, staffUserId = access.user.id, includeOtherActiveProjects = false) {
  const { data: staffAllocations, error: allocationError } = await access.admin.from("project_allocations").select("project_id, active").eq("staff_user_id", staffUserId);
  if (allocationError) throw new Error(allocationError.message);
  const assignedIds = new Set((staffAllocations || []).filter((row) => row.active !== false).map((row) => row.project_id).filter(Boolean));
  const ids = [...assignedIds];
  if (!ids.length && !includeOtherActiveProjects) return { available: true, projects: [] };

  let projectsResult;
  if (includeOtherActiveProjects) {
    projectsResult = await access.admin.from("projects").select("id, name, client_name, status").is("deleted_at", null).eq("status", "active");
  } else {
    projectsResult = await access.admin.from("projects").select("id, name, client_name, status").in("id", ids).is("deleted_at", null).eq("status", "active");
  }
  if (projectsResult.error) throw new Error(projectsResult.error.message);
  const projectIds = (projectsResult.data || []).map((project) => project.id);
  if (!projectIds.length) return { available: true, projects: [] };

  const [settingsResult, templatesResult, sourcesResult, trackerAllocationsResult] = await Promise.all([
    access.admin.from("project_tracker_settings").select("project_id, tracker_visible").in("project_id", projectIds),
    access.admin.from("project_tracker_templates").select("project_id, template_name, instructions, category_options, column_definitions, guidance_rows, locked").in("project_id", projectIds),
    // Staff receive a single project-level budget position in the Overview.
    // Itemised allocation dollars, rates, delivery costs and profitability stay
    // administrator-only; only the approved total, actual spend and balance are
    // calculated for an allocated project's tracker summary.
    access.admin.from("project_budget_sources").select("id, project_id, source_code, source_name, approval_status, approved_value, approved_hours").in("project_id", projectIds).eq("approval_status", "approved"),
    access.admin.from("project_budget_allocations").select("id, project_id, budget_source_id, allocation_code, allocation_name, status, staff_visible, allocation_hours, hours_consumed, charge_out_spend").in("project_id", projectIds).eq("status", "active"),
  ]);
  if ([settingsResult, templatesResult, sourcesResult, trackerAllocationsResult].some((result) => result.error && unavailable(result.error))) return { available: false, projects: [] };
  const failed = [projectsResult, settingsResult, templatesResult, sourcesResult, trackerAllocationsResult].find((result) => result.error);
  if (failed?.error) throw new Error(failed.error.message);
  const visible = new Set((settingsResult.data || []).filter((setting) => setting.tracker_visible).map((setting) => setting.project_id));
  const templateByProject = new Map((templatesResult.data || []).filter((template) => template.locked).map((template) => [template.project_id, template]));
  const sources = sourcesResult.data || [];
  const allocationBySource = new Map();
  (trackerAllocationsResult.data || []).forEach((allocation) => { if (!allocationBySource.has(allocation.budget_source_id)) allocationBySource.set(allocation.budget_source_id, []); allocationBySource.get(allocation.budget_source_id).push(allocation); });
  return {
    available: true,
    projects: (projectsResult.data || [])
      .filter((project) => visible.has(project.id) && templateByProject.has(project.id))
      .map((project) => {
        const projectSources = sources.filter((source) => source.project_id === project.id);
        const sourceIds = new Set(projectSources.map((source) => source.id));
        const projectAllocations = (trackerAllocationsResult.data || []).filter((allocation) => allocation.project_id === project.id && sourceIds.has(allocation.budget_source_id));
        const isAssigned = assignedIds.has(project.id);
        const projectEntry = {
          id: project.id,
          name: project.name,
          clientName: isAssigned ? project.client_name || "Client not recorded" : "",
          isAssigned,
          template: templateByProject.get(project.id),
          sources: projectSources.map((source) => ({
            id: source.id,
            source_code: source.source_code,
            source_name: source.source_name,
            approval_status: source.approval_status,
            allocations: (allocationBySource.get(source.id) || []).filter((allocation) => allocation.staff_visible === true).map((allocation) => ({
              id: allocation.id,
              project_id: allocation.project_id,
              budget_source_id: allocation.budget_source_id,
              allocation_code: allocation.allocation_code,
              allocation_name: allocation.allocation_name,
              status: allocation.status,
              staff_visible: allocation.staff_visible,
              allocation_hours: allocation.allocation_hours,
              hours_consumed: allocation.hours_consumed,
            })),
          })),
        };
        // The broader ad hoc-entry picker must never disclose the financial
        // position of a project the staff member is not allocated to. It gives
        // only the approved entry categories and staff-visible allocation name.
        if (!includeOtherActiveProjects || isAssigned) {
          const budget = projectSources.reduce((sum, source) => sum + Number(source.approved_value || 0), 0);
          const actualSpend = projectAllocations.reduce((sum, allocation) => sum + Number(allocation.charge_out_spend || 0), 0);
          projectEntry.financials = {
            budget,
            actualSpend,
            remainingBudget: budget - actualSpend,
            budgetHours: projectSources.reduce((sum, source) => sum + Number(source.approved_hours || 0), 0),
          };
        }
        return projectEntry;
      })
      .filter((project) => (includeOtherActiveProjects ? project.sources.some((source) => source.allocations.length > 0) : project.isAssigned)),
  };
}

export async function refreshTrackerAllocation(access, projectId, allocationId) {
  const [{ data: entryRows, error: sumError }, { data: projectRates }, { data: projectDefault }] = await Promise.all([
    access.admin.from("project_tracker_entries").select("hours, staff_user_id").eq("budget_allocation_id", allocationId).limit(10000),
    access.admin.from("project_allocations").select("staff_user_id, hourly_rate").eq("project_id", projectId),
    access.admin.from("projects").select("default_hourly_rate").eq("id", projectId).maybeSingle(),
  ]);
  if (sumError) throw new Error(sumError.message);
  const consumed = (entryRows || []).reduce((sum, row) => sum + Number(row.hours || 0), 0);
  const rateByStaff = new Map((projectRates || []).map((row) => [row.staff_user_id, Number(row.hourly_rate) || 0]));
  const defaultRate = Number(projectDefault?.default_hourly_rate) || 0;
  const chargeOutSpend = (entryRows || []).reduce((sum, row) => {
    // Team members can legitimately submit ad hoc time before an individual
    // allocation/rate is added. Preserve the project default-rate fallback.
    const rate = rateByStaff.get(row.staff_user_id) || defaultRate;
    return sum + Number(row.hours || 0) * rate;
  }, 0);
  const internalCost = chargeOutSpend * 0.6;
  const { error: allocationError } = await access.admin.from("project_budget_allocations").update({
    hours_consumed: consumed,
    charge_out_spend: Math.round(chargeOutSpend * 100) / 100,
    internal_cost: Math.round(internalCost * 100) / 100,
    updated_by: access.user.id,
    updated_at: new Date().toISOString(),
  }).eq("id", allocationId).eq("project_id", projectId);
  if (allocationError) throw new Error(allocationError.message);
}

async function ownEntries(access) {
  let result = await access.admin.from("project_tracker_entries").select("id, project_id, budget_source_id, budget_allocation_id, activity_id, work_date, activity_category, activity_information, hours, status, notable_issues, custom_data, created_at, updated_at, project:projects!project_tracker_entries_project_id_fkey(name, client_name), allocation:project_budget_allocations!project_tracker_entries_budget_allocation_id_fkey(allocation_code, allocation_name), activity:project_activities!project_tracker_entries_activity_id_fkey(title)").eq("staff_user_id", access.user.id).order("work_date", { ascending: false }).order("created_at", { ascending: false }).limit(500);
  if (result.error && unavailable(result.error)) {
    result = await access.admin.from("project_tracker_entries").select("id, project_id, budget_source_id, budget_allocation_id, work_date, activity_category, activity_information, hours, status, notable_issues, custom_data, created_at, updated_at, project:projects!project_tracker_entries_project_id_fkey(name, client_name), allocation:project_budget_allocations!project_tracker_entries_budget_allocation_id_fkey(allocation_code, allocation_name)").eq("staff_user_id", access.user.id).order("work_date", { ascending: false }).order("created_at", { ascending: false }).limit(500);
  }
  if (result.error) { if (unavailable(result.error)) return { available: false, entries: [] }; throw new Error(result.error.message); }
  return { available: true, entries: (result.data || []).map((entry) => ({ id: entry.id, projectId: entry.project_id, projectName: entry.project?.name || "Unrecorded project", projectClient: entry.project?.client_name || "", sourceId: entry.budget_source_id, allocationId: entry.budget_allocation_id, allocation: entry.allocation ? `${entry.allocation.allocation_code} · ${entry.allocation.allocation_name}` : "Unallocated", activityId: entry.activity_id || null, activityTitle: entry.activity?.title || "", workDate: entry.work_date, category: entry.activity_category, information: entry.activity_information, hours: entry.hours, status: entry.status, notableIssues: entry.notable_issues || "", customData: entry.custom_data || {}, createdAt: entry.created_at, updatedAt: entry.updated_at })) };
}

// Every person allocated to a project needs to see the same picture: the live
  // shared hours position and what their colleagues have already logged.
// `ownEntries` is deliberately self-scoped, so this adds a sibling that is
// scoped to a SINGLE project and gated on the caller being allocated to that
// project (or an admin). It never returns rows for projects the caller is not
// on, so "per assigned project" is enforced server-side rather than by the UI.
async function teamEntries(access, projectId, eligible) {
  const allowed = access.isAdmin || (eligible.projects || []).some((project) => project.id === projectId);
  if (!allowed) return { allowed: false, entries: [], team: [] };

  let result = await access.admin
    .from("project_tracker_entries")
    .select("id, project_id, staff_user_id, budget_allocation_id, activity_id, work_date, activity_category, activity_information, hours, status, notable_issues, created_at, updated_at, allocation:project_budget_allocations!project_tracker_entries_budget_allocation_id_fkey(allocation_code, allocation_name), activity:project_activities!project_tracker_entries_activity_id_fkey(title)")
    .eq("project_id", projectId)
    .order("work_date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(1000);
  if (result.error && unavailable(result.error)) {
    result = await access.admin
      .from("project_tracker_entries")
      .select("id, project_id, staff_user_id, budget_allocation_id, work_date, activity_category, activity_information, hours, status, notable_issues, created_at, updated_at, allocation:project_budget_allocations!project_tracker_entries_budget_allocation_id_fkey(allocation_code, allocation_name)")
      .eq("project_id", projectId)
      .order("work_date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(1000);
  }
  if (result.error) {
    if (unavailable(result.error)) return { allowed: true, available: false, entries: [], team: [] };
    throw new Error(result.error.message);
  }

  const rows = result.data || [];

  // Name resolution is best-effort: if the directory lookup fails the board
  // still renders, just with ids replaced by a neutral label rather than
  // failing the whole request.
  let nameById = new Map();
  try {
    const directory = await listDirectoryUsers(access.admin);
    nameById = new Map((directory || []).map((person) => [person.id, person.name || person.email]));
  } catch { nameById = new Map(); }

  const [allocationsResult, activitiesResult] = await Promise.all([
    // This staff route never returns itemised allocation dollar values, rates,
    // costs or profitability. Those stay in the administrator tracker.
    access.admin.from("project_budget_allocations").select("id, allocation_code, allocation_name, allocation_hours, hours_consumed, staff_visible, status").eq("project_id", projectId),
    access.admin.from("project_activities").select("id, title, detail, task_category, staff_user_id, status, acceptance_status, progress_percent, due_date, budget_hours").eq("project_id", projectId).eq("is_active", true),
  ]);
  const hoursByStaff = new Map();
  rows.forEach((row) => {
    hoursByStaff.set(row.staff_user_id, (hoursByStaff.get(row.staff_user_id) || 0) + Number(row.hours || 0));
  });

  const allActiveAllocations = (allocationsResult.error ? [] : allocationsResult.data || [])
    .filter((allocation) => allocation.status === "active");
  // The allocation table shows only items the Project Manager marked visible.
  const allocations = allActiveAllocations
    .filter((allocation) => allocation.staff_visible === true)
    .map((allocation) => ({
      id: allocation.id,
      code: allocation.allocation_code,
      name: allocation.allocation_name,
      budgetHours: Number(allocation.allocation_hours || 0),
      hoursConsumed: Number(allocation.hours_consumed || 0),
      hoursRemaining: Number(allocation.allocation_hours || 0) - Number(allocation.hours_consumed || 0),
    }));

  const activities = (activitiesResult.error ? [] : activitiesResult.data || []).map((activity) => ({
    id: activity.id,
    title: activity.title,
    detail: activity.detail || "",
    taskCategory: activity.task_category || "",
    staffUserId: activity.staff_user_id,
    staffName: nameById.get(activity.staff_user_id) || "Unassigned",
    status: activity.status,
    acceptanceStatus: activity.acceptance_status,
    progressPercent: activity.progress_percent,
    dueDate: activity.due_date || null,
    budgetHours: activity.budget_hours ?? null,
    isMine: activity.staff_user_id === access.user.id,
  }));

  return {
    allowed: true,
    available: true,
    allocations,
    activities,
    totals: {
      budgetHours: allActiveAllocations.reduce((sum, allocation) => sum + Number(allocation.allocation_hours || 0), 0),
      hoursConsumed: allActiveAllocations.reduce((sum, allocation) => sum + Number(allocation.hours_consumed || 0), 0),
      hoursRemaining: allActiveAllocations.reduce((sum, allocation) => sum + Number(allocation.allocation_hours || 0) - Number(allocation.hours_consumed || 0), 0),
      entryCount: rows.length,
      contributorCount: hoursByStaff.size,
    },
    team: [...hoursByStaff.entries()]
      .map(([staffUserId, totalHours]) => ({
        staffUserId,
        staffName: nameById.get(staffUserId) || "Team member",
        totalHours: Math.round(totalHours * 100) / 100,
        isMine: staffUserId === access.user.id,
      }))
      .sort((a, b) => b.totalHours - a.totalHours),
    entries: rows.map((entry) => ({
      id: entry.id,
      projectId: entry.project_id,
      staffUserId: entry.staff_user_id,
      staffName: nameById.get(entry.staff_user_id) || "Team member",
      isMine: entry.staff_user_id === access.user.id,
      allocation: entry.allocation ? `${entry.allocation.allocation_code} · ${entry.allocation.allocation_name}` : "Unallocated",
      activityTitle: entry.activity?.title || "",
      workDate: entry.work_date,
      category: entry.activity_category,
      information: entry.activity_information,
      hours: entry.hours,
      status: entry.status,
      notableIssues: entry.notable_issues || "",
      createdAt: entry.created_at,
      updatedAt: entry.updated_at,
    })),
  };
}

export async function GET(request) {
  try {
    const access = await requireSession(request); if (access.error) return access.error;
    const denied = await requirePortalResource(access, "staff.projects.tracker"); if (denied) return denied;
    const [eligible, entryEligible, entries] = await Promise.all([eligibleProjects(access), eligibleProjects(access, access.user.id, true), ownEntries(access)]);

    // ?projectId=<uuid> additionally returns the shared team board for that one
    // project. Omitted => unchanged legacy response, so existing callers and any
    // cached client bundle keep working.
    const requestedProject = String(new URL(request.url).searchParams.get("projectId") || "").trim();
    let board = null;
    if (requestedProject) {
      if (!validId(requestedProject)) return jsonError("A valid project is required.");
      const team = await teamEntries(access, requestedProject, eligible);
      if (!team.allowed) return jsonError("You are not allocated to this project.", 403);
      board = team;
    }

    return Response.json({ ready: eligible.available && entryEligible.available && entries.available, eligibleProjects: eligible.projects, entryProjects: entryEligible.projects, entries: entries.entries, board });
  } catch (error) { return serverError(error); }
}

// Core "create one tracker entry" logic, used by both the single-entry POST
// handler below and the bulk-process route for the daily timesheet staging
// feature. Returns { error, status } on failure or { entry, project,
// allocation } on success — never throws, and never touches the HTTP layer,
// so a bulk caller can process many of these without one failure aborting
// the request or needing try/catch gymnastics around Response objects.
export async function createTrackerEntry(access, input, targetStaffUserId = access.user.id) {
  const isOnBehalf = targetStaffUserId !== access.user.id;
  const allowOtherProject = !isOnBehalf && input?.entryContext === "other_project";
  const projectId = String(input?.projectId || ""); const sourceId = String(input?.sourceId || ""); const allocationId = String(input?.allocationId || ""); const activityId = String(input?.activityId || "");
  const workDate = text(input?.workDate, 10); const activityCategory = text(input?.activityCategory, 120); const activityInformation = text(input?.activityInformation, 5000); const notableIssues = text(input?.notableIssues, 5000); const amount = hours(input?.hours); const status = String(input?.status || "");
  if (!validId(projectId) || !validId(sourceId) || !validId(allocationId)) return { error: "Choose an eligible project, budget source and allocation.", status: 400 };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(workDate) || !activityCategory || !activityInformation || amount === null || !STATUSES.has(status)) return { error: "Work date, activity category, activity information, hours and a valid status are required.", status: 400 };
  if (status !== "not_commenced" && amount <= 0) return { error: "Active, paused and completed entries must record positive hours.", status: 400 };

  const eligibility = await eligibleProjects(access, targetStaffUserId, allowOtherProject);
  if (!eligibility.available) return { error: "Project Tracker entries are awaiting the approved tracker migration.", status: 409 };
  const project = eligibility.projects.find((item) => item.id === projectId);
  if (!project) return { error: isOnBehalf ? "This Project Tracker is not enabled, or this staff member has no active allocation on it, or its template is not locked." : "This Project Tracker is not enabled, allocated to you, or its template is not locked. To log ad hoc work, choose Other active project first.", status: 403 };
  const isOtherProjectEntry = project.isAssigned !== true;
  if (isOtherProjectEntry && !allowOtherProject) return { error: "Choose Other active project before recording time for a project you are not allocated to.", status: 403 };
  if (isOtherProjectEntry && activityId) return { error: "Ad hoc project time cannot be linked to another staff member's assigned activity. Record it as general project work instead.", status: 403 };
  const source = project.sources.find((item) => item.id === sourceId);
  const allocation = source?.allocations.find((item) => item.id === allocationId);
  if (!source || !allocation) return { error: "Choose an active staff-visible budget allocation for this project.", status: 403 };
  if (!(project.template.category_options || []).includes(activityCategory)) return { error: "Choose an activity category from the locked project template.", status: 400 };
  const customData = input?.customData && typeof input.customData === "object" && !Array.isArray(input.customData) ? input.customData : {};
  for (const column of project.template.column_definitions || []) { if (column?.required && !text(String(customData[column.key] || ""), 5000)) return { error: `${column.label || "A custom field"} is required by the locked tracker template.`, status: 400 }; }

  let linkedActivity = null;
  if (activityId) {
    if (!validId(activityId)) return { error: "Choose a valid assigned activity.", status: 400 };
    const { data: activity, error: activityError } = await access.admin
      .from("project_activities")
      .select("id, title, project_id, staff_user_id, acceptance_status, locked, progress_percent, schedule_item_id")
      .eq("id", activityId)
      .eq("project_id", projectId)
      .eq("staff_user_id", targetStaffUserId)
      .eq("is_active", true)
      .maybeSingle();
    if (activityError) return { error: activityError.message, status: 400 };
    if (!activity) return { error: "That assigned activity is not available for this project.", status: 403 };
    if (!["accepted", "actioned"].includes(activity.acceptance_status)) return { error: "Accept this activity before recording tracker work against it.", status: 409 };
    if (activity.locked) return { error: "This activity is locked for project-lead review.", status: 409 };
    linkedActivity = activity;
  }

  const now = new Date().toISOString();
  const { data: entry, error: entryError } = await access.admin.from("project_tracker_entries").insert({ project_id: projectId, budget_source_id: sourceId, budget_allocation_id: allocationId, activity_id: linkedActivity?.id || null, staff_user_id: targetStaffUserId, entered_by_admin_id: isOnBehalf ? access.user.id : null, work_date: workDate, activity_category: activityCategory, activity_information: activityInformation, hours: amount, status, notable_issues: notableIssues || null, custom_data: customData, created_at: now, updated_at: now }).select("id, activity_id, work_date, activity_category, activity_information, hours, status, notable_issues, custom_data, created_at").single();
  if (entryError) return { error: entryError.message, status: 400 };

  if (isOtherProjectEntry) {
    const { error: auditError } = await access.admin.from("project_tracker_entry_audit").insert({
      project_id: projectId,
      tracker_entry_id: entry.id,
      action: "ad_hoc_entered",
      reason: "Staff recorded an ad hoc time entry for work completed outside their current project allocation.",
      before_data: {},
      after_data: entry,
      performed_by: access.user.id,
    });
    if (auditError) return { error: `Entry was saved, but its ad hoc time audit record could not be saved: ${auditError.message}`, status: 500 };
  }

    try {
      await refreshTrackerAllocation(access, projectId, allocationId);
    } catch (refreshError) {
      return { error: `Entry was saved, but allocation consumption could not be updated: ${refreshError.message}`, status: 500 };
    }

    if (linkedActivity) {
      const nextProgress = status === "completed" ? 100 : Number(linkedActivity.progress_percent || 0);
      const { error: activityUpdateError } = await access.admin
        .from("project_activities")
        .update({ status, progress_percent: nextProgress, pause_reason: status === "paused_other" ? notableIssues || null : null, started_at: status === "active" ? now : undefined, completed_at: status === "completed" ? now : undefined, updated_at: now })
        .eq("id", linkedActivity.id);
      if (activityUpdateError) return { error: `Tracker entry was saved, but the linked activity could not be updated: ${activityUpdateError.message}`, status: 500 };
      if (linkedActivity.schedule_item_id) {
        const { data: linkedActivities, error: linkedActivitiesError } = await access.admin
          .from("project_activities")
          .select("status, progress_percent")
          .eq("schedule_item_id", linkedActivity.schedule_item_id)
          .eq("is_active", true);
        if (linkedActivitiesError) return { error: `Tracker entry was saved, but Gantt progress could not be calculated: ${linkedActivitiesError.message}`, status: 500 };
        const rows = linkedActivities || [];
        const averageProgress = rows.length ? Math.round((rows.reduce((sum, row) => sum + Number(row.progress_percent || 0), 0) / rows.length) * 100) / 100 : 0;
        const statusSet = new Set(rows.map((row) => row.status));
        const scheduleStatus = statusSet.has("need_info") ? "need_info" : statusSet.has("paused_other") ? "paused_other" : statusSet.has("qa_review") ? "qa_review" : statusSet.has("active") ? "active" : rows.length && [...statusSet].every((value) => value === "completed") ? "completed" : "not_commenced";
        const { error: scheduleError } = await access.admin
          .from("project_schedule_items")
          .update({ progress_percent: averageProgress, status: scheduleStatus, updated_at: now })
          .eq("id", linkedActivity.schedule_item_id);
        if (scheduleError) return { error: `Tracker entry was saved, but Gantt progress could not be updated: ${scheduleError.message}`, status: 500 };
      }
    }

    const { data: owner } = await access.admin.from("projects").select("created_by, name").eq("id", projectId).maybeSingle();
    if (owner?.created_by && owner.created_by !== access.user.id) await access.admin.from("portal_events").insert({ recipient_id: owner.created_by, event_type: "project_tracker_entry", severity: status === "paused_other" ? "action_required" : "information", title: `Project Tracker entry: ${project.name}`, body: `${activityCategory} · ${amount} hours · ${status.replaceAll("_", " ")}${notableIssues ? " · notable issue recorded" : ""}.`, href: "/?workspace=adminprojects", source_table: "project_tracker_entries", source_id: entry.id });
    // On-behalf-of entries change someone's own timesheet without them
    // typing it in — they need to know it happened, not just discover it.
    if (isOnBehalf) await access.admin.from("portal_events").insert({ recipient_id: targetStaffUserId, event_type: "project_tracker_entry_on_behalf", severity: "information", title: `Timesheet entry added on your behalf: ${project.name}`, body: `An admin logged ${activityCategory} · ${amount} hours · ${workDate} for you, marked as a missed entry.`, href: "/staff/project-tracker", source_table: "project_tracker_entries", source_id: entry.id });

  return { entry: { id: entry.id, projectId, projectName: project.name, projectClient: project.clientName, allocation: `${allocation.allocation_code} · ${allocation.allocation_name}`, activityId: entry.activity_id || null, activityTitle: linkedActivity?.title || "", workDate: entry.work_date, category: entry.activity_category, information: entry.activity_information, hours: entry.hours, status: entry.status, notableIssues: entry.notable_issues || "", customData: entry.custom_data || {}, createdAt: entry.created_at } };
}

export async function POST(request) {
  try {
    const access = await requireSession(request); if (access.error) return access.error;
    const denied = await requirePortalResource(access, "staff.projects.tracker"); if (denied) return denied;
    const body = await request.json();
    const result = await createTrackerEntry(access, body);
    if (result.error) return jsonError(result.error, result.status || 400);
    return Response.json(result, { status: 201 });
  } catch (error) { return serverError(error); }
}

// Staff can correct only their own submitted tracker rows. The original and
// corrected values are retained in the immutable tracker audit table, then the
// allocation position is recalculated so project reporting stays accurate.
export async function PATCH(request) {
  try {
    const access = await requireSession(request); if (access.error) return access.error;
    const denied = await requirePortalResource(access, "staff.projects.tracker"); if (denied) return denied;
    const body = await request.json();
    const id = String(body?.id || "");
    if (!validId(id)) return jsonError("A valid tracker entry is required.");

    const { data: current, error: currentError } = await access.admin.from("project_tracker_entries")
      .select("id, project_id, budget_allocation_id, staff_user_id, activity_id, work_date, activity_category, activity_information, hours, status, notable_issues, custom_data")
      .eq("id", id).maybeSingle();
    if (currentError) return jsonError(currentError.message);
    if (!current || current.staff_user_id !== access.user.id) return jsonError("Your tracker entry was not found.", 404);

    const workDate = text(body?.workDate, 10);
    const activityCategory = text(body?.activityCategory, 120);
    const activityInformation = text(body?.activityInformation, 5000);
    const notableIssues = text(body?.notableIssues, 5000);
    const amount = hours(body?.hours);
    const status = String(body?.status || "");
    const customData = body?.customData && typeof body.customData === "object" && !Array.isArray(body.customData) ? body.customData : current.custom_data || {};
    if (!/^\d{4}-\d{2}-\d{2}$/.test(workDate) || !activityCategory || !activityInformation || amount === null || !STATUSES.has(status)) {
      return jsonError("Work date, activity category, activity information, hours and a valid status are required.");
    }
    if (status !== "not_commenced" && amount <= 0) return jsonError("Active, paused and completed entries must record positive hours.");

    const now = new Date().toISOString();
    const { data: entry, error: updateError } = await access.admin.from("project_tracker_entries").update({
      work_date: workDate,
      activity_category: activityCategory,
      activity_information: activityInformation,
      hours: amount,
      status,
      notable_issues: notableIssues || null,
      custom_data: customData,
      updated_at: now,
    }).eq("id", id).select("id, project_id, budget_allocation_id, activity_id, work_date, activity_category, activity_information, hours, status, notable_issues, custom_data, created_at, updated_at").single();
    if (updateError) return jsonError(updateError.message);

    const { error: auditError } = await access.admin.from("project_tracker_entry_audit").insert({
      project_id: current.project_id,
      tracker_entry_id: id,
      action: "staff_corrected",
      reason: "Staff self-correction recorded through the Staff Portal.",
      before_data: current,
      after_data: entry,
      performed_by: access.user.id,
    });
    if (auditError) return jsonError(`Entry was corrected but its mandatory audit record could not be saved: ${auditError.message}`, 500);

    try {
      await refreshTrackerAllocation(access, current.project_id, current.budget_allocation_id);
    } catch (refreshError) {
      return jsonError(`Entry was corrected, but allocation totals could not be refreshed: ${refreshError.message}`, 500);
    }
    if (current.activity_id) {
      await access.admin.from("project_activities").update({
        status,
        progress_percent: status === "completed" ? 100 : undefined,
        pause_reason: status === "paused_other" ? notableIssues || null : null,
        updated_at: now,
      }).eq("id", current.activity_id).eq("staff_user_id", access.user.id);
    }
    const { data: owner } = await access.admin.from("projects").select("created_by, name").eq("id", current.project_id).maybeSingle();
    if (owner?.created_by && owner.created_by !== access.user.id) {
      await access.admin.from("portal_events").insert({
        recipient_id: owner.created_by,
        event_type: "project_tracker_entry_updated",
        severity: status === "paused_other" ? "action_required" : "information",
        title: `Staff corrected a Project Tracker entry: ${owner.name || "Project"}`,
        body: `${activityCategory} · ${amount} hours · ${workDate}. The original and correction are retained in the tracker audit trail.`,
        href: "/?workspace=adminprojects",
        source_table: "project_tracker_entries",
        source_id: id,
      });
    }
    return Response.json({ entry: { id: entry.id, projectId: entry.project_id, workDate: entry.work_date, category: entry.activity_category, information: entry.activity_information, hours: entry.hours, status: entry.status, notableIssues: entry.notable_issues || "", customData: entry.custom_data || {}, updatedAt: entry.updated_at } });
  } catch (error) { return serverError(error); }
}
