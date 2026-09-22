import { requireSession, serverError } from "../../../../lib/serverAuth";
import { createTrackerEntry } from "../../project-tracker-entries/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function jsonError(error, status = 400) {
  return Response.json({ error }, { status });
}

const ENTRY_STATUSES = new Set(["not_commenced", "active", "need_info", "paused_other", "qa_review", "completed"]);
function validId(value) { return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || "")); }
function text(value, maximum = 5000) { return typeof value === "string" ? value.trim().slice(0, maximum) : ""; }
function validHours(value) { const result = Number(value); return Number.isFinite(result) && result >= 0 && result <= 24 ? result : null; }

async function refreshAllocation(access, projectId, allocationId) {
  const [{ data: rows, error: rowsError }, { data: rates }, { data: project }] = await Promise.all([
    access.admin.from("project_tracker_entries").select("hours, staff_user_id").eq("budget_allocation_id", allocationId).limit(10000),
    access.admin.from("project_allocations").select("staff_user_id, hourly_rate").eq("project_id", projectId),
    access.admin.from("projects").select("default_hourly_rate").eq("id", projectId).maybeSingle(),
  ]);
  if (rowsError) throw new Error(rowsError.message);
  const rateByStaff = new Map((rates || []).map((row) => [row.staff_user_id, Number(row.hourly_rate) || 0]));
  const defaultRate = Number(project?.default_hourly_rate) || 0;
  const hoursConsumed = (rows || []).reduce((sum, row) => sum + Number(row.hours || 0), 0);
  // A future team member may be allocated before their individual rate is set.
  // Their tracker corrections must still be charged at the project default.
  const chargeOutSpend = (rows || []).reduce((sum, row) => sum + Number(row.hours || 0) * (rateByStaff.get(row.staff_user_id) || defaultRate), 0);
  const internalCost = chargeOutSpend * 0.6;
  const { error } = await access.admin.from("project_budget_allocations").update({ hours_consumed: hoursConsumed, charge_out_spend: Math.round(chargeOutSpend * 100) / 100, internal_cost: Math.round(internalCost * 100) / 100, updated_by: access.user.id, updated_at: new Date().toISOString() }).eq("id", allocationId).eq("project_id", projectId);
  if (error) throw new Error(error.message);
}

// Staff eligible to have an entry logged on their behalf for this project:
// anyone with an active allocation on it, regardless of whether they have
// any tracker entries yet — that's the whole point, they're missing one.
export async function GET(request) {
  try {
    const access = await requireSession(request);
    if (access.error) return access.error;
    if (!access.isAdmin) return jsonError("Admin access required.", 403);

    const { searchParams } = new URL(request.url);
    const projectId = searchParams.get("projectId");
    if (!projectId) return jsonError("A project id is required.", 400);

    const { data: allocations, error: allocationError } = await access.admin
      .from("project_allocations")
      .select("staff_user_id, active")
      .eq("project_id", projectId)
      .eq("active", true);
    if (allocationError) return jsonError(allocationError.message, 400);

    const staffIds = [...new Set((allocations || []).map((row) => row.staff_user_id).filter(Boolean))];
    if (!staffIds.length) return Response.json({ staff: [], categoryOptions: [] });

    const [usersResult, templateResult] = await Promise.all([
      access.admin.auth.admin.listUsers({ page: 1, perPage: 1000 }),
      access.admin.from("project_tracker_templates").select("category_options, locked").eq("project_id", projectId).maybeSingle(),
    ]);
    if (usersResult.error) return jsonError(usersResult.error.message, 400);
    const nameById = new Map((usersResult.data?.users || []).map((user) => [user.id, user.user_metadata?.full_name || user.email || "Staff member"]));

    const staff = staffIds
      .map((id) => ({ id, name: nameById.get(id) || "Staff member" }))
      .sort((a, b) => a.name.localeCompare(b.name));
    const categoryOptions = templateResult.data?.locked ? (templateResult.data.category_options || []) : [];

    return Response.json({ staff, categoryOptions });
  } catch (error) {
    return serverError(error);
  }
}

// Body must include staffUserId in addition to everything createTrackerEntry
// normally expects (projectId, sourceId, allocationId, workDate, etc.) — the
// entry is created exactly as if that staff member had submitted it
// themselves, except entered_by_admin_id records who actually did it.
export async function POST(request) {
  try {
    const access = await requireSession(request);
    if (access.error) return access.error;
    if (!access.isAdmin) return jsonError("Admin access required.", 403);

    const body = await request.json();
    const staffUserId = String(body?.staffUserId || "");
    if (!staffUserId) return jsonError("Choose which staff member this entry is for.", 400);

    const result = await createTrackerEntry(access, body, staffUserId);
    if (result.error) return jsonError(result.error, result.status || 400);
    return Response.json(result, { status: 201 });
  } catch (error) {
    return serverError(error);
  }
}

