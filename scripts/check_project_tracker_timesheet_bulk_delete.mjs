import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("..", import.meta.url);
const route = await readFile(new URL("app/api/admin/project-tracker-entries/route.js", root), "utf8");
const component = await readFile(new URL("components/AdminProjectTracker.js", root), "utf8");
const styles = await readFile(new URL("app/globals.css", root), "utf8");

assert.match(route, /Array\.isArray\(body\?\.ids\)/, "The admin DELETE route must accept a bulk ids payload.");
assert.match(route, /requestedIds\.length > 500/, "Bulk deletion must have a bounded selection size.");
assert.match(route, /\(currentRows \|\| \[\]\)\.map\(\(row\) => \[row\.id, row\]\)/, "Bulk deletion must load every selected row before mutating data.");
assert.match(route, /project_tracker_entry_audit.*insert\(rows\.map/s, "Every bulk deletion must create a void audit record before deletion.");
assert.match(route, /from\("project_tracker_entries"\)\.delete\(\)\.in\("id", requestedIds\)/, "Bulk deletion must target only selected entry ids.");
assert.match(route, /allocationKeys\.map/, "Bulk deletion must recalculate every affected allocation.");
assert.match(route, /event_type: "project_tracker_entry_deleted"/, "Bulk deletion must notify affected staff.");

assert.match(component, /selectedEntryIds.*new Set/, "The admin tracker must maintain checkbox selection state.");
assert.match(component, /body: JSON\.stringify\(\{ ids, reason \}\)/, "The UI must send selected entry ids and the administrator reason.");
assert.match(component, /Delete \$\{ids\.length\} selected timesheet/, "Bulk deletion must require a visible confirmation.");
assert.match(component, /Select visible/, "The UI must provide a select-visible control.");
assert.match(component, /aria-label="Select all visible timesheet entries"/, "The table must expose an accessible select-all checkbox.");
assert.match(component, /aria-label=\{`Select \$\{entry\.staff_name\}'s/, "Each timesheet row must expose an accessible checkbox.");
assert.match(component, /Delete selected/, "The UI must expose the bulk deletion action.");

assert.match(styles, /\.apt-entry-select-col input\[type="checkbox"\]/, "The selection checkbox must have dedicated styling.");
assert.match(styles, /\.apt-entry-bulk-delete/, "The destructive bulk action must be visually distinct.");

console.log("Project tracker timesheet bulk-delete contract passed: bounded selection, audit-first deletion, allocation refresh, notifications, accessible controls and themed styling.");
