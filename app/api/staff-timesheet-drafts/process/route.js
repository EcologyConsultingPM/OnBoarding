import { requireSession, serverError } from "../../../../lib/serverAuth";
import { requirePortalResource } from "../../../../lib/portalVisibility";
import { createTrackerEntry } from "../../project-tracker-entries/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DRAFT_COLUMNS = "id, project_id, budget_source_id, budget_allocation_id, activity_id, work_date, activity_category, activity_information, hours, status, notable_issues, custom_data";

function jsonError(error, status = 400) {
  return Response.json({ error }, { status });
}

// Every pending draft for this staff member is converted into a real
// project_tracker_entries row, one at a time, through createTrackerEntry —
// the exact same validated path the single-entry form uses (allocation
// consumption, linked-activity status, Gantt progress, admin notification
// all cascade identically). This is not all-or-nothing: a row that fails
// (e.g. an activity was locked after the draft was added) stays pending
// with its error recorded, while every other row still processes. Staff
// see "3 processed, 1 needs attention" rather than losing a whole day's
// work because of one bad row — the fresh sheet only truly clears once
// every row succeeds.
export async function POST(request) {
  try {
    const access = await requireSession(request); if (access.error) return access.error;
    const denied = await requirePortalResource(access, "staff.projects.tracker"); if (denied) return denied;

    const { data: pending, error: pendingError } = await access.admin
      .from("staff_timesheet_drafts")
      .select(DRAFT_COLUMNS)
      .eq("staff_user_id", access.user.id)
      .eq("processed", false)
      .order("created_at", { ascending: true });
    if (pendingError) return jsonError(pendingError.message);
    if (!pending || !pending.length) return jsonError("There's nothing on today's sheet to process yet.", 400);

    const now = new Date().toISOString();
    let processedCount = 0;
    const failures = [];

    for (const draft of pending) {
      const result = await createTrackerEntry(access, {
        projectId: draft.project_id,
        sourceId: draft.budget_source_id,
        allocationId: draft.budget_allocation_id,
        activityId: draft.activity_id,
        workDate: draft.work_date,
        activityCategory: draft.activity_category,
        activityInformation: draft.activity_information,
        hours: draft.hours,
        status: draft.status,
        notableIssues: draft.notable_issues,
        customData: draft.custom_data,
      });

      if (result.error) {
        failures.push({ id: draft.id, error: result.error });
        await access.admin.from("staff_timesheet_drafts").update({ error_message: result.error, updated_at: now }).eq("id", draft.id);
        continue;
      }

      processedCount += 1;
      await access.admin.from("staff_timesheet_drafts").update({
        processed: true,
        processed_at: now,
        tracker_entry_id: result.entry.id,
        error_message: null,
        updated_at: now,
      }).eq("id", draft.id);
    }

    return Response.json({
      success: true,
      processed: processedCount,
      failed: failures.length,
      failures,
      complete: failures.length === 0,
    });
  } catch (error) { return serverError(error); }
}