export async function PATCH(request) {
  try {
    const access = await requireSession(request);
    if (access.error) return access.error;
    if (!access.isAdmin) return jsonError("Admin access required.", 403);
    const body = await request.json();
    const id = String(body?.id || "");
    if (!validId(id)) return jsonError("A valid tracker entry is required.");

    const { data: current, error: currentError } = await access.admin
      .from("project_tracker_entries")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (currentError) return jsonError(currentError.message);
    if (!current) return jsonError("Tracker entry not found.", 404);

    const workDate = text(body.workDate, 10);
    const activityCategory = text(body.activityCategory, 120);
    const activityInformation = text(body.activityInformation, 5000);
    const notableIssues = text(body.notableIssues, 5000);
    const correctionReason = text(body.correctionReason, 1000);
    // The database audit schema requires a meaningful reason. A correction
    // should not be blocked merely because the administrator has no extra
    // note to add, so retain a clear system reason in that case.
    const auditReason = correctionReason || "Administrative correction recorded without an additional note.";
    const amount = validHours(body.hours);
    const status = String(body.status || "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(workDate) || !activityCategory || !activityInformation || amount === null || !ENTRY_STATUSES.has(status)) {
      return jsonError("Work date, activity category, activity information, hours and a valid status are required.");
    }
    if (status !== "not_commenced" && amount <= 0) return jsonError("Active, paused and completed entries must record positive hours.");

    const now = new Date().toISOString();
    const { data: entry, error } = await access.admin.from("project_tracker_entries").update({
      work_date: workDate,
      activity_category: activityCategory,
      activity_information: activityInformation,
      hours: amount,
      status,
      notable_issues: notableIssues || null,
      updated_at: now,
    }).eq("id", id).select("id, project_id, staff_user_id, work_date, activity_category, activity_information, hours, status, notable_issues, updated_at").single();
    if (error) return jsonError(error.message);

    const { error: auditError } = await access.admin.from("project_tracker_entry_audit").insert({
      project_id: current.project_id,
      tracker_entry_id: id,
      action: "corrected",
      reason: auditReason,
      before_data: current,
      after_data: entry,
      performed_by: access.user.id,
    });
    if (auditError) return jsonError(`Entry was corrected but its mandatory audit record could not be saved: ${auditError.message}`, 500);

    await refreshAllocation(access, current.project_id, current.budget_allocation_id);
    if (current.activity_id) {
      await access.admin.from("project_activities").update({ status, progress_percent: status === "completed" ? 100 : undefined, updated_at: now }).eq("id", current.activity_id);
    }
    await access.admin.from("portal_events").insert({
      recipient_id: current.staff_user_id,
      event_type: "project_tracker_entry_updated",
      severity: "information",
      title: "Project Tracker entry updated",
      body: `${activityCategory} · ${amount} hours · ${workDate}. An administrator corrected this entry.`,
      href: "/staff/project-tracker",
      source_table: "project_tracker_entries",
      source_id: id,
    });
    return Response.json({ entry });
  } catch (error) {
    return serverError(error);
  }
}

export async function DELETE(request) {
  try {
    const access = await requireSession(request);
    if (access.error) return access.error;
    if (!access.isAdmin) return jsonError("Admin access required.", 403);
    const id = String(new URL(request.url).searchParams.get("id") || "");
    const body = await request.json().catch(() => ({}));
    const voidReason = text(body?.reason, 1000);
    if (!validId(id)) return jsonError("A valid tracker entry is required.");
    if (voidReason.length < 10) return jsonError("Enter a clear reason for voiding this entry (at least 10 characters).", 400);

    const { data: current, error: currentError } = await access.admin
      .from("project_tracker_entries")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (currentError) return jsonError(currentError.message);
    if (!current) return jsonError("Tracker entry not found.", 404);

    const { error: auditError } = await access.admin.from("project_tracker_entry_audit").insert({
      project_id: current.project_id,
      tracker_entry_id: id,
      action: "voided",
      reason: voidReason,
      before_data: current,
      after_data: null,
      performed_by: access.user.id,
    });
    if (auditError) return jsonError(`Entry was not removed because its mandatory audit record could not be saved: ${auditError.message}`, 500);

    const { error } = await access.admin.from("project_tracker_entries").delete().eq("id", id);
    if (error) return jsonError(error.message);
    await refreshAllocation(access, current.project_id, current.budget_allocation_id);
    await access.admin.from("portal_events").update({ dismissed_at: new Date().toISOString() }).eq("source_table", "project_tracker_entries").eq("source_id", id).is("dismissed_at", null);
    await access.admin.from("portal_events").insert({
      recipient_id: current.staff_user_id,
      event_type: "project_tracker_entry_deleted",
      severity: "review",
      title: "Project Tracker entry removed",
      body: `${current.activity_category} · ${current.hours} hours · ${current.work_date}. An administrator removed this entry.`,
      href: "/staff/project-tracker",
      source_table: "project_tracker_entry_audit",
      source_id: id,
    });
    return Response.json({ success: true, deleted: id });
  } catch (error) {
    return serverError(error);
  }
}
