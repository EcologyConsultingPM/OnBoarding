import { requireSession, serverError } from "../../../lib/serverAuth";
import { requirePortalResource } from "../../../lib/portalVisibility";
import { eligibleProjects } from "../project-tracker-entries/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATUSES = new Set(["not_commenced", "active", "paused_other", "qa_review", "completed"]);
const DRAFT_COLUMNS = "id, project_id, budget_source_id, budget_allocation_id, activity_id, work_date, activity_category, activity_information, hours, status, notable_issues, custom_data, processed, processed_at, tracker_entry_id, error_message, created_at, updated_at";

function jsonError(error, status = 400) {
  return Response.json({ error }, { status });
}
function validId(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ""));
}
function text(value, maximum = 5000) {
  return typeof value === "string" ? value.trim().slice(0, maximum) : "";
}
function hours(value) {
  const result = Number(value);
  return Number.isFinite(result) && result >= 0 && result <= 24 ? result : null;
}

// The daily sheet: everything not yet processed, for today's work-in-progress
// view, plus recent processed history so staff can see past submissions.
export async function GET(request) {
  try {
    const access = await requireSession(request); if (access.error) return access.error;
    const denied = await requirePortalResource(access, "staff.projects.tracker"); if (denied) return denied;

    const [eligible, draftsResult] = await Promise.all([
      eligibleProjects(access),
      access.admin.from("staff_timesheet_drafts").select(DRAFT_COLUMNS).eq("staff_user_id", access.user.id).order("processed_at", { ascending: false, nullsFirst: true }).order("created_at", { ascending: true }).limit(500),
    ]);
    if (draftsResult.error) return jsonError(draftsResult.error.message);

    const projectById = new Map(eligible.projects.map((project) => [project.id, project]));
    const rows = (draftsResult.data || []).map((row) => {
      const project = projectById.get(row.project_id);
      const source = project?.sources.find((item) => item.id === row.budget_source_id);
      const allocation = source?.allocations.find((item) => item.id === row.budget_allocation_id);
      return {
        id: row.id,
        projectId: row.project_id,
        projectName: project?.name || "Project no longer available",
        sourceId: row.budget_source_id,
        allocationId: row.budget_allocation_id,
        allocationLabel: allocation ? `${allocation.allocation_code} · ${allocation.allocation_name}` : "",
        activityId: row.activity_id,
        workDate: row.work_date,
        category: row.activity_category,
        information: row.activity_information,
        hours: row.hours,
        status: row.status,
        notableIssues: row.notable_issues || "",
        customData: row.custom_data || {},
        processed: row.processed,
        processedAt: row.processed_at,
        trackerEntryId: row.tracker_entry_id,
        errorMessage: row.error_message,
        createdAt: row.created_at,
      };
    });

    return Response.json({
      ready: eligible.available,
      eligibleProjects: eligible.projects,
      pending: rows.filter((row) => !row.processed),
      history: rows.filter((row) => row.processed),
    });
  } catch (error) { return serverError(error); }
}

// Adds one row to today's staging sheet. Deliberately lighter validation
// than the real entry creation — this is a scratchpad staff fill in through
// the day, so it only checks the project/source/allocation are a real
// eligible combination and the work date is well-formed. Everything else
// (category against the locked template, activity acceptance, required
// custom fields) is validated properly at Process time, when it actually
// becomes a real tracker entry — so a staff member can save a part-filled
// row and come back to finish it without losing anything.
export async function POST(request) {
  try {
    const access = await requireSession(request); if (access.error) return access.error;
    const denied = await requirePortalResource(access, "staff.projects.tracker"); if (denied) return denied;
    const body = await request.json();

    const projectId = String(body?.projectId || "");
    const sourceId = String(body?.sourceId || "");
    const allocationId = String(body?.allocationId || "");
    const activityId = body?.activityId ? String(body.activityId) : null;
    const workDate = text(body?.workDate, 10);
    if (!validId(projectId) || !validId(sourceId) || !validId(allocationId)) return jsonError("Choose an eligible project, budget source and allocation.");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(workDate)) return jsonError("Choose a valid work date.");
    if (activityId && !validId(activityId)) return jsonError("Choose a valid activity.");

    const eligible = await eligibleProjects(access);
    if (!eligible.available) return jsonError("Project Tracker entries are awaiting the approved tracker migration.", 409);
    const project = eligible.projects.find((item) => item.id === projectId);
    if (!project) return jsonError("This Project Tracker is not enabled, allocated to you, or its template is not locked.", 403);
    const source = project.sources.find((item) => item.id === sourceId);
    if (!source || !source.allocations.find((item) => item.id === allocationId)) return jsonError("Choose an active staff-visible budget allocation for this project.", 403);

    const status = STATUSES.has(String(body?.status || "")) ? body.status : "not_commenced";
    const amount = body?.hours != null && body.hours !== "" ? hours(body.hours) : null;
    const customData = body?.customData && typeof body.customData === "object" && !Array.isArray(body.customData) ? body.customData : {};
    const now = new Date().toISOString();

    const { data, error } = await access.admin.from("staff_timesheet_drafts").insert({
      staff_user_id: access.user.id,
      project_id: projectId,
      budget_source_id: sourceId,
      budget_allocation_id: allocationId,
      activity_id: activityId,
      work_date: workDate,
      activity_category: text(body?.activityCategory, 120) || null,
      activity_information: text(body?.activityInformation, 5000) || null,
      hours: amount,
      status,
      notable_issues: text(body?.notableIssues, 5000) || null,
      custom_data: customData,
      created_at: now,
      updated_at: now,
    }).select(DRAFT_COLUMNS).single();
    if (error) return jsonError(error.message);

    return Response.json({ draft: data }, { status: 201 });
  } catch (error) { return serverError(error); }
}

