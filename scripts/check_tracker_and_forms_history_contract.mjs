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

assert.match(trackerRoute, /if \(correctionReason\.length < 10\)/, "Timesheet corrections must retain an audit reason.");
assert.match(tracker, /Required for the audit trail/, "The tracker editor must explain the correction-reason requirement.");
assert.match(tracker, /Add correction reason to save/, "The disabled tracker-save control must explain why it is unavailable.");
assert.match(tracker, /className="apt-timesheet-table-wrap"/, "The tracker must use the responsive timesheet table wrapper.");
assert.match(tracker, /className="apt-timesheet-table"/, "The tracker must use the widened timesheet table.");
assert.match(styles, /\.apt-timesheet-table \{ width: 100%; min-width: 1040px;/, "The timesheet table must reserve readable column width.");
assert.match(workbook, /mode === "adminprojects" && projectsSubview === "tracker" \? 1600 : 1280/, "The admin tracker workspace must use a wider desktop canvas.");

console.log("Tracker and forms-history contract passed: personal submission history is scoped correctly, specialised first-aid records are included, and audited timesheet corrections are clear and readable.");
