import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("..", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

const auditRoute = await read("app/api/whs-audits/route.js");
const complianceRoute = await read("app/api/whs-compliance/route.js");
const dashboard = await read("components/WhsComplianceDashboard.js");
const staffForms = await read("components/StaffForms.js");
const styles = await read("app/globals.css");

assert.match(auditRoute, /requirePortalResource\(access, "admin\.whs_monitoring"\)/, "WHS audits must remain within the authorised WHS monitoring domain.");
assert.match(auditRoute, /if \(needsAction && !findings\)/, "Failed or corrective audits must require recorded reasoning.");
assert.match(auditRoute, /if \(needsAction && !correctiveAction\)/, "Failed or corrective audits must require a corrective action.");
assert.match(auditRoute, /if \(needsAction && !correctiveDue\)/, "Failed or corrective audits must require a corrective-action due date.");
assert.match(auditRoute, /eq\("form_id", b\.form_id\).*order\("audited_at"/s, "The API must check for a current audit before recording another one.");
assert.match(auditRoute, /This submission has already been audited/, "Duplicate audits must be rejected so figures remain current.");
assert.match(auditRoute, /review_note: note/, "The audit outcome must be written back to the staff form history.");
assert.match(auditRoute, /status: needsAction \? "actioned" : "reviewed"/, "A corrective outcome must update the underlying form status.");
assert.match(auditRoute, /Reasoning: \$\{findings\}/, "Corrective notification text must include the audit reasoning.");
assert.match(auditRoute, /Corrective action: \$\{correctiveAction\}/, "Corrective notification text must include the required action.");
assert.match(auditRoute, /event_type: closed \? "whs_corrective_action_closed" : "whs_audit_outcome"/, "The submitter must be notified both when an action is assigned and when it is closed.");
assert.match(auditRoute, /action: "corrective_action_closed"/, "Closing an action must be preserved in the administrator audit log.");

assert.match(complianceRoute, /const auditByForm = new Map\(\)/, "Compliance figures must be based on a current audit per form.");
assert.match(complianceRoute, /const currentAudits = \[\.\.\.auditByForm\.values\(\)\]/, "Legacy duplicate audit rows must be deduplicated before metrics are calculated.");
assert.match(complianceRoute, /const audited = currentAudits\.length/, "Audited totals must count unique audited submissions.");
assert.match(complianceRoute, /const failedChecks = Object\.values\(failedByCat\)/, "Failed-check figures must count actual failed checks, not only failed outcomes.");
assert.match(complianceRoute, /auditByForm: Object\.fromEntries/, "The dashboard must receive each form's current audit status.");

assert.match(dashboard, /await load\(\);\n      if \(d\.warning\)/, "The dashboard must reload its figures after recording or closing an audit.");
assert.match(dashboard, /const currentAudit = data\.auditByForm\?\.\[f\.id\]/, "The register must render the current audit state for each form.");
assert.match(dashboard, /disabled=\{Boolean\(currentAudit\)\}/, "The audit control must prevent a duplicate audit from the register.");
assert.match(dashboard, /Audit reasoning \{audit\.outcome !== "pass" \? "\(required\)" : ""\}/, "The audit modal must clearly require reasoning for corrective outcomes.");
assert.match(dashboard, /The submitter will receive a staff notification containing this reasoning/, "The audit modal must disclose staff notification contents to the auditor.");

assert.match(staffForms, /actioned: \{ bg: "#fbecea", fg: "#a5342a", label: "Corrective action required" \}/, "Staff history must clearly identify forms with corrective work outstanding.");
assert.match(styles, /\.wcd-audit-state\.open,\n\.wcd-audit-state\.fail/, "Open or failed audit states must have a distinct visual treatment.");
assert.match(styles, /\.wcd-audit-notice/, "The staff-notification notice must have a readable professional style.");

console.log("WHS audit accountability contract passed.");