// Edits an unprocessed row. Once processed, a row is a permanent audit
// record of what was submitted and can no longer be changed — RLS enforces
// this too (the update policy requires processed = false), so this is
// defence in depth, not the only thing stopping it.
export async function PATCH(request) {
  try {
    const access = await requireSession(request); if (access.error) return access.error;
    const denied = await requirePortalResource(access, "staff.projects.tracker"); if (denied) return denied;
    const body = await request.json();
    const draftId = String(body?.id || "");
    if (!validId(draftId)) return jsonError("A valid draft entry id is required.");

    const { data: current, error: currentError } = await access.admin.from("staff_timesheet_drafts").select("id, staff_user_id, processed").eq("id", draftId).maybeSingle();
    if (currentError) return jsonError(currentError.message);
    if (!current || current.staff_user_id !== access.user.id) return jsonError("Draft entry not found.", 404);
    if (current.processed) return jsonError("This entry has already been processed and can't be edited — it's a permanent record.", 409);

    const patch = { updated_at: new Date().toISOString() };
    if (body?.projectId !== undefined) patch.project_id = String(body.projectId);
    if (body?.sourceId !== undefined) patch.budget_source_id = String(body.sourceId);
    if (body?.allocationId !== undefined) patch.budget_allocation_id = String(body.allocationId);
    if (body?.activityId !== undefined) patch.activity_id = body.activityId ? String(body.activityId) : null;
    if (body?.workDate !== undefined) patch.work_date = text(body.workDate, 10);
    if (body?.activityCategory !== undefined) patch.activity_category = text(body.activityCategory, 120) || null;
    if (body?.activityInformation !== undefined) patch.activity_information = text(body.activityInformation, 5000) || null;
    if (body?.hours !== undefined) patch.hours = body.hours === "" ? null : hours(body.hours);
    if (body?.status !== undefined) patch.status = STATUSES.has(body.status) ? body.status : "not_commenced";
    if (body?.notableIssues !== undefined) patch.notable_issues = text(body.notableIssues, 5000) || null;
    if (body?.customData !== undefined && typeof body.customData === "object" && !Array.isArray(body.customData)) patch.custom_data = body.customData;

    const { data, error } = await access.admin.from("staff_timesheet_drafts").update(patch).eq("id", draftId).select(DRAFT_COLUMNS).single();
    if (error) return jsonError(error.message);
    return Response.json({ draft: data });
  } catch (error) { return serverError(error); }
}

export async function DELETE(request) {
  try {
    const access = await requireSession(request); if (access.error) return access.error;
    const denied = await requirePortalResource(access, "staff.projects.tracker"); if (denied) return denied;
    const { searchParams } = new URL(request.url);
    const draftId = searchParams.get("id");
    if (!validId(draftId)) return jsonError("A valid draft entry id is required.");

    const { data: current, error: currentError } = await access.admin.from("staff_timesheet_drafts").select("id, staff_user_id, processed").eq("id", draftId).maybeSingle();
    if (currentError) return jsonError(currentError.message);
    if (!current || current.staff_user_id !== access.user.id) return jsonError("Draft entry not found.", 404);
    if (current.processed) return jsonError("This entry has already been processed and can't be deleted — it's a permanent record.", 409);

    const { error } = await access.admin.from("staff_timesheet_drafts").delete().eq("id", draftId);
    if (error) return jsonError(error.message);
    return Response.json({ success: true });
  } catch (error) { return serverError(error); }
}
