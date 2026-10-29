import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("..", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

const staffTracker = await read("app/api/project-tracker-entries/route.js");
const capacity = await read("app/api/admin/staff-capacity/route.js");
const staffCapacity = await read("app/api/staff/capacity/route.js");
const adminTracker = await read("app/api/admin/project-tracker/route.js");
const autoGenerate = await read("app/api/projects/[projectId]/tracker/auto-generate/route.js");
const projectDetail = await read("app/api/projects/[projectId]/route.js");
const projectList = await read("app/api/projects/route.js");

for (const [label, source] of [
  ["staff tracker", staffTracker],
  ["capacity planner", capacity],
  ["admin tracker", adminTracker],
  ["tracker generator", autoGenerate],
  ["project detail", projectDetail],
  ["project list", projectList],
]) {
  assert.match(source, /project_activity_assignees/, `${label} must query the multi-assignee relation.`);
  assert.match(source, /assignmentTableUnavailable/, `${label} must preserve a table/schema-cache fallback.`);
  assert.match(source, /acceptance_status", "removed"/, `${label} must ignore removed assignment rows.`);
}

assert.match(staffTracker, /ownAssignment = assignmentResult\.rows\.find\(\(row\) => row\.staff_user_id === targetStaffUserId\)/, "Tracker entry validation must locate the caller's own join-table assignment.");
assert.match(staffTracker, /\["accepted", "actioned"\]\.includes\(ownAssignment\.acceptance_status\)/, "Tracker time logging must be gated by the individual assignment acceptance state.");
assert.match(staffTracker, /if \(activity\.locked\) return \{ error: "This activity is locked/, "Tracker time logging must keep locked shared activities blocked.");
assert.match(staffTracker, /assignees,\s*staffNames:/, "The tracker team board must serialize all assignees and names.");
assert.match(staffTracker, /isMine: assignmentResult\.available\s*\? assignmentRows\.some\(\(row\) => row\.staff_user_id === access\.user\.id\)/, "The tracker team board must mark shared work as mine for each assigned caller.");
assert.match(staffTracker, /\.eq\("id", current\.activity_id\);/, "Correcting a shared activity entry must update shared delivery state without scalar staff filtering.");

assert.match(capacity, /assignmentCapacityHours\(activity, assignment, assignmentRows\)/, "Capacity must derive each person's work from their assignment allocation.");
assert.match(capacity, /return parentBudget \/ count;/, "Unsplit multi-assignee legacy rows must use the documented equitable fallback.");
assert.match(capacity, /capacityActivities = activeActivities\.flatMap/, "Capacity must emit flattened per-assignee activity rows.");
assert.match(capacity, /staff_user_id: assignment\.staff_user_id/, "Each capacity event must identify the assignment's staff member.");
assert.match(capacity, /budgetHours: number\(activity\.assignment_allocated_hours\)/, "Capacity event hours must use assignment allocated hours rather than the shared parent budget.");
assert.match(capacity, /activityBudgetHours: number\(activity\.budget_hours\)/, "Capacity must preserve the parent budget separately for context.");
assert.match(staffCapacity, /capacityData\(access, rangeStart, rangeEnd\)/, "The staff capacity endpoint must reuse the assignment-aware shared capacity producer.");

assert.match(projectDetail, /assignmentResult\.error \? activityRows : assignedActivityRows/, "Project detail visibility must prefer accepted join-table membership when the table is available.");
assert.match(projectDetail, /assigned_staff: assignedStaff/, "Project schedule serialization must continue to expose its legacy assigned-staff field.");
assert.match(projectDetail, /assignees: assignedStaff/, "Project schedule serialization must expose all assignees.");
assert.match(projectDetail, /staffNames: \[\.\.\.new Set\(assignedStaff\.map/, "Project schedule serialization must aggregate assignee names.");
assert.match(projectList, /assignmentResult\.error \? activityResult\.data \|\| \[\] : assignedActivityRows/, "Project list visibility must use accepted join-table membership with scalar fallback only when unavailable.");

assert.match(adminTracker, /assignees,\s*staffNames: assignees\.map/, "Admin tracker activity position must serialize all assignees.");
assert.match(adminTracker, /const allocatedHours = number\(activity\.budget_hours\);/, "Admin tracker activity position must retain a single activity-level budget.");
assert.match(adminTracker, /relevantActivities\.length/, "Admin tracker health counts must remain activity-level rather than assignee-level.");
assert.match(autoGenerate, /entry\.hours \+= hours;/, "Tracker generation must add each activity's parent budget hours once.");
assert.match(autoGenerate, /hours \/ assignees\.length/, "Tracker generation must use an equitable fallback for unsplit shared allocations.");
assert.match(autoGenerate, /activity is still priced ONCE, never once per staff member/, "Tracker generation must document the non-multiplication financial guard.");

console.log("Multi-assignee dependent route contract passed: assignment-table fallback, individual tracker acceptance, shared-state updates, per-assignee capacity, project membership/serialization, and activity-level budgets are verified.");
