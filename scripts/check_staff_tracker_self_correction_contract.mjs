import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("..", import.meta.url);
const read = (file) => readFile(new URL(file, root), "utf8");
const route = await read("app/api/project-tracker-entries/route.js");
const tracker = await read("components/StaffProjectTracker.js");
const migration = await read("sql/2026-09-24-staff-tracker-self-corrections.sql");

assert.match(route, /eligibleProjects\(access, access\.user\.id, true\)/, "Staff tracker data must include a controlled ad hoc-project entry list.");
assert.match(route, /entryContext === "other_project"/, "Other-project entries must require an explicit staff selection.");
assert.match(route, /action: "ad_hoc_entered"/, "Other-project entries must retain an audit event.");
assert.match(route, /ad hoc-entry picker must never disclose the financial/, "Other-project responses must exclude unassigned project financials.");
assert.match(route, /export async function PATCH\(request\)/, "Staff must have a protected tracker-entry correction endpoint.");
assert.match(route, /current\.staff_user_id !== access\.user\.id/, "Staff corrections must be restricted to the entry owner.");
assert.match(route, /action: "staff_corrected"/, "Staff corrections must retain audit provenance.");
assert.match(route, /refreshTrackerAllocation/, "Staff corrections must refresh controlled allocation totals.");
assert.match(tracker, /Other active project/, "The tracker form must provide an explicit other-project path.");
assert.match(tracker, /Save correction/, "Staff must have a visible self-correction action.");
assert.match(tracker, /Edit entry/, "Staff history must offer self-editing controls.");
assert.match(migration, /'staff_corrected', 'ad_hoc_entered'/, "The migration must authorise the new audit event values.");

console.log("Staff tracker self-correction contract passed.");
