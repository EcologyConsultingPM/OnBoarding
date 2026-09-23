import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("..", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

const staffForms = await read("components/StaffForms.js");
const whsRoute = await read("app/api/whs-forms/route.js");
const firstAidRoute = await read("app/api/first-aid-kit-checks/route.js");
const firstAidComponent = await read("components/FirstAidKitChecks.js");
const tracker = await read("components/AdminProjectTracker.js");
const trackerRoute = await read("app/api/admin/project-tracker-entries/route.js");
const staffTrackerRoute = await read("app/api/project-tracker-entries/route.js");
const staffProjectTracker = await read("components/StaffProjectTracker.js");
const staffMyProjects = await read("components/StaffMyProjects.js");
const workbook = await read("components/OnboardingWorkbook.js");
const styles = await read("app/globals.css");

assert.match(whsRoute, /const personalHistory = url\.searchParams\.get\("scope"\) === "mine"/, "The WHS API must recognise a personal-history request.");
assert.match(whsRoute, /personalHistory \|\| !access\.isAdmin \? "staff\.forms" : "admin\.whs_monitoring"/, "A personal WHS history request must use staff-form access even for an administrator.");
assert.match(whsRoute, /if \(personalHistory \|\| !access\.isAdmin\) query = query\.eq\("created_by", access\.user\.id\)/, "Personal WHS history must be restricted to the signed-in user.");
assert.match(firstAidRoute, /const personalHistory = new URL\(request\.url\)\.searchParams\.get\("scope"\) === "mine"/, "The first-aid API must recognise a personal-history request.");
assert.match(firstAidRoute, /if \(personalHistory \|\| !access\.isAdmin\) query = query\.eq\("checked_by", access\.user\.id\)/, "Personal first-aid history must be restricted to the signed-in user.");
assert.match(staffForms, /\/api\/whs-forms\?scope=mine/, "The staff history view must explicitly request its own WHS forms.");
assert.match(staffForms, /\/api\/first-aid-kit-checks\?scope=mine/, "The staff history view must include the user’s first-aid checks.");
assert.match(staffForms, /<FirstAidKitChecks onSubmitted=\{loadHistory\}/, "Submitting a first-aid check must refresh personal history.");
assert.match(firstAidComponent, /export default function FirstAidKitChecks\(\{ onSubmitted \}\)/, "The first-aid form must accept a history-refresh callback.");
assert.match(firstAidComponent, /setSaved\(data\.check \|\| \{ check_date: checkDate \}\); onSubmitted\?\.\(\);/, "A saved first-aid check must refresh the form-history source.");

assert.match(trackerRoute, /const auditReason = correctionReason \|\| "Administrative correction recorded without an additional note\.";/, "Timesheet corrections without a note must retain automatic audit provenance.");
assert.match(trackerRoute, /reason: auditReason/, "The automatic or supplied correction reason must be written to the audit record.");
assert.doesNotMatch(trackerRoute, /if \(correctionReason\.length < 10\)/, "Timesheet corrections must not be blocked by a typed-note requirement.");
assert.match(tracker, /Correction note/, "The tracker editor must label the optional note accurately.");
assert.match(tracker, /Optional — recorded in the audit trail if supplied/, "The tracker editor must explain how optional notes are retained.");
assert.match(tracker, /Saving correction…" : "Save corrected entry"/, "The correction save action must remain available without an optional note.");
assert.match(staffTrackerRoute, /const rate = rateByStaff\.get\(row\.staff_user_id\) \|\| defaultRate;/, "Staff tracker entries must charge unpriced future team members at the project default rate.");
assert.match(staffTrackerRoute, /const allowed = access\.isAdmin \|\| \(eligible\.projects \|\| \[\]\)\.some\(\(project\) => project\.id === projectId\);/, "Team timesheet history must be restricted to a project allocated to the signed-in staff member.");
assert.match(staffTrackerRoute, /\.eq\("project_id", projectId\)/, "The team timesheet query must be constrained to one requested project.");
assert.match(staffTrackerRoute, /rates, delivery costs and profitability stay/, "Staff project history responses must not return commercial rate or profitability data.");
assert.match(staffProjectTracker, /label: "Your timesheets"/, "Staff tracker must label the personal history tab clearly.");
assert.match(staffProjectTracker, /label: "Project timesheet history"/, "Staff tracker must offer a separate project-wide timesheet history tab.");
assert.match(staffProjectTracker, /const projectTimesheetHistory = board\?\.entries \|\| \[\];/, "Project history must render the authorised project board entries.");
assert.match(staffProjectTracker, /Read-only project record/, "The project history tab must visibly identify itself as read-only.");
assert.match(staffProjectTracker, /entries cannot be edited here/, "The project history tab must state that editing remains unavailable to staff.");
assert.match(staffMyProjects, /<StaffProjectTracker embedded \/>/, "My Projects must use the same project tracker so the timesheet history tabs are consistent in both staff entry points.");
assert.match(trackerRoute, /rateByStaff\.get\(row\.staff_user_id\) \|\| defaultRate/, "Administrator corrections must preserve the project default-rate fallback.");
assert.match(tracker, /className="apt-timesheet-table-wrap"/, "The tracker must use the responsive timesheet table wrapper.");
assert.match(tracker, /className="apt-timesheet-table"/, "The tracker must use the widened timesheet table.");
assert.match(styles, /\.apt-timesheet-table \{ width: 100%; min-width: 1040px;/, "The timesheet table must reserve readable column width.");
assert.match(workbook, /mode === "adminprojects" && projectsSubview === "tracker" \? 1600 : 1280/, "The admin tracker workspace must use a wider desktop canvas.");
assert.match(styles, /\.admin-project-tracker \{\s*width: 100%;\s*max-width: none;/, "The tracker root must fill its available desktop workspace.");
assert.match(styles, /\.admin-project-tracker \{ box-sizing: border-box; border-radius: 18px; padding: 18px;/, "The padded tracker root must not overflow the full-width workspace.");
assert.match(styles, /\.apt-grid\.apt-grid--budget \{\s*grid-template-columns: minmax\(0, 1fr\);/, "The Budget tab must override the generic two-column grid and fill the workspace.");
assert.match(styles, /\.apt-grid\.apt-grid--timesheets,\s*\.apt-grid\.apt-grid--activities \{\s*grid-template-columns: minmax\(0, 1fr\);/, "Timesheets and Work activities must override the generic two-column grid and fill the workspace.");

console.log("Tracker and forms-history contract passed: personal submission history is scoped correctly, staff project timesheet history is read-only and project-scoped, specialised first-aid records are included, and tracker detail tabs use their full desktop workspace.");
