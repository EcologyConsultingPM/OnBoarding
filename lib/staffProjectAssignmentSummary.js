const COUNTED_STATES = ["awaiting_response", "accepted", "actioned"];
const PAGE_SIZE = 500;
const ACTIVITY_BATCH_SIZE = 200;

export function emptyStaffProjectAssignmentSummary() {
  return { assigned: 0, awaitingResponse: 0, accepted: 0, actioned: 0 };
}

// Page the caller's relationship rows first, not the globally limited activity
// candidate list used by /api/my-activities. Shared work counts for every active
// recipient, regardless of the parent's legacy scalar staff_user_id.
async function readPages(queryForPage) {
  const rows = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const result = await queryForPage().range(offset, offset + PAGE_SIZE - 1);
    if (result.error) return { data: [], error: result.error };
    rows.push(...(result.data || []));
    if ((result.data || []).length < PAGE_SIZE) return { data: rows, error: null };
  }
}

export async function loadStaffProjectAssignments(admin, staffUserId, legacyProjectIds, assignmentTableUnavailable) {
  const result = await readPages(() => admin.from("project_activity_assignees")
    .select("id, activity_id, staff_user_id, acceptance_status, removed_at")
    .eq("staff_user_id", staffUserId)
    .in("acceptance_status", COUNTED_STATES)
    .is("removed_at", null)
    .order("id", { ascending: true }));
  if (result.error) {
    if (!assignmentTableUnavailable(result.error)) throw new Error(result.error.message);
    // Before the join-table migration, use only the caller's scalar activities
    // on already allocated projects. This fallback must NOT expand membership.
    const projectIds = [...new Set((legacyProjectIds || []).filter(Boolean))];
    const activities = [];
    for (let offset = 0; offset < projectIds.length; offset += ACTIVITY_BATCH_SIZE) {
      const legacy = await readPages(() => admin.from("project_activities")
        .select("id, project_id, staff_user_id, acceptance_status, is_active")
        .eq("staff_user_id", staffUserId)
        .in("project_id", projectIds.slice(offset, offset + ACTIVITY_BATCH_SIZE))
        .eq("is_active", true)
        .order("id", { ascending: true }));
      if (legacy.error) throw new Error(legacy.error.message);
      activities.push(...legacy.data);
    }
    return {
      legacy: true,
      activities,
      rows: activities.map((activity) => ({
        activity_id: activity.id,
        staff_user_id: activity.staff_user_id,
        acceptance_status: activity.acceptance_status,
      })),
    };
  }

  const activityIds = [...new Set(result.data.map((row) => row.activity_id).filter(Boolean))];
  const activities = [];
  for (let offset = 0; offset < activityIds.length; offset += ACTIVITY_BATCH_SIZE) {
    const linked = await readPages(() => admin.from("project_activities")
      .select("id, project_id, is_active")
      .in("id", activityIds.slice(offset, offset + ACTIVITY_BATCH_SIZE))
      .eq("is_active", true)
      .order("id", { ascending: true }));
    if (linked.error) throw new Error(linked.error.message);
    activities.push(...linked.data);
  }
  return { legacy: false, rows: result.data, activities };
}

export function summarizeStaffProjectAssignments(rows, activities, staffUserId) {
  const activeById = new Map((activities || [])
    .filter((activity) => activity.is_active === true)
    .map((activity) => [activity.id, activity]));
  const summaries = new Map();
  const counted = new Set();
  for (const row of rows || []) {
    if (row.staff_user_id !== staffUserId || row.removed_at || !COUNTED_STATES.includes(row.acceptance_status)) continue;
    const activity = activeById.get(row.activity_id);
    if (!activity?.project_id || counted.has(activity.id)) continue;
    counted.add(activity.id);
    if (!summaries.has(activity.project_id)) summaries.set(activity.project_id, emptyStaffProjectAssignmentSummary());
    const summary = summaries.get(activity.project_id);
    summary.assigned += 1;
    summary[row.acceptance_status === "awaiting_response" ? "awaitingResponse" : row.acceptance_status] += 1;
  }
  return summaries;
}

function validSummary(summary) {
  return summary && ["assigned", "awaitingResponse", "accepted", "actioned"]
    .every((key) => Number.isInteger(summary[key]) && summary[key] >= 0)
    && summary.assigned === summary.awaitingResponse + summary.accepted + summary.actioned;
}

export function staffProjectCardLabels(project, ownActivities = null, trackerAvailable = true) {
  let summary = trackerAvailable && validSummary(project?.assignmentSummary) ? project.assignmentSummary : null;
  // Compatibility with an older tracker service: keep all fetched recipient
  // statuses for the card, independently of the accepted/actioned action list.
  // A failed request, explicit unavailable summary, or a capped response is NOT
  // an empty assignment list and must never manufacture a zero.
  if (trackerAvailable && project?.assignmentSummary === undefined && Array.isArray(ownActivities) && ownActivities.length < 200) {
    summary = emptyStaffProjectAssignmentSummary();
    const seen = new Set();
    for (const activity of ownActivities) {
      const status = activity.acceptanceStatus || activity.acceptance_status;
      if ((activity.projectId || activity.project_id) !== project.id || activity.is_active === false || activity.removed_at || !COUNTED_STATES.includes(status) || seen.has(activity.id)) continue;
      seen.add(activity.id);
      summary.assigned += 1;
      summary[status === "awaiting_response" ? "awaitingResponse" : status] += 1;
    }
  }
  let allocation = "Your allocated hours are unavailable";
  if (trackerAvailable && project?.hasActiveAllocation === false) {
    allocation = "No project hours allocated to you";
  } else if (trackerAvailable && project?.allocatedHours === null && project?.hasActiveAllocation === true) {
    allocation = "Your allocated hours are not set";
  } else if (trackerAvailable && project?.allocatedHours !== undefined && project?.allocatedHours !== null && project?.allocatedHours !== "" && Number.isFinite(Number(project.allocatedHours)) && Number(project.allocatedHours) >= 0) {
    allocation = `${new Intl.NumberFormat("en-AU", { maximumFractionDigits: 2 }).format(Number(project.allocatedHours))} h allocated to you`;
  }
  return {
    assigned: summary ? `${summary.assigned} assigned work activit${summary.assigned === 1 ? "y" : "ies"}` : "Assigned work activities unavailable",
    awaitingResponse: summary ? `${summary.awaitingResponse} awaiting your response` : "Awaiting-response count unavailable",
    allocation,
  };
}
