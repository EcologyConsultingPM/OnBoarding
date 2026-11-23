import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { formatRequestDate, getRequestStaffName, getServiceRequestOverview } from "../lib/serviceRequestOverview.mjs";
import { resolveServiceRequestUsers, serviceRequestUserName } from "../lib/serviceRequestDirectory.mjs";

const root = new URL("..", import.meta.url);
const read = (file) => readFile(new URL(file, root), "utf8");
const admin = await read("components/AdminServiceRequests.js");
const staff = await read("components/StaffServiceRequests.js");
const listRoute = await read("app/api/service-requests/route.js");
const actionRoute = await read("app/api/service-requests/[requestId]/route.js");
const migration = await read("sql/2026-09-24-service-request-decision-workflow.sql");
const overview = await read("components/ServiceRequestOverview.js");

assert.match(admin, /Comment <span>\(optional\)<\/span>/, "Service Desk must retain a free-text comment box.");
assert.match(admin, /> Approve<\//, "Service Desk must offer approval.");
assert.match(admin, /> Deny<\//, "Service Desk must offer denial.");
assert.match(admin, /Close &amp; lock/, "Service Desk must offer close and lock.");
assert.doesNotMatch(admin, /Assign to staff|> Start<|> Archive<|> Return<|> Reopen<|> Unlock<|> Lock<\//, "Removed workflow actions must not remain in the review panel.");
assert.match(actionRoute, /const ADMIN_ACTIONS = new Set\(\["approve", "decline", "close"\]\)/, "The server must only accept the streamlined administrator actions.");
assert.doesNotMatch(actionRoute, /action === "assign"|action === "start"|action === "archive"|action === "reopen"|action === "unlock"|action === "lock"/, "The API must not retain removed administrative transitions.");
assert.match(actionRoute, /values\.decision_status = "approved"/, "Approvals must persist an accountable decision status.");
assert.match(actionRoute, /values\.decision_status = "declined"/, "Denials must persist an accountable decision status.");
assert.match(actionRoute, /values\.reviewed_by = access\.user\.id/, "Every decision must retain the administrator identity.");
assert.match(listRoute, /decisionBy: row\.reviewed_by/, "Request responses must resolve the decision maker.");
assert.match(staff, /request\.decisionBy/, "Staff request history must show the decision maker.");
assert.match(migration, /decision_status/, "The decision status must be stored in the schema.");

assert.match(admin, /<ServiceRequestOverview request=\{item\} staffName=\{staffName\}/, "Admin request cards use the ordered overview.");
assert.match(staff, /<ServiceRequestOverview\s+request=\{request\}/, "Staff request cards use the ordered overview.");
assert.match(staff, /Reason \(optional\)/, "A reason can be supplied without making it mandatory.");
assert.match(overview, /<details className="service-request-extra">/, "The original supplementary details remain accessible.");
assert.match(staff, /getRequestStaffName\(request, session\?\.user\)/, "Staff cards must resolve the requester for each request.");
assert.match(listRoute, /if \(!access\.isAdmin\) query = query\.eq\("created_by", access\.user\.id\)/, "Staff request responses remain scoped to their own records.");
assert.match(listRoute, /authorName: nameById\.get\(row\.created_by\)/, "The author name belongs to the record's creator.");

const leave = {
  request_type: "leave", status: "approved", decision_status: "approved", decisionBy: "Casey Smith", reviewed_at: "2026-11-23T22:20:00Z",
  details: { start_date: "2026-12-24", reason: "Family holiday", end_date: "2027-01-05", leave_type: "Annual leave", handover: "Plan shared" },
};
const leaveSummary = getServiceRequestOverview(leave, "Jordan Lee");
assert.deepEqual(leaveSummary.fields.map(({ label }) => label), ["Staff member", "Start date", "Reason", "End date", "Approved by"]);
assert.deepEqual(leaveSummary.fields.map(({ value }) => value), ["Jordan Lee", "24 Dec 2026", "Family holiday", "5 Jan 2027", "Casey Smith"]);
assert.equal(leaveSummary.fields[4].note, "24 Nov 2026, 9:20 am AEDT", "A recorded approval time remains visible and includes its timezone.");
assert.deepEqual(leaveSummary.additionalDetails.map(({ key }) => key), ["leave_type", "handover"]);
assert.equal(formatRequestDate("2026-12-24"), "24 Dec 2026", "Date-only values must not shift across time zones.");

const historical = getServiceRequestOverview({ request_type: "leave", status: "submitted", details: { leave_type: "Personal / carer’s leave" } }, "");
assert.deepEqual(historical.fields.map(({ value }) => value), ["Not recorded", "Not provided", "Not provided", "Not provided", "Awaiting decision"]);
assert.equal(historical.additionalDetails[0].value, "Personal / carer’s leave", "Leave type is not invented as a reason.");
const training = getServiceRequestOverview({ request_type: "training", status: "submitted", details: { preferred_date: "2026-12-11", business_benefit: "Maintain accreditation" } }, "Jordan Lee");
assert.equal(training.fields[1].value, "Not provided", "A preferred date is not a confirmed start date.");
assert.equal(training.fields[2].value, "Not provided", "A business benefit is not automatically a reason.");
assert.equal(training.fields[3].value, "Not provided");
assert(training.additionalDetails.some(({ key }) => key === "business_benefit"));
const equipment = getServiceRequestOverview({ request_type: "equipment", status: "submitted", due_date: "2026-12-11", details: { required_by: "2026-12-11", project_or_use: "Survey gear" } }, "Jordan Lee");
assert.equal(equipment.fields[2].value, "Not provided", "Intended use is not invented as a reason.");
assert.equal(equipment.fields[3].value, "Not provided", "A required-by date is not an end date.");
assert(equipment.additionalDetails.some(({ key, value }) => key === "project_or_use" && value === "Survey gear"));
assert.equal(getServiceRequestOverview({ ...leave, status: "closed" }, "Jordan Lee").fields[4].value, "Casey Smith", "Closing must not hide the recorded approver.");
assert.equal(getServiceRequestOverview({ ...leave, status: "closed" }, "Jordan Lee").fields[4].note, "24 Nov 2026, 9:20 am AEDT");
assert.equal(getServiceRequestOverview({ ...leave, status: "closed", decision_status: "declined" }, "Jordan Lee").fields[4].value, "Not approved", "A denier must never be described as an approver.");
assert.equal(getServiceRequestOverview({ ...leave, decisionBy: null }, "Jordan Lee").fields[4].value, "Approver not recorded");
assert.equal(getServiceRequestOverview({ ...leave, decisionBy: "Administrator" }, "Jordan Lee").fields[4].value, "Approver name unavailable");
assert.equal(getServiceRequestOverview({ status: "closed" }, "Jordan Lee").fields[4].value, "No approval recorded");
const oldClosed = getServiceRequestOverview({ status: "closed", reviewed_by: "reviewer-id", decisionBy: "Casey Smith", reviewed_at: "2026-11-23T22:20:00Z" }, "Jordan Lee").fields[4];
assert.equal(oldClosed.value, "Approval outcome not recorded", "A legacy reviewer must not be assumed to have approved the request.");
assert.equal(oldClosed.note, "Reviewed by Casey Smith · 24 Nov 2026, 9:20 am AEDT", "Existing reviewer and time remain visible when the old outcome is unknown.");
assert.equal(getServiceRequestOverview({ details: { nested: { example: true } } }, "Jordan Lee").additionalDetails[0].value, '{"example":true}');
const task = getServiceRequestOverview({ request_type: "task", details: { task_details: "Prepare a map" } }, "Jordan Lee");
assert.equal(task.fields[2].value, "Not provided", "A task description is not invented as a reason.");
assert.equal(task.additionalDetails[0].label, "Task Details");

const sessionUser = { id: "admin-id", email: "admin@example.test", user_metadata: { full_name: "Admin Person" } };
assert.equal(getRequestStaffName({ created_by: "other-id", authorName: "Jordan Lee" }, sessionUser), "Jordan Lee");
assert.equal(getRequestStaffName({ created_by: "other-id" }, sessionUser), "", "A request by someone else is never labelled as the signed-in administrator.");
assert.equal(getRequestStaffName({ created_by: "admin-id" }, sessionUser), "Admin Person");
assert.equal(serviceRequestUserName({ user_metadata: { first_name: "Jordan", last_name: "Lee" } }), "Jordan Lee");

let activeLookups = 0;
let maxLookups = 0;
const knownUser = { id: "known", email: "known@example.test" };
const directoryAdmin = { auth: { admin: {
  async listUsers() { return { data: { users: [knownUser] } }; },
  async getUserById(id) {
    activeLookups += 1;
    maxLookups = Math.max(maxLookups, activeLookups);
    await new Promise((resolve) => setTimeout(resolve, 1));
    activeLookups -= 1;
    return { data: { user: id === "missing" ? null : { id, email: `${id}@example.test` } } };
  },
} } };
const rows = Array.from({ length: 15 }, (_, index) => ({ created_by: `staff-${index}`, reviewed_by: index === 0 ? "known" : "missing" }));
const resolvedUsers = await resolveServiceRequestUsers(directoryAdmin, rows);
assert.equal(resolvedUsers.length, 16, "Referenced users outside the first page are resolved when available.");
assert(maxLookups <= 10, "Missing identity lookups must use bounded concurrency.");

console.log("Service request decision workflow contract passed.");
