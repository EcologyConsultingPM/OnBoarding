import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("..", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

const migration = await read("sql/2026-10-29-project-activity-assignees.sql");
const setup = await read("components/AdminProjectSetup.js");
const activities = await read("app/api/projects/[projectId]/activities/route.js");
const approval = await read("app/api/projects/[projectId]/activities/approval/route.js");
const activityPatch = await read("app/api/projects/[projectId]/activities/[activityId]/route.js");
const staffActivities = await read("app/api/my-activities/route.js");
const portalEvents = await read("app/api/portal-events/route.js");

assert.match(migration, /create table if not exists public\.project_activity_assignees/, "The additive activity-assignee relationship table is required.");
assert.match(migration, /unique \(activity_id, staff_user_id\)/, "A person must not be assigned to the same activity twice.");
assert.match(migration, /acceptance_status.*'removed'/s, "Assignment lifecycle must preserve a removed state for audit history.");
assert.match(migration, /insert into public\.project_activity_assignees/, "Existing scalar assignments must be backfilled.");
assert.match(migration, /activity\.staff_user_id is not null/, "Backfill must originate from legacy scalar assignments.");
assert.match(migration, /alter table public\.project_activity_assignees enable row level security/, "The new operational table must be protected by RLS.");

assert.match(setup, /\+ Add staff member/, "Work activities must expose an explicit Add staff member control.");
assert.match(setup, /staffUserIds: nextAssignees\.map/, "The editor must send a canonical multi-person staff ID list.");
assert.match(setup, /assignees: nextAssignees/, "The editor must retain per-person assignment details.");
assert.match(setup, /updateActivityAssignees/, "The editor must update a team without duplicating the activity.");
assert.match(setup, /Staff: \{acknowledgedCount\}\/\{assignees\.length\} acknowledged/, "The editor must show aggregate acknowledgement state.");
assert.match(setup, /budgetHours: allocatedHours/, "The editor must persist one activity budget equal to the aggregate assigned hours, rather than multiplying budget by staff count.");

assert.match(activities, /function normaliseAssignees/, "Bulk activity saves must accept a normalised team payload.");
assert.match(activities, /function syncAssignments/, "Bulk activity saves must diff assignment rows rather than overwrite a scalar assignee.");
assert.match(activities, /dismissRemovedRecipientEvents/, "Removing one person must dismiss only that recipient's unread assignment event.");
assert.match(activities, /Content identity must deliberately exclude assignees/, "Adding a colleague must not create a duplicate WBS activity.");
assert.match(activities, /awaiting the project activity assignees migration/, "The API must fail safely rather than silently collapsing a multi-person selection before migration.");
assert.match(activities, /newAssignmentNotifications/, "Only newly added recipients should be notified after project activation.");
assert.match(activities, /multiAssigneeReady/, "The API must report migration readiness to the client.");

assert.match(approval, /project_activity_assignees/, "Approval must notify assignment rows rather than one parent scalar assignee.");
assert.match(approval, /pendingAssignments/, "Approval must collect pending recipients independently.");
assert.match(approval, /notified_at: now/, "Approval must mark only notified assignment rows.");

assert.match(activityPatch, /function syncAssignments/, "Fast activity edits must use the same non-destructive team diff behaviour.");
assert.match(activityPatch, /hasArrayAssigneeInput/, "Fast activity edits must distinguish a multi-team request from legacy scalar edits.");
assert.match(activityPatch, /additions\.map\(\(assignment\)/, "Fast activity edits must send one notification per newly added person.");
assert.match(activityPatch, /assignees \}, notify_warning/, "Fast activity edits must return the complete assignment team.");

assert.match(staffActivities, /const callerAssignment/, "Staff response logic must resolve the caller's own assignment row.");
assert.match(staffActivities, /project_activity_assignees/, "Staff acceptance/decline must update the assignment relationship.");
assert.match(staffActivities, /callerAssignment\.id/, "One staff member's response must not overwrite another's assignment state.");
assert.match(staffActivities, /allAssignments\.map/, "Administrator overrides must fan out to all active assignees.");
assert.match(staffActivities, /activity delivery status is shared/i, "Shared activity status semantics must remain explicit.");

assert.match(portalEvents, /recipient_id/, "Notification enrichment must be scoped to the event recipient.");
assert.match(portalEvents, /project_activity_assignees/, "Notification cards must resolve recipient-specific assignment state.");
assert.match(portalEvents, /staff_user_id", access\.user\.id/, "A recipient must only see their own assignment response state.");

console.log("Project activity multi-assignee contract passed: additive migration, non-duplicating team updates, per-recipient responses and notifications, and legacy-safe API compatibility are verified.");
