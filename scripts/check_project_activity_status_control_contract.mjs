import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("..", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

const staffTracker = await read("components/StaffProjectTracker.js");
const adminTracker = await read("components/AdminProjectTracker.js");
const statusRoute = await read("app/api/my-activities/route.js");
const adminTrackerRoute = await read("app/api/admin/project-tracker/route.js");
const setup = await read("components/AdminProjectSetup.js");
const projectRoute = await read("app/api/projects/[projectId]/route.js");
const styles = await read("app/globals.css");

assert.match(staffTracker, /id: "activities", label: "Work activities"/, "Staff Project Tracker must expose a Work activities tab.");
assert.match(staffTracker, /You can update only work allocated to you/, "Staff must be told their update permission is limited to their own assignments.");
assert.match(staffTracker, /saveActivityStatus/, "Staff work activity status must have a save handler.");
assert.match(staffTracker, /\/api\/my-activities\?id=\$\{activity\.id\}/, "Staff work activity status must call the protected status API.");
assert.match(staffTracker, /Pause reason/, "Staff must provide a reason when pausing an activity.");

assert.match(statusRoute, /const adminOverride = access\.isAdmin && body\?\.administratorOverride === true/, "The status API must recognise an explicit administrator override.");
assert.match(statusRoute, /adminOverride \? "admin\.projects\.tracker" : "staff\.projects\.activities"/, "The override must require tracker-administration access.");
assert.match(statusRoute, /overrideReason\.length < 10/, "Administrator overrides must require an audit reason.");
assert.match(statusRoute, /Administrator override:/, "Administrator override reasons must be retained in the activity audit record.");
assert.match(statusRoute, /project_activity_history/, "Activity status changes must remain auditable.");
assert.match(statusRoute, /recipientId = adminOverride \? existing\.staff_user_id/, "An administrator override must notify the assigned staff member.");
assert.match(statusRoute, /refreshLinkedSchedule/, "Activity changes must refresh the linked schedule.");
assert.match(statusRoute, /Assign this activity to a staff member before recording an administrator status override/, "Unassigned activities must be protected from non-notifiable overrides.");

assert.match(adminTracker, /Administrator override/, "The administrator tracker must render a labelled override panel.");
assert.match(adminTracker, /Save status override/, "The administrator tracker must expose a save status override action.");
assert.match(adminTracker, /administratorOverride: true/, "The administrator tracker must call the explicit override contract.");
assert.match(adminTracker, /activityOverride\.reason\.trim\(\)\.length < 10/, "The administrator tracker must make the audit reason visibly mandatory.");
assert.match(adminTracker, /!row\.staffUserId/, "The administrator tracker must disable overrides for unassigned activity rows.");
assert.match(adminTrackerRoute, /progressPercent: number\(activity\.progress_percent\)/, "The admin tracker must provide the current activity completion percentage to the override editor.");
assert.match(adminTrackerRoute, /staffUserId: activity\.staff_user_id \|\| null/, "The admin tracker must provide assignment identity to the override editor.");
assert.match(styles, /\.apt-activity-override/, "The administrator override panel must have dedicated visual styling.");

const overseeingIndex = setup.indexOf("Select Overseeing Senior Ecologist");
const leadIndex = setup.indexOf("Select Project Lead");
assert.ok(overseeingIndex >= 0 && leadIndex >= 0 && overseeingIndex < leadIndex, "Overseeing Senior Ecologist must appear before Project Lead in setup.");
const selectorSegment = setup.slice(overseeingIndex - 500, leadIndex + 500);
assert.match(selectorSegment, /value=\{project\.overseeing_senior_ecologist_user_id/, "The first selector must remain bound to Overseeing Senior Ecologist data.");
assert.match(selectorSegment, /value=\{project\.project_lead_user_id/, "The second selector must remain bound to Project Lead data.");

assert.doesNotMatch(setup, /Mark complete/, "Work Activities setup must not expose a duplicate direct-completion action.");
assert.match(setup, /Set delivery status and completion in the next <strong>Schedule<\/strong> step/, "Work Activities must direct administrators to Schedule for delivery progress updates.");
assert.match(setup, /Save activities & continue to Schedule/, "The Work Activities primary action must save the plan and lead directly to Schedule.");
assert.match(setup, /updateScheduleStatus/, "Schedule status changes must use the dedicated Schedule update handler.");
assert.match(setup, /updateScheduleProgress/, "Schedule completion changes must use the dedicated Schedule update handler.");
assert.match(setup, /status === "completed" \? 100/, "Completing a Schedule line must set completion to 100%.");

assert.match(projectRoute, /let linkedActivityUpdates = 0/, "Schedule saves must track linked Work Activity updates.");
assert.match(projectRoute, /\.eq\("schedule_item_id", savedItem\.id\)/, "Schedule saves must locate linked Work Activities by schedule item.");
assert.match(projectRoute, /locked: savedItem\.locked === true/, "The Schedule lock must apply to linked staff work activities.");
assert.match(projectRoute, /project_activity_history/, "Schedule-driven Work Activity changes must remain auditable.");
assert.match(projectRoute, /linkedActivityUpdates/, "Schedule saves must return the number of linked Work Activities updated.");

console.log("Project activity status contract passed: staff own-status updates, audited administrator overrides, Schedule-led setup progress, staff notices and requested project-team selector order are verified.");
