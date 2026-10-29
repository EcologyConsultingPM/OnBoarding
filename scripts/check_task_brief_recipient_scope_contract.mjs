import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("..", import.meta.url);
const read = (file) => readFile(new URL(file, root), "utf8");

const tasksComponent = await read("components/RemoteTasks.js");
const tasksRoute = await read("app/api/remote-tasks/route.js");
const staffNotifications = await read("components/StaffNotifications.js");
const capacityRoute = await read("app/api/admin/staff-capacity/route.js");

assert.match(tasksComponent, /\/api\/remote-tasks\?scope=mine/, "The staff-facing Task Briefs component must request the recipient-only scope.");
assert.match(tasksComponent, /const endpoint = isAdmin \? "\/api\/remote-tasks" : "\/api\/remote-tasks\?scope=mine"/, "Only the administrator Task Briefs workspace may request the team-wide queue.");
assert.match(tasksRoute, /const recipientOnly = scope === "mine" \|\| !access\.isAdmin;/, "The Task Brief API must enforce recipient-only scope on the server.");
assert.match(tasksRoute, /if \(recipientOnly\) query = query\.eq\("assigned_to", access\.user\.id\);/, "Recipient-only task views must be limited to the signed-in staff member.");
assert.match(staffNotifications, /<RemoteTasks\s+isAdmin=\{false\}/, "The Staff Notifications workspace must remain staff-mode rather than team-management mode.");
assert.match(capacityRoute, /request_type: "leave"/, "Approved leave must continue to use a leave record, not a Task Brief.");
assert.match(capacityRoute, /event_type: "service_request_approved"/, "Approved leave must notify the directly affected staff member as information.");

console.log("Task Brief recipient-scope contract passed: the Staff Notifications workspace requests and receives only the signed-in staff member’s Task Briefs; approved leave remains an informational leave record.");
