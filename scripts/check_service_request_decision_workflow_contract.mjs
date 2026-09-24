import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("..", import.meta.url);
const read = (file) => readFile(new URL(file, root), "utf8");
const admin = await read("components/AdminServiceRequests.js");
const staff = await read("components/StaffServiceRequests.js");
const listRoute = await read("app/api/service-requests/route.js");
const actionRoute = await read("app/api/service-requests/[requestId]/route.js");
const migration = await read("sql/2026-09-24-service-request-decision-workflow.sql");

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

console.log("Service request decision workflow contract passed.");
