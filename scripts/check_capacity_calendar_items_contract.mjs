import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("..", import.meta.url);
const read = (file) => readFile(new URL(file, root), "utf8");

const planner = await read("components/StaffCapacityPlanner.js");
const route = await read("app/api/admin/staff-capacity/route.js");
const styles = await read("app/globals.css");

assert.match(planner, /Add calendar item/, "The planner control must make its broader task-or-leave purpose clear.");
assert.match(planner, /itemType: "task"/, "A new calendar item must default safely to a manual task.");
assert.match(planner, /Manual task/, "The dialog must offer a Manual task option.");
assert.match(planner, /Approved leave/, "The dialog must offer an Approved leave option.");
assert.match(planner, /action: "create_approved_leave"/, "Leave must use the protected administrator capacity endpoint.");
assert.match(planner, /leaveType: manualTaskModal\.leaveType/, "The selected leave category must be sent to the server.");
assert.match(planner, /Add approved leave & notify/, "The leave save action must explain its immediate notification effect.");
assert.match(planner, /assigned_to: manualTaskModal\.assignedTo/, "Manual task creation must retain the existing task-assignment recipient contract.");

assert.match(route, /body\?\.action === "create_approved_leave"/, "The capacity API must provide an explicit approved-leave action.");
assert.match(route, /const LEAVE_TYPES = \{/, "The capacity API must limit direct entries to recognised leave categories.");
assert.match(route, /request_type: "leave"/, "Calendar leave must be stored as a leave service request, not a planner-only record.");
assert.match(route, /status: "approved"/, "Direct calendar leave must be approved immediately.");
assert.match(route, /decision_status: "approved"/, "Direct calendar leave must retain decision-state parity.");
assert.match(route, /created_by: staffUserId/, "The leave record must belong to the selected staff member.");
assert.match(route, /reviewed_by: access\.user\.id/, "The administrator who recorded leave must be accountable.");
assert.match(route, /administrator_created: true/, "The leave details must record its direct-calendar provenance.");
assert.match(route, /approved_leave_created_from_calendar/, "Calendar-created leave must be written to the audit log.");
assert.match(route, /service_request_approved/, "The staff member must receive a leave notification.");
assert.match(route, /href: "\/staff\/service-requests"/, "The leave notification must send staff to their request record.");

assert.match(styles, /\.scp-calendar-item-type/, "The calendar item selector must have dedicated portal styling.");

console.log("Capacity calendar items contract passed: manual tasks retain their assignment flow and administrator-approved leave creates a notified, auditable capacity record.");
